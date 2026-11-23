export type TransactionSource = 'manual' | 'wechat' | 'alipay' | 'ai';

export type TransactionType = 'expense' | 'income' | 'budget' | 'repayment';

export type TransactionStatus = 'pending' | 'completed' | 'refunded' | 'closed' | 'failed';

/**
 * 缺省状态 = 已完成。
 *
 * 历史行(助手导入的账单、老备份、CSV)可能没有 status,它们在**别处**一律按
 * 「计入余额」对待(isBalanceAffectingStatus(undefined) 为真)。所以:
 *   · 筛选器要按已完成匹配,
 *   · 列表状态列要显示「已完成」而不是「-」,
 *   · **写入时也要写上**,别再产出没有状态的行。
 * 三者必须同一个默认值,否则同一行会「筛得出来但显示成 -」。
 */
export const DEFAULT_TRANSACTION_STATUS: TransactionStatus = 'completed';

export type TransactionAdjustmentKind = 'normal' | 'refund' | 'reversal';

export type BalanceChangeType =
  | 'transaction-income'
  | 'transaction-expense'
  | 'transaction-budget'
  | 'transaction-repayment'
  | 'transaction-refund'
  | 'manual-adjustment';

export interface TransactionAttachmentItem {
  id: string;
  name: string;
  uploadedAt: string;
  remotePath: string;
  mimeType?: string;
  size?: number;
}

export interface TransactionItem {
  id: string;
  type: TransactionType;
  categoryId: string;
  accountId: string;
  amount: number;
  date: string;
  note: string;
  tags: string[];
  source?: TransactionSource;
  orderNo?: string;
  merchantOrderNo?: string;
  status?: TransactionStatus;
  adjustmentKind?: TransactionAdjustmentKind;
  refundOfTransactionId?: string;
  attachments?: TransactionAttachmentItem[];
  updatedAt?: string;
  trashedAt?: string;
}

export interface BalanceChangeEntry {
  id: string;
  accountId: string;
  transactionId?: string;
  relatedTransactionId?: string;
  type: BalanceChangeType;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  createdAt: string;
  note?: string;
  remark?: string;
}
