import { describe, expect, it } from 'vitest';
import { buildDebtPressureSchedule, getManualScheduleStartPeriod } from './debtPressureSchedule';
import type { DebtItem } from './debtMetrics';

const debt = (overrides: Partial<DebtItem> = {}): DebtItem => ({
  id: 'd1',
  name: '招商信用卡',
  type: 'credit-card',
  status: 'active',
  balance: 10800,
  annualRate: 18.25,
  repaymentDay: 25,
  remainingMonths: 12,
  ...overrides
});

describe('buildDebtPressureSchedule manual plans', () => {
  it('keeps the full recorded calendar when no offset is requested', () => {
    const rows = buildDebtPressureSchedule(
      debt({
        manualRepayments: [
          { id: 'm1', dueDate: '2026-10-25', amount: 1080, label: '' },
          { id: 'm2', dueDate: '2026-11-25', amount: 1080, label: '' },
          { id: 'm3', dueDate: '2026-12-25', amount: 1080, label: '' }
        ]
      }),
      { now: new Date(2026, 10, 9) }
    );

    expect(rows.map((row) => row.dueDate)).toEqual(['2026-10-25', '2026-11-25', '2026-12-25']);
    expect(rows[0].period).toBe('第 1 期');
  });

  it('opens on the next unsettled cycle when offset is requested', () => {
    const rows = buildDebtPressureSchedule(
      debt({
        manualRepayments: [
          { id: 'm1', dueDate: '2026-10-25', amount: 1080, label: '' },
          { id: 'm2', dueDate: '2026-11-25', amount: 1080, label: '' },
          { id: 'm3', dueDate: '2026-12-25', amount: 1080, label: '' }
        ]
      }),
      { now: new Date(2026, 10, 9), startOffsetMonths: 1 }
    );

    expect(rows.map((row) => row.dueDate)).toEqual(['2026-11-25', '2026-12-25']);
    expect(rows[0].amount).toBe(1080);
  });

  it('falls back to a one-row offset when no manual row has aged out', () => {
    const rows = buildDebtPressureSchedule(
      debt({
        manualRepayments: [
          { id: 'm1', dueDate: '2026-11-25', amount: 1080 },
          { id: 'm2', dueDate: '2026-12-25', amount: 1080 }
        ]
      }),
      { now: new Date(2026, 10, 20), startOffsetMonths: 1 }
    );

    expect(rows.map((row) => row.dueDate)).toEqual(['2026-12-25']);
  });

  it('falls back to a one-row offset when no row matches the active cycle', () => {
    const rows = buildDebtPressureSchedule(
      debt({
        repaymentDay: 25,
        manualRepayments: [
          { id: 'm1', dueDate: '2026-10-25', amount: 1080 },
          { id: 'm2', dueDate: '2026-12-25', amount: 1080 }
        ]
      }),
      { now: new Date(2026, 10, 9), startOffsetMonths: 1 }
    );

    expect(rows.map((row) => row.dueDate)).toEqual(['2026-12-25']);
  });
});

describe('buildDebtPressureSchedule auto plans', () => {
  it('applies the settlement offset to generated cycles only', () => {
    const withoutOffset = buildDebtPressureSchedule(debt(), { now: new Date(2026, 10, 9) });
    const withOffset = buildDebtPressureSchedule(debt(), {
      now: new Date(2026, 10, 9),
      startOffsetMonths: 1
    });

    expect(withoutOffset[0].dueDate).toBe('2026-11-25');
    expect(withOffset[0].dueDate).toBe('2026-12-25');
  });
});

describe('getManualScheduleStartPeriod', () => {
  it('derives the next period from the paid period count', () => {
    expect(getManualScheduleStartPeriod({ paidPeriods: 3 })).toBe(4);
  });

  it('derives the next period from total minus remaining', () => {
    expect(getManualScheduleStartPeriod({ totalPeriods: 24, remainingMonths: 20 })).toBe(5);
  });
});
