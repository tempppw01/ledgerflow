import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { DebtItem, RepaymentRecord } from '../model/debtMetrics';
import { getRepaymentBreakdownColor, getRepaymentOverview } from '../model/repaymentOverview';
import { formatCurrency, formatCurrencyAuto } from '../../../shared/lib/format';

interface RepaymentDashboardProps {
  debts: DebtItem[];
  repaymentRecords: RepaymentRecord[];
  onMarkCurrentPayment?: (debtId: string, amount: number) => void;
  onSetRepaymentDay?: (debtId: string, day: number) => void;
}

const DEBT_TYPE_LABELS: Record<DebtItem['type'], string> = {
  'credit-card': '信用卡',
  'consumer-loan': '消费贷',
  loan: '贷款'
};

function useMountedProgress(target: number, durationMs = 700) {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = null;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }

    const step = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target * 100) / 100);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return value;
}

function ProgressRing({
  progress,
  size = 132,
  stroke = 10,
  totalLabel,
  paidLabel
}: {
  progress: number;
  size?: number;
  stroke?: number;
  totalLabel: string;
  paidLabel: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const animated = useMountedProgress(progress, 800);
  const dash = circumference * animated;

  return (
    <div className="repayment-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-bg-subtle)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="repayment-ring-progress"
        />
      </svg>
      <div className="repayment-ring-center">
        <span className="repayment-ring-progress-text">{Math.round(animated * 100)}%</span>
        <span className="repayment-ring-label">{totalLabel}</span>
        <span className="repayment-ring-sub">{paidLabel}</span>
      </div>
    </div>
  );
}

function BreakdownDonut({
  segments
}: {
  segments: Array<{ id: string; name: string; payment: number; color: string }>;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const total = segments.reduce((sum, s) => sum + s.payment, 0);
  const size = 180;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  let cursor = 0;
  const arcs = segments.map((seg, index) => {
    const fraction = total > 0 ? seg.payment / total : 0;
    const dash = fraction * circumference;
    const offset = -cursor * circumference;
    cursor += fraction;
    return { ...seg, dash, offset, index };
  });

  if (segments.length === 0) {
    return (
      <div className="repayment-donut-empty">
        <span>暂无活跃负债</span>
      </div>
    );
  }

  return (
    <div className="repayment-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-bg-subtle)"
            strokeWidth={stroke}
          />
          {arcs.map((arc) => (
            <circle
              key={arc.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={hoverIndex === arc.index ? stroke + 4 : stroke}
              strokeDasharray={`${mounted ? arc.dash : 0} ${circumference}`}
              strokeDashoffset={arc.offset}
              className="repayment-donut-arc"
              style={{ transition: 'stroke-dasharray 700ms ease, stroke-width 150ms ease' }}
              onMouseEnter={() => setHoverIndex(arc.index)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          ))}
        </g>
      </svg>
      <div className="repayment-donut-center">
        <span className="repayment-donut-total">{formatCurrencyAuto(total)}</span>
        <span className="repayment-donut-label">月供合计</span>
      </div>
      <ul className="repayment-donut-legend">
        {segments.map((seg, index) => (
          <li
            key={seg.id}
            className={hoverIndex === index ? 'is-active' : ''}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <span className="repayment-donut-dot" style={{ background: seg.color }} />
            <span className="repayment-donut-name">{seg.name}</span>
            <span className="repayment-donut-value">{formatCurrency(seg.payment)}</span>
            <span className="repayment-donut-pct">
              {total > 0 ? Math.round((seg.payment / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectionLineChart({ data }: { data: Array<{ monthLabel: string; total: number }> }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 620;
  const height = 190;
  const padding = { top: 28, right: 20, bottom: 24, left: 18 };
  const totals = data.map((item) => Math.max(0, item.total));
  const rawMin = Math.min(...totals);
  const rawMax = Math.max(...totals, 1);
  const isFlat = rawMax - rawMin < Math.max(1, rawMax * 0.01);
  const min = isFlat ? Math.max(0, rawMax * 0.9) : rawMin;
  const max = isFlat ? rawMax * 1.1 : rawMax * 1.08;
  const spread = Math.max(1, max - min);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const points = data.map((item, index) => ({
    ...item,
    x: padding.left + (index / Math.max(1, data.length - 1)) * plotWidth,
    y: padding.top + (1 - (Math.max(0, item.total) - min) / spread) * plotHeight
  }));
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`
    : '';
  const activePoint = hoveredIndex === null ? null : points[hoveredIndex];
  const peakIndex = totals.indexOf(rawMax);
  // 窄列中同时标注首尾和峰值容易重叠；默认只突出峰值，其余月份在悬停时显示。
  const labelIndices = new Set([peakIndex]);

  function handlePointerMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || points.length === 0) return;
    const chartX = ((event.clientX - rect.left) / rect.width) * width;
    const closestIndex = points.reduce(
      (best, point, index) =>
        Math.abs(point.x - chartX) < Math.abs(points[best].x - chartX) ? index : best,
      0
    );
    setHoveredIndex(closestIndex);
  }

  return (
    <div className="repayment-projection" onMouseLeave={() => setHoveredIndex(null)}>
      <div className="repayment-projection-stage">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="未来六个月预计还款折线图"
          onMouseMove={handlePointerMove}
        >
          <defs>
            <linearGradient id="repayment-projection-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((ratio) => (
            <line
              key={ratio}
              className="repayment-projection-grid"
              x1={padding.left}
              x2={width - padding.right}
              y1={padding.top + plotHeight * ratio}
              y2={padding.top + plotHeight * ratio}
            />
          ))}
          {points.map((point) => (
            <line
              key={`vertical-${point.monthLabel}`}
              className="repayment-projection-grid is-vertical"
              x1={point.x}
              x2={point.x}
              y1={padding.top}
              y2={height - padding.bottom}
            />
          ))}
          <path className="repayment-projection-area" d={areaPath} />
          <path className="repayment-projection-line" d={linePath} pathLength="1" />
          {points.map((point, index) => (
            <g key={point.monthLabel}>
              <circle
                className={`repayment-projection-point${hoveredIndex === index ? ' is-active' : ''}`}
                cx={point.x}
                cy={point.y}
                r={hoveredIndex === index ? 5 : 3.5}
              />
              {labelIndices.has(index) || hoveredIndex === index ? (
                <text
                  className={`repayment-projection-value${hoveredIndex === index ? ' is-active' : ''}`}
                  x={point.x}
                  y={Math.max(24, point.y - 16)}
                >
                  {formatCurrencyAuto(point.total)}
                </text>
              ) : null}
            </g>
          ))}
          {activePoint ? (
            <line
              className="repayment-projection-cursor"
              x1={activePoint.x}
              x2={activePoint.x}
              y1={padding.top}
              y2={height - padding.bottom}
            />
          ) : null}
        </svg>
        {activePoint ? (
          <div
            className="repayment-projection-tooltip"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${Math.max(8, (activePoint.y / height) * 100)}%`
            }}
          >
            <span>{activePoint.monthLabel}</span>
            <strong>{formatCurrency(activePoint.total)}</strong>
          </div>
        ) : null}
      </div>
      <div className="repayment-projection-axis" aria-hidden="true">
        {data.map((item) => (
          <span key={item.monthLabel}>{item.monthLabel}</span>
        ))}
      </div>
    </div>
  );
}

export function RepaymentDashboard({
  debts,
  repaymentRecords,
  onMarkCurrentPayment,
  onSetRepaymentDay
}: RepaymentDashboardProps) {
  const [editingRepaymentDayId, setEditingRepaymentDayId] = useState<string | null>(null);
  const [repaymentDayDraft, setRepaymentDayDraft] = useState('');
  const overview = useMemo(
    () => getRepaymentOverview({ debts, repaymentRecords }),
    [debts, repaymentRecords]
  );

  const donutSegments = overview.breakdown.map((item, index) => ({
    id: item.id,
    name: item.name,
    payment: item.payment,
    color: getRepaymentBreakdownColor(index)
  }));

  const ringKey = `${overview.thisMonthTotal}|${overview.thisMonthPaid}|${overview.progress}`;

  if (overview.thisMonthTotal <= 0 && overview.breakdown.length === 0) {
    return null;
  }

  return (
    <section className="card repayment-dashboard" aria-label="本月还款概览">
      <h2 className="repayment-dashboard-title">
        <span aria-hidden="true">📅</span> 本月还款概览
      </h2>

      <div className="repayment-dashboard-grid">
        <div className="repayment-dashboard-hero">
          <div className="repayment-dashboard-total">
            <span className="repayment-dashboard-total-label">本月应还总额</span>
            <span className="repayment-dashboard-total-value">
              {formatCurrency(overview.thisMonthTotal)}
            </span>
            <div className="repayment-dashboard-total-meta">
              <span>已还 {formatCurrency(overview.thisMonthPaid)}</span>
              <span className="repayment-dashboard-sep">·</span>
              <span>待还 {formatCurrency(overview.thisMonthRemaining)}</span>
            </div>
            {overview.nextDueDate ? (
              <span className="repayment-dashboard-next-due">
                下一笔：{overview.nextDueDate}
                {overview.nextDueDays !== null
                  ? overview.nextDueDays === 0
                    ? '（今日到期）'
                    : `（${overview.nextDueDays} 天后）`
                  : ''}
              </span>
            ) : null}
          </div>
          <ProgressRing
            key={ringKey}
            progress={overview.progress}
            totalLabel="本月进度"
            paidLabel={`已还 ${formatCurrency(overview.thisMonthPaid)}`}
          />
        </div>

        <div className="repayment-dashboard-timeline">
          <h3 className="repayment-dashboard-section-title">未来还款</h3>
          {overview.breakdown.length === 0 ? (
            <p className="muted">暂无活跃负债需要还款。</p>
          ) : (
            <ul className="repayment-timeline">
              {overview.breakdown.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <div className="repayment-timeline-item-wrap">
                    <button
                      type="button"
                      className={`repayment-timeline-item is-${item.tone}${item.isPaid ? ' is-paid' : ''}`}
                      onClick={() => {
                        if (item.dueInDays === null && onSetRepaymentDay) {
                          setEditingRepaymentDayId(item.id);
                          setRepaymentDayDraft('');
                          return;
                        }
                        onMarkCurrentPayment?.(item.id, Math.max(0, item.payment - item.paidAmount));
                      }}
                      disabled={item.isPaid ? item.dueInDays !== null : !onMarkCurrentPayment && !onSetRepaymentDay}
                      aria-label={item.dueInDays === null ? `设置${item.name}还款日` : item.isPaid ? `${item.name}本期已还` : `标记${item.name}本期已还`}
                    >
                      <span className="repayment-timeline-dot" />
                      <span className="repayment-timeline-info">
                        <span className="repayment-timeline-name">{item.name}</span>
                        <span className="repayment-timeline-type">
                          {DEBT_TYPE_LABELS[item.type] ?? item.type}
                        </span>
                        <span className="repayment-timeline-amount">
                          {formatCurrency(item.payment)}
                        </span>
                      </span>
                      <span className="repayment-timeline-status">
                        <span className={`repayment-timeline-due is-${item.tone}`}>
                          {item.dueInDays === null
                            ? '未设还款日'
                            : item.dueInDays === 0
                              ? '今日应还'
                              : `${item.dueInDays} 天后`}
                        </span>
                        <strong>{item.dueInDays === null ? '设置还款日' : item.isPaid ? '✓ 已还' : '点按记账'}</strong>
                      </span>
                    </button>
                    {editingRepaymentDayId === item.id ? (
                      <form
                        className="repayment-timeline-day-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const day = Number(repaymentDayDraft);
                          if (Number.isInteger(day) && day >= 1 && day <= 31) {
                            onSetRepaymentDay?.(item.id, day);
                            setEditingRepaymentDayId(null);
                          }
                        }}
                      >
                        <label>
                          还款日
                          <input
                            autoFocus
                            type="number"
                            min="1"
                            max="31"
                            value={repaymentDayDraft}
                            onChange={(event) => setRepaymentDayDraft(event.target.value)}
                            placeholder="1-31"
                            aria-label={`${item.name}还款日`}
                          />
                          日
                        </label>
                        <button type="submit" className="primary">保存</button>
                        <button type="button" onClick={() => setEditingRepaymentDayId(null)}>取消</button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="repayment-dashboard-chart">
          <h3 className="repayment-dashboard-section-title">月供占比</h3>
          <BreakdownDonut segments={donutSegments} />
        </div>

        <div className="repayment-dashboard-chart">
          <h3 className="repayment-dashboard-section-title">未来 6 个月预计还款</h3>
          <ProjectionLineChart data={overview.monthlyProjection} />
        </div>
      </div>
    </section>
  );
}
