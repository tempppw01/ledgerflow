import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「删分类 → 相关交易归入未分类」这条承诺,在**恢复交易**这条路径上原先断了:
 *
 *  · 删除分类时只清掉**启用列表**里那些交易的引用(removeCategory 遍历的是 s.transactions),
 *    回收站里那一份仍然指着这个分类;
 *  · 而「恢复交易」把回收站那一行**原样**搬回启用列表。
 *
 * 于是「删交易 → 删分类 → 恢复交易」三步下来,启用列表里就出现一笔引用了**不在启用分类里**
 * 的 id 的交易。这个 id 既不是 ''(未分类的正式表示),也没有对应分类,于是同一份数据
 * 在界面上有三种口径:
 *
 *  · 流水列表 / 导出按「查不到就显示未分类」渲染它,看上去没问题;
 *  · 但「未分类」筛选项与助手的「待分类交易」计数都按 `!categoryId` 判断 —— 认不出它;
 *  · 首页分类占比按 categoryId 分组,它和真正的未分类是**两个 key、两行同名**。
 *
 * 服务端对认不出的分类有哨兵兜底(relationalDataRepository 的 uncategorizedCategoryId),
 * 所以丢的是「分类归属」而不是交易本身 —— 但上面三处口径已经互相矛盾。
 *
 * 修复口径与既有承诺一致:**恢复时若原分类已不在启用列表,就按「未分类」恢复**,
 * 并把笔数交给界面说明(不允许静默改口径)。
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
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides
  };
}

function refundRow(): TransactionItem {
  return tx({
    id: 'tx-1-refund',
    adjustmentKind: 'refund',
    refundOfTransactionId: 'tx-1',
    note: '退款:午餐',
    updatedAt: '2026-11-02T12:00:00.000Z'
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
    trashedCategories: [],
    trashedAccounts: [],
    balanceChangeEntries: [],
    subscriptions: [],
    trashedSubscriptions: [],
    categoryLearningRules: [],
    categoryLearningEvents: []
  });
}

/**
 * 本次要守住的不变量:**启用列表里的交易只能引用启用中的分类**。
 * 空串是「未分类」的正式表示,不算悬垂引用。
 */
function danglingCategoryRefs(): string[] {
  const state = useFinanceStore.getState();
  const activeIds = new Set(state.categories.map((item) => item.id));
  return state.transactions
    .filter((item) => item.categoryId && !activeIds.has(item.categoryId))
    .map((item) => `${item.id} -> ${item.categoryId}`);
}

function rowById(id: string): TransactionItem | undefined {
  return useFinanceStore.getState().transactions.find((item) => item.id === id);
}

/** 助手的「待分类交易」计数口径(与 uncategorizedCoherence.test.ts 一致)。 */
function uncategorizedCount(): number {
  return useFinanceStore.getState().transactions.filter((item) => !item.categoryId).length;
}

describe('恢复交易时,已不在启用列表的分类不再被引用', () => {
  beforeEach(() => {
    resetStore([tx()]);
  });

  it('原分类仍在启用列表:引用原样保留(不要过度修)', () => {
    useFinanceStore.getState().removeTransaction('tx-1');
    const result = useFinanceStore.getState().restoreTransaction('tx-1');

    expect(rowById('tx-1')?.categoryId).toBe('cat-food');
    expect(danglingCategoryRefs()).toEqual([]);
    expect(result).toEqual({ restoredCount: 1, uncategorizedCount: 0 });
  });

  it('原分类已移入回收站:恢复回来的那笔归入未分类,不留悬垂引用', () => {
    useFinanceStore.getState().removeTransaction('tx-1');
    useFinanceStore.getState().removeCategory('cat-food');
    // 此时交易在回收站里,引用还指着 cat-food(回收站内的引用是可逆的,先不动它)
    expect(
      useFinanceStore.getState().trashedTransactions.find((item) => item.id === 'tx-1')?.categoryId
    ).toBe('cat-food');

    const result = useFinanceStore.getState().restoreTransaction('tx-1');

    expect(rowById('tx-1')?.categoryId).toBe('');
    expect(danglingCategoryRefs()).toEqual([]);
    expect(uncategorizedCount()).toBe(1);
    expect(result).toEqual({ restoredCount: 1, uncategorizedCount: 1 });
  });

  it('原分类被彻底删除:同样按未分类恢复', () => {
    useFinanceStore.getState().removeTransaction('tx-1');
    useFinanceStore.getState().removeCategory('cat-food');
    useFinanceStore.getState().permanentlyDeleteCategory('cat-food');

    const result = useFinanceStore.getState().restoreTransaction('tx-1');

    expect(rowById('tx-1')?.categoryId).toBe('');
    expect(danglingCategoryRefs()).toEqual([]);
    expect(result).toEqual({ restoredCount: 1, uncategorizedCount: 1 });
  });

  it('先把分类恢复回来,再恢复交易:引用保留(顺序决定结果,但都不留悬垂引用)', () => {
    useFinanceStore.getState().removeTransaction('tx-1');
    useFinanceStore.getState().removeCategory('cat-food');
    useFinanceStore.getState().restoreCategory('cat-food');

    const result = useFinanceStore.getState().restoreTransaction('tx-1');

    expect(rowById('tx-1')?.categoryId).toBe('cat-food');
    expect(danglingCategoryRefs()).toEqual([]);
    expect(result).toEqual({ restoredCount: 1, uncategorizedCount: 0 });
  });

  it('退款/冲正一并回来时按同一口径处理,笔数分别统计', () => {
    resetStore([tx(), refundRow()]);
    useFinanceStore.getState().removeTransaction('tx-1');
    useFinanceStore.getState().removeCategory('cat-food');

    const result = useFinanceStore.getState().restoreTransaction('tx-1');

    expect(rowById('tx-1')?.categoryId).toBe('');
    expect(rowById('tx-1-refund')?.categoryId).toBe('');
    expect(danglingCategoryRefs()).toEqual([]);
    expect(result).toEqual({ restoredCount: 2, uncategorizedCount: 2 });
  });

  it('恢复一个不存在的 id 是空操作,不计入笔数', () => {
    const result = useFinanceStore.getState().restoreTransaction('tx-missing');

    expect(result).toEqual({ restoredCount: 0, uncategorizedCount: 0 });
    expect(danglingCategoryRefs()).toEqual([]);
  });

  it('删除分类本身不产生悬垂引用(既有承诺不回退)', () => {
    useFinanceStore.getState().removeCategory('cat-food');

    expect(rowById('tx-1')?.categoryId).toBe('');
    expect(danglingCategoryRefs()).toEqual([]);
  });
});
