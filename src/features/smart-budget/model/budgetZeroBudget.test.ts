import { describe, expect, it } from 'vitest';
import { buildBudgetTrackingRows } from './budgetInsights';
import { formatExecutionRatePercent } from './rateDisplay';

/**
 * 预算为 0 但有支出:这一行必须同时是「超支」和「执行率无上限」。
 *
 * 原先 ratio 固定为 0,于是这一行会显示「超支」徽标 + 「执行率 0.0%」+ 空进度条,
 * 同一行自相矛盾。预算编辑器允许把某个分类的预算改成 0(BudgetCategoryList 判断的是
 * `next >= 0`),所以这条路真的能走到。
 */
function input(categoryBudgets: Array<{ category: string; amount: number }>) {
  return {
    recommendation: {
      version: 3,
      categoryBudgets,
      monthlyIncome: 10000,
      flexibleBudget: 0,
      fixedBudget: 0,
      savingsAmount: 0,
      generatedAt: '2026-11-01T00:00:00.000Z'
    } as never,
    categories: [{ id: 'cat-food', name: '餐饮' }] as never,
    transactions: [
      {
        id: 'tx-1',
        type: 'expense',
        categoryId: 'cat-food',
        accountId: 'acc-1',
        amount: 500,
        date: '2026-11-05',
        note: '餐饮',
        tags: []
      }
    ] as never,
    monthKey: '2026-11'
  };
}

describe('零预算分类的执行率', () => {
  it('预算 0 但有支出:记为无上限,而不是 0%', () => {
    const rows = buildBudgetTrackingRows(input([{ category: '餐饮', amount: 0 }]));
    const row = rows.find((item) => item.category === '餐饮');
    expect(row).toBeTruthy();
    // 超支判定本来就是对的
    expect(row?.isOverspent).toBe(true);
    // 执行率不能是 0 —— 那会与「超支」自相矛盾
    expect(row?.ratio).toBe(Number.POSITIVE_INFINITY);
    expect(formatExecutionRatePercent(row?.ratio ?? 0)).toBe('>999%');
  });

  it('预算 0 且没有支出:仍然是 0%', () => {
    const rows = buildBudgetTrackingRows(
      { ...input([{ category: '餐饮', amount: 0 }]), transactions: [] as never }
    );
    const row = rows.find((item) => item.category === '餐饮');
    expect(row?.isOverspent).toBe(false);
    expect(row?.ratio).toBe(0);
    expect(formatExecutionRatePercent(row?.ratio ?? 0)).toBe('0.0%');
  });
});