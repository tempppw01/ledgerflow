import { BudgetTrackingRow } from './budgetInsights';

export type BudgetOverview = {
  totalBudget: number;
  totalSpent: number;
  remainingAmount: number;
  executionRate: number;
  overspentCount: number;
  safeCount: number;
  monthIncome: number;
  monthExpense: number;
};

/** 汇总当月预算执行情况，页面只负责展示。 */
export function buildBudgetOverview(params: {
  rows: BudgetTrackingRow[];
  monthIncome: number;
  monthExpense: number;
}): BudgetOverview {
  const totalBudget = params.rows.reduce((sum, item) => sum + item.budgetAmount, 0);
  const totalSpent = params.rows.reduce((sum, item) => sum + item.spentAmount, 0);
  const overspentCount = params.rows.filter((item) => item.isOverspent).length;

  return {
    totalBudget,
    totalSpent,
    remainingAmount: totalBudget - totalSpent,
    executionRate: totalBudget > 0 ? totalSpent / totalBudget : 0,
    overspentCount,
    safeCount: params.rows.length - overspentCount,
    monthIncome: params.monthIncome,
    monthExpense: params.monthExpense
  };
}
