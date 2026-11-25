import { useEffect, useMemo, useRef, useState } from 'react';
import { useMenuKeyboard } from '../../../shared/lib/useMenuKeyboard';
import { createPortal } from 'react-dom';
import { TransactionItem, TransactionStatus } from '../../../entities/transaction/types';
import { EMPTY_CATEGORY_FILTER_VALUE } from '../model/categoryQuickFilter';
import { formatCurrencyAuto, formatDate } from '../../../shared/lib/format';
import {
  getTransactionDirection,
  isTransactionRefundLike,
  summarizeTransactions
} from '../../../shared/lib/transactionMetrics';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';
import { formatTransactionStatus } from '../model/statusLabel';
import { TableSkeleton } from '../../../shared/ui/TableSkeleton';
import { DatePicker } from '../../../shared/ui/DatePicker';
import {
  ALIPAY_LOGO_URL,
  LANDMARK_ICON_URL,
  WECHAT_LOGO_URL
} from '../../../shared/config/brandAssets';

const NOTE_MAX_LENGTH = 22;
const DEFAULT_MIN_COLUMN_WIDTH = 90;
const AMOUNT_COLUMN_MIN_WIDTH = 64;
const ALIPAY_ACCOUNT_PATTERN = /(支付宝|alipay)/i;
const WECHAT_ACCOUNT_PATTERN = /(微信|wechat|weixin)/i;
const BANK_ACCOUNT_PATTERN =
  /(银行|bank|信用卡|储蓄卡|借记卡|icbc|abc|ccb|boc|cmb|psbc|交通银行|招商银行|建设银行|工商银行|农业银行|中国银行)/i;

type AccountBrand = 'alipay' | 'wechat' | 'bank';

function detectAccountBrand(name: string): AccountBrand | null {
  if (ALIPAY_ACCOUNT_PATTERN.test(name)) return 'alipay';
  if (WECHAT_ACCOUNT_PATTERN.test(name)) return 'wechat';
  if (BANK_ACCOUNT_PATTERN.test(name)) return 'bank';
  return null;
}

function AlipayBrandIcon() {
  return (
    <img
      className="alipay-icon"
      src={ALIPAY_LOGO_URL}
      alt=""
      width="16"
      height="16"
      aria-hidden="true"
    />
  );
}

function WechatBrandIcon() {
  return (
    <img
      className="wechat-icon"
      src={WECHAT_LOGO_URL}
      alt=""
      width="16"
      height="16"
      aria-hidden="true"
    />
  );
}

function BankBrandIcon() {
  return (
    <img
      className="bank-icon"
      src={LANDMARK_ICON_URL}
      alt=""
      width="16"
      height="16"
      aria-hidden="true"
    />
  );
}

function renderAccountLabel(accountName: string) {
  const brand = detectAccountBrand(accountName);
  if (!brand) {
    return (
      <span className="transaction-account-name" title={accountName}>
        {accountName}
      </span>
    );
  }

  return (
    <span className="transaction-account-with-icon" title={accountName}>
      {brand === 'alipay' ? <AlipayBrandIcon /> : null}
      {brand === 'wechat' ? <WechatBrandIcon /> : null}
      {brand === 'bank' ? <BankBrandIcon /> : null}
      <span className="transaction-account-name">{accountName}</span>
    </span>
  );
}

function renderAttachmentIndicator(count: number | undefined, tf: TfFallback, compact = false) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (safeCount <= 0) return null;
  const label =
    safeCount > 1
      ? tf('transactions.table.attachment.count', '有 {count} 个附件').replace(
          '{count}',
          String(safeCount)
        )
      : tf('transactions.table.attachment.has', '有附件');
  return (
    <span
      className={`transaction-attachment-indicator ${compact ? 'is-compact' : ''}`.trim()}
      aria-label={label}
      title={label}
    >
      📎{compact ? '' : safeCount > 1 ? ` ${safeCount}` : ''}
    </span>
  );
}

function getMinColumnWidth(key: TransactionColumnKey): number {
  return key === 'amount' ? AMOUNT_COLUMN_MIN_WIDTH : DEFAULT_MIN_COLUMN_WIDTH;
}

function isLongTextColumn(key: TransactionColumnKey): boolean {
  return key === 'orderNo' || key === 'merchantOrderNo' || key === 'note';
}

export type TransactionSortKey =
  | 'date'
  | 'type'
  | 'status'
  | 'category'
  | 'account'
  | 'amount'
  | 'orderNo'
  | 'merchantOrderNo'
  | 'note';
export type TransactionSortDirection = 'asc' | 'desc';

export interface TransactionQuickFilters {
  date: string;
  type: 'all' | 'income' | 'expense' | 'budget' | 'repayment';
  status: 'all' | TransactionStatus;
  category: string;
  account: string;
  amountMin: string;
  amountMax: string;
  tags: string;
  merchant: string;
  location: string;
  orderNo: string;
  merchantOrderNo: string;
  note: string;
}

function truncateNote(note: string): string {
  if (note.length <= NOTE_MAX_LENGTH) {
    return note;
  }
  return `${note.slice(0, NOTE_MAX_LENGTH)}…`;
}

function normalizeRepeatNote(note?: string): string {
  return (note || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getRepeatGroupKey(item: Pick<TransactionItem, 'type' | 'note'>): string | null {
  if (item.type !== 'income' && item.type !== 'expense') {
    return null;
  }
  const normalizedNote = normalizeRepeatNote(item.note);
  if (!normalizedNote) {
    return null;
  }
  return `${item.type}::${normalizedNote}`;
}

function getRepeatLabel(type: TransactionItem['type'], tf: TfFallback): string {
  return type === 'income'
    ? tf('transactions.table.type.income', '收入')
    : tf('transactions.table.type.spending', '消费');
}

function truncateOrderNo(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function sortIndicator(active: boolean, direction: TransactionSortDirection) {
  // 所有列共用同一套文本箭头。以前金额列单独用 R2 上的
  // arrow-down-wide-narrow.svg,而那个图标本身就是「降序」的样子:
  // 只要表格没按金额排序,金额列表头也会显示降序图标,和其它列的 ⇅ 冲突,
  // 等于告诉用户一个并不成立的排序状态。统一成文本箭头后,未排序列一律 ⇅。
  if (!active) {
    return '⇅';
  }
  return direction === 'asc' ? '↑' : '↓';
}

export interface TransactionRowView {
  item: TransactionItem;
  categoryName: string;
  accountName: string;
}

export type TransactionColumnKey =
  | 'date'
  | 'type'
  | 'status'
  | 'category'
  | 'account'
  | 'amount'
  | 'orderNo'
  | 'merchantOrderNo'
  | 'note';

function maskAmount(): string {
  return '¥••••';
}

function maskMerchant(value: string): string {
  if (!value || value === '-') return '-';
  if (value.length <= 2) return '••';
  if (value.length <= 6) return `${value.slice(0, 1)}•••${value.slice(-1)}`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
interface TransactionTableProps {
  rows: TransactionRowView[];
  total: number;
  filteredTotal: number;
  page: number;
  pages: number;
  pageSize: number;
  pageSizeOptions: number[];
  loading: boolean;
  errorMessage?: string;
  hasFilters: boolean;
  highlightId?: string;
  privacyMode?: boolean;
  /**
   * 是否在表格上方展示“交易任务概览”（待处理/退款/失败/已完成）。
   * 为了首屏聚焦流水，默认由外层决定是否展示。
   */
  showTaskSummary?: boolean;
  selectedIds: string[];
  bulkSelectionEnabled: boolean;
  canSelectAllOnPage: boolean;
  allPageSelected: boolean;
  sortKey: TransactionSortKey;
  sortDirection: TransactionSortDirection;
  quickFilters: TransactionQuickFilters;
  onRetry: () => void;
  onClearFilters: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onFirstPage: () => void;
  onLastPage: () => void;
  onPageSizeChange: (size: number) => void;
  onCreate?: () => void;
  /** 空列表时的导入入口;不传则不显示(兼容已有用法)。 */
  onImportBill?: (source: 'wechat' | 'alipay') => void;
  onOpenDetail: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteSelected: () => void;
  onBulkEditCategory: (categoryId: string) => void;
  onBulkAiRecategorize: () => void;
  bulkAiRecategorizing: boolean;
  onBulkEditAccount: (accountId: string) => void;
  onBulkPrintA4?: () => void;
  onBulkExportPdf?: () => void;
  bulkExportingPdf?: boolean;
  bulkPrintTemplate?: 'full' | 'summary';
  onBulkPrintTemplateChange?: (value: 'full' | 'summary') => void;
  bulkPrintFields?: {
    includeAccount: boolean;
    includeNote: boolean;
    includeOrderNo: boolean;
    includeTags: boolean;
  };
  onBulkPrintFieldsChange?: (value: {
    includeAccount: boolean;
    includeNote: boolean;
    includeOrderNo: boolean;
    includeTags: boolean;
  }) => void;
  categoryOptions: Array<{ id: string; name: string }>;
  accountOptions: Array<{ id: string; name: string }>;
  onClearSelection: () => void;
  onToggleSelect: (id: string, selected: boolean) => void;
  onToggleSelectPage: (selected: boolean) => void;
  onSortChange: (key: TransactionSortKey) => void;
  onQuickFilterChange: <K extends keyof TransactionQuickFilters>(
    key: K,
    value: TransactionQuickFilters[K]
  ) => void;
  visibleColumns: Record<TransactionColumnKey, boolean>;
  columnOrder: TransactionColumnKey[];
  onColumnReorder: (fromKey: TransactionColumnKey, toKey: TransactionColumnKey) => void;
  columnWidths: Partial<Record<TransactionColumnKey, number>>;
  onColumnResize: (key: TransactionColumnKey, width: number) => void;
  minAvailableDate?: string;
  maxAvailableDate?: string;
}

import { BulkActionsBar } from './BulkActionsBar';

export function TransactionTable({
  rows,
  total,
  filteredTotal,
  page,
  pages,
  pageSize,
  pageSizeOptions,
  loading,
  errorMessage,
  hasFilters,
  highlightId,
  privacyMode = false,
  showTaskSummary = true,
  selectedIds,
  bulkSelectionEnabled,
  canSelectAllOnPage,
  allPageSelected,
  sortKey,
  sortDirection,
  quickFilters,
  onRetry,
  onClearFilters,
  onPrevPage,
  onNextPage,
  onFirstPage,
  onLastPage,
  onPageSizeChange,
  onCreate = () => undefined,
  onImportBill,
  onOpenDetail,
  onShare,
  onDelete,
  onDeleteSelected,
  onBulkEditCategory,
  onBulkAiRecategorize,
  bulkAiRecategorizing,
  onBulkEditAccount,
  onBulkPrintA4,
  onBulkExportPdf,
  bulkExportingPdf = false,
  bulkPrintTemplate = 'full',
  onBulkPrintTemplateChange,
  bulkPrintFields = {
    includeAccount: true,
    includeNote: true,
    includeOrderNo: false,
    includeTags: false
  },
  onBulkPrintFieldsChange,
  categoryOptions,
  accountOptions,
  onClearSelection,
  onToggleSelect,
  onToggleSelectPage,
  onSortChange,
  onQuickFilterChange,
  visibleColumns,
  columnOrder,
  onColumnReorder,
  columnWidths,
  onColumnResize,
  minAvailableDate,
  maxAvailableDate
}: TransactionTableProps) {
  const tf = useTFallback();
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  // role="menu" 得配方向键:打开时焦点落在第一项,↑↓ 循环,关闭后还给触发按钮。
  useMenuKeyboard(Boolean(contextMenu), contextMenuRef, () => setContextMenu(null));
  const touchStartXRef = useRef<number | null>(null);
  /*
   * WCAG 2.1.1(键盘,A):详情抽屉原来只能点行打开 —— 行是 tabIndex={-1},
   * 行内没有任何按钮,键盘用户走完 40 次 Tab 也碰不到交易,等于"看不了详情"。
   * 但把每一行都设成 tabIndex={0} 会让几十行全进 Tab 链(原来的注释就是这个顾虑)。
   * 折中成 roving tabindex:整张表只占**一个** Tab 停靠点,
   * ↓/↑ 在行之间移动,Enter/空格 打开详情。
   */
  const [rovingRowId, setRovingRowId] = useState<string | null>(null);
  const dragColumnRef = useRef<TransactionColumnKey | null>(null);
  const resizeStateRef = useRef<{
    key: TransactionColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  const columnOptions: Array<{ key: TransactionColumnKey; label: string }> = [
    { key: 'date', label: tf('transactions.table.col.date', '日期') },
    { key: 'type', label: tf('transactions.table.col.type', '类型') },
    { key: 'status', label: tf('transactions.table.col.status', '交易状态') },
    { key: 'category', label: tf('transactions.table.col.category', '分类') },
    { key: 'account', label: tf('transactions.table.col.account', '账户') },
    { key: 'amount', label: tf('transactions.table.col.amount', '金额') },
    { key: 'orderNo', label: tf('transactions.table.col.orderNo', '交易订单号') },
    { key: 'merchantOrderNo', label: tf('transactions.table.col.merchantOrderNo', '商家订单号') },
    { key: 'note', label: tf('transactions.table.col.note', '备注') }
  ];

  const orderedColumns = columnOrder
    .map((key) => columnOptions.find((item) => item.key === key))
    .filter((item): item is { key: TransactionColumnKey; label: string } => Boolean(item));
  const visibleColumnCount =
    orderedColumns.filter((column) => visibleColumns[column.key]).length +
    (bulkSelectionEnabled ? 1 : 0);

  const renderCellValue = (columnKey: TransactionColumnKey, row: TransactionRowView) => {
    const { item, categoryName, accountName } = row;
    switch (columnKey) {
      case 'date':
        return formatDate(item.date);
      case 'type':
        if (isTransactionRefundLike(item)) {
          return item.adjustmentKind === 'refund'
            ? tf('transactions.table.type.refund', '退款')
            : tf('transactions.table.type.reversal', '冲正');
        }
        return item.type === 'income'
          ? tf('transactions.table.type.income', '收入')
          : item.type === 'budget'
            ? tf('transactions.table.type.budget', '预算')
            : item.type === 'repayment'
              ? tf('transactions.table.type.repayment', '还款')
              : tf('transactions.table.type.expense', '支出');
      case 'category':
        return categoryName;
      case 'status':
        return formatTransactionStatus(item.status, tf);
      case 'account':
        return renderAccountLabel(accountName);
      case 'amount':
        return privacyMode ? maskAmount() : formatCurrencyAuto(item.amount);
      case 'orderNo':
        return item.orderNo || '-';
      case 'merchantOrderNo':
        return privacyMode
          ? maskMerchant(item.merchantOrderNo || '-')
          : item.merchantOrderNo || '-';
      case 'note':
        return truncateNote(item.note || '-');
      default:
        return '-';
    }
  };

  const textFilterKeyMap: Record<
    Exclude<TransactionColumnKey, 'type' | 'status'>,
    Exclude<keyof TransactionQuickFilters, 'type' | 'status'>
  > = {
    date: 'date',
    category: 'category',
    account: 'account',
    amount: 'amountMin',
    orderNo: 'orderNo',
    merchantOrderNo: 'merchantOrderNo',
    note: 'note'
  };

  const pageSummary = useMemo(() => {
    return summarizeTransactions(rows.map((row) => row.item));
  }, [rows]);

  const taskSummary = useMemo(() => {
    const pendingRows = rows.filter((row) => row.item.status === 'pending');
    const refundRows = rows.filter(
      (row) => isTransactionRefundLike(row.item) || row.item.status === 'refunded'
    );
    const failedRows = rows.filter((row) => row.item.status === 'failed');
    const doneRows = rows.filter(
      (row) => row.item.status === 'completed' || row.item.status === 'closed'
    );

    return {
      pending: {
        count: pendingRows.length,
        amount: summarizeTransactions(pendingRows.map((row) => row.item)).overallTotal
      },
      refund: {
        count: refundRows.length,
        amount: summarizeTransactions(refundRows.map((row) => row.item)).overallTotal
      },
      failed: {
        count: failedRows.length,
        amount: summarizeTransactions(failedRows.map((row) => row.item)).overallTotal
      },
      done: {
        count: doneRows.length,
        amount: summarizeTransactions(doneRows.map((row) => row.item)).overallTotal
      }
    };
  }, [rows]);

  const expenseAverage = useMemo(() => {
    const sample = rows
      .map((row) => row.item)
      .filter(
        (item) =>
          item.type === 'expense' &&
          item.adjustmentKind !== 'refund' &&
          item.adjustmentKind !== 'reversal'
      );
    if (sample.length === 0) return 0;
    return sample.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) / sample.length;
  }, [rows]);

  const repeatedMonthlyMap = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const grouped = new Map<string, { count: number; note: string; type: 'income' | 'expense' }>();

    rows.forEach(({ item }) => {
      const itemDate = new Date(item.date);
      if (Number.isNaN(itemDate.getTime())) {
        return;
      }
      if (itemDate.getFullYear() !== currentYear || itemDate.getMonth() !== currentMonth) {
        return;
      }
      if (isTransactionRefundLike(item)) {
        return;
      }
      const key = getRepeatGroupKey(item);
      if (!key) {
        return;
      }

      const current = grouped.get(key);
      if (current) {
        current.count += 1;
        return;
      }

      grouped.set(key, {
        count: 1,
        note: item.note.trim(),
        type: item.type === 'income' ? 'income' : 'expense'
      });
    });

    for (const [key, value] of grouped.entries()) {
      if (value.count <= 1) {
        grouped.delete(key);
      }
    }

    return grouped;
  }, [rows]);

  const highExpenseThreshold = useMemo(() => Math.max(expenseAverage * 2.2, 500), [expenseAverage]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const { key, startX, startWidth } = resizeStateRef.current;
      const next = Math.max(
        getMinColumnWidth(key),
        Math.round(startWidth + (event.clientX - startX))
      );
      onColumnResize(key, next);
    };

    const handleMouseUp = () => {
      resizeStateRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onColumnResize]);

  useEffect(() => {
    if (!contextMenu) {
      setContextMenuPosition(null);
      return;
    }

    const menuNode = contextMenuRef.current;
    if (!menuNode) {
      setContextMenuPosition({ x: contextMenu.x, y: contextMenu.y });
      return;
    }

    const margin = 8;
    const rect = menuNode.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - margin;
    const maxY = window.innerHeight - rect.height - margin;

    setContextMenuPosition({
      x: Math.max(margin, Math.min(contextMenu.x, maxX)),
      y: Math.max(margin, Math.min(contextMenu.y, maxY))
    });
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;

    const dismiss = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('click', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  return (
    <section className="panel transaction-ledger-surface">
      {loading ? (
        <TableSkeleton rows={6} columns={8} />
      ) : errorMessage ? (
        <EmptyState
          icon="⚠️"
          title={tf(
            'transactions.table.empty.loadError',
            tf('transactions.table.empty.loadError', '交易数据加载失败')
          )}
          description={errorMessage}
          secondaryAction={{
            label: tf('transactions.table.empty.clearFilters', '清空筛选'),
            onClick: onClearFilters
          }}
          primaryAction={{
            label: tf('transactions.table.empty.retry', '重试'),
            onClick: onRetry,
            variant: 'primary'
          }}
        />
      ) : rows.length === 0 && !hasFilters ? (
        <EmptyState
          icon="📋"
          title={
            hasFilters
              ? tf('transactions.table.empty.filteredTitle', '没有符合条件的交易')
              : tf('transactions.table.empty.noneTitle', '暂无交易记录')
          }
          description={
            hasFilters
              ? tf('transactions.table.empty.filteredDesc', '调整筛选条件后重试。')
              : tf('transactions.table.empty.noneDesc', '添加第一笔交易，或导入账单数据。')
          }
          secondaryAction={
            hasFilters
              ? {
                  label: tf('transactions.table.empty.clearFilters', '清空筛选'),
                  onClick: onClearFilters
                }
              : undefined
          }
          /*
           * 空列表时必须给出导入入口:文案写着「添加第一笔交易,或导入账单数据」,
           * 而导入按钮原来只在「当期账单」那一排 —— 没有任何交易时不渲染,
           * 新用户被文字引导去导入,却找不到入口。两个来源分开给,source 决定标签与一条支付宝专属规则。
           */
          secondaryActions={
            hasFilters || !onImportBill
              ? undefined
              : [
                  {
                    label: tf('transactions.table.empty.importWechat', '导入微信账单'),
                    onClick: () => onImportBill('wechat')
                  },
                  {
                    label: tf('transactions.table.empty.importAlipay', '导入支付宝账单'),
                    onClick: () => onImportBill('alipay')
                  }
                ]
          }
          primaryAction={
            hasFilters
              ? undefined
              : {
                  label: tf('transactions.table.empty.add', '新增账目'),
                  onClick: onCreate,
                  variant: 'primary'
                }
          }
        />
      ) : (
        <>
          {bulkSelectionEnabled && selectedIds.length > 0 ? (
            <BulkActionsBar
              selectedCount={selectedIds.length}
              categoryOptions={categoryOptions}
              accountOptions={accountOptions}
              bulkAiRecategorizing={bulkAiRecategorizing}
              bulkExportingPdf={bulkExportingPdf}
              bulkPrintTemplate={bulkPrintTemplate}
              bulkPrintFields={bulkPrintFields}
              onBulkEditCategory={onBulkEditCategory}
              onBulkAiRecategorize={onBulkAiRecategorize}
              onBulkEditAccount={onBulkEditAccount}
              onBulkPrintA4={onBulkPrintA4}
              onBulkExportPdf={onBulkExportPdf}
              onBulkPrintTemplateChange={onBulkPrintTemplateChange}
              onBulkPrintFieldsChange={onBulkPrintFieldsChange}
              onDeleteSelected={onDeleteSelected}
              onClearSelection={onClearSelection}
            />
          ) : null}

          {rows.length > 0 && showTaskSummary ? (
            <section
              className="transaction-task-strip"
              aria-label={tf('transactions.table.task.aria', '交易任务概览')}
            >
              <article className="transaction-task-item is-pending">
                <strong>{taskSummary.pending.count}</strong>
                <span>{tf('transactions.table.status.pending', '待处理')}</span>
                <small>{formatCurrencyAuto(taskSummary.pending.amount)}</small>
              </article>
              <article className="transaction-task-item is-refund">
                <strong>{taskSummary.refund.count}</strong>
                <span>{tf('transactions.table.task.adjustments', '退款 / 冲正')}</span>
                <small>{formatCurrencyAuto(taskSummary.refund.amount)}</small>
              </article>
              <article className="transaction-task-item is-failed">
                <strong>{taskSummary.failed.count}</strong>
                <span>{tf('transactions.table.task.failed', '失败单')}</span>
                <small>{formatCurrencyAuto(taskSummary.failed.amount)}</small>
              </article>
              <article className="transaction-task-item is-done">
                <strong>{taskSummary.done.count}</strong>
                <span>{tf('transactions.table.status.completed', '已完成')}</span>
                <small>{formatCurrencyAuto(taskSummary.done.amount)}</small>
              </article>
            </section>
          ) : null}

          <div className="transaction-table-wrap">
            <table>
              <colgroup>
                {bulkSelectionEnabled ? <col style={{ width: 40 }} /> : null}
                {orderedColumns.map((column) => {
                  if (!visibleColumns[column.key]) return null;
                  const width = columnWidths[column.key];
                  return <col key={`col-${column.key}`} style={width ? { width } : undefined} />;
                })}
              </colgroup>
              <thead>
                <tr>
                  {bulkSelectionEnabled ? (
                    <th className="transaction-select-col">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={(event) => onToggleSelectPage(event.target.checked)}
                        disabled={!canSelectAllOnPage}
                        aria-label={tf('transactions.table.selectPage', '全选当前页')}
                      />
                    </th>
                  ) : null}
                  {orderedColumns.map((column) => {
                    if (!visibleColumns[column.key]) return null;
                    return (
                      <th
                        key={`head-${column.key}`}
                        /* scope="col" + aria-sort:排序状态原来只有视觉箭头(⇅/↑/↓),
                           读屏器听不出「当前按哪列排、升序还是降序」。aria-sort 必须挂在
                           表头单元格上,button 上不生效。 */
                        scope="col"
                        aria-sort={
                          sortKey === column.key
                            ? sortDirection === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                        className={`transaction-col-${column.key} ${
                          isLongTextColumn(column.key)
                            ? 'transaction-col-long-text'
                            : 'transaction-col-compact'
                        }`}
                        draggable
                        onDragStart={() => {
                          dragColumnRef.current = column.key;
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (dragColumnRef.current && dragColumnRef.current !== column.key) {
                            onColumnReorder(dragColumnRef.current, column.key);
                          }
                          dragColumnRef.current = null;
                        }}
                      >
                        <button
                          type="button"
                          className={`transaction-sort-btn ${
                            isLongTextColumn(column.key)
                              ? 'transaction-sort-btn-left'
                              : 'transaction-sort-btn-center'
                          } ${sortKey === column.key ? 'active' : ''}`}
                          onClick={() => onSortChange(column.key)}
                        >
                          {column.label}{' '}
                          <span aria-hidden="true">
                            {sortIndicator(sortKey === column.key, sortDirection)}
                          </span>
                        </button>
                        <span
                          className="transaction-col-resizer"
                          role="separator"
                          aria-label={tf(
                            'transactions.table.columnResizeAria',
                            '{label}:列宽拖拽调节'
                          ).replace('{label}', column.label)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const currentWidth =
                              (
                                event.currentTarget.parentElement as HTMLElement | null
                              )?.getBoundingClientRect().width ||
                              columnWidths[column.key] ||
                              getMinColumnWidth(column.key);
                            resizeStateRef.current = {
                              key: column.key,
                              startX: event.clientX,
                              startWidth: currentWidth
                            };
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        />
                      </th>
                    );
                  })}
                </tr>
                <tr className="transaction-filter-row">
                  {bulkSelectionEnabled ? <th className="transaction-select-col" /> : null}
                  {orderedColumns.map((column) => {
                    if (!visibleColumns[column.key]) return null;
                    if (column.key === 'type' || column.key === 'status') {
                      return (
                        <th
                          key={`filter-${column.key}`}
                          className={`transaction-col-${column.key}`}
                        >
                          <select
                            aria-label={
                              column.key === 'type'
                                ? tf('transactions.table.filterAria.type', '按类型筛选')
                                : tf('transactions.table.filterAria.status', '按交易状态筛选')
                            }
                            value={column.key === 'type' ? quickFilters.type : quickFilters.status}
                            onChange={(event) =>
                              column.key === 'type'
                                ? onQuickFilterChange(
                                    'type',
                                    event.target.value as TransactionQuickFilters['type']
                                  )
                                : onQuickFilterChange(
                                    'status',
                                    event.target.value as TransactionQuickFilters['status']
                                  )
                            }
                          >
                            {column.key === 'type' ? (
                              <>
                                <option value="all">
                                  {tf('transactions.table.filter.all', '全部')}
                                </option>
                                <option value="income">
                                  {tf('transactions.table.type.income', '收入')}
                                </option>
                                <option value="expense">
                                  {tf('transactions.table.type.expense', '支出')}
                                </option>
                                <option value="budget">
                                  {tf('transactions.table.type.budget', '预算')}
                                </option>
                                <option value="repayment">
                                  {tf('transactions.table.type.repayment', '还款')}
                                </option>
                              </>
                            ) : (
                              <>
                                <option value="all">
                                  {tf('transactions.table.filter.all', '全部')}
                                </option>
                                <option value="pending">
                                  {tf('transactions.table.status.pending', '待处理')}
                                </option>
                                <option value="completed">
                                  {tf('transactions.table.status.completed', '已完成')}
                                </option>
                                <option value="refunded">
                                  {tf('transactions.table.status.refunded', '已退款')}
                                </option>
                                <option value="closed">
                                  {tf('transactions.table.status.closed', '已关闭')}
                                </option>
                                <option value="failed">
                                  {tf('transactions.table.status.failed', '失败')}
                                </option>
                              </>
                            )}
                          </select>
                        </th>
                      );
                    }
                    return (
                      <th key={`filter-${column.key}`} className={`transaction-col-${column.key}`}>
                        {column.key === 'date' ? (
                          <DatePicker
                            className="transaction-table-date-picker"
                            min={minAvailableDate}
                            max={maxAvailableDate}
                            value={quickFilters.date}
                            onChange={(value) => onQuickFilterChange('date', value)}
                            placeholder={tf(
                              'transactions.table.filterAria.date',
                              tf('transactions.table.filterAria.date', '筛选日期')
                            )}
                          />
                        ) : column.key === 'category' ? (
                          <select
                            aria-label={tf(
                              'transactions.table.filterAria.category',
                              tf('transactions.table.filterAria.category', '按分类筛选')
                            )}
                            value={quickFilters.category}
                            onChange={(event) =>
                              onQuickFilterChange('category', event.target.value)
                            }
                          >
                            <option value="">
                              {tf('transactions.table.filter.allCategories', '全部分类')}
                            </option>
                            <option value={EMPTY_CATEGORY_FILTER_VALUE}>
                              {tf('transactions.table.filter.uncategorized', '未分类')}
                            </option>
                            {categoryOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        ) : column.key === 'account' ? (
                          <select
                            aria-label={tf(
                              'transactions.table.filterAria.account',
                              tf('transactions.table.filterAria.account', '按账户筛选')
                            )}
                            value={quickFilters.account}
                            onChange={(event) => onQuickFilterChange('account', event.target.value)}
                          >
                            <option value="">
                              {tf('transactions.table.filter.allAccounts', '全部账户')}
                            </option>
                            {accountOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        ) : column.key === 'amount' ? (
                          <input
                            type="number"
                            value={quickFilters.amountMin}
                            onChange={(event) => {
                              onQuickFilterChange('amountMin', event.target.value);
                            }}
                            // 占位符不是可访问名称,读屏需要 aria-label 才能说清这一格筛什么。
                            aria-label={tf('transactions.table.filterAria.minAmount', '最小金额')}
                            placeholder={tf(
                              'transactions.table.filterAria.minAmount',
                              tf('transactions.table.filterAria.minAmount', '最小金额')
                            )}
                          />
                        ) : (
                          <input
                            value={
                              quickFilters[
                                textFilterKeyMap[
                                  column.key as Exclude<TransactionColumnKey, 'type' | 'status'>
                                ]
                              ]
                            }
                            onChange={(event) => {
                              const filterKey =
                                textFilterKeyMap[
                                  column.key as Exclude<TransactionColumnKey, 'type' | 'status'>
                                ];
                              onQuickFilterChange(filterKey, event.target.value);
                            }}
                            aria-label={tf(
                              'transactions.table.filterColumnPlaceholder',
                              '筛选{label}'
                            ).replace('{label}', column.label)}
                            placeholder={tf(
                              'transactions.table.filterColumnPlaceholder',
                              '筛选{label}'
                            ).replace('{label}', column.label)}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnCount} className="transaction-empty-cell">
                      <div className="transaction-empty-inline">
                        <span>
                          {tf(
                            'transactions.table.filter.empty',
                            '没有符合条件的交易，调整筛选条件后重试。'
                          )}
                        </span>
                        <button type="button" onClick={onClearFilters}>
                          {tf('transactions.table.empty.clearFilters', '清空筛选')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map(({ item, categoryName, accountName }) => {
                    const note = item.note || '-';
                    const checked = selectedIds.includes(item.id);
                    const repeatKey = getRepeatGroupKey(item);
                    const repeatInfo = repeatKey ? repeatedMonthlyMap.get(repeatKey) : undefined;
                    const repeatLabel = repeatInfo ? getRepeatLabel(repeatInfo.type, tf) : '';
                    const repeatTitle = repeatInfo
                      ? tf('transactions.table.repeatHint', '{note}本月{label}{count}次')
                          .replace('{note}', repeatInfo.note)
                          .replace('{label}', repeatLabel)
                          .replace('{count}', String(repeatInfo.count))
                      : '';
                    return (
                      <tr
                        key={item.id}
                        id={`transaction-row-${item.id}`}
                        /* roving tabindex:整张表只有一行进 Tab 顺序(没操作过时是第一行),
                           ↓/↑ 换行,Enter/空格 开详情。行内还有其他可聚焦控件(复选框等),
                           所以这里只解决"整行点开详情"这一个动作的键盘可达性。 */
                        tabIndex={
                          (rovingRowId ?? rows[0]?.item.id) === item.id ? 0 : -1
                        }
                        onFocus={() => setRovingRowId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            const all = Array.from(
                              event.currentTarget.parentElement?.querySelectorAll<
                                HTMLTableRowElement
                              >('tr.transaction-row-clickable') ?? []
                            );
                            const at = all.indexOf(event.currentTarget);
                            all[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
                            return;
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onOpenDetail(item.id);
                          }
                        }}
                        className={`transaction-row-clickable ${
                          highlightId === item.id ? 'transaction-row-highlight' : ''
                        } ${
                          isTransactionRefundLike(item)
                            ? 'transaction-row-refund-like'
                            : ''
                        }`.trim()}
                        onClick={(event) => {
                          event.currentTarget.focus();
                          onOpenDetail(item.id);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({ x: event.clientX, y: event.clientY, id: item.id });
                        }}
                      >
                        {bulkSelectionEnabled ? (
                          <td
                            className="transaction-select-col"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => onToggleSelect(item.id, event.target.checked)}
                              aria-label={tf(
                                'transactions.table.selectRowAria',
                                '选择交易 {date} {note}'
                              )
                                .replace('{date}', formatDate(item.date))
                                .replace('{note}', item.note || '')}
                            />
                          </td>
                        ) : null}
                        {orderedColumns.map((column) => {
                          if (!visibleColumns[column.key]) return null;
                          if (column.key === 'type') {
                            const typeLabel = renderCellValue(column.key, {
                              item,
                              categoryName,
                              accountName
                            });
                            const typeBadgeMap: Record<
                              TransactionItem['type'],
                              { short: string; label: string }
                            > = {
                              income: {
                                short: tf('transactions.table.badge.income', '收'),
                                label: tf('transactions.table.type.income', '收入')
                              },
                              expense: {
                                short: tf('transactions.table.badge.expense', '支'),
                                label: tf('transactions.table.type.expense', '支出')
                              },
                              budget: {
                                short: tf('transactions.table.badge.budget', '预'),
                                label: tf('transactions.table.type.budget', '预算')
                              },
                              repayment: {
                                short: tf('transactions.table.badge.repayment', '还'),
                                label: tf('transactions.table.type.repayment', '还款')
                              }
                            };
                            const isAdjustment = isTransactionRefundLike(item);
                            const badge =
                              isAdjustment && item.adjustmentKind
                                ? {
                                    short:
                                      item.adjustmentKind === 'refund'
                                        ? tf('transactions.table.badge.refund', '退')
                                        : tf('transactions.table.badge.reversal', '冲'),
                                    label:
                                      item.adjustmentKind === 'refund'
                                        ? tf('transactions.table.type.refund', '退款')
                                        : tf('transactions.table.type.reversal', '冲正')
                                  }
                                : typeBadgeMap[item.type];
                            const badgeTone = isAdjustment
                              ? getTransactionDirection(item) === 'inflow'
                                ? 'income'
                                : 'expense'
                              : item.type;
                            const isAiSource = item.source === 'ai';
                            const isHighExpense =
                              item.type === 'expense' &&
                              !isAdjustment &&
                              Number(item.amount) >= highExpenseThreshold;
                            const shouldShowAnomaly = isHighExpense && highExpenseThreshold > 0;
                            const anomalyHint = shouldShowAnomaly
                              ? `${tf('txPage.table.anomalyHintHead', `该笔金额明显高于当前均值（均值约 `)}${formatCurrencyAuto(expenseAverage)}${tf('txPage.table.anomalyHintTail', `）。建议检查是否重复记账。`)}`
                              : '';

                            if (badge) {
                              return (
                                <td key={`${item.id}-${column.key}`}>
                                  <div className="transaction-type-cell">
                                    <span
                                      className={`transaction-type-badge transaction-type-badge-${badgeTone}`}
                                      aria-label={badge.label}
                                      title={badge.label}
                                    >
                                      {badge.short}
                                    </span>
                                    {isAiSource ? (
                                      <span className="transaction-inline-tag transaction-inline-tag-ai">
                                        AI
                                      </span>
                                    ) : null}
                                    {repeatInfo ? (
                                      <span className="transaction-inline-tag" title={repeatTitle}>
                                        {tf(
                                          'transactions.table.repeat.label',
                                          '本月{label} {count} 次'
                                        )
                                          .replace('{label}', repeatLabel)
                                          .replace('{count}', String(repeatInfo.count))}
                                      </span>
                                    ) : null}
                                    {shouldShowAnomaly ? (
                                      <details
                                        className="transaction-inline-alert"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <summary
                                          title={tf('transactions.table.anomaly.label', '高于平均')}
                                        >
                                          !
                                        </summary>
                                        <div>
                                          <p>{anomalyHint}</p>
                                        </div>
                                      </details>
                                    ) : null}
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td key={`${item.id}-${column.key}`}>
                                <span className="transaction-type-text">{typeLabel}</span>
                              </td>
                            );
                          }
                          if (column.key === 'amount') {
                            return (
                              <td
                                key={`${item.id}-${column.key}`}
                                className={`transaction-amount-cell ${
                                  getTransactionDirection(item) === 'inflow'
                                    ? 'transaction-amount-income'
                                    : 'transaction-amount-expense'
                                }`}
                              >
                                {renderCellValue(column.key, { item, categoryName, accountName })}
                              </td>
                            );
                          }
                          if (column.key === 'note') {
                            return (
                              <td key={`${item.id}-${column.key}`}>
                                <span title={note} className="transaction-note-with-attachment">
                                  <span>
                                    {renderCellValue(column.key, {
                                      item,
                                      categoryName,
                                      accountName
                                    })}
                                  </span>
                                  {renderAttachmentIndicator(item.attachments?.length, tf)}
                                </span>
                              </td>
                            );
                          }
                          if (column.key === 'orderNo' || column.key === 'merchantOrderNo') {
                            const orderText = renderCellValue(column.key, {
                              item,
                              categoryName,
                              accountName
                            });
                            return (
                              <td key={`${item.id}-${column.key}`}>
                                <span
                                  className="transaction-order-ellipsis"
                                  title={String(orderText)}
                                >
                                  {orderText === '-' ? '-' : truncateOrderNo(String(orderText))}
                                </span>
                              </td>
                            );
                          }
                          return (
                            <td key={`${item.id}-${column.key}`}>
                              {renderCellValue(column.key, { item, categoryName, accountName })}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="transaction-summary-row">
                    <td colSpan={visibleColumnCount} className="transaction-summary-amount">
                      {tf(
                        'transactions.table.summary.label',
                        '汇总（当前页 {count} 条）/ 金额合计'
                      ).replace('{count}', String(rows.length))}{' '}
                      {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.overallTotal)} /{' '}
                      {tf('transactions.table.summary.income', '收入')}{' '}
                      {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.incomeTotal)} /{' '}
                      {tf('transactions.table.summary.expense', '支出')}{' '}
                      {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.expenseTotal)} /{' '}
                      {tf('transactions.table.summary.net', '净额')}{' '}
                      {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.netTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div
            className="transaction-mobile-list"
            aria-label={tf('transactions.table.mobile.aria', '移动端交易列表')}
          >
            {bulkSelectionEnabled && rows.length > 0 ? (
              <div className="transaction-mobile-selection-bar">
                <label>
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    disabled={!canSelectAllOnPage}
                    onChange={(event) => onToggleSelectPage(event.target.checked)}
                  />
                  <span>{tf('transactions.table.selectPage', '全选当前页')}</span>
                </label>
                <span>
                  {tf('transactions.table.selected', '已选 {count} 条').replace(
                    '{count}',
                    String(selectedIds.length)
                  )}
                </span>
              </div>
            ) : null}
            {rows.map(({ item, categoryName, accountName }) => {
              const note = item.note || tf('transactions.table.mobile.noNote', '（无备注）');
              const isSwiped = swipedId === item.id;
              const checked = selectedIds.includes(item.id);
              const repeatKey = getRepeatGroupKey(item);
              const repeatInfo = repeatKey ? repeatedMonthlyMap.get(repeatKey) : undefined;
              const repeatLabel = repeatInfo ? getRepeatLabel(repeatInfo.type, tf) : '';
              const repeatTitle = repeatInfo
                ? tf('transactions.table.repeatHint', '{note}本月{label}{count}次')
                    .replace('{note}', repeatInfo.note)
                    .replace('{label}', repeatLabel)
                    .replace('{count}', String(repeatInfo.count))
                : '';
              return (
                <article
                  key={`mobile-${item.id}`}
                  /* 和桌面行同样的处理:能被程序化聚焦,但不进 Tab 顺序,
                     这样详情抽屉关闭后焦点能回到这张卡片。 */
                  tabIndex={-1}
                  className={`transaction-mobile-item ${isSwiped ? 'is-swiped' : ''} ${
                    checked ? 'is-selected' : ''
                  }`.trim()}
                  onClick={(event) => {
                    if (bulkSelectionEnabled) {
                      onToggleSelect(item.id, !checked);
                      return;
                    }
                    if (swipedId === item.id) {
                      setSwipedId(null);
                      return;
                    }
                    event.currentTarget.focus();
                    onOpenDetail(item.id);
                  }}
                  onTouchStart={(event) => {
                    if (bulkSelectionEnabled) {
                      return;
                    }
                    touchStartXRef.current = event.touches[0]?.clientX ?? null;
                    if (swipedId && swipedId !== item.id) {
                      setSwipedId(null);
                    }
                  }}
                  onTouchEnd={(event) => {
                    if (bulkSelectionEnabled) {
                      touchStartXRef.current = null;
                      return;
                    }
                    const start = touchStartXRef.current;
                    const end = event.changedTouches[0]?.clientX;
                    touchStartXRef.current = null;
                    if (start === null || end === undefined) {
                      return;
                    }
                    const delta = end - start;
                    if (delta < -44) {
                      setSwipedId(item.id);
                    } else if (delta > 32 && swipedId === item.id) {
                      setSwipedId(null);
                    }
                  }}
                >
                  <div className="transaction-mobile-swipe">
                    <div className="transaction-mobile-main">
                      <header>
                        <div className="transaction-mobile-heading">
                          {bulkSelectionEnabled ? (
                            <input
                              type="checkbox"
                              checked={checked}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => onToggleSelect(item.id, event.target.checked)}
                              aria-label={tf(
                                'transactions.table.selectRowAria',
                                '选择交易 {date} {note}'
                              )
                                .replace('{date}', formatDate(item.date))
                                .replace('{note}', item.note || '')}
                            />
                          ) : null}
                          <strong
                            className={`transaction-amount-cell ${
                              getTransactionDirection(item) === 'inflow'
                                ? 'transaction-amount-income'
                                : 'transaction-amount-expense'
                            }`}
                          >
                            {privacyMode ? maskAmount() : formatCurrencyAuto(item.amount)}
                          </strong>
                        </div>
                        <div className="transaction-mobile-badges">
                          {item.source === 'ai' ? (
                            <span className="transaction-inline-tag transaction-inline-tag-ai">
                              AI
                            </span>
                          ) : null}
                          {repeatInfo ? (
                            <span className="transaction-inline-tag" title={repeatTitle}>
                              {tf('transactions.table.repeat.label', '本月{label} {count} 次')
                                .replace('{label}', repeatLabel)
                                .replace('{count}', String(repeatInfo.count))}
                            </span>
                          ) : null}
                          {item.type === 'expense' &&
                          !isTransactionRefundLike(item) &&
                          Number(item.amount) >= highExpenseThreshold ? (
                            <span
                              className="transaction-inline-tag transaction-inline-tag-warn"
                              title={tf(
                                'transactions.table.anomaly.title',
                                '高于平均，建议检查是否重复记账。'
                              )}
                            >
                              {tf('txPage.table.anomalyTag', `! 高于平均`)}
                            </span>
                          ) : null}
                        </div>
                        {!bulkSelectionEnabled ? (
                          <button
                            type="button"
                            className="transaction-mobile-more"
                            aria-haspopup="menu"
                            aria-expanded={contextMenu?.id === item.id}
                            aria-label={`${tf('txPage.table.moreActionsAria', `更多操作 `)}${item.note || formatDate(item.date)}`}
                            title={tf('transactions.table.moreActions.label', '更多操作')}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSwipedId(null);
                              const rect = event.currentTarget.getBoundingClientRect();
                              setContextMenu({
                                x: rect.right - 8,
                                y: rect.bottom + 6,
                                id: item.id
                              });
                            }}
                          >
                            ⋯
                          </button>
                        ) : null}
                      </header>
                      <p>
                        {note}
                        {renderAttachmentIndicator(item.attachments?.length, tf, true)}
                      </p>
                      {item.orderNo || item.merchantOrderNo ? (
                        <small>
                          {tf('txPage.table.orderLineLabel', `交易订单：`)}
                          {item.orderNo || '-'}{' '}
                          {tf('txPage.table.merchantOrderLineLabel', `· 商家订单：`)}
                          {privacyMode
                            ? maskMerchant(item.merchantOrderNo || '-')
                            : item.merchantOrderNo || '-'}
                        </small>
                      ) : null}
                      <small>
                        {formatDate(item.date)} · {categoryName} · {renderAccountLabel(accountName)}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="danger transaction-mobile-delete"
                      tabIndex={isSwiped ? 0 : -1}
                      aria-hidden={!isSwiped}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSwipedId(null);
                        onDelete(item.id);
                      }}
                    >
                      {tf('txPage.table.delete', `删除`)}
                    </button>
                    <button
                      type="button"
                      className="transaction-mobile-delete"
                      tabIndex={isSwiped ? 0 : -1}
                      aria-hidden={!isSwiped}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSwipedId(null);
                        onShare(item.id);
                      }}
                    >
                      {tf('txPage.table.share', `分享`)}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div
            className="row transaction-pagination"
            style={{ marginTop: 12, justifyContent: 'space-between' }}
          >
            <small
              className="transaction-pagination-summary"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {tf('transactions.table.pager.summary', '当前 {filtered} 条 / 全部 {total} 条')
                .replace('{filtered}', String(filteredTotal))
                .replace('{total}', String(total))}
            </small>
            <div className="transaction-pagination-controls">
              <label className="transaction-page-size">
                {tf('transactions.table.pager.every', '每页')}
                <select
                  aria-label={tf('transactions.table.pager.size', '每页显示条数')}
                  value={pageSize}
                  onChange={(event) => onPageSizeChange(Number(event.target.value))}
                >
                  {pageSizeOptions.map((size) => (
                    <option key={`page-size-${size}`} value={size}>
                      {tf('transactions.table.pager.rowsOption', '{count} 条').replace(
                        '{count}',
                        String(size)
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <small
                className="transaction-page-indicator"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {tf('transactions.table.pager.indicator', '第 {page} / {pages} 页')
                  .replace('{page}', String(page))
                  .replace('{pages}', String(pages))}
              </small>
              {/* WCAG 2.5.3(标签包含可见文字,A):这里的按钮可见文字是
                  「首页/上页/下页/末页」,而原来配的 aria-label 是「第一页/上一页/下一页/最后一页」,
                  名字里并不含屏幕上的字 —— 语音控制用户喊「首页」匹配不到。
                  现在不写 aria-label,让可见文字直接当可访问名(与 GOV.UK 等设计系统做法一致)。 */}
              <div className="transaction-page-nav">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={onFirstPage}
                >
                  {tf('transactions.table.pager.shortFirst', '首页')}
                </button>
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={onPrevPage}
                >
                  {tf('transactions.table.pager.shortPrev', '上页')}
                </button>
                <button
                  type="button"
                  disabled={page === pages}
                  onClick={onNextPage}
                >
                  {tf('transactions.table.pager.shortNext', '下页')}
                </button>
                <button
                  type="button"
                  disabled={page === pages}
                  onClick={onLastPage}
                >
                  {tf('transactions.table.pager.shortLast', '末页')}
                </button>
              </div>
            </div>
          </div>
          {contextMenu
            ? createPortal(
                <div
                  ref={contextMenuRef}
                  className="transaction-context-menu"
                  role="menu"
                  aria-label={tf('transactions.table.rowActions.label', '交易操作')}
                  style={{
                    left: contextMenuPosition?.x ?? contextMenu.x,
                    top: contextMenuPosition?.y ?? contextMenu.y
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onOpenDetail(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    {tf('txPage.table.viewDetail', `查看详情`)}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onShare(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    {tf('txPage.table.shareBill', `分享账单`)}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    role="menuitem"
                    onClick={() => {
                      onDelete(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    {tf('txPage.table.deleteBill', `删除账单`)}
                  </button>
                  <button type="button" role="menuitem" onClick={() => setContextMenu(null)}>
                    {tf('txPage.table.cancel', `取消`)}
                  </button>
                </div>,
                document.body
              )
            : null}
        </>
      )}
    </section>
  );
}
