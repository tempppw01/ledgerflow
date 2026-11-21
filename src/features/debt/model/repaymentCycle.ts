import type { DebtItem, RepaymentRecord } from './debtMetrics';

export interface RepaymentCycleWindow {
  start: Date;
  end: Date;
  dueDate: Date;
}

export interface RepaymentDueDisplay {
  dueDate: Date;
  daysUntil: number;
  isOverdue: boolean;
  isPaid: boolean;
  paidAmount: number;
  gapAmount: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
/** Rounding noise from bank statements is treated as settled. */
export const REPAYMENT_AMOUNT_TOLERANCE = 1;
const REPAYMENT_CYCLE_GRACE_DAYS = 10;

export function parseRepaymentDay(raw?: string): number | null {
  const text = String(raw || '');
  if (!text) {
    return null;
  }

  const candidates: RegExp[] = [
    /\d{4}[-/.]\d{1,2}[-/.](\d{1,2})/,
    /(\d{1,2})\s*[日号]/,
    /每月\s*(\d{1,2})/
  ];
  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (!match) continue;
    const day = Number(match[1]);
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      return day;
    }
  }
  return null;
}

function clampDayToMonth(year: number, monthIndex: number, day: number): number {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(day, 1), lastDay);
}

export function buildRepaymentDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, clampDayToMonth(year, monthIndex, day));
}

/**
 * Keeps the just-passed due date briefly visible so a payment made before the
 * deadline still counts. Outside that grace window, the next upcoming date is
 * treated as the active cycle.
 */
export function resolveRepaymentCycleWindow(
  anchorDay: number | null,
  now = new Date()
): RepaymentCycleWindow {
  if (anchorDay === null) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, dueDate: end };
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let upcoming = buildRepaymentDate(now.getFullYear(), now.getMonth(), anchorDay);
  if (upcoming.getTime() < today.getTime()) {
    upcoming = buildRepaymentDate(now.getFullYear(), now.getMonth() + 1, anchorDay);
  }
  const previousAnchor = buildRepaymentDate(upcoming.getFullYear(), upcoming.getMonth() - 1, anchorDay);
  const daysSincePreviousAnchor = Math.floor((today.getTime() - previousAnchor.getTime()) / DAY_IN_MS);
  const dueDate =
    daysSincePreviousAnchor >= 0 && daysSincePreviousAnchor <= REPAYMENT_CYCLE_GRACE_DAYS
      ? previousAnchor
      : upcoming;

  // 窗口 = 「本期归属的还款区间」,必须满足两条:
  //   1. 宽限期内的迟还也要算进本期。以前窗口是 [上次到期日, 到期日当天],
  //      而上面的宽限期有 10 天 —— 结果是:到期后第 1~10 天明明还在这期里
  //      (界面也还显示这期),但那些天还的钱一分都不计入,直接判成逾期。
  //      宽限期等于白设。
  //   2. 相邻两期不能重叠。以前本期窗口从「上次到期日」当天开始,于是上次
  //      到期日当天的还款同时落进本期和上期的窗口:在到期日还款(最常见的
  //      做法)会让下一期也被标成已还,整月被跳过。
  // 现在取 (上次到期日 + 宽限期, 本到期日 + 宽限期] 这一段:与下一期首尾相接,
  // 既不重叠也不留缝;到期后 10 天内的迟还会正常归入本期。
  const graceMs = REPAYMENT_CYCLE_GRACE_DAYS * DAY_IN_MS;
  // 起点要按「本到期日的上一期」算,不能用上面的 previousAnchor:在宽限期内
  // 处于活动状态的那一期,previousAnchor 恰好就等于 dueDate 本身,拿它当基准
  // 会把窗口推到到期日之后,迟还反而更算不进来。
  const anchorBeforeDue = buildRepaymentDate(dueDate.getFullYear(), dueDate.getMonth() - 1, anchorDay);
  const cycleStart = new Date(anchorBeforeDue.getTime() + graceMs + DAY_IN_MS);
  const cycleEnd = new Date(dueDate.getTime() + graceMs + DAY_IN_MS - 1);

  return {
    start: cycleStart,
    end: cycleEnd,
    dueDate
  };
}

export function resolveRepaymentPaidTime(paidAt?: string): number | null {
  const match = String(paidAt || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    return Number.isFinite(time) ? time : null;
  }
  const parsed = Date.parse(String(paidAt || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function sumRepaymentAmountInCycle(
  debtId: string,
  records: RepaymentRecord[],
  cycle: Pick<RepaymentCycleWindow, 'start' | 'end'>
): number {
  return records.reduce((sum, record) => {
    if (record.debtId !== debtId) return sum;
    const paidTime = resolveRepaymentPaidTime(record.paidAt);
    if (paidTime === null || paidTime < cycle.start.getTime() || paidTime > cycle.end.getTime()) {
      return sum;
    }
    return sum + Number(record.amount || 0);
  }, 0);
}

export function resolveRepaymentDueDisplay(
  input: { debtId: string; repaymentDay?: number; minimumPayment: number },
  records: RepaymentRecord[],
  now = new Date()
): RepaymentDueDisplay | null {
  const repaymentDay = Number(input.repaymentDay);
  if (!Number.isInteger(repaymentDay) || repaymentDay < 1 || repaymentDay > 31 || !input.debtId) {
    return null;
  }

  const cycle = resolveRepaymentCycleWindow(repaymentDay, now);
  const paidAmount = sumRepaymentAmountInCycle(input.debtId, records, cycle);
  const minimumPayment = Math.max(0, Number(input.minimumPayment || 0));
  const gapAmount = Math.max(0, minimumPayment - paidAmount);
  const isPaid = minimumPayment > 0 && gapAmount <= REPAYMENT_AMOUNT_TOLERANCE;
  const dueDate = isPaid
    ? buildRepaymentDate(cycle.dueDate.getFullYear(), cycle.dueDate.getMonth() + 1, repaymentDay)
    : cycle.dueDate;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntil = Math.round((dueDate.getTime() - startOfToday.getTime()) / DAY_IN_MS);

  return {
    dueDate,
    daysUntil,
    isOverdue: !isPaid && daysUntil < 0,
    isPaid,
    paidAmount,
    gapAmount
  };
}

export function resolveDebtRepaymentDueDisplay(
  debt: DebtItem,
  minimumPayment: number,
  records: RepaymentRecord[],
  now = new Date()
): RepaymentDueDisplay | null {
  return resolveRepaymentDueDisplay(
    {
      debtId: debt.id,
      repaymentDay: debt.repaymentDay,
      minimumPayment
    },
    records,
    now
  );
}
