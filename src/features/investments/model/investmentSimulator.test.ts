import { describe, expect, it } from 'vitest';
import { simulateInvestmentPlan } from './investmentSimulator';

describe('simulateInvestmentPlan', () => {
  it('按月在可用交易日买入并计算期末收益', () => {
    const result = simulateInvestmentPlan({
      points: [
        { date: '2026-01-02', value: 10 },
        { date: '2026-02-02', value: 12 },
        { date: '2026-03-02', value: 11 }
      ],
      startDate: '2026-01-01',
      endDate: '2026-03-02',
      amount: 1000,
      frequency: 'monthly'
    });

    expect(result).toMatchObject({
      contributionCount: 3,
      investedAmount: 3000,
      endingValue: expect.closeTo((1000 / 10 + 1000 / 12 + 1000 / 11) * 11, 0.001),
      profit: expect.closeTo(16.6667, 0.001)
    });
    expect(result?.returnRate).toBeCloseTo(0.0055556, 4);
    expect(result?.valuationDate).toBe('2026-03-02');
  });

  it('按每个交易日逐日买入', () => {
    const result = simulateInvestmentPlan({
      points: [
        { date: '2026-01-02', value: 10 },
        { date: '2026-01-05', value: 20 },
        { date: '2026-01-06', value: 25 }
      ],
      startDate: '2026-01-01',
      endDate: '2026-01-06',
      amount: 100,
      frequency: 'trading-daily'
    });

    expect(result).toMatchObject({
      contributionCount: 3,
      investedAmount: 300,
      endingValue: expect.closeTo((100 / 10 + 100 / 20 + 100 / 25) * 25, 0.001),
      firstBuyDate: '2026-01-02',
      lastBuyDate: '2026-01-06'
    });
  });

  it('按指定周几和每月几号买入，非交易日顺延到下一个交易日', () => {
    const weekly = simulateInvestmentPlan({
      points: [
        { date: '2026-01-05', value: 10 },
        { date: '2026-01-12', value: 12 },
        { date: '2026-01-19', value: 15 }
      ],
      startDate: '2026-01-01',
      endDate: '2026-01-20',
      amount: 100,
      frequency: 'weekly',
      weekday: 1
    });
    const monthly = simulateInvestmentPlan({
      points: [
        { date: '2026-02-02', value: 10 },
        { date: '2026-03-02', value: 20 },
        { date: '2026-03-31', value: 25 }
      ],
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      amount: 100,
      frequency: 'monthly',
      dayOfMonth: 31
    });

    expect(weekly).toMatchObject({
      contributionCount: 3,
      firstBuyDate: '2026-01-05',
      lastBuyDate: '2026-01-19'
    });
    expect(monthly).toMatchObject({
      contributionCount: 3,
      firstBuyDate: '2026-02-02',
      lastBuyDate: '2026-03-31'
    });
  });
});
