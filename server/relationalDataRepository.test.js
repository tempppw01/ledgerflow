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
          creditDrafts: [
            { id: 'draft-jd', name: '京东白条', balance: 2000, sourceTurns: 1 }
          ],
          forecastBills: [
            {
              id: 'bill-rent',
              name: '房租',
              amount: 3200,
              date: '2026-12-01',
              direction: 'expense',
              repeat: 'monthly',
              createdAt: '2026-11-01T00:00:00.000Z',
              updatedAt: '2026-11-01T00:00:00.000Z'
            }
          ],
          smartBudgetPlan: {
            answers: { style: 'balanced' },
            recommendation: { version: 1 },
            confirmedAt: '2026-08-01T00:00:00.000Z'
          },
          smartBudgetHistory: [],
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
    assert.equal(bootstrap.data.preferences.creditDrafts[0].name, '京东白条');
    assert.equal(bootstrap.data.preferences.forecastBills[0].name, '房租');
    assert.equal(bootstrap.data.preferences.forecastBills[0].repeat, 'monthly');
    assert.equal(bootstrap.data.preferences.smartBudgetPlan.confirmedAt, '2026-08-01T00:00:00.000Z');

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

test('relational repository round-trips the repayment pre-recording snapshot', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-relational-snapshot-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    await replaceRelationalData(
      'sqlite',
      {
        finance: { accounts: [], categories: [], transactions: [], subscriptions: [] },
        preferences: {
          debts: [
            {
              id: 'debt-snapshot',
              name: '招商银行信用卡',
              type: 'credit-card',
              balance: 0,
              repaymentDay: 25
            }
          ],
          repaymentRecords: [
            {
              id: 'record-snapshot',
              debtId: 'debt-snapshot',
              amount: 1500,
              paidAt: '2026-11-21T00:00:00.000Z',
              recordMode: 'manual',
              createdAt: '2026-11-21T00:00:00.000Z',
              balanceBefore: 500,
              paidPeriodsBefore: 0,
              remainingMonthsBefore: 24
            }
          ]
        }
      },
      env,
      'default'
    );

    const bootstrap = await getRelationalBootstrap('sqlite', env, 'default');
    const record = bootstrap.data.preferences.repaymentRecords.find(
      (item) => item.id === 'record-snapshot'
    );
    assert.ok(record, 'repayment record should survive the round trip');
    assert.equal(record.balanceBefore, 500);
    assert.equal(record.paidPeriodsBefore, 0);
    assert.equal(record.remainingMonthsBefore, 24);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

/*
 * 删除分类之后,交易会变成「无分类」(前端口径:categoryId === '')。
 *
 * 这条链路原先整条是断的:库里的 category_id 是 NOT NULL + 外键,空串两样都不满足,
 * 于是导入时这些交易被 `!validCategoryIds.has('')` 整行跳过,而余额记录仍引用它们 ——
 * 外键失败让**整个导入回滚**,前端看到的却是删除成功,刷新后分类复活、同步无限重试。
 *
 * 现在服务端用一条用户范围内的哨兵分类承接,读取时再映射回 '',前端不变式保持不变。
 */
test('删除分类后交易保留为「未分类」,导入不再整批失败', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-uncategorized-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    const account = await registerUser(
      'sqlite',
      { email: 'uncategorized@example.com', password: 'uncategorized-password' },
      env
    );
    const userId = account.user.ledgerUserId;

    const base = {
      finance: {
        accounts: [{ id: 'account-cash', name: 'Cash', type: 'cash', initialBalance: 100, balance: 0 }],
        categories: [{ id: 'category-transport', name: '交通', kind: 'expense' }],
        transactions: [
          {
            id: 'transaction-bus',
            type: 'expense',
            accountId: 'account-cash',
            categoryId: 'category-transport',
            amount: 3,
            date: '2026-07-31T00:00:00.000Z',
            note: 'Bus'
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
        categoryLearningRules: [],
        categoryLearningEvents: [],
        smartBudgetPlan: null,
        smartBudgetHistory: [],
        monthlyIncome: 0,
        rssSubscriptions: []
      }
    };
    await replaceRelationalData('sqlite', base, env, userId);

    // 复刻「删除分类」后的状态:分类进回收站,交易引用清空。
    const afterDelete = structuredClone(base);
    afterDelete.finance.categories = [];
    afterDelete.finance.trashedCategories = [
      { id: 'category-transport', name: '交通', kind: 'expense', trashedAt: '2026-08-01T00:00:00.000Z' }
    ];
    afterDelete.finance.transactions[0].categoryId = '';

    // 这一步原先会抛 FOREIGN KEY constraint failed
    await replaceRelationalData('sqlite', afterDelete, env, userId);

    const bootstrap = await getRelationalBootstrap('sqlite', env, userId);
    const transactions = bootstrap.data.finance.transactions;
    assert.equal(transactions.length, 1, '交易不能因为分类被删而丢失');
    assert.equal(
      transactions[0].categoryId,
      '',
      '读取时必须还原成「未分类」的空串口径'
    );

    // 实现细节不能漏给用户
    const categoryIds = bootstrap.data.finance.categories.map((row) => row.id);
    assert.ok(
      categoryIds.every((value) => !String(value).startsWith('uncategorized:')),
      '哨兵分类不能出现在用户可见的分类列表里'
    );
    const trashedCategoryIds = bootstrap.data.finance.trashedCategories.map((row) => row.id);
    assert.ok(
      trashedCategoryIds.every((value) => !String(value).startsWith('uncategorized:')),
      '哨兵分类也不能出现在回收站的分类列表里'
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

/*
 * 「子分类」此前只存在于浏览器 store —— 服务端连 parent_id 这一列都没有,
 * 于是新建的子分类一刷新就变回一级分类(换设备同样丢)。
 * 这条用例盯的是「父子关系能真正落库并读回」。
 */
test('分类的父子关系能存进库并读回', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-category-parent-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    const account = await registerUser(
      'sqlite',
      { email: 'parent-id@example.com', password: 'parent-id-password' },
      env
    );
    const userId = account.user.ledgerUserId;

    const payload = {
      finance: {
        accounts: [{ id: 'account-cash', name: 'Cash', type: 'cash', initialBalance: 100, balance: 100 }],
        categories: [
          { id: 'category-food', name: '餐饮', kind: 'expense', sortOrder: 0 },
          { id: 'category-lunch', name: '午餐', kind: 'expense', sortOrder: 1, parentId: 'category-food' },
          // 父级指向一个不存在的分类:必须落成 null,而不是写下悬空引用
          { id: 'category-orphan', name: '孤儿', kind: 'expense', sortOrder: 2, parentId: 'category-missing' }
        ],
        transactions: [],
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
        categoryLearningRules: [],
        categoryLearningEvents: [],
        smartBudgetPlan: null,
        smartBudgetHistory: [],
        monthlyIncome: 0,
        rssSubscriptions: []
      }
    };

    await replaceRelationalData('sqlite', payload, env, userId);
    const bootstrap = await getRelationalBootstrap('sqlite', env, userId);
    const byId = new Map(bootstrap.data.finance.categories.map((row) => [row.id, row]));

    assert.equal(byId.get('category-lunch')?.parentId, 'category-food', '子分类的父级必须保留');
    assert.equal(byId.get('category-food')?.parentId, undefined, '一级分类没有父级');
    assert.equal(
      byId.get('category-orphan')?.parentId,
      undefined,
      '父级不存在时应落成空,不能写悬空引用'
    );
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

/*
 * 「简单录入」负债的三项内容必须落库。
 *
 * 简单模式只让用户填「还款项目 + 还款日期 + 本期应还金额」,而这三项此前
 * 从未进过库(列不存在、写入与读取都没有)—— 刷新之后负债只剩一个名字:
 * 到期日、金额、连「这是简单模式」都没了,界面上显示成「待补日期」。
 */
test('简单录入的负债能存进库并读回(模式 / 到期日 / 金额)', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'ledgerflow-simple-debt-'));
  const env = { LEDGERFLOW_DATA_DIR: dataDirectory, SQLITE_PATH: '' };
  try {
    await migrateRelationalDatabase('sqlite', env);
    const account = await registerUser(
      'sqlite',
      { email: 'simple-debt@example.com', password: 'simple-debt-password' },
      env
    );
    const userId = account.user.ledgerUserId;

    const payload = {
      finance: { accounts: [], categories: [], transactions: [], subscriptions: [] },
      preferences: {
        debts: [
          {
            id: 'debt-rent',
            name: '9 月房租',
            type: 'credit-card',
            status: 'active',
            balance: 0,
            entryMode: 'simple',
            simpleDueDate: '2026-12-20',
            simpleAmount: 3500
          },
          {
            id: 'debt-standard',
            name: '消费分期贷',
            type: 'loan',
            status: 'active',
            balance: 42000
          }
        ],
        repaymentRecords: [],
        investmentPositions: [],
        investmentPositionHistory: [],
        investmentGoals: [],
        investmentWatchlist: [],
        investmentAiMessages: [],
        creditDrafts: [],
        forecastBills: [],
        categoryLearningRules: [],
        categoryLearningEvents: [],
        smartBudgetPlan: null,
        smartBudgetHistory: [],
        monthlyIncome: 0,
        rssSubscriptions: []
      }
    };

    await replaceRelationalData('sqlite', payload, env, userId);
    const bootstrap = await getRelationalBootstrap('sqlite', env, userId);
    const byId = new Map(bootstrap.data.preferences.debts.map((row) => [row.id, row]));

    const simple = byId.get('debt-rent');
    assert.equal(simple?.entryMode, 'simple', '简单模式必须保留,否则刷新后变成完整模式');
    assert.equal(simple?.simpleDueDate, '2026-12-20', '到期日必须保留');
    assert.equal(simple?.simpleAmount, 3500, '本期应还金额必须保留');

    // 完整模式的负债不该被凭空写上简单模式的字段
    const standard = byId.get('debt-standard');
    assert.equal(standard?.entryMode, undefined);
    assert.equal(standard?.simpleDueDate, undefined);
    assert.equal(standard?.simpleAmount, undefined);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
