import type { Account } from '../../../entities/account/types';
import type { InvestmentPosition } from '../../../entities/investment/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import type { SubscriptionItem } from '../../../entities/subscription/types';
import {
  calculateDebtDerivedMetrics,
  calculateDebtScheduledPayment,
  type DebtItem,
  type RepaymentRecord
} from '../../debt/model/debtMetrics';

export interface AssetLiabilitySimulationRow {
  key: string;
  date: string;
  label: string;
  weekday: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  delta: number;
  assetDelta: number;
  liabilityDelta: number;
  events: string[];
}

export interface AssetLiabilitySimulation {
  rows: AssetLiabilitySimulationRow[];
  initialAssets: number;
  initialLiabilities: number;
  hasEvents: boolean;
}

type ScheduledEvent = {
  date: string;
  assetDelta: number;
  liabilityDelta: number;
  label: string;
  debtId?: string;
  paymentAmount?: number;
};

function safeNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function isLiabilityAccount(account: Account) {
  if (account.type === 'credit' || account.type === 'liability') return true;
  const name = String(account.name || '').toLowerCase();
  return ['信用卡', '花呗', '白条', '借呗', '欠款', '负债', 'credit', 'visa', 'master'].some(
    (keyword) => name.includes(keyword.toLowerCase())
  );
}

function accountBalances(accounts: Account[]) {
  return accounts.reduce(
    (summary, account) => {
      const balance = Math.abs(safeNumber(account.balance ?? account.initialBalance));
      if (isLiabilityAccount(account)) {
        summary.liabilities += balance;
      } else {
        summary.assets += safeNumber(account.balance ?? account.initialBalance);
      }
      return summary;
    },
    { assets: 0, liabilities: 0 }
  );
}

function clampDayInMonth(year: number, month: number, day: number) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, day), lastDay);
}

function monthlyRepaymentDates(start: Date, end: Date, repaymentDay: number) {
  const dates: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const date = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      clampDayInMonth(cursor.getFullYear(), cursor.getMonth(), repaymentDay)
    );
    if (date >= start && date <= end) {
      dates.push(date);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return dates;
}

function buildScheduledEvents(
  transactions: TransactionItem[],
  subscriptions: SubscriptionItem[],
  debts: DebtItem[],
  start: Date,
  end: Date
) {
  const events: ScheduledEvent[] = [];
  const include = (dateValue: string | undefined, event: Omit<ScheduledEvent, 'date'>) => {
    const date = parseDate(dateValue);
    if (!date || date < start || date > end) return;
    events.push({ date: dateKey(date), ...event });
  };

  transactions.forEach((transaction) => {
    const amount = Math.abs(safeNumber(transaction.amount));
    if (!amount) return;
    const assetDelta =
      transaction.type === 'income'
        ? amount
        : transaction.type === 'expense' ||
            transaction.type === 'repayment' ||
            transaction.type === 'budget'
          ? -amount
          : 0;
    if (!assetDelta) return;
    include(transaction.date, {
      assetDelta,
      liabilityDelta: 0,
      label: transaction.type === 'income' ? '计划收入' : '计划支出'
    });
  });

  subscriptions.forEach((subscription) => {
    if (subscription.status === 'paused') return;
    const dueDate = subscription.renewalDate || subscription.expireDate;
    include(dueDate, {
      assetDelta: -Math.abs(safeNumber(subscription.amount)),
      liabilityDelta: 0,
      label: `续费 · ${subscription.name}`
    });
  });

  debts.forEach((debt) => {
    if (debt.status === 'settled' || debt.status === 'closed') return;
    if (debt.entryMode === 'simple') {
      include(debt.simpleDueDate, {
        assetDelta: -Math.abs(safeNumber(debt.simpleAmount)),
        liabilityDelta: 0,
        label: `还款提醒 · ${debt.name}`
      });
      return;
    }

    const manualRepayments = debt.manualRepayments || [];
    const hasExplicitSchedule = manualRepayments.some(
      (repayment) => Boolean(repayment.dueDate) && Math.abs(safeNumber(repayment.amount)) > 0
    );

    manualRepayments.forEach((repayment) => {
      const amount = Math.abs(safeNumber(repayment.amount));
      if (!amount) return;
      include(repayment.dueDate, {
        assetDelta: -amount,
        liabilityDelta: 0,
        debtId: debt.id,
        paymentAmount: amount,
        label: `计划还款 · ${repayment.label || debt.name}`
      });
    });

    if (!hasExplicitSchedule) {
      const repaymentDay = debt.repaymentDay;
      const monthlyPayment = Math.abs(calculateDebtScheduledPayment(debt));
      if (
        typeof repaymentDay !== 'number' ||
        !Number.isInteger(repaymentDay) ||
        repaymentDay < 1 ||
        repaymentDay > 31 ||
        monthlyPayment <= 0
      ) {
        return;
      }

      monthlyRepaymentDates(start, end, repaymentDay).forEach((date) => {
        events.push({
          date: dateKey(date),
          assetDelta: -monthlyPayment,
          liabilityDelta: 0,
          debtId: debt.id,
          paymentAmount: monthlyPayment,
          label: `每月还款 · ${debt.name}`
        });
      });
    }
  });

  return events;
}

export function buildAssetLiabilitySimulation(input: {
  accounts: Account[];
  investmentPositions: InvestmentPosition[];
  transactions: TransactionItem[];
  subscriptions: SubscriptionItem[];
  debts: DebtItem[];
  repaymentRecords?: RepaymentRecord[];
  days?: number;
  now?: Date;
}): AssetLiabilitySimulation {
  const start = startOfDay(input.now || new Date());
  const dayCount = Math.max(7, Math.min(60, Math.floor(input.days || 30)));
  const end = new Date(start);
  end.setDate(end.getDate() + dayCount - 1);
  const accounts = accountBalances(input.accounts);
  const initialAssets =
    accounts.assets +
    input.investmentPositions
      .filter((position) => position.isActive)
      .reduce((sum, position) => sum + Math.max(0, safeNumber(position.currentValue)), 0);
  const initialLiabilities =
    accounts.liabilities +
    input.debts
      .filter(
        (debt) =>
          debt.entryMode !== 'simple' && debt.status !== 'settled' && debt.status !== 'closed'
      )
      .reduce((sum, debt) => sum + Math.max(0, safeNumber(debt.balance)), 0);
  const projectedDebts = new Map(
    input.debts
      .filter(
        (debt) =>
          debt.entryMode !== 'simple' && debt.status !== 'settled' && debt.status !== 'closed'
      )
      .map((debt) => [debt.id, Math.max(0, safeNumber(debt.balance))])
  );
  const debtById = new Map(input.debts.map((debt) => [debt.id, debt]));
  const scheduledEvents = buildScheduledEvents(
    input.transactions,
    input.subscriptions,
    input.debts,
    start,
    end
  );
  const eventsByDate = new Map<string, ScheduledEvent[]>();
  scheduledEvents.forEach((event) => {
    const bucket = eventsByDate.get(event.date) || [];
    bucket.push(event);
    eventsByDate.set(event.date, bucket);
  });

  let assets = initialAssets;
  let liabilities = initialLiabilities;
  let previousNetWorth = assets - liabilities;
  const rows: AssetLiabilitySimulationRow[] = [];

  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    const dayEvents = eventsByDate.get(key) || [];
    const assetDelta = dayEvents.reduce((sum, event) => sum + event.assetDelta, 0);
    const liabilityDelta = dayEvents.reduce((sum, event) => {
      if (!event.debtId || !event.paymentAmount) {
        return sum + event.liabilityDelta;
      }

      const debt = debtById.get(event.debtId);
      const outstanding = projectedDebts.get(event.debtId) || 0;
      if (!debt || outstanding <= 0) return sum;

      const annualRate = Math.max(0, safeNumber(calculateDebtDerivedMetrics(debt).annualRate));
      const monthlyInterest = outstanding * (annualRate / 100 / 12);
      const principalReduction = Math.min(
        outstanding,
        Math.max(0, event.paymentAmount - monthlyInterest)
      );
      projectedDebts.set(event.debtId, outstanding - principalReduction);
      return sum - principalReduction;
    }, 0);
    const projectedDebtTotal = Array.from(projectedDebts.values()).reduce(
      (sum, balance) => sum + balance,
      0
    );
    assets = Math.max(0, assets + assetDelta);
    liabilities = Math.max(0, accounts.liabilities + projectedDebtTotal);
    const netWorth = assets - liabilities;
    rows.push({
      key,
      date: key,
      label: `${date.getMonth() + 1}月${date.getDate()}日`,
      weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      assets,
      liabilities,
      netWorth,
      delta: netWorth - previousNetWorth,
      assetDelta,
      liabilityDelta,
      events: dayEvents.map((event) => event.label)
    });
    previousNetWorth = netWorth;
  }

  return {
    rows,
    initialAssets,
    initialLiabilities,
    hasEvents: scheduledEvents.length > 0
  };
}
