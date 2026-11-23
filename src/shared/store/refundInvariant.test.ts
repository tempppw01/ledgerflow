import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

const FINANCE_STORAGE_KEY = 'ledgerflow-finance';

function expense(overrides: Partial<TransactionItem> = {}): TransactionItem {
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

function resetStore(transactions: TransactionItem[] = []) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions,
    categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 }],
    accounts: [
      { id: 'acc-1', name: '现金', type: 'cash', initialBalance: 1000, balance: 1000, sortOrder: 1 }
    ],
    trashedTransactions: [],
    trashedCategories: [],
    trashedAccounts: [],
    balanceChangeEntries: [],
    subscriptions: [],
    trashedSubscriptions: [],
    categoryLearningRules: [],
    categoryLearningEvents: []
  });
}

/** 该交易已退掉的总额(直接读 store,不依赖内部实现)。 */
function refundedTotal(transactionId: string): number {
  return useFinanceStore
    .getState()
    .transactions.filter(
      (item) =>
        item.refundOfTransactionId === transactionId &&
        (item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal')
    )
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
}

function accountDelta(): number {
  const state = useFinanceStore.getState();
  const account = state.accounts.find((item) => item.id === 'acc-1');
  return Number(account?.balance ?? 0) - 1000;
}

describe('退款金额不变量:已退总额不得超过原交易金额', () => {
  beforeEach(() => {
    localStorage.removeItem(FINANCE_STORAGE_KEY);
    resetStore([expense()]);
  });

  it('创建退款时超过剩余可退金额会被拒绝(既有行为)', () => {
    // 失败会抛错,不是返回 { ok: false }
    expect(() =>
      useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 150 })
    ).toThrow(/剩余可退金额/);
    expect(refundedTotal('tx-1')).toBe(0);
  });

  it('全额退款后账户净额归零', () => {
    const result = useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 100 });
    expect(result.refundedAmount).toBe(100);
    expect(result.fullyRefunded).toBe(true);
    expect(result.remainingRefundableAmount).toBe(0);
    // 支出 100、退款流入 100 → 净 0
    expect(accountDelta()).toBe(0);
    expect(refundedTotal('tx-1')).toBe(100);
  });

  it('把原交易金额改到低于已退总额时,应当拒绝这次编辑', () => {
    useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 100 });
    const original = useFinanceStore.getState().transactions.find((item) => item.id === 'tx-1');
    expect(original).toBeTruthy();

    // 编辑原交易:金额从 100 改成 50(低于已退的 100)
    expect(() =>
      useFinanceStore.getState().updateTransaction('tx-1', {
        ...(original as TransactionItem),
        amount: 50
      })
    ).toThrow(/已退 .* 元,金额不能低于该值/);

    // 数据必须原样不动,且不变量仍然成立
    const after = useFinanceStore.getState().transactions.find((item) => item.id === 'tx-1');
    expect(after?.amount).toBe(100);
    expect(refundedTotal('tx-1')).toBeLessThanOrEqual(Number(after?.amount ?? 0));
    expect(accountDelta()).toBe(0);
  });

  it('把退款金额改到超过原交易金额时,应当拒绝这次编辑', () => {
    useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 40 });
    const refund = useFinanceStore
      .getState()
      .transactions.find((item) => item.refundOfTransactionId === 'tx-1');
    expect(refund).toBeTruthy();

    expect(() =>
      useFinanceStore.getState().updateTransaction((refund as TransactionItem).id, {
        ...(refund as TransactionItem),
        amount: 500
      })
    ).toThrow(/退款总额不能超过原交易金额/);

    const afterRefund = useFinanceStore
      .getState()
      .transactions.find((item) => item.id === (refund as TransactionItem).id);
    expect(afterRefund?.amount).toBe(40);
    expect(refundedTotal('tx-1')).toBeLessThanOrEqual(100);
  });

  it('合法编辑不受影响:改小到「仍不低于已退金额」可以通过', () => {
    useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 40 });
    const original = useFinanceStore.getState().transactions.find((item) => item.id === 'tx-1');

    useFinanceStore.getState().updateTransaction('tx-1', {
      ...(original as TransactionItem),
      amount: 60
    });

    const after = useFinanceStore.getState().transactions.find((item) => item.id === 'tx-1');
    expect(after?.amount).toBe(60);
    expect(refundedTotal('tx-1')).toBeLessThanOrEqual(60);
  });

  it('导入/恢复可以带 allowRefundOverflow 跳过校验(既有数据不能被拒之门外)', () => {
    useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 100 });
    const original = useFinanceStore.getState().transactions.find((item) => item.id === 'tx-1');

    useFinanceStore.getState().updateTransaction(
      'tx-1',
      { ...(original as TransactionItem), amount: 50 },
      { allowRefundOverflow: true }
    );

    const after = useFinanceStore.getState().transactions.find((item) => item.id === 'tx-1');
    expect(after?.amount).toBe(50);
  });

  /*
   * 退款单是原交易的附属记录。原先删除原交易只移送它自己一行,
   * 留下的退款就成了一笔凭空的收入:¥1000 初始余额、删掉 ¥100 的支出之后
   * 账上是 ¥1040 —— 退了的 ¥40 变成白捡的钱(演示账本里的
   * 「家居小物 ¥390.55」正是这样一对)。
   */
  it('删除原交易时,挂在它上面的退款一并移入回收站,余额不会凭空变多', () => {
    useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 40 });

    const refundId = useFinanceStore
      .getState()
      .transactions.find((item) => item.refundOfTransactionId === 'tx-1')?.id;
    expect(refundId).toBeDefined();

    useFinanceStore.getState().removeTransaction('tx-1');

    const state = useFinanceStore.getState();
    expect(state.transactions).toHaveLength(0);
    expect(state.trashedTransactions.map((item) => item.id).sort()).toEqual(
      ['tx-1', refundId as string].sort()
    );
    // 两笔都离开主列表后,余额回到初始值:既没有那笔支出,也没有那笔退款。
    expect(state.accounts[0].balance).toBe(1000);
  });

  it('删除原交易不会碰别笔交易的退款', () => {
    useFinanceStore.setState({
      transactions: [
        ...useFinanceStore.getState().transactions,
        expense({ id: 'tx-2', amount: 200, note: '另一笔' }),
        expense({
          id: 'ref-2',
          amount: 50,
          adjustmentKind: 'refund',
          refundOfTransactionId: 'tx-2',
          note: '退款 2'
        })
      ] as TransactionItem[]
    });
    useFinanceStore.getState().refundTransaction({ transactionId: 'tx-1', amount: 40 });

    useFinanceStore.getState().removeTransaction('tx-1');

    const activeIds = useFinanceStore.getState().transactions.map((item) => item.id).sort();
    expect(activeIds).toEqual(['ref-2', 'tx-2']);
  });
});
