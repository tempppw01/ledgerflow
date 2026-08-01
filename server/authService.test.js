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
  registerUser,
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

test('account sessions keep device names and allow revoking another device', async () => {
  await withDatabase(async (env) => {
    const registered = await registerUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password', displayName: 'Owner' },
      env,
      { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Safari/605.1.15' }
    );
    const loggedIn = await loginUser(
      'sqlite',
      { email: 'owner@example.com', password: 'a-secure-password' },
      env,
      { userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0.0.0 Safari/537.36' }
    );
    const current = await authenticateSession('sqlite', loggedIn.session.token, env);
    const listed = await getUserSessions('sqlite', current, env);

    assert.equal(listed.sessions.length, 2);
    assert.equal(listed.sessions.find((item) => item.current)?.deviceName, 'Chrome · Windows');

    const other = listed.sessions.find((item) => !item.current);
    await revokeUserSession('sqlite', current, other?.id, env);
    const afterRevoke = await getUserSessions('sqlite', current, env);
    assert.equal(afterRevoke.sessions.length, 1);
    assert.equal(afterRevoke.sessions[0].current, true);
    assert.equal(await authenticateSession('sqlite', registered.session.token, env), null);
  });
});

test('open registration gives later accounts independent ledger user ids', async () => {
  await withDatabase(async (env) => {
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
  }, { LEDGERFLOW_REGISTRATION_MODE: 'open' });
});
