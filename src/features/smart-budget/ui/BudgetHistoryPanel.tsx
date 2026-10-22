import { formatCurrency } from '../../../shared/lib/format';
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

  return (
    <section className="sb-panel sb-history-panel" aria-label="预算版本记录">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-section-title">
            <BudgetHistoryIcon className="sb-icon-sm" />
            预算记录
          </h3>
          <p className="sb-panel-sub">每次确认都会保留一份版本，随时恢复，不用重新填写。</p>
        </div>
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--xs" onClick={onClose}>
          收起
        </button>
      </div>

      {history.length === 0 ? (
        <p className="sb-muted">确认预算后，这里会自动留下可回溯版本。</p>
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
                <span className="sb-history-time">
                  {new Date(plan.confirmedAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
                <strong>
                  {formatCurrency(plan.recommendation.monthlyIncome)} 月收入 · 储蓄{' '}
                  {Math.round(plan.answers.savingsRatio * 100)}%
                </strong>
                <em>{isCurrent ? '当前版本' : '恢复此版本'}</em>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
