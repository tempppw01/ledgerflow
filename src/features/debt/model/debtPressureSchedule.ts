import { calculateDebtMinimumPayment, type DebtItem } from './debtMetrics';
import { resolveRepaymentCycleWindow } from './repaymentCycle';

export interface DebtPressureScheduleRow {
  period: string;
  dueDate: string;
  amount: number;
  principal: number;
  interest: number;
  remaining: number;
}

export interface BuildDebtPressureScheduleOptions {
  /**
   * Auto-generated schedules skip this many leading cycles so the forecast
   * starts at the next instalment the user still owes. Manual schedules are
   * trimmed by their own due dates instead.
   */
  startOffsetMonths?: number;
  now?: Date;
}

function toISODate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampDayInMonthValue(year: number, month: number, day: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, day), lastDay);
}

function shiftMonthWithDay(base: Date, offset: number, day?: number): Date {
  const targetYear = base.getFullYear();
  const targetMonth = base.getMonth() + offset;
  const targetDay = day ?? base.getDate();
  return new Date(
    targetYear,
    targetMonth,
    clampDayInMonthValue(targetYear, targetMonth, targetDay)
  );
}

function parseDateText(value?: string): Date | null {
  const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getManualScheduleStartPeriod(
  debt: Pick<DebtItem, 'paidPeriods' | 'totalPeriods' | 'remainingMonths'>
): number {
  const paidPeriods = Number(debt.paidPeriods);
  if (Number.isFinite(paidPeriods) && paidPeriods >= 0) {
    return Math.floor(paidPeriods) + 1;
  }

  const totalPeriods = Number(debt.totalPeriods);
  const remainingMonths = Number(debt.remainingMonths);
  if (
    Number.isFinite(totalPeriods) &&
    totalPeriods > 0 &&
    Number.isFinite(remainingMonths) &&
    remainingMonths >= 0
  ) {
    return Math.max(1, Math.floor(totalPeriods) - Math.floor(remainingMonths) + 1);
  }

  return 1;
}

function normalizeManualRows(debt: DebtItem) {
  return Array.isArray(debt.manualRepayments)
    ? debt.manualRepayments
        .map((item) => ({
          ...item,
          amount: Math.max(0, Number(item.amount) || 0)
        }))
        .filter((item) => item.amount > 0)
        .sort((a, b) => {
          const aDate = parseDateText(a.dueDate);
          const bDate = parseDateText(b.dueDate);
          const aTime = aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
          const bTime = bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER;
          return aTime - bTime;
        })
    : [];
}

export function buildDebtPressureSchedule(
  debt: DebtItem,
  options?: BuildDebtPressureScheduleOptions
): DebtPressureScheduleRow[] {
  const now = options?.now ?? new Date();
  const balance = Math.max(0, Number(debt.balance) || 0);
  const manualRows = normalizeManualRows(debt);

  let rows: Array<{ amount: number; dueDate?: string; label?: string }> = manualRows;
  const manualStartOffset = Math.max(0, Math.floor(options?.startOffsetMonths ?? 0));
  if (manualRows.length > 0) {
    // Manual plans keep their full recorded calendar by default. When the
    // current cycle is already settled, the caller asks for one cycle of
    // offset and the forecast opens on the next instalment instead of
    // replaying the instalment the user just paid.
    if (manualStartOffset > 0) {
      const cycle = resolveRepaymentCycleWindow(
        typeof debt.repaymentDay === 'number' ? debt.repaymentDay : null,
        now
      );
      const cycleDueTime = cycle.dueDate.getTime();
      rows = manualRows.filter((row) => {
        const due = parseDateText(row.dueDate);
        return due === null || due.getTime() >= cycleDueTime;
      });
      if (rows.length === manualRows.length && rows.length > manualStartOffset) {
        rows = rows.slice(manualStartOffset);
      }
    }
  } else {
    const safeMonthCount =
      typeof debt.remainingMonths === 'number' && debt.remainingMonths > 0
        ? Math.min(36, Math.floor(debt.remainingMonths))
        : debt.totalPeriods && debt.paidPeriods !== undefined
          ? Math.max(1, Math.min(36, debt.totalPeriods - debt.paidPeriods))
          : 12;
    const monthlyPayment = calculateDebtMinimumPayment({
      ...debt,
      remainingMonths: safeMonthCount
    });
    if (monthlyPayment <= 0) return [];
    const start = now;
    const day = typeof debt.repaymentDay === 'number' ? debt.repaymentDay : start.getDate();
    // Skip cycles that are already settled so the forecast starts at the next
    // instalment the user actually still owes.
    const startOffset = Math.max(
      0,
      Math.min(safeMonthCount - 1, Math.floor(options?.startOffsetMonths ?? 0))
    );
    rows = Array.from({ length: Math.max(1, safeMonthCount - startOffset) }, (_, index) => ({
      amount: monthlyPayment,
      dueDate: toISODate(shiftMonthWithDay(start, index + startOffset, day))
    }));
  }

  const manualScheduleStartPeriod = getManualScheduleStartPeriod(debt);
  const monthlyRate = Math.max(0, Number(debt.annualRate) || 0) / 12 / 100;
  // 全程按「分」做整数运算。
  // 原来是用浮点算利息与本金、再各自 toFixed(2),两条独立的四舍五入会让
  // 本金 + 利息 与 金额 差出 0.01(实测信用卡 5000 元 / 18% / 第 2 期:
  // 431.38 + 68.63 = 500.01,而金额写的是 500)。摊还表的「本金 + 利息 = 每期金额」
  // 是用户会逐行相加去核对的基本等式,差一分就会让人不敢信这张表。
  // 改成分制整数后,等式与「余额 = 上期余额 − 本金」都按构造精确成立。
  const toCents = (value: number) => Math.round(value * 100);
  let remainingCents = toCents(balance);
  return rows.slice(0, 36).map((item, index) => {
    const openingCents = remainingCents;
    const amountCents = toCents(item.amount);
    const interestCents = Math.min(
      amountCents,
      Math.max(0, Math.round(openingCents * monthlyRate))
    );
    // 还款额超过「余额 + 利息」时本金被封顶,不会出现倒欠或多还。
    const principalCents = Math.min(openingCents, Math.max(0, amountCents - interestCents));
    remainingCents = Math.max(0, openingCents - principalCents);
    return {
      period: item.label?.trim() || `第 ${manualScheduleStartPeriod + index} 期`,
      dueDate: item.dueDate || '日期待填',
      amount: amountCents / 100,
      principal: principalCents / 100,
      interest: interestCents / 100,
      remaining: remainingCents / 100
    };
  });
}
