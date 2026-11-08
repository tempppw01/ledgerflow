import { formatCurrencyAuto } from '../../../shared/lib/format';
import { useTranslation } from 'react-i18next';

export interface DashboardNetWorthSummaryProps {
  value: number;
  accountBalance: number;
  investmentValue: number;
  debtBalance: number;
}

export function DashboardNetWorthSummary({
  accountBalance,
  investmentValue,
  debtBalance
}: DashboardNetWorthSummaryProps) {
  const { t } = useTranslation();

  return (
    <div
      className="dashboard-net-worth-summary"
      aria-label={t('dashboard.ui.netWorthBreakdown')}
    >
      <div className="dashboard-net-worth-summary-head">
        <span>{t('dashboard.ui.breakdown')}</span>
      </div>
      <div className="dashboard-net-worth-summary-items">
        <span>
          <i className="is-account" />
          <em>{t('dashboard.ui.account')}</em>
          <b>{formatCurrencyAuto(accountBalance)}</b>
        </span>
        <span>
          <i className="is-investment" />
          <em>{t('dashboard.ui.investments')}</em>
          <b>{formatCurrencyAuto(investmentValue)}</b>
        </span>
        <span>
          <i className="is-debt" />
          <em>{t('dashboard.ui.liabilities')}</em>
          <b>−{formatCurrencyAuto(debtBalance)}</b>
        </span>
      </div>
    </div>
  );
}
