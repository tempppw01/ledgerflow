export type BudgetHealthLevel = 'excellent' | 'good' | 'fair' | 'risk';

export type BudgetHealthFactor = {
  key: 'overspend' | 'execution' | 'balance';
  label: string;
  penalty: number;
  detail: string;
};

export type BudgetHealth = {
  score: number;
  level: BudgetHealthLevel;
  label: string;
  summary: string;
  factors: BudgetHealthFactor[];
};

const LEVEL_LABEL: Record<BudgetHealthLevel, string> = {
  excellent: '状态优秀',
  good: '状态良好',
  fair: '需要留意',
  risk: '存在风险'
};

/**
 * 预算健康度：把黑盒分数拆成三项可解释的扣分项。
 * - 分类超支：超支分类越多扣分越多。
 * - 执行节奏：只对超出预算的部分加重扣分，省钱不做惩罚。
 * - 收支平衡：本月收入覆盖不了支出时扣分。
 */
export function calculateBudgetHealth(params: {
  executionRate: number;
  overspentCount: number;
  monthIncome: number;
  monthExpense: number;
}): BudgetHealth {
  const executionRate = Number.isFinite(params.executionRate) ? params.executionRate : 0;
  const overspentCount = Math.max(0, Math.round(params.overspentCount));
  const monthIncome = Number.isFinite(params.monthIncome) ? Math.max(0, params.monthIncome) : 0;
  const monthExpense = Number.isFinite(params.monthExpense) ? Math.max(0, params.monthExpense) : 0;

  const overspendPenalty = Math.min(overspentCount * 10, 40);
  const overRate = Math.max(executionRate - 1, 0);
  const underRate = Math.max(1 - executionRate, 0);
  const executionPenalty = Math.min(overRate * 100 * 0.5 + underRate * 100 * 0.15, 35);
  const balanceRatio = monthExpense > 0 ? Math.min(monthIncome / monthExpense, 1) : 1;
  const balancePenalty = Math.min((1 - balanceRatio) * 25, 25);

  const score = Math.max(0, Math.round(100 - overspendPenalty - executionPenalty - balancePenalty));

  const level: BudgetHealthLevel =
    score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : 'risk';

  const factors: BudgetHealthFactor[] = [
    {
      key: 'overspend',
      label: '分类超支',
      penalty: Math.round(overspendPenalty),
      detail: overspentCount > 0 ? `${overspentCount} 个分类已经超出预算` : '没有分类超出预算'
    },
    {
      key: 'execution',
      label: '执行节奏',
      penalty: Math.round(executionPenalty),
      detail:
        executionRate > 1
          ? `整体已用掉预算的 ${(executionRate * 100).toFixed(0)}%`
          : `整体用掉预算的 ${(executionRate * 100).toFixed(0)}%，节奏可控`
    },
    {
      key: 'balance',
      label: '收支平衡',
      penalty: Math.round(balancePenalty),
      detail:
        monthExpense > 0 && monthIncome < monthExpense
          ? `收入比支出少 ${Math.round(monthExpense - monthIncome)} 元`
          : '收入可以覆盖本月支出'
    }
  ];

  const summary =
    level === 'excellent'
      ? '预算执行得很稳，可以把结余优先安排到储蓄或应急金。'
      : level === 'good'
        ? '整体执行健康，保持现在的节奏就可以。'
        : level === 'fair'
          ? '还有收紧空间，优先从超支分类里压降。'
          : '当前预算缺口明显，建议立刻调整超支分类的额度。';

  return { score, level, label: LEVEL_LABEL[level], summary, factors };
}
