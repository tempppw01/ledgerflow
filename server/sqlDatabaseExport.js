import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSqliteDatabasePath } from './databaseProvider.js';
import { withMysqlConnection } from './databaseConnection.js';

function quoteSqliteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll('`', '``')}\``;
}

function escapeMysqlString(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\0', '\\0')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\b', '\\b')
    .replaceAll('\t', '\\t')
    .replaceAll('\x1a', '\\Z')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"');
}

function mysqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (value instanceof Date) {
    return `'${value.toISOString().replace('T', ' ').replace('Z', '')}'`;
  }
  return `'${escapeMysqlString(value)}'`;
}

function pruneSqliteDatabase(database, ledgerUserId) {
  const authUser = database
    .prepare('SELECT id FROM auth_users WHERE ledger_user_id = ? LIMIT 1')
    .get(ledgerUserId);
  if (!authUser?.id) throw new Error('当前账号不存在，无法导出数据库。');

  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row.name));
  const relationWhere = {
    ledger_transaction_tags: [
      'transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?)',
      [ledgerUserId]
    ],
    ledger_transaction_attachments: [
      'transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?)',
      [ledgerUserId]
    ],
    ledger_debt_repayments: [
      '(debt_id IN (SELECT id FROM ledger_debts WHERE user_id = ?) OR transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?))',
      [ledgerUserId, ledgerUserId]
    ],
    investment_position_history: [
      'position_id IN (SELECT id FROM investment_positions WHERE user_id = ?)',
      [ledgerUserId]
    ],
    ai_workflow_messages: [
      'run_id IN (SELECT id FROM ai_workflow_runs WHERE user_id = ?)',
      [ledgerUserId]
    ],
    ai_workflow_context_refs: [
      'run_id IN (SELECT id FROM ai_workflow_runs WHERE user_id = ?)',
      [ledgerUserId]
    ]
  };

  database.exec('PRAGMA foreign_keys = OFF');
  for (const table of tables) {
    if (table === 'ledger_users') {
      database.prepare('DELETE FROM ledger_users WHERE id <> ?').run(ledgerUserId);
      continue;
    }
    if (table === 'auth_users') {
      database.prepare('DELETE FROM auth_users WHERE ledger_user_id <> ?').run(ledgerUserId);
      continue;
    }
    if (
      table === 'auth_sessions' ||
      table === 'auth_password_reset_tokens' ||
      table === 'auth_audit_log'
    ) {
      database
        .prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE user_id <> ? OR user_id IS NULL`)
        .run(authUser.id);
      continue;
    }
    if (table === 'ledgerflow_metadata' || table === 'ledger_schema_migrations') continue;
    if (relationWhere[table]) {
      const [where, params] = relationWhere[table];
      database.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE NOT (${where})`).run(...params);
      continue;
    }
    const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    if (columns.some((column) => column.name === 'user_id')) {
      database
        .prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE user_id <> ? OR user_id IS NULL`)
        .run(ledgerUserId);
    }
  }
  database.exec('PRAGMA foreign_keys = ON; VACUUM');
}

export async function createSqliteDatabaseExport(env = process.env, ledgerUserId) {
  const sourcePath = getSqliteDatabasePath(env);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-sqlite-export-'));
  const exportPath = path.join(temporaryDirectory, 'ledgerflow.sqlite');
  try {
    const database = new DatabaseSync(sourcePath);
    try {
      database.exec(`VACUUM INTO ${quoteSqliteString(exportPath)}`);
    } finally {
      database.close();
    }

    if (ledgerUserId) {
      const scopedDatabase = new DatabaseSync(exportPath);
      try {
        pruneSqliteDatabase(scopedDatabase, ledgerUserId);
      } finally {
        scopedDatabase.close();
      }
    }

    return {
      content: await readFile(exportPath),
      contentType: 'application/vnd.sqlite3',
      extension: 'sqlite'
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function createMysqlSqlExport(env = process.env, ledgerUserId) {
  const content = await withMysqlConnection(async (connection) => {
    const [tableRows] = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    const tableKey = tableRows.length
      ? Object.keys(tableRows[0]).find((key) => key.toLowerCase().startsWith('tables_in_'))
      : null;
    const tables = tableKey ? tableRows.map((row) => String(row[tableKey])) : [];
    const authUser = ledgerUserId
      ? (
          await connection.query('SELECT id FROM auth_users WHERE ledger_user_id = ? LIMIT 1', [
            ledgerUserId
          ])
        )[0][0]
      : null;
    const chunks = [
      '-- LedgerFlow SQL export\n',
      '-- Generated at ',
      new Date().toISOString(),
      '\n\nSET FOREIGN_KEY_CHECKS=0;\n\n'
    ];

    for (const table of tables) {
      const identifier = quoteIdentifier(table);
      const [createRows] = await connection.query(`SHOW CREATE TABLE ${identifier}`);
      const createRow = createRows[0] || {};
      const createStatement =
        createRow['Create Table'] ||
        createRow['Create View'] ||
        Object.values(createRow).find((value) => String(value).toUpperCase().startsWith('CREATE '));
      if (!createStatement) continue;
      chunks.push(`DROP TABLE IF EXISTS ${identifier};\n${createStatement};\n\n`);

      const [columns] = await connection.query(`SHOW COLUMNS FROM ${identifier}`);
      const columnNames = columns.map((column) => String(column.Field));
      if (columnNames.length === 0) continue;
      let where = '';
      let whereParams = [];
      if (ledgerUserId && table === 'ledger_users') {
        where = ' WHERE id = ?';
        whereParams = [ledgerUserId];
      } else if (ledgerUserId && table === 'auth_users') {
        where = ' WHERE ledger_user_id = ?';
        whereParams = [ledgerUserId];
      } else if (
        ledgerUserId &&
        ['auth_sessions', 'auth_password_reset_tokens', 'auth_audit_log'].includes(table)
      ) {
        where = ' WHERE user_id = ?';
        whereParams = [authUser?.id || ''];
      } else if (ledgerUserId && table === 'ledger_transaction_tags') {
        where = ' WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?)';
        whereParams = [ledgerUserId];
      } else if (ledgerUserId && table === 'ledger_transaction_attachments') {
        where = ' WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?)';
        whereParams = [ledgerUserId];
      } else if (ledgerUserId && table === 'ledger_debt_repayments') {
        where =
          ' WHERE debt_id IN (SELECT id FROM ledger_debts WHERE user_id = ?) OR transaction_id IN (SELECT id FROM ledger_transactions WHERE user_id = ?)';
        whereParams = [ledgerUserId, ledgerUserId];
      } else if (ledgerUserId && table === 'investment_position_history') {
        where = ' WHERE position_id IN (SELECT id FROM investment_positions WHERE user_id = ?)';
        whereParams = [ledgerUserId];
      } else if (
        ledgerUserId &&
        ['ai_workflow_messages', 'ai_workflow_context_refs'].includes(table)
      ) {
        where = ' WHERE run_id IN (SELECT id FROM ai_workflow_runs WHERE user_id = ?)';
        whereParams = [ledgerUserId];
      } else if (ledgerUserId && columnNames.includes('user_id')) {
        where = ' WHERE user_id = ?';
        whereParams = [ledgerUserId];
      }
      const [rows] = await connection.query(`SELECT * FROM ${identifier}${where}`, whereParams);
      if (rows.length === 0) continue;
      const columnSql = columnNames.map(quoteIdentifier).join(', ');
      const values = rows.map(
        (row) => `(${columnNames.map((column) => mysqlLiteral(row[column])).join(', ')})`
      );
      chunks.push(`INSERT INTO ${identifier} (${columnSql}) VALUES\n${values.join(',\n')};\n\n`);
    }

    chunks.push('SET FOREIGN_KEY_CHECKS=1;\n');
    return chunks.join('');
  }, env);

  return {
    content: Buffer.from(content, 'utf8'),
    contentType: 'application/sql; charset=utf-8',
    extension: 'sql'
  };
}
