import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

type SyncNotice =
  | { kind: 'initialConflict' }
  | { kind: 'initialFailure'; detail: string }
  | { kind: 'syncConflict' }
  | { kind: 'syncFailure'; detail: string }
  | { kind: 'syncRetry' };

// 服务端在检测到「本机账本编号与服务器上其它账本重复」时会返回 409。
// 这类冲突不会自己消失,继续按退避重试只会不断刷屏,所以识别出来后就暂停自动上传。
function isLedgerIdConflict(message: string) {
  return /冲突|重复|409/.test(message);
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
  const { t } = useTranslation();
  const financeHydrated = useFinanceStore((state) => state.hasHydrated);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<'' | 'readFailed' | 'initFailed'>('');
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const syncingRef = useRef(false);
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (!financeHydrated || initializedRef.current) return;
    let cancelled = false;

    const initialize = async () => {
      try {
        syncingRef.current = true;
        // 先读取云端已有数据。读取失败时必须停下来:此时本地状态可能是空的,
        // 若仍进入 ready,后续自动同步会把本地空状态写回,覆盖云端账本。
        let bootstrap: Awaited<ReturnType<typeof getRelationalBootstrap>>;
        try {
          bootstrap = await getRelationalBootstrap();
        } catch (reason) {
          if (cancelled) return;
          const message = reason instanceof Error ? reason.message : 'SQL 数据库载入失败。';
          console.warn('[SqlDataSyncGate] Failed to read cloud ledger, pausing sync:', message);
          setError('readFailed');
          return;
        }
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
          // 云端确实为空(例如新用户注册),把本地账号数据写入作为初始数据。
          // 写入失败不应阻塞应用,稍后自动同步会重试。
          try {
            await importRelationalData(getPayload());
          } catch (reason) {
            if (cancelled) return;
            const message = reason instanceof Error ? reason.message : 'SQL 数据库写入失败。';
            console.warn(
              '[SqlDataSyncGate] Initial cloud import failed, continuing offline:',
              message
            );
            const conflict = isLedgerIdConflict(message);
            setNotice(
              conflict ? { kind: 'initialConflict' } : { kind: 'initialFailure', detail: message }
            );
            pausedRef.current = conflict;
            dirtyRef.current = !conflict;
          }
        }

        if (!cancelled) {
          initializedRef.current = true;
          setReady(true);
        }
      } finally {
        syncingRef.current = false;
      }
    };

    void initialize().catch((reason) => {
      if (cancelled) return;
      const message = reason instanceof Error ? reason.message : '账本初始化失败。';
      console.warn('[SqlDataSyncGate] Failed to initialize ledger:', message);
      setError('initFailed');
    });
    return () => {
      cancelled = true;
    };
  }, [financeHydrated]);

  useEffect(() => {
    if (!ready) return;
    const scheduleSync = (delayMs = 500) => {
      if (pausedRef.current) return;
      dirtyRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (syncingRef.current) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (syncingRef.current || !dirtyRef.current) return;
        dirtyRef.current = false;
        syncingRef.current = true;
        void importRelationalData(getPayload())
          .then(() => {
            retryAttemptRef.current = 0;
            setNotice(null);
          })
          .catch((reason) => {
            const message = reason instanceof Error ? reason.message : '';
            const conflict = isLedgerIdConflict(message);
            pausedRef.current = conflict;
            dirtyRef.current = !conflict;
            if (!conflict) retryAttemptRef.current += 1;
            setNotice(
              conflict
                ? { kind: 'syncConflict' }
                : message
                  ? { kind: 'syncFailure', detail: message }
                  : { kind: 'syncRetry' }
            );
          })
          .finally(() => {
            syncingRef.current = false;
            if (dirtyRef.current) {
              const retryDelay = Math.min(30000, 1000 * 2 ** retryAttemptRef.current);
              scheduleSync(retryDelay);
            }
          });
      }, delayMs);
    };
    const handleStoreChange = () => scheduleSync();
    const unsubscribeFinance = useFinanceStore.subscribe(handleStoreChange);
    const unsubscribePreferences = useAppPreferences.subscribe(handleStoreChange);
    const unsubscribeMemories = useGlobalMemoryStore.subscribe(handleStoreChange);
    if (dirtyRef.current) scheduleSync();
    return () => {
      unsubscribeFinance();
      unsubscribePreferences();
      unsubscribeMemories();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [ready]);

  const noticeText = notice
    ? t(`dataSync.${notice.kind}`, 'detail' in notice ? { detail: notice.detail } : undefined)
    : '';

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
          <span>{error ? t(`dataSync.${error}`) : t('dataSync.syncing')}</span>
          {error ? (
            <button type="button" onClick={() => window.location.reload()}>
              {t('dataSync.reconnect')}
            </button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      {children}
      {notice ? (
        <div className="sql-sync-notice is-warning" role="status" aria-live="polite">
          <span className="sql-sync-notice-dot" aria-hidden="true" />
          <span>{noticeText}</span>
          <button type="button" onClick={() => setNotice(null)}>
            {t('dataSync.gotIt')}
          </button>
        </div>
      ) : null}
    </>
  );
}
