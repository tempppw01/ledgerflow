import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getRelationalBootstrap,
  importRelationalData
} from '../../../shared/api/relationalDataClient';
import { useAppPreferences } from '../../../shared/store/useAppPreferences';
import {
  LEDGER_BASE_CURRENCIES,
  type LedgerBaseCurrency
} from '../../../shared/lib/format';
import { type FinanceDataSnapshot, useFinanceStore } from '../../../shared/store/useFinanceStore';
import { useGlobalMemoryStore } from '../../../shared/store/useGlobalMemoryStore';
import { useSmartBudgetStore } from '../../../shared/store/useSmartBudgetStore';
import { clearScopedBrowserData } from '../model/deploymentScope';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { useUnsyncedChangesGuard } from '../../../shared/hooks/useUnsyncedChangesGuard';
import {
  describeDroppedGroups,
  findDroppedSyncGroups
} from '../model/syncCountMismatch';

interface SqlDataSyncGateProps {
  children: ReactNode;
}

type SyncNotice =
  | { kind: 'initialConflict' }
  | { kind: 'initialFailure'; detail: string }
  | { kind: 'syncConflict' }
  | { kind: 'syncFailure'; detail: string }
  | { kind: 'syncDroppedRecords'; detail: string }
  | { kind: 'syncStaleRevision' }
  | { kind: 'syncRetry' };

// 服务端在检测到「本机账本编号与服务器上其它账本重复」时会返回 409。
// 这类冲突不会自己消失,继续按退避重试只会不断刷屏,所以识别出来后就暂停自动上传。
function isLedgerIdConflict(message: string) {
  return /冲突|重复|409/.test(message);
}

/**
 * 服务端在「这个窗口加载之后,账本被另一个窗口/设备改过」时返回 409(见 /data/import 的实现)。
 *
 * 这条和 id 冲突的处理方式一样(暂停上传 + 提示刷新),但**文案不同** —— id 冲突说的是
 * 「编号重复」,这条说的是「你手里的快照已经旧了」。所以要在 isLedgerIdConflict 之前判。
 */
function isStaleLedgerRevision(message: string) {
  return /另一个窗口|已被.*改动/.test(message);
}

/**
 * 只存在浏览器里、**永远不进快照**的 UI 偏好。
 *
 * 依据是该 store 自己的持久化白名单(`persist.partialize` 只写这三个),以及
 * `getPayload()` 里 preferences 那一段不含它们 —— 两处都在说"这是本机偏好"。
 */
const LOCAL_ONLY_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  'theme',
  'accentTheme',
  'defaultLandingPath'
]);

/** 只接受已知币种;其它一律 undefined(调用方据此决定是"保持原值"还是"忽略")。 */
function normalizeBaseCurrency(value: unknown): LedgerBaseCurrency | undefined {
  const code = String(value ?? '').trim().toUpperCase();
  return (LEDGER_BASE_CURRENCIES as readonly string[]).includes(code)
    ? (code as LedgerBaseCurrency)
    : undefined;
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
      baseCurrency: preferences.baseCurrency,
      creditDrafts: preferences.creditDrafts,
      forecastBills: preferences.forecastBills,
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
  const tf = useTFallback();
  const financeHydrated = useFinanceStore((state) => state.hasHydrated);
  const [ready, setReady] = useState(false);
  const [pendingEmptyCloudImport, setPendingEmptyCloudImport] = useState(false);
  const [importingLocalData, setImportingLocalData] = useState(false);
  const [error, setError] = useState<'' | 'readFailed' | 'initFailed'>('');
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  /*
   * 有「还没推到服务端」的改动。账本不在浏览器里持久化(sqlOnlyStorage 是空实现),
   * 所以这些改动只活在内存里 —— 离线记一笔再关页面就没了,而且事后毫无痕迹。
   * 这个标记用来在离开页面前拦一道(见下方 useUnsyncedChangesGuard)。
   */
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const syncingRef = useRef(false);
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const pausedRef = useRef(false);
  /*
   * 「我加载时看到的是哪个版本」(bootstrap / 上次导入返回的 updatedAt)。
   * 随每次上传带给服务端:它发现版本已变就拒绝,避免整份替换把另一个窗口/设备写的行删掉。
   * 上传成功后又用返回值续期 —— 否则自己下一次上传就会被自己刚刚的那次写入判成「旧版本」。
   */
  const baseRevisionRef = useRef('');

  // 有未同步的改动时,离开页面前让浏览器弹确认框(数据只在内存里,关掉就没了)
  useUnsyncedChangesGuard(hasUnsyncedChanges);

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
          const message = reason instanceof Error ? reason.message : tf('dataBackup.sync.sqlLoadFailed', 'SQL 数据库载入失败。');
          console.warn('[SqlDataSyncGate] Failed to read cloud ledger, pausing sync:', message);
          setError('readFailed');
          return;
        }
        if (cancelled) return;

        if (bootstrap.hasData) {
          const { finance, preferences, globalMemories } = bootstrap.data;
          // 记下这个窗口看到的版本:之后每次上传都带给服务端做乐观并发校验
          baseRevisionRef.current = String(bootstrap.updatedAt || '');
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
            // 非法或缺失时**保持当前值**(不能回落,否则别人的旧账本会把本机选择重置成 CNY)
            baseCurrency: normalizeBaseCurrency(preferences.baseCurrency) ?? current.baseCurrency,
            creditDrafts: Array.isArray(preferences.creditDrafts)
              ? (preferences.creditDrafts as never)
              : [],
            forecastBills: Array.isArray(preferences.forecastBills)
              ? (preferences.forecastBills as never)
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
            const message = reason instanceof Error ? reason.message : tf('dataBackup.sync.sqlWriteFailed', 'SQL 数据库写入失败。');
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
      const message = reason instanceof Error ? reason.message : tf('dataBackup.sync.ledgerInitFailed', '账本初始化失败。');
      console.warn('[SqlDataSyncGate] Failed to initialize ledger:', message);
      setError('initFailed');
    });
    return () => {
      cancelled = true;
    };
  }, [financeHydrated, loadAttempt, tf]);

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
      const message = reason instanceof Error ? reason.message : tf('dataBackup.sync.sqlWriteFailed', 'SQL 数据库写入失败。');
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
      setHasUnsyncedChanges(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (syncingRef.current) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (syncingRef.current || !dirtyRef.current) return;
        dirtyRef.current = false;
        syncingRef.current = true;
        const payload = getPayload();
        void importRelationalData(payload, baseRevisionRef.current || undefined)
          .then((status) => {
            retryAttemptRef.current = 0;
            // 上传成功:用服务端返回的版本续期,否则下一次上传会被自己刚写的这次判成旧版本
            if (status?.updatedAt) {
              baseRevisionRef.current = String(status.updatedAt);
            }
            /*
             * 服务端返回的 counts 告诉我们它**实际存下了多少行**。它静默丢弃引用无法解析的行
             * (例如交易引用的账户已被彻底删除),而这里原先把 counts 直接丢掉了 ——
             * 于是用户丢记录时既没有报错、也没有提示,只有下次载入才发现少了东西。
             * 现在比对一次:有缺口就明说,并且**不解除**离开保护 —— 那些行仍然只活在内存里。
             */
            const dropped = findDroppedSyncGroups(payload, status?.counts);
            setNotice(
              dropped.length
                ? { kind: 'syncDroppedRecords', detail: describeDroppedGroups(dropped, tf) }
                : null
            );
            // 推上去了,本地不再有「只活在内存里」的改动(除非服务端丢掉了行)
            setHasUnsyncedChanges(dropped.length > 0);
          })
          .catch((reason) => {
            const message = reason instanceof Error ? reason.message : '';
            /*
             * 「快照已旧」(另一个窗口/设备改过账本)要在 id 冲突之前判 ——
             * isLedgerIdConflict 的规则里含 409,会把这条也吞进去,给出错误的原因说明。
             * 两者都暂停上传、都要求刷新,但文案不同。
             */
            const staleRevision = isStaleLedgerRevision(message);
            const conflict = !staleRevision && isLedgerIdConflict(message);
            pausedRef.current = staleRevision || conflict;
            dirtyRef.current = !(staleRevision || conflict);
            // 失败(含冲突暂停)时改动仍未上去,保护要继续挂着
            setHasUnsyncedChanges(true);
            if (!(staleRevision || conflict)) retryAttemptRef.current += 1;
            setNotice(
              staleRevision
                ? { kind: 'syncStaleRevision' }
                : conflict
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
    /*
     * theme / accentTheme / defaultLandingPath 和账本数据同在一个 store,但只活在本机。
     * 直接 subscribe(handleStoreChange) 会把「点一下主题切换」也当成账本改动 ——
     * 于是把整份账本(演示库 298 笔交易)重新 POST 一遍。
     *
     * 两个实际后果:
     *   · 服务端会写进用户从没改过的设置行 —— 本仓库的 `npm run audit:demo-baseline`
     *     正是被这个撞红的(settings 由 11 变 12,而库本身没人动过);
     *   · 没有任何账本改动也要抢先上传,正好放大「快照同步覆盖别的窗口写入」的既有风险。
     *
     * 判据刻意写成「**只有**本地字段变了才跳过」,而不是「快照相关字段变了才上传」。
     * 后者看着更直接,但如果哪里就地改了数组(引用不变),它会把真改动误判成"没变"而**漏传**;
     * 这里反过来 —— 认不出来就照旧上传,只砍掉能证明是纯本地的那一次。
     */
    let previousPreferencesState = useAppPreferences.getState() as unknown as Record<string, unknown>;
    const unsubscribePreferences = useAppPreferences.subscribe((state) => {
      const nextState = state as unknown as Record<string, unknown>;
      const changedKeys = Object.keys(nextState).filter(
        (key) => !Object.is(previousPreferencesState[key], nextState[key])
      );
      previousPreferencesState = nextState;
      const onlyLocalUiPreferences =
        changedKeys.length > 0 && changedKeys.every((key) => LOCAL_ONLY_PREFERENCE_KEYS.has(key));
      if (onlyLocalUiPreferences) return;
      handleStoreChange();
    });
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
  }, [ready, tf]);

  const noticeText = notice
    ? t(`dataSync.${notice.kind}`, 'detail' in notice ? { detail: notice.detail } : undefined)
    : '';

  if (pendingEmptyCloudImport) {
    return (
      <section className="auth-gate">
        <div className="auth-card">
          <div className="auth-card-head">
            <div>
              <h1>{tf('dataBackup.sync.cloudEmptyTitle', "当前部署的云端账本为空")}</h1>
              <p>{tf('dataBackup.sync.cloudEmptyBody', " 浏览器里还有一份本机账本。只有确认它属于当前部署时才导入\uFF0C否则请使用空白账本。 ")}</p>
            </div>
          </div>
          <button
            type="button"
            className="primary auth-submit"
            disabled={importingLocalData}
            onClick={() => void importLocalLedgerData()}
          >
            {importingLocalData ? tf('dataBackup.sync.importing', '正在导入...') : tf('dataBackup.sync.importLocalLedger', '导入本机账本到当前账号')}
          </button>
          <button
            type="button"
            className="auth-mode-button"
            disabled={importingLocalData}
            onClick={useBlankCloudLedger}
          >{tf('dataBackup.sync.useBlankLedger', " 使用空白账本 ")}</button>
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
