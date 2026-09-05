import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TransactionItem, TransactionStatus } from '../../../entities/transaction/types';
import { EMPTY_CATEGORY_FILTER_VALUE } from '../model/categoryQuickFilter';
import { formatCurrencyAuto, formatDate } from '../../../shared/lib/format';
import { summarizeTransactions } from '../../../shared/lib/transactionMetrics';
import { EmptyState } from '../../../shared/ui/EmptyState';
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
const TRANSACTION_SORT_ICON_BASE_URL =
  'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/ui';

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
    return accountName;
  }

  return (
    <span className="transaction-account-with-icon">
      {brand === 'alipay' ? <AlipayBrandIcon /> : null}
      {brand === 'wechat' ? <WechatBrandIcon /> : null}
      {brand === 'bank' ? <BankBrandIcon /> : null}
      <span>{accountName}</span>
    </span>
  );
}

function renderAttachmentIndicator(count?: number, compact = false) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (safeCount <= 0) return null;
  const label = safeCount > 1 ? `有 ${safeCount} 个附件` : '有附件';
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

function getRepeatLabel(type: TransactionItem['type']): string {
  return type === 'income' ? '收入' : '消费';
}

function truncateOrderNo(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function sortIndicator(
  key: TransactionSortKey,
  active: boolean,
  direction: TransactionSortDirection
) {
  if (key === 'amount') {
    const iconName =
      active && direction === 'asc' ? 'arrow-down-narrow-wide' : 'arrow-down-wide-narrow';
    return (
      <img
        className="transaction-sort-icon"
        src={`${TRANSACTION_SORT_ICON_BASE_URL}/${iconName}.svg`}
        alt=""
        aria-hidden="true"
      />
    );
  }

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

const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: '待处理',
  completed: '已完成',
  refunded: '已退款',
  closed: '已关闭',
  failed: '失败'
};

function formatStatus(status?: TransactionStatus): string {
  if (!status) return '-';
  return STATUS_LABELS[status] || status;
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
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const dragColumnRef = useRef<TransactionColumnKey | null>(null);
  const resizeStateRef = useRef<{
    key: TransactionColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  const columnOptions: Array<{ key: TransactionColumnKey; label: string }> = [
    { key: 'date', label: '日期' },
    { key: 'type', label: '类型' },
    { key: 'status', label: '交易状态' },
    { key: 'category', label: '分类' },
    { key: 'account', label: '账户' },
    { key: 'amount', label: '金额' },
    { key: 'orderNo', label: '交易订单号' },
    { key: 'merchantOrderNo', label: '商家订单号' },
    { key: 'note', label: '备注' }
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
        return item.type === 'income'
          ? '收入'
          : item.type === 'budget'
            ? '预算'
            : item.type === 'repayment'
              ? '还款'
              : '支出';
      case 'category':
        return categoryName;
      case 'status':
        return formatStatus(item.status);
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
    const incomeTotal = rows.reduce(
      (sum, row) => (row.item.type === 'income' ? sum + row.item.amount : sum),
      0
    );
    const expenseTotal = rows.reduce(
      (sum, row) => (row.item.type !== 'income' ? sum + row.item.amount : sum),
      0
    );
    return {
      incomeTotal,
      expenseTotal,
      netTotal: incomeTotal - expenseTotal,
      overallTotal: rows.reduce((sum, row) => sum + row.item.amount, 0)
    };
  }, [rows]);

  const taskSummary = useMemo(() => {
    const pendingRows = rows.filter((row) => row.item.status === 'pending');
    const refundRows = rows.filter(
      (row) =>
        row.item.adjustmentKind === 'refund' ||
        row.item.adjustmentKind === 'reversal' ||
        row.item.status === 'refunded'
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
      if (item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal') {
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
    window.addEventListener('click', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);

    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [contextMenu]);

  return (
    <section className="panel transaction-ledger-surface">
      {loading ? (
        <TableSkeleton rows={6} columns={8} />
      ) : errorMessage ? (
        <EmptyState
          icon="⚠️"
          title="交易数据加载失败"
          description={errorMessage}
          secondaryAction={{ label: '清空筛选', onClick: onClearFilters }}
          primaryAction={{ label: '重试', onClick: onRetry, variant: 'primary' }}
        />
      ) : rows.length === 0 && !hasFilters ? (
        <EmptyState
          icon="📋"
          title={hasFilters ? '没有符合条件的交易' : '暂无交易记录'}
          description={hasFilters ? '调整筛选条件后重试。' : '添加第一笔交易，或导入账单数据。'}
          secondaryAction={hasFilters ? { label: '清空筛选', onClick: onClearFilters } : undefined}
          primaryAction={
            hasFilters
              ? undefined
              : {
                  label: '新增账目',
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
            <section className="transaction-task-strip" aria-label="交易任务概览">
              <article className="transaction-task-item is-pending">
                <strong>{taskSummary.pending.count}</strong>
                <span>待处理</span>
                <small>{formatCurrencyAuto(taskSummary.pending.amount)}</small>
              </article>
              <article className="transaction-task-item is-refund">
                <strong>{taskSummary.refund.count}</strong>
                <span>退款 / 冲正</span>
                <small>{formatCurrencyAuto(taskSummary.refund.amount)}</small>
              </article>
              <article className="transaction-task-item is-failed">
                <strong>{taskSummary.failed.count}</strong>
                <span>失败单</span>
                <small>{formatCurrencyAuto(taskSummary.failed.amount)}</small>
              </article>
              <article className="transaction-task-item is-done">
                <strong>{taskSummary.done.count}</strong>
                <span>已完成</span>
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
                        aria-label="全选当前页"
                      />
                    </th>
                  ) : null}
                  {orderedColumns.map((column) => {
                    if (!visibleColumns[column.key]) return null;
                    return (
                      <th
                        key={`head-${column.key}`}
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
                          <span>
                            {sortIndicator(column.key, sortKey === column.key, sortDirection)}
                          </span>
                        </button>
                        <span
                          className="transaction-col-resizer"
                          role="separator"
                          aria-label={`${column.label}列宽拖拽调节`}
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
                            aria-label={column.key === 'type' ? '按类型筛选' : '按交易状态筛选'}
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
                                <option value="all">全部</option>
                                <option value="income">收入</option>
                                <option value="expense">支出</option>
                                <option value="budget">预算</option>
                                <option value="repayment">还款</option>
                              </>
                            ) : (
                              <>
                                <option value="all">全部</option>
                                <option value="pending">待处理</option>
                                <option value="completed">已完成</option>
                                <option value="refunded">已退款</option>
                                <option value="closed">已关闭</option>
                                <option value="failed">失败</option>
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
                            min={minAvailableDate}
                            max={maxAvailableDate}
                            value={quickFilters.date}
                            onChange={(value) => onQuickFilterChange('date', value)}
                            placeholder="筛选日期"
                          />
                        ) : column.key === 'category' ? (
                          <select
                            aria-label="按分类筛选"
                            value={quickFilters.category}
                            onChange={(event) =>
                              onQuickFilterChange('category', event.target.value)
                            }
                          >
                            <option value="">全部分类</option>
                            <option value={EMPTY_CATEGORY_FILTER_VALUE}>未分类</option>
                            {categoryOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        ) : column.key === 'account' ? (
                          <select
                            aria-label="按账户筛选"
                            value={quickFilters.account}
                            onChange={(event) => onQuickFilterChange('account', event.target.value)}
                          >
                            <option value="">全部账户</option>
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
                            placeholder="最小金额"
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
                            placeholder={`筛选${column.label}`}
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
                        <span>没有符合条件的交易，调整筛选条件后重试。</span>
                        <button type="button" onClick={onClearFilters}>
                          清空筛选
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
                    const repeatLabel = repeatInfo ? getRepeatLabel(repeatInfo.type) : '';
                    const repeatTitle = repeatInfo
                      ? `${repeatInfo.note}本月${repeatLabel}${repeatInfo.count}次`
                      : '';
                    return (
                      <tr
                        key={item.id}
                        id={`transaction-row-${item.id}`}
                        className={`transaction-row-clickable ${
                          highlightId === item.id ? 'transaction-row-highlight' : ''
                        } ${
                          item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal'
                            ? 'transaction-row-refund-like'
                            : ''
                        }`.trim()}
                        onClick={() => onOpenDetail(item.id)}
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
                              aria-label={`选择交易 ${formatDate(item.date)} ${item.note || ''}`}
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
                              income: { short: '收', label: '收入' },
                              expense: { short: '支', label: '支出' },
                              budget: { short: '预', label: '预算' },
                              repayment: { short: '还', label: '还款' }
                            };
                            const badge = typeBadgeMap[item.type];
                            const isAiSource = item.source === 'ai';
                            const isHighExpense =
                              item.type === 'expense' &&
                              Number(item.amount) >= highExpenseThreshold;
                            const shouldShowAnomaly = isHighExpense && highExpenseThreshold > 0;
                            const anomalyHint = shouldShowAnomaly
                              ? `该笔金额明显高于当前均值（均值约 ${formatCurrencyAuto(expenseAverage)}）。建议检查是否重复记账。`
                              : '';

                            if (badge) {
                              return (
                                <td key={`${item.id}-${column.key}`}>
                                  <div className="transaction-type-cell">
                                    <span
                                      className={`transaction-type-badge transaction-type-badge-${item.type}`}
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
                                        本月{repeatLabel} {repeatInfo.count} 次
                                      </span>
                                    ) : null}
                                    {shouldShowAnomaly ? (
                                      <details
                                        className="transaction-inline-alert"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <summary title="高于平均">!</summary>
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
                                  item.type === 'income'
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
                                  {renderAttachmentIndicator(item.attachments?.length)}
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
                      汇总（当前页 {rows.length} 条）｜ 金额合计{' '}
                      {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.overallTotal)} ｜
                      收入{' '}
                      {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.incomeTotal)} ｜
                      支出{' '}
                      {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.expenseTotal)} ｜
                      净额 {privacyMode ? maskAmount() : formatCurrencyAuto(pageSummary.netTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="transaction-mobile-list" aria-label="移动端交易列表">
            {rows.map(({ item, categoryName, accountName }) => {
              const note = item.note || '（无备注）';
              const isSwiped = swipedId === item.id;
              const repeatKey = getRepeatGroupKey(item);
              const repeatInfo = repeatKey ? repeatedMonthlyMap.get(repeatKey) : undefined;
              const repeatLabel = repeatInfo ? getRepeatLabel(repeatInfo.type) : '';
              const repeatTitle = repeatInfo
                ? `${repeatInfo.note}本月${repeatLabel}${repeatInfo.count}次`
                : '';
              return (
                <article
                  key={`mobile-${item.id}`}
                  className={`transaction-mobile-item ${isSwiped ? 'is-swiped' : ''}`.trim()}
                  onClick={() => {
                    if (swipedId === item.id) {
                      setSwipedId(null);
                      return;
                    }
                    onOpenDetail(item.id);
                  }}
                  onTouchStart={(event) => {
                    touchStartXRef.current = event.touches[0]?.clientX ?? null;
                    if (swipedId && swipedId !== item.id) {
                      setSwipedId(null);
                    }
                  }}
                  onTouchEnd={(event) => {
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
                        <strong
                          className={`transaction-amount-cell ${
                            item.type === 'income'
                              ? 'transaction-amount-income'
                              : 'transaction-amount-expense'
                          }`}
                        >
                          {privacyMode ? maskAmount() : formatCurrencyAuto(item.amount)}
                        </strong>
                        <div className="transaction-mobile-badges">
                          {item.source === 'ai' ? (
                            <span className="transaction-inline-tag transaction-inline-tag-ai">
                              AI
                            </span>
                          ) : null}
                          {repeatInfo ? (
                            <span className="transaction-inline-tag" title={repeatTitle}>
                              本月{repeatLabel} {repeatInfo.count} 次
                            </span>
                          ) : null}
                          {item.type === 'expense' &&
                          Number(item.amount) >= highExpenseThreshold ? (
                            <span
                              className="transaction-inline-tag transaction-inline-tag-warn"
                              title="高于平均，建议检查是否重复记账。"
                            >
                              ! 高于平均
                            </span>
                          ) : null}
                        </div>
                      </header>
                      <p>
                        {note}
                        {renderAttachmentIndicator(item.attachments?.length, true)}
                      </p>
                      {item.orderNo || item.merchantOrderNo ? (
                        <small>
                          交易订单：{item.orderNo || '-'} · 商家订单：
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
                      onClick={(event) => {
                        event.stopPropagation();
                        setSwipedId(null);
                        onDelete(item.id);
                      }}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      className="transaction-mobile-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSwipedId(null);
                        onShare(item.id);
                      }}
                    >
                      分享
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
              当前 {filteredTotal} 条 / 全部 {total} 条
            </small>
            <div className="transaction-pagination-controls">
              <label className="transaction-page-size">
                每页
                <select
                  aria-label="每页显示条数"
                  value={pageSize}
                  onChange={(event) => onPageSizeChange(Number(event.target.value))}
                >
                  {pageSizeOptions.map((size) => (
                    <option key={`page-size-${size}`} value={size}>
                      {size} 条
                    </option>
                  ))}
                </select>
              </label>
              <small
                className="transaction-page-indicator"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                第 {page} / {pages} 页
              </small>
              <div className="transaction-page-nav">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={onFirstPage}
                  aria-label="第一页"
                >
                  首页
                </button>
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={onPrevPage}
                  aria-label="上一页"
                >
                  上页
                </button>
                <button
                  type="button"
                  disabled={page === pages}
                  onClick={onNextPage}
                  aria-label="下一页"
                >
                  下页
                </button>
                <button
                  type="button"
                  disabled={page === pages}
                  onClick={onLastPage}
                  aria-label="最后一页"
                >
                  末页
                </button>
              </div>
            </div>
          </div>
          {contextMenu
            ? createPortal(
                <div
                  ref={contextMenuRef}
                  className="transaction-context-menu"
                  style={{
                    left: contextMenuPosition?.x ?? contextMenu.x,
                    top: contextMenuPosition?.y ?? contextMenu.y
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onOpenDetail(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    查看详情
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onShare(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    分享账单
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      onDelete(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    删除账单
                  </button>
                  <button type="button" onClick={() => setContextMenu(null)}>
                    取消
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
