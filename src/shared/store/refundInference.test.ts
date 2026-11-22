import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { normalizeImportedFinanceSnapshot } from './useFinanceStore';

/**
 * 退款方向推断的两个不变量。
 *
 * `normalizeTransactionSemantic` 会在 `adjustmentKind` 缺失时**猜**一条记录是不是退款,
 * 猜错就会把方向弄反:支出被当成资金回流,账户余额差出两个金额。
 *
 * 这里钉住两件事:
 * 1. `adjustmentKind` 明确写着的行,推断不得推翻它;
 * 2. 光凭 `status: 'refunded'` 不足以断定「这一行是退款」—— 应用自己会把**原交易**
 *    标成 `refunded`(全额退款后),它恰恰是支出,不是回流。
 */
function row(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-food',
    accountId: 'acc-1',
    amount: 100,
    date: '2026-11-01T12:00:00.000Z',
    note: '超市',
    tags: [],
    source: 'manual',
    ...overrides
  };
}

const snapshot = (transactions: TransactionItem[]) => ({
  categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense' as const, sortOrder: 1 }],
  accounts: [
    { id: 'acc-1', name: '现金', type: 'cash' as const, initialBalance: 1000, sortOrder: 1 }
  ],
  transactions,
  trashedTransactions: [],
  balanceChangeEntries: [],
  subscriptions: [],
  trashedSubscriptions: [],
  trashedCategories: [],
  trashedAccounts: []
});

function importOnce(transactions: TransactionItem[]) {
  return normalizeImportedFinanceSnapshot(snapshot(transactions));
}

describe('退款方向推断', () => {
  it('明确标了 adjustmentKind: normal 的行不会被推断成退款', () => {
    const result = importOnce([row({ status: 'refunded', adjustmentKind: 'normal' })]);
    expect(result.transactions[0].adjustmentKind).toBe('normal');
  });

  it('原交易被标记为 refunded(全额退款后的正常状态)时,方向不能被反转', () => {
    // 应用在「全额退款」后会把**原交易**的 status 置为 refunded;
    // 这行没有 adjustmentKind(历史数据/导入数据),但它本质是一笔支出。
    const result = importOnce([row({ id: 'tx-original', status: 'refunded' })]);
    const account = result.accounts.find((item) => item.id === 'acc-1');

    expect(result.transactions[0].adjustmentKind, '原交易被误判成退款了').not.toBe('refund');
    // 支出 100 → 余额 900(若被当成回流会变成 1100)
    expect(account?.balance).toBe(900);
  });

  it('备注里出现「退款」字样的支出行仍按退款处理(既有兼容行为)', () => {
    const result = importOnce([row({ id: 'tx-legacy-refund', note: '退款:超市', amount: 100 })]);
    expect(result.transactions[0].adjustmentKind).toBe('refund');
  });
});
