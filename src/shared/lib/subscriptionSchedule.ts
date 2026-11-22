import type { SubscriptionBillingCycle } from '../../entities/subscription/types';

/** `<input type="date">` 产出的纯日期串。 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 加月份,并把「日」夹在目标月的最后一天之内。
 *
 * 直接 setMonth 会溢出:1月31日 + 1个月 会变成 3月2/3日(2月没有 31 号)。
 * 对订阅续费来说那是错的 —— 1月31日的月付订阅,下一次应该是 2月28/29日。
 *
 * **必须用 UTC 做这套日历运算。** 之前用的是本地 getter:`new Date('2026-01-31')`
 * 按 UTC 零点解析,在 UTC-5 变成「1月30日 19:00」,于是「日」被当成 30,
 * 夹到 2 月 28 后又被时区换算推回 `2026-03-01T00:00Z` —— 整段二月被跳过。
 * 用 UTC 组件后,全球任何时区的结果都一致。
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const next = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/**
 * 按计费周期把某个日期推进一期。
 *
 * 用途:点了「生成支出」之后,把续费日/到期日推到下一期。不推进的话,
 * 月付订阅一旦过了第一期就会永远停在「已到期」—— 用户已经记了这笔支出,
 * 首页「未来与待办」却还在提示「续费已逾期」。
 *
 * 空值、非法日期、以及自定义周期缺天数的情况一律原样返回,不抛错:宁可日期
 * 不动,也不能因为一次点击把用户的日期改成 NaN。
 *
 * 输出格式跟随输入:纯日期进、纯日期出(`<input type="date">` 与账本里存的都是这种),
 * 带时间的 ISO 进、ISO 出。
 */
export function advanceSubscriptionDate(
  date: string | undefined,
  billingCycle: SubscriptionBillingCycle,
  customCycleDays?: number
): string | undefined {
  if (!date) {
    return date;
  }
  const base = new Date(date);
  if (Number.isNaN(base.getTime())) {
    return date;
  }

  const isDateOnly = DATE_ONLY_RE.test(date);
  const format = (value: Date) =>
    isDateOnly ? value.toISOString().slice(0, 10) : value.toISOString();

  switch (billingCycle) {
    case 'monthly':
      return format(addMonthsClamped(base, 1));
    case 'quarterly':
      return format(addMonthsClamped(base, 3));
    case 'semiannual':
      return format(addMonthsClamped(base, 6));
    case 'yearly':
      return format(addMonthsClamped(base, 12));
    case 'custom': {
      const days = Number(customCycleDays);
      if (!Number.isFinite(days) || days <= 0) {
        return date;
      }
      const next = new Date(base);
      next.setUTCDate(next.getUTCDate() + days);
      return format(next);
    }
    default:
      return date;
  }
}