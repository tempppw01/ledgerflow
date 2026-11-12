import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getRelationalBootstrap,
  importRelationalData
} from '../../../shared/api/relationalDataClient';
import { useAppPreferences } from '../../../shared/store/useAppPreferences';
import { type FinanceDataSnapshot, useFinanceStore } from '../../../shared/store/useFinanceStore';
import { useGlobalMemoryStore } from '../../../shared/store/useGlobalMemoryStore';
import { useSmartBudgetStore } from '../../../shared/store/useSmartBudgetStore';
import { clearScopedBrowserData } from '../model/deploymentScope';

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
  const smartBudget = useSmartBudgetStore.getState();
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
      monthlyIncome: preferences.monthlyIncome,
      creditDrafts: preferences.creditDrafts,
      smartBudgetPlan: smartBudget.confirmedPlan,
      smartBudgetHistory: smartBudget.history
    }
  };
}

function hasMeaningfulLocalLedgerData() {
  const finance = useFinanceStore.getState();
  const preferences = useAppPreferences.getState();
  const memories = useGlobalMemoryStore.getState().memories;
  return (
    finance.transactions.length > 0 ||
    finance.trashedTransactions.length > 0 ||
    finance.balanceChangeEntries.length > 0 ||
    finance.subscriptions.length > 0 ||
    preferences.debts.length > 0 ||
    preferences.repaymentRecords.length > 0 ||
    preferences.investmentPositions.length > 0 ||
    preferences.investmentGoals.length > 0 ||
    preferences.investmentWatchlist.length > 0 ||
    preferences.creditDrafts.length > 0 ||
    useSmartBudgetStore.getState().confirmedPlan !== null ||
    memories.length > 0
  );
}

export function SqlDataSyncGate({ children }: SqlDataSyncGateProps) {
  const { t } = useTranslation();
  const financeHydrated = useFinanceStore((state) => state.hasHydrated);
  const [ready, setReady] = useState(false);
  const [pendingEmptyCloudImport, setPendingEmptyCloudImport] = useState(false);
  const [importingLocalData, setImportingLocalData] = useState(false);
  const [error, setError] = useState<'' | 'readFailed' | 'initFailed'>('');
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
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
            monthlyIncome: Number(preferences.monthlyIncome) || 0,
            creditDrafts: Array.isArray(preferences.creditDrafts)
              ? (preferences.creditDrafts as never)
              : []
          }));
          useSmartBudgetStore.getState().replaceAllData({
            confirmedPlan:
              preferences.smartBudgetPlan &&
              typeof preferences.smartBudgetPlan === 'object'
                ? (preferences.smartBudgetPlan as never)
                : null,
            history: Array.isArray(preferences.smartBudgetHistory)
              ? (preferences.smartBudgetHistory as never[])
              : []
          });
        } else {
          if (hasMeaningfulLocalLedgerData()) {
            setPendingEmptyCloudImport(true);
            return;
          }
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
  }, [financeHydrated, loadAttempt]);

  const retryInitialLoad = () => {
    initializedRef.current = false;
    pausedRef.current = false;
    dirtyRef.current = false;
    retryAttemptRef.current = 0;
    setError('');
    setNotice(null);
    setPendingEmptyCloudImport(false);
    setLoadAttempt((value) => value + 1);
  };

  const importLocalLedgerData = async () => {
    try {
      setImportingLocalData(true);
      await importRelationalData(getPayload());
      setPendingEmptyCloudImport(false);
      initializedRef.current = true;
      setReady(true);
      setNotice(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'SQL 数据库写入失败。';
      setNotice(
        isLedgerIdConflict(message)
          ? { kind: 'initialConflict' }
          : { kind: 'initialFailure', detail: message }
      );
    } finally {
      setImportingLocalData(false);
    }
  };

  const useBlankCloudLedger = () => {
    clearScopedBrowserData();
    window.location.reload();
  };

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
    const unsubscribeSmartBudget = useSmartBudgetStore.subscribe(handleStoreChange);
    if (dirtyRef.current) scheduleSync();
    return () => {
      unsubscribeFinance();
      unsubscribePreferences();
      unsubscribeMemories();
      unsubscribeSmartBudget();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [ready]);

  const noticeText = notice
    ? t(`dataSync.${notice.kind}`, 'detail' in notice ? { detail: notice.detail } : undefined)
    : '';

  if (pendingEmptyCloudImport) {
    return (
      <section className="auth-gate">
        <div className="auth-card">
          <div className="auth-card-head">
            <div>
              <h1>当前部署的云端账本为空</h1>
              <p>
                浏览器里还有一份本机账本。只有确认它属于当前部署时才导入,否则请使用空白账本。
              </p>
            </div>
          </div>
          <button
            type="button"
            className="primary auth-submit"
            disabled={importingLocalData}
            onClick={() => void importLocalLedgerData()}
          >
            {importingLocalData ? '正在导入...' : '导入本机账本到当前账号'}
          </button>
          <button
            type="button"
            className="auth-mode-button"
            disabled={importingLocalData}
            onClick={useBlankCloudLedger}
          >
            使用空白账本
          </button>
        </div>
      </section>
    );
  }

  if (!ready) {
    return (
      <section className="auth-gate" aria-busy={error ? undefined : true}>
        <div className="auth-card" role="status" aria-live="polite">
          <div className="auth-card-head">
            <div>
              <h1>{error ? t('dataSync.gateErrorTitle') : t('dataSync.gateLoadingTitle')}</h1>
              <p>{error ? t(`dataSync.${error}`) : t('dataSync.loadingFromSql')}</p>
            </div>
          </div>
          {error ? (
            <button type="button" className="primary auth-submit" onClick={retryInitialLoad}>
              {t('common.retry')}
            </button>
          ) : (
            <div className="sql-sync-progress" aria-hidden="true">
              <span />
            </div>
          )}
        </div>
      </section>
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
