import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionItem } from '../../entities/subscription/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「生成订阅支出」会**直接写一笔流水并推进续费日**,所以三件事必须成立:
 *
 * 1. 记的金额、账户、分类与订阅一致
 * 2. 同一天重复点击不会重复记账(幂等)
 * 3. 生成后续费日恰好推进一期(不推进会让首页永远提示「续费已逾期」)
 */
function subscription(overrides: Partial<SubscriptionItem> = {}): SubscriptionItem {
  return {
    id: 'sub-1',
    name: '音乐会员',
    kind: 'digital',
    amount: 15,
    currency: 'CNY',
    billingCycle: 'monthly',
    accountId: 'acc-1',
    status: 'active',
    renewalDate: '2026-11-20',
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

function state() {
  return useFinanceStore.getState();
}

function generatedRows() {
  return state().transactions.filter((item) => item.tags?.includes('订阅'));
}

describe('生成订阅支出', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 22, 10, 0, 0));
    localStorage.clear();
    resetStore([subscription()]);
  });

  it('写入的支出金额、账户、类型与订阅一致', () => {
    const result = state().generateSubscriptionTransaction('sub-1');
    expect(result.duplicated).toBe(false);

    const row = state().transactions.find((item) => item.id === result.transactionId);
    expect(row).toBeTruthy();
    expect(row?.type).toBe('expense');
    expect(row?.amount).toBe(15);
    expect(row?.accountId).toBe('acc-1');
    expect(row?.status).toBe('completed');
    expect(row?.tags).toContain('订阅');
    expect(row?.note).toContain('音乐会员');
  });

  it('同一天重复点击不会重复记账', () => {
    const first = state().generateSubscriptionTransaction('sub-1');
    const second = state().generateSubscriptionTransaction('sub-1');

    expect(second.duplicated).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(generatedRows()).toHaveLength(1);
    // 账户只被扣一次
    expect(state().accounts[0].balance).toBe(985);
  });

  it('生成后续费日恰好推进一期', () => {
    state().generateSubscriptionTransaction('sub-1');
    expect(state().subscriptions[0].renewalDate?.slice(0, 10)).toBe('2026-12-20');
    expect(state().subscriptions[0].lastGeneratedTransactionId).toBeTruthy();
  });

  it('月底订阅推进到 2 月时按 2 月最后一天夹住,不跳到 3 月', () => {
    resetStore([subscription({ renewalDate: '2026-12-31' })]);
    state().generateSubscriptionTransaction('sub-1');
    expect(state().subscriptions[0].renewalDate?.slice(0, 10)).toBe('2027-01-31');

    resetStore([subscription({ renewalDate: '2026-01-31' })]);
    state().generateSubscriptionTransaction('sub-1');
    expect(state().subscriptions[0].renewalDate?.slice(0, 10)).toBe('2026-02-28');
  });

  it('续费日与到期日同时存在时都推进', () => {
    resetStore([subscription({ renewalDate: '2026-11-20', expireDate: '2027-11-20' })]);
    state().generateSubscriptionTransaction('sub-1');
    expect(state().subscriptions[0].renewalDate?.slice(0, 10)).toBe('2026-12-20');
    expect(state().subscriptions[0].expireDate?.slice(0, 10)).toBe('2027-12-20');
  });

  it('生成后的状态按推进后的日期重算', () => {
    resetStore([subscription({ renewalDate: '2026-11-20', status: 'due-soon' })]);
    state().generateSubscriptionTransaction('sub-1');
    // 推进到 12-20(距 11-22 还有近一个月)→ 不应还是「即将到期」
    expect(state().subscriptions[0].status).toBe('active');
  });

  it('订阅绑定的账户已不存在时抛错,不写指向空账户的流水', () => {
    // 账户被删掉后,订阅上仍留着旧 accountId —— 照样写流水会得到一个悬空引用:
    // 余额里看不到它,支出统计里却有它。
    useFinanceStore.setState({ accounts: [] });
    expect(() => state().generateSubscriptionTransaction('sub-1')).toThrow(/账户已不存在/);
    expect(state().transactions).toHaveLength(0);
  });

  it('没有绑定账户时用第一个账户;一个账户都没有才报错', () => {
    resetStore([subscription({ accountId: undefined })]);
    const ok = state().generateSubscriptionTransaction('sub-1');
    expect(ok.duplicated).toBe(false);
    expect(generatedRows()).toHaveLength(1);

    useFinanceStore.setState({ accounts: [], transactions: [] });
    expect(() => state().generateSubscriptionTransaction('sub-1')).toThrow(/没有可用账户/);
  });

  it('订阅不存在时抛错', () => {
    expect(() => state().generateSubscriptionTransaction('nope')).toThrow(/未找到订阅/);
  });

  it('自定义周期按天数推进', () => {
    resetStore([subscription({ billingCycle: 'custom', customCycleDays: 30 })]);
    state().generateSubscriptionTransaction('sub-1');
    expect(state().subscriptions[0].renewalDate?.slice(0, 10)).toBe('2026-12-20');
  });
});