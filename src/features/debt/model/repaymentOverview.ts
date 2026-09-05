import { calculateDebtMinimumPayment, type DebtItem, type RepaymentRecord } from './debtMetrics';

export interface RepaymentOverviewInput {
  debts: DebtItem[];
  repaymentRecords: RepaymentRecord[];
  fromDate?: Date;
  monthsAhead?: number;
}

export interface MonthlyPaymentBreakdownItem {
  id: string;
  name: string;
  type: DebtItem['type'];
  payment: number;
  repaymentDay?: number;
  dueInDays: number | null;
  tone: 'danger' | 'warning' | 'safe';
  paidAmount: number;
  isPaid: boolean;
  isSimpleReminder?: boolean;
  dueDate?: string;
}

export interface RepaymentOverviewResult {
  thisMonthTotal: number;
  thisMonthPaid: number;
  thisMonthRemaining: number;
  progress: number;
  nextDueDate: string | null;
  nextDueDays: number | null;
  breakdown: MonthlyPaymentBreakdownItem[];
  monthlyProjection: Array<{
    monthKey: string;
    monthLabel: string;
    total: number;
    items: Array<{ id: string; name: string; amount: number }>;
  }>;
}

const PALETTE = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6'
];

export function getRepaymentBreakdownColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function normalizeDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(from: Date, to: Date): number {
  const startOfFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const startOfTo = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const ms = startOfTo.getTime() - startOfFrom.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function clampDayInMonth(year: number, month: number, day: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, day), lastDay);
}

function isSameMonth(date: Date, reference: Date): boolean {
  return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth();
}

function getScheduledPayment(
  item: DebtItem,
  year: number,
  month: number,
  fallback: number,
  referenceDate?: Date
): number {
  const manual = Array.isArray(item.manualRepayments) ? item.manualRepayments : [];
  if (manual.length === 0) {
    // “本月”只展示尚未到期的账单；若本月还款日已过去，下一笔应落到下个月。
    if (
      referenceDate &&
      typeof item.repaymentDay === 'number' &&
      year === referenceDate.getFullYear() &&
      month === referenceDate.getMonth() &&
      item.repaymentDay < referenceDate.getDate()
    ) {
      return 0;
    }
    return fallback;
  }
  return manual.reduce((sum, row) => {
    if (!row.dueDate) return sum;
    const dueDate = new Date(row.dueDate);
    if (Number.isNaN(dueDate.getTime()) || dueDate.getFullYear() !== year || dueDate.getMonth() !== month) {
      return sum;
    }
    return sum + Math.max(0, Number(row.amount) || 0);
  }, 0);
}

export function getRepaymentOverview(input: RepaymentOverviewInput): RepaymentOverviewResult {
  const from = input.fromDate ?? new Date();
  const monthsAhead = Math.max(1, Math.min(12, input.monthsAhead ?? 6));

  const simpleReminders = input.debts.filter(
    (item) => item.entryMode === 'simple' && item.status !== 'closed' && item.status !== 'settled' && item.simpleDueDate
  );
  const activeDebts = input.debts.filter((item) => {
    if (item.entryMode === 'simple') return false;
    const balance = Math.max(0, Number(item.balance) || 0);
    const status = item.status ?? (balance <= 0 ? 'settled' : 'active');
    return status === 'active' && balance > 0;
  });

  const todayDay = from.getDate();

  const financialBreakdown: MonthlyPaymentBreakdownItem[] = activeDebts
    .map((item): MonthlyPaymentBreakdownItem => {
      const payment = getScheduledPayment(
        item,
        from.getFullYear(),
        from.getMonth(),
        calculateDebtMinimumPayment(item),
        from
      );
      const dueInDays =
        typeof item.repaymentDay === 'number' && item.repaymentDay >= 1 && item.repaymentDay <= 31
          ? (item.repaymentDay - todayDay + 31) % 31
          : null;
      const tone: MonthlyPaymentBreakdownItem['tone'] =
        dueInDays === null
          ? 'safe'
          : dueInDays === 0
            ? 'danger'
            : dueInDays <= 3
              ? 'danger'
              : dueInDays <= 7
                ? 'warning'
                : 'safe';
      const paidAmount = input.repaymentRecords
        .filter((record) => record.debtId === item.id && isSameMonth(new Date(record.paidAt), from))
        .reduce((sum, record) => sum + Math.max(0, Number(record.amount) || 0), 0);
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        payment,
        repaymentDay: item.repaymentDay,
        dueInDays,
        tone,
        paidAmount,
        isPaid: paidAmount >= Math.max(0.01, payment * 0.98)
      };
    })
    .filter((item) => item.payment > 0)
    .sort((a, b) => {
      const da = a.dueInDays ?? Number.POSITIVE_INFINITY;
      const db = b.dueInDays ?? Number.POSITIVE_INFINITY;
      return da - db;
    });

  const reminderBreakdown: MonthlyPaymentBreakdownItem[] = simpleReminders
    .map((item): MonthlyPaymentBreakdownItem | null => {
      const dueDate = new Date(`${item.simpleDueDate}T00:00:00`);
      if (Number.isNaN(dueDate.getTime())) return null;
      const dueInDays = daysBetween(from, dueDate);
      const payment = Math.max(0, Number(item.simpleAmount) || 0);
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        payment,
        dueInDays,
        tone: dueInDays <= 0 ? 'danger' : dueInDays <= 3 ? 'danger' : dueInDays <= 7 ? 'warning' : 'safe',
        paidAmount: 0,
        isPaid: false,
        isSimpleReminder: true,
        dueDate: item.simpleDueDate
      };
    })
    .filter((item): item is MonthlyPaymentBreakdownItem => item !== null);

  const breakdown = [...financialBreakdown, ...reminderBreakdown]
    .filter((item) => item.payment > 0 || item.isSimpleReminder)
    .sort((a, b) => {
      const da = a.dueInDays ?? Number.POSITIVE_INFINITY;
      const db = b.dueInDays ?? Number.POSITIVE_INFINITY;
      return da - db;
    });

  const thisMonthTotal = breakdown.reduce((sum, item) => sum + item.payment, 0);

  const thisMonthPaid = input.repaymentRecords
    .filter((record) => {
      const paidAt = new Date(record.paidAt);
      return isSameMonth(paidAt, from);
    })
    .reduce((sum, record) => sum + Math.max(0, Number(record.amount) || 0), 0);

  const thisMonthRemaining = Math.max(0, thisMonthTotal - thisMonthPaid);
  const progress = thisMonthTotal > 0 ? Math.min(1, thisMonthPaid / thisMonthTotal) : 0;

  let nextDueDate: string | null = null;
  let nextDueDays: number | null = null;
  for (const item of breakdown) {
    if (item.dueInDays === null) continue;
    if (item.isSimpleReminder) {
      if (item.dueInDays >= 0) {
        nextDueDate = item.dueDate || null;
        nextDueDays = item.dueInDays;
        break;
      }
      continue;
    }
    const dueDate = new Date(
      from.getFullYear(),
      from.getMonth(),
      clampDayInMonth(from.getFullYear(), from.getMonth(), item.repaymentDay as number)
    );
    const days = daysBetween(from, dueDate);
    if (days >= 0) {
      nextDueDate = normalizeDate(dueDate);
      nextDueDays = days;
      break;
    }
  }

  const monthlyProjection: RepaymentOverviewResult['monthlyProjection'] = [];
  for (let offset = 0; offset < monthsAhead; offset += 1) {
    const monthDate = new Date(from.getFullYear(), from.getMonth() + offset, 1);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const items: RepaymentOverviewResult['monthlyProjection'][0]['items'] = [];
    for (const debt of activeDebts) {
      const remaining = debt.remainingMonths;
      if (typeof remaining === 'number' && offset >= remaining) continue;
      const amount = getScheduledPayment(debt, year, month, calculateDebtMinimumPayment(debt));
      if (amount > 0) items.push({ id: debt.id, name: debt.name, amount });
    }
    for (const reminder of simpleReminders) {
      const dueDate = new Date(`${reminder.simpleDueDate}T00:00:00`);
      const amount = Math.max(0, Number(reminder.simpleAmount) || 0);
      if (
        !Number.isNaN(dueDate.getTime()) &&
        dueDate.getFullYear() === year &&
        dueDate.getMonth() === month &&
        amount > 0
      ) {
        items.push({ id: reminder.id, name: reminder.name, amount });
      }
    }
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    monthlyProjection.push({
      monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
      monthLabel: `${month + 1}月`,
      total,
      items
    });
  }

  return {
    thisMonthTotal,
    thisMonthPaid,
    thisMonthRemaining,
    progress,
    nextDueDate,
    nextDueDays,
    breakdown,
    monthlyProjection
  };
}
