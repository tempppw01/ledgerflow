import { describe, expect, it } from 'vitest';
import { buildAssetLiabilitySimulation } from './assetLiabilitySimulation';

describe('buildAssetLiabilitySimulation', () => {
  it('projects scheduled income, repayment and subscription changes by date', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [
        { id: 'cash', name: '现金', type: 'cash', balance: 1000 },
        { id: 'card', name: '信用卡', type: 'credit', balance: 500 }
      ],
      investmentPositions: [],
      transactions: [
        {
          id: 'income',
          type: 'income',
          categoryId: 'salary',
          accountId: 'cash',
          amount: 2000,
          date: '2026-09-22',
          note: '',
          tags: []
        }
      ],
      subscriptions: [
        {
          id: 'music',
          name: '音乐会员',
          kind: 'digital',
          amount: 30,
          currency: 'CNY',
          billingCycle: 'monthly',
          renewalDate: '2026-09-23',
          status: 'active',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ],
      debts: [
        {
          id: 'loan',
          name: '消费贷',
          type: 'consumer-loan',
          balance: 900,
          manualRepayments: [{ id: 'p1', dueDate: '2026-09-24', amount: 100 }]
        }
      ],
      days: 7
    });

    expect(result.initialAssets).toBe(1000);
    expect(result.initialLiabilities).toBe(1400);
    expect(result.rows[2]).toMatchObject({ date: '2026-09-22', delta: 2000, assets: 3000 });
    expect(result.rows[3]).toMatchObject({
      date: '2026-09-23',
      delta: -30,
      assets: 2970
    });
    expect(result.rows[4]).toMatchObject({
      date: '2026-09-24',
      delta: 0,
      assets: 2870,
      liabilities: 1300
    });
    expect(result.hasEvents).toBe(true);
  });

  it('projects recurring monthly repayments and reduces liabilities over time', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 2000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [
        {
          id: 'loan',
          name: '固定月供贷款',
          type: 'loan',
          balance: 1200,
          customMinPayment: 300,
          repaymentDay: 25,
          annualRate: 0
        }
      ],
      days: 7
    });

    expect(result.rows[4]).toMatchObject({
      date: '2026-09-24',
      assets: 2000,
      liabilities: 1200
    });
    expect(result.rows[5]).toMatchObject({
      date: '2026-09-25',
      assets: 1700,
      liabilities: 900,
      liabilityDelta: -300
    });
  });
});
