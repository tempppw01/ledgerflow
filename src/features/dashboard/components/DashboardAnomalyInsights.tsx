import { formatMoneyByCurrency } from '../../../shared/lib/format';

export interface DashboardAnomalyInsightsProps {
  anomalyInsight: {
    anomalies: string[];
    highlights: string[];
    supportFacts: string[];
  };
  subscriptionAlerts: Array<{
    id: string;
    name: string;
    amount: number;
    currency: string;
    renewalDate?: string;
    expireDate?: string;
    status: string;
  }>;
  onNavigateToSmartBudget: () => void;
  onNavigateToTransactions: () => void;
  onNavigateToSubscriptions: () => void;
}

export function DashboardAnomalyInsights({
  anomalyInsight,
  subscriptionAlerts,
  onNavigateToSmartBudget,
  onNavigateToTransactions,
  onNavigateToSubscriptions
}: DashboardAnomalyInsightsProps) {
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div className="dashboard-section-header">
        <h4>今日财务雷达</h4>
        <span>只捞最值得看的点</span>
      </div>

      {anomalyInsight.supportFacts.length > 0 ? (
        <div className="dashboard-anomaly-facts" aria-label="今日财务雷达依据">
          {anomalyInsight.supportFacts.map((fact) => (
            <span key={fact} className="metric-chip">
              {fact}
            </span>
          ))}
        </div>
      ) : null}

      <div className="dashboard-anomaly-summary-grid">
        <article className="dashboard-anomaly-summary-card">
          <p className="dashboard-anomaly-card-title">🚦需要留意</p>
          <ul className="dashboard-anomaly-list">
            {anomalyInsight.anomalies.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </article>
        <article className="dashboard-anomaly-summary-card">
          <p className="dashboard-anomaly-card-title">✨做得不错</p>
          <ul className="dashboard-anomaly-list">
            {anomalyInsight.highlights.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </article>
      </div>

      <div className="dashboard-anomaly-toolbar">
        <button type="button" onClick={onNavigateToTransactions}>
          看账单明细
        </button>
        <button type="button" onClick={onNavigateToSmartBudget}>
          调一下预算
        </button>
      </div>

      {subscriptionAlerts.length > 0 ? (
        <div className="dashboard-subscription-alerts">
          <div className="dashboard-section-header">
            <h4>订阅快到期</h4>
            <span>{subscriptionAlerts.length} 个待处理</span>
          </div>
          <div className="dashboard-anomaly-summary-grid" role="list" aria-label="订阅到期提醒">
            {subscriptionAlerts.map((item) => (
              <article key={item.id} role="listitem" className="dashboard-anomaly-summary-card">
                <p className="dashboard-anomaly-card-title">🧾 别忘了这笔</p>
                <p className="dashboard-anomaly-card-text">
                  {item.name} ·{' '}
                  {item.expireDate || item.renewalDate
                    ? `到期/续费：${item.expireDate || item.renewalDate}`
                    : '未设置日期'}
                </p>
                <p className="dashboard-anomaly-card-text">
                  {item.status === 'expired' ? '已过期' : '快到了'} ·{' '}
                  {formatMoneyByCurrency(item.amount, item.currency)}
                </p>
                <div className="dashboard-anomaly-card-actions">
                  <button type="button" onClick={onNavigateToSubscriptions}>
                    去处理一下
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
