import { useState, type CSSProperties } from 'react';
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
  horizonMonths,
  onHorizonChange
}: {
  rows: AssetLiabilitySimulationRow[];
  initialAssets: number;
  initialLiabilities: number;
  horizonMonths: 1 | 3 | 6 | 12;
  onHorizonChange: (months: 1 | 3 | 6 | 12) => void;
}) {
  const [calendarMode, setCalendarMode] = useState<'balance' | 'assets'>('balance');
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
  const maxDelta = Math.max(...rows.flatMap((row) => [Math.abs(row.delta), Math.abs(row.netWorth)]), 1);
  const monthlyRows = rows.filter((row, index) => {
    const next = rows[index + 1];
    return !next || next.date.slice(0, 7) !== row.date.slice(0, 7);
  });
  const calendarRows = horizonMonths === 1 ? rows : monthlyRows;
  const lowestBalance = rows.reduce((lowest, row) => (row.netWorth < lowest.netWorth ? row : lowest), rows[0]);
  const monthlyDebtChanges = rows.reduce<Record<string, { amount: number; label: string }>>((acc, row) => {
    const key = row.date.slice(0, 7);
    acc[key] ||= { amount: 0, label: `${Number(key.slice(5))}月` };
    acc[key].amount += row.liabilityDelta;
    return acc;
  }, {});
  const fastestDebtDrop = Object.values(monthlyDebtChanges).reduce<{ amount: number; label: string } | null>(
    (best, current) => (current.amount < 0 && (!best || current.amount < best.amount) ? current : best),
    null
  );

  return (
    <section className="panel dashboard-asset-liability-panel" aria-label="资产负债变动模拟">
      <div className="dashboard-section-header dashboard-section-header-tight">
        <div>
          <h4>资产负债预测</h4>
          <p>按已登记安排推演未来 {horizonMonths} 个月，帮助你提前看到现金压力。</p>
        </div>
        <div className="dashboard-simulation-actions">
          <div className="dashboard-simulation-pills" role="tablist" aria-label="模拟时间范围">
            {[1, 3, 6, 12].map((months) => (
              <button
                key={months}
                type="button"
                role="tab"
                aria-selected={horizonMonths === months}
                className={horizonMonths === months ? 'is-active' : ''}
                onClick={() => onHorizonChange(months as 1 | 3 | 6 | 12)}
              >
                {months}个月
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="dashboard-simulation-insights" aria-label="预测关键节点">
        <div><span>预计余额最低日</span><strong>{lowestBalance?.label || '暂无数据'}</strong><small>{lowestBalance ? formatCurrencyAuto(lowestBalance.netWorth) : '先登记账户或安排'}</small></div>
        <div><span>负债下降最快月份</span><strong>{fastestDebtDrop?.label || '暂无还款'}</strong><small>{fastestDebtDrop ? `减少 ${formatCurrencyAuto(Math.abs(fastestDebtDrop.amount))}` : '补充负债还款计划后显示'}</small></div>
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
            aria-label={`未来${horizonMonths}个月资产负债变动模拟折线图`}
          >
            <title>未来{horizonMonths}个月资产负债变动模拟折线图</title>
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
          </svg>
          <div className="dashboard-asset-liability-axis" aria-hidden="true">
            <span>{rows[0]?.label}</span>
            <span>{rows[Math.floor(rows.length / 2)]?.label}</span>
            <span>{rows.at(-1)?.label}</span>
          </div>
          <div className="dashboard-asset-liability-legend">
            <span><i className="is-asset" />资产</span>
            <span><i className="is-liability" />负债</span>
          </div>
        </div>

        <div className="dashboard-asset-liability-calendar" aria-label={`未来${horizonMonths}个月金额日历`}>
          <div className="dashboard-calendar-head">
            <strong>{horizonMonths === 1 ? '未来 1 个月' : `未来 ${horizonMonths} 个月概览`}</strong>
            <div className="dashboard-calendar-modes" role="tablist" aria-label="日历显示方式">
              <button type="button" className={calendarMode === 'balance' ? 'is-active' : ''} onClick={() => setCalendarMode('balance')}>结余</button>
              <button type="button" className={calendarMode === 'assets' ? 'is-active' : ''} onClick={() => setCalendarMode('assets')}>资产负债</button>
            </div>
          </div>
          {horizonMonths === 1 ? <div className="dashboard-calendar-weekdays" aria-hidden="true">
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div> : null}
          <div className={`dashboard-calendar-grid ${horizonMonths === 1 ? '' : 'is-monthly'}`}>
            {horizonMonths === 1 ? Array.from({ length: (new Date(`${rows[0]?.date}T00:00:00`).getDay() + 6) % 7 }).map(
              (_, index) => <span className="dashboard-calendar-empty" key={`empty-${index}`} />
            ) : null}
            {calendarRows.map((row, index) => {
              const previous = calendarRows[index - 1];
              const isMonthStart = Boolean(previous && previous.date.slice(0, 7) !== row.date.slice(0, 7));
              const amount = calendarMode === 'assets' ? row.netWorth : row.delta;
              const intensity = 0.14 + (Math.abs(amount) / maxDelta) * 0.34;
              const style = { '--calendar-intensity': intensity } as CSSProperties;
              return (
              <div
                className={`dashboard-calendar-day ${
                  amount > 0 ? 'is-positive' : amount < 0 ? 'is-negative' : 'is-neutral'
                } ${isMonthStart ? 'is-month-start' : ''}`.trim()}
                key={row.key}
                style={style}
                aria-label={`${row.label}，${calendarMode === 'assets' ? '净资产' : '预计结余'} ${formatCurrency(amount)}`}
                title={formatCurrency(amount)}
              >
                {(isMonthStart || horizonMonths > 1) ? <em>{new Date(`${row.date}T00:00:00`).getMonth() + 1}月</em> : null}
                <b>{row.date.slice(-2).replace(/^0/, '')}</b>
                <small>{calendarMode === 'assets' ? formatCalendarAmount(row.netWorth) : formatCalendarAmount(row.delta)}</small>
              </div>
              );
            })}
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
