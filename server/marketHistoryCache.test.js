import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateRelationalDatabase } from './relationalDatabase.js';
import { readMarketHistoryCache, writeMarketHistoryCache } from './marketHistoryCache.js';

test('market history cache persists and reads through SQLite', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-market-cache-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  const databasePath = path.join(dataDirectory, 'ledgerflow.sqlite');

  try {
    await migrateRelationalDatabase('sqlite', env);
    await writeFile(
      path.join(dataDirectory, 'database-provider.json'),
      JSON.stringify({ provider: 'sqlite', version: 1, initializedAt: new Date().toISOString() })
    );

    const payload = {
      points: [{ date: '2026-08-14', value: 100, changePercent: 0.5 }],
      source: 'Yahoo Finance'
    };
    assert.equal(
      await writeMarketHistoryCache(
        {
          cacheKey: 'global-history:us-sp500:20260801:20260814',
          provider: 'yahoo',
          targetId: 'us-sp500',
          rangeStart: '20260801',
          rangeEnd: '20260814',
          payload
        },
        env
      ),
      true
    );

    const cached = await readMarketHistoryCache(
      'global-history:us-sp500:20260801:20260814',
      {},
      env
    );
    assert.deepEqual(cached?.payload, payload);
    assert.equal(cached?.isExpired, false);

    const database = new DatabaseSync(databasePath);
    try {
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM market_history_cache').get().count,
        1
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
