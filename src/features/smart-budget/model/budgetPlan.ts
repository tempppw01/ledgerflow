import { BudgetRecommendation, CANONICAL_IDENTITY_WEIGHTS } from './budgetPlanner';

export const CORE_BUDGET_CATEGORIES = ['固定支出', '储蓄/投资'] as const;

/**
 * 分类预算分摊算法的版本。
 * 旧版本会给账本里没有对应身份的分类留下 0 额度，
 * 版本号变化时重新分摊一次，之后保留用户手动调整过的金额。
 */
export const BUDGET_DISTRIBUTION_VERSION = 2;

export function normalizeBudgetCategoryName(raw: string): string {
  return raw.trim().toLocaleLowerCase('zh-CN');
}

export function isCoreBudgetCategory(category: string): boolean {
  return CORE_BUDGET_CATEGORIES.includes(category as (typeof CORE_BUDGET_CATEGORIES)[number]);
}

export function buildBudgetSignature(recommendation: BudgetRecommendation): string {
  return recommendation.categoryBudgets
    .map((item) => `${normalizeBudgetCategoryName(item.category)}:${Math.round(item.amount)}`)
    .join('|');
}

/**
 * 身份预设分类对应的关键词。
 * 账本里的分类名是用户自己起的，只有精确同名的分类能直接对上，
 * 其余用关键词兜底匹配，这样「购物日用」也能分到「家庭生活」的额度。
 */
const IDENTITY_CATEGORY_KEYWORDS: Record<string, string[]> = {
  餐饮: ['餐', '食', '饭', '饮', '吃', '外卖', '咖啡', '奶茶', '水果', '买菜', '零食'],
  交通: ['交通', '车', '油', '地铁', '公交', '打车', '高铁', '机票', '停车', '过路'],
  通讯网络: ['通讯', '网络', '话费', '宽带', '手机', '流量', '会员服务'],
  家庭生活: [
    '家',
    '住',
    '水电',
    '燃气',
    '日用',
    '家居',
    '购物',
    '衣',
    '鞋',
    '美容',
    '理发',
    '宠物',
    '母婴',
    '洗护'
  ],
  娱乐社交: ['娱乐', '社交', '旅', '游', '电影', '演出', '运动', '健身', '游戏', '聚会'],
  学习成长: ['学', '教', '书', '课程', '培训', '考试', '文具', '教育'],
  医疗健康: ['医', '药', '保', '健', '诊', '体检', '护理'],
  工作投入: ['工', '办公', '设备', '软件', '差旅', '会议', '订阅']
};

function findIdentityCategory(categoryName: string, identityCategories: string[]): string | null {
  const normalized = normalizeBudgetCategoryName(categoryName);

  const exact = identityCategories.find((item) => normalizeBudgetCategoryName(item) === normalized);
  if (exact) {
    return exact;
  }

  for (const identity of identityCategories) {
    const keywords = IDENTITY_CATEGORY_KEYWORDS[identity] || [];
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return identity;
    }
  }

  return null;
}

/**
 * 把按身份生成的分类预算，映射到用户账本里真实的支出分类。
 * 这样推荐金额仍然来自身份权重，但分类名称始终和账本一致。
 */
export function syncRecommendationWithExpenseCategories(
  recommendation: BudgetRecommendation,
  categories: Array<{ name: string; kind?: 'income' | 'expense' }>
): BudgetRecommendation {
  const expenseCategoryNames = Array.from(
    new Map(
      categories
        .filter((item) => item.kind !== 'income')
        .map((item) => item.name.trim())
        .filter(Boolean)
        .map((name) => [normalizeBudgetCategoryName(name), name])
    ).values()
  );

  if (expenseCategoryNames.length === 0) {
    return recommendation;
  }

  const currentFlexibleNames = recommendation.categoryBudgets
    .filter((item) => !isCoreBudgetCategory(item.category))
    .map((item) => normalizeBudgetCategoryName(item.category));

  const namesMatch =
    currentFlexibleNames.length === expenseCategoryNames.length &&
    currentFlexibleNames.every(
      (name, index) => name === normalizeBudgetCategoryName(expenseCategoryNames[index])
    );

  const flexibleRowsSource = recommendation.categoryBudgets.filter(
    (item) => !isCoreBudgetCategory(item.category)
  );
  const hasZeroBudgetRow = flexibleRowsSource.some((item) => item.amount <= 0);

  // 分类已经对齐账本时，说明这是用户确认过的方案。
  // 除非旧算法留下了 0 额度的分类，否则保留用户手动调整过的金额，
  // 避免反复同步产生舍入漂移。
  const needsMigration =
    recommendation.distributionVersion !== BUDGET_DISTRIBUTION_VERSION && hasZeroBudgetRow;

  if (namesMatch && !needsMigration) {
    return recommendation;
  }

  const monthlyIncome = recommendation.monthlyIncome;
  const fixedAmount =
    recommendation.categoryBudgets.find((item) => item.category === CORE_BUDGET_CATEGORIES[0])
      ?.amount || 0;
  const savingsAmount =
    recommendation.categoryBudgets.find((item) => item.category === CORE_BUDGET_CATEGORIES[1])
      ?.amount || 0;

  const baseFlexibleBudget = Math.max(0, Math.round(recommendation.flexibleBudget));

  // 优先使用身份权重；旧方案没有权重时退回中性权重。
  const identityWeights = recommendation.flexibleWeights || {};
  // 匹配时用全部预设分类，避免某个身份没覆盖到分类时无法归类。
  const identityCategories = Object.keys(CANONICAL_IDENTITY_WEIGHTS);

  // 先确定每个账本分类对应到哪个身份分类。
  const matchedIdentity = expenseCategoryNames.map((name) =>
    findIdentityCategory(name, identityCategories)
  );

  // 同一个身份分类可能被多个账本分类命中（如「餐饮」和「餐饮外卖」），
  // 权重需要在这些分类之间平分。
  const identityHitCount = new Map<string, number>();
  matchedIdentity.forEach((identity) => {
    if (identity) {
      identityHitCount.set(identity, (identityHitCount.get(identity) || 0) + 1);
    }
  });

  const rawWeights = matchedIdentity.map((identity) => {
    if (!identity) {
      return 0;
    }
    const base = identityWeights[identity] ?? CANONICAL_IDENTITY_WEIGHTS[identity] ?? 0;
    return base / (identityHitCount.get(identity) || 1);
  });

  // 没有命中任何身份预设的分类，用命中分类的平均权重兜底，
  // 保证每个分类都拿得到额度，不会出现「预算为 0」的空卡片。
  const matchedWeightList = rawWeights.filter((weight) => weight > 0);
  const fallbackWeight =
    matchedWeightList.length > 0
      ? matchedWeightList.reduce((sum, weight) => sum + weight, 0) / matchedWeightList.length
      : 1 / Math.max(1, expenseCategoryNames.length);
  const weights = rawWeights.map((weight) => (weight > 0 ? weight : fallbackWeight));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  const flexibleRows = expenseCategoryNames.map((name, index) => ({
    category: name,
    amount: Math.round((baseFlexibleBudget * weights[index]) / weightTotal),
    ratio: 0
  }));

  const allocatedFlexibleBudget = flexibleRows.reduce((sum, item) => sum + item.amount, 0);
  const delta = baseFlexibleBudget - allocatedFlexibleBudget;
  if (flexibleRows.length > 0 && delta !== 0) {
    flexibleRows[0] = {
      ...flexibleRows[0],
      amount: Math.max(0, flexibleRows[0].amount + delta)
    };
  }

  const normalizedFlexibleBudget = flexibleRows.reduce((sum, item) => sum + item.amount, 0);

  const categoryBudgets = [
    { category: CORE_BUDGET_CATEGORIES[0], amount: fixedAmount, ratio: 0 },
    { category: CORE_BUDGET_CATEGORIES[1], amount: savingsAmount, ratio: 0 },
    ...flexibleRows
  ].map((item) => ({
    ...item,
    ratio: monthlyIncome > 0 ? item.amount / monthlyIncome : 0
  }));

  return {
    ...recommendation,
    monthlyFixedExpense: fixedAmount,
    savingsAmount,
    flexibleBudget: normalizedFlexibleBudget,
    disposableIncome: monthlyIncome - fixedAmount,
    distributionVersion: BUDGET_DISTRIBUTION_VERSION,
    categoryBudgets
  };
}

/**
 * 调整单个分类预算后，把差额按原比例分摊回其它灵活分类。
 * 这样总额始终等于月收入，向导里的“合计差额为 0”不再需要手工凑。
 */
export function applyBalancedCategoryEdit(
  recommendation: BudgetRecommendation,
  category: string,
  nextAmount: number
): BudgetRecommendation {
  const safeAmount = Number.isFinite(nextAmount) ? Math.max(0, Math.round(nextAmount)) : 0;
  const rows = recommendation.categoryBudgets.map((item) =>
    item.category === category ? { ...item, amount: safeAmount } : { ...item }
  );

  const target = rows.find((item) => item.category === category);
  if (!target) {
    return recommendation;
  }

  const totalBefore = rows.reduce((sum, item) => sum + item.amount, 0);
  const desiredTotal = recommendation.monthlyIncome;
  let delta = desiredTotal - totalBefore;
  if (delta === 0) {
    return withRecalculatedTotals(recommendation, rows);
  }

  // 差额分摊到其它灵活分类。
  // 编辑核心分类（固定支出/储蓄）时由全部灵活分类吸收差额，
  // 这样预算总额始终等于月收入。
  const others = rows.filter(
    (item) => !isCoreBudgetCategory(item.category) && item.category !== category
  );

  if (others.length === 0) {
    return withRecalculatedTotals(recommendation, rows);
  }

  const otherTotal = others.reduce((sum, item) => sum + item.amount, 0);

  if (otherTotal <= 0) {
    const first = others[0];
    if (first) {
      first.amount = Math.max(0, first.amount + delta);
      delta = desiredTotal - rows.reduce((sum, item) => sum + item.amount, 0);
    }
  } else {
    let distributed = 0;
    others.forEach((item, index) => {
      if (index === others.length - 1) {
        item.amount = Math.max(0, item.amount + (delta - distributed));
        return;
      }
      const share = Math.round((delta * item.amount) / otherTotal);
      item.amount = Math.max(0, item.amount + share);
      distributed += share;
    });
  }

  return withRecalculatedTotals(recommendation, rows);
}

function withRecalculatedTotals(
  recommendation: BudgetRecommendation,
  rows: BudgetRecommendation['categoryBudgets']
): BudgetRecommendation {
  const monthlyIncome = recommendation.monthlyIncome;
  const monthlyFixedExpense =
    rows.find((item) => item.category === CORE_BUDGET_CATEGORIES[0])?.amount || 0;
  const savingsAmount =
    rows.find((item) => item.category === CORE_BUDGET_CATEGORIES[1])?.amount || 0;
  const flexibleBudget = rows
    .filter((item) => !isCoreBudgetCategory(item.category))
    .reduce((sum, item) => sum + item.amount, 0);

  return {
    ...recommendation,
    monthlyFixedExpense,
    savingsAmount,
    flexibleBudget,
    disposableIncome: monthlyIncome - monthlyFixedExpense,
    distributionVersion: BUDGET_DISTRIBUTION_VERSION,
    categoryBudgets: rows.map((item) => ({
      ...item,
      ratio: monthlyIncome > 0 ? item.amount / monthlyIncome : 0
    }))
  };
}
