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

export type BudgetHealthTranslator = (key: string, fallback: string) => string;

const identityHealthTranslator: BudgetHealthTranslator = (_key, fallback) => fallback;

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
export function calculateBudgetHealth(
  params: {
    executionRate: number;
    overspentCount: number;
    monthIncome: number;
    monthExpense: number;
    /** 超出预算最多的那个分类的执行率(1 = 刚好用完)。缺省按 0 处理,不额外扣分。 */
    worstOverspendRatio?: number;
    /**
     * 按当前节奏外推到月底的执行率(1 = 刚好用完预算)。
     *
     * 只看「已经用掉多少」会把「12 天前就用完整月预算」判成节奏正常:
     * 执行率 99.8% 不扣分,而同一张卡片的节奏预测已经写着「月底预计超支 ¥2,388」。
     * 传了这个值就按它判节奏;不传则退回 executionRate(历史月份两者等价)。
     */
    projectedExecutionRate?: number;
  },
  t: BudgetHealthTranslator = identityHealthTranslator
): BudgetHealth {
  const executionRate = Number.isFinite(params.executionRate) ? params.executionRate : 0;
  const overspentCount = Math.max(0, Math.round(params.overspentCount));
  const monthIncome = Number.isFinite(params.monthIncome) ? Math.max(0, params.monthIncome) : 0;
  const monthExpense = Number.isFinite(params.monthExpense) ? Math.max(0, params.monthExpense) : 0;

  const worstOverspendRatio = Number.isFinite(params.worstOverspendRatio)
    ? Math.max(0, Number(params.worstOverspendRatio))
    : 0;
  const projectedExecutionRate = Number.isFinite(params.projectedExecutionRate)
    ? Math.max(0, Number(params.projectedExecutionRate))
    : executionRate;
  const usingProjection = projectedExecutionRate !== executionRate;

  /*
   * 只按「几个分类超支」计数是不够的:一个分类超到 238% 和一个分类超到 101%
   * 拿一样的扣分,于是「固定支出超 ¥4,143」旁边照样写着「预算执行得很稳」。
   * 这一项按**超出的倍数**追加扣分。
   */
  const overspendPenalty = Math.min(
    Math.min(overspentCount * 10, 40) + Math.min(Math.max(worstOverspendRatio - 1, 0) * 20, 30),
    70
  );
  const overRate = Math.max(projectedExecutionRate - 1, 0);
  // 只惩罚超支,不惩罚省钱。这里原本还加了 underRate * 100 * 0.15 一项,
  // 于是「一分钱没花」也会被扣 15 分,和上面那句注释以及下方明细文案
  // (「节奏可控」)都矛盾 —— 界面上会出现「节奏可控  −15」这种自相矛盾的组合。
  const executionPenalty = Math.min(overRate * 100 * 0.5, 35);
  const balanceRatio = monthExpense > 0 ? Math.min(monthIncome / monthExpense, 1) : 1;
  const balancePenalty = Math.min((1 - balanceRatio) * 25, 25);

  const score = Math.max(0, Math.round(100 - overspendPenalty - executionPenalty - balancePenalty));

  const level: BudgetHealthLevel =
    score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : 'risk';

  const factors: BudgetHealthFactor[] = [
    {
      key: 'overspend',
      label: t('smartBudget.health.factor.overspend.label', '分类超支'),
      penalty: Math.round(overspendPenalty),
      detail:
        overspentCount <= 0
          ? t('smartBudget.health.factor.overspend.detail.none', '没有分类超出预算')
          : worstOverspendRatio > 1
            ? t(
                'smartBudget.health.factor.overspend.detail.severe',
                '{count} 个分类超出预算,最多超了 {percent}%'
              )
                .replace('{count}', String(overspentCount))
                .replace('{percent}', String(Math.round((worstOverspendRatio - 1) * 100)))
            : t(
                'smartBudget.health.factor.overspend.detail.some',
                '{count} 个分类已经超出预算'
              ).replace('{count}', String(overspentCount))
    },
    {
      key: 'execution',
      label: t('smartBudget.health.factor.execution.label', '执行节奏'),
      penalty: Math.round(executionPenalty),
      /*
       * 必须连 **key** 一起换,不能只换 fallback:旧 key 在语言包里已经有值,
       * tf() 会优先取语言包,只改 fallback 的话外推文案根本不会出现。
       */
      detail:
        projectedExecutionRate > 1
          ? t(
              usingProjection
                ? 'smartBudget.health.factor.execution.detail.projectedOver'
                : 'smartBudget.health.factor.execution.detail.over',
              '按现在的节奏,月底预计用掉预算的 {percent}%'
            ).replace('{percent}', String((projectedExecutionRate * 100).toFixed(0)))
          : t(
              usingProjection
                ? 'smartBudget.health.factor.execution.detail.projectedUnder'
                : 'smartBudget.health.factor.execution.detail.under',
              '整体用掉预算的 {percent}%，节奏可控'
            ).replace('{percent}', String((projectedExecutionRate * 100).toFixed(0)))
    },
    {
      key: 'balance',
      label: t('smartBudget.health.factor.balance.label', '收支平衡'),
      penalty: Math.round(balancePenalty),
      detail:
        monthExpense > 0 && monthIncome < monthExpense
          ? t('smartBudget.health.factor.balance.detail.short', '收入比支出少 {amount} 元').replace(
              '{amount}',
              String(Math.round(monthExpense - monthIncome))
            )
          : t('smartBudget.health.factor.balance.detail.cover', '收入可以覆盖本月支出')
    }
  ];

  const summary =
    level === 'excellent'
      ? t(
          'smartBudget.health.summary.excellent',
          '预算执行得很稳，可以把结余优先安排到储蓄或应急金。'
        )
      : level === 'good'
        ? t('smartBudget.health.summary.good', '整体执行健康，保持现在的节奏就可以。')
        : level === 'fair'
          ? t('smartBudget.health.summary.fair', '还有收紧空间，优先从超支分类里压降。')
          : t('smartBudget.health.summary.risk', '当前预算缺口明显，建议立刻调整超支分类的额度。');

  return {
    score,
    level,
    label: t(`smartBudget.health.level.${level}`, LEVEL_LABEL[level]),
    summary,
    factors
  };
}
