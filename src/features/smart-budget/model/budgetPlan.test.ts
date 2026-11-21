import { describe, expect, it } from 'vitest';
import { BudgetRecommendation } from './budgetPlanner';
import {
  applyBalancedCategoryEdit,
  buildBudgetSignature,
  syncRecommendationWithExpenseCategories
} from './budgetPlan';

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

describe('syncRecommendationWithExpenseCategories', () => {
  it('maps flexible weights onto the real expense categories', () => {
    const synced = syncRecommendationWithExpenseCategories(recommendation, [
      { name: '餐饮', kind: 'expense' },
      { name: '交通', kind: 'expense' },
      { name: '工资', kind: 'income' }
    ]);

    const names = synced.categoryBudgets.map((item) => item.category);
    expect(names).toEqual(['固定支出', '储蓄/投资', '餐饮', '交通']);
    const flexibleTotal = synced.categoryBudgets
      .filter((item) => item.category !== '固定支出' && item.category !== '储蓄/投资')
      .reduce((sum, item) => sum + item.amount, 0);
    expect(flexibleTotal).toBe(5000);
  });

  it('keeps the recommendation untouched when there are no expense categories', () => {
    const synced = syncRecommendationWithExpenseCategories(recommendation, []);
    expect(synced).toBe(recommendation);
  });

  it('gives every ledger category a non-zero budget', () => {
    const synced = syncRecommendationWithExpenseCategories(recommendation, [
      { name: '餐饮', kind: 'expense' },
      { name: '交通', kind: 'expense' },
      { name: '购物日用', kind: 'expense' },
      { name: '保险', kind: 'expense' },
      { name: '工资', kind: 'income' }
    ]);

    const flexibleRows = synced.categoryBudgets.filter(
      (item) => item.category !== '固定支出' && item.category !== '储蓄/投资'
    );
    expect(flexibleRows).toHaveLength(4);
    flexibleRows.forEach((row) => {
      expect(row.amount).toBeGreaterThan(0);
    });

    const flexibleTotal = flexibleRows.reduce((sum, item) => sum + item.amount, 0);
    expect(flexibleTotal).toBe(5000);
  });

  it('re-distributes legacy plans that left a category with zero budget', () => {
    const legacy = {
      ...recommendation,
      categoryBudgets: [
        ...recommendation.categoryBudgets.slice(0, 2),
        { category: '餐饮', amount: 2000, ratio: 0.2 },
        { category: '交通', amount: 1200, ratio: 0.12 },
        { category: '购物日用', amount: 0, ratio: 0 }
      ]
    };

    const synced = syncRecommendationWithExpenseCategories(legacy, [
      { name: '餐饮', kind: 'expense' },
      { name: '交通', kind: 'expense' },
      { name: '购物日用', kind: 'expense' }
    ]);

    const shopping = synced.categoryBudgets.find((item) => item.category === '购物日用');
    expect(shopping?.amount).toBeGreaterThan(0);
  });
});

describe('applyBalancedCategoryEdit', () => {
  it('keeps the total equal to monthly income after editing one category', () => {
    const edited = applyBalancedCategoryEdit(recommendation, '餐饮', 2600);
    const total = edited.categoryBudgets.reduce((sum, item) => sum + item.amount, 0);

    expect(total).toBe(recommendation.monthlyIncome);
    expect(edited.categoryBudgets.find((item) => item.category === '餐饮')?.amount).toBe(2600);
    expect(edited.flexibleBudget).toBe(5000);
  });

  it('updates ratios against monthly income', () => {
    const edited = applyBalancedCategoryEdit(recommendation, '餐饮', 2000);
    const dining = edited.categoryBudgets.find((item) => item.category === '餐饮');
    expect(dining?.ratio).toBeCloseTo(0.2, 5);
  });
});

describe('buildBudgetSignature', () => {
  it('is stable for the same amounts and changes when an amount changes', () => {
    expect(buildBudgetSignature(recommendation)).toBe(buildBudgetSignature(recommendation));
    expect(buildBudgetSignature(recommendation)).not.toBe(
      buildBudgetSignature(applyBalancedCategoryEdit(recommendation, '餐饮', 2500))
    );
  });

  /**
   * 分摊后的分类合计必须仍然等于月收入。
   *
   * 原来的残差修正把负数差值直接夹到 0(Math.max(0, row + delta)),没吸收掉的
   * 部分就被丢掉了,分类合计因此超过灵活预算。用「第一个分类权重极小、其余分类
   * 四舍五入后进位」这种形状可以稳定复现(实测最多多出 3 元)。
   * 真实的身份权重扫下来没触发,所以这更像是潜在漏洞;但既然 planner 那边已经
   * 改成「从大往小扣、不扣成负数」,这里也统一,让不变量无条件成立。
   */
  it('keeps the flexible total exact even when a large negative residual appears', () => {
    const violations: string[] = [];

    for (let flexibleBudget = 1; flexibleBudget <= 60; flexibleBudget += 1) {
      for (let count = 2; count <= 8; count += 1) {
        const names = Array.from({ length: count }, (_, index) => `C${index}`);
        const weights: Record<string, number> = { [names[0]]: 0.001 };
        for (let index = 1; index < count; index += 1) {
          weights[names[index]] = 1 / (count - 1);
        }

        const recommendation = {
          monthlyIncome: flexibleBudget,
          monthlyFixedExpense: 0,
          disposableIncome: flexibleBudget,
          savingsAmount: 0,
          flexibleBudget,
          distributionVersion: 1,
          flexibleWeights: weights,
          categoryBudgets: names.map((name) => ({ category: name, amount: 0, ratio: 0 }))
        } as unknown as BudgetRecommendation;

        const synced = syncRecommendationWithExpenseCategories(
          recommendation,
          names.map((name) => ({ name }))
        );
        const total = synced.categoryBudgets.reduce((sum, item) => sum + item.amount, 0);
        if (total !== flexibleBudget) {
          violations.push(`flexible=${flexibleBudget} count=${count} total=${total}`);
        }
        if (synced.categoryBudgets.some((item) => item.amount < 0)) {
          violations.push(`负额度 flexible=${flexibleBudget} count=${count}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
