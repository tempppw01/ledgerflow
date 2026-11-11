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
  resetRelationalData,
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
          accounts: [
            { id: 'account-cash', name: 'Cash', type: 'cash', initialBalance: 100, balance: 75 }
          ],
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

    await replaceRelationalData(
      'sqlite',
      { finance: {}, preferences: {}, globalMemories: [] },
      env,
      'default'
    );
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

    const firstBootstrap = await getRelationalBootstrap('sqlite', env, first.user.ledgerUserId);
    const secondBootstrap = await getRelationalBootstrap('sqlite', env, second.user.ledgerUserId);
    assert.equal(firstBootstrap.counts.transactions, 0);
    assert.equal(secondBootstrap.counts.transactions, 1);
    assert.equal(secondBootstrap.data.finance.transactions[0].id, 'second-transaction');
    assert.deepEqual(secondBootstrap.data.finance.transactions[0].tags, ['second-tag']);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('relational repository isolates users that import identical seed ids', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-shared-ids-'));
  const env = {
    LEDGERFLOW_DATA_DIR: dataDirectory,
    SQLITE_PATH: '',
    LEDGERFLOW_REGISTRATION_MODE: 'open'
  };
  const payload = () => ({
    finance: {
      accounts: [{ id: 'acc-cash', name: 'Cash', type: 'cash', initialBalance: 0, balance: 0 }],
      categories: [{ id: 'cat-food', name: 'Food', kind: 'expense' }],
      transactions: [
        {
          id: 'txn-lunch',
          type: 'expense',
          accountId: 'acc-cash',
          categoryId: 'cat-food',
          amount: 25,
          date: '2026-08-01T00:00:00.000Z',
          note: 'Lunch',
          tags: ['daily']
        }
      ]
    },
    preferences: {},
    globalMemories: [{ id: 'memory-1', title: 'Seed', content: 'Seed memory' }]
  });

  try {
    await migrateRelationalDatabase('sqlite', env);
    const first = await registerUser(
      'sqlite',
      { email: 'seed-first@example.com', password: 'first-secure-password' },
      env
    );
    const second = await registerUser(
      'sqlite',
      { email: 'seed-second@example.com', password: 'second-secure-password' },
      env
    );

    await replaceRelationalData('sqlite', payload(), env, first.user.ledgerUserId);
    await replaceRelationalData('sqlite', payload(), env, second.user.ledgerUserId);

    const firstBootstrap = await getRelationalBootstrap('sqlite', env, first.user.ledgerUserId);
    const secondBootstrap = await getRelationalBootstrap('sqlite', env, second.user.ledgerUserId);

    assert.equal(firstBootstrap.counts.transactions, 1);
    assert.equal(secondBootstrap.counts.transactions, 1);
    assert.equal(firstBootstrap.data.finance.accounts[0].id, 'acc-cash');
    assert.equal(secondBootstrap.data.finance.transactions[0].id, 'txn-lunch');
    assert.equal(secondBootstrap.data.finance.transactions[0].accountId, 'acc-cash');
    assert.equal(secondBootstrap.data.finance.transactions[0].categoryId, 'cat-food');
    assert.deepEqual(secondBootstrap.data.finance.transactions[0].tags, ['daily']);
    assert.equal(secondBootstrap.data.globalMemories[0].id, 'memory-1');
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('relational repository resets one ledger and leaves other accounts intact', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-reset-'));
  const env = {
    LEDGERFLOW_DATA_DIR: dataDirectory,
    SQLITE_PATH: '',
    LEDGERFLOW_REGISTRATION_MODE: 'open'
  };
  const payload = (suffix) => ({
    finance: {
      accounts: [
        { id: `acc-${suffix}`, name: 'Cash', type: 'cash', initialBalance: 0, balance: 120 }
      ],
      categories: [{ id: `cat-${suffix}`, name: 'Food', kind: 'expense' }],
      transactions: [
        {
          id: `txn-${suffix}`,
          type: 'expense',
          accountId: `acc-${suffix}`,
          categoryId: `cat-${suffix}`,
          amount: 25,
          date: '2026-09-01T00:00:00.000Z',
          note: 'Lunch',
          tags: ['daily']
        }
      ]
    },
    preferences: {},
    globalMemories: [{ id: `memory-${suffix}`, title: 'Seed', content: 'Seed memory' }]
  });

  try {
    await migrateRelationalDatabase('sqlite', env);
    const owner = await registerUser(
      'sqlite',
      { email: 'reset-owner@example.com', password: 'reset-owner-password' },
      env
    );
    const other = await registerUser(
      'sqlite',
      { email: 'reset-other@example.com', password: 'reset-other-password' },
      env
    );

    await replaceRelationalData('sqlite', payload('owner'), env, owner.user.ledgerUserId);
    await replaceRelationalData('sqlite', payload('other'), env, other.user.ledgerUserId);

    const status = await resetRelationalData('sqlite', env, owner.user.ledgerUserId);
    assert.equal(status.hasData, false);
    assert.equal(status.counts.transactions, 0);
    assert.equal(status.counts.accounts, 0);
    assert.equal(status.counts.categories, 0);

    const ownerBootstrap = await getRelationalBootstrap('sqlite', env, owner.user.ledgerUserId);
    assert.equal(ownerBootstrap.hasData, false);
    assert.equal(ownerBootstrap.data.finance.transactions.length, 0);
    assert.equal(ownerBootstrap.data.finance.accounts.length, 0);
    assert.equal(ownerBootstrap.data.globalMemories.length, 0);

    const otherBootstrap = await getRelationalBootstrap('sqlite', env, other.user.ledgerUserId);
    assert.equal(otherBootstrap.counts.transactions, 1);
    assert.equal(otherBootstrap.counts.accounts, 1);
    assert.equal(otherBootstrap.data.globalMemories.length, 1);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
