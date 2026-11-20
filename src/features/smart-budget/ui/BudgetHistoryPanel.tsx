import { formatCurrency, formatDateTime } from '../../../shared/lib/format';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { ConfirmedSmartBudgetPlan } from '../../../shared/store/useSmartBudgetStore';
import { BudgetHistoryIcon } from './budgetIcons';

export type BudgetHistoryPanelProps = {
  history: ConfirmedSmartBudgetPlan[];
  currentConfirmedAt: string;
  onRestore: (plan: ConfirmedSmartBudgetPlan) => void;
  onClose: () => void;
};

export function BudgetHistoryPanel(props: BudgetHistoryPanelProps) {
  const { history, currentConfirmedAt, onRestore, onClose } = props;
  const tf = useTFallback();

  return (
    <section
      className="sb-panel sb-history-panel"
      aria-label={tf('smartBudget.historyPanel.aria', '预算版本记录')}
    >
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-section-title">
            <BudgetHistoryIcon className="sb-icon-sm" />
            {tf('smartBudget.historyButton', '预算记录')}
          </h3>
          <p className="sb-panel-sub">
            {tf(
              'smartBudget.historyPanel.subtitle',
              '每次确认都会保留一份版本，随时恢复，不用重新填写。'
            )}
          </p>
        </div>
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--xs" onClick={onClose}>
          {tf('categoriesAccounts.collapse', '收起')}
        </button>
      </div>

      {history.length === 0 ? (
        <p className="sb-muted">
          {tf('smartBudget.historyPanel.empty', '确认预算后，这里会自动留下可回溯版本。')}
        </p>
      ) : (
        <div className="sb-history-list">
          {history.map((plan) => {
            const isCurrent = plan.confirmedAt === currentConfirmedAt;
            return (
              <button
                type="button"
                key={plan.confirmedAt}
                className={`sb-history-item ${isCurrent ? 'is-current' : ''}`}
                onClick={() => onRestore(plan)}
              >
                <span className="sb-history-time">{formatDateTime(plan.confirmedAt)}</span>
                <strong>
                  {formatCurrency(plan.recommendation.monthlyIncome)}{' '}
                  {tf('smartBudget.historyPanel.incomeSavings', '月收入 · 储蓄')}{' '}
                  {Math.round(plan.answers.savingsRatio * 100)}%
                </strong>
                <em>
                  {isCurrent
                    ? tf('smartBudget.historyPanel.current', '当前版本')
                    : tf('smartBudget.historyPanel.restore', '恢复此版本')}
                </em>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
