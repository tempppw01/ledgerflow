import { formatCurrency } from '../../../shared/lib/format';
import { BudgetComparison } from '../model/budgetComparison';
import { formatBudgetMonthLabel } from '../model/budgetPacing';

export type BudgetComparisonPanelProps = {
  comparison: BudgetComparison;
  onSelectCategory: (category: string) => void;
};

export function BudgetComparisonPanel({
  comparison,
  onSelectCategory
}: BudgetComparisonPanelProps) {
  const rows = comparison.rows.slice(0, 8);
  const maxDelta = Math.max(...rows.map((row) => Math.abs(row.spentDelta)), 1);
  const totalUp = comparison.totalDelta > 0;

  return (
    <section className="sb-panel" aria-label="环比对比">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-section-title">和上个月比，花在哪儿变了</h3>
          <p className="sb-panel-sub">
            {formatBudgetMonthLabel(comparison.previousMonthKey)} → 本月，整体
            {totalUp ? '多花' : '少花'} {formatCurrency(Math.abs(comparison.totalDelta))}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="sb-muted">暂时没有可对比的分类数据。</p>
      ) : (
        <ul className="sb-compare-list">
          {rows.map((row) => {
            const delta = row.spentDelta;
            const width = (Math.abs(delta) / maxDelta) * 50;
            return (
              <li key={row.category}>
                <button
                  type="button"
                  className="sb-compare-row"
                  onClick={() => onSelectCategory(row.category)}
                >
                  <span className="sb-compare-name">{row.category}</span>
                  <span className="sb-compare-track">
                    <span
                      className={`sb-compare-bar ${delta > 0 ? 'is-up' : 'is-down'}`}
                      style={
                        delta >= 0
                          ? { left: '50%', width: `${width}%` }
                          : { right: '50%', width: `${width}%` }
                      }
                    />
                  </span>
                  <span className={`sb-compare-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>
                    {delta > 0 ? '+' : ''}
                    {formatCurrency(delta)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
