export type UserIdentity = 'student' | 'employee' | 'freelancer' | 'other';

export type BudgetAnswers = {
  identity: UserIdentity;
  /** 每月到手收入，单位：元 */
  monthlyIncome: number;
  /** 每月固定支出（房租、房贷、订阅等），单位：元 */
  monthlyFixedExpense: number;
  savingsRatio: number;
};

export const DEFAULT_BUDGET_ANSWERS: BudgetAnswers = {
  identity: 'employee',
  monthlyIncome: 10000,
  monthlyFixedExpense: 3000,
  savingsRatio: 0.3
};

/**
 * 兼容旧版本持久化的数据。
 * 早期版本用「千」为单位保存收入与固定支出，这里统一换算成「元」。
 */
export function normalizeBudgetAnswers(raw: unknown): BudgetAnswers {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const identityValue = String(source.identity || 'employee');
  const identity: UserIdentity = (
    ['student', 'employee', 'freelancer', 'other'] as UserIdentity[]
  ).includes(identityValue as UserIdentity)
    ? (identityValue as UserIdentity)
    : 'employee';

  const readAmount = (value: unknown, legacyK: unknown): number => {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) {
      return Math.round(direct);
    }
    const legacy = Number(legacyK);
    if (Number.isFinite(legacy) && legacy > 0) {
      return Math.round(legacy * 1000);
    }
    return 0;
  };

  const savingsRatio = Number(source.savingsRatio);

  return {
    identity,
    monthlyIncome: readAmount(source.monthlyIncome, source.monthlyIncomeK),
    monthlyFixedExpense: readAmount(source.monthlyFixedExpense, source.monthlyFixedExpenseK),
    savingsRatio: Number.isFinite(savingsRatio) ? Math.min(0.6, Math.max(0.1, savingsRatio)) : 0.3
  };
}

export type BudgetCategoryPlan = {
  category: string;
  amount: number;
  ratio: number;
};

export type BudgetRecommendation = {
  monthlyIncome: number;
  monthlyFixedExpense: number;
  disposableIncome: number;
  savingsAmount: number;
  flexibleBudget: number;
  /** 分类分摊算法版本，用于判断是否需要重新同步账本分类。 */
  distributionVersion?: number;
  /**
   身份对应的灵活分类权重（键为推荐分类名，值为相对权重）。
   同步到账本分类时用它做分配依据，保证每次同步结果一致。
   */
  flexibleWeights?: Record<string, number>;
  categoryBudgets: BudgetCategoryPlan[];
};

export function applyCategoryBudgetEdits(
  recommendation: BudgetRecommendation,
  updates: Record<string, number>
): BudgetRecommendation {
  const monthlyIncome = recommendation.monthlyIncome;
  const editedCategoryBudgets = recommendation.categoryBudgets.map((item) => {
    const nextAmount = updates[item.category];
    const amount =
      Number.isFinite(nextAmount) && nextAmount >= 0
        ? Math.round(nextAmount)
        : Math.round(item.amount);
    return {
      ...item,
      amount,
      ratio: monthlyIncome > 0 ? amount / monthlyIncome : 0
    };
  });

  const monthlyFixedExpense =
    editedCategoryBudgets.find((item) => item.category === '固定支出')?.amount || 0;
  const savingsAmount =
    editedCategoryBudgets.find((item) => item.category === '储蓄/投资')?.amount || 0;
  const flexibleBudget = editedCategoryBudgets
    .filter((item) => !['固定支出', '储蓄/投资'].includes(item.category))
    .reduce((sum, item) => sum + item.amount, 0);

  return {
    ...recommendation,
    monthlyFixedExpense,
    savingsAmount,
    flexibleBudget,
    disposableIncome: monthlyIncome - monthlyFixedExpense,
    categoryBudgets: editedCategoryBudgets
  };
}

const IDENTITY_LABELS: Record<UserIdentity, string> = {
  student: '学生',
  employee: '上班族',
  freelancer: '自由职业者',
  other: '其他'
};

const FLEXIBLE_CATEGORY_WEIGHT: Record<
  UserIdentity,
  Array<{ category: string; weight: number }>
> = {
  student: [
    { category: '餐饮', weight: 0.3 },
    { category: '学习成长', weight: 0.28 },
    { category: '交通', weight: 0.12 },
    { category: '娱乐社交', weight: 0.18 },
    { category: '医疗健康', weight: 0.12 }
  ],
  employee: [
    { category: '餐饮', weight: 0.26 },
    { category: '交通', weight: 0.16 },
    { category: '通讯网络', weight: 0.12 },
    { category: '家庭生活', weight: 0.24 },
    { category: '娱乐社交', weight: 0.12 },
    { category: '学习成长', weight: 0.1 }
  ],
  freelancer: [
    { category: '餐饮', weight: 0.22 },
    { category: '交通', weight: 0.12 },
    { category: '工作投入', weight: 0.26 },
    { category: '家庭生活', weight: 0.18 },
    { category: '医疗健康', weight: 0.1 },
    { category: '娱乐社交', weight: 0.12 }
  ],
  other: [
    { category: '餐饮', weight: 0.24 },
    { category: '交通', weight: 0.14 },
    { category: '家庭生活', weight: 0.24 },
    { category: '医疗健康', weight: 0.14 },
    { category: '学习成长', weight: 0.12 },
    { category: '娱乐社交', weight: 0.12 }
  ]
};

function roundToTen(amount: number): number {
  return Math.round(amount / 10) * 10;
}

function normalizeWeights(
  items: Array<{ category: string; weight: number }>
): Array<{ category: string; weight: number }> {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return items.map((item) => ({ ...item, weight: 1 / items.length }));
  }
  return items.map((item) => ({ ...item, weight: item.weight / totalWeight }));
}

/**
 * 所有身份预设的平均权重，用于「不知道用户身份」时给出中性分配。
 * 例如账本里的分类名一个都对不上身份预设，也不至于出现 0 额度。
 */
export const CANONICAL_IDENTITY_WEIGHTS: Record<string, number> = (() => {
  const identities = Object.keys(FLEXIBLE_CATEGORY_WEIGHT) as UserIdentity[];
  const totals = new Map<string, number>();

  identities.forEach((identity) => {
    FLEXIBLE_CATEGORY_WEIGHT[identity].forEach((item) => {
      totals.set(item.category, (totals.get(item.category) || 0) + item.weight / identities.length);
    });
  });

  return Object.fromEntries(totals);
})();

export function getIdentityCategoryWeights(identity: UserIdentity): Record<string, number> {
  return Object.fromEntries(
    FLEXIBLE_CATEGORY_WEIGHT[identity].map((item) => [item.category, item.weight])
  );
}
/**
 * 根据四个问答结果生成预算建议。
 * - 收入与固定支出均以元为单位输入。
 * - 预算会拆分为固定支出、储蓄与灵活支出分类，且总额严格等于月收入。
 */
export function generateBudgetRecommendation(answers: BudgetAnswers): BudgetRecommendation {
  if (!Number.isFinite(answers.monthlyIncome) || answers.monthlyIncome <= 0) {
    throw new Error('每月收入必须大于 0。');
  }
  if (!Number.isFinite(answers.monthlyFixedExpense) || answers.monthlyFixedExpense < 0) {
    throw new Error('固定支出不能小于 0。');
  }
  if (
    !Number.isFinite(answers.savingsRatio) ||
    answers.savingsRatio < 0.1 ||
    answers.savingsRatio > 0.6
  ) {
    throw new Error('预算比例应在 10%~60% 之间。');
  }

  const monthlyIncome = Math.round(answers.monthlyIncome);
  const monthlyFixedExpense = Math.round(answers.monthlyFixedExpense);

  if (monthlyFixedExpense >= monthlyIncome) {
    throw new Error('固定支出需要小于月收入，才能生成可执行预算。');
  }

  const disposableIncome = monthlyIncome - monthlyFixedExpense;
  const savingsAmount = roundToTen(disposableIncome * answers.savingsRatio);
  const flexibleBudget = monthlyIncome - monthlyFixedExpense - savingsAmount;

  const dynamicWeights = normalizeWeights(FLEXIBLE_CATEGORY_WEIGHT[answers.identity]);

  const dynamicPlans: BudgetCategoryPlan[] = dynamicWeights.map((item) => ({
    category: item.category,
    amount: roundToTen(flexibleBudget * item.weight),
    ratio: 0
  }));

  const dynamicBudgetUsed = dynamicPlans.reduce((sum, item) => sum + item.amount, 0);
  const dynamicDelta = flexibleBudget - dynamicBudgetUsed;
  if (dynamicPlans.length > 0 && dynamicDelta !== 0) {
    dynamicPlans[0] = {
      ...dynamicPlans[0],
      amount: dynamicPlans[0].amount + dynamicDelta
    };
  }

  const categoryBudgets = [
    {
      category: '固定支出',
      amount: monthlyFixedExpense,
      ratio: 0
    },
    {
      category: '储蓄/投资',
      amount: savingsAmount,
      ratio: 0
    },
    ...dynamicPlans
  ].map((item) => ({
    ...item,
    ratio: monthlyIncome > 0 ? item.amount / monthlyIncome : 0
  }));

  return {
    monthlyIncome,
    monthlyFixedExpense,
    disposableIncome,
    savingsAmount,
    flexibleBudget,
    flexibleWeights: getIdentityCategoryWeights(answers.identity),
    categoryBudgets
  };
}

export function getIdentityLabel(identity: UserIdentity): string {
  return IDENTITY_LABELS[identity];
}
