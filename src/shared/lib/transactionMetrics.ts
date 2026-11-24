import type { TransactionItem, TransactionType } from '../../entities/transaction/types';
import { isBalanceAffectingStatus } from './localDate';

export type TransactionDirection = 'inflow' | 'outflow';

function safeAmount(raw: number): number {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return amount;
}

export function isTransactionRefundLike(tx: TransactionItem): boolean {
  return tx.adjustmentKind === 'refund' || tx.adjustmentKind === 'reversal';
}

/**
 * 支出类类型(**减少账户余额**的口径)。注意:预算型交易在这里**算**支出,而首页的
 * `isActualExpenseType`(features/dashboard/model/utils.ts)不算 —— 那是「实际花掉」的口径。
 * 两者是**不同**的概念,不是两套实现:所以**不要在别处再抄一份**
 * (`npm run check:shared-predicates` 会拦住重复定义),需要哪个就 import 哪个。
 */
export function isExpenseLike(type: TransactionType): boolean {
  return type === 'expense' || type === 'budget' || type === 'repayment';
}

export function getTransactionDirection(tx: TransactionItem): TransactionDirection {
  if (isTransactionRefundLike(tx)) {
    // 退款/冲正与原始交易方向相反:支出退款是资金回流(流入),
    // 收入退款是把钱退还对方(流出)。退款行的 type 记录的是原始类型。
    return tx.type === 'income' ? 'outflow' : 'inflow';
  }

  if (tx.type === 'income') {
    return 'inflow';
  }

  return 'outflow';
}

export function getSignedAmount(tx: TransactionItem): number {
  const amount = safeAmount(tx.amount);
  if (amount <= 0) {
    return 0;
  }
  return getTransactionDirection(tx) === 'inflow' ? amount : -amount;
}

export interface TransactionSummary {
  incomeTotal: number;
  /** 收入被退款/冲正退回的金额,需要从收入里抵扣。 */
  incomeReversalTotal: number;
  expenseTotal: number;
  refundTotal: number;
  netTotal: number;
  overallTotal: number;
}

/**
 * 是否计入收支统计:未删除、且状态影响余额(待支付 / 已关闭 / 失败的行不计)。
 *
 * `summarizeTransactions` 本身**不做状态过滤** —— 它假定调用方已经筛过。给「资产/趋势」
 * 这类口径用时必须显式套一层,否则同一屏里会出现两套数:账户余额那边
 * (`computeAccountBalances`)一直排除这些行,而月度汇总把它们算进去了。
 *
 * 注意:交易**列表页**顶部的合计是对「你看到的这批行」求和,那种场景不要用这个过滤,
 * 否则合计会与列表里可见的金额对不上。
 */
export function isCountableTransaction(tx: TransactionItem): boolean {
  return !tx.trashedAt && isBalanceAffectingStatus(tx.status);
}

/** 只保留计入收支统计的行。用于资产、趋势、预算这类与余额同口径的聚合。 */
export function filterCountableTransactions(rows: TransactionItem[]): TransactionItem[] {
  return rows.filter(isCountableTransaction);
}

/**
 * 统一统计口径：
 * - 支出退款/冲正抵减支出
 * - 收入退款/冲正抵减收入
 * - 两类调整互不串账,避免收入退款被算成消费
 */
export function summarizeTransactions(rows: TransactionItem[]): TransactionSummary {
  const incomeTotal = rows.reduce((sum, tx) => {
    if (tx.type !== 'income' || isTransactionRefundLike(tx)) {
      return sum;
    }
    return sum + safeAmount(tx.amount);
  }, 0);

  const grossExpense = rows.reduce((sum, tx) => {
    if (isTransactionRefundLike(tx) || !isExpenseLike(tx.type)) {
      return sum;
    }
    return sum + safeAmount(tx.amount);
  }, 0);

  const incomeReversalTotal = rows.reduce((sum, tx) => {
    if (!isTransactionRefundLike(tx) || tx.type !== 'income') {
      return sum;
    }
    return sum + safeAmount(tx.amount);
  }, 0);

  const expenseRefundTotal = rows.reduce((sum, tx) => {
    if (!isTransactionRefundLike(tx) || tx.type === 'income') {
      return sum;
    }
    return sum + safeAmount(tx.amount);
  }, 0);

  const netExpense = grossExpense - expenseRefundTotal;
  const expenseTotal = Math.max(0, netExpense);

  return {
    incomeTotal,
    incomeReversalTotal,
    expenseTotal,
    refundTotal: expenseRefundTotal + incomeReversalTotal,
    // 净额直接按资金方向汇总,退款超过当期支出时仍需保留多出的回流金额。
    netTotal: incomeTotal - incomeReversalTotal - netExpense,
    overallTotal: rows.reduce((sum, tx) => sum + safeAmount(tx.amount), 0)
  };
}
