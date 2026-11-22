import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { EMPTY_CATEGORY_FILTER_VALUE, matchesCategoryQuickFilter } from '../../features/transactions/model/categoryQuickFilter';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「未分类」在三处必须说同一件事:
 *
 * 1. **数据表示**:删分类时把交易的引用清成 `''`
 * 2. **筛选哨兵**:`EMPTY_CATEGORY_FILTER_VALUE` 表示「分类为空」
 * 3. **助手统计**:用「categoryId 为空」判断,而不是某个字符串字面量
 *
 * 之前三者不一致:助手比的是 `'uncategorized'`(从不存在)→ 计数恒为 0、
 * 卡片链接 `?categoryId=uncategorized` 被列表忽略 → 点了没反应。
 */
function tx(overrides: Partial<TransactionItem> = {}): TransactionItem {
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
    ...overrides
  };
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
    trashedCategories: [],
    trashedAccounts: [],
    balanceChangeEntries: [],
    subscriptions: [],
    trashedSubscriptions: [],
    categoryLearningRules: [],
    categoryLearningEvents: []
  });
}

/** 助手的「待分类交易」计数口径。 */
function countUncategorized(): number {
  return useFinanceStore.getState().transactions.filter((item) => !item.categoryId).length;
}

describe('「未分类」口径一致性', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore([tx({ id: 'tx-a', categoryId: 'cat-food' }), tx({ id: 'tx-b', note: '晚餐' })]);
  });

  it('删除分类后,相关交易的引用被清空,并被「未分类」计数认出', () => {
    // fixture 里两条都引用 cat-food
    expect(countUncategorized()).toBe(0);

    useFinanceStore.getState().removeCategory('cat-food');

    const rows = useFinanceStore.getState().transactions;
    expect(rows.find((item) => item.id === 'tx-a')?.categoryId).toBe('');
    expect(rows.find((item) => item.id === 'tx-b')?.categoryId).toBe('');
    expect(countUncategorized()).toBe(2);
  });

  it('筛选哨兵认「引用为空」的行', () => {
    useFinanceStore.getState().removeCategory('cat-food');
    const rows = useFinanceStore.getState().transactions;
    const empty = rows.find((item) => item.id === 'tx-a');

    expect(
      matchesCategoryQuickFilter(EMPTY_CATEGORY_FILTER_VALUE, String(empty?.categoryId ?? ''))
    ).toBe(true);
  });

  it('助手用的判据与筛选哨兵对同一份数据给出相同结论', () => {
    useFinanceStore.getState().removeCategory('cat-food');
    const rows = useFinanceStore.getState().transactions;

    const byAssistant = rows.filter((item) => !item.categoryId).map((item) => item.id);
    const byFilter = rows
      .filter((item) => matchesCategoryQuickFilter(EMPTY_CATEGORY_FILTER_VALUE, item.categoryId))
      .map((item) => item.id);

    expect(byAssistant).toEqual(byFilter);
  });

  it('哨兵值不会被当成真实分类 id(不会误命中别的分类)', () => {
    expect(matchesCategoryQuickFilter(EMPTY_CATEGORY_FILTER_VALUE, 'cat-food')).toBe(false);
  });
});
