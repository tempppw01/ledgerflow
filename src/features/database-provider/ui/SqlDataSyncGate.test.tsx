import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlDataSyncGate } from './SqlDataSyncGate';

const mocks = vi.hoisted(() => {
  const financeState = {
    transactions: [{ id: 'old-transaction' }] as unknown[],
    categories: [] as unknown[],
    accounts: [] as unknown[],
    subscriptions: [] as unknown[],
    trashedTransactions: [] as unknown[],
    trashedCategories: [] as unknown[],
    trashedAccounts: [] as unknown[],
    balanceChangeEntries: [] as unknown[],
    trashedSubscriptions: [] as unknown[],
    categoryLearningRules: [] as unknown[],
    categoryLearningEvents: [] as unknown[],
    hasHydrated: true,
    replaceAllData: vi.fn()
  };
  const preferencesState = {
    rssSubscriptions: [] as unknown[],
    investmentPositions: [] as unknown[],
    investmentPositionHistory: [] as unknown[],
    investmentGoals: [] as unknown[],
    investmentWatchlist: [] as unknown[],
    investmentAiMessages: [] as unknown[],
    debts: [] as unknown[],
    repaymentRecords: [] as unknown[],
    creditDrafts: [] as unknown[],
    monthlyIncome: 0,
    /*
     * 只存在浏览器里的 UI 偏好。它们和账本数据同在一个 store,
     * 所以 "订阅了这个 store" 不等于 "账本变了" —— 这正是下面那组测试要钉住的事。
     */
    theme: 'system' as string,
    accentTheme: 'amber' as string,
    defaultLandingPath: '' as string
  };
  const memoryState = { memories: [] as unknown[], replaceAllData: vi.fn() };
  const smartBudgetState = {
    confirmedPlan: null as unknown,
    history: [] as unknown[],
    replaceAllData: vi.fn()
  };

  const useFinanceStore = Object.assign(
    (selector: (state: typeof financeState) => unknown) => selector(financeState),
    {
      getState: () => financeState,
      setState: vi.fn(),
      subscribe: () => () => undefined
    }
  );
  let preferencesListener: ((state: typeof preferencesState) => void) | null = null;
  /*
   * zustand 的 set() 会**换一个新对象**(浅合并),留下来的旧对象保持原样 ——
   * 按引用比较"变没变"就建立在这个前提上。所以这里也必须换对象:
   * 如果就地改同一个对象,两边引用相同,任何按引用的比较都会得出"没变",
   * 测试就会把实现里的 bug 掩盖成一个"看起来通过"的假象。
   */
  let currentPreferencesState: typeof preferencesState = { ...preferencesState };
  const useAppPreferences = Object.assign(
    (selector: (state: typeof preferencesState) => unknown) => selector(preferencesState),
    {
      getState: () => currentPreferencesState,
      setState: vi.fn(),
      subscribe: (listener: (state: typeof preferencesState) => void) => {
        preferencesListener = listener;
        return () => {
          if (preferencesListener === listener) preferencesListener = null;
        };
      }
    }
  );
  const useGlobalMemoryStore = Object.assign(
    (selector: (state: typeof memoryState) => unknown) => selector(memoryState),
    {
      getState: () => memoryState,
      replaceAllData: memoryState.replaceAllData,
      subscribe: () => () => undefined
    }
  );
  const useSmartBudgetStore = Object.assign(
    (selector: (state: typeof smartBudgetState) => unknown) => selector(smartBudgetState),
    {
      getState: () => smartBudgetState,
      setState: vi.fn(),
      subscribe: () => () => undefined,
      replaceAllData: smartBudgetState.replaceAllData
    }
  );

  return {
    financeState,
    preferencesState,
    memoryState,
    smartBudgetState,
    useFinanceStore,
    useAppPreferences,
    useGlobalMemoryStore,
    useSmartBudgetStore,
    /** 模拟一次 store 变更:改字段 + 换新对象 + 通知订阅者(和 zustand set 一致)。 */
    emitPreferencesChange: (patch: Partial<typeof preferencesState>) => {
      Object.assign(preferencesState, patch);
      currentPreferencesState = { ...preferencesState };
      preferencesListener?.(currentPreferencesState);
    },
    getRelationalBootstrap: vi.fn(),
    importRelationalData: vi.fn(),
    clearScopedBrowserData: vi.fn()
  };
});

vi.mock('../../../shared/api/relationalDataClient', () => ({
  getRelationalBootstrap: () => mocks.getRelationalBootstrap(),
  importRelationalData: (payload: unknown) => mocks.importRelationalData(payload)
}));

vi.mock('../model/deploymentScope', () => ({
  clearScopedBrowserData: () => mocks.clearScopedBrowserData()
}));

vi.mock('../../../shared/store/useFinanceStore', () => ({
  useFinanceStore: mocks.useFinanceStore
}));

vi.mock('../../../shared/store/useAppPreferences', () => ({
  useAppPreferences: mocks.useAppPreferences
}));

vi.mock('../../../shared/store/useGlobalMemoryStore', () => ({
  useGlobalMemoryStore: mocks.useGlobalMemoryStore
}));

vi.mock('../../../shared/store/useSmartBudgetStore', () => ({
  useSmartBudgetStore: mocks.useSmartBudgetStore
}));

function emptyBootstrap() {
  return {
    ok: true,
    hasData: false,
    counts: {},
    updatedAt: null,
    data: { finance: {}, preferences: {}, globalMemories: [] }
  };
}

describe('SqlDataSyncGate initial cloud handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.financeState.transactions = [{ id: 'old-transaction' }];
    mocks.financeState.hasHydrated = true;
    mocks.memoryState.memories = [];
    mocks.getRelationalBootstrap.mockResolvedValue(emptyBootstrap());
    mocks.importRelationalData.mockResolvedValue({ ok: true });
  });

  it('does not auto-import stale browser data into an empty cloud ledger', async () => {
    render(
      <SqlDataSyncGate>
        <div>应用内容</div>
      </SqlDataSyncGate>
    );

    expect(
      await screen.findByRole('heading', { name: '当前部署的云端账本为空' })
    ).toBeInTheDocument();
    expect(screen.queryByText('应用内容')).not.toBeInTheDocument();
    expect(mocks.importRelationalData).not.toHaveBeenCalled();
  });

  it('continues normally when the browser has no meaningful ledger data', async () => {
    mocks.financeState.transactions = [];

    render(
      <SqlDataSyncGate>
        <div>应用内容</div>
      </SqlDataSyncGate>
    );

    expect(await screen.findByText('应用内容')).toBeInTheDocument();
    await waitFor(() => expect(mocks.importRelationalData).toHaveBeenCalledTimes(1));
  });
});

/*
 * 这两条是一对,必须一起看:
 *   · 第一条钉住"纯本地偏好不触发上传" —— 改之前它会失败(会多出第 2 次调用);
 *   · 第二条是它的反面,防止有人图省事把订阅整条摘掉(那样"不上传"这条会假绿)。
 * 同步的定时器是 500ms,所以断言前要等过它。
 */
describe('SqlDataSyncGate 的同步触发条件', () => {
  const SETTLE_MS = 700;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.financeState.transactions = [];
    mocks.financeState.hasHydrated = true;
    mocks.memoryState.memories = [];
    mocks.preferencesState.monthlyIncome = 0;
    mocks.preferencesState.theme = 'system';
    mocks.preferencesState.accentTheme = 'amber';
    mocks.preferencesState.defaultLandingPath = '';
    mocks.getRelationalBootstrap.mockResolvedValue(emptyBootstrap());
    mocks.importRelationalData.mockResolvedValue({ ok: true });
  });

  it('只改本地 UI 偏好(主题)时不重新上传账本', async () => {
    render(
      <SqlDataSyncGate>
        <div>应用内容</div>
      </SqlDataSyncGate>
    );
    expect(await screen.findByText('应用内容')).toBeInTheDocument();
    await waitFor(() => expect(mocks.importRelationalData).toHaveBeenCalledTimes(1));

    mocks.emitPreferencesChange({ theme: 'dark' });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    expect(mocks.importRelationalData).toHaveBeenCalledTimes(1);
  });

  it('改真正进快照的偏好(月收入)时照旧上传', async () => {
    render(
      <SqlDataSyncGate>
        <div>应用内容</div>
      </SqlDataSyncGate>
    );
    expect(await screen.findByText('应用内容')).toBeInTheDocument();
    await waitFor(() => expect(mocks.importRelationalData).toHaveBeenCalledTimes(1));

    mocks.emitPreferencesChange({ monthlyIncome: 26000 });
    await waitFor(() => expect(mocks.importRelationalData).toHaveBeenCalledTimes(2));
  });
});
