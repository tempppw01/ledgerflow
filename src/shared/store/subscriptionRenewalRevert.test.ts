import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionItem } from '../../entities/subscription/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「生成支出」会推进续费日;删掉那笔生成的流水时,日期必须**退回去**。
 *
 * 不退的话,再点一次生成会再推进一期:演示账本 iCloud+ 实测
 * 基线 2026-11-28 → 生成 2026-12-28 → 删掉流水(仍 12-28)→ 再生成 **2027-01-28**,
 * 整段 12 月被跳过 —— 而这个日期同时驱动「续费已逾期」提醒与首页资产负债预测。
 *
 * 退回用的是生成时存下来的 prevRenewalDate,不是「倒推一期」:日期推算是夹过月尾的
 * (1月31日 +1月 = 2月28日),倒推只能得到 1月28日。下面第二条用例专门盯这一点。
 */
function subscription(overrides: Partial<SubscriptionItem> = {}): SubscriptionItem {
  return {
    id: 'sub-1',
    name: 'iCloud+ 200GB',
    kind: 'digital',
    amount: 21,
    currency: 'CNY',
    billingCycle: 'monthly',
    accountId: 'acc-1',
    status: 'active',
    renewalDate: '2026-11-28',
    expireDate: '2026-11-28',
    autoRenew: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function resetStore(subscriptions: SubscriptionItem[]) {
  useFinanceStore.setState({
    hasHydrated: true,
    transactions: [],
    trashedTransactions: [],
    categories: [{ id: 'cat-entertainment', name: '娱乐', kind: 'expense', sortOrder: 1 }],
    accounts: [
      { id: 'acc-1', name: '现金', type: 'cash', initialBalance: 1000, balance: 1000, sortOrder: 1 }
    ],
    balanceChangeEntries: [],
    subscriptions,
    trashedSubscriptions: [],
    trashedCategories: [],
    trashedAccounts: [],
    categoryLearningRules: [],
    categoryLearningEvents: []
  });
}

const state = () => useFinanceStore.getState();
const renewal = () => state().subscriptions[0].renewalDate?.slice(0, 10);

describe('生成支出与续费日', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 24, 10, 0, 0));
    localStorage.clear();
    resetStore([subscription()]);
  });

  it('删掉生成的流水会把续费日退回上一期,并保留可逆所需的快照与关联', () => {
    expect(renewal()).toBe('2026-11-28');
    const generated = state().generateSubscriptionTransaction('sub-1');
    expect(renewal()).toBe('2026-12-28');

    state().removeTransaction(generated.transactionId);

    expect(renewal()).toBe('2026-11-28');
    // 回收站是可逆的,所以快照与关联要**留着** —— 恢复时要靠它们把日期推回去
    expect(state().subscriptions[0].lastGeneratedTransactionId).toBe(generated.transactionId);
    expect(state().subscriptions[0].prevRenewalDate).toBe('2026-11-28');
    // 状态跟着退回后的日期重算:今天是 11-24、续费日回到 11-28 → 即将到期(不再是 active)
    expect(state().subscriptions[0].status).toBe('due-soon');
  });

  it('从回收站恢复那笔流水,续费日回到「已生成」的状态(否则再生成会重复记一笔)', () => {
    const generated = state().generateSubscriptionTransaction('sub-1');
    expect(renewal()).toBe('2026-12-28');

    state().removeTransaction(generated.transactionId);
    expect(renewal()).toBe('2026-11-28');

    state().restoreTransaction(generated.transactionId);

    // 推回生成后的日期,并清掉快照(那笔流水又回到账上了)
    expect(renewal()).toBe('2026-12-28');
    expect(state().subscriptions[0].prevRenewalDate).toBeUndefined();
    expect(state().subscriptions[0].lastGeneratedTransactionId).toBe(generated.transactionId);
    expect(state().transactions).toHaveLength(1);
    expect(state().trashedTransactions).toHaveLength(0);
    // 12-28 还在未来 → 状态回到 active
    expect(state().subscriptions[0].status).toBe('active');
  });

  it('彻底删除才是不可逆的:那时才清掉快照与关联', () => {
    const generated = state().generateSubscriptionTransaction('sub-1');
    state().removeTransaction(generated.transactionId);
    expect(state().subscriptions[0].prevRenewalDate).toBe('2026-11-28');

    state().permanentlyDeleteTransaction(generated.transactionId);

    expect(state().subscriptions[0].lastGeneratedTransactionId).toBeUndefined();
    expect(state().subscriptions[0].prevRenewalDate).toBeUndefined();
    expect(state().trashedTransactions).toHaveLength(0);
  });

  it('删除后再生成,续费日只推进一期(不会跳过整个周期)', () => {
    const first = state().generateSubscriptionTransaction('sub-1');
    state().removeTransaction(first.transactionId);
    state().generateSubscriptionTransaction('sub-1');

    expect(renewal()).toBe('2026-12-28');
    expect(renewal()).not.toBe('2027-01-28');
  });

  it('月末日期也能精确还原(1月31日不会退成1月28日)', () => {
    resetStore([subscription({ renewalDate: '2026-01-31', expireDate: '2026-01-31' })]);
    const generated = state().generateSubscriptionTransaction('sub-1');
    // 夹到 2 月最后一天
    expect(renewal()).toBe('2026-02-28');

    state().removeTransaction(generated.transactionId);

    // 倒推一期只能得到 1月28日 —— 这里必须回到 1月31日
    expect(renewal()).toBe('2026-01-31');
  });

  it('删掉的不是它生成的那笔流水时,续费日不动', () => {
    state().generateSubscriptionTransaction('sub-1');
    const other = state().addTransaction({
      type: 'expense',
      categoryId: 'cat-entertainment',
      accountId: 'acc-1',
      amount: 5,
      date: '2026-11-24T02:00:00.000Z',
      note: '无关的一笔',
      tags: []
    } as never);

    state().removeTransaction(other);

    expect(renewal()).toBe('2026-12-28');
  });
});
