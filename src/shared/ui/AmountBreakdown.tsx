import type { ReactNode } from 'react';

export type AmountBreakdownTone = 'neutral' | 'warning' | 'danger' | 'success';

export interface AmountBreakdownRow {
  label: string;
  amount: ReactNode;
  tone?: AmountBreakdownTone;
  helper?: ReactNode;
}

interface AmountBreakdownProps {
  rows: AmountBreakdownRow[];
  total?: AmountBreakdownRow;
  className?: string;
}

export function AmountBreakdown({ rows, total, className = '' }: AmountBreakdownProps) {
  return (
    <div className={`amount-breakdown ${className}`.trim()}>
      <div className="amount-breakdown-rows">
        {rows.map((row) => (
          <div className="amount-breakdown-row" key={row.label}>
            <span className="amount-breakdown-label">
              {row.label}
              {row.helper ? <small>{row.helper}</small> : null}
            </span>
            <strong className={`amount-breakdown-value is-${row.tone ?? 'neutral'}`}>
              {row.amount}
            </strong>
          </div>
        ))}
      </div>
      {total ? (
        <div className="amount-breakdown-total">
          <span>{total.label}</span>
          <strong className={`amount-breakdown-value is-${total.tone ?? 'success'}`}>
            {total.amount}
          </strong>
        </div>
      ) : null}
    </div>
  );
}
