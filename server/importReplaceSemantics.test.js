import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateRelationalDatabase } from './relationalDatabase.js';
import { getRelationalBootstrap, replaceRelationalData } from './relationalDataRepository.js';

/**
 * 把「整份快照同步会覆盖另一个客户端的写入」这个**已复现**问题的**机制**钉在这里。
 *
 * 这不是在肯定这个行为,而是把它变成一个**会翻红的约定**:
 * `/api/data/import` 的语义是「替换」—— 先 delete 掉该用户全部行,再按 payload 重插。
 * 客户端推的是**整份本地快照**,推之前既不重新拉取、也没有版本比对,所以拿着旧快照的
 * 客户端一推,就会把另一个客户端(另一个标签页 / 另一台设备)在这个窗口里写的行删掉。
 *
 * 复现步骤与三个候选修法写在 docs/verified-invariants.md 的「已复现、但待决策的问题」一节。
 * 一旦哪天改成合并或加版本校验,**下面这些断言就该变了** —— 那时请连同文档一起更新。
 */
async function withTempDatabase(run) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-import-replace-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    await run(env, path.join(dataDirectory, 'ledgerflow.sqlite'));
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

function payload({ transactions, accounts, categories }) {
  return {
    finance: {
      accounts,
      categories,
      transactions,
      subscriptions: [],
      trashedAccounts: [],
      trashedCategories: [],
      trashedTransactions: [],
      trashedSubscriptions: [],
      balanceChangeEntries: []
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

const account = (id, name) => ({ id, name, type: 'cash', initialBalance: 1000, balance: 1000 });
const category = (id, name) => ({ id, name, kind: 'expense' });
const transaction = (id, amount) => ({
  id,
  type: 'expense',
  categoryId: 'cat-1',
  accountId: 'acc-1',
  amount,
  date: '2026-11-24',
  note: '覆盖语义验证',
  tags: [],
  source: 'manual',
  status: 'completed'
});

test('导入是替换语义:payload 里没有的行会被删掉', async () => {
  await withTempDatabase(async (env) => {
    // 客户端 A:两笔
    await replaceRelationalData(
      'sqlite',
      payload({
        accounts: [account('acc-1', '现金')],
        categories: [category('cat-1', '餐饮')],
        transactions: [transaction('tx-a', 11), transaction('tx-b', 22)]
      }),
      env,
      'default'
    );
    let bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    assert.equal(bootstrap.data.finance.transactions.length, 2, 'A 的两笔应当都在');

    // 客户端 B:拿着「只有 tx-b」的旧快照推上来(它不知道 tx-a 存在)
    await replaceRelationalData(
      'sqlite',
      payload({
        accounts: [account('acc-1', '现金')],
        categories: [category('cat-1', '餐饮')],
        transactions: [transaction('tx-b', 22)]
      }),
      env,
      'default'
    );

    bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const ids = bootstrap.data.finance.transactions.map((item) => item.id).sort();
    // 现状:tx-a 被删了 —— 这就是多客户端静默丢数据
    assert.deepEqual(ids, ['tx-b'], '现状是替换:不在 payload 里的 tx-a 会被删除');
  });
});

test('即使 payload 只少了一个分类,那条分类也会被删掉(不是合并)', async () => {
  await withTempDatabase(async (env) => {
    await replaceRelationalData(
      'sqlite',
      payload({
        accounts: [account('acc-1', '现金')],
        categories: [category('cat-1', '餐饮'), category('cat-2', '交通')],
        transactions: []
      }),
      env,
      'default'
    );
    await replaceRelationalData(
      'sqlite',
      payload({
        accounts: [account('acc-1', '现金')],
        categories: [category('cat-1', '餐饮')],
        transactions: []
      }),
      env,
      'default'
    );

    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const names = bootstrap.data.finance.categories.map((item) => item.name);
    assert.deepEqual(names, ['餐饮'], '现状是替换:cat-2 不会被保留');
  });
});

test('对账:payload 里写了多少行,库里就是多少行(替换而非累加)', async () => {
  await withTempDatabase(async (env, databasePath) => {
    // 先有 3 笔
    await replaceRelationalData(
      'sqlite',
      payload({
        accounts: [account('acc-1', '现金')],
        categories: [category('cat-1', '餐饮')],
        transactions: [transaction('tx-1', 1), transaction('tx-2', 2), transaction('tx-3', 3)]
      }),
      env,
      'default'
    );
    // 再推 1 笔:结果应当是 1 笔,而不是 4 笔
    await replaceRelationalData(
      'sqlite',
      payload({
        accounts: [account('acc-1', '现金')],
        categories: [category('cat-1', '餐饮')],
        transactions: [transaction('tx-9', 9)]
      }),
      env,
      'default'
    );

    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) AS c FROM ledger_transactions').get().c;
      assert.equal(count, 1, '替换语义:结果是 1 笔而不是 4 笔');
    } finally {
      db.close();
    }
  });
});