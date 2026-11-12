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
    monthlyIncome: 0
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
  const useAppPreferences = Object.assign(
    (selector: (state: typeof preferencesState) => unknown) => selector(preferencesState),
    {
      getState: () => preferencesState,
      setState: vi.fn(),
      subscribe: () => () => undefined
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
