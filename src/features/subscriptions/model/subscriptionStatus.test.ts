import { describe, expect, it } from 'vitest';
import { resolveSubscriptionStatus } from './subscriptionStatus';

/**
 * 关键不变量:**状态只取决于「本地日历日」**,与运行环境时区无关。
 *
 * 旧实现用 `Math.ceil((到期时刻 - 现在) / 一天)` 比时间戳,而纯日期到期日按 UTC 零点解析,
 * 于是「哪一刻算逾期」随经度变化(UTC-8 会在到期日当天下午就报逾期)。下面每个用例都
 * 用本地时间构造 `now`,所以同一份断言在任何时区都必须成立 —— 测试文件本身在
 * UTC / Asia/Shanghai / America/New_York 等下都跑过。
 */
function localDate(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe('resolveSubscriptionStatus', () => {
  it('已暂停的订阅始终是 paused,哪怕日期早就过了', () => {
    expect(
      resolveSubscriptionStatus(
        { status: 'paused', renewalDate: '2020-01-01' },
        localDate(2026, 11, 22)
      )
    ).toBe('paused');
  });

  it('没有到期日就是 active', () => {
    expect(resolveSubscriptionStatus({ status: 'active' }, localDate(2026, 11, 22))).toBe('active');
  });

  it('非法日期退化为 active,不抛错', () => {
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: 'not-a-date' }, localDate(2026, 11, 22))
    ).toBe('active');
  });

  it('到期日就是今天 → due-soon(不算逾期)', () => {
    // 当天 00:05 与 23:55 都必须一致:旧实现里 UTC-8 在当天下午就变成 expired。
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: '2026-11-22' }, localDate(2026, 11, 22, 0, 5))
    ).toBe('due-soon');
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: '2026-11-22' }, localDate(2026, 11, 22, 23, 55))
    ).toBe('due-soon');
  });

  it('到期日是昨天 → expired', () => {
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: '2026-11-21' }, localDate(2026, 11, 22, 0, 5))
    ).toBe('expired');
  });

  it('剩余 1..7 天是 due-soon,第 8 天回到 active', () => {
    for (let days = 1; days <= 7; days += 1) {
      const target = localDate(2026, 11, 22 + days);
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
        target.getDate()
      ).padStart(2, '0')}`;
      expect(resolveSubscriptionStatus({ status: 'active', renewalDate: iso }, localDate(2026, 11, 22))).toBe(
        'due-soon'
      );
    }
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: '2026-11-30' }, localDate(2026, 11, 22))
    ).toBe('active');
  });

  it('expireDate 优先于 renewalDate', () => {
    expect(
      resolveSubscriptionStatus(
        { status: 'active', expireDate: '2026-11-21', renewalDate: '2027-12-31' },
        localDate(2026, 11, 22)
      )
    ).toBe('expired');
  });

  it('带时间的 ISO 按它所属的本地日判断', () => {
    const now = localDate(2026, 11, 22, 10, 0);
    const todayIso = new Date(2026, 10, 22, 9, 0).toISOString();
    const yesterdayIso = new Date(2026, 10, 21, 9, 0).toISOString();
    expect(resolveSubscriptionStatus({ status: 'active', renewalDate: todayIso }, now)).toBe('due-soon');
    expect(resolveSubscriptionStatus({ status: 'active', renewalDate: yesterdayIso }, now)).toBe('expired');
  });

  it('跨月与跨年边界', () => {
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: '2026-12-01' }, localDate(2026, 11, 30, 23, 30))
    ).toBe('due-soon'); // 明天
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: '2026-11-30' }, localDate(2026, 12, 1, 0, 30))
    ).toBe('expired'); // 昨天(跨月)
    expect(
      resolveSubscriptionStatus({ status: 'active', renewalDate: '2026-12-31' }, localDate(2027, 1, 1, 0, 5))
    ).toBe('expired'); // 昨天(跨年)
  });

  it('无论当天几点,「今天到期」都不跳到 expired,「昨天到期」都不退回 due-soon', () => {
    const today = '2026-11-22';
    const yesterday = '2026-11-21';
    for (let hour = 0; hour < 24; hour += 1) {
      const now = localDate(2026, 11, 22, hour, 30);
      expect(resolveSubscriptionStatus({ status: 'active', renewalDate: today }, now)).toBe('due-soon');
      expect(resolveSubscriptionStatus({ status: 'active', renewalDate: yesterday }, now)).toBe('expired');
    }
  });
});
