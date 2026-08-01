import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  getRelationalBootstrap,
  importRelationalData
} from '../../../shared/api/relationalDataClient';
import { useAppPreferences } from '../../../shared/store/useAppPreferences';
import { type FinanceDataSnapshot, useFinanceStore } from '../../../shared/store/useFinanceStore';
import { useGlobalMemoryStore } from '../../../shared/store/useGlobalMemoryStore';

interface SqlDataSyncGateProps {
  children: ReactNode;
}

function getPayload() {
  const finance = useFinanceStore.getState();
  const preferences = useAppPreferences.getState();
  return {
    finance: {
      transactions: finance.transactions,
      categories: finance.categories,
      accounts: finance.accounts,
      subscriptions: finance.subscriptions,
      trashedTransactions: finance.trashedTransactions,
      trashedCategories: finance.trashedCategories,
      trashedAccounts: finance.trashedAccounts,
      balanceChangeEntries: finance.balanceChangeEntries,
      trashedSubscriptions: finance.trashedSubscriptions,
      categoryLearningRules: finance.categoryLearningRules,
      categoryLearningEvents: finance.categoryLearningEvents
    },
    globalMemories: useGlobalMemoryStore.getState().memories,
    preferences: {
      rssSubscriptions: preferences.rssSubscriptions,
      investmentPositions: preferences.investmentPositions,
      investmentPositionHistory: preferences.investmentPositionHistory,
      investmentGoals: preferences.investmentGoals,
      investmentWatchlist: preferences.investmentWatchlist,
      investmentAiMessages: preferences.investmentAiMessages,
      debts: preferences.debts,
      repaymentRecords: preferences.repaymentRecords,
      monthlyIncome: preferences.monthlyIncome
    }
  };
}

export function SqlDataSyncGate({ children }: SqlDataSyncGateProps) {
  const financeHydrated = useFinanceStore((state) => state.hasHydrated);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const syncingRef = useRef(false);
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const loadingText = useMemo(() => (error ? error : '正在从 SQL 数据库载入账本数据...'), [error]);

  useEffect(() => {
    if (!financeHydrated || initializedRef.current) return;
    let cancelled = false;

    const initialize = async () => {
      try {
        syncingRef.current = true;
        const bootstrap = await getRelationalBootstrap();
        if (cancelled) return;

        if (bootstrap.hasData) {
          const { finance, preferences, globalMemories } = bootstrap.data;
          useFinanceStore.getState().replaceAllData(finance as unknown as FinanceDataSnapshot);
          useFinanceStore.setState({
            categoryLearningRules: Array.isArray(finance.categoryLearningRules)
              ? (finance.categoryLearningRules as never[])
              : [],
            categoryLearningEvents: Array.isArray(finance.categoryLearningEvents)
              ? (finance.categoryLearningEvents as never[])
              : []
          });
          useGlobalMemoryStore.getState().replaceAllData(globalMemories as never[]);
          useAppPreferences.setState((current) => ({
            ...current,
            rssSubscriptions: Array.isArray(preferences.rssSubscriptions)
              ? (preferences.rssSubscriptions as never)
              : current.rssSubscriptions,
            investmentPositions: Array.isArray(preferences.investmentPositions)
              ? (preferences.investmentPositions as never)
              : [],
            investmentPositionHistory: Array.isArray(preferences.investmentPositionHistory)
              ? (preferences.investmentPositionHistory as never)
              : [],
            investmentGoals: Array.isArray(preferences.investmentGoals)
              ? (preferences.investmentGoals as never)
              : [],
            investmentWatchlist: Array.isArray(preferences.investmentWatchlist)
              ? (preferences.investmentWatchlist as never)
              : [],
            investmentAiMessages: Array.isArray(preferences.investmentAiMessages)
              ? (preferences.investmentAiMessages as never)
              : [],
            debts: Array.isArray(preferences.debts) ? (preferences.debts as never) : [],
            repaymentRecords: Array.isArray(preferences.repaymentRecords)
              ? (preferences.repaymentRecords as never)
              : [],
            monthlyIncome: Number(preferences.monthlyIncome) || 0
          }));
        } else {
          await importRelationalData(getPayload());
        }

        if (!cancelled) {
          initializedRef.current = true;
          setReady(true);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'SQL 数据库载入失败。');
        }
      } finally {
        syncingRef.current = false;
      }
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [financeHydrated]);

  useEffect(() => {
    if (!ready) return;
    const scheduleSync = () => {
      dirtyRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (syncingRef.current) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (syncingRef.current || !dirtyRef.current) return;
        dirtyRef.current = false;
        syncingRef.current = true;
        void importRelationalData(getPayload())
          .catch((reason) =>
            setError(reason instanceof Error ? reason.message : 'SQL 数据库写入失败。')
          )
          .finally(() => {
            syncingRef.current = false;
            if (dirtyRef.current) scheduleSync();
          });
      }, 500);
    };
    const unsubscribeFinance = useFinanceStore.subscribe(scheduleSync);
    const unsubscribePreferences = useAppPreferences.subscribe(scheduleSync);
    const unsubscribeMemories = useGlobalMemoryStore.subscribe(scheduleSync);
    return () => {
      unsubscribeFinance();
      unsubscribePreferences();
      unsubscribeMemories();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [ready]);

  if (!ready) {
    return (
      <>
        {children}
        <div
          className={`sql-sync-notice ${error ? 'is-error' : ''}`.trim()}
          role="status"
          aria-live="polite"
        >
          <span className="sql-sync-notice-dot" aria-hidden="true" />
          <span>{error ? loadingText : '正在同步账本数据...'}</span>
          {error ? (
            <button type="button" onClick={() => window.location.reload()}>
              重新连接
            </button>
          ) : null}
        </div>
      </>
    );
  }

  return <>{children}</>;
}
