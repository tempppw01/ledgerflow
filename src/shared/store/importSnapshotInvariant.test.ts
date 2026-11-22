import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { normalizeImportedFinanceSnapshot } from './useFinanceStore';

/**
 * 导入/恢复后的状态不变量:
 *
 * 1. **已删除的交易不能留在主列表里** —— 带着 `trashedAt` 的行若留在 `transactions`,
 *    交易列表会把它当正常记录展示(账户余额那边倒是排除的),用户会以为删掉的东西又回来了。
 * 2. **每条交易只能出现一次** —— 同时出现在两个数组里会被算两遍。
 * 3. 字段不能在规范化过程中被丢掉(分类父子关系、附件、退款关联、单号)。
 */
function tx(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    amount: 88,
    date: '2026-04-10',
    note: '午餐',
    tags: ['午餐'],
    source: 'manual',
    status: 'completed',
    ...overrides
  };
}

const baseSnapshot = {
  categories: [
    { id: 'cat-root', name: '餐饮', kind: 'expense' as const, sortOrder: 1 },
    { id: 'cat-1', name: '午餐', kind: 'expense' as const, parentId: 'cat-root', sortOrder: 2 }
  ],
  accounts: [
    { id: 'acc-1', name: '现金', type: 'cash' as const, initialBalance: 1000, sortOrder: 1 }
  ],
  balanceChangeEntries: [],
  subscriptions: [],
  trashedSubscriptions: [],
  trashedCategories: [],
  trashedAccounts: []
};

describe('normalizeImportedFinanceSnapshot 不变量', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('带着 trashedAt 的交易不应留在主列表里', () => {
    const result = normalizeImportedFinanceSnapshot({
      ...baseSnapshot,
      transactions: [tx({ id: 'tx-live' }), tx({ id: 'tx-deleted', trashedAt: '2026-04-11T00:00:00.000Z' })],
      trashedTransactions: []
    });

    const liveIds = result.transactions.map((item) => item.id);
    expect(liveIds, '已删除的交易被当成了正常记录').not.toContain('tx-deleted');
  });

  it('同一笔交易不会同时出现在两个数组里(不重复计数)', () => {
    const result = normalizeImportedFinanceSnapshot({
      ...baseSnapshot,
      transactions: [tx({ id: 'tx-dup' })],
      trashedTransactions: [tx({ id: 'tx-dup', trashedAt: '2026-04-11T00:00:00.000Z' })]
    });

    const allIds = [...result.transactions, ...result.trashedTransactions].map((item) => item.id);
    expect(new Set(allIds).size, '同一个 id 出现了多次').toBe(allIds.length);
  });

  it('规范化后分类的父子关系必须保留', () => {
    const result = normalizeImportedFinanceSnapshot({
      ...baseSnapshot,
      transactions: [tx()],
      trashedTransactions: []
    });

    const child = result.categories.find((item) => item.id === 'cat-1');
    expect(child?.parentId).toBe('cat-root');
  });

  it('交易的可选字段在导入后仍然存在', () => {
    const result = normalizeImportedFinanceSnapshot({
      ...baseSnapshot,
      transactions: [
        tx({
          id: 'tx-rich',
          orderNo: 'ORDER-1',
          merchantOrderNo: 'MERCHANT-1',
          attachments: [
            {
              id: 'att-1',
              name: 'r.png',
              remotePath: 'p/r.png',
              uploadedAt: '2026-04-10T08:00:00.000Z',
              mimeType: 'image/png',
              size: 10
            }
          ]
        })
      ],
      trashedTransactions: []
    });

    const row = result.transactions.find((item) => item.id === 'tx-rich');
    expect(row?.orderNo).toBe('ORDER-1');
    expect(row?.merchantOrderNo).toBe('MERCHANT-1');
    expect(row?.attachments).toHaveLength(1);
  });

  it('账户余额按「影响余额的行」重算:已删除与待支付不计入', () => {
    const result = normalizeImportedFinanceSnapshot({
      ...baseSnapshot,
      transactions: [
        tx({ id: 'tx-ok', amount: 100 }),
        tx({ id: 'tx-pending', amount: 500, status: 'pending' })
      ],
      trashedTransactions: [tx({ id: 'tx-deleted', amount: 900, status: 'completed', trashedAt: 'x' })]
    });

    const account = result.accounts.find((item) => item.id === 'acc-1');
    // 初始 1000,只有 tx-ok 的 100 生效
    expect(account?.balance).toBe(900);
  });
});
