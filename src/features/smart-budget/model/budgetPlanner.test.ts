import { describe, expect, it } from 'vitest';
import { applyCategoryBudgetEdits, generateBudgetRecommendation } from './budgetPlanner';

describe('generateBudgetRecommendation', () => {
  it('should keep total category budgets equal to monthly income', () => {
    const result = generateBudgetRecommendation({
      identity: 'employee',
      monthlyIncome: 12000,
      monthlyFixedExpense: 4000,
      savingsRatio: 0.35
    });

    const total = result.categoryBudgets.reduce((sum, item) => sum + item.amount, 0);
    expect(total).toBe(result.monthlyIncome);
    expect(result.flexibleBudget).toBeGreaterThan(0);
  });

  it('should throw when income is zero', () => {
    expect(() =>
      generateBudgetRecommendation({
        identity: 'student',
        monthlyIncome: 0,
        monthlyFixedExpense: 1000,
        savingsRatio: 0.2
      })
    ).toThrow('每月收入必须大于 0。');
  });

  it('should throw when fixed expense is not lower than income', () => {
    expect(() =>
      generateBudgetRecommendation({
        identity: 'freelancer',
        monthlyIncome: 6000,
        monthlyFixedExpense: 6000,
        savingsRatio: 0.3
      })
    ).toThrow('固定支出需要小于月收入，才能生成可执行预算。');
  });

  it('supports quick category budget edits on result page', () => {
    const result = generateBudgetRecommendation({
      identity: 'employee',
      monthlyIncome: 10000,
      monthlyFixedExpense: 3000,
      savingsRatio: 0.3
    });

    const edited = applyCategoryBudgetEdits(result, {
      餐饮: 1800,
      '储蓄/投资': 2400
    });

    expect(edited.categoryBudgets.find((item) => item.category === '餐饮')?.amount).toBe(1800);
    expect(edited.savingsAmount).toBe(2400);
  });
});
