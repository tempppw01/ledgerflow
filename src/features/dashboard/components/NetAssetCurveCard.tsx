import { formatCurrency } from '../../../shared/lib/format';

export interface NetAssetCurveRow {
  key: string;
  label: string;
  value: number;
  delta: number;
  dateFrom: string;
  dateTo: string;
  isCurrent?: boolean;
  isEstimated?: boolean;
}

export interface NetAssetCurveCardProps {
  rows: NetAssetCurveRow[];
  worstDropKey?: string;
  worstDropDelta?: number;
  onNavigateToMonth: (dateFrom: string, dateTo: string) => void;
}

function formatDeltaLabel(delta: number) {
  if (Math.abs(delta) < 0.005) {
    return '较上月持平';
  }
  return `较上月${delta > 0 ? '+' : ''}${formatCurrency(delta)}`;
}

export function NetAssetCurveCard({
  rows,
  worstDropKey,
  worstDropDelta,
  onNavigateToMonth
}: NetAssetCurveCardProps) {
  const maxValue = Math.max(...rows.map((item) => item.value), 1);

  return (
    <article className="panel dashboard-unified-card" style={{ margin: 0 }}>
      <div className="dashboard-section-header dashboard-section-header-tight">
        <div>
          <h4>净资产趋势</h4>
          <p className="muted">账户余额 + 投资市值 − 负债余额</p>
        </div>
      </div>
      <div className="dashboard-net-curve">
        {rows.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`dashboard-net-row ${worstDropKey === item.key ? 'is-worst-drop' : ''} ${
              item.isCurrent ? 'is-current' : ''
            }`.trim()}
            onClick={() => onNavigateToMonth(item.dateFrom, item.dateTo)}
          >
            <span className="dashboard-net-row-label">
              {item.label}
              {item.isCurrent ? <em>当前</em> : null}
            </span>
            <i style={{ width: `${(item.value / maxValue) * 100}%` }} />
            <strong>{formatCurrency(item.value)}</strong>
            <small className={item.delta >= 0 ? 'up' : 'down'}>
              {formatDeltaLabel(item.delta)}{item.isEstimated ? ' · 估算' : ''}
            </small>
          </button>
        ))}
      </div>
      {worstDropKey && typeof worstDropDelta === 'number' ? (
        <p className="dashboard-net-worst-hint">
          回撤最多：{formatCurrency(worstDropDelta)}，点月份可以翻当月流水。
        </p>
      ) : null}
    </article>
  );
}
