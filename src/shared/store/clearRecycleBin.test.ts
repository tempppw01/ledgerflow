import { describe, expect, it } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「清空回收站」与「彻底删除账户」必须守**同一条规则**:仍被交易引用的账户不能真删。
 *
 * 为什么:账户行真删之后,引用它的交易会在下一次整份导入时被服务端静默丢掉
 * (`account_id` 是 NOT NULL)。逐个彻底删除那条路径早就挡住了,而「清空回收站」
 * 原来是无条件把四个数组清空 —— 于是被挡住的东西从这扇大门直接放走。
 *
 * 两条路径有一条**刻意的差别**:逐个删除时,回收站里的交易也算引用;清空回收站时不算
 * (那一步本来就会把回收站里的交易一起删掉,再拿它们当理由跳过账户只会让人困惑)。
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
    trashedCategories: [
      {
        id: 'cat-9',
        name: '旧分类',
        kind: 'expense',
        sortOrder: 9,
        trashedAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  });
}

describe('清空回收站', () => {
  it('跳过名下还有交易的账户,其余条目照常清空', () => {
    resetStore({
      trashedAccounts: [account('acc-blocked'), account('acc-free')],
      transactions: [transaction('tx-1', 'acc-blocked'), transaction('tx-2', 'acc-blocked')]
    });

    const result = useFinanceStore.getState().clearRecycleBin();
    const state = useFinanceStore.getState();

    expect(result.blockedAccountCount).toBe(1);
    expect(result.blockedTransactionCount).toBe(2);
    expect(state.trashedAccounts.map((item) => item.id)).toEqual(['acc-blocked']);
    // 其余三类照常清空
    expect(state.trashedTransactions).toEqual([]);
    expect(state.trashedCategories).toEqual([]);
    expect(state.trashedSubscriptions).toEqual([]);
    // 回收站里一共 3 个条目(2 个账户 + 1 个分类),其中 1 个账户被跳过 → 清掉 2 个
    expect(result.clearedCount).toBe(2);
  });

  it('交易挪走之后,同一个账户就能清掉了', () => {
    resetStore({
      trashedAccounts: [account('acc-blocked')],
      transactions: [transaction('tx-1', 'acc-blocked')]
    });
    expect(useFinanceStore.getState().clearRecycleBin().blockedAccountCount).toBe(1);

    // 把那笔交易改到别的账户(用户在别处做的动作),再清一次
    useFinanceStore.setState((s) => ({
      transactions: s.transactions.map((item) => ({ ...item, accountId: 'acc-other' }))
    }));
    const result = useFinanceStore.getState().clearRecycleBin();
    expect(result.blockedAccountCount).toBe(0);
    expect(useFinanceStore.getState().trashedAccounts).toEqual([]);
  });

  it('同一个账户:逐个彻底删除也被拒 —— 两条路径答案一致', () => {
    resetStore({
      trashedAccounts: [account('acc-blocked')],
      transactions: [transaction('tx-1', 'acc-blocked')]
    });

    expect(useFinanceStore.getState().permanentlyDeleteAccount('acc-blocked')).toEqual({
      ok: false,
      reason: 'hasTransactions',
      count: 1
    });
    expect(useFinanceStore.getState().clearRecycleBin().blockedAccountCount).toBe(1);
    // 两条路径都没把它删掉
    expect(useFinanceStore.getState().trashedAccounts.map((item) => item.id)).toEqual([
      'acc-blocked'
    ]);
  });

  it('只被回收站里的交易引用时,清空可以完成(那一步本来就会删掉那些交易)', () => {
    resetStore({
      trashedAccounts: [account('acc-only-trashed-refs')],
      trashedTransactions: [transaction('tx-trashed', 'acc-only-trashed-refs', true)]
    });

    const result = useFinanceStore.getState().clearRecycleBin();
    expect(result.blockedAccountCount).toBe(0);
    expect(useFinanceStore.getState().trashedAccounts).toEqual([]);
    expect(useFinanceStore.getState().trashedTransactions).toEqual([]);
  });
});
