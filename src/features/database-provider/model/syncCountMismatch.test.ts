import { describe, expect, it } from 'vitest';
import { describeDroppedGroups, findDroppedSyncGroups } from './syncCountMismatch';

const payload = {
  finance: {
    accounts: [{ id: 'a1' }, { id: 'a2' }],
    categories: [{ id: 'c1' }],
    transactions: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
    subscriptions: [],
    trashedAccounts: [{ id: 'a3' }],
    trashedCategories: [],
    trashedTransactions: [{ id: 't4' }],
    trashedSubscriptions: [{ id: 's1' }]
  },
  preferences: {
    debts: [{ id: 'd1' }],
    investmentPositions: [{ id: 'p1' }, { id: 'p2' }],
    investmentWatchlist: [{ id: 'w1' }]
  }
};

/** 服务端 counts 与上面 payload 完全对得上时应当长这样。 */
const matchingCounts = {
  accounts: 3,
  categories: 1,
  transactions: 4,
  subscriptions: 1,
  debts: 1,
  investment_positions: 2,
  investment_watchlists: 1
};

describe('同步后核对服务端 counts', () => {
  it('数量对得上时不报警', () => {
    expect(findDroppedSyncGroups(payload, matchingCounts)).toEqual([]);
  });

  it('少了一笔交易就报警,并说清发了多少、存了多少', () => {
    const dropped = findDroppedSyncGroups(payload, { ...matchingCounts, transactions: 3 });
    expect(dropped).toEqual([{ group: 'transactions', sent: 4, saved: 3 }]);
  });

  it('同时少交易和账户时两组都报', () => {
    const dropped = findDroppedSyncGroups(payload, {
      ...matchingCounts,
      transactions: 2,
      accounts: 1
    });
    expect(dropped.map((item) => item.group).sort()).toEqual(['accounts', 'transactions']);
  });

  it('服务端存得比发的多时不报警(不是丢失)', () => {
    expect(findDroppedSyncGroups(payload, { ...matchingCounts, transactions: 99 })).toEqual([]);
  });

  it('counts 缺失或不可信时倾向不报警(宁可漏报,不要误报)', () => {
    expect(findDroppedSyncGroups(payload, undefined)).toEqual([]);
    expect(findDroppedSyncGroups(payload, null)).toEqual([]);
    expect(findDroppedSyncGroups(payload, {})).toEqual([]);
    expect(findDroppedSyncGroups(payload, { transactions: Number.NaN } as never)).toEqual([]);
    expect(findDroppedSyncGroups(payload, { transactions: '3' } as never)).toEqual([]);
  });

  it('payload 形状不对时也不炸', () => {
    expect(findDroppedSyncGroups(null, matchingCounts)).toEqual([]);
    expect(findDroppedSyncGroups({}, matchingCounts)).toEqual([]);
    expect(findDroppedSyncGroups({ finance: { transactions: 'nope' } }, matchingCounts)).toEqual([]);
  });

  it('提示文案里带量词与差额', () => {
    expect(describeDroppedGroups([{ group: 'transactions', sent: 4, saved: 3 }])).toBe('交易 1 条');
    expect(
      describeDroppedGroups([
        { group: 'transactions', sent: 4, saved: 3 },
        { group: 'accounts', sent: 2, saved: 1 }
      ])
    ).toBe('交易 1 条、账户 1 条');
  });
});