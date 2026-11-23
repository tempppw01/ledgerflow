import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRANSACTION_STATUS } from '../../entities/transaction/types';
import { matchesStatusQuickFilter } from '../../features/transactions/model/statusQuickFilter';
import { useFinanceStore } from './useFinanceStore';

/**
 * 助手导入账单那条写入路径**不传 status**,于是库里出现过 transaction_status 为 NULL 的行
 * (手工记账都会传 'completed')。这批行在别处一律按「计入余额」对待
 * (isBalanceAffectingStatus(undefined) 为真),所以缺省状态必须被当成已完成 ——
 * 而且必须是**同一个**缺省值,否则同一行会「筛『已完成』筛得出来、状态列却显示 -」。
 */
function resetStore() {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions: [],
    trashedTransactions: [],
    categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 }],
    accounts: [
      { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 1000, balance: 1000, sortOrder: 1 }
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

describe('缺省交易状态', () => {
  beforeEach(resetStore);

  it('写入时不带 status 也会落一个明确的默认状态', () => {
    const id = useFinanceStore.getState().addTransaction({
      type: 'expense',
      categoryId: 'cat-food',
      accountId: 'acc-cash',
      amount: 28,
      date: '2026-11-09',
      note: '午餐-简餐 28',
      tags: [],
      source: 'ai'
      // 故意不给 status:助手导入就是这样调的
    } as never);

    const row = useFinanceStore.getState().transactions.find((item) => item.id === id);
    expect(row?.status).toBe(DEFAULT_TRANSACTION_STATUS);
  });

  it('缺状态的行在筛选器里按已完成匹配(与显示同一个默认值)', () => {
    expect(DEFAULT_TRANSACTION_STATUS).toBe('completed');
    expect(matchesStatusQuickFilter('completed', undefined)).toBe(true);
    expect(matchesStatusQuickFilter('all', undefined)).toBe(true);
    expect(matchesStatusQuickFilter('pending', undefined)).toBe(false);
  });
});
