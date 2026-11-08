import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../../shared/lib/format';
import type { TrendSeriesItem } from '../model/utils';

export interface TrendChartProps {
  trendSeries: TrendSeriesItem[];
  activeTrendIndex: number | null;
  trendPeakIndex: number;
  trendGranularity: 'week' | 'month' | 'year';
  trendBaseYear: number;
  trendBaseMonth: number;
  expenseTrendAverage: number;
  trendMonthOffset: number;
  onTrendGranularityChange: (granularity: 'week' | 'month' | 'year') => void;
  onTrendMonthOffsetChange: (offset: number) => void;
  onSelectedTrendIndexChange: (index: number | null) => void;
  onNavigateToTransactions: (dateFrom: string, dateTo: string) => void;
  trendBarHeight: (value: number) => string;
}

export function TrendChart({
  trendSeries,
  activeTrendIndex,
  trendPeakIndex,
  trendGranularity,
  trendBaseYear,
  trendBaseMonth,
  expenseTrendAverage,
  trendMonthOffset,
  onTrendGranularityChange,
  onTrendMonthOffsetChange,
  onSelectedTrendIndexChange,
  onNavigateToTransactions,
  trendBarHeight
}: TrendChartProps) {
  const { t } = useTranslation();

  return (
    <article className="panel dashboard-unified-card" style={{ margin: 0 }}>
      <div className="dashboard-section-header">
        <h4>{t('dashboard.ui.expenseTrend')}</h4>
        <div className="dashboard-trend-header-actions">
          {trendGranularity === 'week' ? (
            <div className="dashboard-trend-month-switcher">
              <button type="button" onClick={() => onTrendMonthOffsetChange(trendMonthOffset - 1)}>
                {t('dashboard.ui.previousMonth')}
              </button>
              <strong>
                {trendBaseYear}
                {t('dashboard.ui.year')}
                {trendBaseMonth + 1}
                {t('dashboard.ui.month')}
              </strong>
              <button
                type="button"
                onClick={() => onTrendMonthOffsetChange(Math.min(trendMonthOffset + 1, 0))}
                disabled={trendMonthOffset >= 0}
              >
                {t('dashboard.ui.nextMonth')}
              </button>
            </div>
          ) : null}
          <div className="dashboard-segment-control">
            <button
              type="button"
              className={trendGranularity === 'week' ? 'active' : ''}
              onClick={() => onTrendGranularityChange('week')}
            >
              {t('dashboard.ui.granularityDay')}
            </button>
            <button
              type="button"
              className={trendGranularity === 'month' ? 'active' : ''}
              onClick={() => onTrendGranularityChange('month')}
            >
              {t('dashboard.ui.granularityMonth')}
            </button>
            <button
              type="button"
              className={trendGranularity === 'year' ? 'active' : ''}
              onClick={() => onTrendGranularityChange('year')}
            >
              {t('dashboard.ui.granularityYear')}
            </button>
          </div>
        </div>
      </div>
      {trendSeries.length > 0 ? (
        <div className="dashboard-expense-trend-card">
          {activeTrendIndex !== null && (
            <div className="dashboard-expense-trend-tooltip">
              <span>{trendSeries[activeTrendIndex].label}</span>
              <strong>{formatCurrency(trendSeries[activeTrendIndex].value)}</strong>
              <em>
                {activeTrendIndex === trendPeakIndex
                  ? t('dashboard.ui.peakExpense')
                  : trendSeries[activeTrendIndex].value > expenseTrendAverage
                    ? t('dashboard.ui.aboveAverageWarning')
                    : t('dashboard.ui.normalRange')}
              </em>
            </div>
          )}
          <div
            className="dashboard-expense-trend-chart"
            role="list"
            aria-label={t('dashboard.ui.expenseTrendChart')}
          >
            {trendSeries.map((item, index) => {
              const isActive = index === activeTrendIndex;
              const isPeak = index === trendPeakIndex;
              return (
                <button
                  key={`${item.label}-${index}`}
                  type="button"
                  role="listitem"
                  className={`dashboard-expense-trend-bar ${isActive ? 'is-active' : ''} ${
                    isPeak ? 'is-peak' : ''
                  }`.trim()}
                  onMouseEnter={() => onSelectedTrendIndexChange(index)}
                  onFocus={() => onSelectedTrendIndexChange(index)}
                  onClick={() => onNavigateToTransactions(item.dateFrom, item.dateTo)}
                  title={`${item.label} ${t('dashboard.ui.expense')} ${formatCurrency(item.value)}`}
                >
                  <span className="dashboard-expense-trend-track" aria-hidden="true">
                    <i style={{ height: trendBarHeight(item.value) }} />
                  </span>
                  <strong>{item.shortLabel}</strong>
                </button>
              );
            })}
          </div>
          <div className="dashboard-expense-trend-footnote">
            <span>
              {t('dashboard.ui.average')} {formatCurrency(expenseTrendAverage)}
            </span>
            <span>{t('dashboard.ui.clickToViewTransactions')}</span>
          </div>
        </div>
      ) : (
        <p className="muted">{t('dashboard.ui.noChartData')}</p>
      )}
    </article>
  );
}
