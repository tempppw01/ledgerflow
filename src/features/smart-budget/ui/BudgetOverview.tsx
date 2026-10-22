import { formatCurrency } from '../../../shared/lib/format';
import { BudgetHealth } from '../model/budgetHealth';
import { BudgetPacing } from '../model/budgetPacing';
import { BudgetOverview as BudgetOverviewModel } from '../model/budgetOverview';
import {
  BudgetGaugeIcon,
  BudgetSparkIcon,
  BudgetTargetIcon,
  BudgetWalletIcon
} from './budgetIcons';

export type BudgetOverviewProps = {
  overview: BudgetOverviewModel;
  health: BudgetHealth;
  pacing: BudgetPacing | null;
};

function pacingHint(pacing: BudgetPacing | null): string {
  if (!pacing) {
    return '选择月份后可以看到每天可用金额。';
  }
  if (!pacing.isCurrentMonth) {
    return `该月共 ${pacing.daysInMonth} 天，已全部走完，属于历史月份。`;
  }
  if (pacing.status === 'over') {
    return `按现在的节奏，月底预计超支 ${formatCurrency(pacing.projectedOverspend)}。`;
  }
  if (pacing.status === 'warning') {
    return `每天花得比计划多，后面 ${pacing.daysRemaining} 天需要收紧一点。`;
  }
  return `按当前节奏能稳稳用完，今天大约可以花 ${formatCurrency(pacing.dailyAllowance)}。`;
}

export function BudgetOverview({ overview, health, pacing }: BudgetOverviewProps) {
  const executionPercent = Math.round(overview.executionRate * 100);
  const ringPercent = Math.min(Math.max(executionPercent, 0), 100);

  return (
    <section className="sb-overview" aria-label="预算总览">
      <div className="sb-kpi-row">
        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetWalletIcon className="sb-icon-sm" />
            本月预算
          </span>
          <strong className="sb-number">{formatCurrency(overview.totalBudget)}</strong>
          <span className="sb-kpi-foot">
            {overview.totalBudget > 0 ? '灵活分类合计' : '先完成预算设置'}
          </span>
        </article>

        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetGaugeIcon className="sb-icon-sm" />
            已经用掉
          </span>
          <strong className="sb-number">{formatCurrency(overview.totalSpent)}</strong>
          <span className="sb-kpi-foot">执行率 {executionPercent}%</span>
        </article>

        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetTargetIcon className="sb-icon-sm" />
            还能花
          </span>
          <strong
            className={`sb-number ${overview.remainingAmount >= 0 ? 'is-positive' : 'is-negative'}`}
          >
            {formatCurrency(overview.remainingAmount)}
          </strong>
          <span className="sb-kpi-foot">
            {pacing && pacing.isCurrentMonth
              ? `今天约 ${formatCurrency(pacing.dailyAllowance)}`
              : `${overview.safeCount} 个分类在预算内`}
          </span>
        </article>

        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetSparkIcon className="sb-icon-sm" />
            预算健康度
          </span>
          <strong className="sb-number">
            {health.score}
            <em> / 100</em>
          </strong>
          <span className="sb-kpi-foot">{health.label}</span>
        </article>
      </div>

      <div className="sb-overview-detail">
        <div className="sb-ring-wrap">
          <div
            className="sb-ring"
            style={{
              background: `conic-gradient(var(--color-primary) ${ringPercent}%, var(--color-border-light) 0)`
            }}
            role="img"
            aria-label={`预算执行率 ${executionPercent}%`}
          >
            <span>{executionPercent}%</span>
          </div>
          <p className="sb-ring-caption">预算已用比例</p>
        </div>

        <div className="sb-health-block">
          <h3 className="sb-section-title">{health.summary}</h3>
          <ul className="sb-health-factors">
            {health.factors.map((factor) => (
              <li key={factor.key}>
                <span className="sb-health-factor-label">{factor.label}</span>
                <span className="sb-health-factor-detail">{factor.detail}</span>
                <span
                  className={`sb-health-factor-penalty ${factor.penalty > 0 ? 'is-penalty' : ''}`}
                >
                  {factor.penalty > 0 ? `-${factor.penalty}` : '0'}
                </span>
              </li>
            ))}
          </ul>
          <p className="sb-pacing-hint">{pacingHint(pacing)}</p>
        </div>
      </div>
    </section>
  );
}
