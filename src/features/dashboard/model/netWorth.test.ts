import { describe, expect, it } from 'vitest';
import { buildNetWorthTrend } from './netWorth';

describe('buildNetWorthTrend', () => {
  it('combines account balances, investments and active debts', () => {
    const result = buildNetWorthTrend({
      now: new Date('2026-09-10T00:00:00.000Z'),
      months: 3,
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 10000 }],
      transactions: [],
      investmentPositions: [
        {
          id: 'fund',
          name: '指数基金',
          category: 'index-fund',
          investedAmount: 4000,
          currentValue: 4500,
          riskLevel: 'medium',
          isActive: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z'
        }
      ],
      debts: [{ id: 'loan', name: '贷款', type: 'loan', balance: 2500 }]
    });

    expect(result.currentValue).toBe(12000);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.at(-1)?.isCurrent).toBe(true);
  });

  it('does not include simple repayment reminders as debt', () => {
    const result = buildNetWorthTrend({
      now: new Date('2026-09-10T00:00:00.000Z'),
      months: 3,
      accounts: [{ id: 'cash', name: '现金', balance: 1000 }],
      transactions: [],
      investmentPositions: [],
      debts: [
        {
          id: 'reminder',
          name: '待还提醒',
          type: 'credit-card',
          balance: 500,
          entryMode: 'simple',
          simpleDueDate: '2026-09-15'
        }
      ]
    });

    expect(result.currentValue).toBe(1000);
  });
});

