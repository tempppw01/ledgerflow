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

  it('applies one-off forecast income and expense bills on their own dates only', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 1000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [],
      forecastBills: [
        {
          id: 'bill-rent',
          name: '房租',
          amount: 600,
          date: '2026-09-22',
          direction: 'expense',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        },
        {
          id: 'bill-bonus',
          name: '奖金',
          amount: 800,
          date: '2026-09-24',
          direction: 'income',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        }
      ],
      days: 7
    });

    expect(result.rows[1]).toMatchObject({ date: '2026-09-21', forecastDelta: 0, assets: 1000 });
    expect(result.rows[2]).toMatchObject({ date: '2026-09-22', forecastDelta: -600, assets: 400 });
    expect(result.rows[3]).toMatchObject({ date: '2026-09-23', forecastDelta: 0, assets: 400 });
    expect(result.rows[4]).toMatchObject({ date: '2026-09-24', forecastDelta: 800, assets: 1200 });
    // 预测账单只推演现金流,不会凭空改变负债。
    expect(result.rows[4].liabilities).toBe(result.initialLiabilities);
  });

  it('repeats monthly forecast bills on the same day and clamps short months', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-01-05T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 5000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [],
      forecastBills: [
        {
          id: 'bill-insurance',
          name: '保险分期',
          amount: 300,
          date: '2026-01-31',
          direction: 'expense',
          repeat: 'monthly',
          createdAt: '2026-01-05T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z'
        }
      ],
      days: 90
    });

    const hits = result.rows.filter((row) => row.forecastDelta !== 0).map((row) => row.date);
    expect(hits).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(hits.every((date) => result.rows.find((row) => row.date === date)?.forecastDelta === -300))
      .toBe(true);
  });

  it('ignores forecast bills that fall outside the simulated window', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 1000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [],
      forecastBills: [
        {
          id: 'bill-late',
          name: '远期支出',
          amount: 2000,
          date: '2027-03-01',
          direction: 'expense',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        },
        {
          id: 'bill-empty',
          name: '零金额',
          amount: 0,
          date: '2026-09-21',
          direction: 'expense',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        }
      ],
      days: 7
    });

    expect(result.hasEvents).toBe(false);
    expect(result.rows.every((row) => row.forecastDelta === 0)).toBe(true);
    expect(result.rows.at(-1)?.assets).toBe(1000);
  });
});
