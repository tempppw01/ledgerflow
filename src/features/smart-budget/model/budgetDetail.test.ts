import { describe, expect, it } from 'vitest';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import { buildBudgetCategoryDetail } from './budgetDetail';
import { buildBudgetTrackingRows } from './budgetInsights';

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

  /**
   * 详情抽屉与汇总列表必须给出同一个数字。
   * 之前退款/冲正单(它们的 type 也是 expense)在详情里被当成一笔普通支出一路累加,
   * 于是同一个分类两处对不上:支出 100 + 退款 40 → 列表 60、抽屉 140;全额冲正时
   * 抽屉显示 500 而列表是 0。
   */
  it('agrees with the tracking row on refunds and reversals', () => {
    const recommendation = {
      monthlyIncome: 10000,
      monthlyFixedExpense: 0,
      disposableIncome: 10000,
      savingsAmount: 0,
      flexibleBudget: 10000,
      categoryBudgets: [{ category: '餐饮', amount: 1000, ratio: 0.1 }]
    } as unknown as Parameters<typeof buildBudgetTrackingRows>[0]['recommendation'];

    const make = (over: Partial<TransactionItem>): TransactionItem =>
      ({
        id: 'x',
        type: 'expense',
        categoryId: 'cat-1',
        accountId: 'acc-1',
        amount: 0,
        date: '2026-11-05',
        note: '',
        tags: [],
        ...over
      }) as TransactionItem;

    const cases: Array<{ name: string; transactions: TransactionItem[] }> = [
      { name: '部分退款', transactions: [make({ id: 'a', amount: 100 }), make({ id: 'b', amount: 40, adjustmentKind: 'refund' })] },
      { name: '全额冲正', transactions: [make({ id: 'a', amount: 250 }), make({ id: 'b', amount: 250, adjustmentKind: 'reversal' })] },
      { name: '退款多于支出', transactions: [make({ id: 'a', amount: 50 }), make({ id: 'b', amount: 80, adjustmentKind: 'refund' })] }
    ];

    for (const item of cases) {
      const rows = buildBudgetTrackingRows({
        recommendation,
        transactions: item.transactions,
        categories,
        monthKey: '2026-11'
      });
      const detail = buildBudgetCategoryDetail({
        category: '餐饮',
        budgetAmount: 1000,
        transactions: item.transactions,
        categories,
        monthKey: '2026-11',
        monthWindow: 1
      });

      const detailSpent = detail.monthlyPoints[detail.monthlyPoints.length - 1].spent;
      expect(detailSpent, `${item.name}:抽屉与列表不一致`).toBe(rows[0].spentAmount);
      expect(detail.totalSpentInWindow, `${item.name}:窗口合计与列表不一致`).toBe(rows[0].spentAmount);
      expect(detailSpent).toBeGreaterThanOrEqual(0);
    }
  });
});
