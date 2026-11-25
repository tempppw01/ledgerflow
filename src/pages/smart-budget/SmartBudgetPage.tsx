import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency, formatDateTime } from '../../shared/lib/format';
import { useTFallback } from '../../shared/lib/useTFallback';
import { filterCountableTransactions, summarizeTransactions } from '../../shared/lib/transactionMetrics';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { useAiSettings } from '../../shared/store/useAiSettings';
import {
  BudgetAnswers,
  BudgetRecommendation,
  generateBudgetRecommendation,
  getIdentityLabel,
  normalizeBudgetAnswers
} from '../../features/smart-budget/model/budgetPlanner';
import {
  applyBalancedCategoryEdit,
  buildBudgetSignature,
  syncRecommendationWithExpenseCategories
} from '../../features/smart-budget/model/budgetPlan';
import { useSmartBudgetStore } from '../../shared/store/useSmartBudgetStore';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { buildWizardDefaultAnswers } from '../../features/smart-budget/model/wizardDefaults';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import {
  buildBudgetTrackingRows,
  BudgetTrackingRow,
  getRecentMonthOptions
} from '../../features/smart-budget/model/budgetInsights';
import { buildBudgetOverview } from '../../features/smart-budget/model/budgetOverview';
import { calculateBudgetHealth } from '../../features/smart-budget/model/budgetHealth';
import { calculateBudgetPacing } from '../../features/smart-budget/model/budgetPacing';
import { buildBudgetComparison } from '../../features/smart-budget/model/budgetComparison';
import { buildBudgetCategoryDetail } from '../../features/smart-budget/model/budgetDetail';
import {
  appendBudgetActionLog,
  BudgetActionLog
} from '../../features/smart-budget/model/budgetActions';
import { formatMonthKey, parseDateInput } from '../../features/smart-budget/model/budgetDate';
import { BudgetWizard } from '../../features/smart-budget/ui/BudgetWizard';
import { BudgetOverview } from '../../features/smart-budget/ui/BudgetOverview';
import { BudgetCategoryList } from '../../features/smart-budget/ui/BudgetCategoryList';
import { BudgetAnomalyPanel } from '../../features/smart-budget/ui/BudgetAnomalyPanel';
import { BudgetComparisonPanel } from '../../features/smart-budget/ui/BudgetComparisonPanel';
import {
  BudgetTrendPanel,
  BudgetTrendSeries
} from '../../features/smart-budget/ui/BudgetTrendPanel';
import { BudgetAiPanel } from '../../features/smart-budget/ui/BudgetAiPanel';
import { BudgetHistoryPanel } from '../../features/smart-budget/ui/BudgetHistoryPanel';
import { BudgetDetailDrawer } from '../../features/smart-budget/ui/BudgetDetailDrawer';

const SMART_BUDGET_DRAFT_KEY = 'ledgerflow-smart-budget-wizard-draft-v1';
const WIZARD_STEP_COUNT = 5;
const CORE_CATEGORY_LABELS = ['固定支出', '储蓄/投资'];

type BudgetAiAdvice = {
  summary: string;
  suggestions: string[];
  focusCategories?: Array<{
    category: string;
    action: 'increase' | 'decrease' | 'keep';
    reason: string;
  }>;
};

type WizardDraft = {
  answers?: unknown;
  recommendation?: BudgetRecommendation | null;
  step?: number;
};

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

function readWizardDraft(): WizardDraft | null {
  try {
    const raw = window.localStorage.getItem(SMART_BUDGET_DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as WizardDraft;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function writeWizardDraft(draft: WizardDraft) {
  try {
    window.localStorage.setItem(SMART_BUDGET_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // The in-memory wizard stays usable when browser storage is unavailable.
  }
}

function clearWizardDraft() {
  try {
    window.localStorage.removeItem(SMART_BUDGET_DRAFT_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}

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

function parseAiAdvice(raw: string, fallbackSummary: string): BudgetAiAdvice {
  const parsed = JSON.parse(extractFirstJsonObject(raw)) as {
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
        .map((item): { category: string; action: string; reason: string } | null => {
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
        .filter((item): item is { category: string; action: string; reason: string } =>
          Boolean(item?.category)
        )
        .slice(0, 6)
        .map((item) => ({
          category: item.category,
          action: item.action as 'increase' | 'decrease' | 'keep',
          reason: item.reason
        }))
    : [];

  return {
    summary: String(parsed.summary || fallbackSummary),
    suggestions,
    focusCategories
  };
}

export function SmartBudgetPage() {
  const tf = useTFallback();
  const confirmedPlan = useSmartBudgetStore((s) => s.confirmedPlan);
  const planHistory = useSmartBudgetStore((s) => s.history);
  const confirmPlan = useSmartBudgetStore((s) => s.confirmPlan);
  const updatePlan = useSmartBudgetStore((s) => s.updatePlan);
  const restorePlan = useSmartBudgetStore((s) => s.restorePlan);
  const clearPlan = useSmartBudgetStore((s) => s.clearPlan);

  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const addCategory = useFinanceStore((s) => s.addCategory);

  const { baseUrl, apiKey, model } = useAiSettings();
  const hasAiConfig = Boolean(baseUrl.trim()) && Boolean(apiKey.trim()) && Boolean(model.trim());

  const initialDraft = useMemo(() => readWizardDraft(), []);

  const [mode, setMode] = useState<'setup' | 'management'>(() =>
    confirmedPlan ? 'management' : 'setup'
  );
  const [step, setStep] = useState(() => {
    const stored = Number(initialDraft?.step);
    return Number.isFinite(stored) && stored > 0 && stored <= WIZARD_STEP_COUNT ? stored : 1;
  });
  /*
   * 向导问的第一个数是「每月到手收入」,而应用**早就知道**这个数(设置里的登记月收入,
   * 还款管理用它算负债率、助手用它做上下文)。原先这里直接用写死的 DEFAULT_BUDGET_ANSWERS
   * (月收入 10,000),于是用户明明登记过收入,向导还是从 10,000 开始 ——
   * 一路点下去,整份预算(固定/储蓄/灵活的分配、执行率、健康度)都按 10,000 算。
   * 演示账本正是这个状态:方案里 10,000,而登记月收入 26,000。
   * 草稿仍然优先(用户上次填到一半的值不能被覆盖);没有登记收入时才退回默认。
   */
  const registeredMonthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const wizardDefaultAnswers = useMemo(
    () => buildWizardDefaultAnswers(registeredMonthlyIncome),
    [registeredMonthlyIncome]
  );
  const [answers, setAnswers] = useState<BudgetAnswers>(() =>
    initialDraft?.answers ? normalizeBudgetAnswers(initialDraft.answers) : wizardDefaultAnswers
  );
  const [draftRecommendation, setDraftRecommendation] = useState<BudgetRecommendation | null>(
    () => initialDraft?.recommendation ?? null
  );
  const [wizardError, setWizardError] = useState<string | null>(null);
  /* 与 wizardError 配套:错误出在哪个字段上,传给向导做字段级关联。 */
  const [wizardErrorField, setWizardErrorField] = useState<'income' | 'fixed' | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | 'overspent' | 'safe'>('all');
  const [selectedMonthKey, setSelectedMonthKey] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BudgetTrackingRow | null>(null);
  const [listExpanded, setListExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [aiAdvice, setAiAdvice] = useState<BudgetAiAdvice | null>(null);
  const [actionLogs, setActionLogs] = useState<BudgetActionLog[]>([]);
  const [actionFeedback, setActionFeedback] = useState('');

  const monthOptions = useMemo(
    () => getRecentMonthOptions(transactions, 6, new Date(), tf),
    [transactions, tf]
  );
  const activeMonthKey = selectedMonthKey || monthOptions[0]?.key || '';

  const linkedRecommendation = useMemo(() => {
    if (!confirmedPlan) return null;
    return syncRecommendationWithExpenseCategories(confirmedPlan.recommendation, categories);
  }, [confirmedPlan, categories]);

  const trackingRows = useMemo(() => {
    if (!linkedRecommendation || !activeMonthKey) return [];
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

  const monthTotals = useMemo(() => {
    const monthTransactions = filterCountableTransactions(transactions).filter((item) => {
      const date = parseDateInput(item.date);
      return !Number.isNaN(date.getTime()) && formatMonthKey(date) === activeMonthKey;
    });
    const summary = summarizeTransactions(monthTransactions);
    return { income: summary.incomeTotal, expense: summary.expenseTotal };
  }, [transactions, activeMonthKey]);

  const overview = useMemo(
    () =>
      buildBudgetOverview({
        rows: trackingRows,
        monthIncome: monthTotals.income,
        monthExpense: monthTotals.expense
      }),
    [trackingRows, monthTotals]
  );

  // pacing 要排在 health 前面:健康度需要拿它的「按节奏外推」结果。
  const pacing = useMemo(
    () =>
      calculateBudgetPacing({
        monthKey: activeMonthKey,
        totalBudget: overview.totalBudget,
        totalSpent: overview.totalSpent
      }),
    [activeMonthKey, overview.totalBudget, overview.totalSpent]
  );

  const health = useMemo(
    () =>
      calculateBudgetHealth(
        {
          executionRate: overview.executionRate,
          overspentCount: overview.overspentCount,
          // 超支的「严重程度」也要参与打分,否则一个超到 238% 的分类
          // 和刚过线的分类扣一样的分,结论会写成「预算执行得很稳」。
          worstOverspendRatio: trackingRows.reduce(
            (max, row) => (row.ratio > max ? row.ratio : max),
            0
          ),
          // 节奏同样要参与:只看「已经用掉多少」会把 12 天前就用完整月预算判成正常。
          projectedExecutionRate:
            pacing && overview.totalBudget > 0
              ? pacing.projectedSpent / overview.totalBudget
              : undefined,
          monthIncome: monthTotals.income,
          monthExpense: monthTotals.expense
        },
        tf
      ),
    [overview.executionRate, overview.overspentCount, overview.totalBudget, monthTotals, trackingRows, pacing, tf]
  );

  const comparison = useMemo(() => {
    if (!linkedRecommendation || !activeMonthKey) return null;
    return buildBudgetComparison({
      recommendation: linkedRecommendation,
      transactions,
      categories,
      monthKey: activeMonthKey
    });
  }, [linkedRecommendation, transactions, categories, activeMonthKey]);

  const trendSeries = useMemo<BudgetTrendSeries[]>(() => {
    if (!linkedRecommendation) return [];
    const recentKeys = getRecentMonthOptions(transactions, 6, new Date(), tf)
      .map((item) => item.key)
      .reverse();

    const monthRows = recentKeys.map((key) => ({
      key,
      rows: buildBudgetTrackingRows({
        recommendation: linkedRecommendation,
        categories,
        transactions,
        monthKey: key
      })
    }));

    return linkedRecommendation.categoryBudgets
      .filter((item) => !CORE_CATEGORY_LABELS.includes(item.category))
      .slice(0, 6)
      .map((budget) => ({
        category: budget.category,
        points: monthRows.map((month) => {
          const row = month.rows.find((item) => item.category === budget.category);
          return {
            monthKey: month.key,
            spent: row?.spentAmount || 0,
            budget: budget.amount
          };
        })
      }));
  }, [linkedRecommendation, transactions, categories, tf]);

  const anomalies = useMemo(() => {
    if (!activeMonthKey || trackingRows.length === 0) return [];
    const [yearText, monthText] = activeMonthKey.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return [];

    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
    const totalDays = new Date(year, month, 0).getDate();
    const daysPassed = isCurrentMonth ? Math.max(now.getDate(), 1) : totalDays;

    return trackingRows
      .map((row) => {
        const projectedSpent =
          daysPassed > 0 ? (row.spentAmount / daysPassed) * totalDays : row.spentAmount;
        const riskRatio = row.budgetAmount > 0 ? projectedSpent / row.budgetAmount : 0;
        return {
          category: row.category,
          projectedSpent,
          riskRatio,
          suggestedSaving: Math.max(projectedSpent - row.budgetAmount, 0)
        };
      })
      .filter((item) => item.riskRatio > 1)
      .sort((a, b) => b.riskRatio - a.riskRatio);
  }, [activeMonthKey, trackingRows]);

  const topOverspent = useMemo(
    () => trackingRows.filter((row) => row.ratio > 1).sort((a, b) => b.ratio - a.ratio)[0] || null,
    [trackingRows]
  );

  const selectedDetail = useMemo(() => {
    if (!selectedCategory || !linkedRecommendation) return null;
    return buildBudgetCategoryDetail({
      category: selectedCategory.category,
      budgetAmount: selectedCategory.budgetAmount,
      transactions,
      categories,
      monthKey: activeMonthKey
    });
  }, [selectedCategory, linkedRecommendation, transactions, categories, activeMonthKey]);

  // 账本分类变化时，把推荐预算同步到真实分类上（不新增历史版本）。
  useEffect(() => {
    if (!confirmedPlan) return;
    const synced = syncRecommendationWithExpenseCategories(
      confirmedPlan.recommendation,
      categories
    );
    if (buildBudgetSignature(synced) === buildBudgetSignature(confirmedPlan.recommendation)) {
      return;
    }
    updatePlan(synced);
  }, [confirmedPlan, categories, updatePlan]);

  useEffect(() => {
    setMode(confirmedPlan ? 'management' : 'setup');
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
    if (mode !== 'setup') return;
    writeWizardDraft({ answers, recommendation: draftRecommendation, step });
  }, [answers, draftRecommendation, mode, step]);

  const handleWizardNext = () => {
    setWizardError(null);
    setWizardErrorField(null);

    if (step === 2 && answers.monthlyIncome <= 0) {
      setWizardError(tf('smartBudget.error.incomePositive', '每月收入必须大于 0。'));
      setWizardErrorField('income');
      return;
    }

    if (step === 3) {
      if (answers.monthlyFixedExpense < 0) {
        setWizardError(tf('smartBudget.error.fixedNonNegative', '固定支出不能小于 0。'));
        setWizardErrorField('fixed');
        return;
      }
      if (answers.monthlyFixedExpense >= answers.monthlyIncome) {
        setWizardError(
          tf(
            'smartBudget.error.fixedLessThanIncome',
            '固定支出需要小于月收入，才能生成可执行预算。'
          )
        );
        /* 这一步只有「固定支出」是可改的输入框(收入在上一步,已经不渲染了)。 */
        setWizardErrorField('fixed');
        return;
      }
    }

    if (step === 4) {
      try {
        const result = generateBudgetRecommendation(answers);
        setDraftRecommendation(syncRecommendationWithExpenseCategories(result, categories));
      } catch (error) {
        setWizardError(
          error instanceof Error
            ? error.message
            : tf('smartBudget.error.generateFailed', '预算生成失败。')
        );
        return;
      }
    }

    setStep((current) => Math.min(current + 1, WIZARD_STEP_COUNT));
  };

  const handleWizardPrev = () => {
    setWizardError(null);
    setWizardErrorField(null);
    setStep((current) => Math.max(current - 1, 1));
  };

  const handleDraftCategoryEdit = (category: string, amount: number) => {
    if (!draftRecommendation) return;
    setDraftRecommendation(applyBalancedCategoryEdit(draftRecommendation, category, amount));
  };

  const handleConfirmPlan = () => {
    if (!draftRecommendation) return;
    const synced = syncRecommendationWithExpenseCategories(draftRecommendation, categories);
    confirmPlan({ answers, recommendation: synced });
    clearWizardDraft();
    setMode('management');
  };

  const handleRestartWizard = () => {
    clearWizardDraft();
    setDraftRecommendation(null);
    setAnswers(wizardDefaultAnswers);
    setStep(1);
    setWizardError(null);
    setWizardErrorField(null);
    setMode('setup');
  };

  const handleResetPlan = () => {
    clearPlan();
    clearWizardDraft();
    setDraftRecommendation(null);
    setStep(1);
    setMode('setup');
  };

  const handleAdjustCategory = (category: string, amount: number) => {
    if (!confirmedPlan || !linkedRecommendation) return;
    const previous = linkedRecommendation.categoryBudgets.find(
      (item) => item.category === category
    );
    const delta = amount - (previous?.amount || 0);
    updatePlan(applyBalancedCategoryEdit(linkedRecommendation, category, amount));

    setActionLogs((prev) =>
      appendBudgetActionLog(prev, {
        id: `${Date.now()}-adjust-${category}`,
        createdAt: new Date().toISOString(),
        type: 'adjust-category',
        category,
        delta,
        message: tf('smartBudget.action.adjusted', '已将「{category}」预算调整为 {amount}')
          .replace('{category}', String(category))
          .replace('{amount}', String(formatCurrency(amount)))
      })
    );
    setActionFeedback(
      tf(
        'smartBudget.action.adjustedFeedback',
        '「{category}」预算已调整为 {amount}，其它分类已按比例回填。'
      )
        .replace('{category}', String(category))
        .replace('{amount}', String(formatCurrency(amount)))
    );
  };

  const runAiAnalysis = useCallback(async () => {
    if (!confirmedPlan || !linkedRecommendation || !activeMonthKey || trackingRows.length === 0) {
      setAiStatus('error');
      setAiError(tf('smartBudget.ai.noData', '当前月份还没有可分析的预算数据。'));
      return;
    }
    if (!hasAiConfig) {
      setAiStatus('error');
      setAiError(
        tf(
          'smartBudget.ai.notConfigured',
          '未配置 AI 模型，请先在设置页完成模型地址、密钥与模型名称。'
        )
      );
      return;
    }

    setAiStatus('loading');
    setAiError('');

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

      setAiAdvice(
        parseAiAdvice(
          response.content,
          tf('smartBudget.ai.defaultSummary', '预算执行总体平稳，可持续跟踪超支项。')
        )
      );
      setAiStatus('done');
    } catch (error) {
      setAiStatus('error');
      setAiAdvice(null);
      setAiError(
        error instanceof Error ? error.message : tf('smartBudget.ai.failed', 'AI 建议生成失败')
      );
    }
  }, [
    confirmedPlan,
    linkedRecommendation,
    activeMonthKey,
    trackingRows,
    tf,
    hasAiConfig,
    baseUrl,
    apiKey,
    model,
    categories
  ]);

  const handleApplyToNextMonth = () => {
    if (!confirmedPlan || !linkedRecommendation || !topOverspent) return;
    const nextAmount = Math.max(0, Math.round(topOverspent.budgetAmount + topOverspent.diff * 0.5));
    updatePlan(applyBalancedCategoryEdit(linkedRecommendation, topOverspent.category, nextAmount));

    const message = tf('smartBudget.action.adjusted', '已将「{category}」预算调整为 {amount}')
      .replace('{category}', String(topOverspent.category))
      .replace('{amount}', String(formatCurrency(nextAmount)));
    setActionLogs((prev) =>
      appendBudgetActionLog(prev, {
        id: `${Date.now()}-apply-${topOverspent.category}`,
        createdAt: new Date().toISOString(),
        type: 'apply-next-month',
        category: topOverspent.category,
        delta: nextAmount - topOverspent.budgetAmount,
        message
      })
    );
    setActionFeedback(message);
  };

  const handleSetReminder = () => {
    if (!topOverspent) return;
    const message = tf(
      'smartBudget.action.reminder',
      '已为「{category}」设置本月超支提醒，建议至少压降 {amount}'
    )
      .replace('{category}', String(topOverspent.category))
      .replace('{amount}', String(formatCurrency(topOverspent.diff)));
    setActionLogs((prev) =>
      appendBudgetActionLog(prev, {
        id: `${Date.now()}-reminder-${topOverspent.category}`,
        createdAt: new Date().toISOString(),
        type: 'set-month-reminder',
        category: topOverspent.category,
        delta: -Math.abs(topOverspent.diff),
        message
      })
    );
    setActionFeedback(message);
  };

  const openCategory = (category: string) => {
    const row = trackingRows.find((item) => item.category === category);
    if (row) {
      setSelectedCategory(row);
    }
  };

  if (mode === 'setup') {
    return (
      <div className="vi-page sb-page">
        <header className="vi-page-head">
          <div className="vi-page-title">
            <h2>{tf('smartBudget.title', '智能预算')}</h2>
          </div>
          {confirmedPlan ? (
            <div className="vi-page-actions">
              <button
                type="button"
                className="sb-btn sb-btn--ghost"
                onClick={() => setMode('management')}
              >
                {tf('smartBudget.backToDashboard', '返回预算看板')}
              </button>
            </div>
          ) : null}
        </header>

        <section className="vi-section">
          <BudgetWizard
            answers={answers}
            step={step}
            stepCount={WIZARD_STEP_COUNT}
            error={wizardError}
            errorField={wizardErrorField}
            draftRecommendation={draftRecommendation}
            onAnswersChange={setAnswers}
            onNext={handleWizardNext}
            onPrev={handleWizardPrev}
            onEditCategory={handleDraftCategoryEdit}
            onConfirm={handleConfirmPlan}
            onRestart={handleRestartWizard}
          />
        </section>
      </div>
    );
  }

  if (!confirmedPlan || !linkedRecommendation) {
    return (
      <div className="vi-page sb-page">
        <section className="vi-section">
          <p className="sb-empty">
            {tf('smartBudget.needSetup', '请先完成预算设置并确认后，再查看智能预算看板。')}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="vi-page sb-page">
      <header className="vi-page-head">
        <div className="vi-page-title">
          <h2>{tf('smartBudget.title', '智能预算')}</h2>
          <p>
            {tf(
              `smartBudget.identity.${confirmedPlan.answers.identity}`,
              getIdentityLabel(confirmedPlan.answers.identity)
            )}{' '}
            {tf('smartBudget.monthlyIncomeSuffix', '· 月收入')}{' '}
            {formatCurrency(linkedRecommendation.monthlyIncome)}{' '}
            {tf('smartBudget.savingsSuffix', '· 储蓄')}{' '}
            {Math.round(confirmedPlan.answers.savingsRatio * 100)}%
          </p>
        </div>
        <div className="vi-page-actions">
          <button
            type="button"
            className="sb-btn sb-btn--ghost"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            {tf('smartBudget.historyButton', '预算记录')}
          </button>
          <button type="button" className="sb-btn sb-btn--ghost" onClick={handleRestartWizard}>
            {tf('smartBudget.restartButton', '重新设置')}
          </button>
          <button type="button" className="sb-btn" onClick={handleResetPlan}>
            {tf('smartBudget.clearButton', '清除预算')}
          </button>
        </div>
      </header>

      <div className="vi-toolbar sb-toolbar">
        <div className="vi-toolbar-main">
          <div className="vi-field">
            <label className="vi-field-label" htmlFor="sb-month">
              {tf('smartBudget.monthLabel', '统计月份')}
            </label>
            <select
              id="sb-month"
              className="vi-input sb-select"
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

          <div
            className="sb-filter-group"
            role="group"
            aria-label={tf('smartBudget.filterAria', '预算状态过滤')}
          >
            <button
              type="button"
              className={statusFilter === 'all' ? 'is-active' : ''}
              onClick={() => setStatusFilter('all')}
            >
              {tf('smartBudget.filterAll', '全部')} {trackingRows.length}
            </button>
            <button
              type="button"
              className={statusFilter === 'overspent' ? 'is-active' : ''}
              onClick={() => setStatusFilter('overspent')}
            >
              {tf('smartBudget.filterOverspent', '已超支')} {overview.overspentCount}
            </button>
            <button
              type="button"
              className={statusFilter === 'safe' ? 'is-active' : ''}
              onClick={() => setStatusFilter('safe')}
            >
              {tf('smartBudget.filterSafe', '正常')} {overview.safeCount}
            </button>
          </div>
        </div>
      </div>

      <BudgetOverview overview={overview} health={health} pacing={pacing} />

      <section className="vi-section">
        <div className="vi-section-head">
          <div className="vi-section-title">
            <h2>{tf('smartBudget.categorySectionTitle', '分类预算执行')}</h2>
          </div>
        </div>
        <BudgetCategoryList
          rows={visibleRows}
          comparisonRows={comparison?.rows ?? []}
          expanded={listExpanded}
          onToggleExpanded={() => setListExpanded((open) => !open)}
          onSelect={(row) => setSelectedCategory(row)}
          onAdjust={handleAdjustCategory}
        />
      </section>

      {actionFeedback ? (
        <p className="sb-feedback" aria-live="polite">
          {actionFeedback}
        </p>
      ) : null}

      <div className="vi-grid vi-grid--two">
        <BudgetAnomalyPanel anomalies={anomalies} onSelectCategory={openCategory} />
        {comparison ? (
          <BudgetComparisonPanel comparison={comparison} onSelectCategory={openCategory} />
        ) : null}
      </div>

      <BudgetTrendPanel series={trendSeries} />

      <BudgetAiPanel
        status={aiStatus}
        error={aiError}
        advice={aiAdvice}
        topOverspent={topOverspent}
        onRefresh={() => {
          void runAiAnalysis();
        }}
        onApplyNextMonth={handleApplyToNextMonth}
        onSetReminder={handleSetReminder}
      />

      {actionLogs.length ? (
        <section className="vi-section" aria-label={tf('smartBudget.logAria', '建议动作执行记录')}>
          <div className="vi-section-head">
            <div className="vi-section-title">
              <h2>{tf('smartBudget.logTitle', '动作记录')}</h2>
            </div>
          </div>
          <ul className="sb-log-list">
            {actionLogs.map((item) => (
              <li key={item.id}>
                <span className="sb-log-time">{formatDateTime(item.createdAt)}</span>
                <span className="sb-log-message">{item.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {historyOpen ? (
        <BudgetHistoryPanel
          history={planHistory}
          currentConfirmedAt={confirmedPlan.confirmedAt}
          onRestore={(plan) => {
            restorePlan(plan);
            setHistoryOpen(false);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {selectedCategory ? (
        <BudgetDetailDrawer
          row={selectedCategory}
          detail={selectedDetail}
          onClose={() => setSelectedCategory(null)}
        />
      ) : null}
    </div>
  );
}
