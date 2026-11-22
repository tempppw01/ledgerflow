import { describe, expect, it } from 'vitest';
import {
  daysSinceLocalDate,
  startOfLocalDayTime,
  toLocalDateKey,
  todayLocalDateKey
} from './localDate';

/**
 * 这套测试必须与时区无关:所有「现在」都用本地时间构造,断言只看本地日历日,
 * 因此同一份断言在 UTC+8 / UTC-8 / UTC 下都必须成立(CI 里跑的是 UTC,
 * 本地跑的是 Asia/Shanghai,两边都会覆盖到)。
 */
function localTime(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe('toLocalDateKey / todayLocalDateKey', () => {
  it('用本地日历日,不用 UTC', () => {
    // 本地 00:00 与 23:59 都必须落在同一天
    expect(toLocalDateKey(localTime(2026, 11, 22, 0, 0))).toBe('2026-11-22');
    expect(toLocalDateKey(localTime(2026, 11, 22, 23, 59))).toBe('2026-11-22');
  });

  it('todayLocalDateKey 永远等于「本地今天」,一天 24 小时都成立', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = localTime(2026, 11, 22, hour, 30);
      expect(todayLocalDateKey(now)).toBe('2026-11-22');
      expect(todayLocalDateKey(now)).toBe(toLocalDateKey(now));
    }
  });

  it('回归:UTC 格式化在东部时区清晨会退到前一天', () => {
    // 这正是被修掉的写法;断言两条路径确实不同,防止有人再换回 toISOString
    const morningInEast = localTime(2026, 11, 22, 7, 30);
    const utcKey = morningInEast.toISOString().slice(0, 10);
    const localKey = todayLocalDateKey(morningInEast);
    expect(localKey).toBe('2026-11-22');
    if (new Date().getTimezoneOffset() < 0) {
      // 东时区(如 UTC+8):UTC 日期比本地日期早一天
      expect(utcKey).toBe('2026-11-21');
      expect(utcKey).not.toBe(localKey);
    }
  });
});

describe('daysSinceLocalDate', () => {
  const now = localTime(2026, 11, 22, 11, 0);

  it('今天 0、昨天 1、明天 -1', () => {
    expect(daysSinceLocalDate('2026-11-22', now)).toBe(0);
    expect(daysSinceLocalDate('2026-11-21', now)).toBe(1);
    expect(daysSinceLocalDate('2026-11-23', now)).toBe(-1);
  });

  it('一天 24 小时都稳定:今天的记录不会被算成 -1', () => {
    // 旧写法在 UTC+8 的 00:00–07:59 会得到 -1,导致「最近两周 gap>=0」把它剔除
    for (let hour = 0; hour < 24; hour += 1) {
      const at = localTime(2026, 11, 22, hour, 30);
      expect(daysSinceLocalDate('2026-11-22', at)).toBe(0);
    }
  });

  it('最近两周窗口的边界', () => {
    expect(daysSinceLocalDate('2026-11-08', now)).toBe(14);
    expect(daysSinceLocalDate('2026-11-09', now)).toBe(13);
    const inWindow = (value: string) => {
      const gap = daysSinceLocalDate(value, now) as number;
      return gap >= 0 && gap < 14;
    };
    expect(inWindow('2026-11-22')).toBe(true); // 今天
    expect(inWindow('2026-11-09')).toBe(true); // 13 天前
    expect(inWindow('2026-11-08')).toBe(false); // 14 天前,窗口外
    expect(inWindow('2026-11-23')).toBe(false); // 明天,未来不计
  });

  it('跨月跨年', () => {
    expect(daysSinceLocalDate('2026-10-31', localTime(2026, 11, 1, 0, 30))).toBe(1);
    expect(daysSinceLocalDate('2026-12-31', localTime(2027, 1, 1, 0, 30))).toBe(1);
    expect(daysSinceLocalDate('2027-01-01', localTime(2026, 12, 31, 23, 30))).toBe(-1);
  });

  it('闰年 2 月', () => {
    expect(daysSinceLocalDate('2028-02-28', localTime(2028, 3, 1, 12))).toBe(2);
    expect(daysSinceLocalDate('2027-02-28', localTime(2027, 3, 1, 12))).toBe(1);
  });

  it('带时间的 ISO 按其所属本地日计算', () => {
    expect(daysSinceLocalDate(localTime(2026, 11, 22, 9).toISOString(), now)).toBe(0);
    expect(daysSinceLocalDate(localTime(2026, 11, 21, 9).toISOString(), now)).toBe(1);
  });

  it('非法日期返回 null,不抛错', () => {
    expect(daysSinceLocalDate('not-a-date', now)).toBeNull();
    expect(daysSinceLocalDate('', now)).toBeNull();
  });
});

describe('startOfLocalDayTime', () => {
  it('纯日期取那一天的本地的零点', () => {
    const value = startOfLocalDayTime('2026-11-22') as number;
    const expected = new Date(2026, 10, 22).getTime();
    expect(value).toBe(expected);
  });

  it('带时间的 ISO 取所在本地日的零点', () => {
    const value = startOfLocalDayTime(localTime(2026, 11, 22, 23, 59).toISOString()) as number;
    expect(value).toBe(new Date(2026, 10, 22).getTime());
  });

  it('Date 实例同样按本地日归零', () => {
    const value = startOfLocalDayTime(localTime(2026, 11, 22, 5, 0)) as number;
    expect(value).toBe(new Date(2026, 10, 22).getTime());
  });

  it('非法值返回 null', () => {
    expect(startOfLocalDayTime('nope')).toBeNull();
    expect(startOfLocalDayTime(new Date('nope'))).toBeNull();
  });
});
