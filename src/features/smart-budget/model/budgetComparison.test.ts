import { describe, expect, it } from 'vitest';
import { buildBudgetComparison, shiftMonthKey } from './budgetComparison';
import { BudgetRecommendation } from './budgetPlanner';

const recommendation: BudgetRecommendation = {
  monthlyIncome: 10000,
  monthlyFixedExpense: 3000,
  disposableIncome: 7000,
  savingsAmount: 2000,
  flexibleBudget: 5000,
  categoryBudgets: [
    { category: '固定支出', amount: 3000, ratio: 0.3 },
    { category: '储蓄/投资', amount: 2000, ratio: 0.2 },
    { category: '餐饮', amount: 2000, ratio: 0.2 },
    { category: '交通', amount: 1200, ratio: 0.12 },
    { category: '娱乐社交', amount: 1800, ratio: 0.18 }
  ]
};

describe('shiftMonthKey', () => {
  it('moves across year boundaries', () => {
    expect(shiftMonthKey('2025-01', -1)).toBe('2024-12');
    expect(shiftMonthKey('2025-12', 1)).toBe('2026-01');
  });
});

describe('buildBudgetComparison', () => {
  it('compares this month against the previous month', () => {
    const comparison = buildBudgetComparison({
      recommendation,
      categories: [
        { id: 'food', name: '餐饮' },
        { id: 'traffic', name: '交通' }
      ],
      transactions: [
        {
          id: '1',
          type: 'expense',
          categoryId: 'food',
          accountId: 'cash',
          amount: 1200,
          date: '2025-02-05',
          note: '',
          tags: []
        },
        {
          id: '2',
          type: 'expense',
          categoryId: 'food',
          accountId: 'cash',
          amount: 800,
          date: '2025-01-05',
          note: '',
          tags: []
        }
      ],
      monthKey: '2025-02'
    });

    const dining = comparison.rows.find((row) => row.category === '餐饮');
    expect(dining?.currentSpent).toBe(1200);
    expect(dining?.previousSpent).toBe(800);
    expect(dining?.spentDelta).toBe(400);
    expect(comparison.previousMonthKey).toBe('2025-01');
  });
});
