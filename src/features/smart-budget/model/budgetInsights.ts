import { BudgetRecommendation } from './budgetPlanner';
import { Category } from '../../../entities/category/types';
import { TransactionItem } from '../../../entities/transaction/types';
import {
  BudgetTextTranslator,
  formatMonthKey,
  monthLabelFromKey,
  parseDateInput
} from './budgetDate';
import { roundMoney } from '../../../shared/lib/money';
import { isTransactionRefundLike } from '../../../shared/lib/transactionMetrics';
import { CORE_BUDGET_CATEGORIES, isRigidExpenseCategory } from './budgetPlan';

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
  now = new Date(),
  t?: BudgetTextTranslator
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
    .map((key) => ({ key, label: monthLabelFromKey(key, t) }));
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
    const refundLike = isTransactionRefundLike(item);
    const signedAmount = refundLike ? -Number(item.amount || 0) : Number(item.amount || 0);
    spentByCategory.set(key, (spentByCategory.get(key) || 0) + signedAmount);
  });

  const toRow = (category: string, budgetAmount: number, spentAmount: number): BudgetTrackingRow => {
    const rounded = Math.max(0, roundMoney(spentAmount));
    const diff = rounded - budgetAmount;
    return {
      category,
      budgetAmount,
      spentAmount: rounded,
      ratio: budgetAmount > 0 ? rounded / budgetAmount : 0,
      diff,
      isOverspent: diff > 0
    };
  };

  const fixedCategory = CORE_BUDGET_CATEGORIES[0];
  const savingsCategory = CORE_BUDGET_CATEGORIES[1];

  const rows: BudgetTrackingRow[] = recommendation.categoryBudgets
    .filter((item) => item.category !== fixedCategory && item.category !== savingsCategory)
    .map((item) =>
      toRow(item.category, item.amount, spentByCategory.get(normalizeCategoryName(item.category)) || 0)
    );

  /*
   * 「固定支出」原先只从可支配收入里减掉,却不落到任何分类上:它既不出现在
   * 这张表里,也不进任何合计,久了就成了一笔看不见的钱 —— 灵活预算 15% 的执行率
   * 被读成「整体很稳」,而房租这笔最大的支出压根没进过账。
   *
   * 现在补成一行合计:预算取用户声明的固定支出,已花取所有刚性支出分类
   * (住房 / 还款 / 保险 / 税费 / 水电燃气 / 通讯)的当月合计。
   */
  const rigidCategoryNames = new Set(
    categories
      .map((item) => item.name)
      .filter((name) => isRigidExpenseCategory(name))
      .map((name) => normalizeCategoryName(name))
  );
  const rigidSpent = Array.from(rigidCategoryNames).reduce(
    (sum, key) => sum + Math.max(0, spentByCategory.get(key) || 0),
    0
  );
  const fixedBudget = recommendation.categoryBudgets.find(
    (item) => item.category === fixedCategory
  )?.amount;

  if (typeof fixedBudget === 'number' && (fixedBudget > 0 || rigidSpent > 0)) {
    rows.push(toRow(fixedCategory, fixedBudget, rigidSpent));
  }

  return rows.sort((a, b) => {
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
