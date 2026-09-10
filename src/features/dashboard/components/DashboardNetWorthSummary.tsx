import { formatCurrency } from '../../../shared/lib/format';

export interface DashboardNetWorthSummaryProps {
  value: number;
  accountBalance: number;
  investmentValue: number;
  debtBalance: number;
}

export function DashboardNetWorthSummary({
  value,
  accountBalance,
  investmentValue,
  debtBalance
}: DashboardNetWorthSummaryProps) {
  return (
    <div className="dashboard-net-worth-summary" aria-label="净资产构成">
      <div className="dashboard-net-worth-summary-head">
        <span>构成</span>
        <strong>{formatCurrency(value)}</strong>
      </div>
      <div className="dashboard-net-worth-summary-items">
        <span><i className="is-account" />账户 {formatCurrency(accountBalance)}</span>
        <span><i className="is-investment" />投资 {formatCurrency(investmentValue)}</span>
        <span><i className="is-debt" />负债 −{formatCurrency(debtBalance)}</span>
      </div>
    </div>
  );
}

