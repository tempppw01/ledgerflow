import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { getDatabaseDataDirectory, getSqliteDatabasePath } from './databaseProvider.js';
import { withMysqlConnection } from './databaseConnection.js';

export const RELATIONAL_SCHEMA_VERSION = 1;
const DEFAULT_USER_ID = 'default';

const SQLITE_TABLES = [
  `CREATE TABLE IF NOT EXISTS ledger_schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ledger_users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ledger_user_settings (user_id TEXT NOT NULL, setting_key TEXT NOT NULL, setting_value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, setting_key), FOREIGN KEY (user_id) REFERENCES ledger_users(id))`,
  `CREATE TABLE IF NOT EXISTS ledger_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, account_type TEXT, initial_balance REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, trashed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id))`,
  `CREATE TABLE IF NOT EXISTS ledger_categories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, category_kind TEXT NOT NULL, color TEXT, icon TEXT, sort_order INTEGER NOT NULL DEFAULT 0, trashed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id))`,
  `CREATE TABLE IF NOT EXISTS ledger_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL, category_id TEXT NOT NULL, transaction_type TEXT NOT NULL, amount REAL NOT NULL, occurred_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', source TEXT, order_no TEXT, merchant_order_no TEXT, transaction_status TEXT, adjustment_kind TEXT, refund_of_transaction_id TEXT, trashed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (account_id) REFERENCES ledger_accounts(id), FOREIGN KEY (category_id) REFERENCES ledger_categories(id), FOREIGN KEY (refund_of_transaction_id) REFERENCES ledger_transactions(id))`,
  `CREATE TABLE IF NOT EXISTS ledger_transaction_tags (transaction_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (transaction_id, tag), FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS ledger_transaction_attachments (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, name TEXT NOT NULL, remote_path TEXT NOT NULL, mime_type TEXT, byte_size INTEGER, uploaded_at TEXT NOT NULL, FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS ledger_balance_changes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL, transaction_id TEXT, related_transaction_id TEXT, change_type TEXT NOT NULL, amount REAL NOT NULL, before_balance REAL NOT NULL, after_balance REAL NOT NULL, note TEXT, remark TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (account_id) REFERENCES ledger_accounts(id), FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id), FOREIGN KEY (related_transaction_id) REFERENCES ledger_transactions(id))`,
  `CREATE TABLE IF NOT EXISTS ledger_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT, name TEXT NOT NULL, subscription_kind TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, billing_cycle TEXT NOT NULL, custom_cycle_days INTEGER, provider TEXT, note TEXT, renewal_date TEXT, expire_date TEXT, auto_renew INTEGER NOT NULL DEFAULT 0, subscription_status TEXT NOT NULL, last_generated_at TEXT, last_generated_transaction_id TEXT, trashed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (account_id) REFERENCES ledger_accounts(id), FOREIGN KEY (last_generated_transaction_id) REFERENCES ledger_transactions(id))`,
  `CREATE TABLE IF NOT EXISTS ledger_debts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, debt_type TEXT NOT NULL, debt_status TEXT NOT NULL, balance REAL NOT NULL, annual_rate REAL, remaining_months INTEGER, total_periods INTEGER, paid_periods INTEGER, loan_principal REAL, total_repayment REAL, custom_min_payment REAL, bill_day INTEGER, repayment_day INTEGER, repayment_method TEXT, repayment_record_mode TEXT, payment_account_id TEXT, grace_days INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (payment_account_id) REFERENCES ledger_accounts(id))`,
  `CREATE TABLE IF NOT EXISTS ledger_debt_repayments (id TEXT PRIMARY KEY, debt_id TEXT NOT NULL, transaction_id TEXT, amount REAL NOT NULL, paid_at TEXT NOT NULL, payment_account_id TEXT, note TEXT, record_mode TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (debt_id) REFERENCES ledger_debts(id) ON DELETE CASCADE, FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id), FOREIGN KEY (payment_account_id) REFERENCES ledger_accounts(id))`,
  `CREATE TABLE IF NOT EXISTS investment_instruments (id TEXT PRIMARY KEY, instrument_type TEXT NOT NULL, market TEXT, symbol TEXT, name TEXT NOT NULL, currency TEXT, fund_company TEXT, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (market, symbol))`,
  `CREATE TABLE IF NOT EXISTS investment_positions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, instrument_id TEXT, linked_account_id TEXT, name TEXT NOT NULL, category TEXT NOT NULL, platform TEXT, invested_amount REAL NOT NULL, current_value REAL NOT NULL, holding_shares REAL, monthly_contribution REAL, target_allocation REAL, risk_level TEXT NOT NULL, note TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (instrument_id) REFERENCES investment_instruments(id), FOREIGN KEY (linked_account_id) REFERENCES ledger_accounts(id))`,
  `CREATE TABLE IF NOT EXISTS investment_position_history (id TEXT PRIMARY KEY, position_id TEXT NOT NULL, action TEXT NOT NULL, invested_amount REAL NOT NULL, current_value REAL NOT NULL, profit REAL NOT NULL, profit_rate REAL NOT NULL, invested_amount_delta REAL, current_value_delta REAL, note TEXT, created_at TEXT NOT NULL, FOREIGN KEY (position_id) REFERENCES investment_positions(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS investment_goals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, goal_kind TEXT NOT NULL, target_amount REAL NOT NULL, current_amount REAL NOT NULL, monthly_contribution REAL, target_date TEXT, priority TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id))`,
  `CREATE TABLE IF NOT EXISTS investment_watchlists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, instrument_id TEXT, name TEXT NOT NULL, code TEXT, platform TEXT, note TEXT, holding_shares REAL, investment_advice TEXT, last_verdict TEXT, last_summary TEXT, last_risk_level TEXT, last_analysis_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (instrument_id) REFERENCES investment_instruments(id))`,
  `CREATE TABLE IF NOT EXISTS investment_watch_tags (watchlist_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (watchlist_id, tag), FOREIGN KEY (watchlist_id) REFERENCES investment_watchlists(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS investment_analysis_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, watchlist_id TEXT, workflow_run_id TEXT, verdict TEXT, risk_level TEXT, summary TEXT, analysis_payload TEXT NOT NULL, market_context TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (watchlist_id) REFERENCES investment_watchlists(id) ON DELETE SET NULL)`,
  `CREATE TABLE IF NOT EXISTS market_quotes (id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL, price REAL, change_amount REAL, change_percent REAL, turnover_amount REAL, quoted_at TEXT NOT NULL, source TEXT NOT NULL, raw_payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY (instrument_id) REFERENCES investment_instruments(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS market_news (id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT, category TEXT, title TEXT NOT NULL, url TEXT, published_at TEXT, content_summary TEXT, raw_payload TEXT, fetched_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (source, external_id))`,
  `CREATE TABLE IF NOT EXISTS market_news_summaries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, summary_type TEXT NOT NULL, source_start_at TEXT, source_end_at TEXT, summary TEXT NOT NULL, sentiment TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id))`,
  `CREATE TABLE IF NOT EXISTS ai_workflows (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, workflow_type TEXT NOT NULL, system_prompt TEXT NOT NULL, settings_json TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES ledger_users(id))`,
  `CREATE TABLE IF NOT EXISTS ai_workflow_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workflow_id TEXT, run_type TEXT NOT NULL, status TEXT NOT NULL, model TEXT, input_summary TEXT, output_summary TEXT, usage_json TEXT, error_message TEXT, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (user_id) REFERENCES ledger_users(id), FOREIGN KEY (workflow_id) REFERENCES ai_workflows(id) ON DELETE SET NULL)`,
  `CREATE TABLE IF NOT EXISTS ai_workflow_messages (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, reasoning TEXT, attachments_json TEXT, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES ai_workflow_runs(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS ai_workflow_context_refs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, context_type TEXT NOT NULL, reference_id TEXT, snapshot_text TEXT, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES ai_workflow_runs(id) ON DELETE CASCADE)`
];

const MYSQL_TABLES = SQLITE_TABLES.map((statement, index) => {
  if (index === 0) {
    return `CREATE TABLE IF NOT EXISTS ledger_schema_migrations (id INT NOT NULL, applied_at DATETIME(3) NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  return statement
    .replace(/\bTEXT PRIMARY KEY\b/g, 'VARCHAR(64) PRIMARY KEY')
    .replace(/\bTEXT NOT NULL\b/g, 'LONGTEXT NOT NULL')
    .replace(/\bTEXT\b/g, 'LONGTEXT')
    .replace(/\bREAL\b/g, 'DECIMAL(20, 6)')
    .replace(/\bINTEGER\b/g, 'BIGINT')
    .replace(/\b(display_name|name|note) LONGTEXT NOT NULL DEFAULT ''/g, '$1 VARCHAR(1024) NOT NULL DEFAULT \'\'')
    .replace(/\b(setting_key|tag) LONGTEXT NOT NULL/g, '$1 VARCHAR(64) NOT NULL')
    .replace(/\bmarket LONGTEXT/g, 'market VARCHAR(24)')
    .replace(/\bsymbol LONGTEXT/g, 'symbol VARCHAR(40)')
    .replace(/\bsource LONGTEXT/g, 'source VARCHAR(48)')
    .replace(/\bexternal_id LONGTEXT/g, 'external_id VARCHAR(96)')
    .replace(/\b[a-z][a-z0-9_]*_id LONGTEXT/g, (column) => `${column.split(' ')[0]} VARCHAR(64)`)
    .replace(/\)$/, ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
});

const INDEXES = [
  ['idx_accounts_user_sort', 'ledger_accounts', 'user_id, sort_order'],
  ['idx_categories_user_kind_sort', 'ledger_categories', 'user_id, category_kind, sort_order'],
  ['idx_transactions_user_occurred', 'ledger_transactions', 'user_id, occurred_at'],
  ['idx_transactions_account_occurred', 'ledger_transactions', 'account_id, occurred_at'],
  ['idx_balance_changes_account_created', 'ledger_balance_changes', 'account_id, created_at'],
  ['idx_subscriptions_user_status', 'ledger_subscriptions', 'user_id, subscription_status'],
  ['idx_debts_user_status', 'ledger_debts', 'user_id, debt_status'],
  ['idx_debt_repayments_debt_paid', 'ledger_debt_repayments', 'debt_id, paid_at'],
  ['idx_positions_user_active', 'investment_positions', 'user_id, is_active'],
  ['idx_position_history_position_created', 'investment_position_history', 'position_id, created_at'],
  ['idx_watchlists_user_updated', 'investment_watchlists', 'user_id, updated_at'],
  ['idx_analysis_watchlist_created', 'investment_analysis_runs', 'watchlist_id, created_at'],
  ['idx_quotes_instrument_quoted', 'market_quotes', 'instrument_id, quoted_at'],
  ['idx_market_news_published', 'market_news', 'published_at'],
  ['idx_workflow_runs_user_started', 'ai_workflow_runs', 'user_id, started_at'],
  ['idx_workflow_messages_run_created', 'ai_workflow_messages', 'run_id, created_at']
];

function mysqlMigrationStatements() {
  return MYSQL_TABLES;
}

export function getRelationalMigrationStatements(provider) {
  assertProvider(provider);
  return provider === 'sqlite' ? [...SQLITE_TABLES] : mysqlMigrationStatements();
}

function now() {
  return new Date().toISOString();
}

function openSqlite(env) {
  return new DatabaseSync(getSqliteDatabasePath(env));
}

function assertProvider(provider) {
  if (provider !== 'sqlite' && provider !== 'mysql') {
    throw new Error(`Unsupported relational database provider: ${provider}.`);
  }
}

function ensureSqliteIndexes(database) {
  for (const [name, table, columns] of INDEXES) {
    database.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${columns})`);
  }
}

async function ensureMysqlIndexes(connection) {
  for (const [name, table, columns] of INDEXES) {
    const [rows] = await connection.execute(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [name]);
    if (!Array.isArray(rows) || rows.length === 0) {
      await connection.query(`CREATE INDEX ${name} ON ${table} (${columns})`);
    }
  }
}

function seedSqliteDefaultUser(database) {
  const timestamp = now();
  database
    .prepare(
      `INSERT OR IGNORE INTO ledger_users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`
    )
    .run(DEFAULT_USER_ID, '默认用户', timestamp, timestamp);
}

async function seedMysqlDefaultUser(connection) {
  const timestamp = now();
  await connection.execute(
    `INSERT INTO ledger_users (id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [DEFAULT_USER_ID, '默认用户', timestamp, timestamp]
  );
}

function migrateSqlite(env) {
  const database = openSqlite(env);
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    database.exec(SQLITE_TABLES[0]);
    const applied = database
      .prepare('SELECT id FROM ledger_schema_migrations WHERE id = ?')
      .get(RELATIONAL_SCHEMA_VERSION);
    if (!applied) {
      for (const statement of SQLITE_TABLES.slice(1)) database.exec(statement);
      ensureSqliteIndexes(database);
      seedSqliteDefaultUser(database);
      database
        .prepare('INSERT INTO ledger_schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(RELATIONAL_SCHEMA_VERSION, now());
    }
    return {
      provider: 'sqlite',
      currentVersion: RELATIONAL_SCHEMA_VERSION,
      expectedVersion: RELATIONAL_SCHEMA_VERSION,
      ready: true,
      path: getSqliteDatabasePath(env)
    };
  } finally {
    database.close();
  }
}

async function migrateMysql(env) {
  return withMysqlConnection(async (connection) => {
    const statements = mysqlMigrationStatements();
    await connection.query(statements[0]);
    const [rows] = await connection.execute(
      'SELECT id FROM ledger_schema_migrations WHERE id = ?',
      [RELATIONAL_SCHEMA_VERSION]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      for (const statement of statements.slice(1)) await connection.query(statement);
      await ensureMysqlIndexes(connection);
      await seedMysqlDefaultUser(connection);
      await connection.execute('INSERT INTO ledger_schema_migrations (id, applied_at) VALUES (?, ?)', [
        RELATIONAL_SCHEMA_VERSION,
        now()
      ]);
    }
    return {
      provider: 'mysql',
      currentVersion: RELATIONAL_SCHEMA_VERSION,
      expectedVersion: RELATIONAL_SCHEMA_VERSION,
      ready: true
    };
  }, env);
}

export async function migrateRelationalDatabase(provider, env = process.env) {
  assertProvider(provider);
  if (provider === 'sqlite') {
    await mkdir(getDatabaseDataDirectory(env), { recursive: true });
    return migrateSqlite(env);
  }
  return migrateMysql(env);
}

export async function getRelationalDatabaseStatus(provider, env = process.env) {
  assertProvider(provider);
  if (provider === 'sqlite') {
    const database = openSqlite(env);
    try {
      const row = database
        .prepare('SELECT MAX(id) AS version FROM ledger_schema_migrations')
        .get();
      return {
        provider,
        currentVersion: Number(row?.version || 0),
        expectedVersion: RELATIONAL_SCHEMA_VERSION,
        ready: Number(row?.version || 0) >= RELATIONAL_SCHEMA_VERSION
      };
    } finally {
      database.close();
    }
  }

  return withMysqlConnection(async (connection) => {
    const [rows] = await connection.query('SELECT MAX(id) AS version FROM ledger_schema_migrations');
    const version = Number(rows?.[0]?.version || 0);
    return {
      provider,
      currentVersion: version,
      expectedVersion: RELATIONAL_SCHEMA_VERSION,
      ready: version >= RELATIONAL_SCHEMA_VERSION
    };
  }, env);
}
