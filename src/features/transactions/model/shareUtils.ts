import { formatCurrencyAuto, formatDate } from '../../../shared/lib/format';
import type {
  TransactionItem,
  TransactionSource,
  TransactionType
} from '../../../entities/transaction/types';
import {
  getTransactionDirection,
  isTransactionRefundLike
} from '../../../shared/lib/transactionMetrics';

export type BillShareTemplate = 'full' | 'masked' | 'summary';

/**
 * 获取交易类型标签
 */
export function txTypeLabel(type: TransactionType) {
  return type === 'income'
    ? '收入'
    : type === 'budget'
      ? '预算'
      : type === 'repayment'
        ? '还款'
        : '支出';
}

function transactionTypeLabel(transaction: TransactionItem) {
  if (isTransactionRefundLike(transaction)) {
    return transaction.adjustmentKind === 'refund' ? '退款' : '冲正';
  }
  return txTypeLabel(transaction.type);
}

/**
 * 获取交易状态标签
 */
export function txStatusLabel(status?: TransactionItem['status']) {
  if (!status) return '—';
  return (
    {
      pending: '待处理',
      completed: '已完成',
      refunded: '已退款',
      closed: '已关闭',
      failed: '失败'
    }[status] || status
  );
}

/**
 * 脱敏分享文本
 */
export function maskShareText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (trimmed.length <= 2) return '••';
  if (trimmed.length <= 6) return `${trimmed.slice(0, 1)}•••${trimmed.slice(-1)}`;
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

/**
 * 构建交易分享文本
 */
export function buildTransactionShareText(input: {
  transaction: TransactionItem;
  categoryName: string;
  accountName: string;
  source: TransactionSource;
  template: BillShareTemplate;
  includeNote: boolean;
  includeAttachments: boolean;
  includeAccount: boolean;
}) {
  const {
    transaction,
    categoryName,
    accountName,
    source,
    template,
    includeNote,
    includeAttachments,
    includeAccount
  } = input;
  const isMasked = template === 'masked';
  const isSummary = template === 'summary';
  const direction = getTransactionDirection(transaction);
  const amountText = isMasked
    ? '¥••••'
    : `${direction === 'inflow' ? '+' : '-'}${formatCurrencyAuto(transaction.amount)}`;
  const noteText = transaction.note?.trim() || '—';
  const attachmentCount = transaction.attachments?.length || 0;
  const lines = [
    `【账单分享】${transactionTypeLabel(transaction)}`,
    `金额：${amountText}`,
    `日期：${formatDate(transaction.date)}`,
    `分类：${isMasked ? maskShareText(categoryName) : categoryName || '—'}`
  ];

  if (!isSummary && includeAccount) {
    lines.push(`账户：${isMasked ? maskShareText(accountName) : accountName || '—'}`);
  }

  if (!isSummary) {
    lines.push(`状态：${txStatusLabel(transaction.status)}`);
    lines.push(
      `来源：${source === 'ai' ? 'AI 记账' : source === 'wechat' ? '微信导入' : source === 'alipay' ? '支付宝' : '手工录入'}`
    );
  }

  if (includeNote) {
    lines.push(`备注：${isMasked ? maskShareText(noteText) : noteText}`);
  }

  if (!isSummary && transaction.tags?.length) {
    lines.push(
      `标签：${isMasked ? `${transaction.tags.length} 个标签` : transaction.tags.join(' / ')}`
    );
  }

  if (!isSummary && includeAttachments) {
    lines.push(`附件：${attachmentCount > 0 ? `有 ${attachmentCount} 个附件` : '无附件'}`);
  }

  if (!isSummary && transaction.updatedAt) {
    lines.push(`最后修改：${formatDate(transaction.updatedAt)}`);
  }

  if (isSummary) {
    lines.push('说明：摘要模式默认只保留关键信息，适合直接转发。');
  } else if (isMasked) {
    lines.push('说明：当前为脱敏分享模板。');
  }

  return lines.join('\n');
}
