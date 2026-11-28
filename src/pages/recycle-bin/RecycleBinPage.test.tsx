import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import '../../i18n';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { RecycleBinPage } from './RecycleBinPage';

/**
 * 清空回收站「跳过了几个账户」必须说出来。
 *
 * store 那一层会跳过仍被交易引用的账户(见 shared/store/clearRecycleBin.test.ts),
 * 但页面上如果不说,用户以为全清了 —— 那正是这条规则被绕过的样子。
 */
function account(id: string): Account {
  return {
    id,
    name: '账户 ' + id,
    type: 'cash',
    initialBalance: 0,
    balance: 0,
    sortOrder: 1,
    trashedAt: '2026-11-01T00:00:00.000Z'
  };
}

function transaction(id: string, accountId: string): TransactionItem {
  return {
    id,
    type: 'expense',
    categoryId: 'cat-1',
    accountId,
    amount: 10,
    date: '2026-11-24',
    note: '测试',
    tags: [],
    status: 'completed'
  };
}

function resetStore(input: { trashedAccounts: Account[]; transactions?: TransactionItem[] }) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions: input.transactions || [],
    trashedTransactions: [],
    trashedAccounts: input.trashedAccounts,
    categories: [{ id: 'cat-1', name: '餐饮', kind: 'expense', sortOrder: 1 }],
    accounts: [],
    balanceChangeEntries: [],
    subscriptions: [],
    trashedSubscriptions: [],
    trashedCategories: []
  });
}

const confirmSpy = vi.fn(() => true);

beforeEach(() => {
  confirmSpy.mockClear();
  vi.spyOn(window, 'confirm').mockImplementation(confirmSpy as unknown as typeof window.confirm);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('回收站页面 · 清空', () => {
  it('有账户被跳过时弹出说明,并且那个账户还在列表里', () => {
    resetStore({
      trashedAccounts: [account('acc-blocked')],
      transactions: [transaction('tx-1', 'acc-blocked')]
    });

    render(<RecycleBinPage />);
    fireEvent.click(screen.getByRole('button', { name: /清空回收站/ }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledTimes(1);
    const message = String(
      (window.alert as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]
    );
    expect(message).toContain('1 个账户');
    expect(message).toContain('1 笔交易');
    // 账户仍在页面上(没被清掉)
    expect(screen.getByText(/账户 acc-blocked/)).toBeTruthy();
  });

  it('没有账户被挡住时不弹说明,列表清空', () => {
    resetStore({ trashedAccounts: [account('acc-free')] });

    render(<RecycleBinPage />);
    fireEvent.click(screen.getByRole('button', { name: /清空回收站/ }));

    expect(window.alert).not.toHaveBeenCalled();
    expect(useFinanceStore.getState().trashedAccounts).toEqual([]);
  });
});
