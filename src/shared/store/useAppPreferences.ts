import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppTheme } from '../types/app';
import { DebtItem, DebtType } from '../../features/debt/model/debtMetrics';

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
  highContrast: boolean;
  rssSubscriptions: RssSubscription[];
  debts: DebtItem[];
  monthlyIncome: number;
  setTheme: (theme: AppTheme) => void;
  setHighContrast: (enabled: boolean) => void;
  addRssSubscription: (payload: { title: string; url: string }) => { ok: boolean; reason?: string };
  removeRssSubscription: (id: string) => void;
  toggleRssSubscription: (id: string) => void;
  setMonthlyIncome: (income: number) => void;
  addDebt: (payload: Omit<DebtItem, 'id'>) => void;
  replaceDebts: (payload: Omit<DebtItem, 'id'>[]) => void;
  updateDebt: (id: string, payload: Omit<DebtItem, 'id'>) => void;
  removeDebt: (id: string) => void;
}

function createDebtId(type: DebtType): string {
  return `debt-${type}-${Date.now()}`;
}

function normalizeFeedUrl(rawUrl: string): string {
  return String(rawUrl || '').trim();
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
      highContrast: false,
      rssSubscriptions: DEFAULT_RSS_SUBSCRIPTIONS,
      debts: [],
      monthlyIncome: 0,
      setTheme: (theme) => set({ theme }),
      setHighContrast: (enabled) => set({ highContrast: enabled }),
      setMonthlyIncome: (income) => set({ monthlyIncome: Number.isFinite(income) ? income : 0 }),
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
      addDebt: (payload) => {
        set((state) => ({
          debts: [{ ...payload, id: createDebtId(payload.type) }, ...state.debts]
        }));
      },
      replaceDebts: (payload) => {
        set({
          debts: payload.map((item) => ({
            ...item,
            id: createDebtId(item.type)
          }))
        });
      },
      updateDebt: (id, payload) => {
        set((state) => ({
          debts: state.debts.map((item) => (item.id === id ? { ...payload, id } : item))
        }));
      },
      removeDebt: (id) => {
        set((state) => ({
          debts: state.debts.filter((item) => item.id !== id)
        }));
      }
    }),
    { name: 'ledgerflow-preferences' }
  )
);
