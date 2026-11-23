import { formatExecutionRatePercent } from '../model/rateDisplay';
import { formatCurrency, formatDate } from '../../../shared/lib/format';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { BudgetTrackingRow } from '../model/budgetInsights';
import { BudgetCategoryDetail } from '../model/budgetDetail';
import { resolveBudgetCategoryLabel } from '../model/budgetCategoryLabels';
import { formatBudgetMonthShortLabel } from '../model/budgetPacing';
import { BudgetCloseIcon, BudgetTrendIcon } from './budgetIcons';

export type BudgetDetailDrawerProps = {
  row: BudgetTrackingRow;
  detail: BudgetCategoryDetail | null;
  onClose: () => void;
};

export function BudgetDetailDrawer({ row, detail, onClose }: BudgetDetailDrawerProps) {
  const tf = useTFallback();
  const maxSpent = Math.max(...(detail?.monthlyPoints.map((point) => point.spent) || [1]), 1);

  return (
    <aside
      className="sb-drawer"
      aria-label={tf('smartBudget.detail.aria', '{category}预算详情').replace(
        '{category}',
        resolveBudgetCategoryLabel(row.category, tf)
      )}
    >
      <div className="sb-drawer-panel">
        <header className="sb-drawer-head">
          <div>
            <span className="sb-drawer-kicker">{tf('smartBudget.detail.title', '分类详情')}</span>
            <h3>{resolveBudgetCategoryLabel(row.category, tf)}</h3>
          </div>
          <button
            type="button"
            className="sb-icon-btn"
            onClick={onClose}
            aria-label={tf('smartBudget.detail.close', '关闭详情')}
          >
            <BudgetCloseIcon className="sb-icon-sm" />
          </button>
        </header>

        <div className="sb-drawer-body">
          <div className="sb-drawer-stats">
            <div>
              <span>{tf('smartBudget.categoryList.spent', '已花费')}</span>
              <strong className="sb-number">{formatCurrency(row.spentAmount)}</strong>
            </div>
            <div>
              <span>{tf('smartBudget.categoryList.budget', '预算')}</span>
              <strong className="sb-number">{formatCurrency(row.budgetAmount)}</strong>
            </div>
            <div>
              <span>{tf('smartBudget.detail.diff', '差额')}</span>
              <strong className={`sb-number ${row.diff <= 0 ? 'is-positive' : 'is-negative'}`}>
                {row.diff <= 0 ? formatCurrency(-row.diff) : `-${formatCurrency(row.diff)}`}
              </strong>
            </div>
          </div>

          <div className="sb-progress-track is-large" role="presentation">
            <span
              className={row.isOverspent ? 'is-warn' : ''}
              style={{ width: `${Math.min(Math.round(row.ratio * 100), 100)}%` }}
            />
          </div>
          <p className="sb-drawer-rate">
            {tf('smartBudget.common.executionRate', '执行率')} {formatExecutionRatePercent(row.ratio)}
          </p>

          {detail ? (
            <>
              <section className="sb-drawer-section">
                <h4>
                  <BudgetTrendIcon className="sb-icon-sm" />
                  {tf('smartBudget.detail.recentPrefix', '最近')} {detail.monthlyPoints.length}{' '}
                  {tf('smartBudget.detail.recentSuffix', '个月')}
                </h4>
                <div className="sb-mini-bars">
                  {detail.monthlyPoints.map((point) => (
                    <div key={point.monthKey} className="sb-mini-bar-item">
                      <span
                        className="sb-mini-bar"
                        style={{ height: `${Math.max((point.spent / maxSpent) * 100, 2)}%` }}
                        title={tf('smartBudget.detail.barTitle', '{month}：{amount}')
                          .replace(
                            '{month}',
                            String(formatBudgetMonthShortLabel(point.monthKey, tf))
                          )
                          .replace('{amount}', String(formatCurrency(point.spent)))}
                      />
                      <span className="sb-mini-bar-label">
                        {formatBudgetMonthShortLabel(point.monthKey, tf)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="sb-drawer-note">
                  {tf('smartBudget.detail.avgPrefix', '近')} {detail.monthlyPoints.length}{' '}
                  {tf('smartBudget.detail.avgSuffix', '个月平均支出')}{' '}
                  {formatCurrency(detail.averageMonthlySpent)}
                </p>
              </section>

              <section className="sb-drawer-section">
                <h4>{tf('smartBudget.detail.recentTitle', '近期支出')}</h4>
                {detail.recentTransactions.length ? (
                  <ul className="sb-transaction-list">
                    {detail.recentTransactions.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.note || resolveBudgetCategoryLabel(row.category, tf)}</strong>
                          {/* 直接把 date 印出来会渲染成 2026-11-15T00:00:00.000Z,和别处一样走 formatDate。 */}
                          <span>{formatDate(item.date)}</span>
                        </div>
                        {/*
                         * 符号不能写死成「-」:退款/冲正在 budgetDetail 里已经是负数,
                         * 拼上去会渲染成「--¥40.00」。这里按正负给 + / −。
                         */}
                        <span className="sb-number">
                          {item.amount < 0 ? '+' : '-'}
                          {formatCurrency(Math.abs(item.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sb-drawer-note">
                    {tf('smartBudget.detail.emptyMonth', '这个月还没有该分类的支出记录。')}
                  </p>
                )}
              </section>
            </>
          ) : (
            <p className="sb-drawer-note">
              {tf('smartBudget.detail.empty', '暂时没有可展示的明细。')}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
