import { formatCurrency } from '../../../shared/lib/format';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { resolveBudgetCategoryLabel } from '../model/budgetCategoryLabels';
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
  const tf = useTFallback();
  return (
    <section
      className="sb-panel sb-anomaly-panel"
      aria-label={tf('smartBudget.anomaly.aria', '异常提醒')}
    >
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-section-title">
            <BudgetAlertIcon className="sb-icon-sm" />
            {tf('smartBudget.anomaly.title', '异常提醒与调整建议')}
          </h3>
        </div>
      </div>

      {anomalies.length === 0 ? (
        <p className="sb-empty">
          {tf('smartBudget.anomaly.empty', '目前没有临近超支的分类,保持当前节奏即可。')}
        </p>
      ) : (
        <ul className="sb-anomaly-list">
          {anomalies.slice(0, 5).map((item) => (
            <li key={item.category}>
              <button
                type="button"
                className="sb-anomaly-row"
                onClick={() => onSelectCategory(item.category)}
              >
                <div>
                  <strong>{resolveBudgetCategoryLabel(item.category, tf)}</strong>
                  <span>
                    {tf('smartBudget.anomaly.projected', '预计月末支出')}{' '}
                    {formatCurrency(item.projectedSpent)}
                    {tf('smartBudget.anomaly.aboutBudget', '，约为预算的')}{' '}
                    {(item.riskRatio * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="sb-anomaly-tip">
                  {tf('smartBudget.anomaly.trim', '建议少花')}{' '}
                  {formatCurrency(item.suggestedSaving)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
