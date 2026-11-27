/**
 * 美股盘前 / 盘后时段的判定与倒计时。
 *
 * 为什么需要它:后端已经在盘前/盘后时段给出 `extended` 行情(见
 * eastmoneyMarketClient 里的说明 —— 美股指数本身没有这两段交易,用对应 ETF 代替),
 * 但界面上只在那张卡片上出现一个「盘前 / 盘后」标签,**没有任何时间感**:
 * 不知道现在离收盘还有多久、下一段什么时候开始。这一段就是补这个。
 *
 * 判据来源:美东时间的常规交易时段与扩展时段是交易所公开规则 ——
 *   盘前 04:00–09:30、常规 09:30–16:00、盘后 16:00–20:00。
 * 全部按 **America/New_York** 的本地分钟数比较,夏令时由 Intl 自己换算,
 * 所以 3 月与 11 月的切换不需要任何特殊处理(切换发生在周日凌晨,本就不在交易周内)。
 *
 * 刻意不做的一件事:**不算节假日**。仓库里唯一的节假日表(MARKET_HOLIDAY_NOTICES)
 * 只有几个中国节日与圣诞,`getGlobalMarketState` 本身也只按"工作日"判断。
 * 倒计时如果自己另搞一套节假日,就会出现"页面说未开盘、倒计时说还有 2 小时开盘"
 * 这种自相矛盾。所以这里与既有口径保持一致:周一~周五视为交易日。
 */

import { getZonedClock } from './marketClock';

/** 全部是美东时间的「当天第几分钟」 */
export const US_EXTENDED_WINDOWS = {
  pre: { start: 4 * 60, end: 9 * 60 + 30 },
  regular: { start: 9 * 60 + 30, end: 16 * 60 },
  after: { start: 16 * 60, end: 20 * 60 }
} as const;

export type UsExtendedSessionId = 'pre' | 'after';

/**
 * - `active`:这一段正在进行,倒计时数到**结束**
 * - `today` :今天这段还没开始,倒计时数到**开始**
 * - `later` :今天这段已经过去(或今天不是交易日),倒计时数到**下一个交易日**的开始
 */
export type UsExtendedSlotState = 'active' | 'today' | 'later';

export interface UsExtendedSlot {
  session: UsExtendedSessionId;
  startMinute: number;
  endMinute: number;
  state: UsExtendedSlotState;
  /** 距目标还有多少毫秒(永远是正数) */
  countdownMs: number;
}

export interface UsExtendedView {
  /** 美东当天的星期(0 = 周日) */
  weekday: number;
  /** 当前处于盘前或盘后 —— 有值就说明扩展时段正在交易 */
  activeSession: UsExtendedSessionId | null;
  /** 当前是否在常规时段内 */
  inRegularSession: boolean;
  /** 周五收盘之后、或周六周日:两个倒计时都指向下一个交易日 */
  nextTradingDay: boolean;
  pre: UsExtendedSlot;
  after: UsExtendedSlot;
}

/** 从某天算到「下一个交易日」要跨几天(周五 → 3,周六 → 2,周日 → 1,其余 → 1) */
function daysToNextTradingDay(weekday: number): number {
  if (weekday === 5) return 3;
  if (weekday === 6) return 2;
  if (weekday === 0) return 1;
  return 1;
}

function resolveSlot(
  session: UsExtendedSessionId,
  startMinute: number,
  endMinute: number,
  minutes: number,
  weekday: number,
  isTradingDay: boolean
): UsExtendedSlot {
  if (isTradingDay && minutes >= startMinute && minutes < endMinute) {
    return {
      session,
      startMinute,
      endMinute,
      state: 'active',
      countdownMs: (endMinute - minutes) * 60_000
    };
  }

  if (isTradingDay && minutes < startMinute) {
    return {
      session,
      startMinute,
      endMinute,
      state: 'today',
      countdownMs: (startMinute - minutes) * 60_000
    };
  }

  /*
   * 已经过去了(或今天不交易):数到下一个交易日这一段的开始。
   * 跨日数必须按「周五收盘后要等三天」算,否则周五晚上会显示「距盘前 8 小时」——
   * 那是周六凌晨 4 点,市场根本没开。
   */
  const days = daysToNextTradingDay(weekday);
  return {
    session,
    startMinute,
    endMinute,
    state: 'later',
    countdownMs: (days * 1440 + startMinute - minutes) * 60_000
  };
}

export function resolveUsExtendedView(now: Date): UsExtendedView {
  const clock = getZonedClock(now, 'America/New_York');
  const { minutes, weekday } = clock;
  // 周五 20:00 之后到周一 04:00 之前,市场是关着的,两个倒计时都指向下个交易日
  const isTradingDay = weekday >= 1 && weekday <= 5;
  const inRegularSession =
    isTradingDay &&
    minutes >= US_EXTENDED_WINDOWS.regular.start &&
    minutes < US_EXTENDED_WINDOWS.regular.end;
  const pre = resolveSlot(
    'pre',
    US_EXTENDED_WINDOWS.pre.start,
    US_EXTENDED_WINDOWS.pre.end,
    minutes,
    weekday,
    isTradingDay
  );
  const after = resolveSlot(
    'after',
    US_EXTENDED_WINDOWS.after.start,
    US_EXTENDED_WINDOWS.after.end,
    minutes,
    weekday,
    isTradingDay
  );

  const activeSession = pre.state === 'active' ? 'pre' : after.state === 'active' ? 'after' : null;

  return {
    weekday,
    activeSession,
    inRegularSession,
    nextTradingDay: pre.state === 'later' && after.state === 'later',
    pre,
    after
  };
}

/**
 * 倒计时文本。小时可以超过 24(周五收盘后到周一盘前是 56 小时),
 * 所以不做「取模到一天内」的处理 —— 56:00:00 就是 56 小时后,不会误导。
 *
 * 用 `Math.ceil`:最后 0.4 秒应该显示 00:00:01 而不是 00:00:00,
 * 否则倒计时会提前一秒显示成 0。
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

/** 把「当天第几分钟」写成 04:00 这样的展示文本 */
export function formatWindowMinute(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
