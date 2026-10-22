import { describe, expect, it } from 'vitest';
import { buildBudgetOverview } from './budgetOverview';
import { appendBudgetActionLog } from './budgetActions';
import { formatMonthKey, monthLabelFromKey, parseDateInput } from './budgetDate';

const rows = [
  {
    category: '餐饮',
    budgetAmount: 1000,
    spentAmount: 1200,
    ratio: 1.2,
    diff: 200,
    isOverspent: true
  },
  {
    category: '交通',
    budgetAmount: 500,
    spentAmount: 200,
    ratio: 0.4,
    diff: -300,
    isOverspent: false
  }
];

describe('buildBudgetOverview', () => {
  it('summarizes budget, spending and overspent counts', () => {
    const overview = buildBudgetOverview({ rows, monthIncome: 8000, monthExpense: 1400 });

    expect(overview.totalBudget).toBe(1500);
    expect(overview.totalSpent).toBe(1400);
    expect(overview.remainingAmount).toBe(100);
    expect(overview.executionRate).toBeCloseTo(0.9333, 4);
    expect(overview.overspentCount).toBe(1);
    expect(overview.safeCount).toBe(1);
    expect(overview.monthIncome).toBe(8000);
    expect(overview.monthExpense).toBe(1400);
  });

  it('falls back to a zero execution rate when there is no budget', () => {
    const overview = buildBudgetOverview({ rows: [], monthIncome: 0, monthExpense: 0 });

    expect(overview.totalBudget).toBe(0);
    expect(overview.executionRate).toBe(0);
    expect(overview.safeCount).toBe(0);
  });
});

describe('appendBudgetActionLog', () => {
  it('puts the newest entry first', () => {
    const entry = {
      id: 'a',
      createdAt: '2026-10-01T00:00:00.000Z',
      type: 'adjust-category' as const,
      category: '餐饮',
      delta: 100,
      message: '调整餐饮预算'
    };
    const logs = appendBudgetActionLog([{ ...entry, id: 'b' }], entry);

    expect(logs.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps at most 12 records', () => {
    const base = {
      createdAt: '2026-10-01T00:00:00.000Z',
      type: 'adjust-category' as const,
      category: '餐饮',
      delta: 10,
      message: '调整'
    };
    const logs = Array.from({ length: 12 }, (_, index) => ({ ...base, id: `id-${index}` }));
    const next = appendBudgetActionLog(logs, { ...base, id: 'newest' });

    expect(next).toHaveLength(12);
    expect(next[0].id).toBe('newest');
  });
});

describe('budgetDate helpers', () => {
  it('parses plain YYYY-MM-DD strings without timezone shifts', () => {
    const date = parseDateInput('2026-10-05');

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(5);
    expect(formatMonthKey(date)).toBe('2026-10');
  });

  it('falls back to Date parsing for other formats', () => {
    const date = parseDateInput('2026/10/05');
    expect(Number.isNaN(date.getTime())).toBe(false);
  });

  it('renders a readable month label', () => {
    expect(monthLabelFromKey('2026-10')).toBe('2026 年 10 月');
  });
});
