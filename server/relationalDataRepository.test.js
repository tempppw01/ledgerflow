import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
      env
    );

    const status = await getRelationalDataStatus('sqlite', env);
    const bootstrap = await getRelationalBootstrap('sqlite', env);

    assert.equal(status.hasData, true);
    assert.equal(status.counts.transactions, 1);
    assert.equal(status.counts.debts, 1);
    assert.equal(bootstrap.data.finance.transactions[0].note, 'Lunch');
    assert.deepEqual(bootstrap.data.finance.transactions[0].tags, ['daily']);
    assert.equal(bootstrap.data.preferences.debts[0].balance, 50);

    await replaceRelationalData('sqlite', { finance: {}, preferences: {}, globalMemories: [] }, env);
    const cleared = await getRelationalDataStatus('sqlite', env);
    assert.equal(cleared.hasData, false);
    assert.equal(cleared.counts.transactions, 0);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
