import { formatCurrency } from '../../../shared/lib/format';
import { BudgetTrackingRow } from '../model/budgetInsights';
import { BudgetCategoryDetail } from '../model/budgetDetail';
import { formatBudgetMonthShortLabel } from '../model/budgetPacing';
import { BudgetCloseIcon, BudgetTrendIcon } from './budgetIcons';

export type BudgetDetailDrawerProps = {
  row: BudgetTrackingRow;
  detail: BudgetCategoryDetail | null;
  onClose: () => void;
};

export function BudgetDetailDrawer({ row, detail, onClose }: BudgetDetailDrawerProps) {
  const maxSpent = Math.max(...(detail?.monthlyPoints.map((point) => point.spent) || [1]), 1);

  return (
    <aside className="sb-drawer" aria-label={`${row.category}预算详情`}>
      <div className="sb-drawer-panel">
        <header className="sb-drawer-head">
          <div>
            <span className="sb-drawer-kicker">分类详情</span>
            <h3>{row.category}</h3>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="关闭详情">
            <BudgetCloseIcon className="sb-icon-sm" />
          </button>
        </header>

        <div className="sb-drawer-body">
          <div className="sb-drawer-stats">
            <div>
              <span>已花费</span>
              <strong className="sb-number">{formatCurrency(row.spentAmount)}</strong>
            </div>
            <div>
              <span>预算</span>
              <strong className="sb-number">{formatCurrency(row.budgetAmount)}</strong>
            </div>
            <div>
              <span>差额</span>
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
          <p className="sb-drawer-rate">执行率 {(row.ratio * 100).toFixed(1)}%</p>

          {detail ? (
            <>
              <section className="sb-drawer-section">
                <h4>
                  <BudgetTrendIcon className="sb-icon-sm" />
                  最近 {detail.monthlyPoints.length} 个月
                </h4>
                <div className="sb-mini-bars">
                  {detail.monthlyPoints.map((point) => (
                    <div key={point.monthKey} className="sb-mini-bar-item">
                      <span
                        className="sb-mini-bar"
                        style={{ height: `${Math.max((point.spent / maxSpent) * 100, 2)}%` }}
                        title={`${formatBudgetMonthShortLabel(point.monthKey)}：${formatCurrency(point.spent)}`}
                      />
                      <span className="sb-mini-bar-label">
                        {formatBudgetMonthShortLabel(point.monthKey)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="sb-drawer-note">
                  近 {detail.monthlyPoints.length} 个月平均支出{' '}
                  {formatCurrency(detail.averageMonthlySpent)}
                </p>
              </section>

              <section className="sb-drawer-section">
                <h4>近期支出</h4>
                {detail.recentTransactions.length ? (
                  <ul className="sb-transaction-list">
                    {detail.recentTransactions.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.note || row.category}</strong>
                          <span>{item.date}</span>
                        </div>
                        <span className="sb-number">-{formatCurrency(item.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sb-drawer-note">这个月还没有该分类的支出记录。</p>
                )}
              </section>
            </>
          ) : (
            <p className="sb-drawer-note">暂时没有可展示的明细。</p>
          )}
        </div>
      </div>
    </aside>
  );
}
