import { BudgetRecommendation } from './budgetPlanner';
import { Category } from '../../../entities/category/types';
import { TransactionItem } from '../../../entities/transaction/types';
import { formatMonthKey, monthLabelFromKey, parseDateInput } from './budgetDate';

export { formatMonthKey, monthLabelFromKey, parseDateInput };

export type BudgetMonthOption = {
  key: string;
  label: string;
};

export type BudgetTrackingRow = {
  category: string;
  budgetAmount: number;
  spentAmount: number;
  ratio: number;
  diff: number;
  isOverspent: boolean;
};

function normalizeCategoryName(raw: string): string {
  return raw.trim().toLocaleLowerCase('zh-CN');
}

export function getRecentMonthOptions(
  transactions: TransactionItem[],
  count = 6,
  now = new Date()
): BudgetMonthOption[] {
  const monthSet = new Set<string>();

  transactions.forEach((item) => {
    const date = parseDateInput(item.date);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    monthSet.add(formatMonthKey(date));
  });

  for (let offset = 0; offset < count; offset += 1) {
    const current = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    monthSet.add(formatMonthKey(current));
  }

  return Array.from(monthSet)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, count)
    .map((key) => ({ key, label: monthLabelFromKey(key) }));
}

export function buildBudgetTrackingRows(params: {
  recommendation: BudgetRecommendation;
  transactions: TransactionItem[];
  categories: Category[];
  monthKey: string;
}): BudgetTrackingRow[] {
  const { recommendation, transactions, categories, monthKey } = params;
  const categoryNameById = new Map(categories.map((item) => [item.id, item.name]));

  const spentByCategory = new Map<string, number>();

  transactions.forEach((item) => {
    if (item.type !== 'expense') {
      return;
    }

    const date = parseDateInput(item.date);
    if (Number.isNaN(date.getTime()) || formatMonthKey(date) !== monthKey) {
      return;
    }

    const categoryName = categoryNameById.get(item.categoryId);
    if (!categoryName) {
      return;
    }

    const key = normalizeCategoryName(categoryName);
    spentByCategory.set(key, (spentByCategory.get(key) || 0) + Number(item.amount || 0));
  });

  return recommendation.categoryBudgets
    .filter((item) => !['固定支出', '储蓄/投资'].includes(item.category))
    .map((item) => {
      const key = normalizeCategoryName(item.category);
      const spentAmount = Math.round((spentByCategory.get(key) || 0) * 100) / 100;
      const budgetAmount = item.amount;
      const diff = spentAmount - budgetAmount;
      const ratio = budgetAmount > 0 ? spentAmount / budgetAmount : 0;

      return {
        category: item.category,
        budgetAmount,
        spentAmount,
        ratio,
        diff,
        isOverspent: diff > 0
      };
    })
    .sort((a, b) => {
      if (b.isOverspent !== a.isOverspent) {
        return Number(b.isOverspent) - Number(a.isOverspent);
      }
      if (b.ratio !== a.ratio) {
        return b.ratio - a.ratio;
      }
      if (b.spentAmount !== a.spentAmount) {
        return b.spentAmount - a.spentAmount;
      }
      return a.category.localeCompare(b.category, 'zh-CN');
    });
}
