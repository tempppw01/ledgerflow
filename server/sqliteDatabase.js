import { mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { getDatabaseDataDirectory, getSqliteDatabasePath } from './databaseProvider.js';

function openDatabase(env = process.env) {
  return new DatabaseSync(getSqliteDatabasePath(env));
}

function ensureSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS ledgerflow_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      checksum TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      exported_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, checksum)
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_snapshots_user_created
      ON ledger_snapshots(user_id, created_at DESC, id DESC);
  `);
}

function writeMetadata(database, key, value) {
  database
    .prepare(
      `
      INSERT INTO ledgerflow_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `
    )
    .run(key, value, new Date().toISOString());
}

function parsePayload(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export async function ensureSqliteDatabase(env = process.env) {
  await mkdir(getDatabaseDataDirectory(env), { recursive: true });
  const database = openDatabase(env);
  try {
    ensureSchema(database);
    writeMetadata(database, 'storage_provider', 'sqlite');
    return { path: getSqliteDatabasePath(env) };
  } finally {
    database.close();
  }
}

export async function testSqliteDatabase(env = process.env) {
  const start = Date.now();
  const { path } = await ensureSqliteDatabase(env);
  const database = openDatabase(env);
  try {
    database.prepare('SELECT 1 AS ok').get();
    return {
      ok: true,
      message: 'SQLite connection is available.',
      detail: `SQLite database ${path} is ready in ${Date.now() - start}ms`
    };
  } finally {
    database.close();
  }
}

export async function saveSqliteSnapshot(input, env = process.env) {
  await ensureSqliteDatabase(env);
  const database = openDatabase(env);
  try {
    ensureSchema(database);
    database
      .prepare(
        `
        INSERT OR IGNORE INTO ledger_snapshots
          (user_id, schema_version, payload_json, checksum, payload_bytes, source, exported_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.userId,
        input.schemaVersion,
        input.payloadText,
        input.checksum,
        input.payloadBytes,
        input.source,
        input.exportedAt,
        new Date().toISOString()
      );

    const row = database
      .prepare('SELECT id FROM ledger_snapshots WHERE user_id = ? AND checksum = ? LIMIT 1')
      .get(input.userId, input.checksum);

    return {
      ok: true,
      id: Number(row.id),
      userId: input.userId,
      schemaVersion: input.schemaVersion,
      checksum: input.checksum,
      payloadBytes: input.payloadBytes,
      exportedAt: input.exportedAt,
      message: 'Snapshot saved to SQLite.'
    };
  } finally {
    database.close();
  }
}

export async function getLatestSqliteSnapshot(userId, env = process.env) {
  await ensureSqliteDatabase(env);
  const database = openDatabase(env);
  try {
    const row = database
      .prepare(
        `
        SELECT id, user_id, schema_version, payload_json, checksum, payload_bytes, source, exported_at, created_at
        FROM ledger_snapshots
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
      )
      .get(userId);

    if (!row) {
      return {
        ok: false,
        message: 'No SQLite snapshot found for this user.',
        snapshot: null
      };
    }

    return {
      ok: true,
      message: 'Latest SQLite snapshot loaded.',
      snapshot: {
        id: Number(row.id),
        userId: row.user_id,
        schemaVersion: Number(row.schema_version),
        payload: parsePayload(row.payload_json),
        checksum: row.checksum,
        payloadBytes: Number(row.payload_bytes),
        source: row.source,
        exportedAt: row.exported_at || null,
        createdAt: row.created_at || null
      }
    };
  } finally {
    database.close();
  }
}
