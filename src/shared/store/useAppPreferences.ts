import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppAccentTheme, AppTheme } from '../types/app';
import {
  InvestmentAiMessage,
  InvestmentGoal,
  InvestmentFundAnalysis,
  InvestmentPosition,
  InvestmentPositionHistoryAction,
  InvestmentPositionHistoryEntry,
  InvestmentWatchItem
} from '../../entities/investment/types';
import {
  DebtItem,
  DebtLifecycleStatus,
  DebtType,
  ManualRepaymentItem,
  RepaymentRecord
} from '../../features/debt/model/debtMetrics';

export type RssSubscription = {
  id: string;
  title: string;
  url: string;
  enabled: boolean;
};

const DEFAULT_RSS_SUBSCRIPTIONS: RssSubscription[] = [
  {
    id: 'rss-financial-times-markets',
    title: 'Financial Times · Markets',
    url: 'https://www.ft.com/markets?format=rss',
    enabled: true
  },
  {
    id: 'rss-yahoo-finance-top',
    title: 'Yahoo Finance · Top News',
    url: 'https://finance.yahoo.com/news/rssindex',
    enabled: true
  }
];

interface AppPreferencesState {
  theme: AppTheme;
  accentTheme: AppAccentTheme;
  rssSubscriptions: RssSubscription[];
  investmentPositions: InvestmentPosition[];
  investmentPositionHistory: InvestmentPositionHistoryEntry[];
  investmentGoals: InvestmentGoal[];
  investmentWatchlist: InvestmentWatchItem[];
  investmentAiMessages: InvestmentAiMessage[];
  debts: DebtItem[];
  repaymentRecords: RepaymentRecord[];
  monthlyIncome: number;
  setTheme: (theme: AppTheme) => void;
  setAccentTheme: (accentTheme: AppAccentTheme) => void;
  addRssSubscription: (payload: { title: string; url: string }) => { ok: boolean; reason?: string };
  removeRssSubscription: (id: string) => void;
  toggleRssSubscription: (id: string) => void;
  addInvestmentPosition: (
    payload: Omit<InvestmentPosition, 'id' | 'createdAt' | 'updatedAt'>
  ) => void;
  updateInvestmentPosition: (
    id: string,
    payload: Omit<InvestmentPosition, 'id' | 'createdAt' | 'updatedAt'>
  ) => void;
  removeInvestmentPosition: (id: string) => void;
  ensureInvestmentPositionHistory: () => void;
  addInvestmentGoal: (payload: Omit<InvestmentGoal, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateInvestmentGoal: (
    id: string,
    payload: Omit<InvestmentGoal, 'id' | 'createdAt' | 'updatedAt'>
  ) => void;
  removeInvestmentGoal: (id: string) => void;
  upsertInvestmentWatchItem: (
    payload: Omit<InvestmentWatchItem, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
      createdAt?: string;
      updatedAt?: string;
    }
  ) => void;
  removeInvestmentWatchItem: (id: string) => void;
  setInvestmentWatchlist: (items: InvestmentWatchItem[]) => void;
  setInvestmentAiMessages: (messages: InvestmentAiMessage[]) => void;
  clearInvestmentAiMessages: () => void;
  replaceInvestmentData: (payload: {
    investmentPositions: InvestmentPosition[];
    investmentPositionHistory?: InvestmentPositionHistoryEntry[];
    investmentGoals: InvestmentGoal[];
    investmentWatchlist: InvestmentWatchItem[];
    investmentAiMessages: InvestmentAiMessage[];
  }) => void;
  setMonthlyIncome: (income: number) => void;
  setRepaymentState: (payload: { debts: DebtItem[]; monthlyIncome: number }) => void;
  addDebt: (payload: Omit<DebtItem, 'id'>) => void;
  replaceDebts: (payload: Omit<DebtItem, 'id'>[]) => void;
  updateDebt: (id: string, payload: Omit<DebtItem, 'id'>) => void;
  removeDebt: (id: string) => void;
  addRepaymentRecord: (payload: Omit<RepaymentRecord, 'id' | 'createdAt'>) => void;
  removeRepaymentRecord: (id: string) => void;
}

function createDebtId(type: DebtType): string {
  return createScopedId(`debt-${type}`);
}

function createRepaymentRecordId(): string {
  return createScopedId('repayment-record');
}

function createInvestmentPositionId(): string {
  return createScopedId('investment-position');
}

function createInvestmentPositionHistoryId(): string {
  return createScopedId('investment-position-history');
}

function createInvestmentGoalId(): string {
  return createScopedId('investment-goal');
}

function createInvestmentWatchItemId(): string {
  return createScopedId('investment-watch');
}

function createInvestmentAiMessageId(): string {
  return createScopedId('investment-ai-message');
}

function createScopedId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeFeedUrl(rawUrl: string): string {
  return String(rawUrl || '').trim();
}

function normalizePositiveNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Number(numeric.toFixed(2));
}

function normalizePercentage(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.min(100, Number(numeric.toFixed(1)));
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Number(numeric.toFixed(2));
}

function normalizeStringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeInvestmentAttachmentImages(value: unknown): string[] {
  return normalizeStringList(value, 4).filter((item) => item.startsWith('data:image/'));
}

function normalizeDebtStatus(status: unknown, balance?: number): DebtLifecycleStatus {
  if (status === 'settled' || status === 'closed' || status === 'paused' || status === 'active') {
    return status;
  }
  return Number(balance || 0) <= 0 ? 'settled' : 'active';
}

function normalizeManualRepaymentItem(item: ManualRepaymentItem): ManualRepaymentItem {
  const numeric = Number(item.amount);
  const dueDate = normalizeOptionalString(item.dueDate);
  const label = normalizeOptionalString(item.label);
  return {
    ...item,
    dueDate,
    amount: Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(2)) : 0,
    label
  };
}

function normalizeManualRepayments(value: unknown): ManualRepaymentItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) =>
      normalizeManualRepaymentItem({
        ...item,
        amount: Number(item?.amount || 0)
      })
    )
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0)
    .sort((a, b) => {
      const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return aDate - bDate;
    });
}

function normalizeDebtItem(item: DebtItem): DebtItem {
  const entryMode = item.entryMode === 'simple' ? 'simple' : 'standard';
  return {
    ...item,
    entryMode,
    simpleDueDate:
      entryMode === 'simple' && /^\d{4}-\d{2}-\d{2}$/.test(String(item.simpleDueDate || ''))
        ? String(item.simpleDueDate)
        : undefined,
    manualRepayments: normalizeManualRepayments(item.manualRepayments),
    status: entryMode === 'simple' ? item.status || 'active' : normalizeDebtStatus(item.status, item.balance)
  };
}

function normalizeInvestmentPosition(
  item: Omit<InvestmentPosition, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  }
): InvestmentPosition {
  const now = new Date().toISOString();

  return {
    id: item.id || createInvestmentPositionId(),
    name: String(item.name || '').trim() || '未命名持仓',
    category: item.category || 'other',
    platform: normalizeOptionalString(item.platform),
    linkedAccountId: normalizeOptionalString(item.linkedAccountId),
    investedAmount: normalizePositiveNumber(item.investedAmount),
    currentValue: normalizePositiveNumber(item.currentValue),
    fundCode: normalizeOptionalString(item.fundCode),
    holdingShares: normalizeOptionalNumber(item.holdingShares),
    monthlyContribution: normalizePositiveNumber(item.monthlyContribution) || undefined,
    targetAllocation: normalizePercentage(item.targetAllocation),
    riskLevel: item.riskLevel || 'medium',
    note: normalizeOptionalString(item.note),
    isActive: item.isActive !== false,
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now
  };
}

function normalizeDelta(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return undefined;
  return Number(numeric.toFixed(2));
}

function buildInvestmentPositionHistoryEntry(
  position: InvestmentPosition,
  action: InvestmentPositionHistoryAction,
  previous?: InvestmentPosition | null
): InvestmentPositionHistoryEntry {
  const profit = position.currentValue - position.investedAmount;
  const profitRate = position.investedAmount > 0 ? profit / position.investedAmount : 0;
  const investedAmountDelta =
    action === 'snapshot'
      ? undefined
      : action === 'remove'
        ? -position.investedAmount
        : previous
          ? position.investedAmount - previous.investedAmount
          : position.investedAmount;
  const currentValueDelta =
    action === 'snapshot'
      ? undefined
      : action === 'remove'
        ? -position.currentValue
        : previous
          ? position.currentValue - previous.currentValue
          : position.currentValue;

  return {
    id: createInvestmentPositionHistoryId(),
    positionId: position.id,
    positionName: position.name,
    category: position.category,
    platform: position.platform,
    action,
    investedAmount: position.investedAmount,
    currentValue: position.currentValue,
    profit: Number(profit.toFixed(2)),
    profitRate: Number(profitRate.toFixed(4)),
    investedAmountDelta: normalizeDelta(investedAmountDelta),
    currentValueDelta: normalizeDelta(currentValueDelta),
    isActive: position.isActive,
    note:
      action === 'snapshot'
        ? '从已有持仓生成历史快照'
        : action === 'remove'
          ? position.note || '持仓已删除'
          : position.note,
    createdAt: new Date().toISOString()
  };
}

function normalizeInvestmentPositionHistoryEntry(
  item: InvestmentPositionHistoryEntry
): InvestmentPositionHistoryEntry | null {
  if (!item || typeof item !== 'object') return null;
  const action =
    item.action === 'add' ||
    item.action === 'update' ||
    item.action === 'remove' ||
    item.action === 'snapshot'
      ? item.action
      : 'snapshot';
  const investedAmount = normalizePositiveNumber(item.investedAmount);
  const currentValue = normalizePositiveNumber(item.currentValue);
  const profit = Number.isFinite(Number(item.profit))
    ? Number(Number(item.profit).toFixed(2))
    : Number((currentValue - investedAmount).toFixed(2));
  const profitRate = Number.isFinite(Number(item.profitRate))
    ? Number(Number(item.profitRate).toFixed(4))
    : investedAmount > 0
      ? Number((profit / investedAmount).toFixed(4))
      : 0;

  return {
    id: item.id || createInvestmentPositionHistoryId(),
    positionId: String(item.positionId || '').trim() || createInvestmentPositionId(),
    positionName: String(item.positionName || '').trim() || '未命名持仓',
    category: item.category || 'other',
    platform: normalizeOptionalString(item.platform),
    action,
    investedAmount,
    currentValue,
    profit,
    profitRate,
    investedAmountDelta: normalizeDelta(item.investedAmountDelta),
    currentValueDelta: normalizeDelta(item.currentValueDelta),
    isActive: item.isActive !== false,
    note: normalizeOptionalString(item.note),
    createdAt: normalizeOptionalString(item.createdAt) || new Date().toISOString()
  };
}

function normalizeInvestmentPositionHistory(
  entries: InvestmentPositionHistoryEntry[]
): InvestmentPositionHistoryEntry[] {
  return entries
    .map((item) => normalizeInvestmentPositionHistoryEntry(item))
    .filter((item): item is InvestmentPositionHistoryEntry => Boolean(item))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 200);
}

function normalizeInvestmentGoal(
  item: Omit<InvestmentGoal, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  }
): InvestmentGoal {
  const now = new Date().toISOString();

  return {
    id: item.id || createInvestmentGoalId(),
    name: String(item.name || '').trim() || '未命名目标',
    kind: item.kind || 'other',
    targetAmount: normalizePositiveNumber(item.targetAmount),
    currentAmount: Math.max(
      0,
      Number(
        Number.isFinite(Number(item.currentAmount)) ? Number(item.currentAmount).toFixed(2) : 0
      )
    ),
    monthlyContribution: normalizePositiveNumber(item.monthlyContribution) || undefined,
    targetDate: normalizeOptionalString(item.targetDate),
    priority: item.priority || 'medium',
    note: normalizeOptionalString(item.note),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now
  };
}

function normalizeInvestmentFundAnalysis(value: unknown): InvestmentFundAnalysis | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const item = value as Partial<InvestmentFundAnalysis>;
  const verdict = String(item.verdict || '').trim();
  const summary = String(item.summary || '').trim();
  const riskLevel =
    item.riskLevel === 'low' ||
    item.riskLevel === 'medium' ||
    item.riskLevel === 'high' ||
    item.riskLevel === 'unknown'
      ? item.riskLevel
      : 'unknown';

  if (!verdict && !summary) {
    return undefined;
  }

  return {
    fundName: normalizeOptionalString(item.fundName),
    fundCode: normalizeOptionalString(item.fundCode),
    verdict: verdict || summary || '已完成分析',
    summary: summary || verdict || '已完成分析',
    riskLevel,
    highlights: normalizeStringList(item.highlights, 4),
    risks: normalizeStringList(item.risks, 4),
    actions: normalizeStringList(item.actions, 4),
    watchTags: normalizeStringList(item.watchTags, 4),
    performanceHistory: normalizeStringList(item.performanceHistory, 6),
    fundAnalysis: normalizeStringList(item.fundAnalysis, 6),
    fundHoldings: normalizeStringList(item.fundHoldings, 8),
    assetAllocation: normalizeStringList(item.assetAllocation, 6),
    industryAllocation: normalizeStringList(item.industryAllocation, 8),
    netValue: normalizeOptionalString(item.netValue),
    addedReturn: normalizeOptionalString(item.addedReturn),
    holdingReturn: normalizeOptionalString(item.holdingReturn),
    buyFeeRate: normalizeOptionalString(item.buyFeeRate),
    fundCompany: normalizeOptionalString(item.fundCompany),
    platform: normalizeOptionalString(item.platform),
    note: normalizeOptionalString(item.note)
  };
}

function normalizeInvestmentWatchItem(
  item: Omit<InvestmentWatchItem, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  }
): InvestmentWatchItem {
  const now = new Date().toISOString();
  const riskLevel =
    item.lastRiskLevel === 'low' ||
    item.lastRiskLevel === 'medium' ||
    item.lastRiskLevel === 'high' ||
    item.lastRiskLevel === 'unknown'
      ? item.lastRiskLevel
      : undefined;

  return {
    id: item.id || createInvestmentWatchItemId(),
    name: String(item.name || '').trim() || '未命名自选',
    code: normalizeOptionalString(item.code),
    platform: normalizeOptionalString(item.platform),
    tags: normalizeStringList(item.tags, 4),
    note: normalizeOptionalString(item.note),
    lastVerdict: normalizeOptionalString(item.lastVerdict),
    lastSummary: normalizeOptionalString(item.lastSummary),
    lastRiskLevel: riskLevel,
    investmentAdvice: normalizeOptionalString(item.investmentAdvice),
    adviceReasons: normalizeStringList(item.adviceReasons, 6),
    riskNotes: normalizeStringList(item.riskNotes, 6),
    nextActions: normalizeStringList(item.nextActions, 6),
    holdingShares: normalizeOptionalNumber(item.holdingShares),
    performanceHistory: normalizeStringList(item.performanceHistory, 6),
    fundAnalysis: normalizeStringList(item.fundAnalysis, 6),
    fundHoldings: normalizeStringList(item.fundHoldings, 8),
    assetAllocation: normalizeStringList(item.assetAllocation, 6),
    industryAllocation: normalizeStringList(item.industryAllocation, 8),
    netValue: normalizeOptionalString(item.netValue),
    addedReturn: normalizeOptionalString(item.addedReturn),
    holdingReturn: normalizeOptionalString(item.holdingReturn),
    buyFeeRate: normalizeOptionalString(item.buyFeeRate),
    fundCompany: normalizeOptionalString(item.fundCompany),
    lastAnalysisAt: normalizeOptionalString(item.lastAnalysisAt),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now
  };
}

function normalizeInvestmentAiMessage(item: InvestmentAiMessage): InvestmentAiMessage | null {
  const text = String(item.text || '')
    .trim()
    .slice(0, 6000);
  const analysis = normalizeInvestmentFundAnalysis(item.analysis);
  const attachmentImages = normalizeInvestmentAttachmentImages(item.attachmentImages);
  const followUpPrompts = normalizeStringList(item.followUpPrompts, 4);
  if (!text && !analysis) {
    return null;
  }

  return {
    id: item.id || createInvestmentAiMessageId(),
    role: item.role === 'assistant' ? 'assistant' : 'user',
    text: text || (analysis?.summary ?? '已完成分析'),
    feedback: item.feedback === 'up' || item.feedback === 'down' ? item.feedback : undefined,
    reasoning: normalizeOptionalString(item.reasoning),
    webTrace: normalizeOptionalString(item.webTrace),
    auxiliaryInfo: normalizeOptionalString(item.auxiliaryInfo),
    followUpPrompts: followUpPrompts.length ? followUpPrompts : undefined,
    attachmentCount:
      attachmentImages.length ||
      Math.max(0, Math.floor(Number(item.attachmentCount || 0))) ||
      undefined,
    attachmentImages: attachmentImages.length ? attachmentImages : undefined,
    analysis,
    createdAt: normalizeOptionalString(item.createdAt) || new Date().toISOString()
  };
}

function normalizeInvestmentAiMessages(messages: InvestmentAiMessage[]): InvestmentAiMessage[] {
  return messages
    .map((item) => normalizeInvestmentAiMessage(item))
    .filter((item): item is InvestmentAiMessage => Boolean(item))
    .slice(-12);
}

function findMatchingWatchItemIndex(
  list: InvestmentWatchItem[],
  payload: Pick<InvestmentWatchItem, 'name' | 'code' | 'platform'> & { id?: string }
) {
  const code = String(payload.code || '')
    .trim()
    .toLowerCase();
  const name = String(payload.name || '')
    .trim()
    .toLowerCase();
  const platform = String(payload.platform || '')
    .trim()
    .toLowerCase();

  return list.findIndex((item) => {
    if (payload.id && item.id === payload.id) {
      return true;
    }

    const sameCode =
      code &&
      String(item.code || '')
        .trim()
        .toLowerCase() === code;
    const sameName =
      name &&
      String(item.name || '')
        .trim()
        .toLowerCase() === name;
    const samePlatform =
      platform ===
      String(item.platform || '')
        .trim()
        .toLowerCase();

    return sameCode || (sameName && (platform ? samePlatform : true));
  });
}

function createSubscriptionId(url: string): string {
  const normalized = normalizeFeedUrl(url)
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `rss-${normalized || 'custom'}-${Date.now()}`;
}

export const useAppPreferences = create<AppPreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      accentTheme: 'amber',
      rssSubscriptions: DEFAULT_RSS_SUBSCRIPTIONS,
      investmentPositions: [],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: [],
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 0,
      setTheme: (theme) => set({ theme }),
      setAccentTheme: (accentTheme) => set({ accentTheme }),
      setMonthlyIncome: (income) => set({ monthlyIncome: Number.isFinite(income) ? income : 0 }),
      setRepaymentState: ({ debts, monthlyIncome }) =>
        set({
          debts: Array.isArray(debts)
            ? debts.map((item) =>
                normalizeDebtItem({
                  ...item,
                  id: item.id || createDebtId(item.type)
                })
              )
            : [],
          monthlyIncome: Number.isFinite(monthlyIncome) ? monthlyIncome : 0
        }),
      addRssSubscription: ({ title, url }) => {
        const normalizedUrl = normalizeFeedUrl(url);
        if (!normalizedUrl) return { ok: false, reason: '请输入 RSS 地址。' };

        let parsed: URL;
        try {
          parsed = new URL(normalizedUrl);
        } catch {
          return { ok: false, reason: 'RSS 地址格式无效。' };
        }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { ok: false, reason: '仅支持 http/https 的 RSS 地址。' };
        }

        let isDuplicate = false;
        set((state) => {
          isDuplicate = state.rssSubscriptions.some(
            (item) =>
              item.url.toLocaleLowerCase('en-US') === normalizedUrl.toLocaleLowerCase('en-US')
          );
          if (isDuplicate) return state;

          const next = {
            id: createSubscriptionId(normalizedUrl),
            title: title.trim() || parsed.hostname,
            url: normalizedUrl,
            enabled: true
          };
          return { rssSubscriptions: [next, ...state.rssSubscriptions] };
        });

        if (isDuplicate) return { ok: false, reason: '该 RSS 已订阅。' };
        return { ok: true };
      },
      removeRssSubscription: (id) => {
        set((state) => ({
          rssSubscriptions: state.rssSubscriptions.filter((item) => item.id !== id)
        }));
      },
      toggleRssSubscription: (id) => {
        set((state) => ({
          rssSubscriptions: state.rssSubscriptions.map((item) =>
            item.id === id ? { ...item, enabled: !item.enabled } : item
          )
        }));
      },
      addInvestmentPosition: (payload) => {
        set((state) => {
          const position = normalizeInvestmentPosition(payload);
          const historyEntry = buildInvestmentPositionHistoryEntry(position, 'add');
          return {
            investmentPositions: [position, ...state.investmentPositions],
            investmentPositionHistory: normalizeInvestmentPositionHistory([
              historyEntry,
              ...state.investmentPositionHistory
            ])
          };
        });
      },
      updateInvestmentPosition: (id, payload) => {
        set((state) => {
          let historyEntry: InvestmentPositionHistoryEntry | null = null;
          const investmentPositions = state.investmentPositions.map((item) => {
            if (item.id !== id) return item;
            const next = normalizeInvestmentPosition({
              ...payload,
              id,
              createdAt: item.createdAt,
              updatedAt: new Date().toISOString()
            });
            historyEntry = buildInvestmentPositionHistoryEntry(next, 'update', item);
            return next;
          });

          return {
            investmentPositions,
            investmentPositionHistory: historyEntry
              ? normalizeInvestmentPositionHistory([
                  historyEntry,
                  ...state.investmentPositionHistory
                ])
              : state.investmentPositionHistory
          };
        });
      },
      removeInvestmentPosition: (id) => {
        set((state) => {
          const removed = state.investmentPositions.find((item) => item.id === id);
          return {
            investmentPositions: state.investmentPositions.filter((item) => item.id !== id),
            investmentPositionHistory: removed
              ? normalizeInvestmentPositionHistory([
                  buildInvestmentPositionHistoryEntry(removed, 'remove'),
                  ...state.investmentPositionHistory
                ])
              : state.investmentPositionHistory
          };
        });
      },
      ensureInvestmentPositionHistory: () => {
        set((state) => {
          if (
            state.investmentPositions.length === 0 ||
            state.investmentPositionHistory.length > 0
          ) {
            return state;
          }

          return {
            investmentPositionHistory: normalizeInvestmentPositionHistory(
              state.investmentPositions.map((item) =>
                buildInvestmentPositionHistoryEntry(item, 'snapshot')
              )
            )
          };
        });
      },
      addInvestmentGoal: (payload) => {
        set((state) => ({
          investmentGoals: [normalizeInvestmentGoal(payload), ...state.investmentGoals]
        }));
      },
      updateInvestmentGoal: (id, payload) => {
        set((state) => ({
          investmentGoals: state.investmentGoals.map((item) =>
            item.id === id
              ? normalizeInvestmentGoal({
                  ...payload,
                  id,
                  createdAt: item.createdAt,
                  updatedAt: new Date().toISOString()
                })
              : item
          )
        }));
      },
      removeInvestmentGoal: (id) => {
        set((state) => ({
          investmentGoals: state.investmentGoals.filter((item) => item.id !== id)
        }));
      },
      upsertInvestmentWatchItem: (payload) => {
        set((state) => {
          const existingIndex = findMatchingWatchItemIndex(state.investmentWatchlist, payload);
          if (existingIndex < 0) {
            return {
              investmentWatchlist: [
                normalizeInvestmentWatchItem(payload),
                ...state.investmentWatchlist
              ]
            };
          }

          const current = state.investmentWatchlist[existingIndex];
          const nextItem = normalizeInvestmentWatchItem({
            ...current,
            ...payload,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: new Date().toISOString()
          });

          return {
            investmentWatchlist: state.investmentWatchlist.map((item, index) =>
              index === existingIndex ? nextItem : item
            )
          };
        });
      },
      removeInvestmentWatchItem: (id) => {
        set((state) => ({
          investmentWatchlist: state.investmentWatchlist.filter((item) => item.id !== id)
        }));
      },
      setInvestmentWatchlist: (items) => {
        set({
          investmentWatchlist: Array.isArray(items)
            ? items.map((item) => normalizeInvestmentWatchItem(item))
            : []
        });
      },
      setInvestmentAiMessages: (messages) => {
        set({
          investmentAiMessages: normalizeInvestmentAiMessages(messages)
        });
      },
      clearInvestmentAiMessages: () => {
        set({ investmentAiMessages: [] });
      },
      replaceInvestmentData: (payload) => {
        const investmentPositions = Array.isArray(payload.investmentPositions)
          ? payload.investmentPositions.map((item) => normalizeInvestmentPosition(item))
          : [];
        const investmentPositionHistory = Array.isArray(payload.investmentPositionHistory)
          ? normalizeInvestmentPositionHistory(payload.investmentPositionHistory)
          : normalizeInvestmentPositionHistory(
              investmentPositions.map((item) =>
                buildInvestmentPositionHistoryEntry(item, 'snapshot')
              )
            );
        set({
          investmentPositions,
          investmentPositionHistory,
          investmentGoals: Array.isArray(payload.investmentGoals)
            ? payload.investmentGoals.map((item) => normalizeInvestmentGoal(item))
            : [],
          investmentWatchlist: Array.isArray(payload.investmentWatchlist)
            ? payload.investmentWatchlist.map((item) => normalizeInvestmentWatchItem(item))
            : [],
          investmentAiMessages: Array.isArray(payload.investmentAiMessages)
            ? normalizeInvestmentAiMessages(payload.investmentAiMessages)
            : []
        });
      },
      addDebt: (payload) => {
        set((state) => ({
          debts: [normalizeDebtItem({ ...payload, id: createDebtId(payload.type) }), ...state.debts]
        }));
      },
      replaceDebts: (payload) => {
        set({
          debts: payload.map((item) =>
            normalizeDebtItem({
              ...item,
              id: createDebtId(item.type)
            })
          )
        });
      },
      updateDebt: (id, payload) => {
        set((state) => ({
          debts: state.debts.map((item) =>
            item.id === id ? normalizeDebtItem({ ...payload, id }) : item
          )
        }));
      },
      removeDebt: (id) => {
        set((state) => ({
          debts: state.debts.filter((item) => item.id !== id)
        }));
      },
      addRepaymentRecord: (payload) => {
        set((state) => ({
          repaymentRecords: [
            {
              ...payload,
              id: createRepaymentRecordId(),
              createdAt: new Date().toISOString()
            },
            ...state.repaymentRecords
          ]
        }));
      },
      removeRepaymentRecord: (id) => {
        set((state) => ({
          repaymentRecords: state.repaymentRecords.filter((item) => item.id !== id)
        }));
      }
    }),
    { name: 'ledgerflow-preferences' }
  )
);
