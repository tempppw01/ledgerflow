import { formatCurrency } from '../../../shared/lib/format';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { resolveBudgetCategoryLabel } from '../model/budgetCategoryLabels';
import { formatBudgetMonthShortLabel } from '../model/budgetPacing';
import { BudgetTrendIcon } from './budgetIcons';

export type BudgetTrendPoint = {
  monthKey: string;
  spent: number;
  budget: number;
};

export type BudgetTrendSeries = {
  category: string;
  points: BudgetTrendPoint[];
};

export type BudgetTrendPanelProps = {
  series: BudgetTrendSeries[];
};

export function BudgetTrendPanel({ series }: BudgetTrendPanelProps) {
  const tf = useTFallback();
  const maxValue = Math.max(
    ...series.flatMap((item) => item.points.map((point) => Math.max(point.spent, point.budget))),
    1
  );

  return (
    <section className="sb-panel" aria-label={tf('smartBudget.trend.aria', '预算执行趋势')}>
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-section-title">
            <BudgetTrendIcon className="sb-icon-sm" />
            {tf('smartBudget.trend.title', '最近几个月，钱主要花在哪里')}
          </h3>
          <p className="sb-panel-sub">
            {tf('smartBudget.trend.subtitle', '柱子是实际支出，虚线是当月预算线。')}
          </p>
        </div>
      </div>

      {series.length === 0 ? (
        <p className="sb-empty">
          {tf('smartBudget.trend.empty', '记录满两个月后,这里会显示分类预算与实际支出的趋势对比。')}
        </p>
      ) : (
        <div className="sb-trend-grid">
          {series.map((item) => {
            const latest = item.points[item.points.length - 1];
            return (
              <article key={item.category} className="sb-trend-item">
                <header>
                  <strong>{resolveBudgetCategoryLabel(item.category, tf)}</strong>
                  <span>{latest ? formatCurrency(latest.spent) : '-'}</span>
                </header>
                <div className="sb-trend-chart">
                  {item.points.map((point) => {
                    const budgetTop = (point.budget / maxValue) * 100;
                    const spentTop = (point.spent / maxValue) * 100;
                    return (
                      <div key={point.monthKey} className="sb-trend-column">
                        <div className="sb-trend-plot">
                          <span
                            className={`sb-trend-budget-line ${point.spent > point.budget ? 'is-over' : ''}`}
                            style={{ bottom: `${Math.min(budgetTop, 100)}%` }}
                          />
                          <span
                            className={`sb-trend-bar ${point.spent > point.budget ? 'is-over' : ''}`}
                            style={{ height: `${Math.max(spentTop, 1)}%` }}
                            title={tf('smartBudget.trend.barTitle', '{month} 支出 {amount}')
                              .replace(
                                '{month}',
                                String(formatBudgetMonthShortLabel(point.monthKey, tf))
                              )
                              .replace('{amount}', String(formatCurrency(point.spent)))}
                          />
                        </div>
                        <span className="sb-trend-label">
                          {formatBudgetMonthShortLabel(point.monthKey, tf)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
