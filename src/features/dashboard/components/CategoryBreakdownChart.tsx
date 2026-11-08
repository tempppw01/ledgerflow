import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../../shared/lib/format';

export interface CategoryBreakdownChartProps {
  cashflowView: 'expense' | 'income' | 'net';
  activeCategoryItem: {
    name: string;
    icon: string;
    amount: number;
    percent: number;
  } | null;
  donutChart: Array<{
    name: string;
    radius: number;
    ringColor: string;
    dasharray: string;
    dashoffset: number;
  }>;
  cashflowCategoryRows: Array<{
    name: string;
    icon: string;
    amount: number;
    percent: number;
    ringColor: string;
  }>;
  onCashflowViewChange: (view: 'expense' | 'income' | 'net') => void;
  onSelectedCategoryNameChange: (name: string) => void;
}

export function CategoryBreakdownChart({
  cashflowView,
  activeCategoryItem,
  donutChart,
  cashflowCategoryRows,
  onCashflowViewChange,
  onSelectedCategoryNameChange
}: CategoryBreakdownChartProps) {
  const { t } = useTranslation();

  return (
    <article className="panel dashboard-unified-card" style={{ margin: 0 }}>
      <div className="dashboard-section-header dashboard-section-header-tight">
        <h4>{t('dashboard.ui.categoryStructure')}</h4>
        <div className="dashboard-segment-control">
          <button
            type="button"
            className={cashflowView === 'expense' ? 'active' : ''}
            onClick={() => onCashflowViewChange('expense')}
          >
            {t('dashboard.ui.expenseStructure')}
          </button>
          <button
            type="button"
            className={cashflowView === 'income' ? 'active' : ''}
            onClick={() => onCashflowViewChange('income')}
          >
            {t('dashboard.ui.incomeStructure')}
          </button>
          <button
            type="button"
            className={cashflowView === 'net' ? 'active' : ''}
            onClick={() => onCashflowViewChange('net')}
          >
            {t('dashboard.ui.netStructure')}
          </button>
        </div>
      </div>
      {activeCategoryItem ? (
        <div className="dashboard-donut-layout">
          <div className="dashboard-donut-wrap" aria-label={t('dashboard.ui.categoryDonutChart')}>
            <svg viewBox="0 0 220 220" className="dashboard-donut-chart" role="img">
              <circle cx="110" cy="110" r="76" className="dashboard-donut-base" />
              {donutChart.map((segment) => (
                <circle
                  key={segment.name}
                  cx="110"
                  cy="110"
                  r={segment.radius}
                  className={`dashboard-donut-segment ${
                    activeCategoryItem.name === segment.name ? 'is-active' : ''
                  }`.trim()}
                  stroke={segment.ringColor}
                  strokeDasharray={segment.dasharray}
                  strokeDashoffset={segment.dashoffset}
                  onMouseEnter={() => onSelectedCategoryNameChange(segment.name)}
                />
              ))}
            </svg>
            <div className="dashboard-donut-center" title={activeCategoryItem.name}>
              <span>
                {activeCategoryItem.icon} {activeCategoryItem.name}
              </span>
              <strong>{formatCurrency(activeCategoryItem.amount)}</strong>
              <em>{activeCategoryItem.percent.toFixed(1)}%</em>
            </div>
          </div>
          <div className="dashboard-donut-list" role="list" aria-label={t('dashboard.ui.categoryLinkageList')}>
            {cashflowCategoryRows.map((item) => {
              const isActive = activeCategoryItem.name === item.name;
              return (
                <button
                  key={item.name}
                  type="button"
                  role="listitem"
                  className={`dashboard-donut-list-item ${isActive ? 'is-active' : ''}`}
                  onMouseEnter={() => onSelectedCategoryNameChange(item.name)}
                  onFocus={() => onSelectedCategoryNameChange(item.name)}
                  onClick={() => onSelectedCategoryNameChange(item.name)}
                >
                  <div className="dashboard-donut-list-head">
                    <span className="dashboard-donut-list-icon">{item.icon}</span>
                    <strong title={item.name}>{item.name}</strong>
                    <span className="dashboard-donut-list-percent">{item.percent.toFixed(1)}%</span>
                  </div>
                  <div className="dashboard-donut-list-track">
                    <i style={{ width: `${item.percent}%`, background: item.ringColor }} />
                  </div>
                  <div className="dashboard-donut-list-side">
                    <strong>{formatCurrency(item.amount)}</strong>
                    <small>{t('dashboard.ui.categoryShareThisMonth')}</small>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="muted">{t('dashboard.ui.noChartData')}</p>
      )}
    </article>
  );
}
