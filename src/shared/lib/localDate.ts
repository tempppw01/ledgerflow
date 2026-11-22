/**
 * 用本地时区把 Date 转成 YYYY-MM-DD。
 *
 * `Date#toISOString().slice(0, 10)` 会先换算到 UTC,在 UTC+8 等东时区里,
 * 本地 00:00 常常会退到前一天,导致「本月」「最近 30 天」这类区间整体前移一天。
 */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 今天的本地日期键。用于预填 `<input type="date">` 这类「今天」语义的地方。
 *
 * 不要用 `new Date().toISOString().slice(0, 10)`:在 UTC+8 / UTC+9,本地 00:00–07:59
 * 之间它返回的是**昨天**,于是「记录还款」的日期会被预填成前一天,而且每天有 8–9 小时
 * 都这样。
 */
export function todayLocalDateKey(now: Date = new Date()): string {
  return toLocalDateKey(now);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 取某个日期值所在「本地日历日」的零点时间戳;非法值返回 null。
 *
 * 两种输入必须分开处理:
 * - **纯日期**(`2026-11-20`)表示「那一天」。必须用 `new Date(y, m-1, d)` 构造本地零点;
 *   直接 `new Date('2026-11-20')` 按 UTC 零点解析,在 UTC-8 会落到本地 11-19,差一天。
 * - **带时间的 ISO** 表示一个瞬间,取其所在的本地日。
 */
export function startOfLocalDayTime(value: string | Date): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  }
  const dateOnly = DATE_ONLY_RE.exec(value.trim());
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
}

/**
 * 距今天过了多少个「本地日历日」:今天 = 0,昨天 = 1,明天 = -1。非法日期返回 null。
 *
 * 用来替代 `Math.floor((Date.now() - new Date(item.date).getTime()) / 一天)`:
 * 那种写法把纯日期按 UTC 零点解析再和当前时刻相减,于是「今天的记录」在 UTC+8 的
 * 00:00–07:59 会算出 -1,被「最近两周(gap >= 0)」直接剔除 —— 早上记的账不进统计。
 *
 * 用 round 而不是 floor:夏令时切换那天两个本地零点相差 23 或 25 小时。
 */
export function daysSinceLocalDate(value: string | Date, now: Date = new Date()): number | null {
  const from = startOfLocalDayTime(value);
  const today = startOfLocalDayTime(now);
  if (from === null || today === null) return null;
  return Math.round((today - from) / (1000 * 60 * 60 * 24));
}

/** 交易类记录是否真正影响余额:待支付、已关闭、失败的行不参与计算。 */
export function isBalanceAffectingStatus(status: string | undefined): boolean {
  return status !== 'pending' && status !== 'closed' && status !== 'failed';
}