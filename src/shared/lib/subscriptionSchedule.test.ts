import { describe, expect, it } from 'vitest';
import { addMonthsClamped, advanceSubscriptionDate } from './subscriptionSchedule';
import type { SubscriptionBillingCycle } from '../../entities/subscription/types';

/**
 * 这套测试必须与时区无关。
 *
 * 之前的坑:`new Date('2026-01-31')` 按 **UTC 零点** 解析,而日历运算用的是 **本地 getter**。
 * 在 UTC-5 上它变成「1月30日 19:00」,于是「日」被当成 30,夹到 2 月 28 之后又被时区换算
 * 推回 `2026-03-01` —— 月付订阅直接从 1 月跳到 3 月,整段二月被跳过。
 * 现在全部用 UTC 组件运算,断言也只用 UTC 取值与纯字符串,任何时区跑结果都一样。
 */
describe('addMonthsClamped', () => {
  it('普通情况就是加月份', () => {
    expect(addMonthsClamped(new Date('2026-11-13T00:00:00.000Z'), 1).toISOString()).toBe(
      new Date('2026-12-13T00:00:00.000Z').toISOString()
    );
  });

  it('月底不溢出:1月31日 + 1个月应落在 2 月最后一天,而不是 3 月', () => {
    const out = addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1);
    expect(out.getUTCMonth()).toBe(1); // 2 月(0 基)
    expect(out.getUTCDate()).toBe(28); // 2026 不是闰年
  });

  it('闰年 2 月按 29 天处理', () => {
    const out = addMonthsClamped(new Date('2028-01-31T00:00:00.000Z'), 1);
    expect(out.getUTCMonth()).toBe(1);
    expect(out.getUTCDate()).toBe(29);
  });

  it('跨年正确', () => {
    const out = addMonthsClamped(new Date('2026-11-15T00:00:00.000Z'), 3);
    expect(out.getUTCFullYear()).toBe(2027);
    expect(out.getUTCMonth()).toBe(1); // 2 月
  });

  it('保留时分秒毫秒', () => {
    const out = addMonthsClamped(new Date('2026-11-13T07:45:30.123Z'), 1);
    expect(out.toISOString()).toBe('2026-12-13T07:45:30.123Z');
  });
});

describe('advanceSubscriptionDate', () => {
  const base = '2026-11-13T00:00:00.000Z';

  it('按周期推进:每月 / 每季度 / 每半年 / 每年', () => {
    expect(advanceSubscriptionDate(base, 'monthly')).toBe(
      new Date('2026-12-13T00:00:00.000Z').toISOString()
    );
    expect(advanceSubscriptionDate(base, 'quarterly')).toBe(
      new Date('2027-02-13T00:00:00.000Z').toISOString()
    );
    expect(advanceSubscriptionDate(base, 'semiannual')).toBe(
      new Date('2027-05-13T00:00:00.000Z').toISOString()
    );
    expect(advanceSubscriptionDate(base, 'yearly')).toBe(
      new Date('2027-11-13T00:00:00.000Z').toISOString()
    );
  });

  it('自定义周期按天数推进', () => {
    expect(advanceSubscriptionDate(base, 'custom', 90)).toBe(
      new Date('2027-02-11T00:00:00.000Z').toISOString()
    );
  });

  it('自定义周期缺天数时原样返回,不把日期算成 NaN', () => {
    expect(advanceSubscriptionDate(base, 'custom')).toBe(base);
    expect(advanceSubscriptionDate(base, 'custom', 0)).toBe(base);
    expect(advanceSubscriptionDate(base, 'custom', Number.NaN)).toBe(base);
    expect(advanceSubscriptionDate(base, 'custom', -30)).toBe(base);
  });

  it('空值与非法日期原样返回', () => {
    expect(advanceSubscriptionDate(undefined, 'monthly')).toBeUndefined();
    expect(advanceSubscriptionDate('', 'monthly')).toBe('');
    expect(advanceSubscriptionDate('not-a-date', 'monthly')).toBe('not-a-date');
  });

  it('月付从 1月31日 推进到 2 月最后一天(不跳月)', () => {
    const out = advanceSubscriptionDate('2026-01-31T00:00:00.000Z', 'monthly');
    expect(out).toBe(new Date('2026-02-28T00:00:00.000Z').toISOString());
  });

  it('纯日期进、纯日期出(<input type="date"> 存的都是这种)', () => {
    expect(advanceSubscriptionDate('2026-11-13', 'monthly')).toBe('2026-12-13');
    expect(advanceSubscriptionDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceSubscriptionDate('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(advanceSubscriptionDate('2026-11-13', 'custom', 30)).toBe('2026-12-13');
  });

  it('回归:月付从 1月31日 / 3月31日 推进绝不能落到下下个月', () => {
    // 这正是 UTC-5 时区下的错误结果(2026-03-01 / 2026-05-01)。
    expect(advanceSubscriptionDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceSubscriptionDate('2026-03-31', 'monthly')).toBe('2026-04-30');
    expect(advanceSubscriptionDate('2026-05-31', 'monthly')).toBe('2026-06-30');
    expect(advanceSubscriptionDate('2026-12-31', 'monthly')).toBe('2027-01-31');
  });
});

/** 网格不变量:对任意日期 × 任意周期,推进结果都必须同时满足下面几条。 */
describe('推进结果的不变量(日期网格)', () => {
  const MONTH_STEP: Record<'monthly' | 'quarterly' | 'semiannual' | 'yearly', number> = {
    monthly: 1,
    quarterly: 3,
    semiannual: 6,
    yearly: 12
  };

  const pad = (value: number) => String(value).padStart(2, '0');
  const lastDayOf = (year: number, monthIndex: number) =>
    new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const grid: string[] = [];
  for (let year = 2024; year <= 2028; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const last = lastDayOf(year, month - 1);
      for (const day of [1, 15, 28, 29, 30, 31]) {
        if (day <= last) grid.push(`${year}-${pad(month)}-${pad(day)}`);
      }
    }
  }

  it('格式固定为 YYYY-MM-DD', () => {
    for (const iso of grid) {
      for (const cycle of Object.keys(MONTH_STEP) as Array<keyof typeof MONTH_STEP>) {
        expect(advanceSubscriptionDate(iso, cycle)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('严格向前推进,绝不原地或倒退', () => {
    for (const iso of grid) {
      for (const cycle of Object.keys(MONTH_STEP) as Array<keyof typeof MONTH_STEP>) {
        const out = advanceSubscriptionDate(iso, cycle) as string;
        expect(out > iso).toBe(true);
      }
    }
  });

  it('月份恰好前进一档,日期按目标月天数夹住', () => {
    for (const iso of grid) {
      const [year, month, day] = iso.split('-').map(Number);
      for (const [cycle, step] of Object.entries(MONTH_STEP)) {
        const out = advanceSubscriptionDate(iso, cycle as SubscriptionBillingCycle) as string;
        const target = new Date(Date.UTC(year, month - 1 + step, 1));
        const expectedDay = Math.min(day, lastDayOf(target.getUTCFullYear(), target.getUTCMonth()));
        const expected = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(
          expectedDay
        )}`;
        expect(out).toBe(expected);
      }
    }
  });

  it('自定义周期推进的天数恰好等于天数参数', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    for (const iso of grid) {
      for (const days of [7, 30, 90, 365]) {
        const out = advanceSubscriptionDate(iso, 'custom', days) as string;
        const diff = (Date.parse(`${out}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / dayMs;
        expect(diff).toBe(days);
      }
    }
  });

  it('推进结果再推进一次仍然是合法日期(链式调用不会累积漂移)', () => {
    for (const iso of grid) {
      let current: string | undefined = iso;
      for (let step = 0; step < 12; step += 1) {
        current = advanceSubscriptionDate(current, 'monthly');
        expect(current).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(new Date(current as string).getTime())).toBe(false);
      }
      // 连续推 12 次 = 推进一年,年份必须 +1
      expect((current as string).slice(0, 4)).toBe(String(Number(iso.slice(0, 4)) + 1));
    }
  });
});
