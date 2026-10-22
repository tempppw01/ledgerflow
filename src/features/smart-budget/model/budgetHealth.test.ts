import { describe, expect, it } from 'vitest';
import { calculateBudgetHealth } from './budgetHealth';

describe('calculateBudgetHealth', () => {
  it('gives a perfect score when nothing is overspent and pace is normal', () => {
    const health = calculateBudgetHealth({
      executionRate: 1,
      overspentCount: 0,
      monthIncome: 10000,
      monthExpense: 6000
    });

    expect(health.score).toBe(100);
    expect(health.level).toBe('excellent');
    expect(health.factors).toHaveLength(3);
  });

  it('penalises overspent categories and lists the reason', () => {
    const health = calculateBudgetHealth({
      executionRate: 1.5,
      overspentCount: 3,
      monthIncome: 10000,
      monthExpense: 8000
    });

    expect(health.score).toBeLessThan(60);
    expect(health.level).toBe('risk');
    const overspend = health.factors.find((item) => item.key === 'overspend');
    expect(overspend?.penalty).toBe(30);
    expect(overspend?.detail).toContain('3 个分类');
  });

  it('penalises when income cannot cover spending', () => {
    const health = calculateBudgetHealth({
      executionRate: 0.9,
      overspentCount: 0,
      monthIncome: 5000,
      monthExpense: 8000
    });

    const balance = health.factors.find((item) => item.key === 'balance');
    expect(balance?.penalty).toBeGreaterThan(0);
  });
});
