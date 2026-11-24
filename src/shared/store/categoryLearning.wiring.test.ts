import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「分类学习」曾经是空壳:建议返回 null、记录是 noop —— 而数据模型、备份、同步、设置页文案
 * 全都建好了。这里盯住它**真的在工作**:用户改一次分类 → 生成规则 → 下次同类能建议出来。
 */

function tx(over: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-default',
    accountId: 'acc-1',
    amount: 30,
    date: '2026-11-24',
    note: '稻家乐社区厨房(寮步坑口店)',
    tags: [],
    status: 'completed',
    ...over
  };
}

function reset(rows: TransactionItem[]) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions: rows,
    trashedTransactions: [],
    accounts: [
      { id: 'acc-1', name: '现金', type: 'cash', initialBalance: 0, balance: 0, sortOrder: 1 }
    ],
    categories: [
      { id: 'cat-default', name: '未分类', kind: 'expense', sortOrder: 1 },
      { id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 2 }
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

const state = () => useFinanceStore.getState();

describe('分类学习(接线)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('改分类会生成规则,之后同类交易能被建议到同一分类', () => {
    reset([tx()]);
    expect(state().categoryLearningRules).toHaveLength(0);
    expect(
      state().suggestCategoryByLearning({ type: 'expense', note: '稻家乐社区厨房' })
    ).toBeNull();

    // 用户把这笔从「未分类」改成「餐饮」
    state().updateTransaction('tx-1', { ...tx(), categoryId: 'cat-food' });

    expect(state().categoryLearningRules.length).toBeGreaterThan(0);
    expect(state().categoryLearningEvents).toHaveLength(1);

    const suggestion = state().suggestCategoryByLearning({
      type: 'expense',
      note: '稻家乐社区厨房'
    });
    expect(suggestion?.categoryId).toBe('cat-food');
  });

  it('分类没变时不会生成规则(否则每次编辑都记一条)', () => {
    reset([tx({ categoryId: 'cat-food' })]);
    state().updateTransaction('tx-1', { ...tx({ categoryId: 'cat-food' }), amount: 50 });
    expect(state().categoryLearningRules).toHaveLength(0);
  });

  it('带 skipCategoryLearning 时不记规则(机器猜的分类不算用户修正)', () => {
    reset([tx()]);
    /*
     * AI 重分类与关键词兜底也走 updateTransaction 改 categoryId。
     * 那些是**机器猜的**,不该进规则 —— 否则规则里混进 AI 的猜测,
     * 以后同类交易按 AI 当时猜的走,而规则本该学的是人的习惯。
     */
    state().updateTransaction('tx-1', { ...tx(), categoryId: 'cat-food' }, { skipCategoryLearning: true });

    expect(state().categoryLearningRules).toHaveLength(0);
    expect(state().categoryLearningEvents).toHaveLength(0);
    // 交易本身还是要改的
    expect(state().transactions[0].categoryId).toBe('cat-food');
  });

  it('撤销会移除这次生成的规则', () => {
    reset([tx()]);
    state().updateTransaction('tx-1', { ...tx(), categoryId: 'cat-food' });
    expect(state().categoryLearningRules.length).toBeGreaterThan(0);

    expect(state().undoLatestCategoryLearning()).toBe(true);
    expect(state().categoryLearningRules).toHaveLength(0);
    expect(state().categoryLearningEvents).toHaveLength(0);
    // 没有可撤销的东西时返回 false
    expect(state().undoLatestCategoryLearning()).toBe(false);
  });
});