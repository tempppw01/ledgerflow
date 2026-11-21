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

/**
 * 摊还表的列必须能对上。
 * 原来利息与本金各自用浮点算完再 toFixed(2),两条独立的四舍五入会让
 * 「本金 + 利息」与「本期金额」差出 0.01 —— 实测信用卡 5000 元 / 18% 的第 2 期
 * 显示 431.38 + 68.63 = 500.01,而金额列写的是 500。用户逐行相加核不上,
 * 就会不信这张表。改成全程按分做整数运算后,等式与余额闭合都按构造成立。
 */
describe('buildDebtPressureSchedule 列间一致性', () => {
  it('本金 + 利息 = 本期金额,且余额精确闭合', () => {
    const problems: string[] = [];
    const now = new Date(2026, 10, 21);
    const cents = (value: number) => Math.round(value * 100);

    for (const type of ['credit-card', 'consumer-loan', 'loan'] as const) {
      for (const balance of [0, 30, 1000, 5000, 12345.67, 100000]) {
        for (const annualRate of [undefined, 0, 3, 18, 36]) {
          for (const customMinPayment of [undefined, 50, 5000]) {
            for (const remainingMonths of [undefined, 2, 12]) {
              for (const repaymentDay of [1, 15, 28, 31]) {
                const rows = buildDebtPressureSchedule(
                  debt({ type, balance, annualRate, customMinPayment, remainingMonths, repaymentDay }),
                  { now }
                );
                const tag = `${type} 余额${balance} 利率${annualRate} 自定义${customMinPayment} 月数${remainingMonths} 日${repaymentDay}`;
                let previous = cents(balance);

                for (const row of rows) {
                  if (cents(row.principal) + cents(row.interest) > cents(row.amount)) {
                    problems.push(`${tag}: 本金+利息 ${row.principal}+${row.interest} > 金额 ${row.amount}`);
                  }
                  if (cents(row.principal) < 0 || cents(row.interest) < 0 || cents(row.remaining) < 0) {
                    problems.push(`${tag}: 出现负值`);
                  }
                  if (previous - cents(row.principal) !== cents(row.remaining)) {
                    problems.push(`${tag}: 余额不闭合 上期${previous / 100} 本金${row.principal}`);
                  }
                  previous = cents(row.remaining);
                }
              }
            }
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('还款额足够时每期恰好摊平,不差一分', () => {
    const rows = buildDebtPressureSchedule(
      debt({ type: 'credit-card', balance: 5000, annualRate: 18, remainingMonths: 12, repaymentDay: 15 }),
      { now: new Date(2026, 10, 21) }
    );
    const row = rows[1];
    expect(Math.round((row.principal + row.interest) * 100) / 100).toBe(row.amount);
    expect(row.amount).toBe(500);
  });
});
