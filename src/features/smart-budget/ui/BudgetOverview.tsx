import { formatCurrency } from '../../../shared/lib/format';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';
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

function pacingHint(pacing: BudgetPacing | null, tf: TfFallback): string {
  if (!pacing) {
    return tf('smartBudget.overview.pacing.none', '选择月份后可以看到每天可用金额。');
  }
  if (!pacing.isCurrentMonth) {
    return tf(
      'smartBudget.overview.pacing.pastMonth',
      '该月共 {days} 天，已全部走完，属于历史月份。'
    ).replace('{days}', String(pacing.daysInMonth));
  }
  if (pacing.status === 'over') {
    return tf('smartBudget.overview.pacing.over', '按现在的节奏，月底预计超支 {amount}。').replace(
      '{amount}',
      String(formatCurrency(pacing.projectedOverspend))
    );
  }
  if (pacing.status === 'warning') {
    return tf(
      'smartBudget.overview.pacing.warning',
      '每天花得比计划多，后面 {days} 天需要收紧一点。'
    ).replace('{days}', String(pacing.daysRemaining));
  }
  return tf(
    'smartBudget.overview.pacing.steady',
    '按当前节奏能稳稳用完，今天大约可以花 {amount}。'
  ).replace('{amount}', String(formatCurrency(pacing.dailyAllowance)));
}

export function BudgetOverview({ overview, health, pacing }: BudgetOverviewProps) {
  const tf = useTFallback();
  const executionPercent = Math.round(overview.executionRate * 100);
  const ringPercent = Math.min(Math.max(executionPercent, 0), 100);

  return (
    <section className="sb-overview" aria-label={tf('smartBudget.overview.aria', '预算总览')}>
      <div className="sb-kpi-row">
        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetWalletIcon className="sb-icon-sm" />
            {tf('smartBudget.overview.monthBudget', '本月预算')}
          </span>
          <strong className="sb-number">{formatCurrency(overview.totalBudget)}</strong>
          <span className="sb-kpi-foot">
            {overview.totalBudget > 0
              ? tf('smartBudget.overview.flexTotal', '灵活分类合计')
              : tf('smartBudget.overview.setupFirst', '先完成预算设置')}
          </span>
        </article>

        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetGaugeIcon className="sb-icon-sm" />
            {tf('smartBudget.overview.spent', '已经用掉')}
          </span>
          <strong className="sb-number">{formatCurrency(overview.totalSpent)}</strong>
          <span className="sb-kpi-foot">
            {tf('smartBudget.common.executionRate', '执行率')} {executionPercent}%
          </span>
        </article>

        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetTargetIcon className="sb-icon-sm" />
            {tf('smartBudget.overview.remaining', '还能花')}
          </span>
          <strong
            className={`sb-number ${overview.remainingAmount >= 0 ? 'is-positive' : 'is-negative'}`}
          >
            {formatCurrency(overview.remainingAmount)}
          </strong>
          <span className="sb-kpi-foot">
            {pacing && pacing.isCurrentMonth
              ? tf('smartBudget.overview.todayAllowance', '今天约 {amount}').replace(
                  '{amount}',
                  String(formatCurrency(pacing.dailyAllowance))
                )
              : tf('smartBudget.overview.safeCount', '{count} 个分类在预算内').replace(
                  '{count}',
                  String(overview.safeCount)
                )}
          </span>
        </article>

        <article className="sb-kpi">
          <span className="sb-kpi-label">
            <BudgetSparkIcon className="sb-icon-sm" />
            {tf('smartBudget.overview.healthTitle', '预算健康度')}
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
            aria-label={tf('smartBudget.overview.ringAria', '预算执行率 {percent}%').replace(
              '{percent}',
              String(executionPercent)
            )}
          >
            <span>{executionPercent}%</span>
          </div>
          <p className="sb-ring-caption">
            {tf('smartBudget.overview.ringCaption', '预算已用比例')}
          </p>
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
          <p className="sb-pacing-hint">{pacingHint(pacing, tf)}</p>
        </div>
      </div>
    </section>
  );
}
