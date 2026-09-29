import { beforeEach, describe, expect, it } from 'vitest';
import { useFinanceStore } from '../shared/store/useFinanceStore';
import type { Account } from '../entities/account/types';
import type { TransactionItem } from '../entities/transaction/types';

const account: Account = {
  id: 'acct-undo',
  name: '现金',
  type: 'cash',
  initialBalance: 0,
  balance: 0,
  sortOrder: 0
};

function addExpense(): string {
  return useFinanceStore.getState().addTransaction({
    type: 'expense',
    amount: 100,
    categoryId: 'cat-1',
    accountId: account.id,
    date: '2026-09-29',
    note: '撤销测试',
    tags: [],
    source: 'manual',
    status: 'completed'
  } as Omit<TransactionItem, 'id'>);
}

describe('quick add undo', () => {
  beforeEach(() => {
    useFinanceStore.setState({
      transactions: [],
      trashedTransactions: [],
      accounts: [account]
    } as never);
  });

  it('removes the just-added transaction from the active list', () => {
    const id = addExpense();
    expect(useFinanceStore.getState().transactions.some((item) => item.id === id)).toBe(true);

    // This is the exact call the 撤销 button makes.
    useFinanceStore.getState().removeTransaction(id);

    expect(useFinanceStore.getState().transactions.some((item) => item.id === id)).toBe(false);
  });

  it('keeps the undone transaction recoverable from the recycle bin', () => {
    const id = addExpense();
    useFinanceStore.getState().removeTransaction(id);

    expect(useFinanceStore.getState().trashedTransactions.some((item) => item.id === id)).toBe(true);

    useFinanceStore.getState().restoreTransaction(id);

    expect(useFinanceStore.getState().transactions.some((item) => item.id === id)).toBe(true);
    expect(useFinanceStore.getState().trashedTransactions.some((item) => item.id === id)).toBe(false);
  });
});
