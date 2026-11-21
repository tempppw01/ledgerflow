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

  it('does not treat a future month as an elapsed one', () => {
    // 未来月份曾经和「历史月份」走同一条分支,于是界面会把还没开始的月份写成
    // 「该月共 31 天,已全部走完,属于历史月份」。可复现路径:存在一笔未来日期的
    // 流水(日期上限是 2100),该月份进入统计月份列表并排在第一位成为默认选中。
    const pacing = calculateBudgetPacing({
      monthKey: '2026-12',
      totalBudget: 3100,
      totalSpent: 0,
      now: new Date(2026, 10, 21)
    });

    expect(pacing?.isCurrentMonth).toBe(false);
    expect(pacing?.isFutureMonth).toBe(true);
    expect(pacing?.daysPassed).toBe(0);
    expect(pacing?.daysRemaining).toBe(31);
    // 未开始的月份不应被算出「已超支」节奏
    expect(pacing?.status).toBe('safe');
    expect(pacing?.spentPerDay).toBe(0);
  });

  it('marks a past month as not future and the current month as neither', () => {
    const now = new Date(2026, 10, 21);
    expect(calculateBudgetPacing({ monthKey: '2026-10', totalBudget: 100, totalSpent: 0, now })?.isFutureMonth).toBe(false);
    expect(calculateBudgetPacing({ monthKey: '2026-11', totalBudget: 100, totalSpent: 0, now })?.isFutureMonth).toBe(false);
    expect(calculateBudgetPacing({ monthKey: '2026-11', totalBudget: 100, totalSpent: 0, now })?.isCurrentMonth).toBe(true);
  });
});

describe('getBudgetMonthMeta', () => {
  it('returns the number of days in the month', () => {
    expect(getBudgetMonthMeta('2024-02')?.daysInMonth).toBe(29);
    expect(getBudgetMonthMeta('2025-02')?.daysInMonth).toBe(28);
    expect(getBudgetMonthMeta('bad')).toBeNull();
  });
});
