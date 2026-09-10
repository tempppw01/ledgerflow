import type { Account } from '../../../entities/account/types';
import type {
  InvestmentPosition,
  InvestmentPositionHistoryEntry
} from '../../../entities/investment/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import type { DebtItem, RepaymentRecord } from '../../debt/model/debtMetrics';

export interface NetWorthTrendRow {
  key: string;
  label: string;
  value: number;
  dateFrom: string;
  dateTo: string;
  hasTransactions: boolean;
  isEstimated: boolean;
  isCurrent?: boolean;
}

export interface NetWorthBreakdown {
  accountBalance: number;
  investmentValue: number;
  debtBalance: number;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthEnd(year: number, month: number) {
  return new Date(year, month + 1, 0);
}

function amount(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function isLiabilityAccount(account: Account) {
  if (account.type === 'credit' || account.type === 'liability') return true;
  const name = String(account.name || '').toLowerCase();
  return ['信用卡', '花呗', '白条', '借呗', '欠款', '负债', 'credit', 'visa', 'master'].some(
    (keyword) => name.includes(keyword.toLowerCase())
  );
}

function accountNet(accounts: Account[]) {
  return accounts.reduce((sum, account) => {
    const balance = amount(account.balance ?? account.initialBalance);
    return sum + (isLiabilityAccount(account) ? -Math.abs(balance) : balance);
  }, 0);
}

function investmentValue(positions: InvestmentPosition[]) {
  return positions
    .filter((item) => item.isActive)
    .reduce((sum, item) => sum + Math.max(0, amount(item.currentValue)), 0);
}

function debtValue(debts: DebtItem[]) {
  return debts
    .filter((item) => item.entryMode !== 'simple' && item.status !== 'settled' && item.status !== 'closed')
    .reduce((sum, item) => sum + Math.max(0, amount(item.balance)), 0);
}

function transactionNet(rows: TransactionItem[]) {
  return rows.reduce((sum, item) => {
    if (item.type === 'income') return sum + amount(item.amount);
    if (item.type === 'expense' || item.type === 'repayment' || item.type === 'budget') {
      return sum - amount(item.amount);
    }
    return sum;
  }, 0);
}

export function buildNetWorthTrend(input: {
  accounts: Account[];
  transactions: TransactionItem[];
  investmentPositions: InvestmentPosition[];
  investmentHistory?: InvestmentPositionHistoryEntry[];
  debts: DebtItem[];
  repaymentRecords?: RepaymentRecord[];
  months?: number;
  now?: Date;
}): { rows: NetWorthTrendRow[]; currentValue: number; hasEstimate: boolean; breakdown: NetWorthBreakdown } {
  const now = input.now || new Date();
  const monthCount = Math.max(3, Math.min(12, input.months || 6));
  const currentKey = monthKey(now);
  const currentAccountNet = accountNet(input.accounts);
  const currentInvestments = investmentValue(input.investmentPositions);
  const currentDebts = debtValue(input.debts);
  const currentValue = currentAccountNet + currentInvestments - currentDebts;
  const monthlyNet = new Map<string, number>();
  input.transactions.forEach((item) => {
    const date = new Date(item.date);
    if (!Number.isNaN(date.getTime())) {
      const key = monthKey(date);
      monthlyNet.set(key, (monthlyNet.get(key) || 0) + transactionNet([item]));
    }
  });

  const historyByMonth = new Map<string, number>();
  (input.investmentHistory || []).forEach((item) => {
    const date = new Date(item.createdAt);
    if (!Number.isNaN(date.getTime())) {
      const key = monthKey(date);
      historyByMonth.set(key, (historyByMonth.get(key) || 0) + Math.max(0, amount(item.currentValue)));
    }
  });

  const rows: NetWorthTrendRow[] = [];
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = monthKey(date);
    const end = monthEnd(date.getFullYear(), date.getMonth());
    const endKey = monthKey(end);
    const postMonthNet = Array.from(monthlyNet.entries()).reduce((sum, [month, net]) => {
      return month > key && month <= currentKey ? sum + net : sum;
    }, 0);
    const investmentAtMonth = historyByMonth.get(endKey);
    const hasInvestmentHistory = typeof investmentAtMonth === 'number';
    const futureRepayments = (input.repaymentRecords || []).reduce((sum, record) => {
      const paidAt = new Date(record.paidAt);
      return paidAt > end ? sum + Math.max(0, amount(record.amount)) : sum;
    }, 0);
    const value =
      currentAccountNet -
      postMonthNet +
      (hasInvestmentHistory ? investmentAtMonth : currentInvestments) -
      (currentDebts + futureRepayments);
    rows.push({
      key,
      label: date.getFullYear() === now.getFullYear() ? `${date.getMonth() + 1}月` : `${String(date.getFullYear()).slice(-2)}年${date.getMonth() + 1}月`,
      value,
      dateFrom: `${key}-01`,
      dateTo: end.toISOString().slice(0, 10),
      hasTransactions: (monthlyNet.get(key) || 0) !== 0 || hasInvestmentHistory,
      isEstimated: !hasInvestmentHistory,
      isCurrent: key === currentKey
    });
  }

  return {
    rows,
    currentValue,
    hasEstimate: rows.some((row) => row.isEstimated),
    breakdown: {
      accountBalance: currentAccountNet,
      investmentValue: currentInvestments,
      debtBalance: currentDebts
    }
  };
}
