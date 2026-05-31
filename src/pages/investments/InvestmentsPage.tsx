import {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account } from '../../entities/account/types';
import type {
  InvestmentAiMessage,
  InvestmentCategory,
  InvestmentFundAnalysis,
  InvestmentGoal,
  InvestmentGoalKind,
  InvestmentGoalPriority,
  InvestmentPosition,
  InvestmentPositionHistoryEntry,
  InvestmentRiskLevel,
  InvestmentWatchItem,
  InvestmentWatchlistReviewItem
} from '../../entities/investment/types';
import {
  fetchAiModels,
  sendAiChatStream
} from '../../features/assistant/api/openaiCompatibleClient';
import { renderMarkdownContent } from '../../features/assistant/ui/MarkdownRenderer';
import {
  BOT_ICON_URL,
  BRAIN_ICON_URL,
  CHEVRONS_DOWN_UP_ICON_URL,
  CHEVRONS_LEFT_RIGHT_ICON_URL,
  CHEVRONS_RIGHT_LEFT_ICON_URL,
  CHEVRONS_UP_DOWN_ICON_URL,
  IMAGE_ICON_URL,
  INFO_ICON_URL,
  PEN_TOOL_ICON_URL,
  QUESTION_ICON_URL,
  STAR_ICON_URL,
  THUMBS_DOWN_ICON_URL,
  THUMBS_UP_ICON_URL,
  USER_ICON_URL
} from '../../shared/config/brandAssets';
import { formatCurrency, formatCurrencyAuto, formatDate } from '../../shared/lib/format';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { Toast, type ToastVariant } from '../../shared/ui/Toast';
import {
  buildInvestmentAssistantPrompt,
  buildInvestmentWatchlistReviewPrompt,
  createInvestmentAiMessage,
  extractInvestmentAnalysis,
  extractInvestmentWatchlistReview,
  readImageAsDataUrl,
  summarizeInvestmentAnalysis,
  trimInvestmentAiMessages
} from './investmentAi';

const POSITION_CATEGORY_LABELS: Record<InvestmentCategory, string> = {
  cash: '现金理财',
  'fixed-income': '固收',
  'index-fund': '指数基金',
  'active-fund': '主动基金',
  stock: '股票',
  gold: '黄金',
  other: '其他'
};

const GOAL_KIND_LABELS: Record<InvestmentGoalKind, string> = {
  emergency: '应急金',
  house: '首付/住房',
  travel: '旅行',
  education: '教育',
  retirement: '退休',
  other: '其他'
};

const RISK_LEVEL_LABELS: Record<InvestmentRiskLevel, string> = {
  low: '低波动',
  medium: '均衡',
  high: '进取'
};

const POSITION_HISTORY_ACTION_LABELS: Record<InvestmentPositionHistoryEntry['action'], string> = {
  add: '新增持仓',
  update: '更新持仓',
  remove: '移除持仓',
  snapshot: '历史快照'
};

const PRIORITY_LABELS: Record<InvestmentGoalPriority, string> = {
  low: '慢慢来',
  medium: '按节奏',
  high: '优先推进'
};

const POSITION_FORM_DEFAULT = {
  name: '',
  category: 'index-fund' as InvestmentCategory,
  platform: '',
  linkedAccountId: '',
  investedAmount: '',
  currentValue: '',
  monthlyContribution: '',
  targetAllocation: '',
  riskLevel: 'medium' as InvestmentRiskLevel,
  note: '',
  isActive: true
};

const GOAL_FORM_DEFAULT = {
  name: '',
  kind: 'emergency' as InvestmentGoalKind,
  targetAmount: '',
  currentAmount: '',
  monthlyContribution: '',
  targetDate: '',
  priority: 'medium' as InvestmentGoalPriority,
  note: ''
};

type InvestmentAlertTone = 'info' | 'warning' | 'danger';

type InvestmentAlert = {
  tone: InvestmentAlertTone;
  title: string;
  description: string;
};

type ActionSuggestion = {
  label: string;
  hint: string;
  to?: string;
  action?: 'open-ai';
};

type WatchContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  item: InvestmentWatchItem | null;
};

type InvestmentPanelKey = 'summary' | 'allocation' | 'alerts' | 'position' | 'goal';

const AI_LOADING_GIF_URL =
  'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/ui/load.gif';
const MAX_INVESTMENT_AI_IMAGES = 4;
const MAX_INVESTMENT_AI_IMAGE_SIZE_MB = 6;
const INVESTMENT_AI_SUGGESTED_QUESTIONS = [
  '这只基金现在适合买吗？',
  '帮我看最大风险',
  '适合定投还是观望？',
  '和我的持仓冲突吗？',
  '我下一步该做什么？'
];
const INVESTMENT_MODEL_CACHE_KEY = 'ledgerflow-assistant-model-cache-v1';

function getModelDisplayLabel(modelId: string): string {
  const value = modelId.trim();
  if (!value) return value;
  return value === 'gpt-5.4-mini' ? `${value}（推荐）` : value;
}

function getClipboardImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      if (file.name) return file;
      return new File([file], `clipboard-fund-screenshot-${Date.now()}-${index}.png`, {
        type: file.type || item.type || 'image/png'
      });
    })
    .filter((file): file is File => Boolean(file));

  if (itemFiles.length > 0) return itemFiles;

  return Array.from(clipboardData.files || []).filter((file) => file.type.startsWith('image/'));
}

function parseAmountInput(value: string): number {
  const numeric = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function isPositiveAccount(account: Account) {
  return account.type !== 'liability' && account.type !== 'credit';
}

function getMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

function getLargestPositionShare(positions: InvestmentPosition[], totalCurrentValue: number) {
  if (positions.length === 0 || totalCurrentValue <= 0) return 0;
  return Math.max(...positions.map((item) => item.currentValue / totalCurrentValue));
}

function buildInvestmentAlerts(params: {
  positions: InvestmentPosition[];
  goals: InvestmentGoal[];
  totalCurrentValue: number;
  cashBucketValue: number;
  monthlyInvestableCash: number;
  totalGoalGap: number;
}): InvestmentAlert[] {
  const alerts: InvestmentAlert[] = [];
  const activePositions = params.positions.filter((item) => item.isActive);

  if (activePositions.length === 0) {
    return [
      {
        tone: 'info',
        title: '先从第一笔持仓开始',
        description: '这页已经准备好接你的基金、股票、固收或现金理财，先录一笔再看配置和提醒。'
      }
    ];
  }

  const largestShare = getLargestPositionShare(activePositions, params.totalCurrentValue);
  if (largestShare >= 0.45) {
    alerts.push({
      tone: 'danger',
      title: '单一持仓占比偏高',
      description: `当前最大持仓约占 ${(largestShare * 100).toFixed(1)}%，仓位有点挤，后续补仓尽量分散。`
    });
  } else if (largestShare >= 0.3) {
    alerts.push({
      tone: 'warning',
      title: '最大持仓已经有点重',
      description: `当前最大持仓约占 ${(largestShare * 100).toFixed(1)}%，再继续加仓前建议先看整体配置。`
    });
  }

  const equityValue = activePositions
    .filter(
      (item) =>
        item.category === 'stock' ||
        item.category === 'index-fund' ||
        item.category === 'active-fund'
    )
    .reduce((sum, item) => sum + item.currentValue, 0);
  const equityShare = params.totalCurrentValue > 0 ? equityValue / params.totalCurrentValue : 0;
  if (equityShare >= 0.7 && params.monthlyInvestableCash <= 0) {
    alerts.push({
      tone: 'danger',
      title: '权益仓位高，现金补给偏紧',
      description: '当前更适合先把现金流站稳，再考虑继续往高波动资产上叠仓。'
    });
  }

  const safeBucketShare =
    params.totalCurrentValue > 0 ? params.cashBucketValue / params.totalCurrentValue : 0;
  if (params.totalCurrentValue >= 10000 && safeBucketShare < 0.15) {
    alerts.push({
      tone: 'warning',
      title: '低波动仓位偏薄',
      description: '现金理财和固收合计不到 15%，如果你最近还在加仓，记得留一点缓冲垫。'
    });
  }

  if (params.goals.length === 0) {
    alerts.push({
      tone: 'info',
      title: '有持仓了，也该有目标',
      description: '建议至少建一个应急金或中短期理财目标，后面更容易判断每月该投多少。'
    });
  }

  if (
    params.totalGoalGap > 0 &&
    params.monthlyInvestableCash > 0 &&
    params.monthlyInvestableCash < params.totalGoalGap / 12
  ) {
    alerts.push({
      tone: 'warning',
      title: '目标推进速度有点慢',
      description: '按当前月度可投入空间看，部分目标可能会拖长，建议先分主次。'
    });
  }

  return alerts.slice(0, 4);
}

function buildActionSuggestions(params: {
  hasPositions: boolean;
  monthlyInvestableCash: number;
  alerts: InvestmentAlert[];
}): ActionSuggestion[] {
  if (!params.hasPositions) {
    return [
      {
        label: '先补一笔真实持仓',
        hint: '只填名称、成本和现值也可以，先把页面跑起来。',
        to: '/categories-accounts'
      },
      {
        label: '从记账里找结余',
        hint: '先回交易页看最近有没有稳定结余，再决定每月理财额度。',
        to: '/transactions'
      }
    ];
  }

  const hasDanger = params.alerts.some((item) => item.tone === 'danger');
  if (hasDanger || params.monthlyInvestableCash <= 0) {
    return [
      {
        label: '先收口预算',
        hint: '现在更适合先守现金流，再考虑继续扩大仓位。',
        to: '/smart-budget'
      },
      {
        label: '带着配置去问 AI',
        hint: '直接在这页上传基金截图或提问，先拿到一轮分析再决定。',
        action: 'open-ai'
      }
    ];
  }

  return [
    {
      label: '继续跟进持仓配置',
      hint: '直接问一只基金值不值得继续跟，或者让 AI 帮你拆风险点。',
      action: 'open-ai'
    },
    {
      label: '回交易页核对现金流',
      hint: '每月理财投入最好和真实结余对得上，不要只看想法。',
      to: '/transactions'
    }
  ];
}

function createInvestmentChatMessageId(prefix: 'user' | 'assistant') {
  return `investment-chat-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTimeLabel(value?: string) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
}

function formatSignedCurrency(value?: number) {
  if (!value) return '无变化';
  const prefix = value > 0 ? '+' : '-';
  return `${prefix}${formatCurrency(Math.abs(value))}`;
}

function getAnalysisRiskLabel(riskLevel?: InvestmentFundAnalysis['riskLevel']) {
  if (riskLevel === 'low') return '偏稳';
  if (riskLevel === 'medium') return '均衡';
  if (riskLevel === 'high') return '进取';
  return '待判断';
}

function getAnalysisRiskClass(riskLevel?: InvestmentFundAnalysis['riskLevel']) {
  if (riskLevel === 'low') return 'is-low';
  if (riskLevel === 'medium') return 'is-medium';
  if (riskLevel === 'high') return 'is-high';
  return 'is-unknown';
}

function findMatchingWatchItem(
  watchlist: InvestmentWatchItem[],
  analysis?: InvestmentFundAnalysis | null
) {
  if (!analysis) return null;

  const code = String(analysis.fundCode || '')
    .trim()
    .toLowerCase();
  const name = String(analysis.fundName || '')
    .trim()
    .toLowerCase();

  return (
    watchlist.find((item) => {
      const itemCode = String(item.code || '')
        .trim()
        .toLowerCase();
      const itemName = String(item.name || '')
        .trim()
        .toLowerCase();
      if (code && itemCode === code) return true;
      return Boolean(name) && itemName === name;
    }) || null
  );
}

function buildWatchItemFromAnalysis(analysis: InvestmentFundAnalysis) {
  return {
    name: analysis.fundName || analysis.fundCode || '未命名基金',
    code: analysis.fundCode || '',
    platform: analysis.platform || '',
    tags: analysis.watchTags,
    note: analysis.note || analysis.summary,
    lastVerdict: analysis.verdict,
    lastSummary: analysis.summary,
    lastRiskLevel: analysis.riskLevel,
    investmentAdvice: analysis.actions[0] || analysis.verdict || analysis.summary,
    adviceReasons: analysis.highlights,
    riskNotes: analysis.risks,
    nextActions: analysis.actions,
    performanceHistory: analysis.performanceHistory,
    fundAnalysis: analysis.fundAnalysis,
    fundHoldings: analysis.fundHoldings,
    assetAllocation: analysis.assetAllocation,
    industryAllocation: analysis.industryAllocation,
    buyFeeRate: analysis.buyFeeRate,
    fundCompany: analysis.fundCompany,
    lastAnalysisAt: new Date().toISOString()
  };
}

type WatchDetailSection = {
  title: string;
  items: string[];
};

function compactWatchDetailSections(item: InvestmentWatchItem): WatchDetailSection[] {
  return [
    { title: '历史业绩', items: item.performanceHistory || [] },
    { title: '基金分析', items: item.fundAnalysis || [] },
    { title: '基金持仓', items: item.fundHoldings || [] },
    { title: '基金资产分布', items: item.assetAllocation || [] },
    { title: '行业分布', items: item.industryAllocation || [] },
    { title: '买入费率', items: item.buyFeeRate ? [item.buyFeeRate] : [] },
    { title: '基金公司', items: item.fundCompany ? [item.fundCompany] : [] },
    { title: '判断依据', items: item.adviceReasons || [] },
    { title: '风险提示', items: item.riskNotes || [] },
    { title: '下一步', items: item.nextActions || [] }
  ].filter((section) => section.items.length > 0);
}

function mergeWatchlistReview(
  watchlist: InvestmentWatchItem[],
  reviewItems: InvestmentWatchlistReviewItem[]
): InvestmentWatchItem[] {
  const reviewedAt = new Date().toISOString();
  const reviewById = new Map(reviewItems.map((item) => [item.id, item]));

  return watchlist
    .map((item, index) => {
      const review = reviewById.get(item.id);
      if (!review) {
        return {
          item,
          rank: 9999 + index
        };
      }

      return {
        item: {
          ...item,
          tags: review.watchTags?.length ? review.watchTags : item.tags,
          note: review.note || item.note,
          lastVerdict: review.verdict || item.lastVerdict,
          lastSummary: review.summary || item.lastSummary,
          lastRiskLevel: review.riskLevel || item.lastRiskLevel,
          investmentAdvice: review.investmentAdvice || item.investmentAdvice,
          adviceReasons: review.adviceReasons?.length ? review.adviceReasons : item.adviceReasons,
          riskNotes: review.riskNotes?.length ? review.riskNotes : item.riskNotes,
          nextActions: review.nextActions?.length ? review.nextActions : item.nextActions,
          performanceHistory: review.performanceHistory?.length
            ? review.performanceHistory
            : item.performanceHistory,
          fundAnalysis: review.fundAnalysis?.length ? review.fundAnalysis : item.fundAnalysis,
          fundHoldings: review.fundHoldings?.length ? review.fundHoldings : item.fundHoldings,
          assetAllocation: review.assetAllocation?.length
            ? review.assetAllocation
            : item.assetAllocation,
          industryAllocation: review.industryAllocation?.length
            ? review.industryAllocation
            : item.industryAllocation,
          buyFeeRate: review.buyFeeRate || item.buyFeeRate,
          fundCompany: review.fundCompany || item.fundCompany,
          lastAnalysisAt: reviewedAt,
          updatedAt: reviewedAt
        },
        rank: review.rank || 9999 + index
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

export function InvestmentsPage() {
  const navigate = useNavigate();
  const accounts = useFinanceStore((state) => state.accounts);
  const transactions = useFinanceStore((state) => state.transactions);
  const positions = useAppPreferences((state) => state.investmentPositions);
  const investmentPositionHistory = useAppPreferences((state) => state.investmentPositionHistory);
  const goals = useAppPreferences((state) => state.investmentGoals);
  const investmentWatchlist = useAppPreferences((state) => state.investmentWatchlist);
  const persistedAiMessages = useAppPreferences((state) => state.investmentAiMessages);
  const debts = useAppPreferences((state) => state.debts);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const addInvestmentPosition = useAppPreferences((state) => state.addInvestmentPosition);
  const updateInvestmentPosition = useAppPreferences((state) => state.updateInvestmentPosition);
  const removeInvestmentPosition = useAppPreferences((state) => state.removeInvestmentPosition);
  const ensureInvestmentPositionHistory = useAppPreferences(
    (state) => state.ensureInvestmentPositionHistory
  );
  const addInvestmentGoal = useAppPreferences((state) => state.addInvestmentGoal);
  const updateInvestmentGoal = useAppPreferences((state) => state.updateInvestmentGoal);
  const removeInvestmentGoal = useAppPreferences((state) => state.removeInvestmentGoal);
  const upsertInvestmentWatchItem = useAppPreferences((state) => state.upsertInvestmentWatchItem);
  const removeInvestmentWatchItem = useAppPreferences((state) => state.removeInvestmentWatchItem);
  const setInvestmentWatchlist = useAppPreferences((state) => state.setInvestmentWatchlist);
  const setInvestmentAiMessages = useAppPreferences((state) => state.setInvestmentAiMessages);
  const clearInvestmentAiMessages = useAppPreferences((state) => state.clearInvestmentAiMessages);
  const { baseUrl, apiKey, model, setModel } = useAiSettings();
  const missingInvestmentAiKey = !apiKey.trim();

  const [positionForm, setPositionForm] = useState(POSITION_FORM_DEFAULT);
  const [goalForm, setGoalForm] = useState(GOAL_FORM_DEFAULT);
  const [positionError, setPositionError] = useState('');
  const [goalError, setGoalError] = useState('');
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [pendingDeletePositionId, setPendingDeletePositionId] = useState<string | null>(null);
  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);
  const [investmentAiMessages, setLocalInvestmentAiMessages] = useState<InvestmentAiMessage[]>(
    () => persistedAiMessages
  );
  const [investmentAiInput, setInvestmentAiInput] = useState('');
  const [investmentAiImages, setInvestmentAiImages] = useState<string[]>([]);
  const [investmentAiStatus, setInvestmentAiStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [investmentAiError, setInvestmentAiError] = useState('');
  const [watchlistReviewStatus, setWatchlistReviewStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [watchlistReviewError, setWatchlistReviewError] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<string[]>(() => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(INVESTMENT_MODEL_CACHE_KEY) || '[]');
      return Array.isArray(cached) ? cached.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [loadingModels, setLoadingModels] = useState(false);
  const [supportCollapsed, setSupportCollapsed] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: ToastVariant }>({
    visible: false,
    message: '',
    variant: 'success'
  });
  const [watchContextMenu, setWatchContextMenu] = useState<WatchContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    item: null
  });
  const [expandedWatchItemId, setExpandedWatchItemId] = useState<string | null>(null);
  const [openInvestmentPanels, setOpenInvestmentPanels] = useState<
    Record<InvestmentPanelKey, boolean>
  >({
    summary: false,
    allocation: false,
    alerts: false,
    position: false,
    goal: false
  });
  const aiFileInputRef = useRef<HTMLInputElement | null>(null);
  const aiPanelRef = useRef<HTMLElement | null>(null);
  const investmentAiThreadEndRef = useRef<HTMLDivElement | null>(null);
  const modelSelectorRef = useRef<HTMLDivElement | null>(null);

  const activePositions = useMemo(() => positions.filter((item) => item.isActive), [positions]);

  const { monthIncomeTotal, monthExpenseTotal, monthNetBalance } = useMemo(() => {
    const { start, end } = getMonthBounds();
    const monthTransactions = transactions.filter((item) => {
      const date = new Date(item.date);
      return date >= start && date < end;
    });

    const incomeTotal = monthTransactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + item.amount, 0);
    const expenseTotal = monthTransactions
      .filter((item) => item.type === 'expense' || item.type === 'repayment')
      .reduce((sum, item) => sum + item.amount, 0);

    return {
      monthIncomeTotal: incomeTotal,
      monthExpenseTotal: expenseTotal,
      monthNetBalance: incomeTotal - expenseTotal
    };
  }, [transactions]);

  const positionSummary = useMemo(() => {
    const totalInvested = activePositions.reduce((sum, item) => sum + item.investedAmount, 0);
    const totalCurrentValue = activePositions.reduce((sum, item) => sum + item.currentValue, 0);
    const totalMonthlyContribution = activePositions.reduce(
      (sum, item) => sum + (item.monthlyContribution || 0),
      0
    );
    const totalProfit = totalCurrentValue - totalInvested;
    const profitRate = totalInvested > 0 ? totalProfit / totalInvested : 0;

    const allocationRows = Object.entries(POSITION_CATEGORY_LABELS)
      .map(([category, label]) => {
        const value = activePositions
          .filter((item) => item.category === category)
          .reduce((sum, item) => sum + item.currentValue, 0);
        const share = totalCurrentValue > 0 ? value / totalCurrentValue : 0;
        return {
          category: category as InvestmentCategory,
          label,
          value,
          share
        };
      })
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);

    return {
      totalInvested,
      totalCurrentValue,
      totalMonthlyContribution,
      totalProfit,
      profitRate,
      allocationRows
    };
  }, [activePositions]);

  const goalSummary = useMemo(() => {
    const totalTargetAmount = goals.reduce((sum, item) => sum + item.targetAmount, 0);
    const totalCurrentAmount = goals.reduce((sum, item) => sum + item.currentAmount, 0);
    const totalGap = Math.max(0, totalTargetAmount - totalCurrentAmount);
    const totalMonthlyContribution = goals.reduce(
      (sum, item) => sum + (item.monthlyContribution || 0),
      0
    );

    const rows = goals.map((item) => ({
      ...item,
      progress: item.targetAmount > 0 ? Math.min(1, item.currentAmount / item.targetAmount) : 0,
      gap: Math.max(0, item.targetAmount - item.currentAmount)
    }));

    return {
      totalTargetAmount,
      totalCurrentAmount,
      totalGap,
      totalMonthlyContribution,
      rows
    };
  }, [goals]);

  const accountAssetBalance = useMemo(
    () =>
      accounts
        .filter(isPositiveAccount)
        .reduce((sum, item) => sum + Math.max(0, Number(item.balance || 0)), 0),
    [accounts]
  );

  const debtBalance = useMemo(
    () => debts.reduce((sum, item) => sum + Math.max(0, Number(item.balance || 0)), 0),
    [debts]
  );

  const monthlyInvestableCash = useMemo(() => {
    const baseline = monthlyIncome > 0 ? monthlyIncome - monthExpenseTotal : monthNetBalance;
    return Math.max(0, baseline);
  }, [monthExpenseTotal, monthNetBalance, monthlyIncome]);

  const estimatedNetAssets = Math.max(
    0,
    accountAssetBalance + positionSummary.totalCurrentValue - debtBalance
  );
  const investmentAssetRatio =
    estimatedNetAssets > 0 ? positionSummary.totalCurrentValue / estimatedNetAssets : 0;

  const cashBucketValue = useMemo(
    () =>
      activePositions
        .filter((item) => item.category === 'cash' || item.category === 'fixed-income')
        .reduce((sum, item) => sum + item.currentValue, 0),
    [activePositions]
  );

  const investmentAlerts = useMemo(
    () =>
      buildInvestmentAlerts({
        positions: activePositions,
        goals,
        totalCurrentValue: positionSummary.totalCurrentValue,
        cashBucketValue,
        monthlyInvestableCash,
        totalGoalGap: goalSummary.totalGap
      }),
    [
      activePositions,
      cashBucketValue,
      goalSummary.totalGap,
      goals,
      monthlyInvestableCash,
      positionSummary.totalCurrentValue
    ]
  );

  const actionSuggestions = useMemo(
    () =>
      buildActionSuggestions({
        hasPositions: activePositions.length > 0,
        monthlyInvestableCash,
        alerts: investmentAlerts
      }),
    [activePositions.length, investmentAlerts, monthlyInvestableCash]
  );

  const investmentAssistantPrompt = useMemo(
    () =>
      buildInvestmentAssistantPrompt({
        positions: activePositions,
        goals,
        watchlist: investmentWatchlist,
        monthlyInvestableCash
      }),
    [activePositions, goals, investmentWatchlist, monthlyInvestableCash]
  );

  const latestAssistantAnalysis = useMemo(
    () =>
      [...investmentAiMessages].reverse().find((item) => item.role === 'assistant' && item.analysis)
        ?.analysis || null,
    [investmentAiMessages]
  );

  const streamingDisplayContent = useMemo(
    () => extractInvestmentAnalysis(streamingContent).displayText,
    [streamingContent]
  );

  const pendingDeletePosition = useMemo(
    () => positions.find((item) => item.id === pendingDeletePositionId) ?? null,
    [pendingDeletePositionId, positions]
  );

  const pendingDeleteGoal = useMemo(
    () => goals.find((item) => item.id === pendingDeleteGoalId) ?? null,
    [goals, pendingDeleteGoalId]
  );

  const latestInvestmentPositionHistory = useMemo(
    () => investmentPositionHistory.slice(0, 24),
    [investmentPositionHistory]
  );

  const loadInvestmentModels = useCallback(async () => {
    if (!apiKey.trim()) {
      setModels((current) => (current.length > 0 ? current : model ? [model] : []));
      setToastState('请先在设置里配置 API Key，再刷新模型列表', 'warning');
      return;
    }

    setLoadingModels(true);
    try {
      const nextModels = await fetchAiModels(baseUrl, apiKey);
      setModels(nextModels);
      try {
        window.localStorage.setItem(INVESTMENT_MODEL_CACHE_KEY, JSON.stringify(nextModels));
      } catch {
        // ignore storage write errors
      }
    } catch (error) {
      setToastState(error instanceof Error ? error.message : '模型列表拉取失败', 'error');
    } finally {
      setLoadingModels(false);
    }
  }, [apiKey, baseUrl, model]);

  const openInvestmentModelPicker = useCallback(() => {
    setModelOpen((current) => !current);
    if (!modelOpen && !loadingModels) {
      void loadInvestmentModels();
    }
  }, [loadInvestmentModels, loadingModels, modelOpen]);

  const handleSelectInvestmentModel = useCallback(
    (nextModel: string) => {
      setModel(nextModel);
      setModelOpen(false);
      setToastState(`已切换到 ${getModelDisplayLabel(nextModel)}`, 'success');
    },
    [setModel]
  );

  useEffect(() => {
    if (positions.length > 0 && investmentPositionHistory.length === 0) {
      ensureInvestmentPositionHistory();
    }
  }, [ensureInvestmentPositionHistory, investmentPositionHistory.length, positions.length]);

  useEffect(() => {
    investmentAiThreadEndRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'end'
    });
  }, [investmentAiMessages.length, investmentAiStatus, streamingContent, streamingReasoning]);

  useEffect(() => {
    if (!modelOpen) return;

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && modelSelectorRef.current?.contains(target)) return;
      setModelOpen(false);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [modelOpen]);

  useEffect(() => {
    if (!watchContextMenu.open) return;

    const closeMenu = () =>
      setWatchContextMenu((prev) => ({
        ...prev,
        open: false,
        item: null
      }));
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [watchContextMenu.open]);

  function resetPositionForm() {
    setPositionForm(POSITION_FORM_DEFAULT);
    setEditingPositionId(null);
    setPositionError('');
  }

  function resetGoalForm() {
    setGoalForm(GOAL_FORM_DEFAULT);
    setEditingGoalId(null);
    setGoalError('');
  }

  function setToastState(message: string, variant: ToastVariant = 'success') {
    setToast({ visible: true, message, variant });
  }

  function toggleInvestmentPanel(panel: InvestmentPanelKey) {
    setOpenInvestmentPanels((prev) => ({
      ...prev,
      [panel]: !prev[panel]
    }));
  }

  function syncInvestmentAiMessages(messages: InvestmentAiMessage[]) {
    const next = trimInvestmentAiMessages(messages);
    setLocalInvestmentAiMessages(next);
    setInvestmentAiMessages(next);
  }

  function setInvestmentMessageFeedback(
    messageId: string,
    feedback: InvestmentAiMessage['feedback']
  ) {
    syncInvestmentAiMessages(
      investmentAiMessages.map((item) =>
        item.id === messageId
          ? { ...item, feedback: item.feedback === feedback ? undefined : feedback }
          : item
      )
    );
  }

  function scrollToInvestmentAiPanel() {
    aiPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function handleInvestmentExpertPrompt(prompt: string) {
    void runInvestmentAi(prompt);
  }

  function closeWatchContextMenu() {
    setWatchContextMenu((prev) => ({
      ...prev,
      open: false,
      item: null
    }));
  }

  function toggleWatchItemDetails(itemId: string) {
    setExpandedWatchItemId((current) => (current === itemId ? null : itemId));
  }

  function handleWatchCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, itemId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleWatchItemDetails(itemId);
  }

  function getPositionRiskFromWatchItem(item: InvestmentWatchItem): InvestmentRiskLevel {
    if (item.lastRiskLevel === 'low' || item.lastRiskLevel === 'high') {
      return item.lastRiskLevel;
    }

    return 'medium';
  }

  function buildWatchItemPositionNote(item: InvestmentWatchItem) {
    return [
      item.code ? `基金代码：${item.code}` : '',
      item.investmentAdvice ? `自选建议：${item.investmentAdvice}` : '',
      item.note
        ? `自选备注：${item.note}`
        : item.lastSummary
          ? `最近分析：${item.lastSummary}`
          : '',
      item.nextActions?.length ? `下一步：${item.nextActions.join(' / ')}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  function openWatchContextMenu(event: MouseEvent<HTMLElement>, item: InvestmentWatchItem) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 92;
    const x = Math.min(event.clientX, Math.max(12, window.innerWidth - menuWidth));
    const y = Math.min(event.clientY, Math.max(12, window.innerHeight - menuHeight));

    setWatchContextMenu({
      open: true,
      x,
      y,
      item
    });
  }

  function handleAddWatchItemToPosition(item: InvestmentWatchItem) {
    setEditingPositionId(null);
    setPositionError('');
    setOpenInvestmentPanels((prev) => ({ ...prev, position: true }));
    setPositionForm({
      ...POSITION_FORM_DEFAULT,
      name: item.name,
      platform: item.platform || '',
      riskLevel: getPositionRiskFromWatchItem(item),
      note: buildWatchItemPositionNote(item)
    });
    closeWatchContextMenu();
    const scrollToPositionForm = () => {
      document.querySelector<HTMLElement>('.investments-main-grid')?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start'
      });
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scrollToPositionForm);
    } else {
      scrollToPositionForm();
    }
    setToastState(`已把“${item.name}”带入新增持仓表单，请补充投入本金和当前市值。`);
  }

  function handleActionSuggestionClick(item: ActionSuggestion) {
    if (item.action === 'open-ai') {
      scrollToInvestmentAiPanel();
      return;
    }

    if (item.to) {
      navigate(item.to);
    }
  }

  async function handleInvestmentAiFileSelect(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setInvestmentAiError('请上传图片格式的基金截图。');
      return;
    }

    const remainingSlots = MAX_INVESTMENT_AI_IMAGES - investmentAiImages.length;
    if (remainingSlots <= 0) {
      setInvestmentAiError(`最多上传 ${MAX_INVESTMENT_AI_IMAGES} 张图片。`);
      return;
    }

    const oversizedFile = imageFiles.find(
      (file) => file.size > MAX_INVESTMENT_AI_IMAGE_SIZE_MB * 1024 * 1024
    );
    if (oversizedFile) {
      setInvestmentAiError(
        `图片“${oversizedFile.name}”超过 ${MAX_INVESTMENT_AI_IMAGE_SIZE_MB}MB，请压缩后再试。`
      );
      return;
    }

    try {
      const selectedFiles = imageFiles.slice(0, remainingSlots);
      const dataUrls = await Promise.all(selectedFiles.map((file) => readImageAsDataUrl(file)));
      setInvestmentAiImages((prev) => [...prev, ...dataUrls].slice(0, MAX_INVESTMENT_AI_IMAGES));
      setInvestmentAiError('');
    } catch (error) {
      setInvestmentAiError(error instanceof Error ? error.message : '图片读取失败，请稍后再试。');
    }
  }

  function handleInvestmentAiPaste(event: ClipboardEvent<HTMLFormElement>) {
    if (investmentAiStatus === 'loading') return;

    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length === 0) return;

    event.preventDefault();
    void handleInvestmentAiFileSelect(imageFiles);
  }

  function handleAddAnalysisToWatchlist(analysis: InvestmentFundAnalysis) {
    if (!analysis.fundName && !analysis.fundCode) {
      setToastState('这次分析还没识别出基金名称，暂时不能加入自选。', 'warning');
      return;
    }

    upsertInvestmentWatchItem(buildWatchItemFromAnalysis(analysis));
    setToastState(`已将“${analysis.fundName || analysis.fundCode}”加入自选`, 'success');
  }

  async function handleReviewWatchlist() {
    if (watchlistReviewStatus === 'loading') return;

    if (investmentWatchlist.length === 0) {
      setToastState('先加入几只自选基金，我再帮你分析排序。', 'warning');
      return;
    }

    if (!apiKey.trim()) {
      setWatchlistReviewStatus('error');
      setWatchlistReviewError('请先在设置中配置可用的 AI Key，再来分析自选基金。');
      setToastState('请先配置可用的 AI Key。', 'warning');
      return;
    }

    setWatchlistReviewStatus('loading');
    setWatchlistReviewError('');

    try {
      let fullContent = '';
      const result = await sendAiChatStream(
        {
          baseUrl,
          apiKey,
          model,
          systemPrompt: buildInvestmentWatchlistReviewPrompt({
            positions: activePositions,
            goals,
            watchlist: investmentWatchlist,
            monthlyInvestableCash
          }),
          messages: [
            {
              role: 'user',
              text: '请复盘并排序当前所有自选基金，返回可持久化的 JSON。'
            }
          ]
        },
        {
          onDelta: (delta) => {
            fullContent += delta;
          },
          onDone: (content) => {
            fullContent = content || fullContent;
          }
        }
      );

      const reviews = extractInvestmentWatchlistReview(result.content || fullContent);
      const knownReviews = reviews.filter((review) =>
        investmentWatchlist.some((item) => item.id === review.id)
      );

      if (knownReviews.length === 0) {
        throw new Error('AI 没有返回可排序的自选基金结果，请稍后再试。');
      }

      const nextWatchlist = mergeWatchlistReview(investmentWatchlist, knownReviews);
      setInvestmentWatchlist(nextWatchlist);
      setExpandedWatchItemId(nextWatchlist[0]?.id ?? null);
      setWatchlistReviewStatus('idle');
      setToastState(`已分析 ${knownReviews.length} 只自选基金，并按优先级重新排序。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '自选基金分析失败，请稍后再试。';
      setWatchlistReviewStatus('error');
      setWatchlistReviewError(message);
      setToastState(message, 'warning');
    }
  }

  async function runInvestmentAi(promptOverride?: string) {
    if (investmentAiStatus === 'loading') {
      return;
    }

    const cleanPrompt = (promptOverride ?? investmentAiInput).trim();
    const hasAttachments = investmentAiImages.length > 0;

    if (!cleanPrompt && !hasAttachments) {
      setInvestmentAiError('先输入基金问题，或者上传一张基金截图。');
      return;
    }

    if (!apiKey.trim()) {
      setInvestmentAiStatus('error');
      setInvestmentAiError('请先在设置中配置可用的 AI Key，再来分析基金。');
      return;
    }

    const promptText = cleanPrompt || '请根据这张基金截图，帮我判断这只基金是否值得继续关注。';
    const submittedImages = [...investmentAiImages];
    const createdAt = new Date().toISOString();
    const userMessage = createInvestmentAiMessage({
      id: createInvestmentChatMessageId('user'),
      role: 'user',
      text: promptText,
      attachmentCount: submittedImages.length,
      attachmentImages: submittedImages,
      createdAt
    });
    const optimisticMessages = trimInvestmentAiMessages([...investmentAiMessages, userMessage]);

    setLocalInvestmentAiMessages(optimisticMessages);
    setInvestmentAiStatus('loading');
    setInvestmentAiError('');
    if (promptOverride !== undefined) {
      setInvestmentAiInput('');
    }
    setStreamingContent('');
    setStreamingReasoning('');

    try {
      let fullContent = '';
      let fullReasoning = '';
      const result = await sendAiChatStream(
        {
          baseUrl,
          apiKey,
          model,
          systemPrompt: investmentAssistantPrompt,
          messages: [
            {
              role: 'user',
              text: promptText,
              imageDataUrls: submittedImages
            }
          ]
        },
        {
          onDelta: (delta) => {
            fullContent += delta;
            setStreamingContent(fullContent);
          },
          onReasoningDelta: (delta) => {
            fullReasoning += delta;
            setStreamingReasoning(fullReasoning);
          },
          onDone: (content, reasoning) => {
            fullContent = content || fullContent;
            fullReasoning = reasoning || fullReasoning;
          }
        }
      );

      const resolvedContent = result.content || fullContent;
      const resolvedReasoning = result.reasoning || fullReasoning;
      const extracted = extractInvestmentAnalysis(resolvedContent);
      const assistantText = summarizeInvestmentAnalysis(extracted.displayText, extracted.analysis);
      const assistantMessage = createInvestmentAiMessage({
        id: createInvestmentChatMessageId('assistant'),
        role: 'assistant',
        text: assistantText,
        reasoning: resolvedReasoning,
        analysis: extracted.analysis,
        createdAt: new Date().toISOString()
      });
      const nextMessages = [...optimisticMessages, assistantMessage];

      syncInvestmentAiMessages(nextMessages);
      setInvestmentAiStatus('idle');
      setInvestmentAiInput('');
      setInvestmentAiImages([]);
      setStreamingContent('');
      setStreamingReasoning('');
    } catch (error) {
      setInvestmentAiStatus('error');
      setInvestmentAiError(error instanceof Error ? error.message : '基金分析失败，请稍后再试。');
    }
  }

  async function submitInvestmentAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runInvestmentAi();
  }

  function submitPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const investedAmount = parseAmountInput(positionForm.investedAmount);
    const currentValue = parseAmountInput(positionForm.currentValue);
    const monthlyContribution = parseAmountInput(positionForm.monthlyContribution);
    const targetAllocation = parseAmountInput(positionForm.targetAllocation);

    if (!positionForm.name.trim()) {
      setPositionError('请先填写持仓名称。');
      return;
    }

    if (investedAmount <= 0) {
      setPositionError('投入本金必须大于 0。');
      return;
    }

    if (currentValue <= 0) {
      setPositionError('当前市值必须大于 0。');
      return;
    }

    const payload = {
      name: positionForm.name.trim(),
      category: positionForm.category,
      platform: positionForm.platform.trim(),
      linkedAccountId: positionForm.linkedAccountId,
      investedAmount,
      currentValue,
      monthlyContribution: monthlyContribution || undefined,
      targetAllocation: targetAllocation || undefined,
      riskLevel: positionForm.riskLevel,
      note: positionForm.note.trim(),
      isActive: positionForm.isActive
    };

    if (editingPositionId) {
      updateInvestmentPosition(editingPositionId, payload);
    } else {
      addInvestmentPosition(payload);
    }

    resetPositionForm();
  }

  function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetAmount = parseAmountInput(goalForm.targetAmount);
    const currentAmount = parseAmountInput(goalForm.currentAmount);
    const monthlyContribution = parseAmountInput(goalForm.monthlyContribution);

    if (!goalForm.name.trim()) {
      setGoalError('请先填写目标名称。');
      return;
    }

    if (targetAmount <= 0) {
      setGoalError('目标金额必须大于 0。');
      return;
    }

    const payload = {
      name: goalForm.name.trim(),
      kind: goalForm.kind,
      targetAmount,
      currentAmount,
      monthlyContribution: monthlyContribution || undefined,
      targetDate: goalForm.targetDate,
      priority: goalForm.priority,
      note: goalForm.note.trim()
    };

    if (editingGoalId) {
      updateInvestmentGoal(editingGoalId, payload);
    } else {
      addInvestmentGoal(payload);
    }

    resetGoalForm();
  }

  return (
    <div
      className={`page-stack investments-page ${openInvestmentPanels.summary ? 'is-support-open' : ''} ${
        supportCollapsed ? 'is-support-collapsed' : ''
      }`}
    >
      <section className={`investments-ai-grid ${supportCollapsed ? 'is-support-collapsed' : ''}`}>
        <article className="panel investments-ai-panel" ref={aiPanelRef}>
          <div className="investments-section-head investments-ai-panel-head">
            <div className="investments-ai-title-group">
              <div
                className="chat-model-selector investments-ai-model-selector"
                ref={modelSelectorRef}
              >
                <button
                  type="button"
                  className={`chat-model-trigger investments-ai-model-trigger ${
                    modelOpen ? 'is-open' : ''
                  }`}
                  onClick={openInvestmentModelPicker}
                  aria-haspopup="listbox"
                  aria-expanded={modelOpen}
                  aria-label={`当前模型：${getModelDisplayLabel(model || '默认模型')}`}
                  title={getModelDisplayLabel(model || '默认模型')}
                >
                  <span className="chat-model-trigger-icon">@</span>
                  <span className="chat-model-inline-label">
                    {getModelDisplayLabel(model || '默认模型')}
                  </span>
                </button>

                {modelOpen ? (
                  <div
                    className="chat-model-dropdown investments-ai-model-dropdown"
                    role="dialog"
                    aria-label="模型列表"
                  >
                    <div className="chat-model-list">
                      {models.length === 0 ? (
                        <div className="chat-model-empty">
                          {loadingModels ? '模型加载中…' : '暂无可用模型'}
                        </div>
                      ) : (
                        models.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={`chat-model-option ${item === model ? 'active' : ''}`}
                            onClick={() => handleSelectInvestmentModel(item)}
                          >
                            {getModelDisplayLabel(item)}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="investments-ai-head-actions">
              {investmentAiMessages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setLocalInvestmentAiMessages([]);
                    clearInvestmentAiMessages();
                    setToastState('已清空最近分析记录', 'warning');
                  }}
                  disabled={investmentAiStatus === 'loading'}
                >
                  清空记录
                </button>
              ) : null}
              <button
                type="button"
                className="button-with-icon investments-support-toggle"
                onClick={() => setSupportCollapsed((current) => !current)}
                aria-pressed={supportCollapsed}
                aria-label={supportCollapsed ? '展开投资侧栏' : '收起投资侧栏'}
                title={supportCollapsed ? '展开投资侧栏' : '收起投资侧栏'}
              >
                <img
                  src={
                    supportCollapsed ? CHEVRONS_LEFT_RIGHT_ICON_URL : CHEVRONS_RIGHT_LEFT_ICON_URL
                  }
                  alt=""
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          {missingInvestmentAiKey ? (
            <button
              type="button"
              className="assistant-wb-issue error investments-ai-error investments-ai-settings-link"
              onClick={() => navigate('/settings')}
            >
              <span>请先在设置中配置可用的 AI Key，再来分析基金。</span>
              <strong>去设置</strong>
            </button>
          ) : investmentAiError ? (
            <p className="assistant-wb-issue error investments-ai-error" role="alert">
              {investmentAiError}
            </p>
          ) : null}

          <div className="investments-ai-thread" aria-label="基金分析对话">
            {investmentAiMessages.map((item) => {
              const matchedWatchItem =
                item.role === 'assistant'
                  ? findMatchingWatchItem(investmentWatchlist, item.analysis)
                  : null;
              const displayMessageText =
                item.role === 'assistant'
                  ? summarizeInvestmentAnalysis(item.text, item.analysis ?? null)
                  : item.text;

              return (
                <article
                  key={item.id}
                  className={`investments-ai-message ${item.role === 'user' ? 'is-user' : 'is-assistant'}`}
                >
                  {item.role === 'assistant' ? (
                    <div className="investments-ai-message-avatar" aria-hidden="true">
                      <img src={BOT_ICON_URL} alt="" />
                    </div>
                  ) : null}
                  <div className="investments-ai-bubble">
                    <div className="investments-ai-message-head">
                      <strong>{item.role === 'user' ? '你' : 'AI 分析'}</strong>
                      <span>{formatDateTimeLabel(item.createdAt)}</span>
                    </div>
                    {displayMessageText ? (
                      <div className="chat-msg-content chat-msg-content-rich">
                        {renderMarkdownContent(displayMessageText)}
                      </div>
                    ) : null}
                    {item.attachmentImages?.length ? (
                      <div className="investments-ai-message-attachments" aria-label="消息附带图片">
                        {item.attachmentImages.map((url, index) => (
                          <a
                            key={`${item.id}-${index}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img src={url} alt={`附带图片 ${index + 1}`} />
                          </a>
                        ))}
                      </div>
                    ) : item.attachmentCount ? (
                      <p className="investments-ai-attachment-note">
                        附带 {item.attachmentCount} 张图片
                      </p>
                    ) : null}
                    {item.reasoning ? (
                      <details className="chat-thinking-box">
                        <summary>分析过程</summary>
                        <div className="chat-thinking-scroll">{item.reasoning}</div>
                      </details>
                    ) : null}
                    {item.analysis ? (
                      <div className="investments-analysis-card">
                        <div className="investments-analysis-card-head">
                          <div>
                            <strong>{item.analysis.fundName || '基金分析结果'}</strong>
                            <span>
                              {item.analysis.fundCode || '未识别代码'}
                              {item.analysis.platform ? ` · ${item.analysis.platform}` : ''}
                            </span>
                          </div>
                          <span
                            className={`investments-analysis-risk ${getAnalysisRiskClass(item.analysis.riskLevel)}`}
                          >
                            {getAnalysisRiskLabel(item.analysis.riskLevel)}
                          </span>
                        </div>
                        <p className="investments-analysis-summary">{item.analysis.summary}</p>
                        {item.analysis.highlights.length > 0 ? (
                          <div className="investments-analysis-list">
                            <h4>值得关注</h4>
                            <ul>
                              {item.analysis.highlights.map((row) => (
                                <li key={row}>{row}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {item.analysis.risks.length > 0 ? (
                          <div className="investments-analysis-list">
                            <h4>风险点</h4>
                            <ul>
                              {item.analysis.risks.map((row) => (
                                <li key={row}>{row}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {item.analysis.actions.length > 0 ? (
                          <div className="investments-analysis-list">
                            <h4>下一步</h4>
                            <ul>
                              {item.analysis.actions.map((row) => (
                                <li key={row}>{row}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <div className="investments-analysis-actions">
                          <button
                            type="button"
                            className={`button-with-icon ${matchedWatchItem ? 'investments-analysis-watch-btn is-active' : 'primary'}`}
                            onClick={() => handleAddAnalysisToWatchlist(item.analysis!)}
                          >
                            <img src={STAR_ICON_URL} alt="" aria-hidden="true" />
                            {matchedWatchItem ? '更新自选' : '加入自选'}
                          </button>
                          {matchedWatchItem?.updatedAt ? (
                            <span>上次更新 {formatDateTimeLabel(matchedWatchItem.updatedAt)}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {item.role === 'assistant' ? (
                      <div className="investments-ai-message-actions">
                        <button
                          type="button"
                          className={`chat-icon-action-btn${item.feedback === 'up' ? ' is-active' : ''}`}
                          onClick={() => setInvestmentMessageFeedback(item.id, 'up')}
                          aria-label="点赞这条分析"
                          title="点赞这条分析"
                        >
                          <img
                            className="chat-icon-action-img"
                            src={THUMBS_UP_ICON_URL}
                            alt=""
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          className={`chat-icon-action-btn${item.feedback === 'down' ? ' is-active' : ''}`}
                          onClick={() => setInvestmentMessageFeedback(item.id, 'down')}
                          aria-label="点踩这条分析"
                          title="点踩这条分析"
                        >
                          <img
                            className="chat-icon-action-img"
                            src={THUMBS_DOWN_ICON_URL}
                            alt=""
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {item.role === 'user' ? (
                    <div className="investments-ai-message-avatar" aria-hidden="true">
                      <img src={USER_ICON_URL} alt="" />
                    </div>
                  ) : null}
                </article>
              );
            })}

            {investmentAiStatus === 'loading' ? (
              <article className="investments-ai-message is-assistant">
                <div className="investments-ai-message-avatar" aria-hidden="true">
                  <img src={BOT_ICON_URL} alt="" />
                </div>
                <div className="investments-ai-bubble">
                  <div className="investments-ai-message-head">
                    <strong>AI 分析</strong>
                    <span>刚刚</span>
                  </div>
                  {streamingDisplayContent ? (
                    <div className="chat-msg-content chat-msg-content-rich">
                      {renderMarkdownContent(streamingDisplayContent)}
                    </div>
                  ) : (
                    <div className="chat-typing investments-ai-streaming">
                      模型思考中
                      <img
                        className="chat-typing-loader"
                        src={AI_LOADING_GIF_URL}
                        alt=""
                        aria-hidden="true"
                      />
                    </div>
                  )}
                  {streamingReasoning ? (
                    <details className="chat-thinking-box" open>
                      <summary>分析过程</summary>
                      <div className="chat-thinking-scroll">{streamingReasoning}</div>
                    </details>
                  ) : null}
                </div>
              </article>
            ) : null}
            <div ref={investmentAiThreadEndRef} aria-hidden="true" />
          </div>

          {investmentAiImages.length > 0 ? (
            <div className="investments-ai-image-strip" aria-label="待分析图片">
              <div className="investments-ai-thumb-list">
                {investmentAiImages.map((url, index) => (
                  <div key={`${url.slice(0, 20)}-${index}`} className="investments-ai-thumb-item">
                    <img
                      src={url}
                      alt={`待分析图片 ${index + 1}`}
                      className="investments-ai-thumb"
                    />
                    <button
                      type="button"
                      className="investments-ai-thumb-remove"
                      onClick={() =>
                        setInvestmentAiImages((prev) => prev.filter((_, idx) => idx !== index))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setInvestmentAiImages([])}>
                清空图片
              </button>
            </div>
          ) : null}

          <form
            className="chat-input-form investments-ai-composer"
            onSubmit={submitInvestmentAi}
            onPaste={handleInvestmentAiPaste}
          >
            <div className="chat-input-stack">
              <div className="chat-input-main investments-ai-input-main">
                <input
                  ref={aiFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="chat-file-input-hidden"
                  aria-label="上传基金截图"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    void handleInvestmentAiFileSelect(files);
                    event.target.value = '';
                  }}
                />
                <textarea
                  rows={1}
                  value={investmentAiInput}
                  className="chat-input-textarea investments-ai-textarea"
                  placeholder="输入基金问题，Enter 发送"
                  aria-label="基金分析输入框"
                  disabled={investmentAiStatus === 'loading'}
                  onChange={(event) => setInvestmentAiInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="chat-input-toolbar investments-ai-input-toolbar">
                  <div
                    className="chat-input-toolbar-left investments-ai-suggestion-row"
                    aria-label="AI 联想提问"
                  >
                    <button
                      type="button"
                      className="chat-upload-btn investments-ai-upload-btn"
                      onClick={() => aiFileInputRef.current?.click()}
                      disabled={investmentAiStatus === 'loading'}
                      title={`支持上传或粘贴最多 ${MAX_INVESTMENT_AI_IMAGES} 张截图`}
                    >
                      <img
                        className="chat-upload-icon"
                        src={IMAGE_ICON_URL}
                        alt=""
                        aria-hidden="true"
                      />
                    </button>
                    <div>
                      {INVESTMENT_AI_SUGGESTED_QUESTIONS.map((question) => (
                        <button
                          key={question}
                          type="button"
                          className="vi-chip"
                          onClick={() => handleInvestmentExpertPrompt(question)}
                          disabled={investmentAiStatus === 'loading'}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="chat-send-btn investments-ai-submit-btn"
                    disabled={
                      investmentAiStatus === 'loading' ||
                      (!investmentAiInput.trim() && investmentAiImages.length === 0)
                    }
                    title={investmentAiStatus === 'loading' ? '分析中' : '发送'}
                    aria-label={investmentAiStatus === 'loading' ? '分析中' : '开始分析'}
                  >
                    {investmentAiStatus === 'loading' ? '…' : '↑'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </article>

        <aside className="investments-support-column">
          <section
            className={`panel investments-hero investments-fold-card ${
              openInvestmentPanels.summary ? 'is-open' : ''
            }`}
          >
            <button
              type="button"
              className="investments-section-head investments-fold-head"
              aria-expanded={openInvestmentPanels.summary}
              onClick={() => toggleInvestmentPanel('summary')}
            >
              <span>
                <h3>投资资料与管理</h3>
                <p>
                  点开再看配置、提醒、持仓和目标 · 总市值{' '}
                  {formatCurrencyAuto(positionSummary.totalCurrentValue)} · 目标进度{' '}
                  {goalSummary.totalTargetAmount > 0
                    ? `${((goalSummary.totalCurrentAmount / goalSummary.totalTargetAmount) * 100).toFixed(1)}%`
                    : '未开始'}
                </p>
              </span>
              <span className="investments-fold-side">
                <span className="badge">聊天辅助入口</span>
                <img
                  src={
                    openInvestmentPanels.summary
                      ? CHEVRONS_DOWN_UP_ICON_URL
                      : CHEVRONS_UP_DOWN_ICON_URL
                  }
                  alt=""
                  aria-hidden="true"
                />
              </span>
            </button>

            <div className="investments-fold-body">
              <div className="investments-hero-copy">
                <span className="investments-kicker">投资理财</span>
                <h2>看清你的投资节奏和目标进度</h2>
                <p>
                  把持仓、现金和理财目标放在一起，日常看一眼就知道现在走到哪一步，接下来该补哪一块。
                </p>
              </div>
              <div className="investments-tip-board" aria-label="投资理财页提示">
                <div className="investments-tip-item">
                  <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                  <div>
                    <strong>先从常用资产开始</strong>
                    <p>先记下你最常看的基金、股票或现金类资产，后面再慢慢补齐也没关系。</p>
                  </div>
                </div>
                <div className="investments-tip-item">
                  <img src={QUESTION_ICON_URL} alt="" aria-hidden="true" />
                  <div>
                    <strong>把目标一起放进来</strong>
                    <p>金额、时间和优先级越清楚，越容易看懂当前进度和仓位分布。</p>
                  </div>
                </div>
              </div>

              <div className="investments-summary-strip" aria-label="投资资产总览">
                <article className="investments-summary-pill">
                  <span>总持仓市值</span>
                  <strong>{formatCurrencyAuto(positionSummary.totalCurrentValue)}</strong>
                </article>
                <article className="investments-summary-pill">
                  <span>累计投入本金</span>
                  <strong>{formatCurrencyAuto(positionSummary.totalInvested)}</strong>
                </article>
                <article
                  className={`investments-summary-pill ${positionSummary.totalProfit >= 0 ? 'is-positive' : 'is-negative'}`}
                >
                  <span>浮动收益</span>
                  <strong>
                    {formatCurrencyAuto(positionSummary.totalProfit)} /{' '}
                    {(positionSummary.profitRate * 100).toFixed(1)}%
                  </strong>
                </article>
                <article className="investments-summary-pill">
                  <span>本月可投资空间</span>
                  <strong>{formatCurrencyAuto(monthlyInvestableCash)}</strong>
                </article>
                <article className="investments-summary-pill">
                  <span>投资占估算净资产</span>
                  <strong>{(investmentAssetRatio * 100).toFixed(1)}%</strong>
                </article>
                <article className="investments-summary-pill">
                  <span>理财目标进度</span>
                  <strong>
                    {goalSummary.totalTargetAmount > 0
                      ? `${((goalSummary.totalCurrentAmount / goalSummary.totalTargetAmount) * 100).toFixed(1)}%`
                      : '未开始'}
                  </strong>
                </article>
              </div>
            </div>
          </section>

          <aside className="panel investments-watchlist-panel">
            <div className="investments-section-head">
              <div>
                <h3>基金自选</h3>
                <p>把想继续观察的基金留在这里，下次回来不用重新找。</p>
              </div>
              <div className="investments-watchlist-actions">
                <span className="badge">{investmentWatchlist.length} 只</span>
                <button
                  type="button"
                  className="primary button-with-icon investments-watchlist-review-btn"
                  onClick={handleReviewWatchlist}
                  disabled={watchlistReviewStatus === 'loading' || investmentWatchlist.length === 0}
                >
                  <img src={BRAIN_ICON_URL} alt="" aria-hidden="true" />
                  {watchlistReviewStatus === 'loading' ? '分析中' : 'AI 分析排序'}
                </button>
              </div>
            </div>

            {watchlistReviewError ? (
              <p className="investments-watchlist-review-error">{watchlistReviewError}</p>
            ) : null}

            {latestAssistantAnalysis &&
            !findMatchingWatchItem(investmentWatchlist, latestAssistantAnalysis) ? (
              <article className="investments-watchlist-highlight">
                <strong>
                  {latestAssistantAnalysis.fundName ||
                    latestAssistantAnalysis.fundCode ||
                    '最新分析结果'}
                </strong>
                <p>{latestAssistantAnalysis.verdict}</p>
                <button
                  type="button"
                  className="primary button-with-icon"
                  onClick={() => handleAddAnalysisToWatchlist(latestAssistantAnalysis)}
                >
                  <img src={STAR_ICON_URL} alt="" aria-hidden="true" />
                  加入自选
                </button>
              </article>
            ) : null}

            {investmentWatchlist.length === 0 ? (
              <div className="investments-watchlist-empty">
                <strong>还没有自选基金</strong>
                <p>分析完觉得值得继续跟，就顺手加进来，后面回看会更方便。</p>
              </div>
            ) : (
              <div className="investments-watchlist-list">
                {investmentWatchlist.map((item) => {
                  const isExpanded = expandedWatchItemId === item.id;
                  const detailSections = compactWatchDetailSections(item);
                  const primaryTag = item.tags[0];

                  return (
                    <article
                      key={item.id}
                      className={`investments-watch-card ${isExpanded ? 'is-expanded' : ''}`}
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() => toggleWatchItemDetails(item.id)}
                      onKeyDown={(event) => handleWatchCardKeyDown(event, item.id)}
                      onContextMenu={(event) => openWatchContextMenu(event, item)}
                    >
                      <div className="investments-watch-card-head">
                        <div>
                          <strong>{item.name}</strong>
                          <p>
                            {item.code || '未记录代码'}
                            {item.platform ? ` · ${item.platform}` : ''}
                          </p>
                        </div>
                        <div className="investments-watch-card-actions">
                          {item.lastRiskLevel ? (
                            <span
                              className={`investments-analysis-risk ${getAnalysisRiskClass(
                                item.lastRiskLevel
                              )}`}
                            >
                              {getAnalysisRiskLabel(item.lastRiskLevel)}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeInvestmentWatchItem(item.id);
                            }}
                          >
                            移除
                          </button>
                        </div>
                      </div>
                      <div className="investments-watch-card-brief">
                        <strong>
                          {item.investmentAdvice || item.lastVerdict || '等待下一次分析'}
                        </strong>
                        {primaryTag ? <span className="badge">{primaryTag}</span> : null}
                      </div>
                      {item.lastSummary ? (
                        <p className="investments-watch-card-summary">{item.lastSummary}</p>
                      ) : null}
                      <div className="investments-watch-card-meta">
                        <span>
                          {item.lastAnalysisAt
                            ? `更新于 ${formatDateTimeLabel(item.lastAnalysisAt)}`
                            : '暂未分析'}
                        </span>
                        <span>{isExpanded ? '收起详情' : '点击查看详情'}</span>
                      </div>

                      {isExpanded ? (
                        <div className="investments-watch-card-details">
                          {detailSections.length > 0 ? (
                            <div className="investments-watch-detail-grid">
                              {detailSections.map((section) => (
                                <section key={`${item.id}-${section.title}`}>
                                  <span>{section.title}</span>
                                  <p>{section.items.join(' / ')}</p>
                                </section>
                              ))}
                            </div>
                          ) : (
                            <p className="investments-watch-card-empty-detail">
                              暂时还没有更多资料，下一次让 AI 分析时会自动补齐。
                            </p>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </aside>

          <section className="investments-overview-grid">
            <article
              className={`panel investments-overview-card investments-fold-card ${
                openInvestmentPanels.allocation ? 'is-open' : ''
              }`}
            >
              <button
                type="button"
                className="investments-section-head investments-fold-head"
                aria-expanded={openInvestmentPanels.allocation}
                onClick={() => toggleInvestmentPanel('allocation')}
              >
                <span>
                  <h3>当前配置</h3>
                  <p>
                    市值 {formatCurrencyAuto(positionSummary.totalCurrentValue)} ·{' '}
                    {activePositions.length} 笔持仓
                  </p>
                </span>
                <span className="investments-fold-side">
                  <span className="badge">{activePositions.length} 笔持仓</span>
                  <img
                    src={
                      openInvestmentPanels.allocation
                        ? CHEVRONS_DOWN_UP_ICON_URL
                        : CHEVRONS_UP_DOWN_ICON_URL
                    }
                    alt=""
                    aria-hidden="true"
                  />
                </span>
              </button>

              <div className="investments-fold-body">
                {positionSummary.allocationRows.length === 0 ? (
                  <p className="muted">还没有可统计的持仓，先新增第一笔再看配置。</p>
                ) : (
                  <div className="investments-allocation-list">
                    {positionSummary.allocationRows.map((item) => (
                      <article key={item.category} className="investments-allocation-row">
                        <div className="investments-allocation-copy">
                          <strong>{item.label}</strong>
                          <span>
                            {formatCurrencyAuto(item.value)} · {(item.share * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="investments-allocation-track" aria-hidden="true">
                          <i style={{ width: `${Math.max(6, item.share * 100)}%` }} />
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <div className="investments-meta-grid">
                  <div>
                    <span>计划月投入</span>
                    <strong>
                      {formatCurrency(
                        positionSummary.totalMonthlyContribution +
                          goalSummary.totalMonthlyContribution
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>账户资产余额</span>
                    <strong>{formatCurrencyAuto(accountAssetBalance)}</strong>
                  </div>
                  <div>
                    <span>当前月收入</span>
                    <strong>
                      {formatCurrencyAuto(monthlyIncome > 0 ? monthlyIncome : monthIncomeTotal)}
                    </strong>
                  </div>
                  <div>
                    <span>当前月支出</span>
                    <strong>{formatCurrencyAuto(monthExpenseTotal)}</strong>
                  </div>
                </div>
              </div>
            </article>

            <article
              className={`panel investments-overview-card investments-fold-card ${
                openInvestmentPanels.alerts ? 'is-open' : ''
              }`}
            >
              <button
                type="button"
                className="investments-section-head investments-fold-head"
                aria-expanded={openInvestmentPanels.alerts}
                onClick={() => toggleInvestmentPanel('alerts')}
              >
                <span>
                  <h3>当前提醒</h3>
                  <p>
                    {investmentAlerts[0]?.title || '暂无提醒'} · {actionSuggestions.length} 个动作
                  </p>
                </span>
                <span className="investments-fold-side">
                  <span className="badge">{investmentAlerts.length} 条提醒</span>
                  <img
                    src={
                      openInvestmentPanels.alerts
                        ? CHEVRONS_DOWN_UP_ICON_URL
                        : CHEVRONS_UP_DOWN_ICON_URL
                    }
                    alt=""
                    aria-hidden="true"
                  />
                </span>
              </button>

              <div className="investments-fold-body">
                <div className="investments-alert-list">
                  {investmentAlerts.map((item) => (
                    <article
                      key={item.title}
                      className={`investments-alert-card tone-${item.tone}`}
                    >
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </article>
                  ))}
                </div>

                <div className="investments-actions-card">
                  <h4>顺手下一步</h4>
                  <div className="investments-actions-list">
                    {actionSuggestions.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className="investments-action-button"
                        onClick={() => handleActionSuggestionClick(item)}
                      >
                        <strong>{item.label}</strong>
                        <span>{item.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          </section>

          <section className="investments-main-grid">
            <article
              className={`panel investments-panel investments-fold-card ${
                openInvestmentPanels.position ? 'is-open' : ''
              }`}
            >
              <button
                type="button"
                className="investments-section-head investments-fold-head"
                aria-expanded={openInvestmentPanels.position}
                onClick={() => toggleInvestmentPanel('position')}
              >
                <span>
                  <h3>{editingPositionId ? '编辑持仓' : '新增持仓'}</h3>
                  <p>{positions.length} 笔持仓 · 先填名称、本金和市值，其他交给 AI 慢慢补</p>
                </span>
                <span className="investments-fold-side">
                  <span className="badge">{editingPositionId ? '编辑中' : '新增'}</span>
                  <img
                    src={
                      openInvestmentPanels.position
                        ? CHEVRONS_DOWN_UP_ICON_URL
                        : CHEVRONS_UP_DOWN_ICON_URL
                    }
                    alt=""
                    aria-hidden="true"
                  />
                </span>
              </button>

              <div className="investments-fold-body">
                <div className="investments-form-guide">
                  <strong>只需要 3 项关键资料</strong>
                  <span>
                    本金和市值统一按人民币“元”填写，不用填份额或股数。月投入、风险档位、账户关联都放到高级选项里。
                  </span>
                </div>
                <form className="investments-form" onSubmit={submitPosition}>
                  <div className="investments-form-grid investments-position-quick-grid">
                    <label className="investments-field">
                      <span>持仓名称</span>
                      <input
                        value={positionForm.name}
                        onChange={(event) =>
                          setPositionForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                        placeholder="例如：沪深 300 ETF"
                      />
                    </label>
                    <label className="investments-field">
                      <span>投入本金（元）</span>
                      <input
                        inputMode="decimal"
                        value={positionForm.investedAmount}
                        onChange={(event) =>
                          setPositionForm((prev) => ({
                            ...prev,
                            investedAmount: event.target.value
                          }))
                        }
                        placeholder="例如 10000"
                      />
                    </label>
                    <label className="investments-field">
                      <span>当前市值（元）</span>
                      <input
                        inputMode="decimal"
                        value={positionForm.currentValue}
                        onChange={(event) =>
                          setPositionForm((prev) => ({ ...prev, currentValue: event.target.value }))
                        }
                        placeholder="例如 10880"
                      />
                    </label>
                  </div>

                  <details className="investments-advanced-fields">
                    <summary>
                      <span>高级选项</span>
                      <small>资产类别、平台、计划月投入、风险档位</small>
                    </summary>

                    <div className="investments-form-grid investments-form-grid-primary">
                      <label className="investments-field">
                        <span>资产类别</span>
                        <select
                          value={positionForm.category}
                          onChange={(event) =>
                            setPositionForm((prev) => ({
                              ...prev,
                              category: event.target.value as InvestmentCategory
                            }))
                          }
                        >
                          {Object.entries(POSITION_CATEGORY_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="investments-field">
                        <span>平台 / 券商</span>
                        <input
                          value={positionForm.platform}
                          onChange={(event) =>
                            setPositionForm((prev) => ({ ...prev, platform: event.target.value }))
                          }
                          placeholder="例如：支付宝 / 天天基金"
                        />
                      </label>
                      <label className="investments-field">
                        <span>关联账户（可选）</span>
                        <select
                          value={positionForm.linkedAccountId}
                          onChange={(event) =>
                            setPositionForm((prev) => ({
                              ...prev,
                              linkedAccountId: event.target.value
                            }))
                          }
                        >
                          <option value="">暂不关联</option>
                          {accounts.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="investments-form-grid">
                      <label className="investments-field">
                        <span>计划月投入（元，可选）</span>
                        <input
                          inputMode="decimal"
                          value={positionForm.monthlyContribution}
                          onChange={(event) =>
                            setPositionForm((prev) => ({
                              ...prev,
                              monthlyContribution: event.target.value
                            }))
                          }
                          placeholder="例如 500"
                        />
                      </label>
                      <label className="investments-field">
                        <span>目标占比（%，可选）</span>
                        <input
                          inputMode="decimal"
                          value={positionForm.targetAllocation}
                          onChange={(event) =>
                            setPositionForm((prev) => ({
                              ...prev,
                              targetAllocation: event.target.value
                            }))
                          }
                          placeholder="例如 25"
                        />
                      </label>
                      <label className="investments-field">
                        <span>风险档位</span>
                        <select
                          value={positionForm.riskLevel}
                          onChange={(event) =>
                            setPositionForm((prev) => ({
                              ...prev,
                              riskLevel: event.target.value as InvestmentRiskLevel
                            }))
                          }
                        >
                          {Object.entries(RISK_LEVEL_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="investments-checkbox">
                        <input
                          type="checkbox"
                          checked={positionForm.isActive}
                          onChange={(event) =>
                            setPositionForm((prev) => ({ ...prev, isActive: event.target.checked }))
                          }
                        />
                        <span>继续纳入当前配置统计</span>
                      </label>
                    </div>
                  </details>

                  {positionError ? (
                    <p className="assistant-wb-issue error">{positionError}</p>
                  ) : null}

                  <div className="investments-actions-row">
                    <button type="submit" className="primary">
                      {editingPositionId ? '保存持仓' : '新增持仓'}
                    </button>
                    {editingPositionId ? (
                      <button type="button" onClick={resetPositionForm}>
                        取消编辑
                      </button>
                    ) : null}
                  </div>
                </form>

                <div className="investments-list-head">
                  <h4>持仓列表</h4>
                  <span>{positions.length} 笔</span>
                </div>
                {positions.length === 0 ? (
                  <EmptyState
                    title="还没有投资持仓"
                    description="先录入第一笔基金、股票、黄金或现金理财，后面这页才会开始给出配置和风险提醒。"
                    icon="📈"
                  />
                ) : (
                  <div className="investments-card-list">
                    {positions.map((item) => {
                      const profit = item.currentValue - item.investedAmount;
                      const profitRate = item.investedAmount > 0 ? profit / item.investedAmount : 0;
                      return (
                        <article key={item.id} className="investments-card">
                          <div className="investments-card-head">
                            <div>
                              <h4>{item.name}</h4>
                              <p>
                                {POSITION_CATEGORY_LABELS[item.category]}
                                {item.platform ? ` · ${item.platform}` : ''}
                              </p>
                            </div>
                            <div className="investments-card-badges">
                              <span className="badge">{RISK_LEVEL_LABELS[item.riskLevel]}</span>
                              {!item.isActive ? <span className="badge">已归档</span> : null}
                            </div>
                          </div>

                          <div className="investments-card-grid" aria-label="持仓摘要">
                            <span>
                              <em>本金</em>
                              <strong>{formatCurrency(item.investedAmount)}</strong>
                            </span>
                            <span>
                              <em>现值</em>
                              <strong>{formatCurrency(item.currentValue)}</strong>
                            </span>
                            <span>
                              <em>收益</em>
                              <strong className={profit >= 0 ? 'positive' : 'negative'}>
                                {formatCurrency(profit)} / {(profitRate * 100).toFixed(1)}%
                              </strong>
                            </span>
                            <span>
                              <em>月投入</em>
                              <strong>
                                {item.monthlyContribution
                                  ? formatCurrency(item.monthlyContribution)
                                  : '未设置'}
                              </strong>
                            </span>
                          </div>

                          <div className="investments-actions-inline">
                            <button
                              type="button"
                              className="button-with-icon"
                              onClick={() => {
                                setEditingPositionId(item.id);
                                setOpenInvestmentPanels((prev) => ({ ...prev, position: true }));
                                setPositionError('');
                                setPositionForm({
                                  name: item.name,
                                  category: item.category,
                                  platform: item.platform || '',
                                  linkedAccountId: item.linkedAccountId || '',
                                  investedAmount: String(item.investedAmount),
                                  currentValue: String(item.currentValue),
                                  monthlyContribution: item.monthlyContribution
                                    ? String(item.monthlyContribution)
                                    : '',
                                  targetAllocation: item.targetAllocation
                                    ? String(item.targetAllocation)
                                    : '',
                                  riskLevel: item.riskLevel,
                                  note: item.note || '',
                                  isActive: item.isActive
                                });
                              }}
                            >
                              <img src={PEN_TOOL_ICON_URL} alt="" aria-hidden="true" />
                              编辑
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => setPendingDeletePositionId(item.id)}
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                <div className="investments-list-head investments-history-head">
                  <div>
                    <h4>持仓流水</h4>
                    <span>记录新增、调仓、市值更新和移除动作，像交易流水一样可回看。</span>
                  </div>
                  <span>{investmentPositionHistory.length} 条</span>
                </div>
                {latestInvestmentPositionHistory.length === 0 ? (
                  <div className="investments-history-empty">
                    <strong>还没有持仓流水</strong>
                    <span>新增或编辑持仓后，这里会自动沉淀历史记录。</span>
                  </div>
                ) : (
                  <div className="investments-history-table" role="table" aria-label="持仓流水">
                    <div className="investments-history-row is-head" role="row">
                      <span role="columnheader">时间</span>
                      <span role="columnheader">动作 / 标的</span>
                      <span role="columnheader">当前市值</span>
                      <span role="columnheader">市值变化</span>
                      <span role="columnheader">收益</span>
                    </div>
                    {latestInvestmentPositionHistory.map((item) => (
                      <div key={item.id} className="investments-history-row" role="row">
                        <span role="cell" className="investments-history-date">
                          {formatDateTimeLabel(item.createdAt)}
                        </span>
                        <span role="cell" className="investments-history-asset">
                          <strong>{item.positionName}</strong>
                          <small>
                            {POSITION_HISTORY_ACTION_LABELS[item.action]} ·{' '}
                            {POSITION_CATEGORY_LABELS[item.category]}
                            {item.platform ? ` · ${item.platform}` : ''}
                          </small>
                        </span>
                        <span role="cell">
                          <strong>{formatCurrency(item.currentValue)}</strong>
                          <small>本金 {formatCurrency(item.investedAmount)}</small>
                        </span>
                        <span
                          role="cell"
                          className={
                            item.currentValueDelta && item.currentValueDelta < 0
                              ? 'negative'
                              : item.currentValueDelta && item.currentValueDelta > 0
                                ? 'positive'
                                : ''
                          }
                        >
                          {formatSignedCurrency(item.currentValueDelta)}
                        </span>
                        <span role="cell" className={item.profit >= 0 ? 'positive' : 'negative'}>
                          {formatCurrency(item.profit)}
                          <small>{(item.profitRate * 100).toFixed(1)}%</small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>

            <article
              className={`panel investments-panel investments-fold-card ${openInvestmentPanels.goal ? 'is-open' : ''}`}
            >
              <button
                type="button"
                className="investments-section-head investments-fold-head"
                aria-expanded={openInvestmentPanels.goal}
                onClick={() => toggleInvestmentPanel('goal')}
              >
                <span>
                  <h3>{editingGoalId ? '编辑理财目标' : '新增理财目标'}</h3>
                  <p>
                    {goals.length} 个目标 · 缺口 {formatCurrencyAuto(goalSummary.totalGap)}
                  </p>
                </span>
                <span className="investments-fold-side">
                  <span className="badge">{editingGoalId ? '编辑中' : '新增'}</span>
                  <img
                    src={
                      openInvestmentPanels.goal
                        ? CHEVRONS_DOWN_UP_ICON_URL
                        : CHEVRONS_UP_DOWN_ICON_URL
                    }
                    alt=""
                    aria-hidden="true"
                  />
                </span>
              </button>

              <div className="investments-fold-body">
                <form className="investments-form" onSubmit={submitGoal}>
                  <div className="investments-form-grid investments-form-grid-primary">
                    <label className="investments-field">
                      <span>目标名称</span>
                      <input
                        value={goalForm.name}
                        onChange={(event) =>
                          setGoalForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                        placeholder="例如：6 个月应急金"
                      />
                    </label>
                    <label className="investments-field">
                      <span>目标类型</span>
                      <select
                        value={goalForm.kind}
                        onChange={(event) =>
                          setGoalForm((prev) => ({
                            ...prev,
                            kind: event.target.value as InvestmentGoalKind
                          }))
                        }
                      >
                        {Object.entries(GOAL_KIND_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="investments-field">
                      <span>优先级</span>
                      <select
                        value={goalForm.priority}
                        onChange={(event) =>
                          setGoalForm((prev) => ({
                            ...prev,
                            priority: event.target.value as InvestmentGoalPriority
                          }))
                        }
                      >
                        {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="investments-form-grid">
                    <label className="investments-field">
                      <span>目标金额</span>
                      <input
                        inputMode="decimal"
                        value={goalForm.targetAmount}
                        onChange={(event) =>
                          setGoalForm((prev) => ({ ...prev, targetAmount: event.target.value }))
                        }
                        placeholder="0"
                      />
                    </label>
                    <label className="investments-field">
                      <span>当前进度金额</span>
                      <input
                        inputMode="decimal"
                        value={goalForm.currentAmount}
                        onChange={(event) =>
                          setGoalForm((prev) => ({ ...prev, currentAmount: event.target.value }))
                        }
                        placeholder="0"
                      />
                    </label>
                    <label className="investments-field">
                      <span>计划月投入</span>
                      <input
                        inputMode="decimal"
                        value={goalForm.monthlyContribution}
                        onChange={(event) =>
                          setGoalForm((prev) => ({
                            ...prev,
                            monthlyContribution: event.target.value
                          }))
                        }
                        placeholder="可留空"
                      />
                    </label>
                    <label className="investments-field">
                      <span>目标日期</span>
                      <input
                        type="date"
                        value={goalForm.targetDate}
                        onChange={(event) =>
                          setGoalForm((prev) => ({ ...prev, targetDate: event.target.value }))
                        }
                      />
                    </label>
                  </div>

                  <label className="investments-field investments-field-wide">
                    <span>备注（可选）</span>
                    <textarea
                      rows={3}
                      value={goalForm.note}
                      onChange={(event) =>
                        setGoalForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                      placeholder="例如：这笔钱不想承担太大波动，所以先放低风险桶里。"
                    />
                  </label>

                  {goalError ? <p className="assistant-wb-issue error">{goalError}</p> : null}

                  <div className="investments-actions-row">
                    <button type="submit" className="primary">
                      {editingGoalId ? '保存目标' : '新增目标'}
                    </button>
                    {editingGoalId ? (
                      <button type="button" onClick={resetGoalForm}>
                        取消编辑
                      </button>
                    ) : null}
                  </div>
                </form>

                <div className="investments-list-head">
                  <h4>理财目标</h4>
                  <span>{goals.length} 个</span>
                </div>

                {goals.length === 0 ? (
                  <EmptyState
                    title="还没有理财目标"
                    description="先建一个应急金或中短期目标，后面页面给出的提醒会更贴近你的现实需求。"
                    icon="🎯"
                  />
                ) : (
                  <div className="investments-card-list">
                    {goalSummary.rows.map((item) => (
                      <article key={item.id} className="investments-card">
                        <div className="investments-card-head">
                          <div>
                            <h4>{item.name}</h4>
                            <p>
                              {GOAL_KIND_LABELS[item.kind]} · {PRIORITY_LABELS[item.priority]}
                            </p>
                          </div>
                          <div className="investments-card-badges">
                            <span className="badge">
                              {item.targetDate
                                ? `目标日 ${formatDate(item.targetDate)}`
                                : '未设日期'}
                            </span>
                          </div>
                        </div>

                        <div className="investments-goal-progress">
                          <div className="investments-goal-progress-head">
                            <strong>{formatCurrency(item.currentAmount)}</strong>
                            <span>目标 {formatCurrency(item.targetAmount)}</span>
                          </div>
                          <div className="investments-allocation-track" aria-hidden="true">
                            <i style={{ width: `${Math.max(6, item.progress * 100)}%` }} />
                          </div>
                          <p className="muted">
                            已完成 {(item.progress * 100).toFixed(1)}%，还差{' '}
                            {formatCurrency(item.gap)}
                            {item.monthlyContribution
                              ? ` · 计划每月投入 ${formatCurrency(item.monthlyContribution)}`
                              : ''}
                          </p>
                        </div>

                        {item.note ? <p className="investments-card-note">{item.note}</p> : null}

                        <div className="investments-actions-inline">
                          <button
                            type="button"
                            className="button-with-icon"
                            onClick={() => {
                              setEditingGoalId(item.id);
                              setOpenInvestmentPanels((prev) => ({ ...prev, goal: true }));
                              setGoalError('');
                              setGoalForm({
                                name: item.name,
                                kind: item.kind,
                                targetAmount: String(item.targetAmount),
                                currentAmount: String(item.currentAmount),
                                monthlyContribution: item.monthlyContribution
                                  ? String(item.monthlyContribution)
                                  : '',
                                targetDate: item.targetDate || '',
                                priority: item.priority,
                                note: item.note || ''
                              });
                            }}
                          >
                            <img src={PEN_TOOL_ICON_URL} alt="" aria-hidden="true" />
                            编辑
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => setPendingDeleteGoalId(item.id)}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </article>
          </section>
        </aside>
      </section>

      {watchContextMenu.open && watchContextMenu.item ? (
        <div
          className="investments-watch-context-menu"
          role="menu"
          style={{ left: watchContextMenu.x, top: watchContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (watchContextMenu.item) {
                handleAddWatchItemToPosition(watchContextMenu.item);
              }
            }}
          >
            <strong>添加到持仓</strong>
            <span>带入名称、平台、风险与建议</span>
          </button>
        </div>
      ) : null}

      <Toast
        visible={toast.visible}
        message={toast.message}
        variant={toast.variant}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <ConfirmDialog
        open={Boolean(pendingDeletePosition)}
        title="删除持仓"
        description={
          pendingDeletePosition ? (
            <>
              确认删除「<strong>{pendingDeletePosition.name}</strong>
              」吗？删除后当前配置、收益和提醒都会一起更新。
            </>
          ) : (
            ''
          )
        }
        confirmText="删除持仓"
        cancelText="取消"
        danger
        onCancel={() => setPendingDeletePositionId(null)}
        onConfirm={() => {
          if (pendingDeletePosition) {
            removeInvestmentPosition(pendingDeletePosition.id);
            if (editingPositionId === pendingDeletePosition.id) {
              resetPositionForm();
            }
          }
          setPendingDeletePositionId(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteGoal)}
        title="删除目标"
        description={
          pendingDeleteGoal ? (
            <>
              确认删除「<strong>{pendingDeleteGoal.name}</strong>
              」吗？删掉后这条目标进度和相关提醒会一起消失。
            </>
          ) : (
            ''
          )
        }
        confirmText="删除目标"
        cancelText="取消"
        danger
        onCancel={() => setPendingDeleteGoalId(null)}
        onConfirm={() => {
          if (pendingDeleteGoal) {
            removeInvestmentGoal(pendingDeleteGoal.id);
            if (editingGoalId === pendingDeleteGoal.id) {
              resetGoalForm();
            }
          }
          setPendingDeleteGoalId(null);
        }}
      />
    </div>
  );
}
