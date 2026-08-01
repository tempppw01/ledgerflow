import { DatabaseSync } from 'node:sqlite';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual
} from 'node:crypto';
import { getSqliteDatabasePath } from './databaseProvider.js';
import { withMysqlConnection } from './databaseConnection.js';

const DEFAULT_LEDGER_USER_ID = 'default';
const SESSION_LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$hqRyMfmgQumKSccMCzv9xg$JB5-EWa-z2Z1FImUDvQvZbJmkxDlj2ar8e_Jg9VHIsp2bRc9B2VTAYcwZo3QvLraEpc59BacSG8yGmyaJhWnNA';

function now() {
  return new Date().toISOString();
}

function toMysqlDate(value) {
  return new Date(value).toISOString().replace('T', ' ').replace('Z', '');
}

function fromDbDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const source = String(value);
  const parsed = new Date(source.includes('T') ? source : `${source.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? source : parsed.toISOString();
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('请输入有效的邮箱地址。');
  }
  return email;
}

function normalizeDisplayName(value, email) {
  const displayName = String(value || '').trim().slice(0, 80);
  return displayName || email.split('@')[0] || 'LedgerFlow 用户';
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 10) throw new Error('密码至少需要 10 个字符。');
  if (value.length > 200) throw new Error('密码不能超过 200 个字符。');
  return value;
}

export async function hashPassword(password) {
  const value = validatePassword(password);
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(value, salt);
  return [
    'scrypt',
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString('base64url'),
    derivedKey.toString('base64url')
  ].join('$');
}

export async function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;

  const derivedKey = await new Promise((resolve, reject) => {
    scrypt(
      String(password || ''),
      salt,
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: SCRYPT_OPTIONS.maxmem
      },
      (error, value) => {
        if (error) reject(error);
        else resolve(value);
      }
    );
  });
  return derivedKey.length === expected.length && timingSafeEqual(derivedKey, expected);
}

function sessionDurationMs(env) {
  const days = Number(env.LEDGERFLOW_SESSION_DAYS || 30);
  const safeDays = Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 30;
  return safeDays * 24 * 60 * 60 * 1000;
}

function registrationMode(env) {
  const mode = String(env.LEDGERFLOW_REGISTRATION_MODE || 'first-user').trim().toLowerCase();
  return ['open', 'closed', 'first-user'].includes(mode) ? mode : 'first-user';
}

async function withAuthDatabase(provider, handler, env = process.env) {
  if (provider === 'sqlite') {
    const database = new DatabaseSync(getSqliteDatabasePath(env));
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    try {
      return await handler({
        dialect: 'sqlite',
        query: async (sql, params = []) => database.prepare(sql).all(...params),
        get: async (sql, params = []) => database.prepare(sql).get(...params),
        run: async (sql, params = []) => database.prepare(sql).run(...params),
        begin: async () => database.exec('BEGIN IMMEDIATE'),
        commit: async () => database.exec('COMMIT'),
        rollback: async () => database.exec('ROLLBACK'),
        date: (value) => new Date(value).toISOString()
      });
    } finally {
      database.close();
    }
  }

  if (provider !== 'mysql') throw new Error(`Unsupported authentication provider: ${provider}.`);
  return withMysqlConnection(async (connection) =>
    handler({
      dialect: 'mysql',
      query: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      get: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return Array.isArray(rows) ? rows[0] : undefined;
      },
      run: async (sql, params = []) => {
        const [result] = await connection.execute(sql, params);
        return result;
      },
      begin: async () => connection.beginTransaction(),
      commit: async () => connection.commit(),
      rollback: async () => connection.rollback(),
      date: toMysqlDate
    }), env);
}

function publicUser(row) {
  return {
    id: row.id,
    ledgerUserId: row.ledger_user_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    createdAt: fromDbDate(row.created_at),
    lastLoginAt: fromDbDate(row.last_login_at)
  };
}

function hashSessionToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

async function createSession(database, userId, env) {
  const token = randomBytes(32).toString('base64url');
  const createdAt = now();
  const expiresAt = new Date(Date.now() + sessionDurationMs(env)).toISOString();
  await database.run(
    `INSERT INTO auth_sessions
       (id, user_id, token_hash, expires_at, last_seen_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      userId,
      hashSessionToken(token),
      database.date(expiresAt),
      database.date(createdAt),
      null,
      database.date(createdAt)
    ]
  );
  return { token, expiresAt };
}

export async function getAuthStatus(provider, token = '', env = process.env) {
  const session = token ? await authenticateSession(provider, token, env) : null;
  const accountCount = await withAuthDatabase(provider, async (database) => {
    const row = await database.get('SELECT COUNT(*) AS count FROM auth_users');
    return Number(row?.count || 0);
  }, env);
  const mode = registrationMode(env);
  return {
    authenticated: Boolean(session),
    registrationOpen: mode === 'open' || (mode === 'first-user' && accountCount === 0),
    user: session?.user || null
  };
}

export async function registerUser(provider, input, env = process.env) {
  const email = normalizeEmail(input?.email);
  const passwordHash = await hashPassword(input?.password);
  const displayName = normalizeDisplayName(input?.displayName, email);

  return withAuthDatabase(provider, async (database) => {
    await database.begin();
    try {
      const countRow = await database.get('SELECT COUNT(*) AS count FROM auth_users');
      const accountCount = Number(countRow?.count || 0);
      const mode = registrationMode(env);
      if (mode === 'closed' || (mode === 'first-user' && accountCount > 0)) {
        throw new Error('当前部署未开放新账号注册。');
      }
      const existing = await database.get('SELECT id FROM auth_users WHERE email = ?', [email]);
      if (existing) throw new Error('该邮箱无法注册。');

      const timestamp = now();
      let ledgerUserId = accountCount === 0 ? DEFAULT_LEDGER_USER_ID : randomUUID();
      const ledgerUser = await database.get('SELECT id FROM ledger_users WHERE id = ?', [ledgerUserId]);
      if (!ledgerUser) {
        await database.run(
          'INSERT INTO ledger_users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [ledgerUserId, displayName, database.date(timestamp), database.date(timestamp)]
        );
      } else {
        await database.run(
          'UPDATE ledger_users SET display_name = ?, updated_at = ? WHERE id = ?',
          [displayName, database.date(timestamp), ledgerUserId]
        );
      }

      const authUserId = randomUUID();
      await database.run(
        `INSERT INTO auth_users
           (id, ledger_user_id, email, password_hash, display_name, status, password_updated_at, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          authUserId,
          ledgerUserId,
          email,
          passwordHash,
          displayName,
          'active',
          database.date(timestamp),
          database.date(timestamp),
          database.date(timestamp),
          database.date(timestamp)
        ]
      );
      const session = await createSession(database, authUserId, env);
      await database.commit();
      return {
        user: {
          id: authUserId,
          ledgerUserId,
          email,
          displayName,
          status: 'active',
          createdAt: timestamp,
          lastLoginAt: timestamp
        },
        session,
        claimedLegacyData: ledgerUserId === DEFAULT_LEDGER_USER_ID
      };
    } catch (error) {
      await database.rollback();
      throw error;
    }
  }, env);
}

export async function loginUser(provider, input, env = process.env) {
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || '');
  return withAuthDatabase(provider, async (database) => {
    const row = await database.get('SELECT * FROM auth_users WHERE email = ?', [email]);
    const valid = await verifyPassword(password, row?.password_hash || DUMMY_PASSWORD_HASH);
    if (!row || !valid || row.status !== 'active') {
      throw new Error('邮箱或密码不正确。');
    }

    const timestamp = now();
    await database.begin();
    try {
      await database.run('UPDATE auth_users SET last_login_at = ?, updated_at = ? WHERE id = ?', [
        database.date(timestamp),
        database.date(timestamp),
        row.id
      ]);
      const session = await createSession(database, row.id, env);
      await database.commit();
      return { user: { ...publicUser(row), lastLoginAt: timestamp }, session };
    } catch (error) {
      await database.rollback();
      throw error;
    }
  }, env);
}

export async function authenticateSession(provider, token, env = process.env) {
  const tokenHash = hashSessionToken(token);
  if (!token || tokenHash.length !== 64) return null;
  return withAuthDatabase(provider, async (database) => {
    const current = now();
    const row = await database.get(
      `SELECT u.*, s.id AS session_id, s.expires_at, s.last_seen_at
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
      [tokenHash, database.date(current)]
    );
    if (!row) return null;

    const lastSeen = fromDbDate(row.last_seen_at);
    if (!lastSeen || Date.now() - new Date(lastSeen).getTime() >= SESSION_LAST_SEEN_WRITE_INTERVAL_MS) {
      await database.run('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?', [
        database.date(current),
        row.session_id
      ]);
    }
    return {
      sessionId: row.session_id,
      expiresAt: fromDbDate(row.expires_at),
      user: publicUser(row)
    };
  }, env);
}

export async function logoutSession(provider, token, env = process.env) {
  if (!token) return;
  await withAuthDatabase(provider, async (database) => {
    await database.run('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?', [
      database.date(now()),
      hashSessionToken(token)
    ]);
  }, env);
}

export async function changePassword(provider, auth, input, env = process.env) {
  const nextPasswordHash = await hashPassword(input?.newPassword);
  return withAuthDatabase(provider, async (database) => {
    const user = await database.get('SELECT password_hash FROM auth_users WHERE id = ?', [auth.user.id]);
    if (!user || !(await verifyPassword(input?.currentPassword, user.password_hash))) {
      throw new Error('当前密码不正确。');
    }
    const timestamp = now();
    await database.begin();
    try {
      await database.run(
        'UPDATE auth_users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?',
        [nextPasswordHash, database.date(timestamp), database.date(timestamp), auth.user.id]
      );
      await database.run(
        'UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ?',
        [database.date(timestamp), auth.user.id, auth.sessionId]
      );
      await database.commit();
      return { ok: true };
    } catch (error) {
      await database.rollback();
      throw error;
    }
  }, env);
}

export async function updateUserProfile(provider, auth, input, env = process.env) {
  return withAuthDatabase(provider, async (database) => {
    const currentUser = await database.get(
      'SELECT * FROM auth_users WHERE id = ? AND status = ?',
      [auth.user.id, 'active']
    );
    if (!currentUser) throw new Error('当前账号不可用，请重新登录。');

    const displayName = normalizeDisplayName(input?.displayName, currentUser.email);
    const timestamp = now();
    await database.begin();
    try {
      await database.run('UPDATE auth_users SET display_name = ?, updated_at = ? WHERE id = ?', [
        displayName,
        database.date(timestamp),
        auth.user.id
      ]);
      await database.run('UPDATE ledger_users SET display_name = ?, updated_at = ? WHERE id = ?', [
        displayName,
        database.date(timestamp),
        currentUser.ledger_user_id
      ]);
      await database.commit();
      return {
        ok: true,
        user: {
          ...publicUser(currentUser),
          displayName
        }
      };
    } catch (error) {
      await database.rollback();
      throw error;
    }
  }, env);
}

export async function revokeOtherSessions(provider, auth, env = process.env) {
  await withAuthDatabase(provider, async (database) => {
    await database.run(
      'UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      [database.date(now()), auth.user.id, auth.sessionId]
    );
  }, env);
  return { ok: true };
}

export async function deleteExpiredSessions(provider, env = process.env) {
  return withAuthDatabase(provider, async (database) =>
    database.run('DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', [
      database.date(now())
    ]), env);
}
