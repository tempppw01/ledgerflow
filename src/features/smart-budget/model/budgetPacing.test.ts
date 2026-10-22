import { describe, expect, it } from 'vitest';
import { calculateBudgetPacing, getBudgetMonthMeta } from './budgetPacing';

describe('calculateBudgetPacing', () => {
  it('splits the remaining budget across the remaining days', () => {
    const pacing = calculateBudgetPacing({
      monthKey: '2025-02',
      totalBudget: 6000,
      totalSpent: 3000,
      now: new Date(2025, 1, 15)
    });

    expect(pacing?.daysInMonth).toBe(28);
    expect(pacing?.daysPassed).toBe(15);
    expect(pacing?.daysRemaining).toBe(13);
    expect(pacing?.dailyAllowance).toBeCloseTo(3000 / 13, 5);
    expect(pacing?.status).toBe('safe');
  });

  it('flags overspending pace when projected spend exceeds the budget', () => {
    const pacing = calculateBudgetPacing({
      monthKey: '2025-02',
      totalBudget: 3000,
      totalSpent: 2000,
      now: new Date(2025, 1, 10)
    });

    expect(pacing?.projectedSpent).toBeGreaterThan(3000);
    expect(pacing?.projectedOverspend).toBeGreaterThan(0);
    expect(pacing?.status).toBe('over');
  });

  it('treats a finished month as fully elapsed', () => {
    const pacing = calculateBudgetPacing({
      monthKey: '2025-01',
      totalBudget: 3000,
      totalSpent: 1000,
      now: new Date(2025, 1, 15)
    });

    expect(pacing?.isCurrentMonth).toBe(false);
    expect(pacing?.daysPassed).toBe(31);
    expect(pacing?.daysRemaining).toBe(0);
  });
});

describe('getBudgetMonthMeta', () => {
  it('returns the number of days in the month', () => {
    expect(getBudgetMonthMeta('2024-02')?.daysInMonth).toBe(29);
    expect(getBudgetMonthMeta('2025-02')?.daysInMonth).toBe(28);
    expect(getBudgetMonthMeta('bad')).toBeNull();
  });
});
