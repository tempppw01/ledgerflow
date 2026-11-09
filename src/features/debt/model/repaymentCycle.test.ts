import { describe, expect, it } from 'vitest';
import type { RepaymentRecord } from './debtMetrics';
import {
  buildRepaymentDate,
  parseRepaymentDay,
  resolveRepaymentCycleWindow,
  resolveRepaymentDueDisplay,
  sumRepaymentAmountInCycle
} from './repaymentCycle';

const record = (overrides: Partial<RepaymentRecord>): RepaymentRecord => ({
  id: 'r1',
  debtId: 'd1',
  amount: 100,
  paidAt: '2026-08-03',
  recordMode: 'manual',
  createdAt: '2026-08-03T00:00:00.000Z',
  ...overrides
});

describe('resolveRepaymentCycleWindow', () => {
  it('runs from the previous due date up to the upcoming one', () => {
    const cycle = resolveRepaymentCycleWindow(15, new Date(2026, 7, 5));

    expect(cycle.dueDate).toEqual(new Date(2026, 7, 15));
    expect(cycle.start).toEqual(new Date(2026, 6, 15));
    expect(cycle.end.getDate()).toBe(15);
    expect(cycle.end.getMonth()).toBe(7);
  });

  it('keeps the just-passed due date while it is inside the grace window', () => {
    const cycle = resolveRepaymentCycleWindow(2, new Date(2026, 7, 5));

    expect(cycle.dueDate).toEqual(new Date(2026, 7, 2));
  });

  it('moves to the next cycle once the grace window has passed', () => {
    const cycle = resolveRepaymentCycleWindow(2, new Date(2026, 7, 28));

    expect(cycle.dueDate).toEqual(new Date(2026, 8, 2));
  });

  it('clamps an out-of-range due day to the last day of a short month', () => {
    const cycle = resolveRepaymentCycleWindow(31, new Date(2026, 1, 20));

    expect(cycle.dueDate).toEqual(new Date(2026, 1, 28));
    expect(buildRepaymentDate(2026, 1, 31)).toEqual(new Date(2026, 1, 28));
  });
});

describe('resolveRepaymentDueDisplay', () => {
  it('ignores repayments outside the active cycle', () => {
    const display = resolveRepaymentDueDisplay(
      { debtId: 'd1', repaymentDay: 15, minimumPayment: 300 },
      [record({ paidAt: '2026-06-20', amount: 300 })],
      new Date(2026, 7, 5)
    );

    expect(display).toMatchObject({ paidAmount: 0, isPaid: false, gapAmount: 300 });
  });

  it('advances to the next due date once the cycle is settled', () => {
    const display = resolveRepaymentDueDisplay(
      { debtId: 'd1', repaymentDay: 15, minimumPayment: 300 },
      [record({ paidAt: '2026-08-03', amount: 300 })],
      new Date(2026, 7, 5)
    );

    expect(display).toMatchObject({
      isPaid: true,
      paidAmount: 300,
      gapAmount: 0,
      daysUntil: 41
    });
    expect(display?.dueDate).toEqual(new Date(2026, 8, 15));
  });

  it('tolerates small rounding differences before calling a cycle settled', () => {
    const display = resolveRepaymentDueDisplay(
      { debtId: 'd1', repaymentDay: 15, minimumPayment: 300 },
      [record({ paidAt: '2026-08-03', amount: 299.4 })],
      new Date(2026, 7, 5)
    );

    expect(display).toMatchObject({ isPaid: true });
  });

  it('returns nothing when the due day is unknown', () => {
    expect(
      resolveRepaymentDueDisplay(
        { debtId: 'd1', minimumPayment: 300 },
        [record({})],
        new Date(2026, 7, 5)
      )
    ).toBeNull();
  });
});

describe('sumRepaymentAmountInCycle', () => {
  it('sums only the matching debt inside the window', () => {
    const cycle = resolveRepaymentCycleWindow(15, new Date(2026, 7, 5));
    const total = sumRepaymentAmountInCycle(
      'd1',
      [
        record({ id: 'a', paidAt: '2026-07-16', amount: 50 }),
        record({ id: 'b', paidAt: '2026-08-15', amount: 25 }),
        record({ id: 'c', paidAt: '2026-07-14', amount: 999 }),
        record({ id: 'd', debtId: 'd2', paidAt: '2026-08-01', amount: 999 })
      ],
      cycle
    );

    expect(total).toBe(75);
  });
});

describe('parseRepaymentDay', () => {
  it('reads a day from common due-date formats', () => {
    expect(parseRepaymentDay('2026-08-25')).toBe(25);
    expect(parseRepaymentDay('每月25日')).toBe(25);
    expect(parseRepaymentDay('每月 3 号')).toBe(3);
    expect(parseRepaymentDay('没有日期')).toBeNull();
  });
});
