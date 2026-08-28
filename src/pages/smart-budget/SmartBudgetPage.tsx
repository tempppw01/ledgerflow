import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../../shared/lib/format';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { useAiSettings } from '../../shared/store/useAiSettings';
import {
  BudgetAnswers,
  BudgetRecommendation,
  UserIdentity,
  applyCategoryBudgetEdits,
  generateBudgetRecommendation,
  getIdentityLabel
} from '../../features/smart-budget/model/budgetPlanner';
import { useSmartBudgetStore } from '../../shared/store/useSmartBudgetStore';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import {
  buildBudgetTrackingRows,
  BudgetTrackingRow,
  getRecentMonthOptions
} from '../../features/smart-budget/model/budgetInsights';

const CORE_BUDGET_CATEGORIES = ['固定支出', '储蓄/投资'] as const;

function normalizeBudgetCategoryName(raw: string): string {
  return raw.trim().toLocaleLowerCase('zh-CN');
}

function buildBudgetSignature(recommendation: BudgetRecommendation): string {
  return recommendation.categoryBudgets
    .map((item) => `${normalizeBudgetCategoryName(item.category)}:${Math.round(item.amount)}`)
    .join('|');
}

function syncRecommendationWithExpenseCategories(
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

  const monthlyIncome = recommendation.monthlyIncome;
  const fixedAmount =
    recommendation.categoryBudgets.find((item) => item.category === CORE_BUDGET_CATEGORIES[0])
      ?.amount || 0;
  const savingsAmount =
    recommendation.categoryBudgets.find((item) => item.category === CORE_BUDGET_CATEGORIES[1])
      ?.amount || 0;

  const sourceFlexibleRows = recommendation.categoryBudgets.filter(
    (item) =>
      !CORE_BUDGET_CATEGORIES.includes(item.category as (typeof CORE_BUDGET_CATEGORIES)[number])
  );
  const sourceWeightMap = new Map(
    sourceFlexibleRows.map((item) => [
      normalizeBudgetCategoryName(item.category),
      Math.max(0, item.amount)
    ])
  );

  const rawWeights = expenseCategoryNames.map(
    (name) => sourceWeightMap.get(normalizeBudgetCategoryName(name)) || 0
  );
  const hasWeight = rawWeights.some((weight) => weight > 0);
  const weights = hasWeight ? rawWeights : expenseCategoryNames.map(() => 1);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  const baseFlexibleBudget = Math.max(0, Math.round(recommendation.flexibleBudget));
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
    categoryBudgets
  };
}

const identityOptions: Array<{ value: UserIdentity; label: string }> = [
  { value: 'student', label: '学生' },
  { value: 'employee', label: '上班族' },
  { value: 'freelancer', label: '自由职业者' },
  { value: 'other', label: '其他' }
];

const ratioQuickOptions = [0.2, 0.3, 0.4, 0.5];

const setupStepMeta = [
  {
    value: 1,
    short: '身份',
    title: '选择你的阶段'
  },
  {
    value: 2,
    short: '收入',
    title: '填写月收入'
  },
  {
    value: 3,
    short: '固定支出',
    title: '填写固定支出'
  },
  {
    value: 4,
    short: '储蓄比例',
    title: '设定想先留多少钱'
  },
  {
    value: 5,
    short: '确认',
    title: '检查并确认预算'
  }
] as const;

const initialAnswers: BudgetAnswers = {
  identity: 'employee',
  monthlyIncomeK: 10,
  monthlyFixedExpenseK: 3,
  savingsRatio: 0.3
};

function extractFirstJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  throw new Error('AI 返回内容不是有效 JSON');
}

const COMMON_CATEGORY_PRESETS = [
  '餐饮',
  '衣物穿搭',
  '住房',
  '水电燃气',
  '交通',
  '购物日用',
  '通讯网络',
  '医疗健康',
  '教育学习',
  '娱乐社交',
  '旅行',
  '人情往来',
  '工资',
  '奖金',
  '理财收益',
  '退款返现',
  '保险',
  '税费',
  '还款',
  '其他'
];

type BudgetActionLog = {
  id: string;
  createdAt: string;
  type: 'apply-next-month' | 'set-month-reminder';
  category: string;
  delta: number;
  message: string;
};

export function SmartBudgetPage() {
  const confirmedPlan = useSmartBudgetStore((s) => s.confirmedPlan);
  const confirmPlan = useSmartBudgetStore((s) => s.confirmPlan);
  const clearPlan = useSmartBudgetStore((s) => s.clearPlan);

  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const addCategory = useFinanceStore((s) => s.addCategory);

  const { baseUrl, apiKey, model } = useAiSettings();
  const hasAiConfig = Boolean(baseUrl.trim()) && Boolean(apiKey.trim()) && Boolean(model.trim());

  const [mode, setMode] = useState<'setup' | 'management'>(() =>
    confirmedPlan ? 'management' : 'setup'
  );
  const [setupOpen, setSetupOpen] = useState(() => !confirmedPlan);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'overspent' | 'safe'>('all');
  const [answers, setAnswers] = useState<BudgetAnswers>(initialAnswers);
  const [draftRecommendation, setDraftRecommendation] = useState<BudgetRecommendation | null>(null);
  const [draftTotalDelta, setDraftTotalDelta] = useState(0);
  const [selectedMonthKey, setSelectedMonthKey] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BudgetTrackingRow | null>(null);

  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [aiAdvice, setAiAdvice] = useState<null | {
    summary: string;
    suggestions: string[];
    focusCategories?: Array<{
      category: string;
      action: 'increase' | 'decrease' | 'keep';
      reason: string;
    }>;
  }>(null);
  const [actionLogs, setActionLogs] = useState<BudgetActionLog[]>([]);
  const [actionFeedback, setActionFeedback] = useState('');
  const [budgetListExpanded, setBudgetListExpanded] = useState(false);

  const monthOptions = useMemo(() => getRecentMonthOptions(transactions), [transactions]);

  const activeMonthKey = selectedMonthKey || monthOptions[0]?.key || '';

  const linkedRecommendation = useMemo(() => {
    if (!confirmedPlan) {
      return null;
    }

    return syncRecommendationWithExpenseCategories(confirmedPlan.recommendation, categories);
  }, [confirmedPlan, categories]);

  const trackingRows = useMemo(() => {
    if (!linkedRecommendation || !activeMonthKey) {
      return [];
    }

    return buildBudgetTrackingRows({
      recommendation: linkedRecommendation,
      transactions,
      categories,
      monthKey: activeMonthKey
    });
  }, [linkedRecommendation, transactions, categories, activeMonthKey]);

  const visibleRows = useMemo(() => {
    if (statusFilter === 'overspent') {
      return trackingRows.filter((item) => item.isOverspent);
    }
    if (statusFilter === 'safe') {
      return trackingRows.filter((item) => !item.isOverspent);
    }
    return trackingRows;
  }, [statusFilter, trackingRows]);

  const collapsedVisibleRows = useMemo(
    () => (budgetListExpanded ? visibleRows : visibleRows.slice(0, 8)),
    [budgetListExpanded, visibleRows]
  );

  const overspentCount = trackingRows.filter((item) => item.isOverspent).length;

  const monthTransactions = useMemo(() => {
    return transactions.filter((item) => {
      const date = new Date(item.date);
      return (
        !Number.isNaN(date.getTime()) &&
        activeMonthKey === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      );
    });
  }, [transactions, activeMonthKey]);

  const managementOverview = useMemo(() => {
    const totalBudget = trackingRows.reduce((sum, item) => sum + item.budgetAmount, 0);
    const totalSpent = trackingRows.reduce((sum, item) => sum + item.spentAmount, 0);
    const remainingAmount = totalBudget - totalSpent;
    const executionRate = totalBudget > 0 ? totalSpent / totalBudget : 0;

    const monthIncome = monthTransactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const monthExpense = monthTransactions
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const overspendPenalty = Math.min(overspentCount * 12, 40);
    const executionPenalty = Math.min(Math.abs(executionRate - 1) * 100 * 0.35, 35);
    const balanceRatio = monthExpense > 0 ? Math.min(monthIncome / monthExpense, 1) : 1;
    const balancePenalty = Math.min((1 - balanceRatio) * 25, 25);

    const healthScore = Math.max(
      0,
      Math.round(100 - overspendPenalty - executionPenalty - balancePenalty)
    );

    return {
      totalBudget,
      totalSpent,
      remainingAmount,
      executionRate,
      healthScore
    };
  }, [trackingRows, monthTransactions, overspentCount]);

  const healthExplainText = useMemo(() => {
    const executionPercent = managementOverview.executionRate * 100;
    if (executionPercent < 80) return '执行率低于 80%，预算较宽裕，可将结余优先转入储蓄或应急金。';
    if (executionPercent <= 100) return '执行率在 80%~100% 区间，预算使用健康，建议保持当前节奏。';
    return '执行率高于 100%，说明已超支，请优先压降非必要支出或调高重点分类预算。';
  }, [managementOverview.executionRate]);

  const categoryTrendRows = useMemo(() => {
    if (!linkedRecommendation) return [];

    const recentKeys = getRecentMonthOptions(transactions, 6)
      .map((item) => item.key)
      .reverse();
    const monthLabelMap = new Map(
      getRecentMonthOptions(transactions, 6).map((item) => [item.key, item.label])
    );

    const trackedCategories = linkedRecommendation.categoryBudgets
      .filter(
        (item) =>
          !CORE_BUDGET_CATEGORIES.includes(item.category as (typeof CORE_BUDGET_CATEGORIES)[number])
      )
      .slice(0, 6);

    const monthRows = recentKeys.map((key) => ({
      key,
      rows: buildBudgetTrackingRows({
        recommendation: linkedRecommendation,
        categories,
        transactions,
        monthKey: key
      })
    }));

    return trackedCategories.map((budget) => ({
      category: budget.category,
      points: monthRows.map((month) => {
        const row = month.rows.find((item) => item.category === budget.category);
        return {
          monthKey: month.key,
          monthLabel: monthLabelMap.get(month.key) || month.key,
          ratio: row?.ratio || 0
        };
      })
    }));
  }, [linkedRecommendation, transactions, categories]);

  const anomalyAlerts = useMemo(() => {
    if (!activeMonthKey || !trackingRows.length) return [];
    const [yearStr, monthStr] = activeMonthKey.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return [];

    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
    const dayPassed = isCurrentMonth
      ? Math.max(now.getDate(), 1)
      : new Date(year, month, 0).getDate();
    const totalDays = new Date(year, month, 0).getDate();

    return trackingRows
      .map((item) => {
        const projectedSpent =
          dayPassed > 0 ? (item.spentAmount / dayPassed) * totalDays : item.spentAmount;
        const riskRatio = item.budgetAmount > 0 ? projectedSpent / item.budgetAmount : 0;
        const suggestedSaving = Math.max(projectedSpent - item.budgetAmount, 0);
        if (riskRatio <= 1) return null;
        return {
          ...item,
          projectedSpent,
          riskRatio,
          suggestedSaving
        };
      })
      .filter(
        (
          item
        ): item is BudgetTrackingRow & {
          projectedSpent: number;
          riskRatio: number;
          suggestedSaving: number;
        } => Boolean(item)
      )
      .sort((a, b) => b.riskRatio - a.riskRatio);
  }, [activeMonthKey, trackingRows]);

  const topOverspentItem = useMemo(
    () =>
      trackingRows.filter((item) => item.ratio > 1).sort((a, b) => b.ratio - a.ratio)[0] || null,
    [trackingRows]
  );

  const summaryChips = useMemo(
    () => [
      { label: '身份', value: getIdentityLabel(answers.identity) },
      { label: '收入', value: `${answers.monthlyIncomeK} 千` },
      { label: '固定', value: `${answers.monthlyFixedExpenseK} 千` },
      { label: '储蓄', value: `${Math.round(answers.savingsRatio * 100)}%` }
    ],
    [answers]
  );

  const currentStepMeta = setupStepMeta.find((item) => item.value === step) || setupStepMeta[0];
  const incomePreview = useMemo(
    () => formatCurrency(Math.max(0, answers.monthlyIncomeK) * 1000),
    [answers.monthlyIncomeK]
  );
  const fixedExpensePreview = useMemo(
    () => formatCurrency(Math.max(0, answers.monthlyFixedExpenseK) * 1000),
    [answers.monthlyFixedExpenseK]
  );
  const savingsPreview = useMemo(() => {
    const monthlyIncome = Math.max(0, answers.monthlyIncomeK) * 1000;
    const fixedExpense = Math.max(0, answers.monthlyFixedExpenseK) * 1000;
    const disposableIncome = Math.max(0, monthlyIncome - fixedExpense);
    return {
      disposableIncome,
      savingsAmount: disposableIncome * answers.savingsRatio
    };
  }, [answers.monthlyIncomeK, answers.monthlyFixedExpenseK, answers.savingsRatio]);

  useEffect(() => {
    if (!confirmedPlan) {
      setMode('setup');
      setSetupOpen(true);
      return;
    }
    setMode('management');
    setSetupOpen(false);
  }, [confirmedPlan]);

  useEffect(() => {
    if (transactions.length > 0) return;
    const existing = new Set(categories.map((item) => item.name.trim().toLocaleLowerCase('zh-CN')));
    COMMON_CATEGORY_PRESETS.forEach((name) => {
      if (!existing.has(name.toLocaleLowerCase('zh-CN'))) {
        addCategory(name);
      }
    });
  }, [transactions.length, categories, addCategory]);

  useEffect(() => {
    if (!confirmedPlan) {
      return;
    }

    const synced = syncRecommendationWithExpenseCategories(
      confirmedPlan.recommendation,
      categories
    );
    if (buildBudgetSignature(synced) === buildBudgetSignature(confirmedPlan.recommendation)) {
      return;
    }

    confirmPlan({ answers: confirmedPlan.answers, recommendation: synced });
  }, [confirmedPlan, categories, confirmPlan]);

  useEffect(() => {
    if (!confirmedPlan || !linkedRecommendation || !activeMonthKey || trackingRows.length === 0) {
      setAiStatus('idle');
      setAiError('');
      setAiAdvice(null);
      return;
    }

    if (!hasAiConfig) {
      setAiStatus('error');
      setAiError('未配置 AI 模型，请先在设置页完成模型地址、密钥与模型名称。');
      setAiAdvice(null);
      return;
    }

    let canceled = false;
    setAiStatus('loading');
    setAiError('');

    void (async () => {
      try {
        const response = await sendAiChat({
          baseUrl,
          apiKey,
          model,
          systemPrompt:
            '你是预算优化助手。仅输出 JSON：{"summary":"一句话总结","suggestions":["建议1","建议2"],"focusCategories":[{"category":"分类名","action":"increase|decrease|keep","reason":"原因"}] }。focusCategories 最多 6 项。',
          messages: [
            {
              role: 'user',
              text: `请基于以下预算执行数据给出可执行建议：\n${JSON.stringify(
                {
                  monthKey: activeMonthKey,
                  profile: {
                    identity: getIdentityLabel(confirmedPlan.answers.identity),
                    income: linkedRecommendation.monthlyIncome,
                    fixedExpense: linkedRecommendation.monthlyFixedExpense,
                    savingsAmount: linkedRecommendation.savingsAmount
                  },
                  availableCategories: categories.map((item) => item.name),
                  rows: trackingRows.map((item) => ({
                    category: item.category,
                    budgetAmount: item.budgetAmount,
                    spentAmount: item.spentAmount,
                    ratio: Number(item.ratio.toFixed(3)),
                    overspent: item.isOverspent
                  }))
                },
                null,
                2
              )}`
            }
          ]
        });

        if (canceled) return;

        const parsed = JSON.parse(extractFirstJsonObject(response.content)) as {
          summary?: unknown;
          suggestions?: unknown;
          focusCategories?: unknown;
        };

        const suggestions = Array.isArray(parsed.suggestions)
          ? parsed.suggestions
              .map((item) => String(item))
              .filter(Boolean)
              .slice(0, 6)
          : [];
        const focusCategories = Array.isArray(parsed.focusCategories)
          ? parsed.focusCategories
              .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const row = item as { category?: unknown; action?: unknown; reason?: unknown };
                const action =
                  row.action === 'increase' || row.action === 'decrease' || row.action === 'keep'
                    ? row.action
                    : 'keep';
                return {
                  category: String(row.category || ''),
                  action,
                  reason: String(row.reason || '')
                };
              })
              .filter(
                (
                  item
                ): item is {
                  category: string;
                  action: 'increase' | 'decrease' | 'keep';
                  reason: string;
                } => Boolean(item?.category)
              )
              .slice(0, 6)
          : [];

        setAiAdvice({
          summary: String(parsed.summary || '预算执行总体平稳，可持续跟踪超支项。'),
          suggestions,
          focusCategories
        });
        setAiStatus('done');
      } catch (err) {
        if (canceled) return;
        setAiStatus('error');
        setAiAdvice(null);
        setAiError(err instanceof Error ? err.message : 'AI 建议生成失败');
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    confirmedPlan,
    linkedRecommendation,
    activeMonthKey,
    trackingRows,
    hasAiConfig,
    baseUrl,
    apiKey,
    model,
    categories
  ]);

  useEffect(() => {
    if (!draftRecommendation) {
      setDraftTotalDelta(0);
      return;
    }

    const total = draftRecommendation.categoryBudgets.reduce((sum, item) => sum + item.amount, 0);
    setDraftTotalDelta(total - draftRecommendation.monthlyIncome);
  }, [draftRecommendation]);

  const handleDraftCategoryAmountChange = (category: string, amount: number) => {
    if (!draftRecommendation) return;

    const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    const nextRecommendation = applyCategoryBudgetEdits(draftRecommendation, {
      [category]: safeAmount
    });
    setDraftRecommendation(nextRecommendation);
  };

  const goNext = () => {
    setError(null);

    if (step === 2 && answers.monthlyIncomeK <= 0) {
      setError('每月收入必须大于 0。');
      return;
    }

    if (step === 3) {
      if (answers.monthlyFixedExpenseK < 0) {
        setError('固定支出不能为负数。');
        return;
      }
      if (answers.monthlyFixedExpenseK >= answers.monthlyIncomeK) {
        setError('固定支出必须小于每月收入。');
        return;
      }
    }

    if (step === 4) {
      try {
        const result = generateBudgetRecommendation(answers);
        const synced = syncRecommendationWithExpenseCategories(result, categories);
        setDraftRecommendation(synced);
      } catch (validationError) {
        setError(validationError instanceof Error ? validationError.message : '预算生成失败。');
        return;
      }
    }

    setStep((current) => Math.min(current + 1, 5));
  };

  const goPrev = () => {
    setError(null);
    setStep((current) => Math.max(current - 1, 1));
  };

  const handleConfirm = () => {
    if (!draftRecommendation) {
      return;
    }

    if (draftTotalDelta !== 0) {
      setError(`分类预算合计需与月收入一致（当前差额 ${formatCurrency(draftTotalDelta)}）。`);
      return;
    }

    const syncedDraft = syncRecommendationWithExpenseCategories(draftRecommendation, categories);
    confirmPlan({ answers, recommendation: syncedDraft });
    setSetupOpen(false);
    setMode('management');
  };

  const executeApplyToNextMonth = useCallback(() => {
    if (!confirmedPlan || !topOverspentItem) {
      return;
    }

    const nextAmount = Math.round(topOverspentItem.budgetAmount + topOverspentItem.diff * 0.5);
    const baseRecommendation = linkedRecommendation || confirmedPlan.recommendation;
    const nextRecommendation = syncRecommendationWithExpenseCategories(
      applyCategoryBudgetEdits(baseRecommendation, {
        [topOverspentItem.category]: Math.max(0, nextAmount)
      }),
      categories
    );

    confirmPlan({ answers: confirmedPlan.answers, recommendation: nextRecommendation });

    const message = `已将「${topOverspentItem.category}」下月预算调整为 ${formatCurrency(
      Math.max(0, nextAmount)
    )}`;
    setActionFeedback(message);
    setActionLogs((prev): BudgetActionLog[] => {
      const nextItem: BudgetActionLog = {
        id: `${Date.now()}-apply-${topOverspentItem.category}`,
        createdAt: new Date().toISOString(),
        type: 'apply-next-month',
        category: topOverspentItem.category,
        delta: Math.max(0, nextAmount - topOverspentItem.budgetAmount),
        message
      };
      return [nextItem, ...prev].slice(0, 12);
    });
  }, [confirmPlan, confirmedPlan, topOverspentItem, linkedRecommendation, categories]);

  const executeSetMonthReminder = useCallback(() => {
    if (!topOverspentItem) {
      return;
    }

    const message = `已为「${topOverspentItem.category}」设置本月超支提醒，建议至少压降 ${formatCurrency(
      topOverspentItem.diff
    )}`;
    setActionFeedback(message);
    setActionLogs((prev): BudgetActionLog[] => {
      const nextItem: BudgetActionLog = {
        id: `${Date.now()}-reminder-${topOverspentItem.category}`,
        createdAt: new Date().toISOString(),
        type: 'set-month-reminder',
        category: topOverspentItem.category,
        delta: -Math.abs(topOverspentItem.diff),
        message
      };
      return [nextItem, ...prev].slice(0, 12);
    });
  }, [topOverspentItem]);

  const progressPercent = (ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return 0;
    }
    return Math.min(Math.round(ratio * 100), 160);
  };

  return (
    <section className="panel smart-budget-page finance-page vi-page">
      <header className="smart-budget-header">
        <div>
          <div className="smart-budget-title-row">
            <h2>智能预算</h2>
            {confirmedPlan ? (
              <span className="smart-budget-header-badge">已确认预算方案</span>
            ) : (
              <span className="smart-budget-header-badge is-draft">预算向导进行中</span>
            )}
          </div>
          <p>先回答几个小问题，我会帮你整理出一版更适合当前生活的月度预算。</p>
        </div>
      </header>

      {confirmedPlan ? (
        <div className="smart-budget-mode-switch" aria-label="智能预算模式">
          <button
            type="button"
            className={mode === 'setup' ? 'active' : ''}
            onClick={() => {
              setMode('setup');
              setSetupOpen(true);
            }}
          >
            预算设置
          </button>
          <button
            type="button"
            className={mode === 'management' ? 'active' : ''}
            onClick={() => {
              setMode('management');
              setSetupOpen(false);
            }}
          >
            智能预算管理
          </button>
        </div>
      ) : null}

      {mode === 'management' ? (
        confirmedPlan ? (
          <section className="smart-budget-management design-workspace" aria-label="智能预算管理看板">
            <section
              className="smart-budget-overview-card design-section"
              aria-label="预算总览"
            >
              <div className="smart-budget-overview-stats">
                <article className="design-stat">
                  <span>本月可花总额</span>
                  <strong>{formatCurrency(managementOverview.totalBudget)}</strong>
                </article>
                <article className="design-stat">
                  <span>已经用掉</span>
                  <strong>{formatCurrency(managementOverview.totalSpent)}</strong>
                </article>
                <article className="design-stat">
                  <span>还剩下多少</span>
                  <strong
                    className={managementOverview.remainingAmount >= 0 ? 'positive' : 'negative'}
                  >
                    {formatCurrency(managementOverview.remainingAmount)}
                  </strong>
                </article>
                <article className="design-stat">
                  <span>花销节奏</span>
                  <strong className={managementOverview.executionRate > 1 ? 'negative' : ''}>
                    {(managementOverview.executionRate * 100).toFixed(1)}%
                  </strong>
                </article>
              </div>
              <div className="smart-budget-overview-progress-wrap">
                <div
                  className="smart-budget-overview-progress"
                  style={{
                    background: `conic-gradient(var(--color-primary) ${Math.min(managementOverview.executionRate * 100, 100)}%, var(--color-border-light) 0)`
                  }}
                  title={`执行率 ${(managementOverview.executionRate * 100).toFixed(1)}%`}
                  aria-label={`预算执行率 ${(managementOverview.executionRate * 100).toFixed(1)}%`}
                >
                  <span>{Math.round(managementOverview.executionRate * 100)}%</span>
                </div>
                <p className="smart-budget-health-score">
                  预算健康度 <strong>{managementOverview.healthScore}</strong> / 100
                </p>
                <p className="smart-budget-health-explain">
                  {healthExplainText}（小于 80% 比较宽裕，80%~100% 刚刚好，超过 100% 要注意超支）
                </p>
              </div>
            </section>

            <div className="smart-budget-management-topbar design-toolbar">
              <div className="field">
                <label htmlFor="budget-month">最近月份</label>
                <select
                  id="budget-month"
                  value={activeMonthKey}
                  onChange={(event) => setSelectedMonthKey(event.target.value)}
                >
                  {monthOptions.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="smart-budget-filter-group" role="group" aria-label="预算状态过滤">
                <button
                  type="button"
                  className={statusFilter === 'all' ? 'active' : ''}
                  onClick={() => setStatusFilter('all')}
                >
                  全部 {trackingRows.length}
                </button>
                <button
                  type="button"
                  className={statusFilter === 'overspent' ? 'active' : ''}
                  onClick={() => setStatusFilter('overspent')}
                >
                  已超支 {overspentCount}
                </button>
                <button
                  type="button"
                  className={statusFilter === 'safe' ? 'active' : ''}
                  onClick={() => setStatusFilter('safe')}
                >
                  正常 {trackingRows.length - overspentCount}
                </button>
              </div>
            </div>

            <section className="smart-budget-ai-card design-section" aria-live="polite">
              <div className="smart-budget-ai-card-title">
                <span className="smart-budget-ai-icon" aria-hidden="true">
                  🤖
                </span>
                <h4>AI 预算观察</h4>
              </div>
              {aiStatus === 'loading' ? (
                <p className="smart-budget-empty">正在帮你看哪几类支出最需要留意...</p>
              ) : null}
              {aiStatus === 'error' ? <p className="smart-budget-error">{aiError}</p> : null}
              {topOverspentItem ? (
                <div className="smart-budget-ai-highlight">
                  <p>
                    <strong>⚠ {topOverspentItem.category}</strong> 超支
                    <strong> {(topOverspentItem.ratio * 100).toFixed(0)}%</strong>
                  </p>
                  <p>
                    下个月可以先把预算调成{' '}
                    <strong>
                      {formatCurrency(topOverspentItem.budgetAmount + topOverspentItem.diff * 0.5)}
                    </strong>
                  </p>
                  <p>
                    或者这个月先少花 <strong>{formatCurrency(topOverspentItem.diff)}</strong>
                  </p>
                  <div className="smart-budget-ai-actions">
                    <button type="button" onClick={executeApplyToNextMonth}>
                      调优下月预算
                    </button>
                    <button type="button" onClick={executeSetMonthReminder}>
                      这个月提醒我
                    </button>
                  </div>
                </div>
              ) : null}
              {aiStatus === 'done' && aiAdvice ? (
                <>
                  <p className="smart-budget-ai-summary">{aiAdvice.summary}</p>
                  {aiAdvice.suggestions.length ? (
                    <ul className="smart-budget-ai-list">
                      {aiAdvice.suggestions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  {aiAdvice.focusCategories?.length ? (
                    <div className="smart-budget-ai-tags">
                      {aiAdvice.focusCategories.map((item) => (
                        <span
                          key={`${item.category}-${item.action}`}
                          className={`ai-tag ${item.action}`}
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

            {categoryTrendRows.length ? (
              <section
                className="smart-budget-trend-card design-section"
                aria-label="预算执行趋势"
              >
                <h4>最近几个月，钱主要花在哪里</h4>
                <div className="smart-budget-trend-grid">
                  {categoryTrendRows.map((row) => (
                    <article key={row.category} className="smart-budget-trend-item">
                      <header>
                        <strong>{row.category}</strong>
                        <span>
                          {(row.points[row.points.length - 1]?.ratio * 100 || 0).toFixed(0)}%
                        </span>
                      </header>
                      <div className="smart-budget-trend-bars">
                        {row.points.map((point) => (
                          <div
                            key={`${row.category}-${point.monthKey}`}
                            title={`${point.monthLabel}：${(point.ratio * 100).toFixed(1)}%`}
                          >
                            <span style={{ height: `${Math.min(point.ratio * 100, 92)}%` }} />
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {anomalyAlerts.length ? (
              <section
                className="smart-budget-anomaly-card design-section"
                aria-label="异常提醒"
              >
                <h4>异常提醒与调整建议</h4>
                <ul>
                  {anomalyAlerts.slice(0, 4).map((item) => (
                    <li key={item.category}>
                      <strong>{item.category}</strong> 预计月末支出{' '}
                      {formatCurrency(item.projectedSpent)}， 约为预算的{' '}
                      {(item.riskRatio * 100).toFixed(0)}%。建议优先减少非必要消费
                      {formatCurrency(item.suggestedSaving)}，或将该分类预算上调到
                      {formatCurrency(item.projectedSpent)}。
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {actionFeedback ? (
              <p className="smart-budget-ai-summary" aria-live="polite">
                {actionFeedback}
              </p>
            ) : null}

            {actionLogs.length ? (
              <section
                className="smart-budget-anomaly-card design-section"
                aria-label="建议动作执行记录"
              >
                <h4>建议动作执行记录</h4>
                <ul>
                  {actionLogs.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <strong>{item.category}</strong> ·
                      {item.type === 'apply-next-month' ? ' 已应用到下月预算' : ' 已设为本月提醒'} ·
                      影响金额 {formatCurrency(item.delta)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {visibleRows.length ? (
              <>
                <div className="smart-budget-list-toolbar">
                  <span className="muted">
                    已显示 {collapsedVisibleRows.length} / {visibleRows.length} 个预算分类
                  </span>
                  {visibleRows.length > 8 ? (
                    <button type="button" onClick={() => setBudgetListExpanded((prev) => !prev)}>
                      {budgetListExpanded ? '收起分类' : '展开全部分类'}
                    </button>
                  ) : null}
                </div>
                <div className="smart-budget-progress-list design-item-grid">
                  {collapsedVisibleRows.map((item) => (
                    <article
                      key={item.category}
                      className={`smart-budget-progress-card ${
                        item.ratio > 1 ? 'overspent' : item.ratio >= 0.7 ? 'warning' : 'normal'
                      }`}
                      onClick={() => setSelectedCategory(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedCategory(item);
                        }
                      }}
                    >
                      <header>
                        <h4>{item.category}</h4>
                        <span
                          className={`status-tag ${item.ratio > 1 ? 'overspent' : item.ratio >= 0.7 ? 'warning' : 'normal'}`}
                        >
                          {item.ratio > 1 ? '超支' : item.ratio >= 0.7 ? '预警' : '正常'}
                        </span>
                      </header>
                      <p>
                        <strong>{formatCurrency(item.spentAmount)}</strong> / 预算{' '}
                        <strong>{formatCurrency(item.budgetAmount)}</strong>
                      </p>
                      <p>
                        剩余金额：
                        <strong className={item.diff <= 0 ? 'safe' : 'warn'}>
                          {formatCurrency(-item.diff)}
                        </strong>
                      </p>
                      <p>执行率：{(item.ratio * 100).toFixed(1)}%</p>
                      <div
                        className="smart-budget-progress-track"
                        title={`执行率 ${(item.ratio * 100).toFixed(1)}%`}
                        aria-label={`执行率 ${(item.ratio * 100).toFixed(1)}%`}
                      >
                        <span
                          className={item.isOverspent ? 'warn' : ''}
                          style={{ width: `${progressPercent(item.ratio)}%` }}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="smart-budget-empty">当前筛选条件下暂无预算项，请切换月份或筛选条件。</p>
            )}
          </section>
        ) : (
          <p className="smart-budget-empty">请先完成预算设置并确认后，再查看智能预算管理。</p>
        )
      ) : null}

      {selectedCategory ? (
        <aside className="smart-budget-detail-drawer" aria-label="预算分类详情">
          <div className="smart-budget-detail-drawer-content">
            <header>
              <h3>{selectedCategory.category}</h3>
              <button type="button" onClick={() => setSelectedCategory(null)}>
                关闭
              </button>
            </header>
            <p>
              已花费 {formatCurrency(selectedCategory.spentAmount)} / 预算{' '}
              {formatCurrency(selectedCategory.budgetAmount)}
            </p>
            <p>执行率 {(selectedCategory.ratio * 100).toFixed(1)}%</p>
            <p>差额 {formatCurrency(selectedCategory.diff)}</p>
          </div>
        </aside>
      ) : null}

      {mode === 'setup' && setupOpen ? (
        <>
          <section
            className="smart-budget-step-intro design-section"
            aria-label="当前预算步骤说明"
          >
            <div>
              <span className="smart-budget-setup-kicker">
                第 {step} / {setupStepMeta.length} 步
              </span>
              <h3>{currentStepMeta.title}</h3>
            </div>
            <div className="smart-budget-step-intro-tip">
              {summaryChips.map((item) => (
                <span key={item.label}>
                  {item.label}
                  <strong>{item.value}</strong>
                </span>
              ))}
            </div>
          </section>

          <div className="smart-budget-stepper" aria-label="预算问答步骤">
            {setupStepMeta.map((item) => (
              <span
                key={item.value}
                className={item.value === step ? 'active' : item.value < step ? 'done' : ''}
                aria-current={item.value === step ? 'step' : undefined}
              >
                {item.short}
              </span>
            ))}
          </div>

          {step === 1 ? (
            <div className="smart-budget-block design-section">
              <h3>你目前的身份是？</h3>
              <div className="smart-budget-choice-grid">
                {identityOptions.map((item) => (
                  <label key={item.value} className="smart-budget-choice-card">
                    <input
                      type="radio"
                      name="identity"
                      value={item.value}
                      checked={answers.identity === item.value}
                      onChange={() => setAnswers((prev) => ({ ...prev, identity: item.value }))}
                    />
                    <strong>{item.label}</strong>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="smart-budget-block design-section">
              <h3>每月大概到手多少？</h3>
              <div className="field">
                <label htmlFor="income-k">当前换算：{incomePreview}</label>
                <input
                  id="income-k"
                  type="number"
                  min={1}
                  step={1}
                  value={answers.monthlyIncomeK}
                  onChange={(event) =>
                    setAnswers((prev) => ({ ...prev, monthlyIncomeK: Number(event.target.value) }))
                  }
                />
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="smart-budget-block design-section">
              <h3>每月固定支出多少？</h3>
              <div className="field">
                <label htmlFor="fixed-expense-k">当前换算：{fixedExpensePreview}</label>
                <input
                  id="fixed-expense-k"
                  type="number"
                  min={0}
                  step={0.5}
                  value={answers.monthlyFixedExpenseK}
                  onChange={(event) =>
                    setAnswers((prev) => ({
                      ...prev,
                      monthlyFixedExpenseK: Number(event.target.value)
                    }))
                  }
                />
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="smart-budget-block design-section">
              <h3>想先存下多少？</h3>
              <div className="smart-budget-preview-chips">
                <span>可支配 {formatCurrency(savingsPreview.disposableIncome)}</span>
                <span>留存 {formatCurrency(savingsPreview.savingsAmount)}</span>
              </div>

              <div className="smart-budget-ratio-options">
                {ratioQuickOptions.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={answers.savingsRatio === ratio ? 'active' : ''}
                    onClick={() => setAnswers((prev) => ({ ...prev, savingsRatio: ratio }))}
                  >
                    {Math.round(ratio * 100)}%
                  </button>
                ))}
              </div>

              <div className="field">
                <label htmlFor="savings-ratio-range">
                  当前比例：{Math.round(answers.savingsRatio * 100)}%
                </label>
                <input
                  id="savings-ratio-range"
                  type="range"
                  min={10}
                  max={60}
                  step={1}
                  value={Math.round(answers.savingsRatio * 100)}
                  onChange={(event) =>
                    setAnswers((prev) => ({
                      ...prev,
                      savingsRatio: Number(event.target.value) / 100
                    }))
                  }
                />
              </div>
            </div>
          ) : null}

          {step === 5 && draftRecommendation ? (
            <div className="smart-budget-block design-section">
              <h3>看看这份预算合不合适</h3>
              <p>没问题的话，确认后就能进入可跟踪的执行看板。</p>
              <div className="smart-budget-result-grid">
                <article className="smart-budget-stat-card">
                  <span>每个月到手</span>
                  <strong>{formatCurrency(draftRecommendation.monthlyIncome)}</strong>
                </article>
                <article className="smart-budget-stat-card">
                  <span>固定账单</span>
                  <strong>{formatCurrency(draftRecommendation.monthlyFixedExpense)}</strong>
                </article>
                <article className="smart-budget-stat-card">
                  <span>先存起来</span>
                  <strong>{formatCurrency(draftRecommendation.savingsAmount)}</strong>
                </article>
                <article className="smart-budget-stat-card">
                  <span>日常可灵活使用</span>
                  <strong>{formatCurrency(draftRecommendation.flexibleBudget)}</strong>
                </article>
              </div>

              <div className="table-wrap">
                <table className="table smart-budget-table">
                  <thead>
                    <tr>
                      <th>分类</th>
                      <th>金额</th>
                      <th>占收入比例</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftRecommendation.categoryBudgets.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td>
                          <input
                            aria-label={`${row.category}预算金额`}
                            type="number"
                            min={0}
                            step={100}
                            value={row.amount}
                            onChange={(event) =>
                              handleDraftCategoryAmountChange(
                                row.category,
                                Number(event.target.value)
                              )
                            }
                          />
                        </td>
                        <td>{(row.ratio * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p
                className={`smart-budget-delta ${draftTotalDelta === 0 ? 'balanced' : 'unbalanced'}`}
              >
                分类预算合计差额：{formatCurrency(draftTotalDelta)}（需为 0 才能确认）
              </p>

              <div className="smart-budget-actions">
                <button type="button" className="primary" onClick={handleConfirm}>
                  就用这份预算
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftRecommendation(null);
                    setStep(1);
                    setError(null);
                  }}
                >
                  重新答一遍
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="smart-budget-error">{error}</p> : null}

          <footer className="smart-budget-footer">
            <button type="button" onClick={goPrev} disabled={step === 1}>
              上一步
            </button>
            <button type="button" className="primary" onClick={goNext} disabled={step >= 5}>
              {step === 4 ? '生成预算推荐' : '下一步'}
            </button>
          </footer>

          {confirmedPlan ? (
            <section className="smart-budget-confirmed panel">
              <h3>已确认预算</h3>
              <p>
                最近确认时间：
                {new Date(confirmedPlan.confirmedAt).toLocaleString('zh-CN', { hour12: false })}
              </p>
              <p>
                身份：{getIdentityLabel(confirmedPlan.answers.identity)}，储蓄比例：
                {Math.round(confirmedPlan.answers.savingsRatio * 100)}%
              </p>
              <button
                type="button"
                onClick={() => {
                  clearPlan();
                  setSetupOpen(true);
                  setMode('setup');
                  setAiStatus('idle');
                  setAiAdvice(null);
                  setAiError('');
                }}
              >
                清除已确认预算
              </button>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
