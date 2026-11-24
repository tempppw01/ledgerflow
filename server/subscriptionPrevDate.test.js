import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateRelationalDatabase } from './relationalDatabase.js';
import { getRelationalBootstrap, replaceRelationalData } from './relationalDataRepository.js';

/**
 * v9 加的 `prev_renewal_date` / `prev_expire_date` 必须在服务端三层都通:
 * CREATE TABLE(新库)、v9 迁移(老库 ALTER)、INSERT 与行映射(往返)。
 *
 * 为什么要单独钉:这两列是「删除生成流水时精确退回续费日」的依据(v0.50.18)。
 * 客户端那边有备份往返测试,但**服务端一层原先没有任何覆盖** —— 谁把列从
 * CREATE / INSERT / 映射里去掉,都不会有测试变红,直到用户发现续费日退不回去。
 */
async function withTempDatabase(run) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-prev-date-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    await run(env, path.join(dataDirectory, 'ledgerflow.sqlite'));
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

function subscriptionPayload(overrides = {}) {
  return {
    finance: {
      accounts: [{ id: 'acc-1', name: '现金', type: 'cash', initialBalance: 1000, balance: 1000 }],
      categories: [{ id: 'cat-1', name: '娱乐', kind: 'expense' }],
      transactions: [],
      subscriptions: [
        {
          id: 'sub-1',
          name: 'iCloud+ 200GB',
          kind: 'digital',
          amount: 21,
          currency: 'CNY',
          billingCycle: 'monthly',
          accountId: 'acc-1',
          status: 'active',
          autoRenew: true,
          renewalDate: '2026-12-28',
          expireDate: '2026-12-28',
          lastGeneratedAt: '2026-11-24',
          prevRenewalDate: '2026-11-28',
          prevExpireDate: '2026-11-28',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-11-24T00:00:00.000Z',
          ...overrides
        }
      ]
    },
    preferences: {
      debts: [],
      repaymentRecords: [],
      investmentPositions: [],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: [],
      creditDrafts: [],
      forecastBills: [],
      smartBudgetPlan: null,
      smartBudgetHistory: [],
      rssSubscriptions: [],
      monthlyIncome: 0
    },
    globalMemories: []
  };
}

test('新库就把 v9 的两列建出来了', async () => {
  await withTempDatabase(async (env, databasePath) => {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(ledger_subscriptions)').all().map((row) => row.name);
      assert.ok(columns.includes('prev_renewal_date'), '缺 prev_renewal_date');
      assert.ok(columns.includes('prev_expire_date'), '缺 prev_expire_date');
    } finally {
      db.close();
    }
  });
});

test('prevRenewalDate / prevExpireDate 能写进去、也能读回来', async () => {
  await withTempDatabase(async (env, databasePath) => {
    await replaceRelationalData('sqlite', subscriptionPayload(), env, 'default');

    // 先确认真的落到了列上(而不是被静默丢掉)
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      // 注意:库里存的 id 是**加了用户作用域前缀**的(形如 37a8eec1-sub-1),
      // 所以按原 id 查不到 —— 按名字查才稳。读回实体时仓库会把前缀剥掉。
      const row = db
        .prepare('SELECT prev_renewal_date, prev_expire_date FROM ledger_subscriptions WHERE name = ?')
        .get('iCloud+ 200GB');
      assert.ok(row, '订阅没写进去');
      assert.equal(String(row.prev_renewal_date).slice(0, 10), '2026-11-28');
      assert.equal(String(row.prev_expire_date).slice(0, 10), '2026-11-28');
    } finally {
      db.close();
    }

    // 再确认读回来的实体上也带着
    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const subscription = bootstrap.data.finance.subscriptions.find((item) => item.id === 'sub-1');
    assert.ok(subscription, '读回来的订阅里找不到它');
    assert.equal(String(subscription.prevRenewalDate).slice(0, 10), '2026-11-28');
    assert.equal(String(subscription.prevExpireDate).slice(0, 10), '2026-11-28');
  });
});

test('没有快照的订阅仍然正常(两列为空不报错)', async () => {
  await withTempDatabase(async (env) => {
    await replaceRelationalData(
      'sqlite',
      subscriptionPayload({ prevRenewalDate: undefined, prevExpireDate: undefined }),
      env,
      'default'
    );
    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const subscription = bootstrap.data.finance.subscriptions.find((item) => item.id === 'sub-1');
    assert.ok(subscription, '没有快照的订阅不应被丢弃');
    assert.equal(subscription.prevRenewalDate, undefined);
  });
});