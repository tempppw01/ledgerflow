import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatCurrencyAuto } from '../../../shared/lib/format';
import {
  formatDayMonth,
  formatMonth,
  formatMonthKey,
  formatWeekdayNarrow
} from '../../../shared/lib/i18nDate';
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
  const { t, i18n } = useTranslation();
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
  const maxDelta = Math.max(
    ...rows.flatMap((row) => [Math.abs(row.delta), Math.abs(row.netWorth)]),
    1
  );
  const monthlyRows = rows.filter((row, index) => {
    const next = rows[index + 1];
    return !next || next.date.slice(0, 7) !== row.date.slice(0, 7);
  });
  const calendarRows = horizonMonths === 1 ? rows : monthlyRows;
  const lowestBalance = rows.reduce(
    (lowest, row) => (row.netWorth < lowest.netWorth ? row : lowest),
    rows[0]
  );
  const monthlyDebtChanges = rows.reduce<Record<string, { amount: number }>>((acc, row) => {
    const key = row.date.slice(0, 7);
    acc[key] ||= { amount: 0 };
    acc[key].amount += row.liabilityDelta;
    return acc;
  }, {});
  const fastestDebtDrop = Object.entries(monthlyDebtChanges).reduce<{
    amount: number;
    key: string;
  } | null>(
    (best, [key, current]) =>
      current.amount < 0 && (!best || current.amount < best.amount)
        ? { ...current, key }
        : best,
    null
  );
  const locale = i18n.resolvedLanguage;
  const weekdayHeaders = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        formatWeekdayNarrow(new Date(2024, 0, 1 + index), locale)
      ),
    [locale]
  );

  return (
    <section
      className="panel dashboard-asset-liability-panel"
      aria-label={t('dashboard.ui.simulation.aria')}
    >
      <div className="dashboard-section-header dashboard-section-header-tight">
        <div>
          <h4>{t('dashboard.ui.simulation.title')}</h4>
          <p>{t('dashboard.ui.simulation.subtitle', { count: horizonMonths })}</p>
        </div>
        <div className="dashboard-simulation-actions">
          <div
            className="dashboard-simulation-pills"
            role="tablist"
            aria-label={t('dashboard.ui.simulation.rangeAria')}
          >
            {[1, 3, 6, 12].map((months) => (
              <button
                key={months}
                type="button"
                role="tab"
                aria-selected={horizonMonths === months}
                className={horizonMonths === months ? 'is-active' : ''}
                onClick={() => onHorizonChange(months as 1 | 3 | 6 | 12)}
              >
                {t('dashboard.ui.simulation.horizonMonths', { count: months })}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="dashboard-simulation-insights">
        <div>
          <span>{t('dashboard.ui.simulation.lowestBalanceDate')}</span>
          <strong>
            {lowestBalance
              ? formatDayMonth(lowestBalance.date, locale)
              : t('dashboard.ui.simulation.noData')}
          </strong>
          <small>
            {lowestBalance
              ? formatCurrencyAuto(lowestBalance.netWorth)
              : t('dashboard.ui.simulation.registerAccounts')}
          </small>
        </div>
        <div>
          <span>{t('dashboard.ui.simulation.fastestDebtDrop')}</span>
          <strong>
            {fastestDebtDrop
              ? formatMonthKey(fastestDebtDrop.key, locale)
              : t('dashboard.ui.simulation.noRepayment')}
          </strong>
          <small>
            {fastestDebtDrop
              ? t('dashboard.ui.simulation.debtReduced', {
                  amount: formatCurrencyAuto(Math.abs(fastestDebtDrop.amount))
                })
              : t('dashboard.ui.simulation.addPlan')}
          </small>
        </div>
      </div>

      <div className="dashboard-asset-liability-layout">
        <div className="dashboard-asset-liability-chart-wrap">
          <div className="dashboard-asset-liability-summary">
            <span>
              <i className="is-asset" />
              {t('dashboard.ui.simulation.assets')}{' '}
              <strong>{formatCurrencyAuto(initialAssets)}</strong>
            </span>
            <span>
              <i className="is-liability" />
              {t('dashboard.ui.simulation.liabilities')}{' '}
              <strong>{formatCurrencyAuto(initialLiabilities)}</strong>
            </span>
          </div>
          <svg
            className="dashboard-asset-liability-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t('dashboard.ui.simulation.chartAria', { count: horizonMonths })}
          >
            <title>{t('dashboard.ui.simulation.chartTitle', { count: horizonMonths })}</title>
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
            <span>{formatDayMonth(rows[0]?.date || new Date(), locale)}</span>
            <span>
              {formatDayMonth(rows[Math.floor(rows.length / 2)]?.date || new Date(), locale)}
            </span>
            <span>{formatDayMonth(rows.at(-1)?.date || new Date(), locale)}</span>
          </div>
          <div className="dashboard-asset-liability-legend">
            <span>
              <i className="is-asset" />
              {t('dashboard.ui.simulation.assets')}
            </span>
            <span>
              <i className="is-liability" />
              {t('dashboard.ui.simulation.liabilities')}
            </span>
          </div>
        </div>

        <div
          className="dashboard-asset-liability-calendar"
          aria-label={t('dashboard.ui.simulation.calendarAria', { count: horizonMonths })}
        >
          <div className="dashboard-calendar-head">
            <strong>
              {horizonMonths === 1
                ? t('dashboard.ui.simulation.oneMonth')
                : t('dashboard.ui.simulation.monthsOverview', { count: horizonMonths })}
            </strong>
            <div
              className="dashboard-calendar-modes"
              role="tablist"
              aria-label={t('dashboard.ui.simulation.calendarModeAria')}
            >
              <button
                type="button"
                className={calendarMode === 'balance' ? 'is-active' : ''}
                onClick={() => setCalendarMode('balance')}
              >
                {t('dashboard.ui.simulation.balance')}
              </button>
              <button
                type="button"
                className={calendarMode === 'assets' ? 'is-active' : ''}
                onClick={() => setCalendarMode('assets')}
              >
                {t('dashboard.ui.simulation.assetsAndLiabilities')}
              </button>
            </div>
          </div>
          {horizonMonths === 1 ? (
            <div className="dashboard-calendar-weekdays" aria-hidden="true">
              {weekdayHeaders.map((day, index) => (
                <span key={`${day}-${index}`}>{day}</span>
              ))}
            </div>
          ) : null}
          <div className={`dashboard-calendar-grid ${horizonMonths === 1 ? '' : 'is-monthly'}`}>
            {horizonMonths === 1
              ? Array.from({
                  length: (new Date(`${rows[0]?.date}T00:00:00`).getDay() + 6) % 7
                }).map((_, index) => (
                  <span className="dashboard-calendar-empty" key={`empty-${index}`} />
                ))
              : null}
            {calendarRows.map((row, index) => {
              const previous = calendarRows[index - 1];
              const isMonthStart = Boolean(
                previous && previous.date.slice(0, 7) !== row.date.slice(0, 7)
              );
              const amount = calendarMode === 'assets' ? row.netWorth : row.delta;
              const intensity = 0.14 + (Math.abs(amount) / maxDelta) * 0.34;
              const style = { '--calendar-intensity': intensity } as CSSProperties;
              const amountLabel =
                calendarMode === 'assets'
                  ? t('dashboard.ui.simulation.netWorth')
                  : t('dashboard.ui.simulation.estimatedBalance');
              return (
                <div
                  className={`dashboard-calendar-day ${
                    amount > 0 ? 'is-positive' : amount < 0 ? 'is-negative' : 'is-neutral'
                  } ${isMonthStart ? 'is-month-start' : ''}`.trim()}
                  key={row.key}
                  style={style}
                  aria-label={`${formatDayMonth(row.date, locale)},${amountLabel} ${formatCurrency(
                    amount
                  )}`}
                  title={formatCurrency(amount)}
                >
                  {isMonthStart || horizonMonths > 1 ? (
                    <em>{formatMonth(row.date, locale)}</em>
                  ) : null}
                  <b>{row.date.slice(-2).replace(/^0/, '')}</b>
                  <small>
                    {calendarMode === 'assets'
                      ? formatCalendarAmount(row.netWorth)
                      : formatCalendarAmount(row.delta)}
                  </small>
                </div>
              );
            })}
          </div>
          <div className="dashboard-calendar-foot">
            <span>
              {t('dashboard.ui.simulation.calendarNetWorth', {
                amount: formatCurrencyAuto(rows.at(-1)?.netWorth || 0)
              })}
            </span>
            <span>
              {t('dashboard.ui.simulation.calendarLiabilities', {
                amount: formatCurrencyAuto(rows.at(-1)?.liabilities || 0)
              })}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
