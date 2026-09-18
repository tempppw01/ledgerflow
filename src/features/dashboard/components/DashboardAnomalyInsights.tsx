export interface DashboardAnomalyInsightsProps {
  anomalyInsight: {
    anomalies: string[];
    highlights: string[];
    supportFacts: string[];
  };
  onNavigateToSmartBudget: () => void;
  onNavigateToTransactions: () => void;
}

export function DashboardAnomalyInsights({
  anomalyInsight,
  onNavigateToSmartBudget,
  onNavigateToTransactions
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
    </section>
  );
}
