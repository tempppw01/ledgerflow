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

      assert.equal(first.currentVersion, 1);
      assert.deepEqual(second, first);
      assert.deepEqual(status, {
        provider: 'sqlite',
        currentVersion: 1,
        expectedVersion: 1,
        ready: true
      });
      assert.ok(tables.includes('ledger_transactions'));
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

test('MySQL schema keeps foreign-key ids indexable and avoids SQLite-only syntax', () => {
  const statements = getRelationalMigrationStatements('mysql');
  const sql = statements.join('\n');

  assert.match(sql, /ENGINE=InnoDB/);
  assert.doesNotMatch(sql, /_id LONGTEXT/);
  assert.doesNotMatch(sql, /user_id LONGTEXT/);
  assert.match(sql, /ledger_schema_migrations \(id INT NOT NULL/);
  assert.match(sql, /market VARCHAR\(24\)/);
  assert.match(sql, /symbol VARCHAR\(40\)/);
  assert.doesNotMatch(sql, /INSERT OR IGNORE/);
});
