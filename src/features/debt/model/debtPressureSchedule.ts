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
  let remaining = balance;
  return rows.slice(0, 36).map((item, index) => {
    const openingBalance = remaining;
    const interest = Math.min(item.amount, Math.max(0, openingBalance * monthlyRate));
    const principal = Math.min(openingBalance, Math.max(0, item.amount - interest));
    remaining = Math.max(0, openingBalance - principal);
    return {
      period: item.label?.trim() || `第 ${manualScheduleStartPeriod + index} 期`,
      dueDate: item.dueDate || '日期待填',
      amount: Number(item.amount.toFixed(2)),
      principal: Number(principal.toFixed(2)),
      interest: Number(interest.toFixed(2)),
      remaining: Number(remaining.toFixed(2))
    };
  });
}
