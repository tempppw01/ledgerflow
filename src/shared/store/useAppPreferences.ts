import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppAccentTheme, AppTheme } from '../types/app';
import {
  InvestmentGoal,
  InvestmentPosition
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
  return `debt-${type}-${Date.now()}`;
}

function createRepaymentRecordId(): string {
  return `repayment-record-${Date.now()}`;
}

function createInvestmentPositionId(): string {
  return `investment-position-${Date.now()}`;
}

function createInvestmentGoalId(): string {
  return `investment-goal-${Date.now()}`;
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
      Number(Number.isFinite(Number(item.currentAmount)) ? Number(item.currentAmount).toFixed(2) : 0)
    ),
    monthlyContribution: normalizePositiveNumber(item.monthlyContribution) || undefined,
    targetDate: normalizeOptionalString(item.targetDate),
    priority: item.priority || 'medium',
    note: normalizeOptionalString(item.note),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now
  };
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
          investmentPositions: [
            normalizeInvestmentPosition(payload),
            ...state.investmentPositions
          ]
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
