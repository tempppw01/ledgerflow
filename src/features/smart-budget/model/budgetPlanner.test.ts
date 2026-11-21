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

  it('never produces a negative category budget on small incomes', () => {
    // 曾经:roundToTen 把各份都进位到 10 的倍数,小预算下各份之和会超过灵活预算,
    // 差值是个负数,而代码把这笔负数整笔压在第一个分类上 —— 于是出现「餐饮 −2」。
    // 实测原实现在收入 ≤ 2619 元时可复现(最差 −8)。学生身份也是这个量级。
    const identities = ['student', 'employee', 'freelancer', 'other'] as const;
    const cases: Array<{ income: number; fixed: number; ratio: number }> = [
      { income: 100, fixed: 12, ratio: 0.3 },
      { income: 137, fixed: 68, ratio: 0.1 },
      { income: 155, fixed: 77, ratio: 0.25 },
      { income: 248, fixed: 99, ratio: 0.6 },
      { income: 1068, fixed: 1000, ratio: 0.1 },
      { income: 2509, fixed: 2500, ratio: 0.6 }
    ];

    for (const identity of identities) {
      for (const { income, fixed, ratio } of cases) {
        const result = generateBudgetRecommendation({
          identity,
          monthlyIncome: income,
          monthlyFixedExpense: fixed,
          savingsRatio: ratio
        });
        const label = `${identity} ${income}/${fixed}/${ratio}`;
        for (const item of result.categoryBudgets) {
          expect(item.amount, `${label} 的「${item.category}」为负`).toBeGreaterThanOrEqual(0);
        }
        expect(
          result.categoryBudgets.reduce((sum, item) => sum + item.amount, 0),
          `${label} 的分类合计不等于月收入`
        ).toBe(result.monthlyIncome);
      }
    }
  });

  it('never lets savings exceed the disposable income', () => {
    // 可支配 9 元、比例 0.6 时 roundToTen(5.4) = 10,比可支配收入还多 1 元,
    // 直接把 flexibleBudget 顶成负数。储蓄额不允许超过可支配收入。
    const result = generateBudgetRecommendation({
      identity: 'employee',
      monthlyIncome: 2509,
      monthlyFixedExpense: 2500,
      savingsRatio: 0.6
    });

    expect(result.disposableIncome).toBe(9);
    expect(result.savingsAmount).toBeLessThanOrEqual(result.disposableIncome);
    expect(result.flexibleBudget).toBeGreaterThanOrEqual(0);
    expect(result.flexibleBudget).toBe(result.disposableIncome - result.savingsAmount);
  });
});
