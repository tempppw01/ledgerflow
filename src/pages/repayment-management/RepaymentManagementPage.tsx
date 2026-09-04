import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import {
  calculateDebtDerivedMetrics,
  calculateDebtHealthScore,
  calculateDebtMinimumPayment,
  calculateDebtSummary,
  DebtItem,
  DebtLifecycleStatus,
  DebtRepaymentMethod,
  DebtRepaymentRecordMode,
  DebtType,
  ManualRepaymentItem
} from '../../features/debt/model/debtMetrics';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { IMAGE_ICON_URL } from '../../shared/config/brandAssets';
import { formatCurrency } from '../../shared/lib/format';
import { Toast } from '../../shared/ui/Toast';
import { RepaymentDashboard } from '../../features/debt/components/RepaymentDashboard';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const REPAYMENT_CACHE_KEY = 'ledgerflow-repayment-advice-cache-v1';
const MONTHLY_INCOME_CACHE_KEY = 'ledgerflow-repayment-income-cache-v1';
const INCOME_SAMPLE_LIMIT = 120;

interface RepaymentAdviceCacheItem {
  key: string;
  advice: string;
  reasoning: string;
  createdAt: string;
}

type RepaymentAdviceCache = Record<string, RepaymentAdviceCacheItem>;

interface MonthlyIncomeCacheItem {
  key: string;
  value: number;
  reasoning: string;
  createdAt: string;
}

type MonthlyIncomeCache = Record<string, MonthlyIncomeCacheItem>;

type ParsedDebtItem = {
  name: string;
  type: DebtType;
  balance: number;
  annualRate?: number;
  remainingMonths?: number;
};

type RepaymentPrefillDebt = {
  name?: string;
  type?: DebtType;
  balance?: string;
  annualRate?: string;
  remainingMonths?: string;
  totalPeriods?: string;
  paidPeriods?: string;
  loanPrincipal?: string;
  totalRepayment?: string;
  repaymentDay?: string;
  paymentAccount?: string;
  source?: string;
};

type RepaymentStrategyType = 'avalanche' | 'snowball' | 'ladder';

type DebtPlanMode = 'structured' | 'manual';
type DebtEntryMode = 'standard' | 'simple';

function createEmptyManualRepayment(previous?: ManualRepaymentItem): ManualRepaymentItem {
  const today = new Date();
  const baseDate =
    previous?.dueDate && !Number.isNaN(new Date(previous.dueDate).getTime())
      ? new Date(previous.dueDate)
      : today;
  const nextDueDate = shiftMonthWithDay(baseDate, 1, getDebtRepaymentDayFallback(baseDate));

  return {
    id: `manual-repayment-temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dueDate: toISODate(nextDueDate),
    amount: previous ? Math.max(0, Number(previous.amount) || 0) : 0,
    label: ''
  };
}

function getDebtRepaymentDayFallback(value: Date): number {
  return value.getDate();
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

function buildDebtPressureSchedule(
  debt: DebtItem
): Array<{ period: string; dueDate: string; amount: number; remaining: number }> {
  const balance = Math.max(0, Number(debt.balance) || 0);
  const manualRows = Array.isArray(debt.manualRepayments)
    ? debt.manualRepayments
        .map((item) => ({
          ...item,
          amount: Math.max(0, Number(item.amount) || 0)
        }))
        .filter((item) => item.amount > 0)
        .sort((a, b) => {
          const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          return aTime - bTime;
        })
    : [];

  let rows = manualRows;
  if (rows.length === 0) {
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
    const start = new Date();
    const day = typeof debt.repaymentDay === 'number' ? debt.repaymentDay : start.getDate();
    rows = Array.from({ length: safeMonthCount }, (_, index) => ({
      amount: monthlyPayment,
      dueDate: toISODate(shiftMonthWithDay(start, index, day))
    }));
  }

  let remaining = balance;
  return rows.slice(0, 36).map((item, index) => {
    remaining = Math.max(0, remaining - item.amount);
    return {
      period: `第 ${index + 1} 期`,
      dueDate: item.dueDate || '日期待填',
      amount: Number(item.amount.toFixed(2)),
      remaining: Number(remaining.toFixed(2))
    };
  });
}

function formatShortDate(dateValue: string): string {
  if (!dateValue || dateValue === '日期待填') return dateValue;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function DebtPressureChart({
  points
}: {
  points: Array<{ period: string; dueDate: string; amount: number; remaining: number }>;
}) {
  const width = 680;
  const height = 200;
  const paddingX = 44;
  const paddingY = 24;
  const maxAmount = Math.max(1, ...points.map((item) => item.amount));
  const maxRemaining = Math.max(1, ...points.map((item) => item.remaining));

  if (points.length === 0) {
    return (
      <div className="debt-pressure-empty">
        暂无足够的计划数据，请填写还款日期和金额后再查看曲线。
      </div>
    );
  }

  const xFor = (index: number) =>
    points.length === 1
      ? width / 2
      : paddingX + ((width - paddingX * 2) * index) / (points.length - 1);
  const yForAmount = (value: number) =>
    height - paddingY - ((value / maxAmount) * (height - paddingY * 2));
  const yForRemaining = (value: number) =>
    paddingY + ((value / maxRemaining) * (height - paddingY * 2));
  const amountPoints = points
    .map((item, index) => `${xFor(index)},${yForAmount(item.amount)}`)
    .join(' ');
  const remainingPoints = points
    .map((item, index) => `${xFor(index)},${yForRemaining(item.remaining)}`)
    .join(' ');

  return (
    <div className="debt-pressure-chart">
      <svg
        role="img"
        aria-label="还款压力曲线"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <line
          x1={paddingX}
          y1={height - paddingY}
          x2={width - paddingX}
          y2={height - paddingY}
          className="debt-pressure-axis"
        />
        <polyline points={amountPoints} className="debt-pressure-amount-line" />
        <polyline points={remainingPoints} className="debt-pressure-remaining-line" />
        {points.map((item, index) => (
          <circle
            key={`${item.period}-${item.dueDate}-${index}`}
            cx={xFor(index)}
            cy={yForAmount(item.amount)}
            r={3}
            className="debt-pressure-amount-dot"
          />
        ))}
      </svg>
      <div className="debt-pressure-legend">
        <span>
          <i className="amount" />
          每期还款
        </span>
        <span>
          <i className="remaining" />
          剩余本金
        </span>
      </div>
    </div>
  );
}

type RepaymentDebtStatusTone = 'safe' | 'warning' | 'danger' | 'muted';

const REPAYMENT_STRATEGY_LABELS: Record<RepaymentStrategyType, string> = {
  avalanche: '雪崩法（先高利率）',
  snowball: '雪球法（先小余额）',
  ladder: '阶梯法（利率与余额加权）'
};

const REPAYMENT_METHOD_LABELS: Record<DebtRepaymentMethod, string> = {
  'minimum-payment': '最低还款',
  'equal-installment': '等额本息',
  'equal-principal': '等额本金',
  custom: '自定义'
};

const REPAYMENT_RECORD_MODE_LABELS: Record<DebtRepaymentRecordMode, string> = {
  manual: '手动登记',
  'transaction-match': '交易匹配',
  'auto-debit': '自动扣款'
};

function estimateRemainingPrincipal(input: {
  loanPrincipal: number;
  totalPeriods: number;
  paidPeriods: number;
  annualRate?: number;
  repaymentMethod: DebtRepaymentMethod;
}): number | null {
  const principal = Number(input.loanPrincipal);
  const total = Math.floor(Number(input.totalPeriods));
  const paid = Math.floor(Number(input.paidPeriods));
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isInteger(total) || total <= 0) {
    return null;
  }
  const completed = Math.min(total, Math.max(0, Number.isFinite(paid) ? paid : 0));
  const remaining = total - completed;
  if (remaining <= 0) return 0;

  // 有明确年化利率时按等额本息摊销，否则用本金按期数比例估算，避免伪造精确利息。
  const monthlyRate = Number(input.annualRate || 0) / 12 / 100;
  if (input.repaymentMethod === 'equal-installment' && monthlyRate > 0) {
    const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, total)) /
      (Math.pow(1 + monthlyRate, total) - 1);
    const balance = principal * Math.pow(1 + monthlyRate, completed) -
      payment * ((Math.pow(1 + monthlyRate, completed) - 1) / monthlyRate);
    return Math.max(0, Math.round(balance * 100) / 100);
  }
  return Math.max(0, Math.round((principal * remaining / total) * 100) / 100);
}

const DEBT_STATUS_LABELS: Record<DebtLifecycleStatus, string> = {
  active: '进行中',
  settled: '已结清',
  closed: '已关闭',
  paused: '暂缓处理'
};

function normalizeDebtLifecycleStatus(
  status: DebtItem['status'],
  balance: number
): DebtLifecycleStatus {
  if (status === 'settled' || status === 'closed' || status === 'paused' || status === 'active') {
    return status;
  }
  return balance <= 0 ? 'settled' : 'active';
}

function isDebtInactive(status: DebtLifecycleStatus): boolean {
  return status === 'settled' || status === 'closed' || status === 'paused';
}

function isSimpleRepaymentReminder(item?: DebtItem): boolean {
  return item?.entryMode === 'simple';
}

function getSimpleReminderDueDate(item: DebtItem): Date | null {
  if (!item.simpleDueDate) return null;
  const value = new Date(`${item.simpleDueDate}T${item.simpleDueTime || '00:00'}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function getCalendarDayDifference(from: Date, to: Date): number {
  const startOfFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const startOfTo = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((startOfTo.getTime() - startOfFrom.getTime()) / (1000 * 60 * 60 * 24));
}

function buildRepaymentSnapshotKey(input: {
  monthlyIncome: number;
  debts: {
    name: string;
    type: DebtType;
    balance: number;
    annualRate?: number;
    remainingMonths?: number;
  }[];
  model: string;
}): string {
  const normalizedDebts = [...input.debts]
    .map((item) => ({
      name: item.name.trim(),
      type: item.type,
      balance: Number(item.balance.toFixed(2)),
      annualRate: Number((item.annualRate || 0).toFixed(4)),
      remainingMonths: Math.max(0, Math.floor(item.remainingMonths || 0))
    }))
    .sort((a, b) => `${a.type}-${a.name}`.localeCompare(`${b.type}-${b.name}`, 'zh-CN'));

  return JSON.stringify({
    monthlyIncome: Number(input.monthlyIncome.toFixed(2)),
    model: input.model.trim(),
    debts: normalizedDebts
  });
}

function buildIncomeSnapshotKey(input: {
  model: string;
  transactions: { date: string; type: string; amount: number; note: string }[];
}): string {
  return JSON.stringify({
    model: input.model.trim(),
    transactions: input.transactions
      .map((item) => ({
        date: item.date,
        type: item.type,
        amount: Number(item.amount.toFixed(2)),
        note: item.note.trim()
      }))
      .sort((a, b) => `${a.date}-${a.amount}`.localeCompare(`${b.date}-${b.amount}`, 'zh-CN'))
  });
}

function readCache(): RepaymentAdviceCache {
  try {
    const raw = window.localStorage.getItem(REPAYMENT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as RepaymentAdviceCache;
  } catch {
    return {};
  }
}

function writeCache(next: RepaymentAdviceCache) {
  try {
    window.localStorage.setItem(REPAYMENT_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function readIncomeCache(): MonthlyIncomeCache {
  try {
    const raw = window.localStorage.getItem(MONTHLY_INCOME_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as MonthlyIncomeCache;
  } catch {
    return {};
  }
}

function writeIncomeCache(next: MonthlyIncomeCache) {
  try {
    window.localStorage.setItem(MONTHLY_INCOME_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败，请重试。'));
    reader.readAsDataURL(file);
  });
}

function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  return content;
}

function normalizeDebtType(value: unknown): DebtType {
  if (value === 'huabei' || value === 'consumer-loan') return 'consumer-loan';
  if (value === 'credit-card' || value === 'loan') return value;
  return 'credit-card';
}

function parseDebtExtraction(content: string): { monthlyIncome?: number; debts: ParsedDebtItem[] } {
  const parsed = JSON.parse(extractJsonObject(content)) as {
    monthlyIncome?: unknown;
    debts?: unknown;
  };

  const debts = Array.isArray(parsed.debts)
    ? parsed.debts
        .map((item): ParsedDebtItem | null => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          const name = String(row.name || '').trim();
          const balance = Number(row.balance || 0);
          if (!name || !Number.isFinite(balance) || balance <= 0) return null;

          const type = normalizeDebtType(row.type);
          const annualRateValue = Number(row.annualRate || 0);
          const annualRate =
            type === 'loan' && Number.isFinite(annualRateValue) && annualRateValue >= 0
              ? annualRateValue
              : undefined;
          const monthValue = Math.floor(Number(row.remainingMonths || 0));
          const remainingMonths =
            type === 'loan' && Number.isFinite(monthValue) && monthValue > 0 ? monthValue : 12;

          return {
            name,
            type,
            balance,
            annualRate,
            remainingMonths: type === 'loan' ? remainingMonths : undefined
          };
        })
        .filter((item): item is ParsedDebtItem => item !== null)
    : [];

  const income = Number(parsed.monthlyIncome || 0);
  return {
    monthlyIncome: Number.isFinite(income) && income >= 0 ? income : undefined,
    debts
  };
}

function parseIncomeExtraction(content: string): { monthlyIncome?: number; reasoning: string } {
  const parsed = JSON.parse(extractJsonObject(content)) as {
    monthlyIncome?: unknown;
    reasoning?: unknown;
  };
  const income = Number(parsed.monthlyIncome || 0);
  return {
    monthlyIncome: Number.isFinite(income) && income > 0 ? income : undefined,
    reasoning: String(parsed.reasoning || '').trim()
  };
}

function renderAiStructuredText(content: string): JSX.Element[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''));

  const nodes: JSX.Element[] = [];
  let listBuffer: string[] = [];
  let listOrdered = false;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    if (listOrdered) {
      nodes.push(
        <ol key={`ol-${nodes.length}`} className="finance-ai-rich-list">
          {listBuffer.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ol>
      );
    } else {
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="finance-ai-rich-list">
          {listBuffer.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      );
    }
    listBuffer = [];
    listOrdered = false;
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      flushList();
      return;
    }

    const heading3 = line.match(/^###\s+(.+)/);
    const heading2 = line.match(/^##\s+(.+)/);
    const heading1 = line.match(/^#\s+(.+)/);
    const ordered = line.match(/^\d+[.、)]\s+(.+)/);
    const unordered = line.match(/^[-*•]\s+(.+)/);

    if (heading3 || heading2 || heading1) {
      flushList();
      const text = heading3?.[1] || heading2?.[1] || heading1?.[1] || line;
      nodes.push(
        <h4 key={`h-${index}`} className="finance-ai-rich-title">
          {text}
        </h4>
      );
      return;
    }

    if (ordered) {
      if (listBuffer.length > 0 && !listOrdered) {
        flushList();
      }
      listOrdered = true;
      listBuffer.push(ordered[1]);
      return;
    }

    if (unordered) {
      if (listBuffer.length > 0 && listOrdered) {
        flushList();
      }
      listOrdered = false;
      listBuffer.push(unordered[1]);
      return;
    }

    flushList();
    nodes.push(
      <p key={`p-${index}`} className="finance-ai-rich-paragraph">
        {line}
      </p>
    );
  });

  flushList();
  return nodes;
}

function getPressureLevel(ratio: number): {
  tone: 'safe' | 'warning' | 'danger';
  label: string;
} {
  if (ratio < 0.3) {
    return { tone: 'safe', label: '健康' };
  }
  if (ratio < 0.6) {
    return { tone: 'warning', label: '关注' };
  }
  return { tone: 'danger', label: '偏高' };
}

function getDebtAssumedAnnualRate(
  type: DebtType,
  annualRate?: number,
  loanPrincipal?: number,
  totalRepayment?: number,
  totalPeriods?: number
): number {
  if (type === 'loan') {
    const explicit = Math.max(0, Number(annualRate || 0));
    if (explicit > 0) {
      return explicit;
    }
    const principal = Number(loanPrincipal || 0);
    const total = Number(totalRepayment || 0);
    const periods = Number(totalPeriods || 0);
    if (principal > 0 && total > principal && periods > 0) {
      const inferred = ((total - principal) / principal) * (12 / periods) * 100;
      return Number.isFinite(inferred) && inferred > 0 ? inferred : 0;
    }
    return 0;
  }
  return type === 'credit-card' ? 18 : 12;
}

function getStrategySortedDebts<T extends { annualRate: number; balance: number }>(
  debts: T[],
  strategy: RepaymentStrategyType
): T[] {
  if (strategy === 'snowball') {
    return [...debts].sort((a, b) => a.balance - b.balance || b.annualRate - a.annualRate);
  }
  if (strategy === 'ladder') {
    return [...debts].sort((a, b) => {
      const scoreA = a.annualRate * 0.65 + (1 / Math.max(1, a.balance)) * 1000;
      const scoreB = b.annualRate * 0.65 + (1 / Math.max(1, b.balance)) * 1000;
      return scoreB - scoreA;
    });
  }
  return [...debts].sort((a, b) => b.annualRate - a.annualRate || a.balance - b.balance);
}

type RepaymentContextSnapshot = {
  debtId: string;
  debtName: string;
  plannedPaymentAccount?: string;
  plannedRepaymentDay?: number;
  actualPaymentAccounts: string[];
  actualRepaymentCount: number;
  latestActualRepaymentAt?: string;
};

type DebtRiskTagTone = 'info' | 'warning' | 'danger';

type DebtRiskTag = {
  id: string;
  debtId?: string;
  label: string;
  tone: DebtRiskTagTone;
  explanation: string;
  dimension: 'rate' | 'schedule' | 'account' | 'actual' | 'data';
};

function simulateRepaymentPlan(input: {
  debts: {
    id: string;
    name: string;
    type: DebtType;
    balance: number;
    annualRate?: number;
    loanPrincipal?: number;
    totalRepayment?: number;
    totalPeriods?: number;
  }[];
  extraPayment: number;
  strategy: RepaymentStrategyType;
}): { months: number; totalInterest: number } {
  const snapshot = input.debts
    .map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      balance: Math.max(0, Number(item.balance) || 0),
      annualRate: getDebtAssumedAnnualRate(
        item.type,
        item.annualRate,
        item.loanPrincipal,
        item.totalRepayment,
        item.totalPeriods
      )
    }))
    .filter((item) => item.balance > 0);

  if (snapshot.length === 0) {
    return { months: 0, totalInterest: 0 };
  }

  let months = 0;
  let totalInterest = 0;
  const maxMonths = 1200;

  while (months < maxMonths && snapshot.some((item) => item.balance > 0.01)) {
    months += 1;

    for (const debt of snapshot) {
      if (debt.balance <= 0) continue;
      const monthlyRate = debt.annualRate / 12 / 100;
      const interest = debt.balance * monthlyRate;
      if (interest > 0) {
        debt.balance += interest;
        totalInterest += interest;
      }
    }

    let totalPaymentBudget =
      snapshot.reduce(
        (sum, debt) => sum + calculateDebtMinimumPayment({ ...debt, remainingMonths: 12 }),
        0
      ) + Math.max(0, input.extraPayment);

    for (const debt of snapshot) {
      if (debt.balance <= 0 || totalPaymentBudget <= 0) continue;
      const minPay = Math.min(
        debt.balance,
        calculateDebtMinimumPayment({ ...debt, remainingMonths: 12 })
      );
      debt.balance -= minPay;
      totalPaymentBudget -= minPay;
    }

    const strategySortedDebts = getStrategySortedDebts(snapshot, input.strategy);
    for (const debt of strategySortedDebts) {
      if (debt.balance <= 0 || totalPaymentBudget <= 0) continue;
      const extra = Math.min(debt.balance, totalPaymentBudget);
      debt.balance -= extra;
      totalPaymentBudget -= extra;
    }
  }

  return {
    months,
    totalInterest
  };
}

function RepaymentUnitInput(props: {
  value: string;
  onChange: (value: string) => void;
  unit: string;
  placeholder: string;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: string | number;
  inputMode?: 'decimal' | 'numeric';
  disabled?: boolean;
}) {
  const { value, onChange, unit, ariaLabel, min, max, step, inputMode, disabled } = props;
  return (
    <label
      className={`finance-unit-input ${disabled ? 'is-disabled' : ''} ${value.trim() ? 'is-filled' : ''}`}
    >
      <span className="finance-input-floating-label">{ariaLabel}</span>
      <input
        className="finance-debt-form-control"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder=""
        aria-label={ariaLabel}
        disabled={disabled}
      />
      <span>{unit}</span>
    </label>
  );
}

export function RepaymentManagementPage() {
  const location = useLocation();
  const {
    debts,
    repaymentRecords,
    monthlyIncome,
    setMonthlyIncome,
    addDebt,
    addRepaymentRecord,
    replaceDebts,
    removeDebt,
    removeRepaymentRecord,
    updateDebt
  } = useAppPreferences();
  const { baseUrl, apiKey, model } = useAiSettings();
  const transactions = useFinanceStore((state) => state.transactions);
  const financeAccounts = useFinanceStore((state) => state.accounts || []);
  const [error, setError] = useState('');
  const [debtName, setDebtName] = useState('');
  const [debtEntryMode, setDebtEntryMode] = useState<DebtEntryMode>('standard');
  const [simpleDueDate, setSimpleDueDate] = useState('');
  const [simpleDueTime, setSimpleDueTime] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('credit-card');
  const [debtPlanMode, setDebtPlanMode] = useState<DebtPlanMode>('structured');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtBalanceManuallyEdited, setDebtBalanceManuallyEdited] = useState(false);
  const [debtAnnualRate, setDebtAnnualRate] = useState('');
  const [debtMonths, setDebtMonths] = useState('');
  const [debtTotalPeriods, setDebtTotalPeriods] = useState('');
  const [debtPaidPeriods, setDebtPaidPeriods] = useState('');
  const [debtLoanPrincipal, setDebtLoanPrincipal] = useState('');
  const [debtTotalRepayment, setDebtTotalRepayment] = useState('');
  const [debtManualRepayments, setDebtManualRepayments] = useState<ManualRepaymentItem[]>([]);
  const [debtBillDay, setDebtBillDay] = useState('');
  const [debtRepaymentDay, setDebtRepaymentDay] = useState('');
  const [debtPaymentAccount, setDebtPaymentAccount] = useState('');
  const [debtRepaymentMethod, setDebtRepaymentMethod] =
    useState<DebtRepaymentMethod>('minimum-payment');
  const [debtRepaymentRecordMode, setDebtRepaymentRecordMode] =
    useState<DebtRepaymentRecordMode>('manual');
  const [debtStatus, setDebtStatus] = useState<DebtLifecycleStatus>('active');
  const [repaymentAdvice, setRepaymentAdvice] = useState('');
  const [repaymentReasoning, setRepaymentReasoning] = useState('');
  const [repaymentLoading, setRepaymentLoading] = useState(false);
  const [repaymentCacheHint, setRepaymentCacheHint] = useState('');
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractSuccess, setExtractSuccess] = useState(false);
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [incomeHint, setIncomeHint] = useState('');
  const [incomeSourceTag, setIncomeSourceTag] = useState<'manual' | 'ai' | 'unknown'>(
    monthlyIncome > 0 ? 'manual' : 'unknown'
  );
  const [manualIncomeInput, setManualIncomeInput] = useState(
    monthlyIncome > 0 ? String(Math.round(monthlyIncome)) : ''
  );
  const [debtImagePreview, setDebtImagePreview] = useState('');
  const [debtFormError, setDebtFormError] = useState('');
  const [debtToastVisible, setDebtToastVisible] = useState(false);
  const [repaymentRecordToastVisible, setRepaymentRecordToastVisible] = useState(false);
  const [repaymentRecordToastMessage, setRepaymentRecordToastMessage] = useState('还款记录已添加');
  const [repaymentRecordToastVariant, setRepaymentRecordToastVariant] = useState<
    'success' | 'warning'
  >('success');
  const [addDebtSuccess, setAddDebtSuccess] = useState(false);
  const [showDebtPressurePreview, setShowDebtPressurePreview] = useState(false);
  const [debtPressurePreview, setDebtPressurePreview] = useState<
    Array<{ period: string; dueDate: string; amount: number; remaining: number }>
  >([]);
  const [repaymentDebtId, setRepaymentDebtId] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentPaidAt, setRepaymentPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [repaymentPaymentAccount, setRepaymentPaymentAccount] = useState('');
  const [repaymentNote, setRepaymentNote] = useState('');
  const [editingDebtId, setEditingDebtId] = useState('');
  const [repaymentRecordModeInput, setRepaymentRecordModeInput] =
    useState<DebtRepaymentRecordMode>('manual');
  const [repaymentRecordError, setRepaymentRecordError] = useState('');
  const [simulatorExtraPayment, setSimulatorExtraPayment] = useState('1000');
  const [prefillHint, setPrefillHint] = useState('');
  const [selectedDebtId, setSelectedDebtId] = useState('');
  const [debtFilter, setDebtFilter] = useState<'all' | 'active' | 'missing' | 'inactive'>('all');
  const [debtSort, setDebtSort] = useState<'due' | 'balance' | 'apr' | 'payment' | 'name'>('due');
  const [debtContextMenu, setDebtContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [showAddDebtModal, setShowAddDebtModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const startEditingDebt = useCallback((item: DebtItem) => {
    setEditingDebtId(item.id);
    setDebtName(item.name || '');
    setDebtEntryMode(item.entryMode === 'simple' ? 'simple' : 'standard');
    setSimpleDueDate(item.simpleDueDate || '');
    setSimpleDueTime(item.simpleDueTime || '');
    setDebtType(item.type === 'consumer-loan' ? 'credit-card' : item.type || 'credit-card');
    setDebtPlanMode(
      Array.isArray(item.manualRepayments) && item.manualRepayments.length > 0
        ? 'manual'
        : 'structured'
    );
    setDebtBalance(String(item.balance ?? ''));
    setDebtBalanceManuallyEdited(true);
    setDebtAnnualRate(item.annualRate !== undefined ? String(item.annualRate) : '');
    setDebtMonths(item.remainingMonths !== undefined ? String(item.remainingMonths) : '');
    setDebtTotalPeriods(item.totalPeriods !== undefined ? String(item.totalPeriods) : '');
    setDebtPaidPeriods(item.paidPeriods !== undefined ? String(item.paidPeriods) : '');
    setDebtLoanPrincipal(item.loanPrincipal !== undefined ? String(item.loanPrincipal) : '');
    setDebtTotalRepayment(item.totalRepayment !== undefined ? String(item.totalRepayment) : '');
    setDebtManualRepayments(
      Array.isArray(item.manualRepayments)
        ? item.manualRepayments.map((row) => ({
            ...row,
            amount: row.amount || 0,
            dueDate: row.dueDate || '',
            label: row.label || ''
          }))
        : []
    );
    setShowDebtPressurePreview(false);
    setDebtPressurePreview([]);
    setDebtBillDay(item.billDay !== undefined ? String(item.billDay) : '');
    setDebtRepaymentDay(item.repaymentDay !== undefined ? String(item.repaymentDay) : '');
    setDebtPaymentAccount(item.paymentAccount || '');
    setDebtRepaymentMethod(
      item.repaymentMethod || (item.type === 'loan' ? 'equal-installment' : 'minimum-payment')
    );
    setDebtRepaymentRecordMode(item.repaymentRecordMode || 'manual');
    setDebtStatus(normalizeDebtLifecycleStatus(item.status, item.balance));
    setDebtFormError('');
    setPrefillHint(`正在编辑“${item.name}”，保存后会直接更新原负债条目。`);
    setShowAddDebtModal(true);
  }, []);

  useEffect(() => {
    const locationState =
      (location.state as { prefillDebt?: RepaymentPrefillDebt; editingDebtId?: string } | null) ||
      null;
    const prefillDebt = locationState?.prefillDebt;
    if (!prefillDebt) return;

    setEditingDebtId(locationState?.editingDebtId || '');
    setDebtName(prefillDebt.name || '');
    setDebtEntryMode('standard');
    setSimpleDueDate('');
    setSimpleDueTime('');
    setDebtType(prefillDebt.type || 'credit-card');
    setDebtPlanMode('structured');
    setDebtBalance(prefillDebt.balance || '');
    setDebtBalanceManuallyEdited(Boolean(prefillDebt.balance));
    setDebtAnnualRate(prefillDebt.annualRate || '');
    setDebtMonths(prefillDebt.remainingMonths || '');
    setDebtTotalPeriods(prefillDebt.totalPeriods || '');
    setDebtPaidPeriods(prefillDebt.paidPeriods || '');
    setDebtLoanPrincipal(prefillDebt.loanPrincipal || '');
    setDebtTotalRepayment(prefillDebt.totalRepayment || '');
    setDebtRepaymentDay(prefillDebt.repaymentDay || '');
    setDebtPaymentAccount(prefillDebt.paymentAccount || '');
    setDebtStatus('active');
    setDebtFormError('');
    setPrefillHint(
      locationState?.editingDebtId
        ? `已从 AI 信贷管家带入“${prefillDebt.name || '待确认负债'}”并进入编辑模式，请核对后保存。`
        : `已从 AI 信贷管家带入“${prefillDebt.name || '待确认负债'}”的识别结果，请核对后再保存。`
    );
    setShowAddDebtModal(true);
  }, [location.state]);

  const debtsWithStatus = useMemo(
    () =>
      debts.map((item) => ({
        ...item,
        status: normalizeDebtLifecycleStatus(item.status, item.balance)
      })),
    [debts]
  );

  const activeDebts = useMemo(
    () => debtsWithStatus.filter((item) => !isDebtInactive(item.status) && item.entryMode !== 'simple'),
    [debtsWithStatus]
  );

  const archivedDebts = useMemo(
    () => debtsWithStatus.filter((item) => isDebtInactive(item.status)),
    [debtsWithStatus]
  );

  const debtSummary = useMemo(
    () => calculateDebtSummary(activeDebts, monthlyIncome),
    [activeDebts, monthlyIncome]
  );
  const pressureLevel = useMemo(
    () => getPressureLevel(debtSummary.pressureRatio),
    [debtSummary.pressureRatio]
  );
  const debtHealthScore = useMemo(
    () => calculateDebtHealthScore(debtSummary, monthlyIncome),
    [debtSummary, monthlyIncome]
  );
  const debtToIncomeRatio = useMemo(() => {
    if (monthlyIncome <= 0) return 0;
    return debtSummary.totalDebt / (monthlyIncome * 12);
  }, [debtSummary.totalDebt, monthlyIncome]);

  const strategyReadiness = useMemo(() => {
    const missing = activeDebts.flatMap((item) => {
      const derived = calculateDebtDerivedMetrics(item);
      const fields: string[] = [];
      if (derived.rateSource === 'missing') fields.push('年化利率');
      if (!item.repaymentDay) fields.push('还款日');
      if (calculateDebtMinimumPayment(item) <= 0) fields.push('最低/期供');
      return fields.length ? [`${item.name}：${fields.join('、')}`] : [];
    });
    return {
      isReady: activeDebts.length > 0 && missing.length === 0,
      missing
    };
  }, [activeDebts]);

  const repaymentPriority = useMemo(() => {
    const ranked = activeDebts
      .map((item) => {
        const derived = calculateDebtDerivedMetrics(item);
        const annualRate = derived.apr;
        const balance = Math.max(0, item.balance);
        return {
          id: item.id,
          name: item.name,
          balance,
          type: item.type,
          annualRate,
          minimumPayment: derived.minimumPayment,
          remainingInterestCost: derived.remainingInterestCost,
          priorityScore: annualRate * 0.7 + Math.log10(balance + 1) * 15
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore || b.annualRate - a.annualRate);

    return ranked.map((item, index) => ({
      ...item,
      recommendationTone: index === 0 ? 'danger' : index <= 2 ? 'warning' : 'safe'
    }));
  }, [activeDebts]);

  const incomeSamples = useMemo(
    () =>
      transactions
        .filter((item) => item.type === 'income' && Number.isFinite(Number(item.amount)))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, INCOME_SAMPLE_LIMIT)
        .map((item) => ({
          date: item.date,
          type: item.type,
          amount: Number(item.amount),
          note: item.note || ''
        })),
    [transactions]
  );

  const simulatorResult = useMemo(() => {
    const extraPayment = Math.max(0, Number(simulatorExtraPayment) || 0);
    if (!strategyReadiness.isReady) {
      return { extraPayment, strategyComparison: [], best: null };
    }
    const strategyComparison = (Object.keys(REPAYMENT_STRATEGY_LABELS) as RepaymentStrategyType[])
      .map((strategy) => {
        const baseline = simulateRepaymentPlan({ debts: activeDebts, extraPayment: 0, strategy });
        const accelerated = simulateRepaymentPlan({ debts: activeDebts, extraPayment, strategy });
        return {
          strategy,
          baseline,
          accelerated,
          savedMonths: Math.max(0, baseline.months - accelerated.months),
          savedInterest: Math.max(0, baseline.totalInterest - accelerated.totalInterest)
        };
      })
      .sort((a, b) => b.savedInterest - a.savedInterest || b.savedMonths - a.savedMonths);

    return {
      extraPayment,
      strategyComparison,
      best: strategyComparison[0]
    };
  }, [activeDebts, simulatorExtraPayment, strategyReadiness.isReady]);

  const overviewTotalDebt = debtSummary.totalDebt;
  const archivedTotalDebt = archivedDebts.reduce((sum, item) => sum + Math.max(0, item.balance), 0);

  const repaymentLedgerPreview = useMemo(() => {
    const now = new Date();
    const today = now.getDate();
    return debtsWithStatus
      .map((item) => {
        const isSimpleReminder = isSimpleRepaymentReminder(item);
        const simpleDueAt = isSimpleReminder ? getSimpleReminderDueDate(item) : null;
        const derived = calculateDebtDerivedMetrics(item);
        const minimumPayment = derived.minimumPayment;
        const annualRate = derived.apr;
        const lifecycleStatus = normalizeDebtLifecycleStatus(item.status, item.balance);
        const dueInDays =
          lifecycleStatus !== 'active'
            ? Number.POSITIVE_INFINITY
            : isSimpleReminder
              ? simpleDueAt
                ? getCalendarDayDifference(now, simpleDueAt)
                : Number.POSITIVE_INFINITY
              : typeof item.repaymentDay === 'number'
                ? (item.repaymentDay - today + 31) % 31
                : Number.POSITIVE_INFINITY;
        const statusTone: RepaymentDebtStatusTone =
          lifecycleStatus === 'settled'
            ? 'safe'
            : lifecycleStatus === 'closed'
              ? 'muted'
              : lifecycleStatus === 'paused'
                ? 'warning'
                : !Number.isFinite(dueInDays) || (!isSimpleReminder && typeof item.repaymentDay !== 'number')
                  ? 'muted'
                  : dueInDays === 0
                    ? 'danger'
                    : dueInDays <= 7
                      ? 'warning'
                      : 'safe';
        const statusLabel =
          lifecycleStatus === 'settled'
            ? '已结清'
            : lifecycleStatus === 'closed'
              ? '已关闭'
              : lifecycleStatus === 'paused'
                ? '暂缓处理'
                : !Number.isFinite(dueInDays) || (!isSimpleReminder && typeof item.repaymentDay !== 'number')
                  ? '待补日期'
                  : isSimpleReminder && dueInDays < 0
                    ? `已逾期 ${Math.abs(dueInDays)} 天`
                  : dueInDays === 0
                    ? isSimpleReminder ? '今日待处理' : '今日应还'
                    : dueInDays <= 7
                      ? `${dueInDays} 天后到期`
                      : `本期待还 · ${dueInDays} 天后`;

        return {
          id: item.id,
          name: item.name,
          type: item.type,
          isSimpleReminder,
          simpleDueDate: item.simpleDueDate,
          simpleDueTime: item.simpleDueTime,
          annualRate,
          apr: derived.apr,
          monthlyRate: derived.monthlyRate,
          dailyRate: derived.dailyRate,
          rateSource: derived.rateSource,
          minimumPayment,
          estimatedMonthlyPayment: derived.estimatedMonthlyPayment,
          totalInterest: derived.totalInterest,
          remainingInterestCost: derived.remainingInterestCost,
          remainingTotalCost: derived.remainingTotalCost,
          repaymentDay: item.repaymentDay,
          billDay: item.billDay,
          paymentAccount: item.paymentAccount,
          repaymentMethod:
            item.repaymentMethod ||
            (item.type === 'loan' ? 'equal-installment' : 'minimum-payment'),
          repaymentRecordMode: item.repaymentRecordMode || 'manual',
          lifecycleStatus,
          lifecycleStatusLabel: DEBT_STATUS_LABELS[lifecycleStatus],
          dueInDays,
          statusTone,
          statusLabel,
          remainingMonths: item.remainingMonths,
          paidPeriods: item.paidPeriods,
          totalPeriods: item.totalPeriods,
          principal: item.balance,
          missingFields: isSimpleReminder
            ? []
            : [
                !item.repaymentDay ? '还款日' : '',
                !item.paymentAccount ? '扣款账户' : '',
                !item.repaymentRecordMode ? '记录方式' : '',
                item.type === 'loan' && !item.annualRate && !item.totalRepayment ? '计算依据' : ''
              ].filter(Boolean)
        };
      })
      .sort((a, b) => a.dueInDays - b.dueInDays);
  }, [debtsWithStatus]);

  const visibleRepaymentLedgerPreview = useMemo(() => {
    const filtered = repaymentLedgerPreview.filter((item) => {
      if (debtFilter === 'active') return item.lifecycleStatus === 'active';
      if (debtFilter === 'missing') return item.missingFields.length > 0;
      if (debtFilter === 'inactive') return item.lifecycleStatus !== 'active';
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (debtSort === 'balance') return b.principal - a.principal;
      if (debtSort === 'apr') return b.apr - a.apr;
      if (debtSort === 'payment') return b.minimumPayment - a.minimumPayment;
      if (debtSort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      return a.dueInDays - b.dueInDays;
    });
  }, [debtFilter, debtSort, repaymentLedgerPreview]);

  useEffect(() => {
    const closeMenu = () => setDebtContextMenu(null);
    const closeMenuOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeMenuOnKey);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeMenuOnKey);
    };
  }, []);

  const repaymentAuditItems = useMemo(() => {
    return repaymentLedgerPreview.flatMap((item) => {
      if (item.isSimpleReminder) return [];
      const issues: { id: string; tone: 'warning' | 'danger' | 'info'; text: string }[] = [];
      if (!item.paymentAccount) {
        issues.push({
          id: `${item.id}-account`,
          tone: 'warning',
          text: `${item.name} 未设置扣款账户。`
        });
      }
      if (!item.repaymentDay) {
        issues.push({
          id: `${item.id}-day`,
          tone: 'danger',
          text: `${item.name} 未设置还款日，无法进行严谨提醒。`
        });
      }
      if (item.type === 'loan' && item.annualRate <= 0) {
        issues.push({
          id: `${item.id}-formula`,
          tone: 'warning',
          text: `${item.name} 缺少明确年化/总还款依据，当前计算解释性不足。`
        });
      }
      if (!item.repaymentRecordMode) {
        issues.push({
          id: `${item.id}-record`,
          tone: 'info',
          text: `${item.name} 尚未明确还款记录方式。`
        });
      }
      return issues;
    });
  }, [repaymentLedgerPreview]);

  const repaymentContextSnapshots = useMemo<RepaymentContextSnapshot[]>(() => {
    return debtsWithStatus.filter((debt) => !isSimpleRepaymentReminder(debt)).map((debt) => {
      const linkedRecords = repaymentRecords
        .filter((record) => record.debtId === debt.id)
        .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
      const actualPaymentAccounts = Array.from(
        new Set(
          linkedRecords.map((record) => String(record.paymentAccount || '').trim()).filter(Boolean)
        )
      );
      return {
        debtId: debt.id,
        debtName: debt.name,
        plannedPaymentAccount: debt.paymentAccount,
        plannedRepaymentDay: debt.repaymentDay,
        actualPaymentAccounts,
        actualRepaymentCount: linkedRecords.length,
        latestActualRepaymentAt: linkedRecords[0]?.paidAt
      };
    });
  }, [debtsWithStatus, repaymentRecords]);

  const debtRiskTags = useMemo<DebtRiskTag[]>(() => {
    const tags: DebtRiskTag[] = [];
    const dueSoonItems = repaymentLedgerPreview.filter(
      (item) => Number.isFinite(item.dueInDays) && item.dueInDays <= 7
    );
    if (dueSoonItems.length >= 3) {
      tags.push({
        id: 'clustered-due-dates',
        label: '还款日集中',
        tone: 'warning',
        dimension: 'schedule',
        explanation: `未来 7 天内有 ${dueSoonItems.length} 笔负债集中到期，建议提前准备账户余额。`
      });
    }

    repaymentLedgerPreview.forEach((item) => {
      if (item.isSimpleReminder) return;
      const ctx = repaymentContextSnapshots.find((entry) => entry.debtId === item.id);
      if (item.apr >= 24) {
        tags.push({
          id: `${item.id}-high-rate`,
          debtId: item.id,
          label: '高利率',
          tone: 'danger',
          dimension: 'rate',
          explanation: `${item.name} 的 APR/年化约 ${item.apr.toFixed(2)}%，属于优先压降利息成本的对象。`
        });
      } else if (item.apr >= 15) {
        tags.push({
          id: `${item.id}-rate-watch`,
          debtId: item.id,
          label: '利率偏高',
          tone: 'warning',
          dimension: 'rate',
          explanation: `${item.name} 的 APR/年化约 ${item.apr.toFixed(2)}%，建议和其他负债比较后决定是否提前还。`
        });
      }
      if (!item.paymentAccount) {
        tags.push({
          id: `${item.id}-missing-account`,
          debtId: item.id,
          label: '缺少扣款账户',
          tone: 'warning',
          dimension: 'account',
          explanation: `${item.name} 尚未设置计划中的扣款账户，后续 AI 无法回答“从哪个账户扣款”。`
        });
      }
      if (item.lifecycleStatus === 'paused') {
        tags.push({
          id: `${item.id}-paused`,
          debtId: item.id,
          label: '已暂缓处理',
          tone: 'info',
          dimension: 'schedule',
          explanation: `${item.name} 当前已标记为暂缓处理，默认不会再参与优先还款推荐。`
        });
      }
      if (!ctx || ctx.actualRepaymentCount === 0) {
        tags.push({
          id: `${item.id}-missing-actual-record`,
          debtId: item.id,
          label: '缺少已还流水',
          tone: 'info',
          dimension: 'actual',
          explanation: `${item.name} 当前只有计划信息，没有已发生还款流水，后续查询时需区分“计划应还”和“实际已还”。`
        });
      }
      if (
        ctx &&
        item.paymentAccount &&
        ctx.actualPaymentAccounts.length > 0 &&
        !ctx.actualPaymentAccounts.includes(item.paymentAccount)
      ) {
        tags.push({
          id: `${item.id}-account-mismatch`,
          debtId: item.id,
          label: '计划账户与实际不一致',
          tone: 'warning',
          dimension: 'actual',
          explanation: `${item.name} 计划扣款账户是“${item.paymentAccount}”，但已记录还款来自“${ctx.actualPaymentAccounts.join(' / ')}”。`
        });
      }
      if (item.missingFields.length >= 2) {
        tags.push({
          id: `${item.id}-missing-fields`,
          debtId: item.id,
          label: '信息缺失',
          tone: 'warning',
          dimension: 'data',
          explanation: `${item.name} 还缺少 ${item.missingFields.join('、')}，当前测算和提醒都偏保守。`
        });
      }
      if (item.statusTone === 'danger') {
        tags.push({
          id: `${item.id}-due-today`,
          debtId: item.id,
          label: '今日到期',
          tone: 'danger',
          dimension: 'schedule',
          explanation: `${item.name} 今日应还，若账户余额不足，优先处理这一笔。`
        });
      }
    });

    return tags;
  }, [repaymentContextSnapshots, repaymentLedgerPreview]);

  const selectedDebt = useMemo(
    () => repaymentLedgerPreview.find((item) => item.id === selectedDebtId) || null,
    [repaymentLedgerPreview, selectedDebtId]
  );

  const selectedDebtOriginal = useMemo(
    () => debtsWithStatus.find((item) => item.id === selectedDebtId) || null,
    [debtsWithStatus, selectedDebtId]
  );

  const selectedDebtRecords = useMemo(() => {
    if (!selectedDebtId) return [];
    return repaymentRecords
      .filter((record) => record.debtId === selectedDebtId)
      .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
  }, [repaymentRecords, selectedDebtId]);

  useEffect(() => {
    if (selectedDebtId && repaymentLedgerPreview.some((item) => item.id === selectedDebtId)) {
      return;
    }
    const firstActive = repaymentLedgerPreview.find((item) => item.lifecycleStatus === 'active');
    setSelectedDebtId(firstActive?.id || repaymentLedgerPreview[0]?.id || '');
  }, [repaymentLedgerPreview, selectedDebtId]);

  useEffect(() => {
    if (selectedDebtId) {
      setRepaymentDebtId(selectedDebtId);
    }
  }, [selectedDebtId]);

  const incomeConfidenceTag =
    incomeSourceTag === 'manual'
      ? '👤 你手动输入'
      : incomeSourceTag === 'ai'
        ? '📊 系统估算'
        : '— 未确定';
  const isLoanType = debtType === 'loan';

  function fillDebtPeriodGap(
    source: 'total' | 'remaining' | 'paid',
    nextValue: string
  ): void {
    const totalRaw = source === 'total' ? nextValue : debtTotalPeriods;
    const remainingRaw = source === 'remaining' ? nextValue : debtMonths;
    const paidRaw = source === 'paid' ? nextValue : debtPaidPeriods;
    const total = Number(totalRaw);
    const remaining = Number(remainingRaw);
    const paid = Number(paidRaw);

    if (source === 'total' && Number.isInteger(total) && total > 0) {
      if (paidRaw.trim().length > 0 && Number.isInteger(paid) && paid >= 0 && paid <= total) {
        setDebtPaidPeriods(paidRaw);
        setDebtMonths(String(Math.max(0, total - paid)));
        return;
      }
      if (
        remainingRaw.trim().length > 0 &&
        Number.isInteger(remaining) &&
        remaining >= 0 &&
        remaining <= total
      ) {
        setDebtMonths(remainingRaw);
        setDebtPaidPeriods(String(Math.max(0, total - remaining)));
        return;
      }
    }

    if (source === 'paid' && totalRaw.trim().length > 0 && Number.isInteger(paid) && paid >= 0) {
      if (Number.isInteger(total) && paid <= total) {
        setDebtPaidPeriods(paidRaw);
        setDebtMonths(String(Math.max(0, total - paid)));
        return;
      }
    }

    if (
      source === 'remaining' &&
      totalRaw.trim().length > 0 &&
      Number.isInteger(remaining) &&
      remaining >= 0
    ) {
      if (Number.isInteger(total) && remaining <= total) {
        setDebtMonths(remainingRaw);
        setDebtPaidPeriods(String(Math.max(0, total - remaining)));
        return;
      }
    }

    if (source === 'total') setDebtTotalPeriods(nextValue);
    if (source === 'remaining') setDebtMonths(nextValue);
    if (source === 'paid') setDebtPaidPeriods(nextValue);
  }

  function addManualRepaymentRow(): void {
    const previous = debtManualRepayments.at(-1);
    setDebtManualRepayments((current) => [
      ...current,
      createEmptyManualRepayment(previous)
    ]);
    setDebtFormError('');
  }

  function updateManualRepaymentRow(
    index: number,
    patch: Partial<ManualRepaymentItem>
  ): void {
    setDebtManualRepayments((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
    setDebtFormError('');
  }

  function removeManualRepaymentRow(index: number): void {
    setDebtManualRepayments((current) =>
      current.filter((_, itemIndex) => itemIndex !== index)
    );
    setDebtFormError('');
  }

  function resetDebtForm(afterEdit = false): void {
    setDebtName('');
    setDebtEntryMode('standard');
    setSimpleDueDate('');
    setSimpleDueTime('');
    setDebtType('credit-card');
    setDebtPlanMode('structured');
    setDebtBalance('');
    setDebtBalanceManuallyEdited(false);
    setDebtAnnualRate('');
    setDebtMonths('');
    setDebtTotalPeriods('');
    setDebtPaidPeriods('');
    setDebtLoanPrincipal('');
    setDebtTotalRepayment('');
    setDebtManualRepayments([]);
    setDebtBillDay('');
    setDebtRepaymentDay('');
    setDebtPaymentAccount('');
    setDebtRepaymentMethod('minimum-payment');
    setDebtRepaymentRecordMode('manual');
    setDebtStatus('active');
    setDebtFormError('');
    setPrefillHint('');
    setShowDebtPressurePreview(false);
    setDebtPressurePreview([]);
    if (afterEdit) setEditingDebtId('');
  }

  const trimmedDebtName = debtName.trim();
  const canSubmitSimpleDebt =
    trimmedDebtName.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(simpleDueDate) &&
    /^\d{2}:\d{2}$/.test(simpleDueTime);
  const balance = Number(debtBalance);
  const annualRate = Number(debtAnnualRate);
  const months = Number(debtMonths);
  const totalPeriods = Number(debtTotalPeriods);
  const paidPeriods = Number(debtPaidPeriods);
  const loanPrincipal = Number(debtLoanPrincipal);
  const totalRepayment = Number(debtTotalRepayment);
  const annualRateRaw = debtAnnualRate.trim();
  const totalPeriodsRaw = debtTotalPeriods.trim();
  const paidPeriodsRaw = debtPaidPeriods.trim();
  const loanPrincipalRaw = debtLoanPrincipal.trim();
  const totalRepaymentRaw = debtTotalRepayment.trim();
  const paidPeriodsForEstimate =
    paidPeriodsRaw.length > 0
      ? paidPeriods
      : totalPeriodsRaw.length > 0 && debtMonths.trim().length > 0
        ? Math.max(0, totalPeriods - months)
        : 0;
  const calculatedRemainingPrincipal = useMemo(
    () =>
      isLoanType
        ? estimateRemainingPrincipal({
            loanPrincipal,
            totalPeriods,
            paidPeriods: paidPeriodsForEstimate,
            annualRate: annualRateRaw.length > 0 ? annualRate : undefined,
            repaymentMethod: debtRepaymentMethod
          })
        : null,
    [
      annualRate,
      annualRateRaw.length,
      debtRepaymentMethod,
      isLoanType,
      loanPrincipal,
      paidPeriodsForEstimate,
      totalPeriods
    ]
  );
  const effectiveBalance =
    Number.isFinite(balance) && balance > 0 ? balance : calculatedRemainingPrincipal ?? balance;

  useEffect(() => {
    if (
      calculatedRemainingPrincipal !== null &&
      calculatedRemainingPrincipal > 0 &&
      !debtBalanceManuallyEdited
    ) {
      setDebtBalance(String(calculatedRemainingPrincipal));
    }
  }, [calculatedRemainingPrincipal, debtBalanceManuallyEdited]);

  const billDay = Number(debtBillDay);
  const repaymentDay = Number(debtRepaymentDay);
  const isAnnualRateNumeric = annualRateRaw === '' || /^\d+(\.\d+)?$/.test(annualRateRaw);
  const billDayValid =
    debtBillDay.trim().length === 0 || (Number.isInteger(billDay) && billDay >= 1 && billDay <= 31);
  const repaymentDayValid =
    debtRepaymentDay.trim().length === 0 ||
    (Number.isInteger(repaymentDay) && repaymentDay >= 1 && repaymentDay <= 31);
  const canInferAnnualRateByFormula =
    isLoanType &&
    loanPrincipalRaw.length > 0 &&
    totalRepaymentRaw.length > 0 &&
    totalPeriodsRaw.length > 0 &&
    Number.isFinite(loanPrincipal) &&
    Number.isFinite(totalRepayment) &&
    Number.isFinite(totalPeriods) &&
    loanPrincipal > 0 &&
    totalRepayment > loanPrincipal &&
    totalPeriods > 0;

  const hasExplicitAnnualRate =
    annualRateRaw.length > 0 &&
    isAnnualRateNumeric &&
    Number.isFinite(annualRate) &&
    annualRate >= 0;

  const totalPeriodsValid =
    totalPeriodsRaw.length === 0 ||
    (Number.isFinite(totalPeriods) && Number.isInteger(totalPeriods) && totalPeriods > 0);
  const paidPeriodsValid =
    paidPeriodsRaw.length === 0 ||
    (Number.isFinite(paidPeriods) && Number.isInteger(paidPeriods) && paidPeriods >= 0);
  const hasManualRepaymentSchedule =
    debtManualRepayments.some((item) => Number.isFinite(Number(item.amount)) && Number(item.amount) > 0);
  const manualRepaymentTotal = debtManualRepayments.reduce(
    (sum, item) => sum + Math.max(0, Number(item.amount) || 0),
    0
  );
  const manualRepaymentCount = debtManualRepayments.length;

  const canSubmitDebt =
    trimmedDebtName.length > 0 &&
    Number.isFinite(effectiveBalance) &&
    effectiveBalance > 0 &&
    billDayValid &&
    repaymentDayValid &&
    totalPeriodsValid &&
    paidPeriodsValid &&
    (!isLoanType ||
      debtPlanMode === 'manual' ||
      hasExplicitAnnualRate ||
      canInferAnnualRateByFormula) &&
    (!isLoanType ||
      debtPlanMode === 'manual' ||
      (debtMonths.trim().length > 0 &&
        Number.isFinite(months) &&
        Number.isInteger(months) &&
        months > 0)) &&
    (debtPlanMode !== 'manual' || hasManualRepaymentSchedule);
  const missingDebtFields =
    canSubmitDebt
      ? []
      : [
          trimmedDebtName.length === 0 ? '负债名称' : '',
          !Number.isFinite(effectiveBalance) || effectiveBalance <= 0 ? '剩余本金' : '',
          isLoanType && debtPlanMode === 'structured' && !debtMonths.trim() ? '剩余期数' : '',
          isLoanType && debtPlanMode === 'manual' && !hasManualRepaymentSchedule ? '手动还款计划' : ''
        ].filter(Boolean);

  async function resolveMonthlyIncomeByAi(forceRefresh = false): Promise<number | null> {
    if (incomeSamples.length === 0) {
      setIncomeHint('账单详情里暂无收入记录，暂无法估算月收入。');
      return null;
    }

    const snapshotKey = buildIncomeSnapshotKey({
      model,
      transactions: incomeSamples
    });
    const cache = readIncomeCache();
    const cached = cache[snapshotKey];

    if (!forceRefresh && cached?.value > 0) {
      setMonthlyIncome(cached.value);
      setIncomeSourceTag('ai');
      setManualIncomeInput(String(Math.round(cached.value)));
      setIncomeHint(
        `月收入已命中缓存：¥${cached.value.toFixed(2)}（${new Date(cached.createdAt).toLocaleString()}）`
      );
      return cached.value;
    }

    if (!apiKey.trim()) {
      setIncomeHint('未配置 AI Key，无法自动估算月收入。');
      return null;
    }

    setIncomeLoading(true);

    try {
      const sampleLines = incomeSamples
        .map(
          (item) =>
            `${item.date.slice(0, 10)} | ¥${item.amount.toFixed(2)} | ${item.note || '无备注'}`
        )
        .join('\n');

      const result = await sendAiChat({
        baseUrl,
        apiKey,
        model,
        systemPrompt:
          '你是账单分析助手。你需要根据收入流水估算可用于还款管理的月收入平均值。只输出 JSON，不要输出其它说明。',
        messages: [
          {
            role: 'user',
            text: `请根据以下收入流水估算“月收入平均值”，输出 JSON：{"monthlyIncome": number, "reasoning": string}。\n要求：\n1) 仅依据输入流水；\n2) monthlyIncome 必须是正数；\n3) reasoning 用一句话说明估算依据。\n\n收入流水：\n${sampleLines}`
          }
        ]
      });

      const payload = parseIncomeExtraction(result.content);
      if (!payload.monthlyIncome || payload.monthlyIncome <= 0) {
        setIncomeHint('AI 未返回有效月收入，请检查账单详情中的收入数据。');
        return null;
      }

      setMonthlyIncome(payload.monthlyIncome);
      setIncomeSourceTag('ai');
      setManualIncomeInput(String(Math.round(payload.monthlyIncome)));
      setIncomeHint(`月收入已由大模型估算并写入缓存：¥${payload.monthlyIncome.toFixed(2)}`);

      writeIncomeCache({
        ...cache,
        [snapshotKey]: {
          key: snapshotKey,
          value: payload.monthlyIncome,
          reasoning: payload.reasoning,
          createdAt: new Date().toISOString()
        }
      });

      return payload.monthlyIncome;
    } catch (err) {
      setError((err as Error).message || '月收入估算失败，请稍后重试。');
      return null;
    } finally {
      setIncomeLoading(false);
    }
  }

  function onAddDebt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (debtEntryMode === 'simple') {
      if (!canSubmitSimpleDebt) {
        setDebtFormError('请填写还款项目、还款日期和还款时间。');
        return;
      }
      const simplePayload = {
        name: trimmedDebtName,
        type: 'credit-card' as DebtType,
        status: 'active' as DebtLifecycleStatus,
        balance: 0,
        entryMode: 'simple' as const,
        simpleDueDate,
        simpleDueTime
      };
      if (editingDebtId) {
        updateDebt(editingDebtId, simplePayload);
      } else {
        addDebt(simplePayload);
      }
      resetDebtForm(true);
      setSelectedDebtId(editingDebtId || '');
      setDebtToastVisible(true);
      setAddDebtSuccess(true);
      window.setTimeout(() => setAddDebtSuccess(false), 800);
      setError('');
      setShowAddDebtModal(false);
      return;
    }

    if (!trimmedDebtName || (!debtBalance.trim() && calculatedRemainingPrincipal === null)) {
      setDebtFormError('请先填写“负债名称”和“剩余本金(¥)”。');
      return;
    }
    if (!Number.isFinite(effectiveBalance) || effectiveBalance <= 0) {
      setDebtFormError('“剩余本金(¥)”必须是大于 0 的数字。');
      return;
    }
    if (!billDayValid || !repaymentDayValid) {
      setDebtFormError('账单日和还款日需在 1~31 之间，可留空。');
      return;
    }
    if (!totalPeriodsValid || !paidPeriodsValid) {
      setDebtFormError('“总期数/已还期数”需为非负整数，且总期数需大于 0。');
      return;
    }
    if (paidPeriodsRaw && totalPeriodsRaw && paidPeriods > totalPeriods) {
      setDebtFormError('“已还期数”不能大于“总期数”。');
      return;
    }
    if (debtPlanMode === 'manual') {
      if (!hasManualRepaymentSchedule) {
        setDebtFormError('请至少填写一条手动还款计划，用来计算还款压力。');
        return;
      }
    } else if (isLoanType) {
      if (!debtMonths.trim()) {
        setDebtFormError('当前计划方式为“按期数管理”，请填写“剩余期数(月)”。');
        return;
      }
      if (!Number.isInteger(months) || months <= 0) {
        setDebtFormError('“剩余期数(月)”需为大于 0 的整数。');
        return;
      }
      if (!hasExplicitAnnualRate && !canInferAnnualRateByFormula) {
        setDebtFormError('贷款请填写年化利率，或补充借款金额、总还款、总期数用于反推。');
        return;
      }
    }

    if (loanPrincipalRaw && (!Number.isFinite(loanPrincipal) || loanPrincipal <= 0)) {
      setDebtFormError('“借款金额(¥)”需为大于 0 的数字。');
      return;
    }
    if (totalRepaymentRaw && (!Number.isFinite(totalRepayment) || totalRepayment <= 0)) {
      setDebtFormError('“总还款(¥)”需为大于 0 的数字。');
      return;
    }

    const inferredAnnualRate =
      isLoanType && canInferAnnualRateByFormula
        ? ((totalRepayment - loanPrincipal) / loanPrincipal) * (12 / totalPeriods) * 100
        : undefined;

    const manualRepaymentRows = debtManualRepayments
      .map((item) => ({
        id: item.id,
        dueDate: item.dueDate?.trim() || undefined,
        amount: Number(item.amount),
        label: item.label?.trim() || undefined
      }))
      .filter((item) => Number.isFinite(item.amount) && item.amount > 0)
      .sort((a, b) => {
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });
    const nextRemainingMonths = isLoanType
      ? debtPlanMode === 'manual'
        ? manualRepaymentRows.length
        : debtMonths.trim().length > 0 && Number.isFinite(months) && months > 0
          ? months
          : undefined
      : undefined;

    const debtPayload = {
      name: trimmedDebtName,
      type: debtType,
      status: debtStatus,
      balance: effectiveBalance,
      annualRate:
        isLoanType && hasExplicitAnnualRate
          ? annualRate
          : isLoanType && inferredAnnualRate && inferredAnnualRate > 0
            ? inferredAnnualRate
            : undefined,
      remainingMonths: nextRemainingMonths,
      totalPeriods: totalPeriodsRaw.length > 0 ? totalPeriods : undefined,
      paidPeriods: paidPeriodsRaw.length > 0 ? paidPeriods : undefined,
      loanPrincipal: loanPrincipalRaw.length > 0 ? loanPrincipal : undefined,
      totalRepayment: totalRepaymentRaw.length > 0 ? totalRepayment : undefined,
      billDay: isLoanType ? undefined : debtBillDay.trim().length > 0 ? billDay : undefined,
      repaymentDay: debtRepaymentDay.trim().length > 0 ? repaymentDay : undefined,
      repaymentMethod: debtRepaymentMethod,
      repaymentRecordMode: debtRepaymentRecordMode,
      paymentAccount: debtPaymentAccount.trim() || undefined,
      manualRepayments: manualRepaymentRows
    };

    const debtPreviewTotal = effectiveBalance;
    if (editingDebtId) {
      updateDebt(editingDebtId, debtPayload);
    } else {
      addDebt(debtPayload);
    }
    setShowDebtPressurePreview(true);
    setDebtPressurePreview(
      buildDebtPressureSchedule({
        ...debtPayload,
        id: editingDebtId || '',
        name: trimmedDebtName,
        type: debtType,
        balance: debtPreviewTotal
      } as DebtItem)
    );

    resetDebtForm(true);
    setSelectedDebtId(editingDebtId || '');
    setDebtToastVisible(true);
    setAddDebtSuccess(true);
    window.setTimeout(() => setAddDebtSuccess(false), 800);
    setError('');
  }

  function onAddRepaymentRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = Number(repaymentAmount);
    if (!repaymentDebtId) {
      setRepaymentRecordError('请先选择要登记还款的负债。');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setRepaymentRecordError('还款金额必须是大于 0 的数字。');
      return;
    }
    if (!repaymentPaidAt) {
      setRepaymentRecordError('请填写实际还款日期。');
      return;
    }

    const targetDebt = debts.find((item) => item.id === repaymentDebtId);
    if (!targetDebt) {
      setRepaymentRecordError('未找到对应负债，请刷新后重试。');
      return;
    }

    const minimumPayment = calculateDebtMinimumPayment(targetDebt);
    const nextBalance = Math.max(0, Number((targetDebt.balance - amount).toFixed(2)));
    const shouldAdvancePeriod = amount >= Math.max(1, minimumPayment * 0.98);
    const nextPaidPeriods = targetDebt.totalPeriods
      ? Math.min(
          targetDebt.totalPeriods,
          (targetDebt.paidPeriods || 0) + (shouldAdvancePeriod ? 1 : 0)
        )
      : targetDebt.paidPeriods;
    const nextRemainingMonths =
      typeof targetDebt.remainingMonths === 'number'
        ? Math.max(0, targetDebt.remainingMonths - (shouldAdvancePeriod ? 1 : 0))
        : targetDebt.remainingMonths;
    const resultTag =
      amount > targetDebt.balance
        ? 'overpayment'
        : amount + 0.01 < Math.max(1, minimumPayment * 0.98)
          ? 'partial'
          : 'normal';
    const resultMessage =
      resultTag === 'overpayment'
        ? `${targetDebt.name} 已登记超额还款，剩余本金已归零。`
        : resultTag === 'partial'
          ? `${targetDebt.name} 已登记部分还款，未达到最低/期供金额。`
          : `${targetDebt.name} 已登记正常还款，台账已同步更新。`;

    addRepaymentRecord({
      debtId: repaymentDebtId,
      amount,
      paidAt: repaymentPaidAt,
      paymentAccount: repaymentPaymentAccount.trim() || targetDebt.paymentAccount || undefined,
      note: repaymentNote.trim() || undefined,
      recordMode: repaymentRecordModeInput
    });

    updateDebt(repaymentDebtId, {
      ...targetDebt,
      balance: nextBalance,
      paidPeriods: nextPaidPeriods,
      remainingMonths: nextRemainingMonths,
      paymentAccount: repaymentPaymentAccount.trim() || targetDebt.paymentAccount,
      repaymentRecordMode: repaymentRecordModeInput
    });

    setRepaymentRecordToastMessage(resultMessage);
    setRepaymentRecordToastVariant(resultTag === 'partial' ? 'warning' : 'success');
    setRepaymentDebtId('');
    setRepaymentAmount('');
    setRepaymentPaidAt(new Date().toISOString().slice(0, 10));
    setRepaymentPaymentAccount('');
    setRepaymentNote('');
    setRepaymentRecordModeInput('manual');
    setRepaymentRecordError('');
    setRepaymentRecordToastVisible(true);
  }

  function onMarkCurrentPayment(debtId: string, requestedAmount: number) {
    const targetDebt = debts.find((item) => item.id === debtId);
    if (!targetDebt) {
      setRepaymentRecordToastMessage('未找到对应负债，请刷新后重试。');
      setRepaymentRecordToastVariant('warning');
      setRepaymentRecordToastVisible(true);
      return;
    }

    const amount = Math.min(
      Math.max(0, Number(requestedAmount) || 0),
      Math.max(0, targetDebt.balance)
    );
    if (amount <= 0) {
      setRepaymentRecordToastMessage(`${targetDebt.name} 当前无需继续还款。`);
      setRepaymentRecordToastVariant('warning');
      setRepaymentRecordToastVisible(true);
      return;
    }

    const now = new Date();
    const paidAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const alreadyPaidThisMonth = repaymentRecords
      .filter((record) => {
        if (record.debtId !== debtId) return false;
        const paidDate = new Date(record.paidAt);
        return (
          paidDate.getFullYear() === now.getFullYear() && paidDate.getMonth() === now.getMonth()
        );
      })
      .reduce((sum, record) => sum + Math.max(0, Number(record.amount) || 0), 0);
    const minimumPayment = calculateDebtMinimumPayment(targetDebt);
    const shouldAdvancePeriod = alreadyPaidThisMonth + amount >= Math.max(1, minimumPayment * 0.98);
    const nextBalance = Math.max(0, Number((targetDebt.balance - amount).toFixed(2)));
    const nextPaidPeriods = targetDebt.totalPeriods
      ? Math.min(
          targetDebt.totalPeriods,
          (targetDebt.paidPeriods || 0) + (shouldAdvancePeriod ? 1 : 0)
        )
      : targetDebt.paidPeriods;
    const nextRemainingMonths =
      typeof targetDebt.remainingMonths === 'number'
        ? Math.max(0, targetDebt.remainingMonths - (shouldAdvancePeriod ? 1 : 0))
        : targetDebt.remainingMonths;

    addRepaymentRecord({
      debtId,
      amount,
      paidAt,
      paymentAccount: targetDebt.paymentAccount,
      note: '从未来还款快捷标记为本期已还',
      recordMode: targetDebt.repaymentRecordMode || 'manual'
    });
    updateDebt(debtId, {
      ...targetDebt,
      balance: nextBalance,
      paidPeriods: nextPaidPeriods,
      remainingMonths: nextRemainingMonths
    });

    setRepaymentRecordToastMessage(
      `${targetDebt.name} 本期已还 ${formatCurrency(amount)}，余额与还款进度已同步。`
    );
    setRepaymentRecordToastVariant('success');
    setRepaymentRecordToastVisible(true);
  }

  function onSetRepaymentDay(debtId: string, day: number) {
    const targetDebt = debts.find((item) => item.id === debtId);
    if (!targetDebt || !Number.isInteger(day) || day < 1 || day > 31) return;
    updateDebt(debtId, { ...targetDebt, repaymentDay: day });
    setRepaymentRecordToastMessage(`${targetDebt.name} 还款日已设置为每月 ${day} 日。`);
    setRepaymentRecordToastVariant('success');
    setRepaymentRecordToastVisible(true);
  }

  const onManualIncomeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextIncome = Number(manualIncomeInput || 0);
    if (!Number.isFinite(nextIncome) || nextIncome <= 0) {
      setError('请输入有效的月收入金额（大于 0）。');
      return;
    }
    setMonthlyIncome(nextIncome);
    setIncomeSourceTag('manual');
    setIncomeHint(`已手动设置月收入：¥${nextIncome.toFixed(2)}。`);
    setError('');
  };

  async function onExtractDebtFromScreenshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!apiKey.trim()) {
      setError('请先在设置页配置 AI API Key。');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('仅支持上传图片文件。');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      const maxSizeMb = Math.round(MAX_IMAGE_SIZE_BYTES / (1024 * 1024));
      setError(`图片过大，请上传不超过 ${maxSizeMb}MB 的截图。`);
      return;
    }

    setExtractLoading(true);
    setError('');

    try {
      const imageDataUrl = await readImageAsDataUrl(file);
      setDebtImagePreview(imageDataUrl);

      const result = await sendAiChat({
        baseUrl,
        apiKey,
        model,
        systemPrompt:
          '你是负债信息识别助手。请从截图中提取负债数据，只输出 JSON，不要输出额外说明。',
        messages: [
          {
            role: 'user',
            text: '请识别截图中的负债信息，并按以下 JSON 输出：{"monthlyIncome": number, "debts": [{"name": string, "type": "credit-card"|"consumer-loan"|"loan", "balance": number, "annualRate": number, "remainingMonths": number}] }。\n要求：\n1) 未提及的字段可省略；\n2) 金额使用数字；\n3) 如果无法确定 type，默认 credit-card。',
            imageDataUrl
          }
        ]
      });

      const payload = parseDebtExtraction(result.content);
      if (payload.debts.length === 0) {
        setError('未识别到有效负债数据，请更换更清晰的截图再试。');
        return;
      }

      replaceDebts(payload.debts);
      setExtractSuccess(true);
      window.setTimeout(() => setExtractSuccess(false), 1400);
      if (typeof payload.monthlyIncome === 'number') {
        setMonthlyIncome(payload.monthlyIncome);
        setIncomeSourceTag('ai');
        setManualIncomeInput(String(Math.round(payload.monthlyIncome)));
      }

      setRepaymentAdvice('');
      setRepaymentReasoning('');
      setRepaymentCacheHint('已根据截图更新负债信息，请点击“生成 AI 还款建议”。');
    } catch (err) {
      setError((err as Error).message || '截图识别失败，请稍后再试。');
    } finally {
      setExtractLoading(false);
    }
  }

  async function onGenerateRepaymentAdvice() {
    if (debts.length === 0) {
      setError('请先新增至少一条负债记录，再让 AI 生成建议。');
      return;
    }

    if (!strategyReadiness.isReady) {
      setError(`暂不生成雪崩/雪球还款方案，请先补齐：${strategyReadiness.missing.join('；')}。`);
      return;
    }

    const activeIncome = monthlyIncome > 0 ? monthlyIncome : await resolveMonthlyIncomeByAi(false);
    if (!activeIncome || activeIncome <= 0) {
      setError('无法获得有效月收入，请先导入账单详情里的收入数据。');
      return;
    }

    setError('');
    setRepaymentAdvice('');
    setRepaymentReasoning('');
    setRepaymentCacheHint('');

    const summary = calculateDebtSummary(debts, activeIncome);

    const snapshotKey = buildRepaymentSnapshotKey({
      debts,
      monthlyIncome: activeIncome,
      model
    });
    const cache = readCache();
    const cached = cache[snapshotKey];
    if (cached) {
      setRepaymentAdvice(cached.advice);
      setRepaymentReasoning(cached.reasoning);
      setRepaymentCacheHint(`已命中缓存（${new Date(cached.createdAt).toLocaleString()} 生成）`);
      return;
    }

    setRepaymentLoading(true);

    try {
      const debtLines = activeDebts
        .map((item) => {
          const minimum = calculateDebtMinimumPayment(item);
          const typeLabel =
            item.type === 'credit-card'
              ? '信用卡'
              : item.type === 'consumer-loan'
                ? '消费贷'
                : '贷款';
          const annualRateValue = getDebtAssumedAnnualRate(
            item.type,
            item.annualRate,
            item.loanPrincipal,
            item.totalRepayment,
            item.totalPeriods
          );
          const months = item.type === 'loan' ? `，剩余期数 ${item.remainingMonths || 12}` : '';
          return `${item.name}（${typeLabel}）：本金 ¥${item.balance.toFixed(2)}，最低/期供 ¥${minimum.toFixed(2)}，年化利率 ${annualRateValue.toFixed(2)}%，还款日每月 ${item.repaymentDay} 日${months}`;
        })
        .join('\n');

      const result = await sendAiChat({
        baseUrl,
        apiKey,
        model,
        systemPrompt:
          '你是资深个人财务顾问，请用简体中文给出可执行的还款管理建议。只基于给定数据，优先考虑现金流安全、降低利息、避免逾期；不要编造节省金额、缩短月份或未给出的条款，并给出分步骤计划。',
        messages: [
          {
            role: 'user',
            text: `请基于以下负债情况给我一个未来 3 个月还款方案，并输出：\n1) 优先级排序\n2) 每月执行动作\n3) 风险提醒\n\n月收入（AI 估算）：¥${activeIncome.toFixed(2)}\n总负债：¥${summary.totalDebt.toFixed(2)}\n每月最低还款：¥${summary.totalMinimumPayment.toFixed(2)}\n负债压力：${(summary.pressureRatio * 100).toFixed(1)}%\n\n负债列表：\n${debtLines}`
          }
        ]
      });

      setRepaymentAdvice(result.content);
      setRepaymentReasoning(result.reasoning || '');

      const nextCache: RepaymentAdviceCache = {
        ...cache,
        [snapshotKey]: {
          key: snapshotKey,
          advice: result.content,
          reasoning: result.reasoning || '',
          createdAt: new Date().toISOString()
        }
      };
      writeCache(nextCache);
    } catch (err) {
      setError((err as Error).message || 'AI 还款建议生成失败，请检查模型配置。');
    } finally {
      setRepaymentLoading(false);
    }
  }

  return (
    <div className="page-stack finance-page vi-page">
      <section className="panel repayment-workspace">
        <h2 style={{ marginTop: 0 }}>💳 负债管理</h2>
        <p className="muted surface-note">
          支持信用卡、消费贷、贷款，自动计算每月最低还款额与总负债压力。
        </p>

        <RepaymentDashboard
          debts={debtsWithStatus}
          repaymentRecords={repaymentRecords}
          onMarkCurrentPayment={onMarkCurrentPayment}
          onSetRepaymentDay={onSetRepaymentDay}
        />

        {debts.length > 0 ? (
          <div className="repayment-overview-band">
            <article className="repayment-overview-stat">
              <p className="finance-overview-label">💰 总负债</p>
              <p className="finance-overview-value">
                <span className="finance-overview-number">{overviewTotalDebt.toFixed(2)}</span>
                <span className="finance-overview-unit">¥</span>
              </p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                仅统计进行中的负债
              </p>
            </article>
            <article className="repayment-overview-stat">
              <p className="finance-overview-label">📉 每月最低还款</p>
              <p className="finance-overview-value">
                <span className="finance-overview-number">
                  {debtSummary.totalMinimumPayment.toFixed(2)}
                </span>
                <span className="finance-overview-unit">¥</span>
              </p>
            </article>
            <article
              className={`repayment-overview-stat repayment-overview-pressure-${pressureLevel.tone}`}
            >
              <p className="finance-overview-label">⚠️ 负债率（{pressureLevel.label}）</p>
              <p className="finance-overview-value">
                <span className="finance-overview-number">
                  {(debtSummary.pressureRatio * 100).toFixed(1)}
                </span>
                <span className="finance-overview-unit">%</span>
              </p>
            </article>
            <article className="repayment-overview-stat repayment-overview-health">
              <p className="finance-overview-label">
                🩺 负债健康度
                <span
                  className="finance-metric-help"
                  title="健康度≈(1-最低月还款/可用月收入)×100。数值越高，现金流压力越低。"
                  aria-label="负债健康度说明"
                >
                  ⓘ
                </span>
              </p>
              <p className="finance-overview-value">
                <span className="finance-overview-number">{debtHealthScore}</span>
                <span className="finance-overview-unit">/100</span>
              </p>
            </article>
            <article className="repayment-overview-stat">
              <p className="finance-overview-label">🗂️ 历史负债</p>
              <p className="finance-overview-value">
                <span className="finance-overview-number">{archivedDebts.length}</span>
                <span className="finance-overview-unit">笔</span>
              </p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                余额合计 ¥{archivedTotalDebt.toFixed(2)}
              </p>
            </article>
            <article className="repayment-overview-stat repayment-overview-income">
              <p className="finance-overview-label">💼 月收入</p>
              <p className="finance-overview-value">
                <span className="finance-overview-number">
                  {monthlyIncome > 0 ? monthlyIncome.toFixed(2) : '--'}
                </span>
                <span className="finance-overview-unit">¥</span>
              </p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                来源：{incomeConfidenceTag}
              </p>
            </article>
          </div>
        ) : null}

        <div className="finance-overview-income-actions repayment-income-toolbar">
          <div className="repayment-income-toolbar-copy">
            <strong>月收入设置</strong>
            <span>用于计算负债压力和还款建议</span>
          </div>
          <button
            type="button"
            className="finance-income-inline-action repayment-income-ai-button"
            onClick={() => void resolveMonthlyIncomeByAi(true)}
            disabled={incomeLoading}
          >
            <span aria-hidden="true">✦</span> {incomeLoading ? '估算中...' : 'AI 智能估算'}
          </button>
          <form className="repayment-income-editor" onSubmit={onManualIncomeSubmit}>
            <label className="repayment-income-field">
              <span className="repayment-income-currency" aria-hidden="true">
                ¥
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={manualIncomeInput}
                onChange={(event) => setManualIncomeInput(event.target.value)}
                placeholder="输入每月税后收入"
                aria-label="手动月收入"
              />
            </label>
            <button type="submit" className="primary repayment-income-save-button">
              保存收入
            </button>
          </form>
        </div>
        {incomeHint ? <p className="muted finance-income-inline-hint">{incomeHint}</p> : null}

        <input
          ref={fileInputRef}
          type="file"
          title="上传负债截图"
          aria-label="上传负债截图"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onExtractDebtFromScreenshot}
        />

        <div className="repayment-list-detail-layout">
          <div className="repayment-debt-list-panel">
            <div className="repayment-debt-list-header">
              <h3>
                负债列表 <span className="muted">({debts.length})</span>
              </h3>
              <div className="repayment-debt-list-actions">
                <button
                  type="button"
                  className="repayment-debt-list-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extractLoading}
                >
                  {extractLoading ? '识别中…' : '📷 识别'}
                </button>
                <button
                  type="button"
                  className="primary repayment-debt-list-btn"
                  onClick={() => {
                    setEditingDebtId('');
                    setDebtEntryMode('simple');
                    setSimpleDueDate('');
                    setSimpleDueTime('');
                    setDebtName('');
                    setDebtBalance('');
                    setDebtBalanceManuallyEdited(false);
                    setDebtAnnualRate('');
                    setDebtMonths('');
                    setDebtTotalPeriods('');
                    setDebtPaidPeriods('');
                    setDebtLoanPrincipal('');
                    setDebtTotalRepayment('');
                    setDebtBillDay('');
                    setDebtRepaymentDay('');
                    setDebtPaymentAccount('');
                    setDebtRepaymentMethod('minimum-payment');
                    setDebtRepaymentRecordMode('manual');
                    setDebtStatus('active');
                    setDebtFormError('');
                    setPrefillHint('');
                    setShowAddDebtModal(true);
                  }}
                >
                  + 新增
                </button>
              </div>
            </div>

            <div className="repayment-debt-list-tools" aria-label="负债筛选和排序">
              <label>
                <span>筛选</span>
                <select value={debtFilter} onChange={(event) => setDebtFilter(event.target.value as typeof debtFilter)}>
                  <option value="all">全部</option>
                  <option value="active">活跃负债</option>
                  <option value="missing">待补信息</option>
                  <option value="inactive">已结清/关闭</option>
                </select>
              </label>
              <label>
                <span>排序</span>
                <select value={debtSort} onChange={(event) => setDebtSort(event.target.value as typeof debtSort)}>
                  <option value="due">还款日</option>
                  <option value="balance">剩余本金</option>
                  <option value="apr">APR</option>
                  <option value="payment">月供</option>
                  <option value="name">名称</option>
                </select>
              </label>
            </div>

            {visibleRepaymentLedgerPreview.length === 0 ? (
              <div className="repayment-debt-list-empty">
                <span className="repayment-debt-list-empty-icon" aria-hidden>
                  📋
                </span>
                <p className="muted" style={{ margin: '4px 0 0 0' }}>
                  还没有负债记录
                </p>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  点击「新增」或「识别」开始
                </p>
              </div>
            ) : (
              <div className="repayment-debt-list">
                {visibleRepaymentLedgerPreview.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`repayment-debt-list-item${selectedDebtId === item.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedDebtId(item.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setDebtContextMenu({ id: item.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <span className={`repayment-debt-status-dot tone-${item.statusTone}`} />
                    <div className="repayment-debt-list-item-main">
                      <strong>{item.name}</strong>
                      <span className="muted">
                        {item.isSimpleReminder
                          ? `还款提醒 · ${item.simpleDueDate || '日期待补'}${item.simpleDueTime ? ` ${item.simpleDueTime}` : ''}`
                          : <>
                              {item.type === 'credit-card'
                                ? '信用卡'
                                : item.type === 'consumer-loan'
                                  ? '消费贷'
                                  : '贷款'}
                              {' · ¥'}
                              {item.principal.toFixed(0)}
                            </>}
                      </span>
                    </div>
                    <span className={`repayment-debt-due-badge tone-${item.statusTone}`}>
                      {item.statusLabel}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {debtContextMenu ? (
              <div
                className="repayment-debt-context-menu"
                style={{ left: debtContextMenu.x, top: debtContextMenu.y }}
                role="menu"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    const item = debtsWithStatus.find((debt) => debt.id === debtContextMenu.id);
                    if (item) startEditingDebt(item);
                    setDebtContextMenu(null);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDebtId(debtContextMenu.id);
                    const item = debtsWithStatus.find((debt) => debt.id === debtContextMenu.id);
                    if (item) startEditingDebt(item);
                    setDebtContextMenu(null);
                  }}
                >
                  {isSimpleRepaymentReminder(debtsWithStatus.find((debt) => debt.id === debtContextMenu.id) as DebtItem)
                    ? '编辑提醒时间'
                    : '设置还款日'}
                </button>
                {!isSimpleRepaymentReminder(debtsWithStatus.find((debt) => debt.id === debtContextMenu.id) as DebtItem) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDebtId(debtContextMenu.id);
                      setRepaymentDebtId(debtContextMenu.id);
                      setRepaymentAmount('');
                      setDebtContextMenu(null);
                      window.setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="实际还款金额"]')?.focus(), 0);
                    }}
                  >
                    登记还款
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    const item = debtsWithStatus.find((debt) => debt.id === debtContextMenu.id);
                    if (item) updateDebt(item.id, { ...item, status: 'settled', balance: 0 });
                    setDebtContextMenu(null);
                  }}
                >
                  结清
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    removeDebt(debtContextMenu.id);
                    setDebtContextMenu(null);
                  }}
                >
                  删除
                </button>
              </div>
            ) : null}
          </div>

          <div className="repayment-debt-detail-panel">
            {selectedDebt && selectedDebtOriginal ? (
              <>
                <div className="repayment-debt-detail-header">
                  <div>
                    <h3 style={{ margin: 0 }}>{selectedDebt.name}</h3>
                    <p className="muted" style={{ margin: '4px 0 0 0' }}>
                      {selectedDebt.isSimpleReminder
                        ? '还款提醒'
                        : selectedDebt.type === 'credit-card'
                        ? '信用卡'
                        : selectedDebt.type === 'consumer-loan'
                          ? '消费贷'
                          : '贷款'}
                      {' · '}
                      {selectedDebt.lifecycleStatusLabel}
                      {Number.isFinite(selectedDebt.dueInDays)
                        ? ` · ${selectedDebt.statusLabel}`
                        : ''}
                    </p>
                  </div>
                  <div className="repayment-debt-detail-actions">
                    <button type="button" onClick={() => startEditingDebt(selectedDebtOriginal)}>
                      ✏️ 编辑
                    </button>
                    {(['active', 'settled', 'closed', 'paused'] as DebtLifecycleStatus[])
                      .filter((s) => s !== selectedDebt.lifecycleStatus)
                      .map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() =>
                            updateDebt(selectedDebtId, { ...selectedDebtOriginal, status: s })
                          }
                        >
                          {s === 'active'
                            ? '恢复'
                            : s === 'settled'
                              ? '结清'
                              : s === 'closed'
                                ? '关闭'
                                : '暂缓'}
                        </button>
                      ))}
                    <button type="button" onClick={() => removeDebt(selectedDebtId)}>
                      🗑 删除
                    </button>
                  </div>
                </div>

                {selectedDebt.isSimpleReminder ? (
                  <div className="repayment-debt-detail-metrics repayment-debt-detail-metrics-core">
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">还款日期</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.simpleDueDate || '待补充'}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">还款时间</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.simpleDueTime || '待补充'}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">金额</span>
                      <span className="repayment-debt-metric-value">待补充</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="repayment-debt-detail-metrics repayment-debt-detail-metrics-core">
                      <div className="repayment-debt-metric">
                        <span className="repayment-debt-metric-label">剩余本金</span>
                        <span className="repayment-debt-metric-value">¥{selectedDebt.principal.toFixed(2)}</span>
                      </div>
                      <div className="repayment-debt-metric">
                        <span className="repayment-debt-metric-label">最低/期供</span>
                        <span className="repayment-debt-metric-value">¥{selectedDebt.minimumPayment.toFixed(2)}</span>
                      </div>
                      <div className="repayment-debt-metric">
                        <span className="repayment-debt-metric-label">年化利率</span>
                        <span className="repayment-debt-metric-value">{selectedDebt.apr > 0 ? `${selectedDebt.apr.toFixed(2)}%` : '待补充'}</span>
                      </div>
                      <div className="repayment-debt-metric">
                        <span className="repayment-debt-metric-label">预计月供</span>
                        <span className="repayment-debt-metric-value">¥{selectedDebt.estimatedMonthlyPayment.toFixed(2)}</span>
                      </div>
                      <div className="repayment-debt-metric">
                        <span className="repayment-debt-metric-label">还款日</span>
                        <span className="repayment-debt-metric-value">{selectedDebt.repaymentDay || '--'} 日</span>
                      </div>
                    </div>

                    <details className="repayment-debt-more-details">
                      <summary>更多详情 <small>利息、账户、期数等</small></summary>
                      <div className="repayment-debt-detail-metrics repayment-debt-detail-metrics-secondary">
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">月利率</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.monthlyRate > 0 ? `${selectedDebt.monthlyRate.toFixed(3)}%` : '—'}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">日利率</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.dailyRate > 0 ? `${selectedDebt.dailyRate.toFixed(4)}%` : '—'}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">剩余利息</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.remainingInterestCost !== null ? `¥${selectedDebt.remainingInterestCost.toFixed(2)}` : '待补充'}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">剩余总成本</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.remainingTotalCost !== null ? `¥${selectedDebt.remainingTotalCost.toFixed(2)}` : '待补充'}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">账单日</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.billDay || '--'} 日</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">扣款账户</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.paymentAccount || '未设置'}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">还款方式</span>
                      <span className="repayment-debt-metric-value">{REPAYMENT_METHOD_LABELS[selectedDebt.repaymentMethod]}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">记录方式</span>
                      <span className="repayment-debt-metric-value">{REPAYMENT_RECORD_MODE_LABELS[selectedDebt.repaymentRecordMode]}</span>
                    </div>
                    <div className="repayment-debt-metric">
                      <span className="repayment-debt-metric-label">期数</span>
                      <span className="repayment-debt-metric-value">{selectedDebt.totalPeriods ? `${selectedDebt.paidPeriods || 0}/${selectedDebt.totalPeriods}` : selectedDebt.remainingMonths ? `剩余 ${selectedDebt.remainingMonths} 期` : '--'}</span>
                    </div>
                      </div>
                    </details>
                  </>
                )}

                {selectedDebt.missingFields.length > 0 ? (
                  <p className="muted" style={{ margin: '8px 0 0 0' }}>
                    待补字段：{selectedDebt.missingFields.join('、')}
                  </p>
                ) : null}

                {!selectedDebt.isSimpleReminder ? <div className="repayment-debt-detail-repay">
                  <h4 style={{ margin: '0 0 8px 0' }}>💸 登记还款</h4>
                  <form onSubmit={onAddRepaymentRecord} className="repayment-inline-form">
                    <RepaymentUnitInput
                      value={repaymentAmount}
                      onChange={(value) => {
                        setRepaymentAmount(value);
                        setRepaymentRecordError('');
                      }}
                      unit="¥"
                      min={0}
                      step="0.01"
                      placeholder="实际还款金额"
                      ariaLabel="实际还款金额"
                    />
                    <input
                      className="finance-debt-form-control"
                      type="date"
                      value={repaymentPaidAt}
                      onChange={(event) => {
                        setRepaymentPaidAt(event.target.value);
                        setRepaymentRecordError('');
                      }}
                      aria-label="实际还款日期"
                    />
                    <input
                      className="finance-debt-form-control"
                      value={repaymentPaymentAccount}
                      onChange={(event) => {
                        setRepaymentPaymentAccount(event.target.value);
                        setRepaymentRecordError('');
                      }}
                      placeholder="实际扣款账户"
                      aria-label="实际扣款账户"
                    />
                    <select
                      className="finance-debt-form-control"
                      value={repaymentRecordModeInput}
                      onChange={(event) => {
                        setRepaymentRecordModeInput(event.target.value as DebtRepaymentRecordMode);
                        setRepaymentRecordError('');
                      }}
                      aria-label="还款记录方式"
                    >
                      <option value="manual">手动登记</option>
                      <option value="transaction-match">交易匹配</option>
                      <option value="auto-debit">自动扣款</option>
                    </select>
                    <input
                      className="finance-debt-form-control"
                      value={repaymentNote}
                      onChange={(event) => {
                        setRepaymentNote(event.target.value);
                        setRepaymentRecordError('');
                      }}
                      placeholder="备注（可选）"
                      aria-label="备注"
                    />
                    <button type="submit" className="primary" disabled={!selectedDebtOriginal}>
                      + 记录还款
                    </button>
                  </form>
                  {repaymentRecordError ? (
                    <p className="muted finance-debt-form-error">{repaymentRecordError}</p>
                  ) : null}
                </div> : null}

                {!selectedDebt.isSimpleReminder ? <div className="repayment-debt-detail-records">
                  <h4 style={{ margin: '0 0 8px 0' }}>
                    📜 还款记录 ({selectedDebtRecords.length})
                  </h4>
                  {selectedDebtRecords.length === 0 ? (
                    <p className="muted">还没有还款记录，先登记一笔。</p>
                  ) : (
                    <div className="finance-debt-recent-list">
                      {selectedDebtRecords.map((item) => (
                        <div key={item.id} className="finance-debt-item">
                          <div>
                            <strong>¥{item.amount.toFixed(2)}</strong>
                            <p className="muted" style={{ margin: 0 }}>
                              {item.paidAt} · {item.paymentAccount || '未填扣款账户'} ·{' '}
                              {REPAYMENT_RECORD_MODE_LABELS[item.recordMode]}
                            </p>
                            {item.note ? (
                              <p className="muted" style={{ margin: '4px 0 0 0' }}>
                                备注：{item.note}
                              </p>
                            ) : null}
                          </div>
                          <button type="button" onClick={() => removeRepaymentRecord(item.id)}>
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div> : null}
              </>
            ) : (
              <div className="repayment-debt-detail-empty">
                <span className="repayment-debt-detail-empty-icon" aria-hidden>
                  📋
                </span>
                <p className="muted">从左侧列表选择一笔负债查看详情</p>
              </div>
            )}
          </div>
        </div>

        <section className="repayment-ai-section">
          <div className="repayment-ai-header">
            <div>
              <span className="repayment-ai-eyebrow">智能策略</span>
              <h3>🤖 AI 还款策略</h3>
            </div>
            <button type="button" onClick={onGenerateRepaymentAdvice} disabled={repaymentLoading}>
              {repaymentLoading ? '生成中…' : repaymentAdvice ? '更新建议' : '生成建议'}
            </button>
          </div>

          <div className="repayment-ai-summary" aria-label="AI 还款策略摘要">
            <div className="repayment-ai-summary-item">
              <span>优先处理</span>
              <strong>{strategyReadiness.isReady ? repaymentPriority[0]?.name || '暂无负债' : '先补齐资料'}</strong>
              <small>
                {!strategyReadiness.isReady
                  ? strategyReadiness.missing.slice(0, 2).join(' · ')
                  : repaymentPriority[0]
                  ? `APR ${repaymentPriority[0].annualRate.toFixed(1)}% · ¥${repaymentPriority[0].balance.toFixed(0)}`
                  : '录入负债后自动排序'}
              </small>
            </div>
            <div className={`repayment-ai-summary-item tone-${pressureLevel.tone}`}>
              <span>月供压力</span>
              <strong>{(debtSummary.pressureRatio * 100).toFixed(1)}%</strong>
              <small>
                {pressureLevel.label} · 负债/年收入 {(debtToIncomeRatio * 100).toFixed(1)}%
              </small>
            </div>
            <div className="repayment-ai-summary-item">
              <span>推荐方案</span>
              <strong>
                {strategyReadiness.isReady && simulatorResult.best
                  ? REPAYMENT_STRATEGY_LABELS[simulatorResult.best.strategy].split('（')[0]
                  : '暂不测算'}
              </strong>
              <small>
                {strategyReadiness.isReady && simulatorResult.best
                  ? `少 ${simulatorResult.best.savedMonths} 个月 · 省 ¥${simulatorResult.best.savedInterest.toFixed(0)}`
                  : '年化利率、还款日和期供完整后再比较'}
              </small>
            </div>
            <label className="repayment-ai-extra" htmlFor="simulator-extra">
              <span>每月多还</span>
              <div className="repayment-ai-extra-input">
                <span>¥</span>
                <input
                  id="simulator-extra"
                  type="number"
                  min={0}
                  step="1"
                  value={simulatorExtraPayment}
                  onChange={(event) => setSimulatorExtraPayment(event.target.value)}
                  disabled={!strategyReadiness.isReady}
                />
              </div>
            </label>
          </div>

          {repaymentCacheHint ? (
            <p className="muted repayment-ai-hint">{repaymentCacheHint}</p>
          ) : null}

          <details className="repayment-ai-details">
            <summary>
              <span>查看完整分析</span>
              <small>优先级 · 三种策略 · 风险 · 到期</small>
            </summary>
            <div className="repayment-ai-details-body">
              <section className="repayment-ai-detail-block">
                <h4>推荐还款优先级</h4>
                {!strategyReadiness.isReady ? (
                  <p className="muted">当前不使用默认利率推断优先级。请先补齐 {strategyReadiness.missing.join('；')}。</p>
                ) : repaymentPriority.length === 0 ? (
                  <p className="muted">请先创建至少一笔负债。</p>
                ) : (
                  <ol className="repayment-ai-priority-list">
                    {repaymentPriority.map((item) => (
                      <li key={item.id}>
                        <strong>{item.name}</strong>
                        <span>
                          APR {item.annualRate.toFixed(1)}% · 余额 ¥{item.balance.toFixed(0)} · 最低
                          ¥{item.minimumPayment.toFixed(0)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="repayment-ai-detail-block">
                <h4>策略对比</h4>
                {!strategyReadiness.isReady ? (
                  <p className="muted">资料不完整，暂不展示可能误导的节省金额。</p>
                ) : (
                  <div className="repayment-ai-comparison">
                    {simulatorResult.strategyComparison.map((result) => (
                      <div key={result.strategy}>
                        <strong>{REPAYMENT_STRATEGY_LABELS[result.strategy]}</strong>
                        <span>加速后 {result.accelerated.months} 个月</span>
                        <span>省 {result.savedMonths} 个月 / ¥{result.savedInterest.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="repayment-ai-detail-block">
                <h4>风险标签与解释</h4>
                {debtRiskTags.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    当前未发现明显的高利率、到期集中、账户缺失或已还流水缺口。
                  </p>
                ) : (
                  <div className="finance-risk-tag-grid">
                    {debtRiskTags.map((tag) => (
                      <div
                        key={tag.id}
                        className={`finance-risk-tag-card finance-risk-tag-${tag.tone}`}
                      >
                        <div className="finance-risk-tag-head">
                          <strong>{tag.label}</strong>
                          <span>
                            {tag.dimension === 'rate'
                              ? '利率'
                              : tag.dimension === 'schedule'
                                ? '计划'
                                : tag.dimension === 'account'
                                  ? '账户'
                                  : tag.dimension === 'actual'
                                    ? '流水'
                                    : '资料'}
                          </span>
                        </div>
                        <p className="muted" style={{ margin: '8px 0 0' }}>
                          {tag.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="repayment-ai-detail-block">
                <h4>严谨性审计提醒</h4>
                {repaymentAuditItems.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    当前负债条目已具备基础的日期、扣款账户与计算依据字段。
                  </p>
                ) : (
                  <ul className="finance-audit-list">
                    {repaymentAuditItems.map((item) => (
                      <li key={item.id} className={`finance-audit-item finance-audit-${item.tone}`}>
                        {item.text}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="repayment-ai-detail-block">
                <h4>计划 / 账户 / 已还流水</h4>
                {repaymentContextSnapshots.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    请先录入至少一笔负债。
                  </p>
                ) : (
                  <div className="finance-risk-tag-grid">
                    {repaymentContextSnapshots.slice(0, 6).map((item) => (
                      <div
                        key={item.debtId}
                        className="finance-risk-tag-card finance-risk-tag-info"
                      >
                        <div className="finance-risk-tag-head">
                          <strong>{item.debtName}</strong>
                          <span>3.4 预留</span>
                        </div>
                        <p className="muted" style={{ margin: '8px 0 0' }}>
                          计划还款日：{item.plannedRepaymentDay || '--'} 日 · 计划账户：
                          {item.plannedPaymentAccount || '未设置'}
                        </p>
                        <p className="muted" style={{ margin: '4px 0 0' }}>
                          已发生还款：{item.actualRepaymentCount} 笔
                          {item.latestActualRepaymentAt
                            ? ` · 最近一次 ${item.latestActualRepaymentAt}`
                            : ''}
                        </p>
                        <p className="muted" style={{ margin: '4px 0 0' }}>
                          实际账户：
                          {item.actualPaymentAccounts.length > 0
                            ? item.actualPaymentAccounts.join(' / ')
                            : '暂无流水记录'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="repayment-ai-detail-block">
                <h4>到期提醒</h4>
                {repaymentLedgerPreview.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    请先在负债列表中创建至少一条记录。
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {repaymentLedgerPreview.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        {item.isSimpleReminder
                          ? <>
                              {item.name}：{item.simpleDueDate || '日期待补充'}
                              {item.simpleDueTime ? ` ${item.simpleDueTime}` : ''}，
                              {Number.isFinite(item.dueInDays)
                                ? item.dueInDays < 0
                                  ? `已逾期 ${Math.abs(item.dueInDays)} 天`
                                  : item.dueInDays === 0
                                    ? '今天待处理'
                                    : `${item.dueInDays} 天后待处理`
                                : '待补还款时间'}（金额待补充）
                            </>
                          : <>
                              {item.name}：账单日 {item.billDay || '--'} 日，还款日{' '}
                              {item.repaymentDay || '--'} 日，
                              {Number.isFinite(item.dueInDays)
                                ? item.dueInDays === 0
                                  ? '今天到期'
                                  : `${item.dueInDays} 天后到期`
                                : '待补还款日'}
                              （最低 ¥{item.minimumPayment.toFixed(0)}）
                            </>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {repaymentAdvice ? (
                <>
                  <p className="finance-generate-done">
                    ✅ AI建议已生成，可继续调整参数后重新生成。
                  </p>
                  <div className="finance-ai-result">{renderAiStructuredText(repaymentAdvice)}</div>
                </>
              ) : (
                <p className="muted" style={{ marginBottom: 0 }}>
                  还没有策略建议，点击“生成 AI 还款建议”继续。
                </p>
              )}
              {repaymentReasoning ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer' }}>查看模型思考摘要</summary>
                  <div className="finance-ai-result">
                    {renderAiStructuredText(repaymentReasoning)}
                  </div>
                </details>
              ) : null}
            </div>
          </details>
        </section>

        {showAddDebtModal ? (
          <div
            className="dialog-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) setShowAddDebtModal(false);
            }}
          >
            <div
              className="dialog repayment-debt-modal"
              role="dialog"
              aria-label={editingDebtId ? '编辑负债' : '新增负债'}
            >
              <div className="dialog-header">
                <span>{editingDebtId ? '编辑负债' : '新增负债'}</span>
                <button
                  type="button"
                  className="repayment-modal-close"
                  onClick={() => setShowAddDebtModal(false)}
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
              <div className="dialog-body">
                {!editingDebtId ? (
                  <div className="debt-entry-mode-switch" role="tablist" aria-label="录入方式">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={debtEntryMode === 'simple'}
                      className={debtEntryMode === 'simple' ? 'is-active' : ''}
                      onClick={() => {
                        setDebtEntryMode('simple');
                        setDebtFormError('');
                      }}
                    >
                      简单录入
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={debtEntryMode === 'standard'}
                      className={debtEntryMode === 'standard' ? 'is-active' : ''}
                      onClick={() => {
                        setDebtEntryMode('standard');
                        setDebtFormError('');
                      }}
                    >
                      完整录入
                    </button>
                  </div>
                ) : null}

                {debtEntryMode === 'standard' ? <>
                <div className="finance-debt-dual-entry">
                  <button
                    type="button"
                    className="finance-debt-entry-action button-with-icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={extractLoading}
                  >
                    <img src={IMAGE_ICON_URL} alt="" aria-hidden="true" />
                    {extractLoading
                      ? '正在识别…'
                      : extractSuccess
                        ? '识别完成'
                        : '上传账单自动识别'}
                  </button>
                  <span className="muted">支持支付宝/银行/信用卡账单截图。</span>
                </div>

                {debtImagePreview ? (
                  <img
                    src={debtImagePreview}
                    alt="负债截图预览"
                    style={{
                      marginTop: 10,
                      maxWidth: 260,
                      borderRadius: 8,
                      border: '1px solid var(--color-border-light)',
                      boxShadow: '0 6px 16px color-mix(in srgb, var(--color-text) 8%, transparent)'
                    }}
                  />
                ) : null}

                {prefillHint ? (
                  <div className="finance-prefill-hint" role="status">
                    {prefillHint}
                  </div>
                ) : null}

                <p className="muted" style={{ margin: '12px 0 8px 0' }}>
                  先填写名称和剩余本金；贷款可再补充期数，自动估算后续还款。
                </p>

                <form onSubmit={onAddDebt} className="debt-form-line">
                  <div className="debt-form-core">
                    <label className="debt-form-field">
                      <span className="debt-form-field-label">名称</span>
                      <input
                        className="debt-form-input"
                        value={debtName}
                        onChange={(event) => {
                          setDebtName(event.target.value);
                          setDebtFormError('');
                        }}
                        placeholder="招商信用卡"
                        aria-label="负债名称"
                      />
                    </label>
                    <label className="debt-form-field">
                      <span className="debt-form-field-label">类型</span>
                      <select
                        className="debt-form-input"
                        value={debtType}
                        onChange={(event) => setDebtType(event.target.value as DebtType)}
                        aria-label="负债类型"
                      >
                        <option value="credit-card">信用类负债</option>
                        <option value="loan">贷款</option>
                      </select>
                    </label>
                    <label className="debt-form-field">
                      <span className="debt-form-field-label">剩余本金</span>
                      <span className="debt-form-money">
                        <span className="debt-form-money-unit">¥</span>
                        <input
                          className="debt-form-input debt-form-input-money"
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={debtBalance}
                          onChange={(event) => {
                            setDebtBalanceManuallyEdited(event.target.value.trim().length > 0);
                            setDebtBalance(event.target.value);
                            setDebtFormError('');
                          }}
                          placeholder="0.00"
                          aria-label="剩余本金"
                        />
                      </span>
                      {calculatedRemainingPrincipal !== null ? (
                        <span className="debt-form-auto-hint">
                          已自动估算：¥{calculatedRemainingPrincipal.toFixed(2)}
                          {debtBalanceManuallyEdited ? '（已保留手动填写金额）' : ''}
                        </span>
                      ) : null}
                    </label>
                  </div>

                  {isLoanType ? (
                    <section className="debt-plan-mode">
                      <div className="debt-plan-mode-copy">
                        <strong>还款计划方式</strong>
                        <span>不知道总还款时，选择手动逐期计划最方便。</span>
                      </div>
                      <div className="debt-plan-mode-switch" role="tablist" aria-label="还款计划方式">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={debtPlanMode === 'structured'}
                          className={`debt-plan-mode-option ${debtPlanMode === 'structured' ? 'is-active' : ''}`}
                          onClick={() => {
                            setDebtPlanMode('structured');
                            setDebtFormError('');
                          }}
                        >
                          按总期数
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={debtPlanMode === 'manual'}
                          className={`debt-plan-mode-option ${debtPlanMode === 'manual' ? 'is-active' : ''}`}
                          onClick={() => {
                            setDebtPlanMode('manual');
                            if (debtManualRepayments.length === 0) addManualRepaymentRow();
                            setDebtFormError('');
                          }}
                        >
                          手动逐期
                        </button>
                      </div>
                    </section>
                  ) : null}

                  <div className="debt-form-fields debt-form-fields--conditional">
                    <details className="debt-form-extra">
                      <summary>补充设置 <small>还款日、账户和记录方式</small></summary>
                      <div className="debt-form-extra-grid">
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">还款日</span>
                        <span className="debt-form-money">
                          <input
                            className="debt-form-input debt-form-input-money"
                            type="number"
                            min={1}
                            max={31}
                            value={debtRepaymentDay}
                            onChange={(event) => {
                              setDebtRepaymentDay(event.target.value);
                              setDebtFormError('');
                            }}
                            placeholder="—"
                            aria-label="还款日"
                          />
                          <span className="debt-form-money-unit">日</span>
                        </span>
                      </label>
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">账单日</span>
                        <span className="debt-form-money">
                          <input
                            className="debt-form-input debt-form-input-money"
                            type="number"
                            min={1}
                            max={31}
                            value={debtBillDay}
                            onChange={(event) => {
                              setDebtBillDay(event.target.value);
                              setDebtFormError('');
                            }}
                            placeholder="—"
                            aria-label="账单日"
                            disabled={isLoanType}
                          />
                          <span className="debt-form-money-unit">日</span>
                        </span>
                      </label>
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">扣款账户</span>
                        <input
                          className="debt-form-input"
                          list="repayment-account-options"
                          value={debtPaymentAccount}
                          onChange={(event) => {
                            setDebtPaymentAccount(event.target.value);
                            setDebtFormError('');
                          }}
                          placeholder="从账户中选择（可留空）"
                          aria-label="扣款账户"
                        />
                      </label>
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">还款方式</span>
                        <select
                          className="debt-form-input"
                          value={debtRepaymentMethod}
                          onChange={(event) => {
                            setDebtRepaymentMethod(event.target.value as DebtRepaymentMethod);
                            setDebtFormError('');
                          }}
                          aria-label="还款方式"
                        >
                          <option value="minimum-payment">最低还款</option>
                          <option value="equal-installment">等额本息</option>
                          <option value="equal-principal">等额本金</option>
                          <option value="custom">自定义</option>
                        </select>
                      </label>
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">记录方式</span>
                        <select
                          className="debt-form-input"
                          value={debtRepaymentRecordMode}
                          onChange={(event) => {
                            setDebtRepaymentRecordMode(
                              event.target.value as DebtRepaymentRecordMode
                            );
                            setDebtFormError('');
                          }}
                          aria-label="记录方式"
                        >
                          <option value="manual">手动登记</option>
                          <option value="transaction-match">交易匹配</option>
                          <option value="auto-debit">自动扣款</option>
                        </select>
                      </label>
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">状态</span>
                        <select
                          className="debt-form-input"
                          value={debtStatus}
                          onChange={(event) => {
                            setDebtStatus(event.target.value as DebtLifecycleStatus);
                            setDebtFormError('');
                          }}
                          aria-label="负债状态"
                        >
                          <option value="active">进行中</option>
                          <option value="settled">已结清</option>
                          <option value="closed">已关闭</option>
                          <option value="paused">暂缓处理</option>
                        </select>
                      </label>
                      </div>
                    </details>
                      {isLoanType && debtPlanMode === 'structured' ? (
                        <>
                          <label className="debt-form-field">
                            <span className="debt-form-field-label">年化利率</span>
                            <span className="debt-form-money">
                              <input
                                className="debt-form-input debt-form-input-money"
                                type="number"
                                min={0}
                                step="0.01"
                                inputMode="decimal"
                                value={debtAnnualRate}
                                onChange={(event) => {
                                  setDebtAnnualRate(event.target.value);
                                  setDebtFormError('');
                                }}
                                placeholder="可留空"
                                aria-label="年化利率"
                              />
                              <span className="debt-form-money-unit">%</span>
                            </span>
                          </label>
                          <label className="debt-form-field">
                            <span className="debt-form-field-label">剩余期数</span>
                            <span className="debt-form-money">
                              <input
                                className="debt-form-input debt-form-input-money"
                                type="number"
                                min={1}
                                value={debtMonths}
                                onChange={(event) => {
                                  fillDebtPeriodGap('remaining', event.target.value);
                                  setDebtFormError('');
                                }}
                                placeholder="—"
                                aria-label="剩余期数"
                              />
                              <span className="debt-form-money-unit">月</span>
                            </span>
                          </label>
                          <label className="debt-form-field">
                            <span className="debt-form-field-label">总期数</span>
                            <span className="debt-form-money">
                              <input
                                className="debt-form-input debt-form-input-money"
                                type="number"
                                min={1}
                                value={debtTotalPeriods}
                                onChange={(event) => {
                                  fillDebtPeriodGap('total', event.target.value);
                                  setDebtFormError('');
                                }}
                                placeholder="—"
                                aria-label="总期数"
                              />
                              <span className="debt-form-money-unit">期</span>
                            </span>
                          </label>
                          <label className="debt-form-field">
                            <span className="debt-form-field-label">已还期数</span>
                            <span className="debt-form-money">
                              <input
                                className="debt-form-input debt-form-input-money"
                                type="number"
                                min={0}
                                value={debtPaidPeriods}
                                onChange={(event) => {
                                  fillDebtPeriodGap('paid', event.target.value);
                                  setDebtFormError('');
                                }}
                                placeholder="—"
                                aria-label="已还期数"
                              />
                              <span className="debt-form-money-unit">期</span>
                            </span>
                          </label>
                          <label className="debt-form-field">
                            <span className="debt-form-field-label">借款金额</span>
                            <span className="debt-form-money">
                              <span className="debt-form-money-unit">¥</span>
                              <input
                                className="debt-form-input debt-form-input-money"
                                type="number"
                                min={0}
                                step="0.01"
                                inputMode="decimal"
                                value={debtLoanPrincipal}
                                onChange={(event) => {
                                  setDebtLoanPrincipal(event.target.value);
                                  setDebtFormError('');
                                }}
                                placeholder="—"
                                aria-label="借款金额"
                              />
                            </span>
                          </label>
                          <label className="debt-form-field">
                            <span className="debt-form-field-label">总还款</span>
                            <span className="debt-form-money">
                              <span className="debt-form-money-unit">¥</span>
                              <input
                                className="debt-form-input debt-form-input-money"
                                type="number"
                                min={0}
                                step="0.01"
                                inputMode="decimal"
                                value={debtTotalRepayment}
                                onChange={(event) => {
                                  setDebtTotalRepayment(event.target.value);
                                  setDebtFormError('');
                                }}
                                placeholder="—"
                                aria-label="总还款"
                              />
                            </span>
                          </label>
                        </>
                      ) : null}

                      {isLoanType && debtPlanMode === 'manual' ? (
                        <div className="debt-form-manual-schedule debt-form-manual-schedule--focus">
                          <div className="debt-form-manual-schedule-header">
                            <div>
                              <span className="debt-form-field-label">手动还款计划</span>
                              <small>从下一期开始填写日期和金额，系统会生成压力曲线</small>
                            </div>
                            <button
                              type="button"
                              className="debt-form-add-period"
                              onClick={addManualRepaymentRow}
                            >
                              + 添加期数
                            </button>
                          </div>

                          {debtManualRepayments.length > 0 ? (
                            <>
                              <div className="debt-form-manual-summary">
                                <span>共 {manualRepaymentCount} 期</span>
                                <strong>{formatCurrency(manualRepaymentTotal)}</strong>
                                <small>
                                  剩余 {formatCurrency(Math.max(0, effectiveBalance - manualRepaymentTotal))}
                                </small>
                              </div>
                              <div className="debt-form-manual-rows">
                                {debtManualRepayments.map((row, index) => (
                                  <div className="debt-form-manual-row" key={row.id || index}>
                                    <div className="debt-form-manual-index">{index + 1}</div>
                                    <label className="debt-form-field">
                                      <span className="debt-form-field-label">期数标签</span>
                                      <input
                                        className="debt-form-input"
                                        value={row.label || ''}
                                        onChange={(event) => {
                                          updateManualRepaymentRow(index, {
                                            label: event.target.value
                                          });
                                        }}
                                        placeholder={`第 ${index + 1} 期`}
                                        aria-label="期数标签"
                                      />
                                    </label>
                                    <label className="debt-form-field">
                                      <span className="debt-form-field-label">日期</span>
                                      <input
                                        className="debt-form-input"
                                        type="date"
                                        value={row.dueDate || ''}
                                        onChange={(event) => {
                                          updateManualRepaymentRow(index, {
                                            dueDate: event.target.value
                                          });
                                        }}
                                        aria-label="还款日期"
                                      />
                                    </label>
                                    <label className="debt-form-field">
                                      <span className="debt-form-field-label">金额</span>
                                      <span className="debt-form-money">
                                        <span className="debt-form-money-unit">¥</span>
                                        <input
                                          className="debt-form-input debt-form-input-money"
                                          type="number"
                                          min={0}
                                          step="0.01"
                                          inputMode="decimal"
                                          value={row.amount || ''}
                                          onChange={(event) => {
                                            updateManualRepaymentRow(index, {
                                              amount: Number(event.target.value)
                                            });
                                          }}
                                          placeholder="0.00"
                                          aria-label="还款金额"
                                        />
                                      </span>
                                    </label>
                                    <button
                                      type="button"
                                      className="debt-form-copy-period"
                                      onClick={() => {
                                        const previous = debtManualRepayments[index - 1];
                                        if (previous) {
                                          updateManualRepaymentRow(index, {
                                            amount: previous.amount
                                          });
                                        }
                                      }}
                                      aria-label="沿用上一期金额"
                                      title="沿用上一期金额"
                                    >
                                      同额
                                    </button>
                                    <button
                                      type="button"
                                      className="debt-form-remove-period"
                                      onClick={() => removeManualRepaymentRow(index)}
                                      aria-label="删除该期"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p className="debt-form-schedule-empty">
                              还没有手动计划。若不清楚总还款，建议从“下一期”开始逐期填写。
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>

                  <datalist id="repayment-account-options">
                    {financeAccounts
                      .filter((account) => account.name.trim())
                      .map((account) => (
                        <option key={account.id} value={account.name} />
                      ))}
                  </datalist>

                  {!canSubmitDebt && missingDebtFields.length > 0 ? (
                    <p className="debt-form-helper">
                      还差：{missingDebtFields.join('、')}
                    </p>
                  ) : null}
                  {debtFormError ? <p className="debt-form-error">{debtFormError}</p> : null}
                  <div className="debt-form-actions">
                    <button type="submit" className="primary" disabled={!canSubmitDebt}>
                      {addDebtSuccess
                        ? editingDebtId
                          ? '✔ 已更新'
                          : '✔ 已添加'
                        : editingDebtId
                          ? '保存修改'
                          : '+ 添加负债'}
                    </button>
                    {editingDebtId ? (
                      <button
                        type="button"
                        className="debt-form-cancel-btn"
                        onClick={() => resetDebtForm(true)}
                      >
                        取消编辑
                      </button>
                    ) : null}
                  </div>

                  {showDebtPressurePreview ? (
                    <section className="debt-pressure-preview" aria-label="还款压力预览">
                      <div className="debt-pressure-preview-header">
                        <div>
                          <strong>还款压力曲线</strong>
                          <span>红线表示每期还款金额，蓝线表示本金剩余压力</span>
                        </div>
                        <span className="debt-pressure-preview-tag">已生成</span>
                      </div>
                      <div className="debt-pressure-preview-summary">
                        <span>计划期数 {debtPressurePreview.length} 期</span>
                        <span>
                          总计划还款 {formatCurrency(debtPressurePreview.reduce((sum, item) => sum + item.amount, 0))}
                        </span>
                        <span>
                          首期压力 {formatCurrency(debtPressurePreview[0]?.amount || 0)}
                        </span>
                      </div>
                      <DebtPressureChart points={debtPressurePreview} />
                      <div className="debt-pressure-table">
                        {debtPressurePreview.slice(0, 6).map((item, index) => (
                          <div className="debt-pressure-table-row" key={`${item.period}-${index}`}>
                            <span>{item.period}</span>
                            <span>{formatShortDate(item.dueDate)}</span>
                            <strong>{formatCurrency(item.amount)}</strong>
                            <small>剩余 {formatCurrency(item.remaining)}</small>
                          </div>
                        ))}
                      </div>
                      <div className="debt-pressure-actions">
                        <button
                          type="button"
                          className="primary"
                          onClick={() => {
                            resetDebtForm(false);
                            setAddDebtSuccess(false);
                          }}
                        >
                          继续添加负债
                        </button>
                        <button
                          type="button"
                          className="debt-form-cancel-btn"
                          onClick={() => {
                            setAddDebtSuccess(false);
                            setShowDebtPressurePreview(false);
                            setDebtPressurePreview([]);
                            setShowAddDebtModal(false);
                          }}
                        >
                          完成并关闭
                        </button>
                      </div>
                    </section>
                  ) : null}
                </form>
                </> : (
                  <form onSubmit={onAddDebt} className="debt-form-line debt-simple-form">
                    <p className="debt-simple-form-intro">
                      先记下要处理的还款，金额和明细之后再补。
                    </p>
                    <div className="debt-simple-form-fields">
                      <label className="debt-form-field debt-simple-form-project">
                        <span className="debt-form-field-label">还款项目</span>
                        <input
                          className="debt-form-input"
                          value={debtName}
                          onChange={(event) => {
                            setDebtName(event.target.value);
                            setDebtFormError('');
                          }}
                          placeholder="例如：9 月信用卡账单"
                          autoFocus
                          aria-label="还款项目"
                        />
                      </label>
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">还款日期</span>
                        <input
                          className="debt-form-input"
                          type="date"
                          value={simpleDueDate}
                          onChange={(event) => {
                            setSimpleDueDate(event.target.value);
                            setDebtFormError('');
                          }}
                          aria-label="简单还款日期"
                        />
                      </label>
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">还款时间</span>
                        <input
                          className="debt-form-input"
                          type="time"
                          value={simpleDueTime}
                          onChange={(event) => {
                            setSimpleDueTime(event.target.value);
                            setDebtFormError('');
                          }}
                          aria-label="简单还款时间"
                        />
                      </label>
                    </div>
                    {debtFormError ? <p className="debt-form-error">{debtFormError}</p> : null}
                    <div className="debt-form-actions">
                      <button type="submit" className="primary" disabled={!canSubmitSimpleDebt}>
                        {addDebtSuccess ? '✔ 已添加' : '添加还款提醒'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {error ? <p className="muted">{error}</p> : null}
        <Toast
          visible={debtToastVisible}
          message="负债已添加"
          variant="success"
          duration={1200}
          onClose={() => setDebtToastVisible(false)}
        />
        <Toast
          visible={repaymentRecordToastVisible}
          message={repaymentRecordToastMessage}
          variant={repaymentRecordToastVariant}
          duration={1600}
          onClose={() => setRepaymentRecordToastVisible(false)}
        />
      </section>
    </div>
  );
}
