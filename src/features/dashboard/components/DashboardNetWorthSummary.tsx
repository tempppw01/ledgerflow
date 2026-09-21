import { formatCurrencyAuto } from '../../../shared/lib/format';

export interface DashboardNetWorthSummaryProps {
  value: number;
  accountBalance: number;
  investmentValue: number;
  debtBalance: number;
}

export function DashboardNetWorthSummary({
  value: _value,
  accountBalance,
  investmentValue,
  debtBalance
}: DashboardNetWorthSummaryProps) {
  return (
    <div className="dashboard-net-worth-summary" aria-label="净资产构成">
      <div className="dashboard-net-worth-summary-head">
        <span>构成</span>
      </div>
      <div className="dashboard-net-worth-summary-items">
        <span><i className="is-account" /><em>账户</em><b>{formatCurrencyAuto(accountBalance)}</b></span>
        <span><i className="is-investment" /><em>投资</em><b>{formatCurrencyAuto(investmentValue)}</b></span>
        <span><i className="is-debt" /><em>负债</em><b>−{formatCurrencyAuto(debtBalance)}</b></span>
      </div>
    </div>
  );
}
