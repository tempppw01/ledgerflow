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
  /**
   * 窗口语义修正记录:
   * 原实现是 [上一期到期日, 本期到期日当天]。它有两处自相矛盾 ——
   *  1. 本文件定义宽限期为 10 天(到期后仍显示这一期),但窗口在到期日当天就结束,
   *     于是宽限期内还的钱一分都不计入,被判成逾期。宽限期形同虚设。
   *  2. 本期窗口从「上一期到期日」当天开始,下一期窗口又从「本期到期日」当天开始,
   *     相邻两期在到期日当天重叠 —— 在到期日还款(最常见的做法)会同时把下一期
   *     标成已还,整月被跳过。
   * 现在取 (上一期到期日 + 宽限期, 本期到期日 + 宽限期],首尾相接、不重叠,
   * 且到期后 10 天内的迟还正常归入本期。
   */
  it('covers through the grace window and abuts the next cycle', () => {
    const cycle = resolveRepaymentCycleWindow(15, new Date(2026, 7, 5));

    expect(cycle.dueDate).toEqual(new Date(2026, 7, 15));
    // 起点 = 上一期到期日(7/15)+ 宽限期(10 天)+ 1 天
    expect(cycle.start).toEqual(new Date(2026, 6, 26));
    // 终点 = 本期到期日(8/15)+ 宽限期 10 天,即 8/25 当天结束
    expect(cycle.end).toEqual(new Date(2026, 7, 25, 23, 59, 59, 999));
  });

  it('leaves no gap and no overlap between consecutive cycles', () => {
    const august = resolveRepaymentCycleWindow(15, new Date(2026, 7, 5));
    const september = resolveRepaymentCycleWindow(15, new Date(2026, 8, 5));

    expect(september.start.getTime()).toBe(august.end.getTime() + 1);
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

  /**
   * 在到期日还款不能让下一期也被标成已还。
   * 以前本期窗口从「上一期到期日」当天开始,于是 11/15 这笔还款同时落在
   * 11/15 与 12/15 两个窗口里:11/26 宽限期一过,界面直接跳到次年 1/15 ——
   * 整个 12 月被跳过。而「在到期日还款」恰恰是最常见的做法。
   */
  it('does not let a due-date payment settle the following cycle', () => {
    const records = [record({ paidAt: '2026-11-15', amount: 100 })];
    const input = { debtId: 'd1', repaymentDay: 15, minimumPayment: 100 };

    // 宽限期外:应停在 12/15 且尚未还
    for (const now of [new Date(2026, 10, 26), new Date(2026, 11, 1), new Date(2026, 11, 20)]) {
      const display = resolveRepaymentDueDisplay(input, records, now);
      expect(display?.dueDate, `${now.toISOString()} 不应跳期`).toEqual(new Date(2026, 11, 15));
      expect(display?.isPaid).toBe(false);
      expect(display?.paidAmount).toBe(0);
    }

    // 当期仍然算已还
    const current = resolveRepaymentDueDisplay(input, records, new Date(2026, 10, 15));
    expect(current?.isPaid).toBe(true);
    expect(current?.dueDate).toEqual(new Date(2026, 11, 15));
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
    // 本期到期日 8/15 → 窗口 [7/26, 8/25]
    const cycle = resolveRepaymentCycleWindow(15, new Date(2026, 7, 5));
    const total = sumRepaymentAmountInCycle(
      'd1',
      [
        // 7/16 是 7/15 那一期的迟还,归上一期,不算本期
        record({ id: 'a', paidAt: '2026-07-16', amount: 50 }),
        record({ id: 'b', paidAt: '2026-08-15', amount: 25 }),
        // 8/20 是到期后 5 天,在宽限期内,应计入本期
        record({ id: 'c', paidAt: '2026-08-20', amount: 30 }),
        // 8/26 已过宽限期,归下一期
        record({ id: 'd', paidAt: '2026-08-26', amount: 999 }),
        record({ id: 'e', debtId: 'd2', paidAt: '2026-08-01', amount: 999 })
      ],
      cycle
    );

    expect(total).toBe(55);
  });

  /**
   * 宽限期内的迟还必须算进本期。
   * 以前窗口在到期日当天结束,到期后第 1~10 天还的钱一律不计入 —— 界面还在
   * 显示这一期,却直接判成逾期,宽限期等于没设。
   */
  it('counts a payment made inside the grace window', () => {
    const cycle = resolveRepaymentCycleWindow(15, new Date(2026, 10, 16));
    const total = sumRepaymentAmountInCycle(
      'd1',
      [record({ paidAt: '2026-11-16', amount: 100 })],
      cycle
    );

    expect(cycle.dueDate).toEqual(new Date(2026, 10, 15));
    expect(total).toBe(100);
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
