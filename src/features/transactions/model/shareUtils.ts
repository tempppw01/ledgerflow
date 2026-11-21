import { formatCurrencyAuto, formatDate } from '../../../shared/lib/format';
import i18next from 'i18next';
import type {
  TransactionItem,
  TransactionSource,
  TransactionStatus,
  TransactionType
} from '../../../entities/transaction/types';
import {
  getTransactionDirection,
  isTransactionRefundLike
} from '../../../shared/lib/transactionMetrics';

/**
 * 分享文案是纯函数（调用方在 TransactionsPage），拿不到 hook，所以直接用 i18next 单例。
 * key 缺失时回落到中文兜底：单测环境没有初始化 i18n 时，拿到的还是原来的中文。
 */
function tf(key: string, fallback: string) {
  const translated = i18next.t(key);
  return !translated || translated === key ? fallback : translated;
}

export type BillShareTemplate = 'full' | 'masked' | 'summary';

/**
 * 获取交易类型标签
 */
export function txTypeLabel(type: TransactionType) {
  if (type === 'income') return tf('transactions.table.type.income', '收入');
  if (type === 'budget') return tf('transactions.table.type.budget', '预算');
  if (type === 'repayment') return tf('transactions.table.type.repayment', '还款');
  return tf('transactions.table.type.expense', '支出');
}

function transactionTypeLabel(transaction: TransactionItem) {
  if (isTransactionRefundLike(transaction)) {
    return transaction.adjustmentKind === 'refund'
      ? tf('transactions.table.type.refund', '退款')
      : tf('transactions.table.type.reversal', '冲正');
  }
  return txTypeLabel(transaction.type);
}

const STATUS_LABEL_ENTRIES: Record<TransactionStatus, { key: string; fallback: string }> = {
  pending: { key: 'transactions.table.status.pending', fallback: '待处理' },
  completed: { key: 'transactions.table.status.completed', fallback: '已完成' },
  refunded: { key: 'transactions.table.status.refunded', fallback: '已退款' },
  closed: { key: 'transactions.table.status.closed', fallback: '已关闭' },
  failed: { key: 'transactions.table.status.failed', fallback: '失败' }
};

const SOURCE_LABEL_ENTRIES: Record<TransactionSource, { key: string; fallback: string }> = {
  ai: { key: 'transactions.filters.sourceAi', fallback: 'AI 记账' },
  wechat: { key: 'transactions.filters.sourceWechat', fallback: '微信导入' },
  alipay: { key: 'transactions.filters.sourceAlipay', fallback: '支付宝' },
  manual: { key: 'transactions.filters.sourceManual', fallback: '手工录入' }
};

/**
 * 获取交易状态标签
 */
export function txStatusLabel(status?: TransactionItem['status']) {
  if (!status) return '—';
  const entry = STATUS_LABEL_ENTRIES[status];
  return entry ? tf(entry.key, entry.fallback) : status;
}

function txSourceLabel(source: TransactionSource) {
  const entry = SOURCE_LABEL_ENTRIES[source];
  return entry ? tf(entry.key, entry.fallback) : source;
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
    tf('txShare.title', '【账单分享】{type}').replace(
      '{type}',
      transactionTypeLabel(transaction)
    ),
    tf('txShare.amount', '金额：{value}').replace('{value}', amountText),
    tf('txShare.date', '日期：{value}').replace('{value}', formatDate(transaction.date)),
    tf('txShare.category', '分类：{value}').replace(
      '{value}',
      isMasked ? maskShareText(categoryName) : categoryName || '—'
    )
  ];

  if (!isSummary && includeAccount) {
    lines.push(
      tf('txShare.account', '账户：{value}').replace(
        '{value}',
        isMasked ? maskShareText(accountName) : accountName || '—'
      )
    );
  }

  if (!isSummary) {
    lines.push(
      tf('txShare.status', '状态：{value}').replace(
        '{value}',
        txStatusLabel(transaction.status)
      )
    );
    lines.push(
      tf('txShare.source', '来源：{value}').replace('{value}', txSourceLabel(source))
    );
  }

  if (includeNote) {
    lines.push(
      tf('txShare.note', '备注：{value}').replace(
        '{value}',
        isMasked ? maskShareText(noteText) : noteText
      )
    );
  }

  if (!isSummary && transaction.tags?.length) {
    lines.push(
      tf('txShare.tags', '标签：{value}').replace(
        '{value}',
        isMasked
          ? tf('txShare.tagsCount', '{count} 个标签').replace(
              '{count}',
              String(transaction.tags.length)
            )
          : transaction.tags.join(' / ')
      )
    );
  }

  if (!isSummary && includeAttachments) {
    lines.push(
      tf('txShare.attachments', '附件：{value}').replace(
        '{value}',
        attachmentCount > 0
          ? tf(
              'txShare.attachmentsCount',
              '有 {count} 个附件'
            ).replace('{count}', String(attachmentCount))
          : tf('txShare.attachmentsNone', '无附件')
      )
    );
  }

  if (!isSummary && transaction.updatedAt) {
    lines.push(
      tf('txShare.updatedAt', '最后修改：{value}').replace(
        '{value}',
        formatDate(transaction.updatedAt)
      )
    );
  }

  if (isSummary) {
    lines.push(tf('txShare.summaryHint', '说明：摘要模式默认只保留关键信息，适合直接转发。'));
  } else if (isMasked) {
    lines.push(tf('txShare.maskedHint', '说明：当前为脱敏分享模板。'));
  }

  return lines.join('\n');
}
