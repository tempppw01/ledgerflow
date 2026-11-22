import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 随机操作序列 + 全局不变量。
 *
 * 单点功能测试查不出「操作 A 之后再做操作 B」的问题,而这正是记账软件最容易积累脏状态的地方
 * (删账户、删分类、回收站、退款、生成订阅支出互相叠加)。这里用固定种子的伪随机序列跑几百步,
 * **每一步之后都检查全局不变量**;失败时种子与操作序列会打印出来,可复现。
 *
 * 检查的不变量:
 * 1. 账户余额 = 初始余额 + Σ(影响余额的流水),且为有限数
 * 2. 同一个 id 不会同时出现在「在用」和「回收站」两个数组里,数组内也不重复
 * 3. 所有金额字段都是有限数(不出现 NaN/Infinity)
 * 4. 流水的 accountId 要么指向在用账户,要么为空(暂无强制,但**不得出现 NaN 等脏值**)
 */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function resetStore() {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions: [],
    trashedTransactions: [],
    categories: [
      { id: 'cat-a', name: '餐饮', kind: 'expense', sortOrder: 1 },
      { id: 'cat-b', name: '交通', kind: 'expense', sortOrder: 2 }
    ],
    trashedCategories: [],
    accounts: [
      { id: 'acc-a', name: '现金', type: 'cash', initialBalance: 1000, balance: 1000, sortOrder: 1 },
      { id: 'acc-b', name: '银行卡', type: 'debit', initialBalance: 5000, balance: 5000, sortOrder: 2 }
    ],
    trashedAccounts: [],
    balanceChangeEntries: [],
    subscriptions: [
      {
        id: 'sub-a',
        name: '音乐会员',
        kind: 'digital',
        amount: 15,
        currency: 'CNY',
        billingCycle: 'monthly',
        accountId: 'acc-a',
        status: 'active',
        renewalDate: '2026-11-20',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    trashedSubscriptions: [],
    categoryLearningRules: [],
    categoryLearningEvents: []
  });
}

function state() {
  return useFinanceStore.getState();
}

/** 账户余额 = 初始余额 + Σ(该账户下影响余额的流水方向金额)。 */
function expectedBalance(accountId: string): number {
  const snapshot = state();
  const account = snapshot.accounts.find((item) => item.id === accountId);
  if (!account) return Number.NaN;
  const delta = snapshot.transactions
    .filter(
      (item) =>
        item.accountId === accountId &&
        !item.trashedAt &&
        item.status !== 'pending' &&
        item.status !== 'closed' &&
        item.status !== 'failed'
    )
    .reduce((sum, item) => {
      const inflow = item.type === 'income';
      const refundLike = item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal';
      const amount = Math.abs(Number(item.amount) || 0);
      const signed = inflow !== refundLike ? amount : -amount;
      return sum + signed;
    }, 0);
  return Number(account.initialBalance ?? 0) + delta;
}

function collectViolations(step: number, op: string, seed: number): string[] {
  const snapshot = state();
  const problems: string[] = [];

  // 1) 余额一致性(允许 1 分误差)
  for (const account of snapshot.accounts) {
    const expected = expectedBalance(account.id);
    if (!Number.isFinite(Number(account.balance))) {
      problems.push(`账户 ${account.id} 余额不是有限数:${account.balance}`);
      continue;
    }
    if (Math.abs(Number(account.balance) - expected) > 0.011) {
      problems.push(
        `账户 ${account.id} 余额 ${account.balance} 与按流水重算的 ${expected.toFixed(2)} 不一致`
      );
    }
  }

  // 2) 数组互斥且内部不重复
  const pairs: Array<[string, TransactionItem[], TransactionItem[]]> = [
    ['交易', snapshot.transactions, snapshot.trashedTransactions],
    ['分类', snapshot.categories as never, snapshot.trashedCategories as never],
    ['账户', snapshot.accounts as never, snapshot.trashedAccounts as never]
  ];
  for (const [label, active, trashed] of pairs) {
    const activeIds = active.map((item) => item.id);
    const trashedIds = trashed.map((item) => item.id);
    if (new Set(activeIds).size !== activeIds.length) {
      problems.push(`${label}:在用列表里有重复 id`);
    }
    if (new Set(trashedIds).size !== trashedIds.length) {
      problems.push(`${label}:回收站里有重复 id`);
    }
    const both = activeIds.filter((id) => trashedIds.includes(id));
    if (both.length) {
      problems.push(`${label}:同一 id 同时在用与回收站:${both.join(',')}`);
    }
  }

  // 3) 金额字段不得出现 NaN/Infinity
  for (const item of snapshot.transactions) {
    if (!Number.isFinite(Number(item.amount))) {
      problems.push(`交易 ${item.id} 金额不是有限数:${item.amount}`);
    }
  }
  for (const item of snapshot.subscriptions) {
    if (!Number.isFinite(Number(item.amount))) {
      problems.push(`订阅 ${item.id} 金额不是有限数:${item.amount}`);
    }
  }

  return problems.slice(0, 4).map((text) => `[seed=${seed} step=${step} op=${op}] ${text}`);
}

describe('随机操作序列的全局不变量', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 22, 10, 0, 0));
    localStorage.clear();
    resetStore();
  });

  it('跑 300 步随机操作,每一步之后不变量都成立', () => {
    const seed = 20261122;
    const random = makeRandom(seed);
    const pick = <T,>(items: T[]): T | undefined =>
      items.length ? items[Math.floor(random() * items.length)] : undefined;
    const violations: string[] = [];
    const performed: Record<string, number> = {};
    const record = (name: string) => {
      performed[name] = (performed[name] || 0) + 1;
    };

    for (let step = 0; step < 300; step += 1) {
      const op = [
        'add-transaction',
        'trash-transaction',
        'restore-transaction',
        'add-account',
        'trash-account',
        'restore-account',
        'add-category',
        'trash-category',
        'restore-category',
        'generate-subscription',
        'refund',
        'update-amount'
      ][Math.floor(random() * 12)];

      try {
        switch (op) {
          case 'add-transaction': {
            record('add-transaction');
            const account = pick(state().accounts);
            const category = pick(state().categories);
            if (!account) break;
            state().addTransaction({
              type: random() > 0.5 ? 'expense' : 'income',
              categoryId: category?.id ?? '',
              accountId: account.id,
              amount: Math.round(random() * 10000) / 100,
              date: new Date(2026, 10, 1 + Math.floor(random() * 28)).toISOString(),
              note: `步骤 ${step}`,
              tags: [],
              source: 'manual',
              status: 'completed'
            });
            break;
          }
          case 'trash-transaction': {
            record('trash-transaction');
            const row = pick(state().transactions);
            if (row) state().removeTransaction(row.id);
            break;
          }
          case 'restore-transaction': {
            record('restore-transaction');
            const row = pick(state().trashedTransactions);
            if (row) state().restoreTransaction(row.id);
            break;
          }
          case 'add-account': {
            record('add-account');
            state().addAccount(
              `账户 ${step}`,
              'cash',
              Math.round(random() * 1000) / 100
            );
            break;
          }
          case 'trash-account': {
            record('trash-account');
            const row = pick(state().accounts);
            if (row) state().removeAccount(row.id);
            break;
          }
          case 'restore-account': {
            record('restore-account');
            const row = pick(state().trashedAccounts);
            if (row) state().restoreAccount(row.id);
            break;
          }
          case 'add-category': {
            record('add-category');
            state().addCategory(`分类 ${step}`, { kind: 'expense' });
            break;
          }
          case 'trash-category': {
            record('trash-category');
            const row = pick(state().categories);
            if (row) state().removeCategory(row.id);
            break;
          }
          case 'restore-category': {
            record('restore-category');
            const row = pick(state().trashedCategories);
            if (row) state().restoreCategory(row.id);
            break;
          }
          case 'generate-subscription': {
            record('generate-subscription');
            const sub = pick(state().subscriptions);
            if (sub) {
              try {
                state().generateSubscriptionTransaction(sub.id);
              } catch {
                // 账户缺失等预期内拒绝
              }
            }
            break;
          }
          case 'refund': {
            record('refund');
            const row = pick(
              state().transactions.filter((item) => item.type === 'expense' && item.status === 'completed')
            );
            if (row) {
              try {
                state().refundTransaction({
                  transactionId: row.id,
                  amount: Math.max(0.01, Math.round(Number(row.amount) * random() * 100) / 100)
                });
              } catch {
                // 超过可退金额等预期内拒绝
              }
            }
            break;
          }
          case 'update-amount': {
            record('update-amount');
            const row = pick(state().transactions);
            if (row) {
              try {
                state().updateTransaction(row.id, {
                  ...row,
                  amount: Math.max(0.01, Math.round(random() * 5000) / 100)
                });
              } catch {
                // 退款不变量拒绝,属预期
              }
            }
            break;
          }
        }
      } catch (error) {
        violations.push(
          `[seed=${seed} step=${step} op=${op}] 操作抛出了未预期的错误:${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      violations.push(...collectViolations(step, op, seed));
      if (violations.length >= 8) break;
    }

    // 扫描必须真的做了事,否则「通过」是空转:确认关键操作都执行过
    expect(performed['add-transaction'] ?? 0, JSON.stringify(performed)).toBeGreaterThan(10);
    expect(performed['trash-transaction'] ?? 0).toBeGreaterThan(5);
    expect(performed['restore-transaction'] ?? 0).toBeGreaterThan(0);
    expect(performed['add-account'] ?? 0).toBeGreaterThan(2);
    expect(performed['trash-account'] ?? 0).toBeGreaterThan(0);
    expect(performed['generate-subscription'] ?? 0).toBeGreaterThan(0);
    expect(performed['refund'] ?? 0).toBeGreaterThan(0);
    expect(performed['update-amount'] ?? 0).toBeGreaterThan(0);

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
/**
 * 反向验证:不变量检查器本身要有牙齿。
 *
 * 人为把某个账户余额改错、再制造「同一 id 同时在用与回收站」,检查器必须报出来 ——
 * 否则上面那个「扫描通过」毫无意义。
 */
describe('不变量检查器本身', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('能发现余额与流水不一致', () => {
    useFinanceStore.setState({
      accounts: [
        { id: 'acc-a', name: '现金', type: 'cash', initialBalance: 1000, balance: 12345, sortOrder: 1 }
      ]
    });
    const problems = collectViolations(0, 'tamper-balance', 1);
    expect(problems.join('\n')).toContain('不一致');
  });

  it('能发现同一 id 同时在用与回收站', () => {
    const row = {
      id: 'tx-dup',
      type: 'expense' as const,
      categoryId: 'cat-a',
      accountId: 'acc-a',
      amount: 10,
      date: '2026-11-01T00:00:00.000Z',
      note: '重复',
      tags: [],
      source: 'manual' as const,
      status: 'completed' as const
    };
    useFinanceStore.setState({
      transactions: [row],
      trashedTransactions: [{ ...row, trashedAt: '2026-11-02T00:00:00.000Z' }]
    });
    const problems = collectViolations(0, 'tamper-duplicate', 1);
    expect(problems.join('\n')).toContain('同时在用与回收站');
  });

  it('能发现 NaN 金额', () => {
    useFinanceStore.setState({
      transactions: [
        {
          id: 'tx-nan',
          type: 'expense',
          categoryId: 'cat-a',
          accountId: 'acc-a',
          amount: Number.NaN,
          date: '2026-11-01T00:00:00.000Z',
          note: 'NaN',
          tags: [],
          source: 'manual',
          status: 'completed'
        }
      ]
    });
    const problems = collectViolations(0, 'tamper-nan', 1);
    expect(problems.join('\n')).toContain('不是有限数');
  });
});
