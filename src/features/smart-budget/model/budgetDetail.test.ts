import { describe, expect, it } from 'vitest';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import { buildBudgetCategoryDetail } from './budgetDetail';

const categories: Category[] = [
  { id: 'cat-1', name: '餐饮', kind: 'expense' },
  { id: 'cat-2', name: '交通', kind: 'expense' }
];

const transactions = [
  {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    amount: 120,
    date: '2026-10-02',
    note: '午餐',
    tags: []
  },
  {
    id: 'tx-2',
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    amount: 80,
    date: '2026-09-08',
    note: '晚餐',
    tags: []
  },
  {
    id: 'tx-3',
    type: 'expense',
    categoryId: 'cat-2',
    accountId: 'acc-1',
    amount: 400,
    date: '2026-10-03',
    note: '加油',
    tags: []
  },
  {
    id: 'tx-4',
    type: 'income',
    categoryId: 'cat-2',
    accountId: 'acc-1',
    amount: 900,
    date: '2026-10-03',
    note: '报销',
    tags: []
  }
] as TransactionItem[];

describe('buildBudgetCategoryDetail', () => {
  it('only counts expenses of the target category', () => {
    const detail = buildBudgetCategoryDetail({
      category: '餐饮',
      budgetAmount: 1000,
      transactions,
      categories,
      monthKey: '2026-10'
    });

    expect(detail.recentTransactions.map((item) => item.id)).toEqual(['tx-1', 'tx-2']);
    expect(detail.totalSpentInWindow).toBe(200);
  });

  it('builds one point per month inside the window, oldest first', () => {
    const detail = buildBudgetCategoryDetail({
      category: '餐饮',
      budgetAmount: 1000,
      transactions,
      categories,
      monthKey: '2026-10',
      monthWindow: 3
    });

    expect(detail.monthlyPoints.map((item) => item.monthKey)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10'
    ]);
    expect(detail.monthlyPoints.map((item) => item.spent)).toEqual([0, 80, 120]);
    expect(detail.averageMonthlySpent).toBeCloseTo(200 / 3, 5);
  });

  it('limits the number of listed transactions', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `tx-many-${index}`,
      type: 'expense',
      categoryId: 'cat-1',
      accountId: 'acc-1',
      amount: 10,
      date: '2026-10-01',
      note: '消费',
      tags: []
    })) as TransactionItem[];

    const detail = buildBudgetCategoryDetail({
      category: '餐饮',
      budgetAmount: 1000,
      transactions: many,
      categories,
      monthKey: '2026-10',
      transactionLimit: 3
    });

    expect(detail.recentTransactions).toHaveLength(3);
  });
});
