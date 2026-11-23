import type { SubscriptionItem } from '../../../entities/subscription/types';

/** `<input type="date">` 与账本里存的到期日都是纯日期。 */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 「今天」与「到期日」之间的容忍窗口:剩余天数 ≤ 这个值算「即将到期」。 */
const DUE_SOON_DAYS = 7;

type StatusInput = Pick<SubscriptionItem, 'expireDate' | 'renewalDate' | 'status'>;

/**
 * 取出某个日期值所在「本地日历日」的零点时间戳。
 *
 * 两件事必须分开处理:
 * - **纯日期**(`2026-11-20`)表示「那一天」,不是某个 UTC 时刻。必须用
 *   `new Date(y, m-1, d)` 构造本地零点;直接用 `new Date('2026-11-20')` 会按 UTC 零点解析,
 *   在 UTC-8 就落到本地 11-19,整整差一天。
 * - **带时间的 ISO** 表示一个瞬间,取它所在的本地日。
 */
function startOfLocalDay(value: string): number | null {
  const dateOnly = DATE_ONLY_RE.exec(value.trim());
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
}

/**
 * 订阅状态:已暂停 / 已逾期 / 即将到期 / 正常。
 *
 * **按本地日历日比较**,不按时间戳差:
 * 之前是 `Math.ceil((到期时刻 - 现在) / 一天)`,而纯日期到期日按 UTC 零点解析,于是
 * 「哪一刻算逾期」取决于时区 —— 实测同一份数据:
 *
 * | 时区 | 到期日当天最早出现「已逾期」的时刻 |
 * | --- | --- |
 * | UTC+8 | 次日 08:00(拖了 8 小时) |
 * | UTC-5 | 当天 19:00(到期日还没过完) |
 * | UTC-8 | 当天 16:00(到期日还没过完) |
 *
 * 也就是说西部时区的用户会在到期日当天下午就被告知「已逾期」。改成比较本地日历日后,
 * 语义变成「到期日当天算即将到期,次日起才算逾期」,与用户看到的日期一致,且与时区无关。
 *
 * `now` 可注入,便于测试;不传就用当前时刻。
 */
export function resolveSubscriptionStatus(
  item: StatusInput,
  now: Date = new Date()
): SubscriptionItem['status'] {
  if (item.status === 'paused') return 'paused';

  /*
   * **到期日优先,这是刻意的**(有专门的测试钉着:subscriptionStatus.test.ts
   * 「expireDate 优先于 renewalDate」)。订阅有两个独立日期,分别回答两个问题:
   *
   *   · 到期日 expireDate →「这份订阅还生效吗」→ 这个状态徽标(正常/即将到期/已到期);
   *   · 续费日 renewalDate →「下一笔钱什么时候扣」→ 卡片上的「续费/提醒 + 日期」,
   *     以及首页「未来与待办」的「续费已逾期」和财务分析的 due-soon 计数。
   *
   * 两个日期同时存在且不一致时,同一订阅会在两屏得到不同结论
   * (实测:续费日已过、到期日在未来 → 订阅页显示「正常」,首页显示「续费已逾期」)。
   * 那是两个不同的问题,不是两个口径 —— 所以**不要**为了「统一」把这里改成续费日优先,
   * 也不要反过来去改那两处。真要统一,先决定这两个字段在产品上各自代表什么。
   */
  const target = item.expireDate || item.renewalDate;
  if (!target) return 'active';

  const targetDayStart = startOfLocalDay(target);
  if (targetDayStart === null) return 'active';

  const todayStart = startOfLocalDay(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`
  );
  if (todayStart === null) return 'active';

  // 用 round 而不是 floor/ceil:夏令时切换那天两个本地零点相差 23 或 25 小时。
  const diffDays = Math.round((targetDayStart - todayStart) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= DUE_SOON_DAYS) return 'due-soon';
  return 'active';
}
