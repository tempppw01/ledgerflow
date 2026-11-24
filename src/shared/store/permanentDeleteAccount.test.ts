import { beforeEach, describe, expect, it } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「彻底删除账户」在**仍被交易引用**时必须拒绝。
 *
 * 为什么:账户一旦真的消失,引用它的交易会在下一次同步时被服务端静默丢弃
 * (导入器丢掉引用无法解析的行),而 `account_id` 是 NOT NULL、外键也不允许悬垂引用 ——
 * 「保留交易」在当前数据模型里表达不出来。回收站里那句「交易仍会保留」说的是
 * **移入回收站**那一步,用户接着点彻底删除时并不知道交易也要跟着没。
 *
 * 回收站的 UI 会先拦一次并把原因告诉用户;这里钉住 store 这一层,避免有别的入口绕过去。
 */
function account(id: string, trashed = true): Account {
  return {
    id,
    name: '账户 ' + id,
    type: 'cash',
    initialBalance: 0,
    balance: 0,
    sortOrder: 1,
    ...(trashed ? { trashedAt: '2026-11-01T00:00:00.000Z' } : {})
  };
}

function transaction(id: string, accountId: string, trashed = false): TransactionItem {
  return {
    id,
    type: 'expense',
    categoryId: 'cat-1',
    accountId,
    amount: 10,
    date: '2026-11-24',
    note: '测试',
    tags: [],
    status: 'completed',
    ...(trashed ? { trashedAt: '2026-11-02T00:00:00.000Z' } : {})
  };
}

function resetStore(input: {
  trashedAccounts: Account[];
  transactions?: TransactionItem[];
  trashedTransactions?: TransactionItem[];
}) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions: input.transactions || [],
    trashedTransactions: input.trashedTransactions || [],
    trashedAccounts: input.trashedAccounts,
    categories: [{ id: 'cat-1', name: '餐饮', kind: 'expense', sortOrder: 1 }],
    accounts: [],
    balanceChangeEntries: [],
    subscriptions: [],
    trashedSubscriptions: [],
    trashedCategories: []
  });
}

const state = () => useFinanceStore.getState();

describe('彻底删除账户', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('账户下还有交易时拒绝删除,并报出条数', () => {
    resetStore({
      trashedAccounts: [account('acc-1')],
      transactions: [transaction('tx-1', 'acc-1'), transaction('tx-2', 'acc-1')]
    });

    const result = state().permanentlyDeleteAccount('acc-1');

    expect(result).toEqual({ ok: false, reason: 'hasTransactions', count: 2 });
    // 关键:账户必须**还在**回收站里,不能被删掉
    expect(state().trashedAccounts.map((item) => item.id)).toEqual(['acc-1']);
  });

  it('回收站里的交易也算数(它们同样会找不到账户)', () => {
    resetStore({
      trashedAccounts: [account('acc-1')],
      trashedTransactions: [transaction('tx-1', 'acc-1', true)]
    });

    const result = state().permanentlyDeleteAccount('acc-1');

    expect(result.ok).toBe(false);
    expect(state().trashedAccounts).toHaveLength(1);
  });

  it('没有交易引用时正常删除', () => {
    resetStore({ trashedAccounts: [account('acc-1')] });

    const result = state().permanentlyDeleteAccount('acc-1');

    expect(result).toEqual({ ok: true });
    expect(state().trashedAccounts).toHaveLength(0);
  });

  it('只挡住被引用的那个账户,别的引用不算到它头上', () => {
    resetStore({
      trashedAccounts: [account('acc-1'), account('acc-2')],
      transactions: [transaction('tx-1', 'acc-2')]
    });

    expect(state().permanentlyDeleteAccount('acc-1')).toEqual({ ok: true });
    expect(state().permanentlyDeleteAccount('acc-2').ok).toBe(false);
  });
});