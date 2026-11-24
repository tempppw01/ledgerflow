import { TransactionItem } from '../../../entities/transaction/types';
import { Category } from '../../../entities/category/types';
import { formatMonthKey, parseDateInput } from './budgetDate';
import { shiftMonthKey } from './budgetComparison';
import { roundMoney } from '../../../shared/lib/money';
import { isTransactionRefundLike } from '../../../shared/lib/transactionMetrics';
import { CORE_BUDGET_CATEGORIES, isRigidExpenseCategory } from './budgetPlan';

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

/**
 * 预算模块里比对分类名用的键。
 *
 * 它比 store 的 `findDuplicateCategory` 更宽松:只 trim + 小写,**不压缩内部连续空格**。
 * 目前等价,因为分类名在创建时就按 store 的规则归一过了(库里不会有带连续空格的名字),
 * 这一点由 `npm run audit:ledger-math` 的「分类名归一」检查守着。
 * 若哪天允许直接写库或导入未归一的分类名,这里会漏掉那些分类的支出 —— 那时请改成
 * 与 store 同一套归一,而不是在这里放宽。
 */
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
  /*
   * 「固定支出」在表格里是一行合计,账本里没有同名分类。
   * 点它要能看到明细,就得把全部刚性支出分类(住房 / 还款 / 保险 / 税费 /
   * 水电燃气 / 通讯)都算进来,否则抽屉会给出一个空列表。
   */
  const isFixedAggregate = params.category === CORE_BUDGET_CATEGORIES[0];
  const categoryIds = new Set(
    params.categories
      .filter((item) =>
        isFixedAggregate
          ? isRigidExpenseCategory(item.name)
          : normalizeCategoryName(item.name) === targetKey
      )
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
    // 退款/冲正单的 type 也是 expense,但它们应该**冲减**该分类的支出,而不是
    // 再加一笔。汇总侧(buildBudgetTrackingRows)一直是这么算的,详情侧以前直接
    // 累加正值,于是同一个分类在抽屉里和列表里给出两个不同的数字:
    // 支出 100 + 退款 40 → 列表 60、抽屉 140;全额冲正时抽屉更是翻倍。
    const refundLike = isTransactionRefundLike(item);
    const signedAmount = refundLike ? -amount : amount;
    spentByMonth.set(key, (spentByMonth.get(key) || 0) + signedAmount);
    recentTransactions.push({
      id: item.id,
      date: item.date,
      note: item.note,
      amount: signedAmount
    });
  });

  const sortedTransactions = recentTransactions
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, transactionLimit);

  // 与汇总侧一致:单个分类单个自然月的净支出不为负(退款多于支出的极端情况)。
  // 不夹 0 的话,退款多的月份抽屉会显示负数,而列表显示 0,两者又对不上。
  const monthlyPoints = monthKeys
    .map((key) => ({
      monthKey: key,
      spent: Math.max(0, roundMoney(spentByMonth.get(key) || 0))
    }))
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
