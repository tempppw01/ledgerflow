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
  });
});
