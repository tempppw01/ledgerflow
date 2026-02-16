import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TransactionItem, TransactionStatus } from '../../../entities/transaction/types';
import { EMPTY_CATEGORY_FILTER_VALUE } from '../model/categoryQuickFilter';
import { formatCurrency, formatDate } from '../../../shared/lib/format';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { TableSkeleton } from '../../../shared/ui/TableSkeleton';

const NOTE_MAX_LENGTH = 22;

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

function truncateOrderNo(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function sortIndicator(active: boolean, direction: TransactionSortDirection): string {
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
  onPageSizeChange: (size: number) => void;
  onOpenDetail: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteSelected: () => void;
  onBulkEditCategory: (categoryId: string) => void;
  onBulkAiRecategorize: () => void;
  bulkAiRecategorizing: boolean;
  onBulkEditAccount: (accountId: string) => void;
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
  onPageSizeChange,
  onOpenDetail,
  onDelete,
  onDeleteSelected,
  onBulkEditCategory,
  onBulkAiRecategorize,
  bulkAiRecategorizing,
  onBulkEditAccount,
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
        return accountName;
      case 'amount':
        return formatCurrency(item.amount);
      case 'orderNo':
        return item.orderNo || '-';
      case 'merchantOrderNo':
        return item.merchantOrderNo || '-';
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

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const { key, startX, startWidth } = resizeStateRef.current;
      const next = Math.max(90, Math.round(startWidth + (event.clientX - startX)));
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
    <section className="panel">
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
                  onClick: () => {
                    window.location.href = '/transactions/new';
                  },
                  variant: 'primary'
                }
          }
        />
      ) : (
        <>
          {bulkSelectionEnabled && selectedIds.length > 0 ? (
            <div className="transaction-bulk-bar">
              <strong>已选中 {selectedIds.length} 条</strong>
              <div className="row transaction-bulk-actions">
                <label className="transaction-bulk-select">
                  <span>批量分类</span>
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      onBulkEditCategory(event.target.value);
                      event.target.value = '';
                    }}
                  >
                    <option value="">选择分类</option>
                    {categoryOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={onBulkAiRecategorize}>
                  {bulkAiRecategorizing ? '⏹ 停止 AI 重分类' : '🤖 AI 重分类'}
                </button>
                <label className="transaction-bulk-select">
                  <span>批量账户</span>
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      onBulkEditAccount(event.target.value);
                      event.target.value = '';
                    }}
                  >
                    <option value="">选择账户</option>
                    {accountOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={onDeleteSelected} className="danger">
                  批量删除
                </button>
                <button type="button" onClick={onClearSelection}>
                  取消选择
                </button>
              </div>
            </div>
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
                          className={`transaction-sort-btn ${sortKey === column.key ? 'active' : ''}`}
                          onClick={() => onSortChange(column.key)}
                        >
                          {column.label}{' '}
                          <span>{sortIndicator(sortKey === column.key, sortDirection)}</span>
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
                              140;
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
                        <th key={`filter-${column.key}`}>
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
                      <th key={`filter-${column.key}`}>
                        {column.key === 'date' ? (
                          <input
                            type="date"
                            min={minAvailableDate}
                            max={maxAvailableDate}
                            value={quickFilters.date}
                            onChange={(event) => onQuickFilterChange('date', event.target.value)}
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
                        ) : column.key === 'amount' ? (
                          <div className="transaction-amount-range-inputs">
                            <input
                              type="number"
                              value={quickFilters.amountMin}
                              onChange={(event) =>
                                onQuickFilterChange('amountMin', event.target.value)
                              }
                              placeholder="最小"
                            />
                            <span>~</span>
                            <input
                              type="number"
                              value={quickFilters.amountMax}
                              onChange={(event) =>
                                onQuickFilterChange('amountMax', event.target.value)
                              }
                              placeholder="最大"
                            />
                          </div>
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
                    return (
                      <tr
                        key={item.id}
                        id={`transaction-row-${item.id}`}
                        className={`transaction-row-clickable ${highlightId === item.id ? 'transaction-row-highlight' : ''}`.trim()}
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
                            if (item.type === 'income' || item.type === 'expense') {
                              return (
                                <td key={`${item.id}-${column.key}`}>
                                  <span
                                    className={`transaction-type-dot transaction-type-dot-${item.type}`}
                                    aria-hidden="true"
                                  />
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
                                <span title={note}>
                                  {renderCellValue(column.key, { item, categoryName, accountName })}
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
            </table>
          </div>

          <div className="transaction-mobile-list" aria-label="移动端交易列表">
            {rows.map(({ item, categoryName, accountName }) => {
              const note = item.note || '（无备注）';
              const isSwiped = swipedId === item.id;
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
                          {formatCurrency(item.amount)}
                        </strong>
                      </header>
                      <p>{note}</p>
                      {item.orderNo || item.merchantOrderNo ? (
                        <small>
                          交易订单：{item.orderNo || '-'} · 商家订单：{item.merchantOrderNo || '-'}
                        </small>
                      ) : null}
                      <small>
                        {formatDate(item.date)} · {categoryName} · {accountName}
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
                  </div>
                </article>
              );
            })}
          </div>

          <div
            className="row transaction-pagination"
            style={{ marginTop: 12, justifyContent: 'space-between' }}
          >
            <small style={{ color: 'var(--color-text-secondary)' }}>
              当前 {filteredTotal} 条 / 全部 {total} 条
            </small>
            <div className="row transaction-pagination-controls">
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
              <button type="button" disabled={page === 1} onClick={onPrevPage}>
                上一页
              </button>
              <small style={{ color: 'var(--color-text-secondary)' }}>
                第 {page} / {pages} 页
              </small>
              <button type="button" disabled={page === pages} onClick={onNextPage}>
                下一页
              </button>
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
