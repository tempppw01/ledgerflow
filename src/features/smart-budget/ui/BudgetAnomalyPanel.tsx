import { formatCurrency } from '../../../shared/lib/format';
import { BudgetAlertIcon } from './budgetIcons';

export type BudgetAnomaly = {
  category: string;
  projectedSpent: number;
  riskRatio: number;
  suggestedSaving: number;
};

export type BudgetAnomalyPanelProps = {
  anomalies: BudgetAnomaly[];
  onSelectCategory: (category: string) => void;
};

export function BudgetAnomalyPanel({ anomalies, onSelectCategory }: BudgetAnomalyPanelProps) {
  if (anomalies.length === 0) {
    return null;
  }

  return (
    <section className="sb-panel sb-anomaly-panel" aria-label="异常提醒">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-section-title">
            <BudgetAlertIcon className="sb-icon-sm" />
            异常提醒与调整建议
          </h3>
          <p className="sb-panel-sub">按当前速度，月底可能超支的分类。</p>
        </div>
      </div>

      <ul className="sb-anomaly-list">
        {anomalies.slice(0, 5).map((item) => (
          <li key={item.category}>
            <button
              type="button"
              className="sb-anomaly-row"
              onClick={() => onSelectCategory(item.category)}
            >
              <div>
                <strong>{item.category}</strong>
                <span>
                  预计月末支出 {formatCurrency(item.projectedSpent)}，约为预算的{' '}
                  {(item.riskRatio * 100).toFixed(0)}%
                </span>
              </div>
              <span className="sb-anomaly-tip">
                建议少花 {formatCurrency(item.suggestedSaving)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
