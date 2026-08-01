import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSqliteDatabasePath } from './databaseProvider.js';
import { migrateRelationalDatabase } from './relationalDatabase.js';
import {
  getRelationalBootstrap,
  getRelationalDataStatus,
  replaceRelationalData
} from './relationalDataRepository.js';

function parseRowCounts(argv = process.argv.slice(2)) {
  const argument = argv.find((item) => item.startsWith('--rows='));
  const source = argument?.slice('--rows='.length) || '1000,10000,100000';
  const counts = source
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 1_000_000);

  if (counts.length === 0) {
    throw new Error('Provide one or more row counts with --rows=1000,10000.');
  }
  return [...new Set(counts)];
}

function makePayload(rowCount) {
  const accountId = 'benchmark-account';
  const categoryId = 'benchmark-category';
  const baseTime = Date.UTC(2026, 0, 1);
  const transactions = Array.from({ length: rowCount }, (_, index) => {
    const occurredAt = new Date(baseTime + index * 60_000).toISOString();
    return {
      id: `benchmark-transaction-${String(index).padStart(8, '0')}`,
      type: index % 5 === 0 ? 'income' : 'expense',
      accountId,
      categoryId,
      amount: Number(((index % 997) + 0.25).toFixed(2)),
      date: occurredAt,
      updatedAt: occurredAt,
      note: `Benchmark row ${index}`,
      tags: index % 10 === 0 ? ['benchmark', 'sample'] : []
    };
  });

  return {
    finance: {
      accounts: [
        {
          id: accountId,
          name: 'Benchmark account',
          type: 'cash',
          initialBalance: 0,
          balance: 0
        }
      ],
      categories: [{ id: categoryId, name: 'Benchmark category', kind: 'expense' }],
      transactions,
      subscriptions: []
    },
    preferences: {
      debts: [],
      repaymentRecords: [],
      investmentPositions: [],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: [],
      rssSubscriptions: [],
      monthlyIncome: 0
    },
    globalMemories: []
  };
}

function explainPlans(env) {
  const database = new DatabaseSync(getSqliteDatabasePath(env), { readOnly: true });
  try {
    return {
      transactionsByUserAndDate: database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, amount, occurred_at
           FROM ledger_transactions
           WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?
           ORDER BY occurred_at, created_at`
        )
        .all('default', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      transactionsByAccount: database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, amount, occurred_at
           FROM ledger_transactions
           WHERE account_id = ?
           ORDER BY occurred_at DESC
           LIMIT 100`
        )
        .all('benchmark-account')
    };
  } finally {
    database.close();
  }
}

async function measure(label, callback) {
  const start = performance.now();
  const value = await callback();
  return { label, milliseconds: Number((performance.now() - start).toFixed(2)), value };
}

async function main() {
  const rowCounts = parseRowCounts();
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-database-baseline-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  const results = [];

  try {
    await migrateRelationalDatabase('sqlite', env);
    for (const rowCount of rowCounts) {
      const payload = makePayload(rowCount);
      const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
      const imported = await measure('replaceRelationalData', () =>
        replaceRelationalData('sqlite', payload, env, 'default')
      );
      const bootstrapped = await measure('getRelationalBootstrap', () =>
        getRelationalBootstrap('sqlite', env, 'default')
      );
      const status = await getRelationalDataStatus('sqlite', env, 'default');

      results.push({
        rowCount,
        payloadBytes,
        importMilliseconds: imported.milliseconds,
        bootstrapMilliseconds: bootstrapped.milliseconds,
        bootstrapBytes: Buffer.byteLength(JSON.stringify(bootstrapped.value)),
        counts: status.counts
      });
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          provider: 'sqlite',
          generatedAt: new Date().toISOString(),
          results,
          queryPlans: explainPlans(env)
        },
        null,
        2
      )}\n`
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

await main();
