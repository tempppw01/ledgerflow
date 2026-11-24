import { beforeEach, describe, expect, it } from 'vitest';
import type { SubscriptionItem } from '../../entities/subscription/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useFinanceStore } from './useFinanceStore';

/**
 * 「订阅生成支出」的不变量。
 *
 * 这个函数有四个不变量,之前**一条测试都没有**:
 *   1. 订阅绑定的账户被删了 → 拒绝生成(否则会留下指向不存在账户的流水:余额里看不到、支出统计里却有);
 *   2. 同一天重复点 → \`duplicated: true\` 且**不新增**流水;
 *   3. 生成成功 → 续费日/到期日**推进一期**,并记下**推进前**的值(删除流水时要精确退回,倒推回不去);
 *   4. 非人民币订阅 → 交易上带「币种:XXX」标签。
 */

function subscription(over: Partial<SubscriptionItem> = {}): SubscriptionItem {
  return {
    id: 'sub-1',
    name: '某视频会员',
    kind: 'video',
    amount: 25,
    currency: 'CNY',
    billingCycle: 'monthly',
    accountId: 'acc-1',
    renewalDate: '2026-11-25',
    expireDate: '2026-12-25',
    status: 'active',
    ...over
  } as SubscriptionItem;
}

function reset(over: { subscriptions?: SubscriptionItem[]; transactions?: TransactionItem[]; accounts?: unknown[] } = {}) {
  useFinanceStore.setState({
    hasHydrated: true,
    accounts: (over.accounts ?? [
      { id: 'acc-1', name: '工资卡', type: 'bank', initialBalance: 0, balance: 0, sortOrder: 1 }
    ]) as never,
    categories: [{ id: 'cat-fun', name: '娱乐', kind: 'expense', sortOrder: 1 }] as never,
    subscriptions: over.subscriptions ?? [subscription()],
    transactions: over.transactions ?? [],
    balanceChangeEntries: [],
    trashedAccounts: [],
    trashedCategories: [],
    trashedTransactions: [],
    trashedSubscriptions: []
  });
}

describe('generateSubscriptionTransaction', () => {
  beforeEach(() => {
    // 不用假计时器:续费日来自 fixture,重复生成天然落在同一天 ——
    // 而 vi.useFakeTimers() 会改变整个 worker 的行为(实测让总用例数从 1257 掉到 1253)。
    localStorage.clear();
  });

  it('生成成功:新增一条支出,并把续费日推进一期', () => {
    reset();

    const result = useFinanceStore.getState().generateSubscriptionTransaction('sub-1');
    expect(result.duplicated).toBe(false);

    const state = useFinanceStore.getState();
    expect(state.transactions).toHaveLength(1);
    const tx = state.transactions[0];
    expect(tx.type).toBe('expense');
    expect(tx.amount).toBe(25);
    expect(tx.accountId).toBe('acc-1');
    expect(tx.tags).toContain('订阅');

    const sub = state.subscriptions[0];
    expect(sub.renewalDate).toBe('2026-12-25');
    expect(sub.expireDate).toBe('2027-01-25');
    // 关键:记下推进前的日期(删除流水时用它精确退回,倒推会因月末夹取而失真)
    expect(sub.prevRenewalDate).toBe('2026-11-25');
    expect(sub.prevExpireDate).toBe('2026-12-25');
  });

  it('同一天重复生成 → duplicated: true,且不新增流水', () => {
    reset();
    useFinanceStore.getState().generateSubscriptionTransaction('sub-1');
    const afterFirst = useFinanceStore.getState().transactions.length;

    const second = useFinanceStore.getState().generateSubscriptionTransaction('sub-1');
    expect(second.duplicated).toBe(true);
    expect(useFinanceStore.getState().transactions.length).toBe(afterFirst);
    // 续费日也不该被再推进一期
    expect(useFinanceStore.getState().subscriptions[0].renewalDate).toBe('2026-12-25');
  });

  it('订阅绑定的账户已不存在 → 抛错且不新增流水', () => {
    reset({
      subscriptions: [subscription({ accountId: 'acc-deleted' })],
      accounts: [{ id: 'acc-1', name: '工资卡', type: 'bank', initialBalance: 0, balance: 0, sortOrder: 1 }]
    });

    expect(() => useFinanceStore.getState().generateSubscriptionTransaction('sub-1')).toThrow(
      /账户已不存在/
    );
    expect(useFinanceStore.getState().transactions).toHaveLength(0);
  });

  it('完全没有账户 → 抛错', () => {
    reset({ accounts: [] });
    expect(() => useFinanceStore.getState().generateSubscriptionTransaction('sub-1')).toThrow(
      /没有可用账户/
    );
  });

  it('非人民币订阅 → 交易带上币种标签与原币种备注', () => {
    reset({ subscriptions: [subscription({ currency: 'USD' })] });
    useFinanceStore.getState().generateSubscriptionTransaction('sub-1');

    const tx = useFinanceStore.getState().transactions[0];
    expect(tx.tags).toContain('币种:USD');
    expect(tx.note).toContain('原币种:USD');
  });

  it('订阅不存在 → 抛错', () => {
    reset();
    expect(() => useFinanceStore.getState().generateSubscriptionTransaction('nope')).toThrow(/未找到订阅项目/);
  });
});