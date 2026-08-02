import type { TransactionItem } from '../../../entities/transaction/types';

type QuickAddSpendingInput = {
  transactions: TransactionItem[];
  date: string;
  proposedExpense?: number;
};

/**
 * 汇总指定日期已实际发生的支出。退款/冲正以负数抵扣，避免预算提示把退款再算成一笔消费。
 */
export function getQuickAddDailySpending({
  transactions,
  date,
  proposedExpense = 0
}: QuickAddSpendingInput) {
  const spent = transactions.reduce((total, item) => {
    if (
      item.type !== 'expense' ||
      item.date.slice(0, 10) !== date ||
      item.trashedAt ||
      item.status === 'pending' ||
      item.status === 'closed' ||
      item.status === 'failed'
    ) {
      return total;
    }

    const amount = Math.abs(Number(item.amount) || 0);
    return item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal'
      ? total - amount
      : total + amount;
  }, 0);

  const draftAmount = Number.isFinite(proposedExpense) && proposedExpense > 0 ? proposedExpense : 0;
  return {
    spent: Math.max(0, Math.round(spent * 100) / 100),
    projected: Math.max(0, Math.round((spent + draftAmount) * 100) / 100)
  };
}

/** Returns the flexible-budget reference for the month containing the selected date. */
export function getDailyFlexibleBudget(monthlyFlexibleBudget: number | null, date: string) {
  if (!monthlyFlexibleBudget || monthlyFlexibleBudget <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const [year, month] = date.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return Math.round((monthlyFlexibleBudget / daysInMonth) * 100) / 100;
}
