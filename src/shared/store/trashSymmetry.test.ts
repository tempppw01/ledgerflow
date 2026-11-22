import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 回收站的对称性不变量:
 *
 * 1. 删除后:只在回收站里,不在主列表,余额不再受它影响
 * 2. 恢复后:只在主列表里,`trashedAt` 清空,余额恢复
 * 3. 往返一次:字段一个不少(附件、单号、退款关联、状态)
 * 4. **任何时刻,这条记录必须恰好存在于一个列表里** —— 既不该同时出现在两边,
 *    也不该两边都没有(那等于静默丢数据)
 * 5. 重复删除 / 重复恢复 / 恢复不存在的 id,都必须是安全的空操作
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
    tags: ['午餐'],
    source: 'manual',
    status: 'completed',
    orderNo: 'ORDER-1',
    attachments: [
      {
        id: 'att-1',
        name: 'r.png',
        remotePath: 'p/r.png',
        uploadedAt: '2026-11-01T12:30:00.000Z',
        mimeType: 'image/png',
        size: 1024
      }
    ],
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides
  };
}

function resetStore(transactions: TransactionItem[] = [], trashed: TransactionItem[] = []) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions,
    trashedTransactions: trashed,
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

function state() {
  return useFinanceStore.getState();
}

function occurrences(id: string): number {
  const s = state();
  return [...s.transactions, ...s.trashedTransactions].filter((item) => item.id === id).length;
}

function balance(): number {
  return Number(state().accounts.find((item) => item.id === 'acc-1')?.balance ?? 0);
}

describe('回收站对称性', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore([tx()]);
  });

  it('删除后只在回收站里,余额不再受它影响', () => {
    state().removeTransaction('tx-1');

    expect(state().transactions.map((item) => item.id)).not.toContain('tx-1');
    expect(state().trashedTransactions.map((item) => item.id)).toContain('tx-1');
    expect(balance()).toBe(1000);
    expect(occurrences('tx-1')).toBe(1);
  });

  it('恢复后回到主列表,trashedAt 清空,余额恢复', () => {
    state().removeTransaction('tx-1');
    state().restoreTransaction('tx-1');

    const row = state().transactions.find((item) => item.id === 'tx-1');
    expect(row).toBeTruthy();
    expect(row?.trashedAt).toBeUndefined();
    expect(state().trashedTransactions.map((item) => item.id)).not.toContain('tx-1');
    expect(balance()).toBe(900);
    expect(occurrences('tx-1')).toBe(1);
  });

  it('删除 → 恢复 往返后字段一个不少', () => {
    const before = state().transactions.find((item) => item.id === 'tx-1');
    state().removeTransaction('tx-1');
    state().restoreTransaction('tx-1');
    const after = state().transactions.find((item) => item.id === 'tx-1');

    expect(after?.orderNo).toBe('ORDER-1');
    expect(after?.attachments).toHaveLength(1);
    expect(after?.status).toBe('completed');
    expect(after?.amount).toBe(before?.amount);
    expect(after?.note).toBe(before?.note);
  });

  it('重复删除与重复恢复都是安全的空操作', () => {
    state().removeTransaction('tx-1');
    state().removeTransaction('tx-1');
    expect(occurrences('tx-1')).toBe(1);

    state().restoreTransaction('tx-1');
    state().restoreTransaction('tx-1');
    expect(occurrences('tx-1')).toBe(1);
    expect(state().transactions.filter((item) => item.id === 'tx-1')).toHaveLength(1);
    expect(balance()).toBe(900);
  });

  it('恢复不存在的 id 不改变任何状态', () => {
    const before = JSON.stringify(state().transactions);
    state().restoreTransaction('tx-does-not-exist');
    expect(JSON.stringify(state().transactions)).toBe(before);
  });

  it('主列表已存在同一 id 时,恢复不能让这条记录从两个列表里消失', () => {
    // 构造不一致状态:同一个 id 既在回收站又在主列表(历史数据/并发写入可能出现)
    resetStore([tx({ id: 'tx-dup' })], [tx({ id: 'tx-dup', trashedAt: '2026-11-02T00:00:00.000Z' })]);

    state().restoreTransaction('tx-dup');

    expect(occurrences('tx-dup'), '恢复后这条记录必须仍然存在').toBe(1);
    expect(balance()).toBe(900);
  });

  it('永久删除后两个列表都没有它', () => {
    state().removeTransaction('tx-1');
    state().permanentlyDeleteTransaction('tx-1');

    expect(occurrences('tx-1')).toBe(0);
    expect(balance()).toBe(1000);
  });
});
