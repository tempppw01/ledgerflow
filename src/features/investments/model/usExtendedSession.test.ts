import { describe, expect, it } from 'vitest';
import {
  US_EXTENDED_WINDOWS,
  formatCountdown,
  formatWindowMinute,
  resolveUsExtendedView
} from './usExtendedSession';

/**
 * 美股盘前/盘后倒计时。
 *
 * 时间一律用 **UTC 字符串**写,注释里标出对应的美东时间 —— 测试机时区不参与计算,
 * 否则这套断言在 CI(通常是 UTC)和本地(UTC+8)会得到不同结果。
 *
 * 冬天的美东是 UTC-5:14:00Z = 09:00 ET;夏令时(2026-03-08 起)是 UTC-4:
 * 13:30Z = 09:30 ET。两种情况都覆盖到了,用来证明换算是交给 Intl、不是写死偏移。
 *
 * 2026-11-27 是周五,2026-11-28 周六,2026-11-29 周日,2026-11-30 周一,2026-03-09 周一。
 */
const at = (iso: string) => new Date(iso);

describe('resolveUsExtendedView', () => {
  it('盘前时段:盘前进行中,盘后还是「今天」', () => {
    // 周五 05:00 ET
    const view = resolveUsExtendedView(at('2026-11-27T10:00:00Z'));

    expect(view.weekday).toBe(5);
    expect(view.activeSession).toBe('pre');
    expect(view.inRegularSession).toBe(false);
    expect(view.pre.state).toBe('active');
    // 距 09:30 还有 4 小时 30 分
    expect(view.pre.countdownMs).toBe(4.5 * 3600 * 1000);
    expect(view.after.state).toBe('today');
    // 距 16:00 还有 11 小时
    expect(view.after.countdownMs).toBe(11 * 3600 * 1000);
    expect(view.nextTradingDay).toBe(false);
  });

  it('常规时段(周五):盘前已过去 —— 指向的是下周一,不是明天', () => {
    // 周五 10:00 ET
    const view = resolveUsExtendedView(at('2026-11-27T15:00:00Z'));

    expect(view.activeSession).toBeNull();
    expect(view.inRegularSession).toBe(true);
    expect(view.pre.state).toBe('later');
    // 周一 04:00 —— 周五 10:00 起算是 66 小时
    expect(view.pre.countdownMs).toBe(66 * 3600 * 1000);
    expect(view.after.state).toBe('today');
    expect(view.after.countdownMs).toBe(6 * 3600 * 1000);
  });

  it('常规时段(周一):盘前指向明天 04:00', () => {
    // 周一 10:00 ET
    const view = resolveUsExtendedView(at('2026-11-30T15:00:00Z'));

    expect(view.weekday).toBe(1);
    expect(view.pre.state).toBe('later');
    expect(view.pre.countdownMs).toBe(18 * 3600 * 1000);
    expect(view.after.countdownMs).toBe(6 * 3600 * 1000);
  });

  it('盘后时段:盘后进行中,盘前指向下个交易日', () => {
    // 周五 17:00 ET
    const view = resolveUsExtendedView(at('2026-11-27T22:00:00Z'));

    expect(view.activeSession).toBe('after');
    expect(view.inRegularSession).toBe(false);
    expect(view.after.state).toBe('active');
    expect(view.after.countdownMs).toBe(3 * 3600 * 1000);
    expect(view.pre.state).toBe('later');
    // 周五 17:00 到周一 04:00 = 59 小时
    expect(view.pre.countdownMs).toBe(59 * 3600 * 1000);
  });

  it('周五收盘后要等三天,不是「距盘前 8 小时」', () => {
    // 周五 21:00 ET(= 周六 02:00Z,但美东仍是周五)
    const view = resolveUsExtendedView(at('2026-11-28T02:00:00Z'));

    expect(view.weekday).toBe(5);
    expect(view.nextTradingDay).toBe(true);
    expect(view.pre.state).toBe('later');
    // 周一 04:00 还有 55 小时
    expect(view.pre.countdownMs).toBe(55 * 3600 * 1000);
    expect(view.after.countdownMs).toBe(67 * 3600 * 1000);
  });

  it('周六:两个倒计时都指向周一', () => {
    // 周六 13:00 ET
    const view = resolveUsExtendedView(at('2026-11-28T18:00:00Z'));

    expect(view.weekday).toBe(6);
    expect(view.activeSession).toBeNull();
    expect(view.inRegularSession).toBe(false);
    expect(view.nextTradingDay).toBe(true);
    expect(view.pre.countdownMs).toBe(39 * 3600 * 1000);
    expect(view.after.countdownMs).toBe(51 * 3600 * 1000);
  });

  it('周一凌晨:盘前是「今天 04:00」,盘后是「今天 16:00」', () => {
    // 周一 02:00 ET
    const view = resolveUsExtendedView(at('2026-11-30T07:00:00Z'));

    expect(view.weekday).toBe(1);
    expect(view.pre.state).toBe('today');
    expect(view.pre.countdownMs).toBe(2 * 3600 * 1000);
    expect(view.after.state).toBe('today');
    expect(view.after.countdownMs).toBe(14 * 3600 * 1000);
    expect(view.nextTradingDay).toBe(false);
  });

  it('区间端点:09:30 起算常规时段、16:00 起算盘后', () => {
    const open = resolveUsExtendedView(at('2026-11-27T14:30:00Z'));
    expect(open.pre.state).toBe('later');
    expect(open.inRegularSession).toBe(true);

    const close = resolveUsExtendedView(at('2026-11-27T21:00:00Z'));
    expect(close.inRegularSession).toBe(false);
    expect(close.after.state).toBe('active');
    // 距 20:00 整 4 小时
    expect(close.after.countdownMs).toBe(4 * 3600 * 1000);
  });

  it('夏令时换过之后仍然按美东算', () => {
    // 周一 09:00 ET(夏令时,13:00Z)—— 09:00 仍算盘前,离 09:30 还剩半小时
    const view = resolveUsExtendedView(at('2026-03-09T13:00:00Z'));

    expect(view.activeSession).toBe('pre');
    expect(view.pre.countdownMs).toBe(30 * 60 * 1000);
    expect(view.after.state).toBe('today');
    expect(view.after.countdownMs).toBe(7 * 3600 * 1000);
  });

  it('09:30 整点:盘前那一秒就结束,常规时段开始', () => {
    // 周一 09:30 ET(夏令时,13:30Z)
    const view = resolveUsExtendedView(at('2026-03-09T13:30:00Z'));

    expect(view.activeSession).toBeNull();
    expect(view.inRegularSession).toBe(true);
    expect(view.pre.state).toBe('later');
    // 当天已过 09:30,指向次个交易日 04:00 = 18.5 小时
    expect(view.pre.countdownMs).toBe(18.5 * 3600 * 1000);
  });

  it('窗口常量与交易所规则一致', () => {
    expect(formatWindowMinute(US_EXTENDED_WINDOWS.pre.start)).toBe('04:00');
    expect(formatWindowMinute(US_EXTENDED_WINDOWS.pre.end)).toBe('09:30');
    expect(formatWindowMinute(US_EXTENDED_WINDOWS.regular.start)).toBe('09:30');
    expect(formatWindowMinute(US_EXTENDED_WINDOWS.regular.end)).toBe('16:00');
    expect(formatWindowMinute(US_EXTENDED_WINDOWS.after.start)).toBe('16:00');
    expect(formatWindowMinute(US_EXTENDED_WINDOWS.after.end)).toBe('20:00');
  });
});

describe('formatCountdown', () => {
  it('按 HH:MM:SS 输出,并且向上取整到最后 1 秒', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5)).toBe('00:00:00');
    // 999ms 应该显示 1 秒,不能提前显示 0
    expect(formatCountdown(999)).toBe('00:00:01');
    expect(formatCountdown(1_000)).toBe('00:00:01');
    expect(formatCountdown(3_661_000)).toBe('01:01:01');
    expect(formatCountdown(4.5 * 3600 * 1000)).toBe('04:30:00');
  });

  it('超过 24 小时不取模 —— 周末的 55 小时就是 55', () => {
    expect(formatCountdown(55 * 3600 * 1000)).toBe('55:00:00');
    expect(formatCountdown(67 * 3600 * 1000)).toBe('67:00:00');
  });
});

describe('formatWindowMinute', () => {
  it('补零成 HH:MM,并且对跨日分钟数取模', () => {
    expect(formatWindowMinute(0)).toBe('00:00');
    expect(formatWindowMinute(570)).toBe('09:30');
    expect(formatWindowMinute(1200)).toBe('20:00');
    expect(formatWindowMinute(1440 + 240)).toBe('04:00');
  });
});
