import { beforeEach, describe, expect, it } from 'vitest';
import { type FinanceDataSnapshot, useFinanceStore } from './useFinanceStore';

const FINANCE_STORAGE_KEY = 'ledgerflow-finance';

describe('useFinanceStore replaceAllData', () => {
  beforeEach(() => {
    localStorage.removeItem(FINANCE_STORAGE_KEY);
    useFinanceStore.setState({
      hasHydrated: true,
      transactions: [],
      categories: [],
      accounts: [],
      trashedTransactions: [],
      trashedCategories: [],
      trashedAccounts: [],
      balanceChangeEntries: [],
      subscriptions: [],
      trashedSubscriptions: [],
      categoryLearningRules: [],
      categoryLearningEvents: []
    });
  });

  it('restores trash state and preserves manual balance entries from imported snapshots', () => {
    const snapshot: FinanceDataSnapshot = {
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          categoryId: 'cat-1',
          accountId: 'acc-1',
          amount: 20,
          date: '2026-04-10',
          note: 'Lunch',
          tags: ['food'],
          source: 'manual',
          status: 'completed',
          updatedAt: '2026-04-10T08:00:00.000Z',
          attachments: [
            {
              id: 'att-1',
              name: 'receipt.png',
              remotePath: 'ledgerflow/attachments/tx-1/receipt.png',
              uploadedAt: '2026-04-10T08:30:00.000Z'
            }
          ]
        }
      ],
      categories: [{ id: 'cat-1', name: 'Food', kind: 'expense', sortOrder: 1 }],
      accounts: [
        {
          id: 'acc-1',
          name: 'Card',
          type: 'debit',
          initialBalance: 100,
          balance: 80,
          sortOrder: 1
        }
      ],
      subscriptions: [],
      trashedTransactions: [
        {
          id: 'tx-2',
          type: 'expense',
          categoryId: 'cat-1',
          accountId: 'acc-1',
          amount: 10,
          date: '2026-04-09',
          note: 'Refund meal',
          tags: ['food', 'refund'],
          source: 'manual',
          status: 'refunded',
          adjustmentKind: 'refund',
          refundOfTransactionId: 'tx-1',
          updatedAt: '2026-04-10T09:00:00.000Z',
          trashedAt: '2026-04-11T00:00:00.000Z'
        }
      ],
      trashedCategories: [
        {
          id: 'cat-2',
          name: 'Archived',
          kind: 'expense',
          sortOrder: 2,
          trashedAt: '2026-04-11T00:00:00.000Z'
        }
      ],
      trashedAccounts: [
        {
          id: 'acc-2',
          name: 'Old Wallet',
          type: 'cash',
          initialBalance: 5,
          balance: 5,
          sortOrder: 2,
          trashedAt: '2026-04-11T00:00:00.000Z'
        }
      ],
      balanceChangeEntries: [
        {
          id: 'bal-1',
          accountId: 'acc-1',
          type: 'manual-adjustment',
          amount: 5,
          beforeBalance: 85,
          afterBalance: 80,
          createdAt: '2026-04-12T00:00:00.000Z',
          note: 'Manual fix'
        }
      ],
      trashedSubscriptions: [
        {
          id: 'sub-1',
          name: 'Paused plan',
          kind: 'digital',
          amount: 10,
          currency: 'CNY',
          billingCycle: 'monthly',
          status: 'paused',
          trashedAt: '2026-04-15T00:00:00.000Z',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z'
        }
      ]
    };

    useFinanceStore.getState().replaceAllData(snapshot);

    const state = useFinanceStore.getState();
    expect(state.transactions[0].attachments?.[0].name).toBe('receipt.png');
    expect(state.accounts[0].balance).toBe(80);
    expect(state.trashedTransactions[0].refundOfTransactionId).toBe('tx-1');
    expect(state.trashedCategories[0].trashedAt).toBe('2026-04-11T00:00:00.000Z');
    expect(state.trashedAccounts[0].name).toBe('Old Wallet');
    expect(state.trashedSubscriptions[0].status).toBe('paused');
    expect(state.balanceChangeEntries.some((item) => item.id === 'bal-1')).toBe(true);
    expect(state.balanceChangeEntries.some((item) => item.id === 'balchg-tx-tx-1')).toBe(true);
  });
});

describe('useFinanceStore 分类分层', () => {
  beforeEach(() => {
    localStorage.removeItem(FINANCE_STORAGE_KEY);
    useFinanceStore.setState({
      hasHydrated: true,
      transactions: [],
      categories: [],
      accounts: [],
      trashedTransactions: [],
      trashedCategories: [],
      trashedAccounts: [],
      balanceChangeEntries: [],
      subscriptions: [],
      trashedSubscriptions: [],
      categoryLearningRules: [],
      categoryLearningEvents: []
    });
  });

  it('新增子分类时记录上级,且同名子分类可归属不同父分类', () => {
    const food = useFinanceStore.getState().addCategory('餐饮', { kind: 'expense' });
    const transport = useFinanceStore.getState().addCategory('交通', { kind: 'expense' });
    const foodOther = useFinanceStore
      .getState()
      .addCategory('其他', { kind: 'expense', parentId: food });
    const transportOther = useFinanceStore
      .getState()
      .addCategory('其他', { kind: 'expense', parentId: transport });

    expect(foodOther).not.toBe(transportOther);
    const rows = useFinanceStore.getState().categories;
    expect(rows.find((item) => item.id === foodOther)?.parentId).toBe(food);
    expect(rows.find((item) => item.id === transportOther)?.parentId).toBe(transport);
  });

  it('删除父分类时子分类提升为一级分类而不是一起消失', () => {
    const food = useFinanceStore.getState().addCategory('餐饮', { kind: 'expense' });
    const child = useFinanceStore
      .getState()
      .addCategory('外卖', { kind: 'expense', parentId: food });

    useFinanceStore.getState().removeCategory(food);

    const rows = useFinanceStore.getState().categories;
    expect(rows.some((item) => item.id === food)).toBe(false);
    expect(rows.find((item) => item.id === child)?.parentId).toBeUndefined();
  });

  it('updateCategory 可调整上级分类', () => {
    const food = useFinanceStore.getState().addCategory('餐饮', { kind: 'expense' });
    const transport = useFinanceStore.getState().addCategory('交通', { kind: 'expense' });
    const child = useFinanceStore
      .getState()
      .addCategory('外卖', { kind: 'expense', parentId: food });

    useFinanceStore.getState().updateCategory(child, { parentId: transport });

    expect(useFinanceStore.getState().categories.find((item) => item.id === child)?.parentId).toBe(
      transport
    );
  });
});
