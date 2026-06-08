import http from 'node:http';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import mysql from 'mysql2/promise';

const DEFAULT_PORT = 8787;
const DEFAULT_USER_ID = 'default';
const MAX_BODY_BYTES = Number(process.env.LEDGERFLOW_MAX_BODY_BYTES || 50 * 1024 * 1024);

function jsonResponse(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': process.env.LEDGERFLOW_CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(text);
}

function normalizePath(pathname) {
  return pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function getEnvConnectionOptions() {
  if (process.env.MYSQL_URL) {
    return process.env.MYSQL_URL;
  }

  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'ledgerflow',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'ledgerflow',
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 8000),
    ssl:
      process.env.MYSQL_SSL === 'true'
        ? { rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined
  };
}

function getConfigConnectionOptions(config) {
  if (!config || config.type !== 'mysql') {
    throw new Error('Only MySQL connection tests are supported by this server.');
  }

  if (typeof config.connectionString === 'string' && config.connectionString.trim()) {
    return config.connectionString.trim();
  }

  return {
    host: config.host || '127.0.0.1',
    port: Number(config.port || 3306),
    user: config.username || undefined,
    password: config.password || undefined,
    database: config.database || undefined,
    connectTimeout: Number(config.timeoutMs || 8000),
    ssl: config.tls?.enabled
      ? {
          rejectUnauthorized: config.tls.rejectUnauthorized !== false,
          ca: config.tls.caCert || undefined
        }
      : undefined
  };
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error(`Request body is too large. Limit is ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

async function withConnection(options, handler) {
  const connection = await mysql.createConnection(options);
  try {
    return await handler(connection);
  } finally {
    await connection.end();
  }
}

async function ensureSnapshotTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS ledger_snapshots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id VARCHAR(128) NOT NULL,
      schema_version INT NOT NULL,
      payload_json JSON NOT NULL,
      checksum CHAR(64) NOT NULL,
      payload_bytes INT UNSIGNED NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'manual',
      exported_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uniq_ledger_snapshots_user_checksum (user_id, checksum),
      KEY idx_ledger_snapshots_user_created (user_id, created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function parseDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function testConnection(body) {
  const options = body?.config ? getConfigConnectionOptions(body.config) : getEnvConnectionOptions();
  const start = Date.now();

  return withConnection(options, async (connection) => {
    await connection.query('SELECT 1 AS ok');
    return {
      ok: true,
      message: 'MySQL connection is available.',
      detail: `SELECT 1 completed in ${Date.now() - start}ms`
    };
  });
}

async function saveSnapshot(body) {
  if (!body || typeof body !== 'object' || !body.payload) {
    throw new Error('Missing snapshot payload.');
  }

  const payloadText = JSON.stringify(body.payload);
  const checksum = sha256(payloadText);
  if (body.checksum && body.checksum !== checksum) {
    throw new Error('Snapshot checksum mismatch.');
  }

  const payloadBytes = Buffer.byteLength(payloadText);
  const userId = String(body.userId || DEFAULT_USER_ID).slice(0, 128);
  const schemaVersion = Number(body.schemaVersion || 1);
  const source = String(body.source || 'manual').slice(0, 32);
  const exportedAt = parseDateOrNull(body.payload.exportedAt);

  return withConnection(getEnvConnectionOptions(), async (connection) => {
    await ensureSnapshotTable(connection);
    const [result] = await connection.execute(
      `
        INSERT INTO ledger_snapshots
          (user_id, schema_version, payload_json, checksum, payload_bytes, source, exported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
      `,
      [userId, schemaVersion, payloadText, checksum, payloadBytes, source, exportedAt]
    );

    return {
      ok: true,
      id: Number(result.insertId || 0),
      userId,
      schemaVersion,
      checksum,
      payloadBytes,
      exportedAt: body.payload.exportedAt || null,
      message: 'Snapshot saved to MySQL.'
    };
  });
}

function normalizeSnapshotRow(row) {
  const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
  return {
    id: Number(row.id),
    userId: row.user_id,
    schemaVersion: Number(row.schema_version),
    payload,
    checksum: row.checksum,
    payloadBytes: Number(row.payload_bytes),
    source: row.source,
    exportedAt: row.exported_at ? new Date(row.exported_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

async function getLatestSnapshot(url) {
  const userId = String(url.searchParams.get('userId') || DEFAULT_USER_ID).slice(0, 128);

  return withConnection(getEnvConnectionOptions(), async (connection) => {
    await ensureSnapshotTable(connection);
    const [rows] = await connection.execute(
      `
        SELECT id, user_id, schema_version, payload_json, checksum, payload_bytes, source, exported_at, created_at
        FROM ledger_snapshots
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [userId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        ok: false,
        message: 'No MySQL snapshot found for this user.',
        snapshot: null
      };
    }

    const snapshot = normalizeSnapshotRow(rows[0]);
    return {
      ok: true,
      message: 'Latest MySQL snapshot loaded.',
      snapshot
    };
  });
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 204, {});
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = normalizePath(url.pathname);

  try {
    if (req.method === 'GET' && pathname === '/health') {
      jsonResponse(res, 200, { ok: true, service: 'ledgerflow-mysql-snapshot' });
      return;
    }

    if (
      (req.method === 'POST' || req.method === 'PUT') &&
      ['/conn/test', '/connection/test', '/db/connection/test'].includes(pathname)
    ) {
      jsonResponse(res, 200, await testConnection(await readJsonBody(req)));
      return;
    }

    if (
      (req.method === 'POST' || req.method === 'PUT') &&
      ['/snapshots', '/snapshots/upload', '/mysql/snapshots', '/mysql/snapshots/upload'].includes(
        pathname
      )
    ) {
      jsonResponse(res, 200, await saveSnapshot(await readJsonBody(req)));
      return;
    }

    if (
      req.method === 'GET' &&
      ['/snapshots/latest', '/mysql/snapshots/latest'].includes(pathname)
    ) {
      jsonResponse(res, 200, await getLatestSnapshot(url));
      return;
    }

    jsonResponse(res, 404, { ok: false, message: 'Route not found.' });
  } catch (error) {
    jsonResponse(res, 500, {
      ok: false,
      message: error instanceof Error ? error.message : 'Unexpected server error.'
    });
  }
}

const port = Number(process.env.PORT || process.env.LEDGERFLOW_API_PORT || DEFAULT_PORT);

http.createServer(handleRequest).listen(port, () => {
  console.log(`LedgerFlow MySQL snapshot API listening on http://127.0.0.1:${port}`);
});
