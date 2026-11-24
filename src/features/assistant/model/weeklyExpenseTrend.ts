import type { TransactionItem } from '../../../entities/transaction/types';
import { daysSinceLocalDate } from '../../../shared/lib/localDate';
import {
  filterCountableTransactions,
  summarizeTransactions
} from '../../../shared/lib/transactionMetrics';

/**
 * 最近两周的支出对比:本周(0–6 天前)与上周(7–13 天前)。
 *
 * 原先这段写在助手页里,用**行号**切窗口:
 *
 *     weeklyRows.filter(type === 'expense').slice(0, 7)   // 「本周」
 *     weeklyRows.filter(type === 'expense').slice(7, 14)  // 「上周」
 *
 * 而 weeklyRows 来自 store 的**原始顺序**(不是按日期排的),于是「本周」实际是
 * 「列表里前 7 笔」—— 数据稀疏(某周只有 2 笔)或插入顺序不同,结论就会反,
 * 而话术仍然写着「近 7 天…较上周增加 X%」。
 *
 * 这里按**本地日历日**分桶,和列表、筛选、财务分析用的是同一套日期口径。
 */
const WEEK_DAYS = 7;

export type WeeklyExpenseTrend = {
  thisWeekExpense: number;
  lastWeekExpense: number;
  /** 相比上周的变化百分比;上周为 0 时没有可比基线,返回 null。 */
  deltaPct: number | null;
  thisWeekCount: number;
  lastWeekCount: number;
};

export function calculateWeeklyExpenseTrend(params: {
  transactions: TransactionItem[];
  now?: Date;
}): WeeklyExpenseTrend {
  const now = params.now ?? new Date();
  const thisWeek: TransactionItem[] = [];
  const lastWeek: TransactionItem[] = [];

  for (const item of filterCountableTransactions(params.transactions)) {
    // 退款/冲正行的 type 也是 expense —— 要留着,summarizeTransactions 会把它们抵减掉。
    if (item.type !== 'expense') continue;
    const gap = daysSinceLocalDate(item.date, now);
    if (gap === null || gap < 0) continue;
    if (gap < WEEK_DAYS) thisWeek.push(item);
    else if (gap < WEEK_DAYS * 2) lastWeek.push(item);
  }

  const thisWeekExpense = summarizeTransactions(thisWeek).expenseTotal;
  const lastWeekExpense = summarizeTransactions(lastWeek).expenseTotal;

  return {
    thisWeekExpense,
    lastWeekExpense,
    deltaPct: lastWeekExpense > 0 ? ((thisWeekExpense - lastWeekExpense) / lastWeekExpense) * 100 : null,
    thisWeekCount: thisWeek.length,
    lastWeekCount: lastWeek.length
  };
}