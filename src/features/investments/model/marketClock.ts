/**
 * 带时区的「现在几点」。
 *
 * 为什么不用 `date.getHours()`:那个读的是**运行环境的本地时区**。行情页要同时显示
 * 纽约、伦敦、东京……的时间,而后端与浏览器可能在不同时区(服务端容器通常是 UTC)。
 * `Intl.DateTimeFormat` 带 `timeZone` 才是唯一可靠的换算方式。
 *
 * 这段原本写在 InvestmentsPage.tsx 里。抽出来的原因:美股的盘前/盘后倒计时
 * (usExtendedSession.ts)也要用同一套换算 —— 复制一份就会出现「时区算得不一样」
 * 这种最难查的一类 bug。
 */

export interface ZonedClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = 周日,6 = 周六(与 `Date#getDay()` 一致) */
  weekday: number;
  /** 当天已过去的分钟数(含秒的小数部分),用于做区段比较 */
  minutes: number;
}

export function getZonedClock(now: Date, timeZone: string): ZonedClock {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  const year = values.year || now.getUTCFullYear();
  const month = values.month || now.getUTCMonth() + 1;
  const day = values.day || now.getUTCDate();
  const hour = values.hour || 0;
  const minute = values.minute || 0;
  const second = values.second || 0;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minutes: hour * 60 + minute + second / 60
  };
}

export function getTimeZoneOffsetMinutes(now: Date, timeZone: string) {
  const zoned = getZonedClock(now, timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second
  );
  return (asUtc - now.getTime()) / 60000;
}
