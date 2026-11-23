import type { TransactionItem } from '../../../entities/transaction/types';
import {
  filterCountableTransactions,
  summarizeTransactions
} from '../../../shared/lib/transactionMetrics';
import { roundMoney } from '../../../shared/lib/money';

/**
 * 「本月可投资现金」= 月收入补足后剩下的钱。
 *
 * 这个概念原先有**两份实现**,而且两处都错、错法还不一样:
 *
 *   · 投资理财页:按月取交易(对),但**没排除退款** —— 退款被当成又花一笔,
 *     支出多算一整笔退款,可投资现金因此偏低(演示账本 2026-11 低 ¥390.55);
 *   · 投资助手聊天面板:干脆用**全部历史交易**去减月收入,
 *     于是任何用满一个月的账本都算出 0(演示账本 26,000 − 十几万 → 恒为 0)。
 *
 * 这里收成一份实现:按月取(本地月,与页面其它地方一致)、排除不计入余额的状态、
 * 退款/冲正抵减,合计走共享的 summarizeTransactions。
 */
export type MonthlyCashflow = {
  /** 本月支出(已抵减退款、已排除不计入余额的行)。 */
  expenseTotal: number;
  /** 本月收入(已抵减收入退款)。 */
  incomeTotal: number;
  /** 本月净额。 */
  netTotal: number;
  /** 可投资现金:有登记月收入时用「月收入 − 本月支出」,否则用本月净额,负数按 0 处理。 */
  investableCash: number;
};

export function getLocalMonthBounds(now: Date = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1)
  };
}

export function calculateMonthlyCashflow(params: {
  transactions: TransactionItem[];
  monthlyIncome?: number;
  now?: Date;
}): MonthlyCashflow {
  const { start, end } = getLocalMonthBounds(params.now);
  const monthRows = params.transactions.filter((item) => {
    const date = new Date(item.date);
    return date >= start && date < end;
  });

  const summary = summarizeTransactions(filterCountableTransactions(monthRows));
  const income = Number(params.monthlyIncome) || 0;
  const baseline = income > 0 ? income - summary.expenseTotal : summary.netTotal;

  return {
    expenseTotal: summary.expenseTotal,
    incomeTotal: summary.incomeTotal,
    netTotal: summary.netTotal,
    investableCash: roundMoney(Math.max(0, baseline))
  };
}