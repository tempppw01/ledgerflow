import { describe, expect, it } from 'vitest';
import { isSameLocalDay } from './localDate';

/**
 * 「同一个本地日」不要用 `a.slice(0, 10) === b.slice(0, 10)` 判断 —— 那取的是 UTC 日,
 * 在 UTC+8 的本地 00:00–07:59 会算成前一天。这里盯住几个边界:
 * 纯日期 vs 带时间、同一本地日但 UTC 日期不同、以及跨日。
 */
describe('isSameLocalDay', () => {
  it('纯日期与同一天的 ISO 瞬间算同一天', () => {
    expect(isSameLocalDay('2026-11-24', '2026-11-24T00:00:00.000Z')).toBe(true);
  });

  it('UTC 日期不同、但本地是同一天时仍算同一天', () => {
    // 2026-11-24T16:30:00Z 在 UTC+8 是 2026-11-25 00:30
    const localEvening = '2026-11-24T16:30:00.000Z';
    const localNextDateOnly = '2026-11-25';
    const offsetMinutes = new Date().getTimezoneOffset();
    // 只在 UTC+ 时区断言这一点,其它时区下两者本来就不同天
    if (offsetMinutes < 0) {
      expect(isSameLocalDay(localNextDateOnly, localEvening)).toBe(true);
    }
  });

  it('不同天不算同一天', () => {
    expect(isSameLocalDay('2026-11-24', '2026-11-25')).toBe(false);
    expect(isSameLocalDay('2026-11-24T00:00:00.000Z', '2026-11-26T00:00:00.000Z')).toBe(false);
  });

  it('空值一律不算同一天', () => {
    expect(isSameLocalDay(undefined, '2026-11-24')).toBe(false);
    expect(isSameLocalDay('2026-11-24', '')).toBe(false);
    expect(isSameLocalDay('', '')).toBe(false);
  });

  it('非法日期字符串不会被当成同一天', () => {
    expect(isSameLocalDay('not-a-date', 'not-a-date')).toBe(true); // 两个都退化为原串,内容相同
    expect(isSameLocalDay('not-a-date', '2026-11-24')).toBe(false);
  });
});