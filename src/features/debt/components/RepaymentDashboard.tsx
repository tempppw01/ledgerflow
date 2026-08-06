import { useEffect, useMemo, useRef, useState } from 'react';
import type { DebtItem, RepaymentRecord } from '../model/debtMetrics';
import { getRepaymentBreakdownColor, getRepaymentOverview } from '../model/repaymentOverview';
import { formatCurrency, formatCurrencyAuto } from '../../../shared/lib/format';

interface RepaymentDashboardProps {
  debts: DebtItem[];
  repaymentRecords: RepaymentRecord[];
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

function ProjectionBars({ data }: { data: Array<{ monthLabel: string; total: number }> }) {
  const [mounted, setMounted] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.total));

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="repayment-bars">
      {data.map((item, index) => {
        const heightPct = max > 0 ? (item.total / max) * 100 : 0;
        return (
          <div className="repayment-bar-col" key={item.monthLabel}>
            <div className="repayment-bar-track">
              <div
                className="repayment-bar-fill"
                style={{
                  height: mounted ? `${heightPct}%` : '0%',
                  transitionDelay: `${index * 80}ms`,
                  background:
                    'linear-gradient(180deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 55%, var(--color-info)))'
                }}
              />
              <span className="repayment-bar-value">{formatCurrencyAuto(item.total)}</span>
            </div>
            <span className="repayment-bar-label">{item.monthLabel}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RepaymentDashboard({ debts, repaymentRecords }: RepaymentDashboardProps) {
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
                <li key={item.id} className={`repayment-timeline-item is-${item.tone}`}>
                  <span className="repayment-timeline-dot" />
                  <div className="repayment-timeline-info">
                    <span className="repayment-timeline-name">{item.name}</span>
                    <span className="repayment-timeline-type">
                      {DEBT_TYPE_LABELS[item.type] ?? item.type}
                    </span>
                    <span className="repayment-timeline-amount">
                      {formatCurrency(item.payment)}
                    </span>
                  </div>
                  <span className={`repayment-timeline-due is-${item.tone}`}>
                    {item.dueInDays === null
                      ? '未设还款日'
                      : item.dueInDays === 0
                        ? '今日应还'
                        : `${item.dueInDays} 天后`}
                  </span>
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
          <ProjectionBars data={overview.monthlyProjection} />
        </div>
      </div>
    </section>
  );
}
