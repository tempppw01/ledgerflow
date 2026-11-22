import { beforeEach, describe, expect, it } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 余额计算的等价性:优化后的单趟累加必须与「每个账户遍历一遍全部流水」的朴素写法结果完全一致。
 *
 * 这段逻辑决定用户看到的每个账户余额,而它的写法在性能优化时被改过
 * (O(账户 × 流水) → O(流水)),这里用一份朴素参照实现逐条比对。
 */
function naiveBalances(accounts: Account[], transactions: TransactionItem[]): Array<{ id: string; balance: number }> {
  return accounts.map((account) => {
    const base = Math.round(Number(account.initialBalance ?? 0) * 100) / 100;
    const delta = transactions.reduce((sum, item) => {
      if (item.accountId !== account.id || item.trashedAt) {
        return sum;
      }
      if (item.status === 'pending' || item.status === 'closed' || item.status === 'failed') {
        return sum;
      }
      const amount = Math.abs(Number(item.amount) || 0);
      const inflow = item.type === 'income';
      const refundLike = item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal';
      return sum + (inflow !== refundLike ? amount : -amount);
    }, 0);
    return { id: account.id, balance: Math.round((base + delta) * 100) / 100 };
  });
}

const accounts: Account[] = [
  { id: 'acc-a', name: '现金', type: 'cash', initialBalance: 1000, sortOrder: 1 },
  { id: 'acc-b', name: '银行卡', type: 'debit', initialBalance: 2500.5, sortOrder: 2 },
  { id: 'acc-c', name: '不用的账户', type: 'cash', initialBalance: 0, sortOrder: 3 }
];

function row(overrides: Partial<TransactionItem> & { id: string }): TransactionItem {
  return {
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-a',
    amount: 10,
    date: '2026-11-01T00:00:00.000Z',
    note: '',
    tags: [],
    source: 'manual',
    status: 'completed',
    ...overrides
  } as TransactionItem;
}

describe('账户余额计算的等价性', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('各种状态、退款方向与悬空账户下都与朴素实现一致', () => {
    const transactions: TransactionItem[] = [
      row({ id: 't1', amount: 100 }),
      row({ id: 't2', type: 'income', amount: 250.75, accountId: 'acc-b' }),
      row({ id: 't3', amount: 30, status: 'pending' }),
      row({ id: 't4', amount: 40, status: 'closed' }),
      row({ id: 't5', amount: 50, status: 'failed', accountId: 'acc-b' }),
      row({ id: 't6', amount: 60, trashedAt: '2026-11-02T00:00:00.000Z' }),
      row({ id: 't7', amount: 70, adjustmentKind: 'refund' }),
      row({ id: 't8', type: 'income', amount: 80, adjustmentKind: 'reversal', accountId: 'acc-b' }),
      row({ id: 't9', amount: 90, accountId: 'acc-does-not-exist' }),
      row({ id: 't10', amount: 0.1, accountId: 'acc-a' }),
      row({ id: 't11', amount: 0.2, accountId: 'acc-a' })
    ];

    useFinanceStore.setState({
      hasHydrated: true,
      transactions,
      trashedTransactions: [],
      categories: [{ id: 'cat-1', name: '餐饮', kind: 'expense', sortOrder: 1 }],
      trashedCategories: [],
      accounts,
      trashedAccounts: [],
      balanceChangeEntries: [],
      subscriptions: [],
      trashedSubscriptions: [],
      categoryLearningRules: [],
      categoryLearningEvents: []
    });

    // 触发一次写操作,让 store 重算余额
    useFinanceStore.getState().addTransaction({
      type: 'expense',
      categoryId: 'cat-1',
      accountId: 'acc-a',
      amount: 1,
      date: '2026-11-20T00:00:00.000Z',
      note: '触发重算',
      tags: [],
      source: 'manual',
      status: 'completed'
    });

    const actual = useFinanceStore
      .getState()
      .accounts.map((item) => ({ id: item.id, balance: Number(item.balance) }));
    const expected = naiveBalances(
      accounts,
      [
        ...transactions,
        row({ id: 'trigger', amount: 1, date: '2026-11-20T00:00:00.000Z' })
      ] as TransactionItem[]
    );

    expect(actual).toEqual(expected);
  });

  it('浮点相加不会让余额出现长尾小数', () => {
    const transactions = [
      row({ id: 'a', amount: 0.1 }),
      row({ id: 'b', amount: 0.2 }),
      row({ id: 'c', amount: 0.3 })
    ];
    useFinanceStore.setState({
      hasHydrated: true,
      transactions,
      trashedTransactions: [],
      categories: [{ id: 'cat-1', name: '餐饮', kind: 'expense', sortOrder: 1 }],
      trashedCategories: [],
      accounts: [{ id: 'acc-a', name: '现金', type: 'cash', initialBalance: 100, sortOrder: 1 }],
      trashedAccounts: [],
      balanceChangeEntries: [],
      subscriptions: [],
      trashedSubscriptions: [],
      categoryLearningRules: [],
      categoryLearningEvents: []
    });
    useFinanceStore.getState().removeTransaction('a');

    const balance = Number(useFinanceStore.getState().accounts[0].balance);
    expect(balance).toBe(99.5); // 100 − 0.2 − 0.3(0.1 那笔已进回收站),且没有浮点长尾
    expect(String(balance)).not.toContain('000000');
  });
});