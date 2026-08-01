import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  getRelationalMigrationStatements,
  getRelationalDatabaseStatus,
  migrateRelationalDatabase
} from './relationalDatabase.js';

test('SQLite relational schema migrates and is idempotent', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };

  try {
    const first = await migrateRelationalDatabase('sqlite', env);
    const second = await migrateRelationalDatabase('sqlite', env);
    const status = await getRelationalDatabaseStatus('sqlite', env);
    const database = new DatabaseSync(first.path);
    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((row) => row.name);
      const user = database.prepare('SELECT id FROM ledger_users WHERE id = ?').get('default');

      assert.equal(first.currentVersion, 3);
      assert.deepEqual(second, first);
      assert.deepEqual(status, {
        provider: 'sqlite',
        currentVersion: 3,
        expectedVersion: 3,
        ready: true
      });
      assert.ok(tables.includes('ledger_transactions'));
      assert.ok(tables.includes('auth_users'));
      assert.ok(tables.includes('auth_sessions'));
      assert.ok(
        database
          .prepare("SELECT name FROM pragma_table_info('auth_sessions') WHERE name = 'device_name'")
          .get()
      );
      assert.ok(tables.includes('auth_password_reset_tokens'));
      assert.ok(tables.includes('auth_audit_log'));
      assert.ok(tables.includes('investment_positions'));
      assert.ok(tables.includes('market_quotes'));
      assert.ok(tables.includes('ai_workflow_runs'));
      assert.equal(user?.id, 'default');
    } finally {
      database.close();
    }
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('SQLite upgrades a real V1 database through the authentication and device migrations', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-v1-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };

  try {
    const statements = getRelationalMigrationStatements('sqlite');
    const databasePath = path.join(dataDirectory, 'ledgerflow.sqlite');
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(statements[0]);
      for (const statement of statements.slice(1).filter((item) => !item.includes('auth_'))) {
        database.exec(statement);
      }
      database.exec(
        `INSERT INTO ledger_users (id, display_name, created_at, updated_at)
         VALUES ('default', '默认用户', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
      );
      database.exec(
        `INSERT INTO ledger_schema_migrations (id, applied_at)
         VALUES (1, '2026-08-01T00:00:00.000Z')`
      );
    } finally {
      database.close();
    }

    const migrated = await migrateRelationalDatabase('sqlite', env);
    const upgraded = new DatabaseSync(databasePath);
    try {
      const versions = upgraded
        .prepare('SELECT id FROM ledger_schema_migrations ORDER BY id')
        .all()
        .map((row) => Number(row.id));
      assert.equal(migrated.currentVersion, 3);
      assert.deepEqual(versions, [1, 2, 3]);
      assert.equal(upgraded.prepare('SELECT COUNT(*) AS count FROM auth_users').get().count, 0);
    } finally {
      upgraded.close();
    }
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('MySQL schema keeps foreign-key ids indexable and avoids SQLite-only syntax', () => {
  const statements = getRelationalMigrationStatements('mysql');
  const sql = statements.join('\n');

  assert.match(sql, /ENGINE=InnoDB/);
  assert.doesNotMatch(sql, /_id LONGTEXT/);
  assert.doesNotMatch(sql, /user_id LONGTEXT/);
  assert.match(sql, /ledger_schema_migrations \(id INT NOT NULL/);
  assert.match(sql, /market VARCHAR\(24\)/);
  assert.match(sql, /symbol VARCHAR\(40\)/);
  assert.match(sql, /email VARCHAR\(320\) NOT NULL UNIQUE/);
  assert.match(sql, /token_hash CHAR\(64\) NOT NULL UNIQUE/);
  assert.match(sql, /occurred_at DATETIME\(3\)/);
  assert.doesNotMatch(sql, /INSERT OR IGNORE/);
});
