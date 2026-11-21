import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  authenticateSession,
  getUserSessions,
  getAuthStatus,
  hashPassword,
  loginUser,
  logoutSession,
  normalizeClientIp,
  registerUser,
  requestPasswordReset,
  resetPasswordWithToken,
  revokeUserSession,
  verifyPassword
} from './authService.js';
import { migrateRelationalDatabase } from './relationalDatabase.js';

async function withDatabase(callback, overrides = {}) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-auth-'));
  const env = {
    LEDGERFLOW_DATA_DIR: dataDirectory,
    SQLITE_PATH: '',
    LEDGERFLOW_REGISTRATION_MODE: 'first-user',
    ...overrides
  };
  try {
    await migrateRelationalDatabase('sqlite', env);
    await callback(env);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

test('scrypt password hashes verify without storing the plaintext password', async () => {
  const password = 'correct horse battery staple';
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);
});

test('first account claims legacy default data and creates an authenticated session', async () => {
  await withDatabase(async (env) => {
    const before = await getAuthStatus('sqlite', '', env);
    assert.equal(before.registrationOpen, true);
    assert.equal(before.authenticated, false);

    const registered = await registerUser(
      'sqlite',
      {
        email: 'OWNER@EXAMPLE.COM',
        password: 'a-secure-password',
        displayName: 'Owner'
      },
      env
    );
    assert.equal(registered.claimedLegacyData, true);
    assert.equal(registered.user.ledgerUserId, 'default');
    assert.equal(registered.user.email, 'owner@example.com');

    const authenticated = await authenticateSession('sqlite', registered.session.token, env);
    assert.equal(authenticated?.user.id, registered.user.id);
    assert.equal(authenticated?.user.ledgerUserId, 'default');

    const after = await getAuthStatus('sqlite', registered.session.token, env);
    assert.equal(after.authenticated, true);
    assert.equal(after.registrationOpen, false);

    await assert.rejects(
      registerUser(
        'sqlite',
        { email: 'second@example.com', password: 'another-secure-password' },
        env
      ),
      /未开放新账号注册/
    );

    await logoutSession('sqlite', registered.session.token, env);
    assert.equal(await authenticateSession('sqlite', registered.session.token, env), null);
  });
});

test('login rejects invalid credentials and issues a fresh session for valid credentials', async () => {
  await withDatabase(async (env) => {
    await registerUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password', displayName: 'Owner' },
      env
    );
    await assert.rejects(
      loginUser('sqlite', { email: 'owner@example.com', password: 'wrong-password' }, env),
      /邮箱或密码不正确/
    );

    const loggedIn = await loginUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password' },
      env
    );
    assert.equal(loggedIn.user.email, 'owner@example.com');
    assert.ok(await authenticateSession('sqlite', loggedIn.session.token, env));
  });
});

test('password reset tokens are single-use and revoke every existing session', async () => {
  await withDatabase(async (env) => {
    const registered = await registerUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password', displayName: 'Owner' },
      env
    );
    const firstRequest = await requestPasswordReset('sqlite', { email: 'OWNER@EXAMPLE.COM' }, env);
    const secondRequest = await requestPasswordReset('sqlite', { email: 'owner@example.com' }, env);

    assert.ok(firstRequest?.token);
    assert.ok(secondRequest?.token);
    assert.notEqual(firstRequest.token, secondRequest.token);
    await assert.rejects(
      resetPasswordWithToken(
        'sqlite',
        { token: firstRequest.token, newPassword: 'updated-secure-password' },
        env
      ),
      /密码重置链接无效或已过期/
    );

    await resetPasswordWithToken(
      'sqlite',
      { token: secondRequest.token, newPassword: 'updated-secure-password' },
      env
    );
    assert.equal(await authenticateSession('sqlite', registered.session.token, env), null);
    await assert.rejects(
      loginUser('sqlite', { email: 'owner@example.com', password: 'a-secure-password' }, env),
      /邮箱或密码不正确/
    );

    const loggedIn = await loginUser(
      'sqlite',
      { email: 'owner@example.com', password: 'updated-secure-password' },
      env
    );
    assert.equal(loggedIn.user.email, 'owner@example.com');
    await assert.rejects(
      resetPasswordWithToken(
        'sqlite',
        { token: secondRequest.token, newPassword: 'another-secure-password' },
        env
      ),
      /密码重置链接无效或已过期/
    );

    assert.equal(await requestPasswordReset('sqlite', { email: 'missing@example.com' }, env), null);
  });
});

test('account sessions keep device names and allow revoking another device', async () => {
  await withDatabase(async (env) => {
    const registered = await registerUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password', displayName: 'Owner' },
      env,
      {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Safari/605.1.15',
        ip: '198.51.100.7'
      }
    );
    const loggedIn = await loginUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password' },
      env,
      {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0.0.0 Safari/537.36',
        ip: '203.0.113.24'
      }
    );
    const current = await authenticateSession('sqlite', loggedIn.session.token, env);
    const listed = await getUserSessions('sqlite', current, env);

    assert.equal(listed.sessions.length, 2);
    const currentSession = listed.sessions.find((item) => item.current);
    assert.equal(currentSession?.deviceName, 'Chrome · Windows');
    // 登录设备的来源 IP 与设备名一起落在会话上,按会话分别记录。
    assert.equal(currentSession?.ip, '203.0.113.24');
    assert.equal(listed.sessions.find((item) => !item.current)?.ip, '198.51.100.7');

    const other = listed.sessions.find((item) => !item.current);
    await revokeUserSession('sqlite', current, other?.id, env);
    const afterRevoke = await getUserSessions('sqlite', current, env);
    assert.equal(afterRevoke.sessions.length, 1);
    assert.equal(afterRevoke.sessions[0].current, true);
    assert.equal(await authenticateSession('sqlite', registered.session.token, env), null);
  });
});

test('sessions created before the IP column existed get backfilled on the next request', async () => {
  await withDatabase(async (env) => {
    // 不带 ip 注册,模拟「上线前建立的会话」:IP 列为空。
    const registered = await registerUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password', displayName: 'Owner' },
      env,
      { userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0.0.0 Safari/537.36' }
    );
    const created = await authenticateSession('sqlite', registered.session.token, env);
    assert.equal((await getUserSessions('sqlite', created, env)).sessions[0].ip, null);

    // 老会话没有 IP:下一次带 Cookie 的请求把它补上。
    const backfilled = await authenticateSession('sqlite', registered.session.token, env, {
      ip: '2001:DB8::1'
    });
    assert.equal((await getUserSessions('sqlite', backfilled, env)).sessions[0].ip, '2001:db8::1');

    // 已经记过 IP 的会话不会被后续请求改写(换网络不代表换了登录来源)。
    const again = await authenticateSession('sqlite', registered.session.token, env, {
      ip: '203.0.113.99'
    });
    assert.equal((await getUserSessions('sqlite', again, env)).sessions[0].ip, '2001:db8::1');
  });
});

test('normalizeClientIp accepts the shapes a real request can carry', () => {
  // 反代/直连的常见形态都要收敛成同一个可入库的字符串。
  assert.equal(normalizeClientIp('203.0.113.24'), '203.0.113.24');
  assert.equal(normalizeClientIp(' 203.0.113.24 '), '203.0.113.24');
  assert.equal(normalizeClientIp('203.0.113.24:51234'), '203.0.113.24');
  assert.equal(normalizeClientIp('203.0.113.24, 10.0.0.1, 10.0.0.2'), '203.0.113.24');
  assert.equal(normalizeClientIp('::ffff:203.0.113.24'), '203.0.113.24');
  assert.equal(normalizeClientIp('::1'), '::1');
  assert.equal(normalizeClientIp('[2001:DB8::1]:443'), '2001:db8::1');
  assert.equal(normalizeClientIp('fe80::1%eth0'), 'fe80::1');
});

test('normalizeClientIp rejects values that are not usable IPs', () => {
  for (const value of ['', '   ', null, undefined, 'unknown', 'not-an-ip', '203.0.113.256', '1.2.3', '999.1.1.1', '01.2.3.4']) {
    assert.equal(normalizeClientIp(value), null, `${String(value)} should be rejected`);
  }
});

test('open registration gives later accounts independent ledger user ids', async () => {
  await withDatabase(
    async (env) => {
      const first = await registerUser(
        'sqlite',
        { email: 'one@example.com', password: 'first-secure-password' },
        env
      );
      const second = await registerUser(
        'sqlite',
        { email: 'two@example.com', password: 'second-secure-password' },
        env
      );
      assert.equal(first.user.ledgerUserId, 'default');
      assert.notEqual(second.user.ledgerUserId, first.user.ledgerUserId);
    },
    { LEDGERFLOW_REGISTRATION_MODE: 'open' }
  );
});
