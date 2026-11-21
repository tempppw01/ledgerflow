import { describe, expect, it } from 'vitest';
import { addMonthsClamped, advanceSubscriptionDate } from './subscriptionSchedule';

describe('addMonthsClamped', () => {
  it('普通情况就是加月份', () => {
    expect(addMonthsClamped(new Date('2026-11-13T00:00:00.000Z'), 1).toISOString()).toBe(
      new Date('2026-12-13T00:00:00.000Z').toISOString()
    );
  });

  it('月底不溢出:1月31日 + 1个月应落在 2 月最后一天,而不是 3 月', () => {
    const out = addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1);
    expect(out.getMonth()).toBe(1); // 2 月(0 基)
    expect(out.getDate()).toBe(28); // 2026 不是闰年
  });

  it('闰年 2 月按 29 天处理', () => {
    const out = addMonthsClamped(new Date('2028-01-31T00:00:00.000Z'), 1);
    expect(out.getMonth()).toBe(1);
    expect(out.getDate()).toBe(29);
  });

  it('跨年正确', () => {
    const out = addMonthsClamped(new Date('2026-11-15T00:00:00.000Z'), 3);
    expect(out.getFullYear()).toBe(2027);
    expect(out.getMonth()).toBe(1); // 2 月
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
});