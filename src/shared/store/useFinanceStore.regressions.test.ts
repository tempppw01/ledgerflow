import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { normalizeImportedFinanceSnapshot, useFinanceStore } from './useFinanceStore';

const FINANCE_STORAGE_KEY = 'ledgerflow-finance';

function baseTransaction(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-food',
    accountId: 'acc-1',
    amount: 100,
    date: '2026-11-01T12:00:00.000Z',
    note: '午餐',
    tags: [],
    source: 'manual',
    status: 'completed',
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides
  };
}

function resetStore(transactions: TransactionItem[] = []) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions,
    categories: [
      { id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 },
      { id: 'cat-transport', name: '交通', kind: 'expense', sortOrder: 2 }
    ],
    accounts: [
      {
        id: 'acc-1',
        name: '现金',
        type: 'cash',
        initialBalance: 1000,
        balance: 1000,
        sortOrder: 1
      }
    ],
    trashedTransactions: [],
    trashedCategories: [],
    trashedAccounts: [],
    balanceChangeEntries: [],
    subscriptions: [],
    trashedSubscriptions: [],
    categoryLearningRules: [],
    categoryLearningEvents: []
  });
}

describe('useFinanceStore 回归修复', () => {
  beforeEach(() => {
    localStorage.removeItem(FINANCE_STORAGE_KEY);
    resetStore();
  });

  it('编辑退款记录时保留退款关联字段', () => {
    resetStore([
      baseTransaction({
        id: 'tx-refund',
        adjustmentKind: 'refund',
        refundOfTransactionId: 'tx-origin',
        attachments: [
          {
            id: 'att-1',
            name: 'receipt.png',
            uploadedAt: '2026-11-01T12:30:00.000Z',
            remotePath: 'ledgerflow/attachments/tx-refund/receipt.png'
          }
        ]
      })
    ]);

    useFinanceStore.getState().updateTransaction('tx-refund', {
      type: 'expense',
      categoryId: 'cat-food',
      accountId: 'acc-1',
      amount: 30,
      date: '2026-11-02T12:00:00.000Z',
      note: '退款备注',
      tags: [],
      status: 'completed'
    });

    const updated = useFinanceStore
      .getState()
      .transactions.find((item) => item.id === 'tx-refund');
    expect(updated?.adjustmentKind).toBe('refund');
    expect(updated?.refundOfTransactionId).toBe('tx-origin');
    expect(updated?.attachments).toHaveLength(1);
    expect(updated?.amount).toBe(30);
  });

  it.each(['pending', 'closed', 'failed'] as const)('状态为 %s 的交易不能退款', (status) => {
    resetStore([baseTransaction({ status })]);

    expect(() =>
      useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 10 })
    ).toThrow('只有已完成的交易才能发起退款。');
    expect(useFinanceStore.getState().transactions).toHaveLength(1);
  });

  it('删除分类后交易归入未分类,而非第一个分类', () => {
    resetStore([baseTransaction({ id: 'tx-1', categoryId: 'cat-transport' })]);

    useFinanceStore.getState().removeCategory('cat-transport');

    const state = useFinanceStore.getState();
    expect(state.categories.some((item) => item.id === 'cat-transport')).toBe(false);
    expect(state.transactions[0].categoryId).toBe('');
  });

  it('导入时缺失分类的交易保持未分类', () => {
    const normalized = normalizeImportedFinanceSnapshot({
      transactions: [baseTransaction({ id: 'tx-1', categoryId: '' })],
      categories: [
        { id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 },
        { id: 'cat-transport', name: '交通', kind: 'expense', sortOrder: 2 }
      ],
      accounts: [
        {
          id: 'acc-1',
          name: '现金',
          type: 'cash',
          initialBalance: 1000,
          balance: 1000,
          sortOrder: 1
        }
      ]
    });

    expect(normalized.transactions[0].categoryId).toBe('');
  });
});
