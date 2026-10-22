import { TransactionItem } from '../../../entities/transaction/types';
import { Category } from '../../../entities/category/types';
import { formatMonthKey, parseDateInput } from './budgetDate';
import { shiftMonthKey } from './budgetComparison';

export type BudgetCategoryTransaction = {
  id: string;
  date: string;
  note: string;
  amount: number;
};

export type BudgetCategoryMonthPoint = {
  monthKey: string;
  spent: number;
};

export type BudgetCategoryDetail = {
  category: string;
  budgetAmount: number;
  recentTransactions: BudgetCategoryTransaction[];
  monthlyPoints: BudgetCategoryMonthPoint[];
  totalSpentInWindow: number;
  averageMonthlySpent: number;
};

function normalizeCategoryName(raw: string): string {
  return raw.trim().toLocaleLowerCase('zh-CN');
}

/**
 * 分类详情：近期若干笔真实支出 + 最近几个月该分类的支出分布。
 * 用于右侧抽屉，让用户从「数字」回到「具体花在哪」。
 */
export function buildBudgetCategoryDetail(params: {
  category: string;
  budgetAmount: number;
  transactions: TransactionItem[];
  categories: Category[];
  monthKey: string;
  monthWindow?: number;
  transactionLimit?: number;
}): BudgetCategoryDetail {
  const monthWindow = params.monthWindow ?? 6;
  const transactionLimit = params.transactionLimit ?? 6;

  const targetKey = normalizeCategoryName(params.category);
  const categoryIds = new Set(
    params.categories
      .filter((item) => normalizeCategoryName(item.name) === targetKey)
      .map((item) => item.id)
  );

  const monthKeys = Array.from({ length: monthWindow }, (_, index) =>
    shiftMonthKey(params.monthKey, -index)
  );
  const monthKeySet = new Set(monthKeys);

  const spentByMonth = new Map<string, number>();
  monthKeys.forEach((key) => spentByMonth.set(key, 0));

  const recentTransactions: BudgetCategoryTransaction[] = [];

  params.transactions.forEach((item) => {
    if (item.type !== 'expense' || !categoryIds.has(item.categoryId)) {
      return;
    }

    const date = parseDateInput(item.date);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    const key = formatMonthKey(date);
    if (!monthKeySet.has(key)) {
      return;
    }

    const amount = Number(item.amount || 0);
    spentByMonth.set(key, (spentByMonth.get(key) || 0) + amount);
    recentTransactions.push({
      id: item.id,
      date: item.date,
      note: item.note,
      amount
    });
  });

  const sortedTransactions = recentTransactions
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, transactionLimit);

  const monthlyPoints = monthKeys
    .map((key) => ({ monthKey: key, spent: Math.round((spentByMonth.get(key) || 0) * 100) / 100 }))
    .reverse();

  const totalSpentInWindow = monthlyPoints.reduce((sum, item) => sum + item.spent, 0);

  return {
    category: params.category,
    budgetAmount: params.budgetAmount,
    recentTransactions: sortedTransactions,
    monthlyPoints,
    totalSpentInWindow,
    averageMonthlySpent: monthlyPoints.length > 0 ? totalSpentInWindow / monthlyPoints.length : 0
  };
}
