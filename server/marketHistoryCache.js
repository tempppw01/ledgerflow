import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getDatabaseSetupStatus, getSqliteDatabasePath } from './databaseProvider.js';
import { migrateRelationalDatabase } from './relationalDatabase.js';
import { withMysqlConnection } from './databaseConnection.js';

export const MARKET_HISTORY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MARKET_HISTORY_CACHE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const migrationPromises = new Map();

function cacheId(cacheKey) {
  return createHash('sha256').update(String(cacheKey)).digest('hex');
}

function cacheDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function databaseDate(value, dialect) {
  return dialect === 'mysql' ? value.replace('T', ' ').replace('Z', '') : value;
}

function parsePayload(value) {
  if (typeof value === 'object' && value !== null) return value;
  try {
    return JSON.parse(String(value || 'null'));
  } catch {
    return null;
  }
}

async function getCacheProvider(env) {
  const setup = await getDatabaseSetupStatus(env);
  if (!setup.initialized || !setup.provider) return null;

  const migrationKey =
    setup.provider === 'sqlite'
      ? `sqlite:${getSqliteDatabasePath(env)}`
      : `mysql:${env.MYSQL_URL || env.MYSQL_HOST || 'default'}`;
  let migration = migrationPromises.get(migrationKey);
  if (!migration) {
    migration = migrateRelationalDatabase(setup.provider, env).catch((error) => {
      migrationPromises.delete(migrationKey);
      throw error;
    });
    migrationPromises.set(migrationKey, migration);
  }
  await migration;
  return setup.provider;
}

async function withCacheDatabase(provider, handler, env) {
  if (provider === 'sqlite') {
    const database = new DatabaseSync(getSqliteDatabasePath(env));
    database.exec('PRAGMA journal_mode = WAL;');
    try {
      return await handler({
        dialect: 'sqlite',
        query: (sql, params = []) => database.prepare(sql).all(...params),
        run: (sql, params = []) => database.prepare(sql).run(...params)
      });
    } finally {
      database.close();
    }
  }

  return withMysqlConnection(
    async (connection) =>
      handler({
        dialect: 'mysql',
        query: async (sql, params = []) => {
          const [rows] = await connection.execute(sql, params);
          return rows;
        },
        run: async (sql, params = []) => {
          const [result] = await connection.execute(sql, params);
          return result;
        }
      }),
    env
  );
}

function normalizeRow(row) {
  if (!row) return null;
  const expiresAt = cacheDate(row.expires_at);
  return {
    payload: parsePayload(row.payload_json),
    fetchedAt: cacheDate(row.fetched_at).toISOString(),
    expiresAt: expiresAt.toISOString(),
    isExpired: expiresAt.getTime() <= Date.now()
  };
}

export async function readMarketHistoryCache(
  cacheKey,
  { allowExpired = false } = {},
  env = process.env
) {
  try {
    const provider = await getCacheProvider(env);
    if (!provider) return null;
    const rows = await withCacheDatabase(
      provider,
      (database) =>
        database.query(
          `SELECT payload_json, fetched_at, expires_at
           FROM market_history_cache
           WHERE cache_key = ?
           LIMIT 1`,
          [cacheId(cacheKey)]
        ),
      env
    );
    const entry = normalizeRow(rows?.[0]);
    if (!entry || (entry.isExpired && !allowExpired) || entry.payload === null) return null;

    // Touching the row makes retention follow actual use rather than only write time.
    await withCacheDatabase(
      provider,
      (database) =>
        database.run(
          `UPDATE market_history_cache SET last_accessed_at = ?, updated_at = ? WHERE cache_key = ?`,
          [
            databaseDate(new Date().toISOString(), database.dialect),
            databaseDate(new Date().toISOString(), database.dialect),
            cacheId(cacheKey)
          ]
        ),
      env
    );
    return entry;
  } catch {
    // Market data must remain available when the optional database is unavailable.
    return null;
  }
}

export async function writeMarketHistoryCache(
  { cacheKey, provider, targetId, rangeStart, rangeEnd, payload },
  env = process.env
) {
  try {
    const databaseProvider = await getCacheProvider(env);
    if (!databaseProvider || payload === undefined) return false;
    const now = new Date();
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + MARKET_HISTORY_CACHE_TTL_MS).toISOString();
    const retentionCutoff = new Date(
      now.getTime() - MARKET_HISTORY_CACHE_RETENTION_MS
    ).toISOString();
    const params = (dialect) => [
      cacheId(cacheKey),
      String(provider || '').slice(0, 24),
      String(targetId || '').slice(0, 64),
      String(rangeStart || '').slice(0, 16),
      String(rangeEnd || '').slice(0, 16),
      JSON.stringify(payload),
      databaseDate(timestamp, dialect),
      databaseDate(expiresAt, dialect),
      databaseDate(timestamp, dialect),
      databaseDate(timestamp, dialect),
      databaseDate(timestamp, dialect)
    ];

    await withCacheDatabase(
      databaseProvider,
      async (database) => {
        await database.run(
          `DELETE FROM market_history_cache WHERE expires_at < ? AND last_accessed_at < ?`,
          [
            databaseDate(timestamp, database.dialect),
            databaseDate(retentionCutoff, database.dialect)
          ]
        );
        if (database.dialect === 'sqlite') {
          await database.run(
            `INSERT INTO market_history_cache
              (cache_key, provider, target_id, range_start, range_end, payload_json, fetched_at, expires_at, last_accessed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(cache_key) DO UPDATE SET
               provider = excluded.provider,
               target_id = excluded.target_id,
               range_start = excluded.range_start,
               range_end = excluded.range_end,
               payload_json = excluded.payload_json,
               fetched_at = excluded.fetched_at,
               expires_at = excluded.expires_at,
               last_accessed_at = excluded.last_accessed_at,
               updated_at = excluded.updated_at`,
            params(database.dialect)
          );
          return;
        }
        await database.run(
          `INSERT INTO market_history_cache
            (cache_key, provider, target_id, range_start, range_end, payload_json, fetched_at, expires_at, last_accessed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             provider = VALUES(provider),
             target_id = VALUES(target_id),
             range_start = VALUES(range_start),
             range_end = VALUES(range_end),
             payload_json = VALUES(payload_json),
             fetched_at = VALUES(fetched_at),
             expires_at = VALUES(expires_at),
             last_accessed_at = VALUES(last_accessed_at),
             updated_at = VALUES(updated_at)`,
          params(database.dialect)
        );
      },
      env
    );
    return true;
  } catch {
    return false;
  }
}
