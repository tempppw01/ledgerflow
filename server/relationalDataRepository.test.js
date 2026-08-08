import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerUser } from './authService.js';
import { migrateRelationalDatabase } from './relationalDatabase.js';
import {
  getRelationalBootstrap,
  getRelationalDataStatus,
  replaceRelationalData
} from './relationalDataRepository.js';

test('relational repository imports and rebuilds core business data from SQLite rows', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-data-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    await assert.rejects(
      () => getRelationalBootstrap('sqlite', env),
      /Authenticated ledger user ID is required/
    );
    await replaceRelationalData(
      'sqlite',
      {
        finance: {
          accounts: [{ id: 'account-cash', name: 'Cash', type: 'cash', initialBalance: 100, balance: 75 }],
          categories: [{ id: 'category-food', name: 'Food', kind: 'expense' }],
          transactions: [
            {
              id: 'transaction-lunch',
              type: 'expense',
              accountId: 'account-cash',
              categoryId: 'category-food',
              amount: 25,
              date: '2026-07-31T00:00:00.000Z',
              note: 'Lunch',
              tags: ['daily']
            }
          ],
          subscriptions: []
        },
        preferences: {
          debts: [{ id: 'debt-card', name: 'Card', type: 'credit-card', balance: 50 }],
          repaymentRecords: [],
          investmentPositions: [],
          investmentPositionHistory: [],
          investmentGoals: [],
          investmentWatchlist: [],
          investmentAiMessages: [],
          rssSubscriptions: [],
          monthlyIncome: 9000
        },
        globalMemories: []
      },
      env,
      'default'
    );

    const status = await getRelationalDataStatus('sqlite', env, 'default');
    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');

    assert.equal(status.hasData, true);
    assert.equal(status.counts.transactions, 1);
    assert.equal(status.counts.debts, 1);
    assert.equal(bootstrap.data.finance.transactions[0].note, 'Lunch');
    assert.deepEqual(bootstrap.data.finance.transactions[0].tags, ['daily']);
    assert.equal(bootstrap.data.preferences.debts[0].balance, 50);

    await replaceRelationalData('sqlite', { finance: {}, preferences: {}, globalMemories: [] }, env, 'default');
    const cleared = await getRelationalDataStatus('sqlite', env, 'default');
    assert.equal(cleared.hasData, false);
    assert.equal(cleared.counts.transactions, 0);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('relational repository ignores duplicate rows shared by active and trashed collections', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-dedup-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    await replaceRelationalData(
      'sqlite',
      {
        finance: {
          accounts: [{ id: 'duplicate-account', name: 'Cash', type: 'cash' }],
          trashedAccounts: [
            {
              id: 'duplicate-account',
              name: 'Old Cash',
              type: 'cash',
              trashedAt: '2026-08-01T00:00:00.000Z'
            }
          ]
        },
        preferences: {}
      },
      env,
      'default'
    );

    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    assert.equal(bootstrap.data.finance.accounts.length, 1);
    assert.equal(bootstrap.data.finance.trashedAccounts.length, 0);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('relational repository keeps separate users isolated during replacement and bootstrap', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-isolation-'));
  const env = {
    LEDGERFLOW_DATA_DIR: dataDirectory,
    SQLITE_PATH: '',
    LEDGERFLOW_REGISTRATION_MODE: 'open'
  };
  const payload = (prefix) => ({
    finance: {
      accounts: [{ id: `${prefix}-account`, name: `${prefix} account`, type: 'cash' }],
      categories: [{ id: `${prefix}-category`, name: `${prefix} category`, kind: 'expense' }],
      transactions: [
        {
          id: `${prefix}-transaction`,
          type: 'expense',
          accountId: `${prefix}-account`,
          categoryId: `${prefix}-category`,
          amount: 12.5,
          date: '2026-08-01T00:00:00.000Z',
          tags: [`${prefix}-tag`]
        }
      ]
    },
    preferences: {},
    globalMemories: []
  });

  try {
    await migrateRelationalDatabase('sqlite', env);
    const first = await registerUser(
      'sqlite',
      { email: 'first@example.com', password: 'first-secure-password' },
      env
    );
    const second = await registerUser(
      'sqlite',
      { email: 'second@example.com', password: 'second-secure-password' },
      env
    );

    await replaceRelationalData('sqlite', payload('first'), env, first.user.ledgerUserId);
    await replaceRelationalData('sqlite', payload('second'), env, second.user.ledgerUserId);
    await replaceRelationalData(
      'sqlite',
      { finance: {}, preferences: {}, globalMemories: [] },
      env,
      first.user.ledgerUserId
    );

    const firstBootstrap = await getRelationalBootstrap(
      'sqlite',
      env,
      first.user.ledgerUserId
    );
    const secondBootstrap = await getRelationalBootstrap(
      'sqlite',
      env,
      second.user.ledgerUserId
    );
    assert.equal(firstBootstrap.counts.transactions, 0);
    assert.equal(secondBootstrap.counts.transactions, 1);
    assert.equal(secondBootstrap.data.finance.transactions[0].id, 'second-transaction');
    assert.deepEqual(secondBootstrap.data.finance.transactions[0].tags, ['second-tag']);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
