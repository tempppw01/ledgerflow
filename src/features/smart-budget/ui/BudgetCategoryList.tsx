import { useEffect, useState } from 'react';
import { formatCurrency } from '../../../shared/lib/format';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { BudgetTrackingRow } from '../model/budgetInsights';
import { BudgetComparisonRow } from '../model/budgetComparison';
import { BudgetEditIcon, BudgetTargetIcon } from './budgetIcons';

export type BudgetCategoryListProps = {
  rows: BudgetTrackingRow[];
  comparisonRows: BudgetComparisonRow[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: (row: BudgetTrackingRow) => void;
  onAdjust: (category: string, amount: number) => void;
};

function statusOf(row: BudgetTrackingRow) {
  if (row.ratio > 1) {
    return { key: 'overspent', label: '超支' } as const;
  }
  if (row.ratio >= 0.7) {
    return { key: 'warning', label: '预警' } as const;
  }
  return { key: 'normal', label: '正常' } as const;
}

function CategoryRow(props: {
  row: BudgetTrackingRow;
  delta: number | undefined;
  onSelect: () => void;
  onAdjust: (amount: number) => void;
}) {
  const { row, delta, onSelect, onAdjust } = props;
  const tf = useTFallback();
  const status = statusOf(row);
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(row.budgetAmount);

  useEffect(() => {
    setDraftAmount(row.budgetAmount);
  }, [row.budgetAmount]);

  const progress = Math.min(Math.round(row.ratio * 100), 160);

  const commit = () => {
    const next = Number(draftAmount);
    if (Number.isFinite(next) && next >= 0 && Math.round(next) !== row.budgetAmount) {
      onAdjust(Math.round(next));
    }
    setEditing(false);
  };

  return (
    <article
      className={`sb-category-card is-${status.key}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <header className="sb-category-card-head">
        <h4>{row.category}</h4>
        <span className={`sb-status-tag is-${status.key}`}>
          {tf(`smartBudget.categoryList.status.${status.key}`, status.label)}
        </span>
      </header>

      <div className="sb-category-amounts">
        <div>
          <span>{tf('smartBudget.categoryList.spent', '已花费')}</span>
          <strong className="sb-number">{formatCurrency(row.spentAmount)}</strong>
        </div>
        <div>
          <span>{tf('smartBudget.categoryList.budget', '预算')}</span>
          {editing ? (
            <div
              className="sb-amount-input is-compact"
              onClick={(event) => event.stopPropagation()}
            >
              <span aria-hidden="true">¥</span>
              <input
                aria-label={tf('smartBudget.categoryList.amountAria', '{category}预算金额').replace(
                  '{category}',
                  String(row.category)
                )}
                type="number"
                min={0}
                step={100}
                autoFocus
                value={draftAmount}
                onChange={(event) => setDraftAmount(Number(event.target.value))}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commit();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setDraftAmount(row.budgetAmount);
                    setEditing(false);
                  }
                }}
              />
            </div>
          ) : (
            <strong className="sb-number">{formatCurrency(row.budgetAmount)}</strong>
          )}
        </div>
      </div>

      <div className="sb-category-meta">
        <span>
          {tf('smartBudget.common.executionRate', '执行率')} {(row.ratio * 100).toFixed(1)}%
        </span>
        <span className={row.diff <= 0 ? 'is-safe' : 'is-warn'}>
          {row.diff <= 0
            ? tf('smartBudget.categoryList.left', '剩 {amount}').replace(
                '{amount}',
                String(formatCurrency(-row.diff))
              )
            : tf('smartBudget.categoryList.over', '超 {amount}').replace(
                '{amount}',
                String(formatCurrency(row.diff))
              )}
        </span>
        {typeof delta === 'number' && Math.abs(delta) >= 1 ? (
          <span className={delta > 0 ? 'is-warn' : 'is-safe'}>
            {tf('smartBudget.categoryList.vsLastMonth', '环比')} {delta > 0 ? '+' : ''}
            {formatCurrency(delta)}
          </span>
        ) : null}
      </div>

      <div className="sb-progress-track" role="presentation">
        <span
          className={row.isOverspent ? 'is-warn' : ''}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      <footer className="sb-category-card-foot">
        <button
          type="button"
          className="sb-btn sb-btn--ghost sb-btn--xs"
          onClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
        >
          <BudgetEditIcon className="sb-icon-xs" />
          {tf('smartBudget.categoryList.adjust', '调整预算')}
        </button>
        <button
          type="button"
          className="sb-btn sb-btn--ghost sb-btn--xs"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <BudgetTargetIcon className="sb-icon-xs" />
          {tf('smartBudget.categoryList.details', '查看详情')}
        </button>
      </footer>
    </article>
  );
}

export function BudgetCategoryList(props: BudgetCategoryListProps) {
  const { rows, comparisonRows, expanded, onToggleExpanded, onSelect, onAdjust } = props;
  const tf = useTFallback();
  const deltaMap = new Map(comparisonRows.map((row) => [row.category, row.spentDelta]));
  const visibleRows = expanded ? rows : rows.slice(0, 8);

  if (rows.length === 0) {
    return (
      <p className="sb-empty">
        {tf('smartBudget.categoryList.empty', '当前筛选条件下暂无预算项，切换月份或筛选条件试试。')}
      </p>
    );
  }

  return (
    <>
      <div className="sb-list-toolbar">
        <span className="sb-muted">
          {tf('smartBudget.categoryList.shown', '已显示')} {visibleRows.length} / {rows.length}{' '}
          {tf('smartBudget.categoryList.shownUnit', '个预算分类')}
        </span>
        {rows.length > 8 ? (
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--xs"
            onClick={onToggleExpanded}
          >
            {expanded
              ? tf('smartBudget.categoryList.collapse', '收起分类')
              : tf('smartBudget.categoryList.expandAll', '展开全部 {count} 个分类').replace(
                  '{count}',
                  String(rows.length)
                )}
          </button>
        ) : null}
      </div>

      <div className="sb-category-grid">
        {visibleRows.map((row) => (
          <CategoryRow
            key={row.category}
            row={row}
            delta={deltaMap.get(row.category)}
            onSelect={() => onSelect(row)}
            onAdjust={(amount) => onAdjust(row.category, amount)}
          />
        ))}
      </div>
    </>
  );
}
