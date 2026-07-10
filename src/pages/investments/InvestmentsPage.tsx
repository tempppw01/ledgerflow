import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account } from '../../entities/account/types';
import type {
  InvestmentCategory,
  InvestmentFundAnalysis,
  InvestmentPosition,
  InvestmentPositionHistoryEntry,
  InvestmentRiskLevel,
  InvestmentWatchItem,
  InvestmentWatchlistReviewItem
} from '../../entities/investment/types';
import { sendAiChatStream } from '../../features/assistant/api/openaiCompatibleClient';
import { fetchEastmoneyFundSnapshot } from '../../features/investments/api/eastmoneyFundClient';
import { BRAIN_ICON_URL, INFO_ICON_URL, PEN_TOOL_ICON_URL } from '../../shared/config/brandAssets';
import { formatCurrency, formatCurrencyAuto } from '../../shared/lib/format';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { Toast, type ToastVariant } from '../../shared/ui/Toast';
import { buildInvestmentWatchlistReviewPrompt, extractInvestmentWatchlistReview } from './investmentAi';
import {
  ASSISTANT_ACTIVE_MODE_STORAGE_KEY,
  ASSISTANT_MODE_CHANGED_EVENT
} from '../../features/assistant/shared/assistantMode';

const POSITION_CATEGORY_LABELS: Record<InvestmentCategory, string> = {
  cash: '现金理财',
  'fixed-income': '固收',
  'index-fund': '指数基金',
  'active-fund': '主动基金',
  stock: '股票',
  gold: '黄金',
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
  action?: 'open-investment-assistant';
};

type WatchContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  item: InvestmentWatchItem | null;
};

type QuickActionsMenuState = {
  open: boolean;
  x: number;
  y: number;
};

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
  totalCurrentValue: number;
  cashBucketValue: number;
  monthlyInvestableCash: number;
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
        hint: '直接去记账助手里的投资理财页提问，先拿到一轮分析再决定。',
        action: 'open-investment-assistant'
      }
    ];
  }

  return [
    {
      label: '继续跟进持仓配置',
      hint: '直接去记账助手里的投资理财页问一只基金值不值得继续跟。',
      action: 'open-investment-assistant'
    },
    {
      label: '回交易页核对现金流',
      hint: '每月理财投入最好和真实结余对得上，不要只看想法。',
      to: '/transactions'
    }
  ];
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

function normalizeInvestmentLookupValue(value?: string) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function findPositionForWatchItem(
  item: InvestmentWatchItem,
  positions: InvestmentPosition[]
): InvestmentPosition | null {
  const code = normalizeInvestmentLookupValue(item.code);
  const name = normalizeInvestmentLookupValue(item.name);

  return (
    positions.find((position) => {
      const positionName = normalizeInvestmentLookupValue(position.name);
      if (code && positionName.includes(code)) return true;
      if (!name) return false;
      return positionName.includes(name) || name.includes(positionName);
    }) || null
  );
}

function getWatchItemHoldingReturn(
  item: InvestmentWatchItem,
  positions: InvestmentPosition[]
): string | null {
  const matchedPosition = findPositionForWatchItem(item, positions);
  if (!matchedPosition) return null;

  const profit = matchedPosition.currentValue - matchedPosition.investedAmount;
  const profitRate =
    matchedPosition.investedAmount > 0 ? profit / matchedPosition.investedAmount : 0;

  return `${formatCurrency(profit)} / ${(profitRate * 100).toFixed(1)}%`;
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
          netValue: review.netValue || item.netValue,
          addedReturn: review.addedReturn || item.addedReturn,
          holdingReturn: review.holdingReturn || item.holdingReturn,
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
  const investmentWatchlist = useAppPreferences((state) => state.investmentWatchlist);
  const debts = useAppPreferences((state) => state.debts);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const addInvestmentPosition = useAppPreferences((state) => state.addInvestmentPosition);
  const updateInvestmentPosition = useAppPreferences((state) => state.updateInvestmentPosition);
  const removeInvestmentPosition = useAppPreferences((state) => state.removeInvestmentPosition);
  const ensureInvestmentPositionHistory = useAppPreferences(
    (state) => state.ensureInvestmentPositionHistory
  );
  const removeInvestmentWatchItem = useAppPreferences((state) => state.removeInvestmentWatchItem);
  const upsertInvestmentWatchItem = useAppPreferences((state) => state.upsertInvestmentWatchItem);
  const setInvestmentWatchlist = useAppPreferences((state) => state.setInvestmentWatchlist);
  const { baseUrl, apiKey, model } = useAiSettings();

  const [positionForm, setPositionForm] = useState(POSITION_FORM_DEFAULT);
  const [positionError, setPositionError] = useState('');
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [pendingDeletePositionId, setPendingDeletePositionId] = useState<string | null>(null);
  const [watchlistReviewStatus, setWatchlistReviewStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [watchlistReviewError, setWatchlistReviewError] = useState('');
  const [fundLookupCode, setFundLookupCode] = useState('');
  const [fundLookupStatus, setFundLookupStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fundLookupError, setFundLookupError] = useState('');
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
  const [quickActionsMenu, setQuickActionsMenu] = useState<QuickActionsMenuState>({
    open: false,
    x: 0,
    y: 0
  });
  const [expandedWatchItemId, setExpandedWatchItemId] = useState<string | null>(null);

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
        totalCurrentValue: positionSummary.totalCurrentValue,
        cashBucketValue,
        monthlyInvestableCash
      }),
    [activePositions, cashBucketValue, monthlyInvestableCash, positionSummary.totalCurrentValue]
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

  const hasInvestmentSummary =
    activePositions.length > 0 ||
    positionSummary.totalCurrentValue > 0 ||
    positionSummary.totalInvested > 0;

  const pendingDeletePosition = useMemo(
    () => positions.find((item) => item.id === pendingDeletePositionId) ?? null,
    [pendingDeletePositionId, positions]
  );

  const latestInvestmentPositionHistory = useMemo(
    () => investmentPositionHistory.slice(0, 24),
    [investmentPositionHistory]
  );

  useEffect(() => {
    if (positions.length > 0 && investmentPositionHistory.length === 0) {
      ensureInvestmentPositionHistory();
    }
  }, [ensureInvestmentPositionHistory, investmentPositionHistory.length, positions.length]);

  useEffect(() => {
    if (!watchContextMenu.open && !quickActionsMenu.open) return;

    const closeMenu = () => {
      setWatchContextMenu((prev) => ({
        ...prev,
        open: false,
        item: null
      }));
      setQuickActionsMenu((prev) => ({ ...prev, open: false }));
    };
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
  }, [quickActionsMenu.open, watchContextMenu.open]);

  function resetPositionForm() {
    setPositionForm(POSITION_FORM_DEFAULT);
    setEditingPositionId(null);
    setPositionError('');
  }

  function setToastState(message: string, variant: ToastVariant = 'success') {
    setToast({ visible: true, message, variant });
  }

  function closeWatchContextMenu() {
    setWatchContextMenu((prev) => ({
      ...prev,
      open: false,
      item: null
    }));
  }

  function closeQuickActionsMenu() {
    setQuickActionsMenu((prev) => ({ ...prev, open: false }));
  }

  function scrollToPositionForm() {
    document.querySelector<HTMLElement>('.investments-main-grid')?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start'
    });
  }

  function openQuickActionsMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 240;
    const menuHeight = 148;
    const x = Math.min(event.clientX, Math.max(12, window.innerWidth - menuWidth));
    const y = Math.min(event.clientY, Math.max(12, window.innerHeight - menuHeight));

    closeWatchContextMenu();
    setQuickActionsMenu({ open: true, x, y });
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
    closeQuickActionsMenu();
  }

  function handleAddWatchItemToPosition(item: InvestmentWatchItem) {
    setEditingPositionId(null);
    setPositionError('');
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

  function handleFollowWatchItem(item: InvestmentWatchItem) {
    const nextTags = Array.from(new Set(['关注中', ...(item.tags || [])])).slice(0, 6);
    upsertInvestmentWatchItem({
      ...item,
      tags: nextTags,
      lastVerdict: item.lastVerdict || '已加入关注',
      investmentAdvice: item.investmentAdvice || '先加入关注列表，后续再决定是否加仓。',
      updatedAt: new Date().toISOString()
    });
    setToastState(`已把“${item.name}”加入关注。`);
  }

  async function handleRefreshWatchItem(item: InvestmentWatchItem) {
    if (!item.code) {
      setToastState('这只基金没有代码，暂时无法刷新。', 'warning');
      return;
    }

    try {
      const snapshot = await fetchEastmoneyFundSnapshot(item.code);
      const estimatedChange = snapshot.estimatedChangePercent
        ? `${Number(snapshot.estimatedChangePercent) >= 0 ? '+' : ''}${snapshot.estimatedChangePercent}%`
        : '';

      upsertInvestmentWatchItem({
        ...item,
        name: snapshot.name || item.name,
        code: snapshot.code || item.code,
        platform: item.platform || '东方财富',
        lastSummary:
          [
            snapshot.netValue ? `单位净值 ${snapshot.netValue}` : '',
            estimatedChange ? `估算涨跌 ${estimatedChange}` : '',
            snapshot.buyFeeRate ? `申购费率 ${snapshot.buyFeeRate}` : ''
          ]
            .filter(Boolean)
            .join(' · ') || item.lastSummary,
        performanceHistory: snapshot.performanceHistory.length
          ? snapshot.performanceHistory
          : item.performanceHistory,
        fundAnalysis: snapshot.fundAnalysis.length ? snapshot.fundAnalysis : item.fundAnalysis,
        fundHoldings: snapshot.fundHoldings.length ? snapshot.fundHoldings : item.fundHoldings,
        assetAllocation: snapshot.assetAllocation.length ? snapshot.assetAllocation : item.assetAllocation,
        netValue: snapshot.netValue || item.netValue,
        addedReturn: estimatedChange || item.addedReturn,
        buyFeeRate: snapshot.buyFeeRate || item.buyFeeRate,
        lastAnalysisAt: new Date().toISOString()
      });
      setToastState(`已刷新“${snapshot.name || item.name}”。`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取更新失败，请稍后再试。';
      setToastState(message, 'warning');
    }
  }

  function handleActionSuggestionClick(item: ActionSuggestion) {
    closeQuickActionsMenu();
    if (item.action === 'open-investment-assistant') {
      try {
        window.sessionStorage.setItem(ASSISTANT_ACTIVE_MODE_STORAGE_KEY, 'investment');
      } catch {
        // ignore storage write errors
      }
      window.dispatchEvent(
        new CustomEvent(ASSISTANT_MODE_CHANGED_EVENT, { detail: { mode: 'investment' } })
      );
      navigate('/assistant');
      return;
    }

    if (item.to) {
      navigate(item.to);
    }
  }

  async function handleFundLookupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fundLookupStatus === 'loading') return;

    const code = fundLookupCode.replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) {
      setFundLookupStatus('error');
      setFundLookupError('请输入 6 位基金代码。');
      return;
    }

    setFundLookupStatus('loading');
    setFundLookupError('');

    try {
      const snapshot = await fetchEastmoneyFundSnapshot(code);
      const existing = investmentWatchlist.find((item) => item.code === snapshot.code);
      const estimatedChange = snapshot.estimatedChangePercent
        ? `${Number(snapshot.estimatedChangePercent) >= 0 ? '+' : ''}${snapshot.estimatedChangePercent}%`
        : '';

      upsertInvestmentWatchItem({
        id: existing?.id,
        name: snapshot.name,
        code: snapshot.code,
        platform: existing?.platform || '东方财富',
        tags: existing?.tags?.length ? existing.tags : ['东方财富'],
        note: snapshot.estimatedAt ? `东方财富更新于 ${snapshot.estimatedAt}` : existing?.note,
        lastVerdict: existing?.lastVerdict || '已接入东方财富资料',
        lastSummary:
          [
            snapshot.netValue ? `单位净值 ${snapshot.netValue}` : '',
            estimatedChange ? `估算涨跌 ${estimatedChange}` : '',
            snapshot.buyFeeRate ? `申购费率 ${snapshot.buyFeeRate}` : ''
          ]
            .filter(Boolean)
            .join(' · ') || existing?.lastSummary,
        lastRiskLevel: existing?.lastRiskLevel || 'unknown',
        investmentAdvice: existing?.investmentAdvice || '先加入自选观察，再结合持仓和风险偏好决定。',
        adviceReasons: existing?.adviceReasons || [],
        riskNotes: existing?.riskNotes || [],
        nextActions: existing?.nextActions || ['在投资理财助手中继续分析这只基金'],
        performanceHistory: snapshot.performanceHistory.length
          ? snapshot.performanceHistory
          : existing?.performanceHistory,
        fundAnalysis: snapshot.fundAnalysis.length ? snapshot.fundAnalysis : existing?.fundAnalysis,
        fundHoldings: snapshot.fundHoldings.length ? snapshot.fundHoldings : existing?.fundHoldings || [],
        assetAllocation: snapshot.assetAllocation.length ? snapshot.assetAllocation : existing?.assetAllocation || [],
        industryAllocation: existing?.industryAllocation || [],
        netValue: snapshot.netValue || existing?.netValue,
        addedReturn: estimatedChange || existing?.addedReturn,
        holdingReturn: existing?.holdingReturn,
        buyFeeRate: snapshot.buyFeeRate || existing?.buyFeeRate,
        fundCompany: existing?.fundCompany,
        lastAnalysisAt: new Date().toISOString(),
        createdAt: existing?.createdAt,
        updatedAt: existing?.updatedAt
      });

      setFundLookupCode('');
      setFundLookupStatus('idle');
      setToastState(`已从东方财富添加“${snapshot.name}”。`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '基金资料获取失败，请稍后重试。';
      setFundLookupStatus('error');
      setFundLookupError(message);
      setToastState(message, 'warning');
    }
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

  return (
    <div className="page-stack investments-page investments-management-page">
      <section className="investments-management-grid">
        <aside className="investments-management-column investments-support-column">
          <section
            className="panel investments-hero investments-flat-section investments-support-summary-card"
          >
            <div className="investments-flat-head">
              <div>
                {!hasInvestmentSummary ? <p>先添加基金代码或第一笔持仓。</p> : null}
              </div>
              <span className="badge">{activePositions.length} 笔持仓</span>
            </div>

            {hasInvestmentSummary ? (
              <>
                <div className="investments-flat-summary" aria-label="投资资产总览">
                  <article className="investments-flat-metric is-primary">
                    <span>总市值</span>
                    <strong>{formatCurrencyAuto(positionSummary.totalCurrentValue)}</strong>
                  </article>
                  <article
                    className={`investments-flat-metric is-primary ${
                      positionSummary.totalProfit >= 0 ? 'is-positive' : 'is-negative'
                    }`}
                  >
                    <span>浮动收益</span>
                    <strong>
                      {formatCurrencyAuto(positionSummary.totalProfit)} /{' '}
                      {(positionSummary.profitRate * 100).toFixed(1)}%
                    </strong>
                  </article>
                  <article className="investments-flat-metric is-primary">
                    <span>本月可投</span>
                    <strong>{formatCurrencyAuto(monthlyInvestableCash)}</strong>
                  </article>
                </div>

                <div className="investments-flat-mini-grid investments-flat-mini-grid-compact">
                  <span>
                    <em>本金</em>
                    <strong>{formatCurrencyAuto(positionSummary.totalInvested)}</strong>
                  </span>
                  <span>
                    <em>净资产占比</em>
                    <strong>{(investmentAssetRatio * 100).toFixed(1)}%</strong>
                  </span>
                </div>
              </>
            ) : (
              <div className="investments-watchlist-empty investments-summary-empty">
                <strong>先录一笔，再看总览</strong>
                <p>基金代码和持仓都能接进来，录入后这里才会展开成配置总览。</p>
              </div>
            )}

            <div className="investments-flat-actions">
              <button
                type="button"
                className="button-with-icon primary"
                onClick={() => navigate('/investments/flow')}
              >
                <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                投资风向
              </button>
              <button
                type="button"
                className="button-with-icon"
                onClick={scrollToPositionForm}
              >
                <img src={PEN_TOOL_ICON_URL} alt="" aria-hidden="true" />
                新增持仓
              </button>
            </div>
          </section>

          <aside
            className="panel investments-watchlist-panel"
            data-investment-support-title="基金自选"
          >
            <div className="investments-section-head investments-watchlist-head">
              <div>
                <h3>基金自选</h3>
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
                  {watchlistReviewStatus === 'loading' ? '分析中' : 'AI 排序'}
                </button>
                <button
                  type="button"
                  className="button-with-icon investments-watchlist-flow-btn"
                  onClick={() => navigate('/investments/flow')}
                >
                  <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                  投资风向
                </button>
              </div>
            </div>

            {watchlistReviewError ? (
              <p className="investments-watchlist-review-error">{watchlistReviewError}</p>
            ) : null}

            <form className="investments-fund-lookup" onSubmit={handleFundLookupSubmit}>
              <label htmlFor="investment-fund-code">添加基金代码</label>
              <div className="investments-fund-lookup-row">
                <input
                  id="investment-fund-code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={fundLookupCode}
                  placeholder="例如 161725"
                  onChange={(event) => {
                    setFundLookupCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                    if (fundLookupError) setFundLookupError('');
                    if (fundLookupStatus === 'error') setFundLookupStatus('idle');
                  }}
                  disabled={fundLookupStatus === 'loading'}
                />
                <button
                  type="submit"
                  className="button-with-icon primary"
                  disabled={fundLookupStatus === 'loading' || fundLookupCode.length < 6}
                >
                  <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                  {fundLookupStatus === 'loading' ? '获取中' : '获取资料'}
                </button>
              </div>
              <p className={fundLookupError ? 'investments-fund-lookup-error' : ''}>
                {fundLookupError || '从东方财富读取净值、估算涨跌、费率和近期表现，添加到自选基金。'}
              </p>
            </form>

            {investmentWatchlist.length === 0 ? (
              <div className="investments-watchlist-empty">
                <strong>还没有自选基金</strong>
                <p>分析后觉得值得跟踪，就加入这里。</p>
              </div>
            ) : (
              <div className="investments-watchlist-list">
                {investmentWatchlist.map((item) => {
                  const isExpanded = expandedWatchItemId === item.id;
                  const detailSections = compactWatchDetailSections(item);
                  const primaryTag = item.tags[0];
                  const holdingsPreview = item.fundHoldings?.slice(0, 2) || [];
                  const assetAllocationPreview = item.assetAllocation?.slice(0, 2) || [];
                  const holdingReturn =
                    item.holdingReturn || getWatchItemHoldingReturn(item, activePositions);

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
                            className="danger investments-watch-card-remove"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeInvestmentWatchItem(item.id);
                            }}
                            aria-label={`移除 ${item.name}`}
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
                      <div className="investments-watch-card-mini-stats" aria-label="基金关键数据">
                        <span>
                          <em>净值</em>
                          <strong>{item.netValue || '待更新'}</strong>
                        </span>
                        <span>
                          <em>收益</em>
                          <strong>{item.addedReturn || '待更新'}</strong>
                        </span>
                        <span>
                          <em>持有</em>
                          <strong>{holdingReturn || '待更新'}</strong>
                        </span>
                        <span>
                          <em>重仓</em>
                          <strong>{holdingsPreview.length > 0 ? holdingsPreview.join(' / ') : '待更新'}</strong>
                        </span>
                        <span>
                          <em>资产</em>
                          <strong>
                            {assetAllocationPreview.length > 0
                              ? assetAllocationPreview.join(' / ')
                              : '待更新'}
                          </strong>
                        </span>
                      </div>
                      <div className="investments-watch-card-ai-actions">
                        <button
                          type="button"
                          className="investments-watch-follow-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleFollowWatchItem(item);
                          }}
                        >
                          添加关注
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRefreshWatchItem(item);
                          }}
                        >
                          获取更新
                        </button>
                      </div>
                      <div className="investments-watch-card-meta">
                        <span>
                          {item.lastAnalysisAt
                            ? `更新于 ${formatDateTimeLabel(item.lastAnalysisAt)}`
                            : '暂未分析'}
                        </span>
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
                              暂无更多资料。
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
              className="panel investments-overview-card investments-flat-section"
              data-investment-support-title="当前配置"
            >
              <div className="investments-section-head investments-flat-head">
                <div>
                  <h3>当前配置</h3>
                  <p>
                    市值 {formatCurrencyAuto(positionSummary.totalCurrentValue)} ·{' '}
                    {activePositions.length} 笔持仓
                  </p>
                </div>
                <span className="badge">{activePositions.length} 笔</span>
              </div>

              <div className="investments-flat-body">
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

                {hasInvestmentSummary ? (
                    <div className="investments-meta-grid investments-meta-grid-compact">
                      <div>
                        <span>计划月投入</span>
                        <strong>
                          {formatCurrency(positionSummary.totalMonthlyContribution)}
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
                ) : null}
              </div>
            </article>

            <article
              className="panel investments-overview-card investments-flat-section"
              data-investment-support-title="当前提醒"
            >
              <div className="investments-section-head investments-flat-head">
                <div>
                  <h3>当前提醒</h3>
                  <p>
                    {investmentAlerts[0]?.title || '暂无提醒'} · {actionSuggestions.length} 个动作
                  </p>
                </div>
                <span className="badge">{investmentAlerts.length} 条</span>
              </div>

              <div className="investments-flat-body">
                <div className="investments-alert-list">
                  {investmentAlerts.slice(0, 2).map((item) => (
                    <article
                      key={item.title}
                      className={`investments-alert-card tone-${item.tone}`}
                    >
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </article>
                  ))}
                </div>

                <button
                  type="button"
                  className="investments-quick-actions-trigger"
                  onClick={openQuickActionsMenu}
                  onContextMenu={openQuickActionsMenu}
                >
                  顺手下一步
                </button>
              </div>
            </article>
          </section>

          <section className="investments-main-grid">
            <article
              className="panel investments-panel investments-flat-section"
              data-investment-support-title={editingPositionId ? '编辑持仓' : '新增持仓'}
            >
              <div className="investments-section-head investments-flat-head">
                <div>
                  <h3>{editingPositionId ? '编辑持仓' : '新增持仓'}</h3>
                </div>
                <span className="badge">{editingPositionId ? '编辑中' : '新增'}</span>
              </div>

              <div className="investments-flat-body">
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

      {quickActionsMenu.open ? (
        <div
          className="investments-quick-actions-menu"
          role="menu"
          style={{ left: quickActionsMenu.x, top: quickActionsMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {actionSuggestions.map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={() => handleActionSuggestionClick(item)}>
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
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

    </div>
  );
}
