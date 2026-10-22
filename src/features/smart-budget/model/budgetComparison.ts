import { TransactionItem } from '../../../entities/transaction/types';
import { Category } from '../../../entities/category/types';
import { BudgetRecommendation } from './budgetPlanner';
import { buildBudgetTrackingRows, BudgetTrackingRow } from './budgetInsights';

export type BudgetComparisonRow = {
  category: string;
  budgetAmount: number;
  currentSpent: number;
  previousSpent: number;
  spentDelta: number;
  ratio: number;
  isOverspent: boolean;
};

export type BudgetComparison = {
  rows: BudgetComparisonRow[];
  currentTotal: number;
  previousTotal: number;
  totalDelta: number;
  previousMonthKey: string;
};

export function shiftMonthKey(monthKey: string, offset: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return monthKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 环比：把本月与上月的分类支出放在一起排序，
 * 让用户一眼看到“钱变多还是变少”的方向。
 */
export function buildBudgetComparison(params: {
  recommendation: BudgetRecommendation;
  transactions: TransactionItem[];
  categories: Category[];
  monthKey: string;
}): BudgetComparison {
  const previousMonthKey = shiftMonthKey(params.monthKey, -1);
  const currentRows = buildBudgetTrackingRows({ ...params, monthKey: params.monthKey });
  const previousRows = buildBudgetTrackingRows({ ...params, monthKey: previousMonthKey });

  const previousMap = new Map(previousRows.map((row) => [row.category, row]));
  const rows: BudgetComparisonRow[] = currentRows.map((row) => {
    const previous = previousMap.get(row.category);
    return {
      category: row.category,
      budgetAmount: row.budgetAmount,
      currentSpent: row.spentAmount,
      previousSpent: previous?.spentAmount || 0,
      spentDelta: row.spentAmount - (previous?.spentAmount || 0),
      ratio: row.ratio,
      isOverspent: row.isOverspent
    };
  });

  rows.sort((a, b) => Math.abs(b.spentDelta) - Math.abs(a.spentDelta));

  const currentTotal = currentRows.reduce((sum, row) => sum + row.spentAmount, 0);
  const previousTotal = previousRows.reduce((sum, row) => sum + row.spentAmount, 0);

  return {
    rows,
    currentTotal,
    previousTotal,
    totalDelta: currentTotal - previousTotal,
    previousMonthKey
  };
}

export function findTrackingRow(
  rows: BudgetTrackingRow[],
  category: string
): BudgetTrackingRow | undefined {
  return rows.find((row) => row.category === category);
}
