import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLedgerFlowServer, resolveApiPort } from './mysqlSnapshotServer.js';

test('internal API port overrides a platform-provided public port', () => {
  assert.equal(resolveApiPort({ PORT: '8080', LEDGERFLOW_API_PORT: '8787' }), 8787);
  assert.equal(resolveApiPort({ PORT: '8080' }), 8080);
});

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function json(response) {
  return response.json();
}

function payload(prefix) {
  return {
    finance: {
      accounts: [{ id: `${prefix}-account`, name: `${prefix} account`, type: 'cash' }],
      categories: [{ id: `${prefix}-category`, name: `${prefix} category`, kind: 'expense' }],
      transactions: [
        {
          id: `${prefix}-transaction`,
          type: 'expense',
          accountId: `${prefix}-account`,
          categoryId: `${prefix}-category`,
          amount: 10,
          date: '2026-08-01T00:00:00.000Z'
        }
      ]
    },
    preferences: {},
    globalMemories: []
  };
}

test('HTTP auth protects relational data and scopes it to the session user', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-auth-http-'));
  const previous = {
    dataDirectory: process.env.LEDGERFLOW_DATA_DIR,
    provider: process.env.DATABASE_PROVIDER,
    registration: process.env.LEDGERFLOW_REGISTRATION_MODE,
    secure: process.env.LEDGERFLOW_COOKIE_SECURE,
    cors: process.env.LEDGERFLOW_CORS_ORIGIN
  };
  process.env.LEDGERFLOW_DATA_DIR = dataDirectory;
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.LEDGERFLOW_REGISTRATION_MODE = 'open';
  process.env.LEDGERFLOW_COOKIE_SECURE = 'false';
  process.env.LEDGERFLOW_CORS_ORIGIN = 'https://ledgerflow.example.com';

  const server = createLedgerFlowServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (pathname, init) => fetch(`${baseUrl}${pathname}`, init);
  const post = (pathname, body, cookie = '') =>
    request(pathname, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: JSON.stringify(body)
    });

  try {
    const setup = await post('/api/setup/initialize', { provider: 'sqlite' });
    assert.equal(setup.status, 200);
    const setupBody = await json(setup);
    assert.equal(setupBody.initialized, true);
    assert.equal(setupBody.provider, 'sqlite');
    assert.equal(setupBody.created, true);

    const unauthorized = await request('/api/data/bootstrap');
    assert.equal(unauthorized.status, 401);

    const blockedCrossOrigin = await request('/api/auth/status', {
      headers: { Origin: 'https://attacker.example.com' }
    });
    assert.equal(blockedCrossOrigin.headers.get('access-control-allow-origin'), null);
    const allowedCrossOrigin = await request('/api/auth/status', {
      headers: { Origin: 'https://ledgerflow.example.com' }
    });
    assert.equal(
      allowedCrossOrigin.headers.get('access-control-allow-origin'),
      'https://ledgerflow.example.com'
    );
    assert.equal(allowedCrossOrigin.headers.get('access-control-allow-credentials'), 'true');

    const registered = await post('/api/auth/register', {
      email: 'owner@example.com',
      password: 'owner-secure-password',
      displayName: 'Owner'
    });
    assert.equal(registered.status, 200);
    const ownerCookie = registered.headers.get('set-cookie').split(';', 1)[0];

    const me = await request('/api/auth/me', { headers: { Cookie: ownerCookie } });
    assert.equal(me.status, 200);
    assert.equal((await json(me)).user.email, 'owner@example.com');

    const sessions = await request('/api/auth/sessions', { headers: { Cookie: ownerCookie } });
    assert.equal(sessions.status, 200);
    assert.equal((await json(sessions)).sessions[0].current, true);

    const profile = await post('/api/auth/profile', { displayName: 'Updated Owner' }, ownerCookie);
    assert.equal(profile.status, 200);
    assert.equal((await json(profile)).user.displayName, 'Updated Owner');

    const changedPassword = await post(
      '/api/auth/change-password',
      { currentPassword: 'owner-secure-password', newPassword: 'updated-owner-password' },
      ownerCookie
    );
    assert.equal(changedPassword.status, 200);

    const revokeOtherSessions = await post('/api/auth/revoke-sessions', {}, ownerCookie);
    assert.equal(revokeOtherSessions.status, 200);

    const ownerData = await post('/api/data/import', payload('owner'), ownerCookie);
    assert.equal(ownerData.status, 200);

    const second = await post('/api/auth/register', {
      email: 'second@example.com',
      password: 'second-secure-password',
      displayName: 'Second'
    });
    assert.equal(second.status, 200);
    const secondCookie = second.headers.get('set-cookie').split(';', 1)[0];
    const secondData = await post('/api/data/import', payload('second'), secondCookie);
    assert.equal(secondData.status, 200);

    const ownerBootstrap = await json(
      await request('/api/data/bootstrap', { headers: { Cookie: ownerCookie } })
    );
    const secondBootstrap = await json(
      await request('/api/data/bootstrap', { headers: { Cookie: secondCookie } })
    );
    assert.equal(ownerBootstrap.counts.transactions, 1);
    assert.equal(secondBootstrap.counts.transactions, 1);
    assert.equal(ownerBootstrap.data.finance.transactions[0].id, 'owner-transaction');
    assert.equal(secondBootstrap.data.finance.transactions[0].id, 'second-transaction');

    const sqlExport = await request('/api/data/export/sql', { headers: { Cookie: ownerCookie } });
    assert.equal(sqlExport.status, 200);
    assert.equal(sqlExport.headers.get('x-ledgerflow-database-provider'), 'sqlite');
    assert.match(sqlExport.headers.get('content-disposition') || '', /\.sqlite/);
    const exportedDatabasePath = path.join(dataDirectory, 'exported.sqlite');
    const exportedBytes = Buffer.from(await sqlExport.arrayBuffer());
    await writeFile(exportedDatabasePath, exportedBytes);
    const exportedDatabase = new DatabaseSync(exportedDatabasePath);
    assert.equal(exportedDatabase.prepare("SELECT COUNT(*) AS count FROM ledger_transactions").get().count, 1);
    assert.equal(exportedDatabase.prepare('SELECT COUNT(*) AS count FROM auth_users').get().count, 1);
    assert.equal(exportedDatabase.prepare('SELECT id FROM ledger_transactions').get().id, 'owner-transaction');
    exportedDatabase.close();

    const logout = await post('/api/auth/logout', {}, ownerCookie);
    assert.equal(logout.status, 200);
    const afterLogout = await request('/api/data/bootstrap', { headers: { Cookie: ownerCookie } });
    assert.equal(afterLogout.status, 401);
  } finally {
    await closeServer(server);
    if (previous.dataDirectory === undefined) delete process.env.LEDGERFLOW_DATA_DIR;
    else process.env.LEDGERFLOW_DATA_DIR = previous.dataDirectory;
    if (previous.provider === undefined) delete process.env.DATABASE_PROVIDER;
    else process.env.DATABASE_PROVIDER = previous.provider;
    if (previous.registration === undefined) delete process.env.LEDGERFLOW_REGISTRATION_MODE;
    else process.env.LEDGERFLOW_REGISTRATION_MODE = previous.registration;
    if (previous.secure === undefined) delete process.env.LEDGERFLOW_COOKIE_SECURE;
    else process.env.LEDGERFLOW_COOKIE_SECURE = previous.secure;
    if (previous.cors === undefined) delete process.env.LEDGERFLOW_CORS_ORIGIN;
    else process.env.LEDGERFLOW_CORS_ORIGIN = previous.cors;
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
