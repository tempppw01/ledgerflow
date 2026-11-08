import type { TransactionItem, TransactionType } from '../../entities/transaction/types';

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

function isExpenseLike(type: TransactionType): boolean {
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
