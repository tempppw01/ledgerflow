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
  it('counts repayments inside the current billing cycle only', () => {
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
        // Falls in the previous cycle (before the 07-15 due date), so it must not
        // be counted towards the 08-15 cycle.
        paidAt: '2026-07-10',
        recordMode: 'manual',
        createdAt: '2026-07-10T00:00:00.000Z'
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
          amount: 300,
          paidAt: '2026-08-03',
          recordMode: 'manual',
          createdAt: '2026-08-03T00:00:00.000Z'
        }
      ],
      fromDate: from
    });

    expect(result.breakdown[0]).toMatchObject({
      paidAmount: 300,
      isPaid: true
    });
    // Once the cycle is settled the reminder moves on to the next due date.
    expect(result.breakdown[0].dueDate).toBe('2026-09-15');
    expect(result.nextDueDate).toBe('2026-09-15');
  });

  it('reports the unpaid gap when a cycle is only partially repaid', () => {
    const result = getRepaymentOverview({
      debts: [debt({ customMinPayment: 300 })],
      repaymentRecords: [
        {
          id: 'r1',
          debtId: 'd1',
          amount: 100,
          paidAt: '2026-08-03',
          recordMode: 'manual',
          createdAt: '2026-08-03T00:00:00.000Z'
        }
      ],
      fromDate: new Date(2026, 7, 5)
    });

    expect(result.breakdown[0]).toMatchObject({
      paidAmount: 100,
      isPaid: false,
      dueDate: '2026-08-15'
    });
    expect(result.thisMonthRemaining).toBe(200);
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

  it('uses dated manual installments instead of treating a future installment as due this month', () => {
    const result = getRepaymentOverview({
      debts: [
        debt({
          customMinPayment: 260,
          manualRepayments: [
            { dueDate: '2026-09-10', amount: 260, label: '第 1 期' }
          ]
        })
      ],
      repaymentRecords: [],
      fromDate: new Date(2026, 7, 28)
    });

    expect(result.thisMonthTotal).toBe(0);
    expect(result.monthlyProjection[0].total).toBe(0);
    expect(result.monthlyProjection[1]).toMatchObject({ monthLabel: '9月', total: 260 });
  });

  it('keeps the upcoming cycle visible once a due day has just passed', () => {
    const result = getRepaymentOverview({
      debts: [debt({ repaymentDay: 2, customMinPayment: 260 })],
      repaymentRecords: [],
      fromDate: new Date(2026, 7, 28)
    });

    expect(result.thisMonthTotal).toBe(260);
    expect(result.breakdown[0]).toMatchObject({
      dueDate: '2026-09-02',
      dueInDays: 5,
      isPaid: false
    });
    expect(result.monthlyProjection[0].total).toBe(260);
  });

  it('flags the previous cycle as overdue while it is still inside the grace window', () => {
    const result = getRepaymentOverview({
      debts: [debt({ repaymentDay: 2, customMinPayment: 260 })],
      repaymentRecords: [],
      fromDate: new Date(2026, 7, 5)
    });

    expect(result.breakdown[0]).toMatchObject({
      dueDate: '2026-08-02',
      dueInDays: -3,
      isPaid: false,
      tone: 'danger'
    });
    expect(result.nextDueDays).toBe(-3);
  });

  it('keeps a simple repayment reminder without an amount out of payment totals', () => {
    const result = getRepaymentOverview({
      debts: [
        debt({
          id: 'reminder-1',
          name: '9 月信用卡账单',
          balance: 0,
          entryMode: 'simple',
          simpleDueDate: '2026-08-10'
        })
      ],
      repaymentRecords: [],
      fromDate: new Date(2026, 7, 5, 8, 0)
    });

    expect(result.thisMonthTotal).toBe(0);
    expect(result.thisMonthRemaining).toBe(0);
    expect(result.monthlyProjection.every((month) => month.total === 0)).toBe(true);
    expect(result.breakdown).toEqual([
      expect.objectContaining({
        id: 'reminder-1',
        isSimpleReminder: true,
        payment: 0,
        dueDate: '2026-08-10',
        dueInDays: 5
      })
    ]);
  });

  it('includes a dated simple reminder amount in the matching month only', () => {
    const result = getRepaymentOverview({
      debts: [
        debt({
          id: 'reminder-amount-1',
          name: '微粒贷',
          balance: 0,
          entryMode: 'simple',
          simpleDueDate: '2026-09-10',
          simpleAmount: 350
        })
      ],
      repaymentRecords: [],
      fromDate: new Date(2026, 8, 5, 8, 0),
      monthsAhead: 3
    });

    expect(result.thisMonthTotal).toBe(350);
    expect(result.thisMonthRemaining).toBe(350);
    expect(result.breakdown).toEqual([
      expect.objectContaining({
        id: 'reminder-amount-1',
        isSimpleReminder: true,
        payment: 350
      })
    ]);
    expect(result.monthlyProjection.map((month) => month.total)).toEqual([350, 0, 0]);
  });
});
