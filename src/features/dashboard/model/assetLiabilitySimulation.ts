import type { Account } from '../../../entities/account/types';
import type { InvestmentPosition } from '../../../entities/investment/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import type { SubscriptionItem } from '../../../entities/subscription/types';
import type { ForecastBill } from '../../../entities/forecast/types';
import {
  calculateDebtDerivedMetrics,
  calculateDebtScheduledPayment,
  type DebtItem,
  type RepaymentRecord
} from '../../debt/model/debtMetrics';

/**
 * 这一天为什么动:每种来源单独一种 kind,由界面负责翻成当前语言。
 * 模型层不拼中文,否则英文界面会把「续费 · 中国移动」这类中文直接露出来。
 */
export type SimulationEventKind =
  | 'plannedIncome'
  | 'plannedExpense'
  | 'subscription'
  | 'debtReminder'
  | 'plannedRepayment'
  | 'monthlyRepayment'
  | 'forecastIncome'
  | 'forecastExpense';

export interface SimulationEvent {
  kind: SimulationEventKind;
  /** 续费/还款/预测账单会带上具体名称,计划收支没有。 */
  name?: string;
  /** 月视图里同一条事件当月出现几次;单日行不带这个字段。 */
  count?: number;
}

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
  events: SimulationEvent[];
  /** 当天由「预测账单」造成的资产变化合计(收入为正、支出为负)。 */
  forecastDelta: number;
  /** 当天命中的预测账单 id,用于按账单统计本期发生次数。 */
  forecastBillIds: string[];
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
  kind: SimulationEventKind;
  name?: string;
  debtId?: string;
  paymentAmount?: number;
  /** 这条事件来自用户录入的预测账单,而非已有流水/订阅/还款。 */
  forecast?: boolean;
  forecastBillId?: string;
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
  end: Date,
  forecastBills: ForecastBill[] = []
) {
  const events: ScheduledEvent[] = [];
  const include = (dateValue: string | undefined, event: Omit<ScheduledEvent, 'date'>) => {
    const date = parseDate(dateValue);
    if (!date || date < start || date > end) return;
    events.push({ date: dateKey(date), ...event });
  };

  // 用户自己录入的预测账单。monthly 的按「每月同日」展开到预测区间末尾;
  // 首次发生日之前的若干月没有账单,所以从 max(账单日期, 区间起点) 开始铺。
  forecastBills.forEach((bill) => {
    const amount = Math.abs(safeNumber(bill.amount));
    const first = parseDate(bill.date);
    if (!amount || !first) return;
    const assetDelta = bill.direction === 'income' ? amount : -amount;
    const kind: SimulationEventKind =
      bill.direction === 'income' ? 'forecastIncome' : 'forecastExpense';

    if (bill.repeat !== 'monthly') {
      include(bill.date, {
        assetDelta,
        liabilityDelta: 0,
        kind,
        name: bill.name,
        forecast: true,
        forecastBillId: bill.id
      });
      return;
    }

    const anchorDay = first.getDate();
    const from = first > start ? first : start;
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cursor <= end) {
      const date = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        clampDayInMonth(cursor.getFullYear(), cursor.getMonth(), anchorDay)
      );
      if (date >= first && date >= start && date <= end) {
        events.push({
          date: dateKey(date),
          assetDelta,
          liabilityDelta: 0,
          kind,
          name: bill.name,
          forecast: true,
          forecastBillId: bill.id
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  });

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
      kind: transaction.type === 'income' ? 'plannedIncome' : 'plannedExpense'
    });
  });

  subscriptions.forEach((subscription) => {
    if (subscription.status === 'paused') return;
    const dueDate = subscription.renewalDate || subscription.expireDate;
    include(dueDate, {
      assetDelta: -Math.abs(safeNumber(subscription.amount)),
      liabilityDelta: 0,
      kind: 'subscription',
      name: subscription.name
    });
  });

  debts.forEach((debt) => {
    if (debt.status === 'settled' || debt.status === 'closed') return;
    if (debt.entryMode === 'simple') {
      include(debt.simpleDueDate, {
        assetDelta: -Math.abs(safeNumber(debt.simpleAmount)),
        liabilityDelta: 0,
        kind: 'debtReminder',
        name: debt.name
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
        kind: 'plannedRepayment',
        name: repayment.label || debt.name
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
          kind: 'monthlyRepayment',
          name: debt.name
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
  /** 用户自己录入的预测账单;不参与余额计算,只影响这次推演。 */
  forecastBills?: ForecastBill[];
  days?: number;
  now?: Date;
}): AssetLiabilitySimulation {
  const start = startOfDay(input.now || new Date());
  const dayCount = Math.max(7, Math.min(365, Math.floor(input.days || 30)));
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
    end,
    input.forecastBills
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
      events: dayEvents.map((event) => ({ kind: event.kind, name: event.name })),
      forecastDelta: dayEvents.reduce(
        (sum, event) => (event.forecast ? sum + event.assetDelta : sum),
        0
      ),
      forecastBillIds: dayEvents
        .map((event) => event.forecastBillId)
        .filter((id): id is string => Boolean(id))
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

/**
 * 预测账单与「当前推演窗口」的关系。
 *
 * 为什么要有这层分类:窗口外的账单在列表里照常显示、还计入「净影响」,
 * 但日历一个格子都不会变 —— 用户看到的现象就是「录入了账单,日历没反应」。
 * 计算放在模型层,界面只负责把它翻成文案。
 */
export interface ForecastBillWindowStatus {
  /** 落在当前窗口内、日历上能看到的账单 id。 */
  visibleIds: string[];
  /** 在当前窗口内一次都不会发生(且日期合法)。 */
  outOfWindowIds: string[];
  /** 日期放在最长区间(12 个月 = 365 天)内也不可见 —— 提示「切到 12 个月」对它们没用。 */
  unreachableIds: string[];
  /** 校验过的窗口起止(YYYY-MM-DD);rows 为空时是空串。 */
  windowStart: string;
  windowEnd: string;
}

export function classifyForecastBillsByWindow(
  rows: AssetLiabilitySimulationRow[],
  forecastBills: ForecastBill[] = [],
  /** 账单 id → 在窗口内实际发生次数(来自推演行)。0/缺失即窗口外。 */
  occurrences: Record<string, number> = {}
): ForecastBillWindowStatus {
  const windowStart = rows[0]?.date || '';
  const windowEnd = rows.at(-1)?.date || '';

  // 最长可选区间是 12 个月,而天数写成 months * 30 —— 12 个月即 360 天。
  // 这里按 365 天算,宁可把「12 个月能看到」说宽一点,也不要漏报。
  const longestWindowEnd = (() => {
    if (!windowStart) return '';
    const end = new Date(`${windowStart}T00:00:00`);
    if (Number.isNaN(end.getTime())) return '';
    end.setDate(end.getDate() + 364);
    return dateKey(end);
  })();

  const visibleIds: string[] = [];
  const outOfWindowIds: string[] = [];
  const unreachableIds: string[] = [];

  forecastBills.forEach((bill) => {
    // 可见与否以**推演结果**为准,不能只看日期:周期性的「每月」账单首次发生日可能在
    // 更早的月份,它当期仍然要出现在日历上。
    if (occurrences[bill.id]) {
      visibleIds.push(bill.id);
      return;
    }

    outOfWindowIds.push(bill.id);

    const date = String(bill.date || '').slice(0, 10);
    const isValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!isValid || !longestWindowEnd || date > longestWindowEnd) {
      unreachableIds.push(bill.id);
    }
  });

  return { visibleIds, outOfWindowIds, unreachableIds, windowStart, windowEnd };
}

/** 同一个 (kind, name) 合并成一条并记次数:一个月里同一条订阅只写一行「×N」。 */
function mergeEvents(events: SimulationEvent[]): SimulationEvent[] {
  const merged: SimulationEvent[] = [];
  events.forEach((event) => {
    const hit = merged.find((item) => item.kind === event.kind && item.name === event.name);
    if (hit) hit.count = (hit.count || 1) + 1;
    else merged.push({ ...event });
  });
  return merged;
}

/**
 * 把逐日推演行压成「每月一格」。
 *
 * 月视图原先直接取当月最后一天的 delta,于是只要安排不在月末那天发生,
 * 整列就全是 0(12 个月概览里 12 个格子全是 0,和折线一路下滑自相矛盾)。
 * 这里把当月所有天的变化累加,日期/快照仍取月末那天:
 * 于是 delta === 本月末净资产 − 上月末净资产,和折线保持同一口径。
 */
export function aggregateRowsByMonth(
  rows: AssetLiabilitySimulationRow[]
): AssetLiabilitySimulationRow[] {
  const aggregated: AssetLiabilitySimulationRow[] = [];

  rows.forEach((row) => {
    const month = row.date.slice(0, 7);
    const current = aggregated.at(-1);
    if (!current || current.date.slice(0, 7) !== month) {
      aggregated.push({ ...row, events: [...row.events] });
      return;
    }

    // 同一月份:快照换成更晚的那天,金额类字段累加,事件合并去重。
    current.key = row.key;
    current.date = row.date;
    current.label = row.label;
    current.weekday = row.weekday;
    current.assets = row.assets;
    current.liabilities = row.liabilities;
    current.netWorth = row.netWorth;
    current.delta += row.delta;
    current.assetDelta += row.assetDelta;
    current.liabilityDelta += row.liabilityDelta;
    current.forecastDelta += row.forecastDelta;
    current.events = mergeEvents([...current.events, ...row.events]);
    current.forecastBillIds = [...new Set([...current.forecastBillIds, ...row.forecastBillIds])];
  });

  return aggregated;
}
