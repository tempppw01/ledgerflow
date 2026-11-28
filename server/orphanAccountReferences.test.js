import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateRelationalDatabase } from './relationalDatabase.js';
import { getRelationalBootstrap, replaceRelationalData } from './relationalDataRepository.js';

/**
 * 已知冲突(待决策):账户被**彻底删除**后,它名下的交易会在整份导入时被丢弃。
 *
 * 实测到的完整链路(演示账本):
 *   1. 删除账户           → 账户进回收站,交易**保留**(确认框承诺「交易仍会保留」,当天成立)
 *   2. 清空回收站         → 账户行被真删
 *   3. 下一次整份导入     → 这笔交易**从库里静默消失**
 *      (SqlDataSyncGate 有 500ms 防抖的自动整份同步,任何改动都会触发,不必手动恢复备份)
 *
 * **2026-11-28 起,第 2 步在界面上已经做不到了**:逐个「彻底删除」与「清空回收站」都按下面
 * 的方案 C 拒绝真删仍被交易的账户,并说明跳过了哪些。本文件因此只钉**服务端这一层**的行为:
 * 只要 payload 里出现引用不到的账户,那一行就会被丢弃 —— 这条没变,任何调用方仍必须读 counts。
 *
 * 根因不是疏忽,而是**数据模型冲突**:
 *   · `ledger_transactions.account_id` 与 `ledger_balance_changes.account_id` 都是 NOT NULL,
 *     也就是说「不属于任何账户的交易」在库里根本表示不了;
 *   · 于是导入时只能跳过(见 relationalDataRepository.js 里那句注释);
 *   · 但界面上删除账户的确认框写的是「交易仍会保留」,客户端也照常显示(账户列显示 -)。
 *
 * 所以下面这几条**不是在断言「这是对的」**,而是把这个现状钉住:
 * 一旦哪天真让它保留了(或改成别的语义),这些测试会失败 —— 那时请连同上一条链一起改。
 * 备选方案(数据模型那一层仍需要一次产品决策;客户端已按 (C) 挡住,见上):
 *   (C) 客户端拒绝彻底删除仍有交易的账户,让用户先处理 ← **已实现**(逐个删除 + 清空回收站)
 *   (A) 把两处 account_id 改成可空(SQLite 要重建表,MySQL 改列),导入时置空保留;
 *       代价:这类交易会「计入支出统计、却不在任何账户余额里」。
 *   (B) 客户端彻底删除账户时一并处理其交易(披露 + 立即,而不是静默 + 延迟)。
 *   (C) 客户端拒绝彻底删除仍有交易的账户,让用户先处理。
 *   (D) 建一个隐藏的「未指定账户」哨兵账户(与分类哨兵同款)。
 */
async function withTempDatabase(run) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-orphan-account-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    await run(env);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

function payload() {
  return {
    finance: {
      accounts: [
        { id: 'account-cash', name: '现金', type: 'cash', initialBalance: 1000, balance: 975 }
      ],
      categories: [{ id: 'category-food', name: '餐饮', kind: 'expense' }],
      transactions: [
        {
          id: 'tx-valid',
          type: 'expense',
          accountId: 'account-cash',
          categoryId: 'category-food',
          amount: 25,
          date: '2026-07-31T00:00:00.000Z',
          note: '账户还在'
        },
        {
          id: 'tx-orphan',
          type: 'expense',
          accountId: 'account-deleted',
          categoryId: 'category-food',
          amount: 30,
          date: '2026-07-30T00:00:00.000Z',
          note: '账户已被删'
        }
      ],
      balanceChangeEntries: [
        {
          id: 'bc-valid',
          accountId: 'account-cash',
          transactionId: 'tx-valid',
          changeType: 'transaction-expense',
          amount: 25,
          beforeBalance: 1000,
          afterBalance: 975,
          createdAt: '2026-07-31T00:00:00.000Z'
        },
        {
          id: 'bc-orphan',
          accountId: 'account-deleted',
          transactionId: 'tx-orphan',
          changeType: 'transaction-expense',
          amount: 30,
          beforeBalance: 0,
          afterBalance: -30,
          createdAt: '2026-07-30T00:00:00.000Z'
        }
      ],
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

test('对照:账户有效的交易照常存下来', async () => {
  await withTempDatabase(async (env) => {
    await replaceRelationalData('sqlite', payload(), env, 'default');
    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const valid = bootstrap.data.finance.transactions.find((item) => item.id === 'tx-valid');
    assert.ok(valid, '账户有效的交易必须在');
    assert.equal(valid.amount, 25);
  });
});

test('现状(待决策):账户已被删除的交易在导入时被丢弃', async () => {
  await withTempDatabase(async (env) => {
    await replaceRelationalData('sqlite', payload(), env, 'default');
    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const notes = bootstrap.data.finance.transactions.map((item) => item.note).sort();
    // 现在只剩有效的那一条 —— 「账户已被删」被静默丢了。
    // 这正是要修的那件事,见文件顶部说明与备选方案。
    assert.deepEqual(notes, ['账户还在']);
  });
});

test('现状(待决策):账户已被删除的余额变动行同样被丢弃', async () => {
  await withTempDatabase(async (env) => {
    await replaceRelationalData('sqlite', payload(), env, 'default');
    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const entries = bootstrap.data.finance.balanceChangeEntries.map((item) => item.id).sort();
    assert.deepEqual(entries, ['bc-valid']);
  });
});

test('现状:NOT NULL 约束禁止「没有账户的交易」,这是丢弃的根因', async () => {
  await withTempDatabase(async (env) => {
    // 表结构本身就排除了账户为空的交易 —— 所以 (A) 方案要动的是表结构。
    const columns = await import('node:sqlite').then(({ DatabaseSync }) => {
      const db = new DatabaseSync(path.join(env.LEDGERFLOW_DATA_DIR, 'ledgerflow.sqlite'), {
        readOnly: true
      });
      try {
        return db
          .prepare('PRAGMA table_info(ledger_transactions)')
          .all()
          .filter((row) => row.name === 'account_id');
      } finally {
        db.close();
      }
    });
    assert.equal(columns.length, 1);
    assert.equal(columns[0].notnull, 1, 'account_id 目前是 NOT NULL');
  });
});
