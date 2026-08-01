import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';
import { pathToFileURL } from 'node:url';
import { withMysqlConnection } from './databaseConnection.js';
import {
  getDatabaseSetupStatus,
  initializeDatabaseProvider
} from './databaseProvider.js';
import {
  getRelationalDatabaseStatus,
  migrateRelationalDatabase
} from './relationalDatabase.js';
import {
  getRelationalBootstrap,
  getRelationalDataStatus,
  replaceRelationalData
} from './relationalDataRepository.js';
import {
  authenticateSession,
  changePassword,
  getAuthStatus,
  getUserSessions,
  loginUser,
  logoutSession,
  registerUser,
  revokeOtherSessions,
  revokeUserSession,
  updateUserProfile
} from './authService.js';

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = Number(process.env.LEDGERFLOW_MAX_BODY_BYTES || 50 * 1024 * 1024);
const API_TOKEN = String(process.env.LEDGERFLOW_API_TOKEN || '').trim();
const WEBDAV_ALLOWED_HOSTS = String(process.env.LEDGERFLOW_WEBDAV_ALLOWED_HOSTS || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const WEBDAV_PROXY_METHODS = new Set(['GET', 'PUT', 'DELETE', 'MKCOL', 'MOVE', 'PROPFIND']);
let sqliteDatabaseModulePromise;
const eastmoneyStockQuoteCache = new Map();

async function getSqliteDatabaseModule() {
  sqliteDatabaseModulePromise ||= import('./sqliteDatabase.js');
  return sqliteDatabaseModulePromise;
}

async function getActiveDatabaseProvider() {
  const setup = await getDatabaseSetupStatus();
  return setup.provider || 'mysql';
}

const SESSION_COOKIE_NAME = 'ledgerflow_session';
const loginFailures = new Map();

function corsHeaders(req) {
  const requestOrigin = String(req.headers.origin || '').trim();
  const allowedOrigins = String(process.env.LEDGERFLOW_CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,MKCOL,MOVE,PROPFIND,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-LedgerFlow-Api-Token, X-WebDAV-Endpoint, Depth, Destination, Overwrite'
  };
  if (!requestOrigin || allowedOrigins.length === 0) return headers;
  if (allowedOrigins.includes('*')) {
    return { ...headers, 'Access-Control-Allow-Origin': '*' };
  }
  if (allowedOrigins.includes(requestOrigin)) {
    return {
      ...headers,
      'Access-Control-Allow-Origin': requestOrigin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin'
    };
  }
  return { ...headers, Vary: 'Origin' };
}

function jsonResponse(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...(res.ledgerflowCorsHeaders || {}),
    ...extraHeaders
  });
  res.end(text);
}

function normalizePath(pathname) {
  return pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
}

function readCookies(req) {
  const source = String(req.headers.cookie || '');
  return Object.fromEntries(
    source
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf('=');
        const key = separator >= 0 ? item.slice(0, separator) : item;
        const value = separator >= 0 ? item.slice(separator + 1) : '';
        try {
          return [key, decodeURIComponent(value)];
        } catch {
          return [key, ''];
        }
      })
  );
}

function readSessionToken(req) {
  return String(readCookies(req)[SESSION_COOKIE_NAME] || '');
}

function secureCookiesEnabled(req) {
  if (process.env.LEDGERFLOW_COOKIE_SECURE === 'true') return true;
  if (process.env.LEDGERFLOW_COOKIE_SECURE === 'false') return false;
  const forwardedProtocol = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwardedProtocol === 'https' || process.env.NODE_ENV === 'production';
}

function sessionCookie(req, token, expiresAt) {
  const expires = new Date(expiresAt);
  const maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expires.toUTCString()}`,
    secureCookiesEnabled(req) ? 'Secure' : ''
  ]
    .filter(Boolean)
    .join('; ');
}

function clearedSessionCookie(req) {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    secureCookiesEnabled(req) ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function loginRateLimitKey(req, email) {
  const forwardedIp = String(req.headers['x-real-ip'] || '').trim();
  const remoteIp = forwardedIp || req.socket.remoteAddress || 'unknown';
  const emailHash = createHash('sha256')
    .update(String(email || '').trim().toLowerCase())
    .digest('hex');
  return `${remoteIp}:${emailHash}`;
}

function loginRateLimit(req, email) {
  const key = loginRateLimitKey(req, email);
  const nowMs = Date.now();
  const maxFailures = 8;
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= nowMs) {
    loginFailures.delete(key);
    return { key, blocked: false, retryAfter: 0 };
  }
  return {
    key,
    blocked: entry.failures >= maxFailures,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000))
  };
}

function recordLoginFailure(key) {
  const nowMs = Date.now();
  if (loginFailures.size >= 10_000 && !loginFailures.has(key)) {
    for (const [storedKey, entry] of loginFailures) {
      if (entry.resetAt <= nowMs) loginFailures.delete(storedKey);
    }
    while (loginFailures.size >= 10_000) {
      const oldestKey = loginFailures.keys().next().value;
      if (!oldestKey) break;
      loginFailures.delete(oldestKey);
    }
  }
  const current = loginFailures.get(key);
  loginFailures.set(key, {
    failures: current && current.resetAt > nowMs ? current.failures + 1 : 1,
    resetAt: current && current.resetAt > nowMs ? current.resetAt : nowMs + 15 * 60 * 1000
  });
}

async function requireUserSession(req, res, provider) {
  const session = await authenticateSession(provider, readSessionToken(req), process.env, {
    userAgent: req.headers['user-agent']
  });
  if (!session) {
    jsonResponse(res, 401, { ok: false, message: '请先登录 LedgerFlow。' });
    return null;
  }
  return session;
}

function normalizeFundCode(value) {
  const code = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(code)) {
    throw new Error('Fund code must contain exactly six digits.');
  }
  return code;
}

function normalizeStockSecIds(value) {
  const secIds = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^[01]\.\d{6}$/.test(item));
  const uniqueSecIds = [...new Set(secIds)].slice(0, 32);

  if (uniqueSecIds.length === 0) {
    throw new Error('Stock secids must contain one or more valid security identifiers.');
  }

  return uniqueSecIds;
}

async function getEastmoneyFundRealtime(code) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers = {
      Referer: `https://fund.eastmoney.com/${code}.html`,
      'User-Agent': 'Mozilla/5.0 LedgerFlow market-data-proxy'
    };
    const [profileResponse, netValueResponse] = await Promise.all([
      fetch(`https://fund.eastmoney.com/pingzhongdata/${code}.js`, {
        headers,
        signal: controller.signal
      }),
      fetch(
        `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1&startDate=&endDate=`,
        { headers, signal: controller.signal }
      )
    ]);

    if (!profileResponse.ok || !netValueResponse.ok) {
      throw new Error('Eastmoney fund endpoint is unavailable.');
    }

    const [profileScript, netValuePayload] = await Promise.all([
      profileResponse.text(),
      netValueResponse.json()
    ]);
    const readProfileString = (key) => {
      const match = profileScript.match(new RegExp(`var\\s+${key}\\s*=\\s*"([^"]*)"`));
      return match?.[1]?.trim() || '';
    };
    const netValue = netValuePayload?.Data?.LSJZList?.[0];
    const name = readProfileString('fS_name');
    if (!name || !netValue) {
      throw new Error('Eastmoney fund response format is invalid.');
    }

    return {
      fundcode: readProfileString('fS_code') || code,
      name,
      jzrq: String(netValue.FSRQ || ''),
      dwjz: String(netValue.DWJZ || ''),
      gsz: String(netValue.DWJZ || ''),
      gszzl: String(netValue.JZZZL || ''),
      gztime: String(netValue.FSRQ || '')
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getTencentStockSymbol(secId) {
  const [market, code] = secId.split('.');
  if (!code) return '';
  if (market === '1') return `sh${code}`;
  return /^(4|8|9)/.test(code) ? `bj${code}` : `sz${code}`;
}

async function getTencentStockQuotes(secIds) {
  const symbols = secIds.map(getTencentStockSymbol).filter(Boolean);
  if (symbols.length === 0) return [];

  const response = await fetch(`https://qt.gtimg.cn/q=${encodeURIComponent(symbols.join(','))}`, {
    headers: {
      Referer: 'https://gu.qq.com/',
      'User-Agent': 'Mozilla/5.0 LedgerFlow market-data-proxy'
    }
  });
  if (!response.ok) {
    throw new Error('Tencent stock quote endpoint is unavailable.');
  }

  const body = await response.text();
  return body
    .split(';')
    .map((line) => {
      const match = String(line || '').trim().match(/^v_([^=]+)="([\s\S]*)"$/);
      if (!match?.[2]) return null;
      const fields = match[2].split('~');
      const code = String(fields[2] || '').trim();
      const name = String(fields[1] || '').trim();
      const changePercent = Number(fields[32]);
      const secId = secIds.find((item) => item.endsWith(`.${code}`)) || '';
      if (!code || !secId) return null;

      return {
        secId,
        code,
        name: name || code,
        changePercent: Number.isFinite(changePercent) ? changePercent : null
      };
    })
    .filter(Boolean);
}

async function getEastmoneyStockQuotes(secIds) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${encodeURIComponent(
        secIds.join(',')
      )}&fields=f12,f13,f14,f3&fltt=2&invt=2`,
      {
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 LedgerFlow market-data-proxy'
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error('Eastmoney stock quote endpoint is unavailable.');
    }

    const payload = await response.json();
    const quotes = (payload?.data?.diff || []).map((item) => {
      const code = String(item?.f12 || '').trim();
      const market = String(item?.f13 ?? '').trim();
      const value = Number(item?.f3);
      return {
        secId: market && code ? `${market}.${code}` : '',
        code,
        name: String(item?.f14 || '').trim() || code,
        changePercent: Number.isFinite(value) ? value : null
      };
    });
    quotes.forEach((quote) => {
      if (quote.secId) eastmoneyStockQuoteCache.set(quote.secId, quote);
    });
    return quotes;
  } catch (error) {
    try {
      const fallbackQuotes = await getTencentStockQuotes(secIds);
      if (fallbackQuotes.length > 0) {
        fallbackQuotes.forEach((quote) => eastmoneyStockQuoteCache.set(quote.secId, quote));
        return fallbackQuotes;
      }
    } catch {
      // The cache below is the final recovery path for a temporary upstream outage.
    }

    const cachedQuotes = secIds.flatMap((secId) => {
      const quote = eastmoneyStockQuoteCache.get(secId);
      return quote ? [quote] : [];
    });
    if (cachedQuotes.length > 0) return cachedQuotes;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readRequestToken(req) {
  const explicitToken = req.headers['x-ledgerflow-api-token'];
  if (Array.isArray(explicitToken)) {
    return explicitToken[0] || '';
  }
  if (typeof explicitToken === 'string' && explicitToken.trim()) {
    return explicitToken.trim();
  }

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function safeTokenEquals(received, expected) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function requireApiToken(req, res) {
  if (!API_TOKEN) {
    jsonResponse(res, 503, {
      ok: false,
      message: 'MySQL snapshot API token is not configured.'
    });
    return false;
  }

  if (!safeTokenEquals(readRequestToken(req), API_TOKEN)) {
    jsonResponse(res, 401, {
      ok: false,
      message: 'Invalid MySQL snapshot API token.'
    });
    return false;
  }

  return true;
}

function ipv4ToInt(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((item) => Number(item));
  if (nums.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return null;
  }
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

function isPrivateIpv4(address) {
  const value = ipv4ToInt(address);
  if (value === null) return false;
  return [
    [0x00000000, 0x00ffffff],
    [0x0a000000, 0x0affffff],
    [0x64400000, 0x647fffff],
    [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff],
    [0xac100000, 0xac1fffff],
    [0xc0000000, 0xc00000ff],
    [0xc0000200, 0xc00002ff],
    [0xc0a80000, 0xc0a8ffff],
    [0xc6336400, 0xc63364ff],
    [0xcb007100, 0xcb0071ff],
    [0xe0000000, 0xffffffff]
  ].some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(address) {
  const lower = address.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80:') ||
    lower.startsWith('ff') ||
    lower.startsWith('2001:db8')
  );
}

function isBlockedNetworkAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

async function assertPublicHttpsUrl(value, label = 'WebDAV endpoint') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain credentials.`);
  }
  if (parsed.search) {
    throw new Error(`${label} must not contain query parameters.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    (WEBDAV_ALLOWED_HOSTS.length > 0 && !WEBDAV_ALLOWED_HOSTS.includes(hostname))
  ) {
    throw new Error(`${label} host is not allowed.`);
  }

  const directIpFamily = net.isIP(hostname);
  if (directIpFamily && isBlockedNetworkAddress(hostname)) {
    throw new Error(`${label} must not point to a private or local address.`);
  }

  if (!directIpFamily) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0 || records.some((record) => isBlockedNetworkAddress(record.address))) {
      throw new Error(`${label} must resolve to public addresses only.`);
    }
  }

  parsed.hash = '';
  return parsed;
}

function assertSafeRemotePath(encodedRemotePath) {
  if (!encodedRemotePath) return;
  const segments = encodedRemotePath.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new Error('WebDAV path contains invalid encoding.');
    }
  });

  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('WebDAV path must not contain empty, . or .. segments.');
  }
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

async function readRawBody(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error(`Request body is too large. Limit is ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
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

async function testConnection() {
  const start = Date.now();

  return withMysqlConnection(async (connection) => {
    await connection.query('SELECT 1 AS ok');
    return {
      ok: true,
      message: 'MySQL connection is available.',
      detail: `SELECT 1 completed in ${Date.now() - start}ms`
    };
  });
}

async function testActiveDatabaseConnection() {
  if ((await getActiveDatabaseProvider()) === 'sqlite') {
    const { testSqliteDatabase } = await getSqliteDatabaseModule();
    return testSqliteDatabase();
  }
  return testConnection();
}

async function validateDatabaseProvider(provider) {
  if (provider === 'mysql') {
    await testConnection();
    await migrateRelationalDatabase('mysql');
    return;
  }

  const { ensureSqliteDatabase } = await getSqliteDatabaseModule();
  await ensureSqliteDatabase();
  await migrateRelationalDatabase('sqlite');
}

async function saveSnapshot(body, userId) {
  if (!body || typeof body !== 'object' || !body.payload) {
    throw new Error('Missing snapshot payload.');
  }

  const payloadText = JSON.stringify(body.payload);
  const checksum = sha256(payloadText);
  if (body.checksum && body.checksum !== checksum) {
    throw new Error('Snapshot checksum mismatch.');
  }

  const payloadBytes = Buffer.byteLength(payloadText);
  const schemaVersion = Number(body.schemaVersion || 1);
  const source = String(body.source || 'manual').slice(0, 32);
  const exportedAt = parseDateOrNull(body.payload.exportedAt);

  if ((await getActiveDatabaseProvider()) === 'sqlite') {
    const { saveSqliteSnapshot } = await getSqliteDatabaseModule();
    return saveSqliteSnapshot({
      userId,
      schemaVersion,
      payloadText,
      checksum,
      payloadBytes,
      source,
      exportedAt: body.payload.exportedAt || null
    });
  }

  return withMysqlConnection(async (connection) => {
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
  const payload =
    typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
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

async function getLatestSnapshot(userId) {
  if ((await getActiveDatabaseProvider()) === 'sqlite') {
    const { getLatestSqliteSnapshot } = await getSqliteDatabaseModule();
    return getLatestSqliteSnapshot(userId);
  }

  return withMysqlConnection(async (connection) => {
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

function getHeaderValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function copyHeaderIfPresent(req, target, reqName, upstreamName = reqName) {
  const value = getHeaderValue(req, reqName);
  if (value) {
    target[upstreamName] = value;
  }
}

async function proxyWebdavRequest(req, res, url, pathname) {
  if (!WEBDAV_PROXY_METHODS.has(req.method || '')) {
    jsonResponse(res, 405, { ok: false, message: 'WebDAV proxy method is not allowed.' });
    return;
  }

  const endpointHeader = getHeaderValue(req, 'x-webdav-endpoint');
  const endpoint = await assertPublicHttpsUrl(endpointHeader, 'WebDAV endpoint');
  const pathPrefix = '/webdav/';
  const encodedRemotePath = pathname.startsWith(pathPrefix)
    ? pathname.slice(pathPrefix.length)
    : '';
  assertSafeRemotePath(encodedRemotePath);
  const target = new URL(endpoint.toString().replace(/\/+$/, '/') + encodedRemotePath);
  target.search = url.search;

  const upstreamHeaders = {};
  copyHeaderIfPresent(req, upstreamHeaders, 'authorization', 'Authorization');
  copyHeaderIfPresent(req, upstreamHeaders, 'depth', 'Depth');
  copyHeaderIfPresent(req, upstreamHeaders, 'overwrite', 'Overwrite');
  copyHeaderIfPresent(req, upstreamHeaders, 'content-type', 'Content-Type');

  const destination = getHeaderValue(req, 'destination');
  if (destination) {
    const destinationUrl = await assertPublicHttpsUrl(destination, 'WebDAV destination');
    const endpointBase = endpoint.toString().replace(/\/+$/, '/');
    if (
      destinationUrl.origin !== endpoint.origin ||
      !destinationUrl.toString().startsWith(endpointBase)
    ) {
      throw new Error('WebDAV destination must stay under the configured endpoint.');
    }
    upstreamHeaders.Destination = destinationUrl.toString();
  }

  const body = ['GET', 'HEAD'].includes(req.method || '') ? undefined : await readRawBody(req);
  const upstream = await fetch(target, {
    method: req.method,
    headers: upstreamHeaders,
    body: body && body.length > 0 ? body : undefined
  });

  const responseHeaders = {
    'Access-Control-Allow-Origin': process.env.LEDGERFLOW_CORS_ORIGIN || '*'
  };
  ['content-type', 'etag', 'last-modified', 'location'].forEach((header) => {
    const value = upstream.headers.get(header);
    if (value) responseHeaders[header] = value;
  });

  const responseBody = Buffer.from(await upstream.arrayBuffer());
  responseHeaders['Content-Length'] = responseBody.length;
  res.writeHead(upstream.status, responseHeaders);
  res.end(responseBody);
}

function statusForError(error) {
  const message = error instanceof Error ? error.message : '';
  if (/邮箱或密码不正确|当前密码不正确/.test(message)) return 401;
  if (/未开放新账号注册/.test(message)) return 403;
  if (/该邮箱无法注册/.test(message)) return 409;
  if (/请输入有效|至少需要|不能超过/.test(message)) return 400;
  return 500;
}

export async function handleRequest(req, res) {
  res.ledgerflowCorsHeaders = corsHeaders(req);
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

    if (req.method === 'GET' && pathname === '/setup/status') {
      const setup = await getDatabaseSetupStatus();
      const schema = setup.initialized
        ? await migrateRelationalDatabase(setup.provider)
        : null;
      jsonResponse(res, 200, { ok: true, ...setup, schema });
      return;
    }

    if (req.method === 'GET' && pathname === '/market/fund-realtime') {
      const code = normalizeFundCode(url.searchParams.get('code'));
      jsonResponse(res, 200, { ok: true, data: await getEastmoneyFundRealtime(code) });
      return;
    }

    if (req.method === 'GET' && pathname === '/market/stock-quotes') {
      const secIds = normalizeStockSecIds(url.searchParams.get('secids'));
      jsonResponse(res, 200, { ok: true, data: { quotes: await getEastmoneyStockQuotes(secIds) } });
      return;
    }

    if (req.method === 'POST' && pathname === '/setup/initialize') {
      const currentSetup = await getDatabaseSetupStatus();
      if (currentSetup.initialized && !requireApiToken(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const initialization = await initializeDatabaseProvider({
        provider: body.provider,
        validateProvider: validateDatabaseProvider
      });
      const setup = await getDatabaseSetupStatus();
      jsonResponse(res, 200, { ok: true, ...setup, created: initialization.created });
      return;
    }

    if (
      pathname === '/auth/status' ||
      pathname === '/auth/me' ||
      pathname === '/auth/register' ||
      pathname === '/auth/login' ||
      pathname === '/auth/logout' ||
      pathname === '/auth/profile' ||
      pathname === '/auth/change-password' ||
      pathname === '/auth/revoke-sessions' ||
      pathname === '/auth/sessions' ||
      pathname.startsWith('/auth/sessions/')
    ) {
      const setup = await getDatabaseSetupStatus();
      if (!setup.initialized || setup.configurationMismatch) {
        jsonResponse(res, 409, { ok: false, message: '请先完成数据库初始化。' });
        return;
      }
      await migrateRelationalDatabase(setup.provider);
      const provider = setup.provider;

      if (req.method === 'GET' && pathname === '/auth/status') {
        jsonResponse(res, 200, {
          ok: true,
          ...(await getAuthStatus(provider, readSessionToken(req), process.env, {
            userAgent: req.headers['user-agent']
          }))
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/auth/me') {
        const session = await requireUserSession(req, res, provider);
        if (!session) return;
        jsonResponse(res, 200, { ok: true, user: session.user });
        return;
      }

      if (req.method === 'POST' && pathname === '/auth/register') {
        const result = await registerUser(provider, await readJsonBody(req), process.env, {
          userAgent: req.headers['user-agent']
        });
        jsonResponse(res, 200, { ok: true, user: result.user, claimedLegacyData: result.claimedLegacyData }, {
          'Set-Cookie': sessionCookie(req, result.session.token, result.session.expiresAt)
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/auth/login') {
        const body = await readJsonBody(req);
        const limit = loginRateLimit(req, body?.email);
        if (limit.blocked) {
          jsonResponse(
            res,
            429,
            { ok: false, message: '登录尝试过于频繁，请稍后再试。' },
            { 'Retry-After': String(limit.retryAfter) }
          );
          return;
        }
        try {
          const result = await loginUser(provider, body, process.env, {
            userAgent: req.headers['user-agent']
          });
          loginFailures.delete(limit.key);
          jsonResponse(res, 200, { ok: true, user: result.user }, {
            'Set-Cookie': sessionCookie(req, result.session.token, result.session.expiresAt)
          });
        } catch (error) {
          recordLoginFailure(limit.key);
          throw error;
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/auth/logout') {
        await logoutSession(provider, readSessionToken(req));
        jsonResponse(res, 200, { ok: true }, { 'Set-Cookie': clearedSessionCookie(req) });
        return;
      }

      const session = await requireUserSession(req, res, provider);
      if (!session) return;

      if (req.method === 'GET' && pathname === '/auth/sessions') {
        jsonResponse(res, 200, await getUserSessions(provider, session));
        return;
      }

      const revokeSessionMatch = pathname.match(/^\/auth\/sessions\/([^/]+)\/revoke$/);
      if (req.method === 'POST' && revokeSessionMatch) {
        jsonResponse(res, 200, await revokeUserSession(provider, session, revokeSessionMatch[1]));
        return;
      }

      if (req.method === 'POST' && pathname === '/auth/profile') {
        jsonResponse(res, 200, await updateUserProfile(provider, session, await readJsonBody(req)));
        return;
      }

      if (req.method === 'POST' && pathname === '/auth/change-password') {
        jsonResponse(res, 200, await changePassword(provider, session, await readJsonBody(req)));
        return;
      }

      if (req.method === 'POST' && pathname === '/auth/revoke-sessions') {
        jsonResponse(res, 200, await revokeOtherSessions(provider, session));
        return;
      }

      jsonResponse(res, 405, { ok: false, message: 'Auth method is not allowed.' });
      return;
    }

    // SQL is the application's source of truth. Business data requires a user
    // session; the service API token remains reserved for infrastructure routes.
    if (req.method === 'GET' && pathname === '/data/bootstrap') {
      const setup = await getDatabaseSetupStatus();
      if (!setup.initialized || setup.configurationMismatch) {
        jsonResponse(res, 409, { ok: false, message: 'Database provider has not been initialized.' });
        return;
      }
      await migrateRelationalDatabase(setup.provider);
      const session = await requireUserSession(req, res, setup.provider);
      if (!session) return;
      jsonResponse(res, 200, await getRelationalBootstrap(setup.provider, process.env, session.user.ledgerUserId));
      return;
    }

    if (req.method === 'GET' && pathname === '/data/status') {
      const setup = await getDatabaseSetupStatus();
      if (!setup.initialized || setup.configurationMismatch) {
        jsonResponse(res, 409, { ok: false, message: 'Database provider has not been initialized.' });
        return;
      }
      await migrateRelationalDatabase(setup.provider);
      const session = await requireUserSession(req, res, setup.provider);
      if (!session) return;
      jsonResponse(res, 200, await getRelationalDataStatus(setup.provider, process.env, session.user.ledgerUserId));
      return;
    }

    if ((req.method === 'PUT' || req.method === 'POST') && pathname === '/data/import') {
      const setup = await getDatabaseSetupStatus();
      if (!setup.initialized || setup.configurationMismatch) {
        jsonResponse(res, 409, { ok: false, message: 'Database provider has not been initialized.' });
        return;
      }
      await migrateRelationalDatabase(setup.provider);
      const session = await requireUserSession(req, res, setup.provider);
      if (!session) return;
      jsonResponse(
        res,
        200,
        await replaceRelationalData(
          setup.provider,
          await readJsonBody(req),
          process.env,
          session.user.ledgerUserId
        )
      );
      return;
    }

    if (
      (req.method === 'POST' || req.method === 'PUT') &&
      ['/snapshots', '/snapshots/upload', '/mysql/snapshots', '/mysql/snapshots/upload'].includes(
        pathname
      )
    ) {
      const provider = await getActiveDatabaseProvider();
      const session = await requireUserSession(req, res, provider);
      if (!session) return;
      jsonResponse(res, 200, await saveSnapshot(await readJsonBody(req), session.user.ledgerUserId));
      return;
    }

    if (
      req.method === 'GET' &&
      ['/snapshots/latest', '/mysql/snapshots/latest'].includes(pathname)
    ) {
      const provider = await getActiveDatabaseProvider();
      const session = await requireUserSession(req, res, provider);
      if (!session) return;
      jsonResponse(res, 200, await getLatestSnapshot(session.user.ledgerUserId));
      return;
    }

    if (!requireApiToken(req, res)) {
      return;
    }

    if (req.method === 'GET' && pathname === '/database/schema-status') {
      const provider = await getActiveDatabaseProvider();
      jsonResponse(res, 200, {
        ok: true,
        ...(await getRelationalDatabaseStatus(provider))
      });
      return;
    }

    if (pathname === '/webdav' || pathname.startsWith('/webdav/')) {
      await proxyWebdavRequest(req, res, url, pathname);
      return;
    }

    if (
      (req.method === 'POST' || req.method === 'PUT') &&
      ['/conn/test', '/connection/test', '/db/connection/test'].includes(pathname)
    ) {
      jsonResponse(res, 200, await testActiveDatabaseConnection());
      return;
    }

    jsonResponse(res, 404, { ok: false, message: 'Route not found.' });
  } catch (error) {
    jsonResponse(res, statusForError(error), {
      ok: false,
      message: error instanceof Error ? error.message : 'Unexpected server error.'
    });
  }
}

export function createLedgerFlowServer() {
  return http.createServer(handleRequest);
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) {
  const port = Number(process.env.PORT || process.env.LEDGERFLOW_API_PORT || DEFAULT_PORT);
  createLedgerFlowServer().listen(port, () => {
    console.log(`LedgerFlow API listening on http://127.0.0.1:${port}`);
  });
}
