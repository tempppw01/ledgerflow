import type { SubscriptionBillingCycle } from '../../entities/subscription/types';

/**
 * 加月份,并把「日」夹在目标月的最后一天之内。
 *
 * 直接 setMonth 会溢出:1月31日 + 1个月 会变成 3月2/3日(2月没有 31 号)。
 * 对订阅续费来说那是错的 —— 1月31日的月付订阅,下一次应该是 2月28/29日。
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
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

  switch (billingCycle) {
    case 'monthly':
      return addMonthsClamped(base, 1).toISOString();
    case 'quarterly':
      return addMonthsClamped(base, 3).toISOString();
    case 'semiannual':
      return addMonthsClamped(base, 6).toISOString();
    case 'yearly':
      return addMonthsClamped(base, 12).toISOString();
    case 'custom': {
      const days = Number(customCycleDays);
      if (!Number.isFinite(days) || days <= 0) {
        return date;
      }
      const next = new Date(base);
      next.setDate(next.getDate() + days);
      return next.toISOString();
    }
    default:
      return date;
  }
}