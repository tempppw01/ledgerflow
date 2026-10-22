import { formatCurrency } from '../../../shared/lib/format';
import { BudgetTrackingRow } from '../model/budgetInsights';
import { BudgetRefreshIcon, BudgetSparkIcon } from './budgetIcons';

export type BudgetAiAdvice = {
  summary: string;
  suggestions: string[];
  focusCategories?: Array<{
    category: string;
    action: 'increase' | 'decrease' | 'keep';
    reason: string;
  }>;
};

export type BudgetAiPanelProps = {
  status: 'idle' | 'loading' | 'done' | 'error';
  error: string;
  advice: BudgetAiAdvice | null;
  topOverspent: BudgetTrackingRow | null;
  onRefresh: () => void;
  onApplyNextMonth: () => void;
  onSetReminder: () => void;
};

export function BudgetAiPanel(props: BudgetAiPanelProps) {
  const { status, error, advice, topOverspent, onRefresh, onApplyNextMonth, onSetReminder } = props;

  return (
    <section className="sb-panel sb-ai-panel" aria-live="polite" aria-label="AI 预算观察">
      <div className="sb-panel-head">
        <div className="sb-ai-title">
          <span className="sb-ai-icon" aria-hidden="true">
            <BudgetSparkIcon className="sb-icon-sm" />
          </span>
          <div>
            <h3 className="sb-section-title">AI 预算观察</h3>
            <p className="sb-panel-sub">按当前执行情况给出下一步该盯住的地方。</p>
          </div>
        </div>
        <button
          type="button"
          className="sb-btn sb-btn--ghost sb-btn--xs"
          onClick={onRefresh}
          disabled={status === 'loading'}
        >
          <BudgetRefreshIcon className="sb-icon-xs" />
          {status === 'loading' ? '分析中' : '重新分析'}
        </button>
      </div>

      {status === 'loading' ? <p className="sb-muted">正在看哪几类支出最需要留意...</p> : null}

      {status === 'error' ? <p className="sb-error">{error}</p> : null}

      {status === 'idle' ? (
        <p className="sb-muted">点击「重新分析」，让 AI 结合本月数据给出调整建议。</p>
      ) : null}

      {topOverspent ? (
        <div className="sb-ai-highlight">
          <p>
            <strong>{topOverspent.category}</strong> 已经花到预算的{' '}
            <strong>{(topOverspent.ratio * 100).toFixed(0)}%</strong>
          </p>
          <p>
            下个月可以把预算调到{' '}
            <strong>{formatCurrency(topOverspent.budgetAmount + topOverspent.diff * 0.5)}</strong>
            ，或者这个月先少花 <strong>{formatCurrency(topOverspent.diff)}</strong>
          </p>
          <div className="sb-ai-actions">
            <button
              type="button"
              className="sb-btn sb-btn--primary sb-btn--xs"
              onClick={onApplyNextMonth}
            >
              调优下月预算
            </button>
            <button type="button" className="sb-btn sb-btn--xs" onClick={onSetReminder}>
              这个月提醒我
            </button>
          </div>
        </div>
      ) : null}

      {status === 'done' && advice ? (
        <>
          <p className="sb-ai-summary">{advice.summary}</p>
          {advice.suggestions.length ? (
            <ul className="sb-ai-list">
              {advice.suggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {advice.focusCategories?.length ? (
            <div className="sb-ai-tags">
              {advice.focusCategories.map((item) => (
                <span
                  key={`${item.category}-${item.action}`}
                  className={`sb-tag is-${item.action}`}
                >
                  {item.category}：
                  {item.action === 'decrease'
                    ? '建议收紧'
                    : item.action === 'increase'
                      ? '可适度加配'
                      : '保持'}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
