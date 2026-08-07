import { describe, expect, it } from 'vitest';
import type { DebtItem, RepaymentRecord } from './debtMetrics';
import { getRepaymentOverview } from './repaymentOverview';

const debt = (overrides: Partial<DebtItem>): DebtItem => ({
  id: 'd1',
  name: '信用卡A',
  type: 'credit-card',
  balance: 5000,
  repaymentDay: 15,
  ...overrides
});

describe('getRepaymentOverview', () => {
  it('sums monthly payments and counts this-month repayments', () => {
    const from = new Date(2026, 7, 5);
    const records: RepaymentRecord[] = [
      {
        id: 'r1',
        debtId: 'd1',
        amount: 300,
        paidAt: '2026-08-03',
        recordMode: 'manual',
        createdAt: '2026-08-03T00:00:00.000Z'
      },
      {
        id: 'r2',
        debtId: 'd1',
        amount: 100,
        paidAt: '2026-07-20',
        recordMode: 'manual',
        createdAt: '2026-07-20T00:00:00.000Z'
      }
    ];

    const result = getRepaymentOverview({
      debts: [debt({})],
      repaymentRecords: records,
      fromDate: from
    });

    expect(result.thisMonthPaid).toBe(300);
    expect(result.thisMonthTotal).toBeGreaterThan(0);
    expect(result.thisMonthRemaining).toBe(Math.max(0, result.thisMonthTotal - 300));
    expect(result.progress).toBeCloseTo(300 / result.thisMonthTotal, 5);
    expect(result.monthlyProjection).toHaveLength(6);
    expect(result.nextDueDate).toBe('2026-08-15');
    expect(result.breakdown[0]).toMatchObject({
      paidAmount: 300,
      isPaid: false
    });
  });

  it('marks the current debt period paid after monthly records reach the payment amount', () => {
    const from = new Date(2026, 7, 5);
    const result = getRepaymentOverview({
      debts: [debt({ customMinPayment: 300 })],
      repaymentRecords: [
        {
          id: 'r1',
          debtId: 'd1',
          amount: 294,
          paidAt: '2026-08-03',
          recordMode: 'manual',
          createdAt: '2026-08-03T00:00:00.000Z'
        }
      ],
      fromDate: from
    });

    expect(result.breakdown[0]).toMatchObject({
      paidAmount: 294,
      isPaid: true
    });
  });

  it('filters out settled debts', () => {
    const from = new Date(2026, 7, 5);
    const result = getRepaymentOverview({
      debts: [debt({ status: 'settled' })],
      repaymentRecords: [],
      fromDate: from
    });

    expect(result.thisMonthTotal).toBe(0);
    expect(result.breakdown).toEqual([]);
    expect(result.progress).toBe(0);
  });

  it('skips a debt in projection once remaining months is exceeded', () => {
    const from = new Date(2026, 7, 5);
    const result = getRepaymentOverview({
      debts: [debt({ remainingMonths: 2 })],
      repaymentRecords: [],
      fromDate: from,
      monthsAhead: 4
    });

    expect(result.monthlyProjection).toHaveLength(4);
    expect(result.monthlyProjection[0].items).toHaveLength(1);
    expect(result.monthlyProjection[2].items).toHaveLength(0);
  });
});
