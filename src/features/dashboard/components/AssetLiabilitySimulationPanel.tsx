import { formatCurrency, formatCurrencyAuto } from '../../../shared/lib/format';
import type { AssetLiabilitySimulationRow } from '../model/assetLiabilitySimulation';
import { formatCalendarAmount } from '../model/assetLiabilitySimulationFormat';

type Point = { x: number; y: number };

function smoothPath(points: Point[]) {
  if (points.length < 2) return '';
  return points.reduce((path, point, index, list) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = list[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, '');
}

export function AssetLiabilitySimulationPanel({
  rows,
  initialAssets,
  initialLiabilities,
  hasEvents
}: {
  rows: AssetLiabilitySimulationRow[];
  initialAssets: number;
  initialLiabilities: number;
  hasEvents: boolean;
}) {
  const width = 720;
  const height = 280;
  const padding = { top: 24, right: 18, bottom: 30, left: 48 };
  const values = rows.flatMap((row) => [row.assets, row.liabilities]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const point = (value: number, index: number): Point => ({
    x:
      padding.left +
      (index * (width - padding.left - padding.right)) / Math.max(rows.length - 1, 1),
    y: padding.top + ((max - value) / range) * (height - padding.top - padding.bottom)
  });
  const assetPoints = rows.map((row, index) => point(row.assets, index));
  const liabilityPoints = rows.map((row, index) => point(row.liabilities, index));
  const gridValues = [max, (max + min) / 2, min];

  return (
    <section className="panel dashboard-asset-liability-panel" aria-label="资产负债变动模拟">
      <div className="dashboard-section-header dashboard-section-header-tight">
        <div>
          <h4>资产负债变动模拟</h4>
          <p>按已登记的交易、还款和续费安排推演未来 30 天，不替你猜未记录的收入。</p>
        </div>
        <span className="dashboard-simulation-badge">{hasEvents ? '有安排' : '按现状持平'}</span>
      </div>

      <div className="dashboard-asset-liability-layout">
        <div className="dashboard-asset-liability-chart-wrap">
          <div className="dashboard-asset-liability-summary">
            <span>
              <i className="is-asset" />
              资产 <strong>{formatCurrencyAuto(initialAssets)}</strong>
            </span>
            <span>
              <i className="is-liability" />
              负债 <strong>{formatCurrencyAuto(initialLiabilities)}</strong>
            </span>
          </div>
          <svg
            className="dashboard-asset-liability-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="未来30天资产负债变动模拟折线图"
          >
            <title>未来30天资产负债变动模拟折线图</title>
            {gridValues.map((value, index) => {
              const y = padding.top + (index / 2) * (height - padding.top - padding.bottom);
              return (
                <g key={`${value}-${index}`}>
                  <line
                    className="dashboard-asset-liability-grid-line"
                    x1={padding.left}
                    x2={width - padding.right}
                    y1={y}
                    y2={y}
                  />
                  <text className="dashboard-asset-liability-axis-label" x="4" y={y + 4}>
                    {formatCurrencyAuto(value)}
                  </text>
                </g>
              );
            })}
            <path
              className="dashboard-asset-liability-area"
              d={`${smoothPath(assetPoints)} L ${assetPoints.at(-1)?.x || 0} ${
                height - padding.bottom
              } L ${assetPoints[0]?.x || 0} ${height - padding.bottom} Z`}
            />
            <path className="dashboard-asset-liability-asset-line" d={smoothPath(assetPoints)} />
            <path
              className="dashboard-asset-liability-liability-line"
              d={smoothPath(liabilityPoints)}
            />
            {rows.map((row, index) =>
              row.events.length ? (
                <circle
                  key={row.key}
                  className="dashboard-asset-liability-event-dot"
                  cx={assetPoints[index].x}
                  cy={assetPoints[index].y}
                  r="3.5"
                />
              ) : null
            )}
          </svg>
          <div className="dashboard-asset-liability-axis" aria-hidden="true">
            <span>{rows[0]?.label}</span>
            <span>{rows[Math.floor(rows.length / 2)]?.label}</span>
            <span>{rows.at(-1)?.label}</span>
          </div>
          <div className="dashboard-asset-liability-legend">
            <span><i className="is-asset" />资产</span>
            <span><i className="is-liability" />负债</span>
            <small>点线上的标记代表当天有已登记安排</small>
          </div>
        </div>

        <div className="dashboard-asset-liability-calendar" aria-label="未来30天金额日历">
          <div className="dashboard-calendar-head">
            <strong>未来 30 天</strong>
            <small>日期下方为当日预计结余</small>
          </div>
          <div className="dashboard-calendar-weekdays" aria-hidden="true">
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="dashboard-calendar-grid">
            {Array.from({ length: (new Date(`${rows[0]?.date}T00:00:00`).getDay() + 6) % 7 }).map(
              (_, index) => <span className="dashboard-calendar-empty" key={`empty-${index}`} />
            )}
            {rows.map((row) => (
              <div
                className={`dashboard-calendar-day ${
                  row.events.length ? 'has-event' : ''
                } ${row.delta > 0 ? 'is-positive' : row.delta < 0 ? 'is-negative' : ''}`.trim()}
                key={row.key}
                aria-label={`${row.label}，当日预计结余 ${formatCurrency(row.delta)}`}
                title={`${formatCurrency(row.delta)}${row.events.length ? ` · ${row.events.join('、')}` : ' · 当天没有已登记安排'}`}
              >
                <b>{row.date.slice(-2).replace(/^0/, '')}</b>
                <small>{formatCalendarAmount(row.delta)}</small>
              </div>
            ))}
          </div>
          <div className="dashboard-calendar-foot">
            <span>净资产：{formatCurrencyAuto(rows.at(-1)?.netWorth || 0)}</span>
            <span>负债：{formatCurrencyAuto(rows.at(-1)?.liabilities || 0)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
