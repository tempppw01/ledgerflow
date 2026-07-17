import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getDatabaseSetupStatus,
  getSqliteDatabasePath,
  initializeDatabaseProvider
} from './databaseProvider.js';
import {
  getLatestSqliteSnapshot,
  saveSqliteSnapshot,
  testSqliteDatabase
} from './sqliteDatabase.js';

async function withTemporaryDataDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-db-provider-'));
  try {
    await callback({ LEDGERFLOW_DATA_DIR: directory, DATABASE_PROVIDER: 'auto' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('initializes and locks the selected database provider', async () => {
  await withTemporaryDataDirectory(async (env) => {
    const before = await getDatabaseSetupStatus(env);
    assert.equal(before.initialized, false);
    assert.deepEqual(before.allowedProviders, ['sqlite', 'mysql']);

    const created = await initializeDatabaseProvider({ provider: 'sqlite', env });
    assert.equal(created.created, true);
    assert.equal(created.provider, 'sqlite');

    const after = await getDatabaseSetupStatus(env);
    assert.equal(after.initialized, true);
    assert.equal(after.provider, 'sqlite');

    await assert.rejects(
      initializeDatabaseProvider({ provider: 'mysql', env }),
      /already locked to sqlite/
    );
  });
});

test('honors a deployment-level provider restriction', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-db-provider-'));
  try {
    const env = { LEDGERFLOW_DATA_DIR: directory, DATABASE_PROVIDER: 'mysql' };
    const status = await getDatabaseSetupStatus(env);
    assert.deepEqual(status.allowedProviders, ['mysql']);

    await assert.rejects(
      initializeDatabaseProvider({ provider: 'sqlite', env }),
      /only permits the mysql provider/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('creates and reads SQLite snapshot storage', async () => {
  await withTemporaryDataDirectory(async (env) => {
    const connection = await testSqliteDatabase(env);
    assert.equal(connection.ok, true);
    await stat(getSqliteDatabasePath(env));

    const payload = {
      version: 3,
      exportedAt: '2026-07-17T00:00:00.000Z',
      data: { transactions: [] }
    };
    const payloadText = JSON.stringify(payload);
    const saved = await saveSqliteSnapshot(
      {
        userId: 'default',
        schemaVersion: 1,
        payloadText,
        checksum: 'a'.repeat(64),
        payloadBytes: Buffer.byteLength(payloadText),
        source: 'manual',
        exportedAt: payload.exportedAt
      },
      env
    );
    assert.equal(saved.message, 'Snapshot saved to SQLite.');

    const latest = await getLatestSqliteSnapshot('default', env);
    assert.equal(latest.ok, true);
    assert.deepEqual(latest.snapshot?.payload, payload);
  });
});
