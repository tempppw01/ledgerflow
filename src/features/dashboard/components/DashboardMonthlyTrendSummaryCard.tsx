import { formatCurrency } from '../../../shared/lib/format';
import { toSafeNumber } from '../model/utils';

export interface DashboardMonthlyTrendSummaryCardProps {
  title: string;
  currentMonthLabel: string;
  monthlyInsightActionLabel: string;
  monthlyInsightStatus: 'idle' | 'loading' | 'streaming' | 'done' | 'error';
  monthlyInsightError: string;
  monthlyBalance: number;
  income: number;
  expense: number;
  transactionCount: number;
  monthOverMonthChange: number;
  monthOverMonthRate: number;
  monthOverMonthDirection: 'up' | 'down';
  monthOverMonthArrow: string;
  displayCategoryBreakdown: Array<{
    name: string;
    amount: number;
    percent: number;
  }>;
  onRefresh: () => void;
  refreshDisabled: boolean;
}

export function DashboardMonthlyTrendSummaryCard({
  title,
  currentMonthLabel,
  monthlyInsightActionLabel,
  monthlyInsightStatus,
  monthlyInsightError,
  monthlyBalance,
  income,
  expense,
  transactionCount,
  monthOverMonthChange,
  monthOverMonthRate,
  monthOverMonthDirection,
  monthOverMonthArrow,
  displayCategoryBreakdown,
  onRefresh,
  refreshDisabled
}: DashboardMonthlyTrendSummaryCardProps) {
  return (
    <section className="panel">
      <header className="dashboard-panel-header">
        <div>
          <p className="dashboard-panel-kicker">
            {title} · {currentMonthLabel}
          </p>
          <h3>{title}</h3>
        </div>
        <div className="dashboard-panel-actions">
          <button
            type="button"
            className="dashboard-forecast-refresh"
            onClick={onRefresh}
            disabled={refreshDisabled}
          >
            {monthlyInsightActionLabel}
          </button>
        </div>
      </header>

      <div className="dashboard-trend-summary">
        <div>
          <p className="dashboard-summary-title">本月收支概览</p>
          <p className="dashboard-summary-main">
            结余
            <span
              className={
                monthlyBalance >= 0
                  ? 'dashboard-summary-main-amount positive'
                  : 'dashboard-summary-main-amount negative'
              }
            >
              {formatCurrency(monthlyBalance)}
            </span>
          </p>
          <p
            className={`dashboard-summary-change ${
              monthOverMonthDirection === 'up' ? 'positive' : 'negative'
            }`}
          >
            <span>{monthOverMonthArrow}</span>
            <span>环比 {Math.abs(monthOverMonthRate).toFixed(1)}%</span>
            <span>
              ({monthOverMonthChange >= 0 ? '+' : ''}
              {formatCurrency(monthOverMonthChange)})
            </span>
          </p>
          <p className="dashboard-summary-sub">
            <span className="dashboard-summary-metric income">收入 {formatCurrency(income)}</span>
            <span className="dashboard-summary-metric expense">支出 {formatCurrency(expense)}</span>
            <span className="dashboard-summary-metric neutral">交易 {transactionCount} 笔</span>
          </p>
        </div>
        <div className="dashboard-summary-chip">AI 分析聚焦于本月分类结构与异常波动</div>
      </div>

      <div className="dashboard-ai-actions" style={{ marginBottom: 'var(--space-3)' }}>
        <p className="dashboard-ai-status-text">
          {monthlyInsightStatus === 'loading'
            ? '正在整理本月账目结构…'
            : monthlyInsightStatus === 'streaming'
              ? '正在生成重点结论，请稍候。'
              : monthlyInsightStatus === 'done'
                ? '分析完成，可以看分类和大额账单。'
                : '点击右上角“手动分析”开始生成。'}
        </p>
        {monthlyInsightError ? <p className="dashboard-ai-error">{monthlyInsightError}</p> : null}
      </div>

      <div className="dashboard-trend-sections">
        <section>
          <div className="dashboard-section-header">
            <h4>分类结构</h4>
            <span>按金额排序</span>
          </div>
          <div className="dashboard-breakdown-grid">
            {displayCategoryBreakdown.map((item, index) => {
              const percentValue = Math.min(100, Math.max(0, toSafeNumber(item.percent, 0)));
              const percentText = `${percentValue.toFixed(1)}%`;
              const emoji = item.amount >= 0 ? '📌' : '🔻';
              return (
                <article key={`${item.name}-${index}`} className="dashboard-breakdown-item">
                  <div>
                    <p className="dashboard-breakdown-name">
                      {emoji} {item.name}
                    </p>
                    <p className="dashboard-breakdown-meta">
                      {item.name} {formatCurrency(item.amount)}，占比 {percentText}
                    </p>
                  </div>
                  <div className="dashboard-breakdown-bar">
                    <span style={{ width: percentText }} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
