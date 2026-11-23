import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 回收站里「支出 + 退款」是一对:删除时 removeTransaction 会把退款/冲正一并移走
 * (确认框也写了),所以**恢复时也必须一起回来**。
 *
 * 只恢复原交易的话,支出回来了、退款还留在回收站 —— 账上凭空少掉退款那一笔。
 * 演示账本那对 ¥390.55 实测:恢复后支付宝余额从 −26,556.20 变成 −26,946.75,
 * 而且那笔支出状态是「已退款」却找不到退款记录。
 */
function row(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-food',
    accountId: 'acc-1',
    amount: 390.55,
    date: '2026-11-03T12:00:00.000Z',
    note: '家居小物',
    tags: [],
    source: 'manual',
    status: 'completed',
    updatedAt: '2026-11-03T12:00:00.000Z',
    ...overrides
  };
}

function refundRow(): TransactionItem {
  return row({
    id: 'tx-1-refund',
    amount: 390.55,
    adjustmentKind: 'refund',
    refundOfTransactionId: 'tx-1',
    note: '退款:家居小物',
    updatedAt: '2026-11-08T12:00:00.000Z'
  });
}

function resetStore(transactions: TransactionItem[]) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions,
    trashedTransactions: [],
    categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 }],
    accounts: [
      { id: 'acc-1', name: '现金', type: 'cash', initialBalance: 1000, balance: 1000, sortOrder: 1 }
    ],
    balanceChangeEntries: [],
    subscriptions: [],
    trashedSubscriptions: [],
    trashedCategories: [],
    trashedAccounts: [],
    categoryLearningRules: [],
    categoryLearningEvents: []
  });
}

function accountBalance(): number {
  return Number(useFinanceStore.getState().accounts.find((item) => item.id === 'acc-1')?.balance ?? 0);
}

describe('回收站里的退款对', () => {
  beforeEach(() => {
    resetStore([row(), refundRow()]);
  });

  it('删除原交易时退款一并进回收站(两条都不在账上)', () => {
    const before = accountBalance();
    useFinanceStore.getState().removeTransaction('tx-1');

    const state = useFinanceStore.getState();
    expect(state.transactions).toHaveLength(0);
    expect(state.trashedTransactions.map((item) => item.id).sort()).toEqual(['tx-1', 'tx-1-refund']);
    // 支出与退款净额为 0,所以一起移走不改余额
    expect(accountBalance()).toBe(before);
  });

  it('恢复原交易时退款一起回来,余额回到删除前', () => {
    const before = accountBalance();
    useFinanceStore.getState().removeTransaction('tx-1');
    useFinanceStore.getState().restoreTransaction('tx-1');

    const state = useFinanceStore.getState();
    expect(state.transactions.map((item) => item.id).sort()).toEqual(['tx-1', 'tx-1-refund']);
    expect(state.trashedTransactions).toHaveLength(0);
    // 只恢复一条会让余额少 ¥390.55,这里必须一分不差地回到删除前
    expect(accountBalance()).toBe(before);
  });

  it('单独恢复退款单也能回到账上', () => {
    const before = accountBalance();
    useFinanceStore.getState().removeTransaction('tx-1');
    useFinanceStore.getState().restoreTransaction('tx-1-refund');

    expect(useFinanceStore.getState().trashedTransactions.map((item) => item.id)).toEqual(['tx-1']);
    expect(accountBalance()).not.toBe(before); // 此时账上只有退款,余额确实是多的
    useFinanceStore.getState().restoreTransaction('tx-1');
    expect(accountBalance()).toBe(before);
  });
});
