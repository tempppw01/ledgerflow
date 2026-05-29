import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppAccentTheme, AppTheme } from '../types/app';
import {
  InvestmentAiMessage,
  InvestmentGoal,
  InvestmentFundAnalysis,
  InvestmentPosition,
  InvestmentWatchItem
} from '../../entities/investment/types';
import {
  DebtItem,
  DebtLifecycleStatus,
  DebtType,
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

function normalizeDebtItem(item: DebtItem): DebtItem {
  return {
    ...item,
    status: normalizeDebtStatus(item.status, item.balance)
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
    monthlyContribution: normalizePositiveNumber(item.monthlyContribution) || undefined,
    targetAllocation: normalizePercentage(item.targetAllocation),
    riskLevel: item.riskLevel || 'medium',
    note: normalizeOptionalString(item.note),
    isActive: item.isActive !== false,
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now
  };
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
    performanceHistory: normalizeStringList(item.performanceHistory, 6),
    fundAnalysis: normalizeStringList(item.fundAnalysis, 6),
    fundHoldings: normalizeStringList(item.fundHoldings, 8),
    assetAllocation: normalizeStringList(item.assetAllocation, 6),
    industryAllocation: normalizeStringList(item.industryAllocation, 8),
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
  if (!text && !analysis) {
    return null;
  }

  return {
    id: item.id || createInvestmentAiMessageId(),
    role: item.role === 'assistant' ? 'assistant' : 'user',
    text: text || (analysis?.summary ?? '已完成分析'),
    feedback: item.feedback === 'up' || item.feedback === 'down' ? item.feedback : undefined,
    reasoning: normalizeOptionalString(item.reasoning),
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
      accentTheme: 'blue',
      rssSubscriptions: DEFAULT_RSS_SUBSCRIPTIONS,
      investmentPositions: [],
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
        set((state) => ({
          investmentPositions: [normalizeInvestmentPosition(payload), ...state.investmentPositions]
        }));
      },
      updateInvestmentPosition: (id, payload) => {
        set((state) => ({
          investmentPositions: state.investmentPositions.map((item) =>
            item.id === id
              ? normalizeInvestmentPosition({
                  ...payload,
                  id,
                  createdAt: item.createdAt,
                  updatedAt: new Date().toISOString()
                })
              : item
          )
        }));
      },
      removeInvestmentPosition: (id) => {
        set((state) => ({
          investmentPositions: state.investmentPositions.filter((item) => item.id !== id)
        }));
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
        set({
          investmentPositions: Array.isArray(payload.investmentPositions)
            ? payload.investmentPositions.map((item) => normalizeInvestmentPosition(item))
            : [],
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
