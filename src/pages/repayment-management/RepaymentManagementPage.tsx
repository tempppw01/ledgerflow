import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  DebtType
} from '../../features/debt/model/debtMetrics';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { IMAGE_ICON_URL } from '../../shared/config/brandAssets';
import { Toast } from '../../shared/ui/Toast';

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

const DEBT_STATUS_LABELS: Record<DebtLifecycleStatus, string> = {
  active: '进行中',
  settled: '已结清',
  closed: '已关闭',
  paused: '暂缓处理'
};

function normalizeDebtLifecycleStatus(status: DebtItem['status'], balance: number): DebtLifecycleStatus {
  if (status === 'settled' || status === 'closed' || status === 'paused' || status === 'active') {
    return status;
  }
  return balance <= 0 ? 'settled' : 'active';
}

function isDebtInactive(status: DebtLifecycleStatus): boolean {
  return status === 'settled' || status === 'closed' || status === 'paused';
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
    const ordered = line.match(/^\d+[\.、)]\s+(.+)/);
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

function FinanceCollapsibleSection({
  title,
  subtitle,
  icon,
  sideLabel,
  defaultOpen = false,
  className = '',
  children
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  sideLabel?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={`finance-collapsible ${className}`.trim()} open={defaultOpen}>
      <summary className="finance-collapsible-summary">
        <div className="finance-collapsible-summary-text">
          <h3>{title}</h3>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        <span className="finance-collapsible-summary-side">
          {sideLabel ? <span className="finance-collapsible-side-label">{sideLabel}</span> : null}
          {icon ? (
            <span className="finance-debt-entry-icon finance-collapsible-icon" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span className="finance-collapsible-chevron" aria-hidden>
            ▾
          </span>
        </span>
      </summary>
      <div className="finance-collapsible-body">{children}</div>
    </details>
  );
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
  const { value, onChange, unit, placeholder, ariaLabel, min, max, step, inputMode, disabled } = props;
  return (
    <label className={`finance-unit-input ${disabled ? 'is-disabled' : ''} ${value.trim() ? 'is-filled' : ''}`}>
      <input
        className="finance-debt-form-control"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
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
  const [error, setError] = useState('');
  const [debtName, setDebtName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('credit-card');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtAnnualRate, setDebtAnnualRate] = useState('');
  const [debtMonths, setDebtMonths] = useState('');
  const [debtTotalPeriods, setDebtTotalPeriods] = useState('');
  const [debtPaidPeriods, setDebtPaidPeriods] = useState('');
  const [debtLoanPrincipal, setDebtLoanPrincipal] = useState('');
  const [debtTotalRepayment, setDebtTotalRepayment] = useState('');
  const [debtBillDay, setDebtBillDay] = useState('');
  const [debtRepaymentDay, setDebtRepaymentDay] = useState('');
  const [debtPaymentAccount, setDebtPaymentAccount] = useState('');
  const [debtRepaymentMethod, setDebtRepaymentMethod] =
    useState<DebtRepaymentMethod>('minimum-payment');
  const [debtRepaymentRecordMode, setDebtRepaymentRecordMode] =
    useState<DebtRepaymentRecordMode>('manual');
  const [debtStatus, setDebtStatus] = useState<DebtLifecycleStatus>('active');
  const [debtGraceDays, setDebtGraceDays] = useState('0');
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
  const [repaymentRecordToastVariant, setRepaymentRecordToastVariant] = useState<'success' | 'warning'>('success');
  const [addDebtSuccess, setAddDebtSuccess] = useState(false);
  const [newDebtId, setNewDebtId] = useState('');
  const [repaymentDebtId, setRepaymentDebtId] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentPaidAt, setRepaymentPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [repaymentPaymentAccount, setRepaymentPaymentAccount] = useState('');
  const [repaymentNote, setRepaymentNote] = useState('');
  const [editingDebtId, setEditingDebtId] = useState('');
  const [repaymentRecordModeInput, setRepaymentRecordModeInput] =
    useState<DebtRepaymentRecordMode>('manual');
  const [repaymentRecordError, setRepaymentRecordError] = useState('');
  const [simulatorExtraPayment, setSimulatorExtraPayment] = useState('1000');
  const [prefillHint, setPrefillHint] = useState('');
  const debtIdsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const debtEntrySectionRef = useRef<HTMLDivElement | null>(null);

  const startEditingDebt = useCallback((item: DebtItem) => {
    setEditingDebtId(item.id);
    setDebtName(item.name || '');
    setDebtType(item.type || 'credit-card');
    setDebtBalance(String(item.balance ?? ''));
    setDebtAnnualRate(item.annualRate !== undefined ? String(item.annualRate) : '');
    setDebtMonths(item.remainingMonths !== undefined ? String(item.remainingMonths) : '');
    setDebtTotalPeriods(item.totalPeriods !== undefined ? String(item.totalPeriods) : '');
    setDebtPaidPeriods(item.paidPeriods !== undefined ? String(item.paidPeriods) : '');
    setDebtLoanPrincipal(item.loanPrincipal !== undefined ? String(item.loanPrincipal) : '');
    setDebtTotalRepayment(item.totalRepayment !== undefined ? String(item.totalRepayment) : '');
    setDebtBillDay(item.billDay !== undefined ? String(item.billDay) : '');
    setDebtRepaymentDay(item.repaymentDay !== undefined ? String(item.repaymentDay) : '');
    setDebtPaymentAccount(item.paymentAccount || '');
    setDebtRepaymentMethod(item.repaymentMethod || (item.type === 'loan' ? 'equal-installment' : 'minimum-payment'));
    setDebtRepaymentRecordMode(item.repaymentRecordMode || 'manual');
    setDebtStatus(normalizeDebtLifecycleStatus(item.status, item.balance));
    setDebtGraceDays(String(item.graceDays ?? 0));
    setDebtFormError('');
    setPrefillHint(`正在编辑“${item.name}”，保存后会直接更新原负债条目。`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const locationState = (location.state as { prefillDebt?: RepaymentPrefillDebt; editingDebtId?: string } | null) || null;
    const prefillDebt = locationState?.prefillDebt;
    if (!prefillDebt) return;

    setEditingDebtId(locationState?.editingDebtId || '');
    setDebtName(prefillDebt.name || '');
    setDebtType(prefillDebt.type || 'credit-card');
    setDebtBalance(prefillDebt.balance || '');
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
  }, [location.state]);

  const debtsWithStatus = useMemo(
    () => debts.map((item) => ({ ...item, status: normalizeDebtLifecycleStatus(item.status, item.balance) })),
    [debts]
  );

  const activeDebts = useMemo(
    () => debtsWithStatus.filter((item) => !isDebtInactive(item.status)),
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
  }, [debtsWithStatus]);

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
  }, [activeDebts, simulatorExtraPayment]);

  const overviewTotalDebt = debtSummary.totalDebt;
  const archivedTotalDebt = archivedDebts.reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  const pressurePercent = debtSummary.pressureRatio * 100;
  const pressureRingPercent = Math.min(100, Math.max(0, pressurePercent));

  const repaymentLedgerPreview = useMemo(() => {
    const today = new Date().getDate();
    return debtsWithStatus
      .map((item) => {
        const derived = calculateDebtDerivedMetrics(item);
        const minimumPayment = derived.minimumPayment;
        const annualRate = derived.apr;
        const lifecycleStatus = normalizeDebtLifecycleStatus(item.status, item.balance);
        const dueInDays =
          lifecycleStatus === 'active' && typeof item.repaymentDay === 'number'
            ? (item.repaymentDay - today + 31) % 31
            : Number.POSITIVE_INFINITY;
        const statusTone: RepaymentDebtStatusTone =
          lifecycleStatus === 'settled'
            ? 'safe'
            : lifecycleStatus === 'closed'
              ? 'muted'
              : lifecycleStatus === 'paused'
                ? 'warning'
                : !Number.isFinite(dueInDays) || typeof item.repaymentDay !== 'number'
                  ? 'muted'
                  : dueInDays === 0
                    ? 'danger'
                    : dueInDays <= Math.max(1, item.graceDays || 0)
                      ? 'warning'
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
                : !Number.isFinite(dueInDays) || typeof item.repaymentDay !== 'number'
                  ? '待补日期'
                  : dueInDays === 0
                    ? '今日应还'
                    : dueInDays <= Math.max(1, item.graceDays || 0)
                      ? `宽限内 · ${dueInDays} 天后`
                      : dueInDays <= 7
                        ? `${dueInDays} 天后到期`
                        : `本期待还 · ${dueInDays} 天后`;

        return {
          id: item.id,
          name: item.name,
          type: item.type,
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
          repaymentMethod: item.repaymentMethod || (item.type === 'loan' ? 'equal-installment' : 'minimum-payment'),
          repaymentRecordMode: item.repaymentRecordMode || 'manual',
          lifecycleStatus,
          lifecycleStatusLabel: DEBT_STATUS_LABELS[lifecycleStatus],
          graceDays: item.graceDays || 0,
          dueInDays,
          statusTone,
          statusLabel,
          remainingMonths: item.remainingMonths,
          paidPeriods: item.paidPeriods,
          totalPeriods: item.totalPeriods,
          principal: item.balance,
          missingFields: [
            !item.repaymentDay ? '还款日' : '',
            !item.paymentAccount ? '扣款账户' : '',
            !item.repaymentRecordMode ? '记录方式' : '',
            item.type === 'loan' && !item.annualRate && !item.totalRepayment ? '计算依据' : ''
          ].filter(Boolean)
        };
      })
      .sort((a, b) => a.dueInDays - b.dueInDays);
  }, [debtsWithStatus]);

  const repaymentAuditItems = useMemo(() => {
    return repaymentLedgerPreview.flatMap((item) => {
      const issues: { id: string; tone: 'warning' | 'danger' | 'info'; text: string }[] = [];
      if (!item.paymentAccount) {
        issues.push({ id: `${item.id}-account`, tone: 'warning', text: `${item.name} 未设置扣款账户。` });
      }
      if (!item.repaymentDay) {
        issues.push({ id: `${item.id}-day`, tone: 'danger', text: `${item.name} 未设置还款日，无法进行严谨提醒。` });
      }
      if (item.type === 'loan' && item.annualRate <= 0) {
        issues.push({ id: `${item.id}-formula`, tone: 'warning', text: `${item.name} 缺少明确年化/总还款依据，当前计算解释性不足。` });
      }
      if (!item.repaymentRecordMode) {
        issues.push({ id: `${item.id}-record`, tone: 'info', text: `${item.name} 尚未明确还款记录方式。` });
      }
      return issues;
    });
  }, [repaymentLedgerPreview]);

  const repaymentContextSnapshots = useMemo<RepaymentContextSnapshot[]>(() => {
    return debtsWithStatus.map((debt) => {
      const linkedRecords = repaymentRecords
        .filter((record) => record.debtId === debt.id)
        .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
      const actualPaymentAccounts = Array.from(
        new Set(
          linkedRecords
            .map((record) => String(record.paymentAccount || '').trim())
            .filter(Boolean)
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
    const dueSoonItems = repaymentLedgerPreview.filter((item) => Number.isFinite(item.dueInDays) && item.dueInDays <= 7);
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
      if (ctx && item.paymentAccount && ctx.actualPaymentAccounts.length > 0 && !ctx.actualPaymentAccounts.includes(item.paymentAccount)) {
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

  const recentRepaymentRecords = useMemo(() => {
    return repaymentRecords
      .map((item) => {
        const debt = debtsWithStatus.find((entry) => entry.id === item.debtId);
        const minimumPayment = debt ? calculateDebtMinimumPayment(debt) : 0;
        const matchedAmount = debt ? Number((debt.balance + item.amount).toFixed(2)) : item.amount;
        const normalizedMinimum = Math.max(1, minimumPayment * 0.98);
        const resultTag =
          item.amount > matchedAmount
            ? 'overpayment'
            : item.amount + 0.01 < normalizedMinimum
              ? 'partial'
              : 'normal';
        const resultLabel =
          resultTag === 'overpayment'
            ? '超额还款'
            : resultTag === 'partial'
              ? '部分还款'
              : '正常还款';

        return {
          ...item,
          debtName: debt?.name || '未知负债',
          resultTag,
          resultLabel,
          debtBalanceAfter: debt?.balance,
          matchedMinimumPayment: minimumPayment,
          matchedAmount
        };
      })
      .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
      .slice(0, 8);
  }, [debtsWithStatus, repaymentRecords]);

  const incomeConfidenceTag =
    incomeSourceTag === 'manual'
      ? '👤 你手动输入'
      : incomeSourceTag === 'ai'
        ? '📊 系统估算'
        : '— 未确定';
  const isLoanType = debtType === 'loan';
  const trimmedDebtName = debtName.trim();
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
  const billDay = Number(debtBillDay);
  const repaymentDay = Number(debtRepaymentDay);
  const graceDays = Number(debtGraceDays);
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
  const graceDaysValid =
    debtGraceDays.trim().length === 0 ||
    (Number.isFinite(graceDays) && Number.isInteger(graceDays) && graceDays >= 0 && graceDays <= 30);

  const canSubmitDebt =
    trimmedDebtName.length > 0 &&
    Number.isFinite(balance) &&
    balance > 0 &&
    billDayValid &&
    repaymentDayValid &&
    totalPeriodsValid &&
    paidPeriodsValid &&
    graceDaysValid &&
    (!isLoanType || hasExplicitAnnualRate || canInferAnnualRateByFormula) &&
    (!isLoanType ||
      (debtMonths.trim().length > 0 &&
        Number.isFinite(months) &&
        Number.isInteger(months) &&
        months > 0));

  useEffect(() => {
    const previousIds = debtIdsRef.current;
    const nextIds = debts.map((item) => item.id);
    const insertedId = nextIds.find((id) => !previousIds.includes(id));
    if (insertedId) {
      setNewDebtId(insertedId);
      window.setTimeout(() => setNewDebtId(''), 220);
    }
    debtIdsRef.current = nextIds;
  }, [debts]);

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

    if (!trimmedDebtName || !debtBalance.trim()) {
      setDebtFormError('请先填写“负债名称”和“剩余本金(¥)”。');
      return;
    }
    if (!Number.isFinite(balance) || balance <= 0) {
      setDebtFormError('“剩余本金(¥)”必须是大于 0 的数字。');
      return;
    }
    if (!billDayValid || !repaymentDayValid) {
      setDebtFormError('账单日和还款日需在 1~31 之间，可留空。');
      return;
    }
    if (!graceDaysValid) {
      setDebtFormError('宽限期需为 0~30 的整数，可留空。');
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
    if (isLoanType && !debtMonths.trim()) {
      setDebtFormError('当前类型为贷款，请填写“剩余期数(月)”。');
      return;
    }
    if (isLoanType && (!Number.isInteger(months) || months <= 0)) {
      setDebtFormError('“剩余期数(月)”需为大于 0 的整数。');
      return;
    }
    if (isLoanType && !hasExplicitAnnualRate && !canInferAnnualRateByFormula) {
      setDebtFormError('贷款请填写年化利率，或补充借款/总还款/总期数用于自动反推。');
      return;
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

    const debtPayload = {
      name: trimmedDebtName,
      type: debtType,
      status: debtStatus,
      balance,
      annualRate:
        isLoanType && hasExplicitAnnualRate
          ? annualRate
          : isLoanType && inferredAnnualRate && inferredAnnualRate > 0
            ? inferredAnnualRate
            : undefined,
      remainingMonths: isLoanType ? months : undefined,
      totalPeriods: totalPeriodsRaw.length > 0 ? totalPeriods : undefined,
      paidPeriods: paidPeriodsRaw.length > 0 ? paidPeriods : undefined,
      loanPrincipal: loanPrincipalRaw.length > 0 ? loanPrincipal : undefined,
      totalRepayment: totalRepaymentRaw.length > 0 ? totalRepayment : undefined,
      billDay: isLoanType ? undefined : debtBillDay.trim().length > 0 ? billDay : undefined,
      repaymentDay: debtRepaymentDay.trim().length > 0 ? repaymentDay : undefined,
      repaymentMethod: debtRepaymentMethod,
      repaymentRecordMode: debtRepaymentRecordMode,
      paymentAccount: debtPaymentAccount.trim() || undefined,
      graceDays: debtGraceDays.trim().length > 0 ? graceDays : undefined
    };

    if (editingDebtId) {
      updateDebt(editingDebtId, debtPayload);
    } else {
      addDebt(debtPayload);
    }

    setDebtName('');
    setDebtBalance('');
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
    setDebtGraceDays('0');
    setDebtFormError('');
    setEditingDebtId('');
    setPrefillHint('');
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
      ? Math.min(targetDebt.totalPeriods, (targetDebt.paidPeriods || 0) + (shouldAdvancePeriod ? 1 : 0))
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
      const debtLines = debts
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
          const annualRate = item.type === 'loan' ? `，年化利率 ${annualRateValue.toFixed(2)}%` : '';
          const months = item.type === 'loan' ? `，剩余期数 ${item.remainingMonths || 12}` : '';
          return `${item.name}（${typeLabel}）：本金 ¥${item.balance.toFixed(2)}，最低还款 ¥${minimum.toFixed(2)}${annualRate}${months}`;
        })
        .join('\n');

      const result = await sendAiChat({
        baseUrl,
        apiKey,
        model,
        systemPrompt:
          '你是资深个人财务顾问，请用简体中文给出可执行的还款管理建议。优先考虑现金流安全、降低利息、避免逾期，并给出分步骤计划。',
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
    <div className="page-stack finance-page">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>💳 负债管理</h2>
        <p className="muted surface-note">支持信用卡、消费贷、贷款，自动计算每月最低还款额与总负债压力。</p>

        <div className="card finance-overview-panel" style={{ marginTop: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>📊 负债压力总览</h3>
          {debts.length === 0 ? (
            <div className="finance-empty-guide">
              <div className="finance-empty-guide-head">
                <div>
                  <span className="finance-empty-guide-kicker">先建一笔负债</span>
                  <p className="finance-empty-guide-title">
                    上传账单或手动添加，马上看到还款压力。
                  </p>
                </div>
              </div>
              <div className="finance-empty-guide-actions">
                <button
                  type="button"
                  className="primary button-with-icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extractLoading}
                >
                  <img src={IMAGE_ICON_URL} alt="" aria-hidden="true" />
                  {extractLoading ? '识别中...' : '上传账单自动识别'}
                </button>
                <button
                  type="button"
                  className="finance-empty-guide-secondary"
                  onClick={() =>
                    debtEntrySectionRef.current?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start'
                    })
                  }
                >
                  手动添加负债
                </button>
              </div>
              <details className="finance-empty-guide-more">
                <summary>为什么要填这些</summary>
                <ul className="finance-empty-guide-steps">
                  <li>截图识别后会自动补全欠款金额、期数，并尝试估算月收入。</li>
                  <li>手动录入时优先填名称、类型和剩余本金，其它字段可稍后补齐。</li>
                  <li>录入完成后就能生成还款压力和 AI 建议，不必一次填完所有信息。</li>
                </ul>
              </details>
            </div>
          ) : null}
          {debts.length > 0 ? (
            <>
              <div className="finance-overview-hero">
                <div
                  className="finance-pressure-ring"
                  style={{
                    background: `conic-gradient(var(--color-danger) 0 ${pressureRingPercent}%, var(--color-bg-subtle) ${pressureRingPercent}% 100%)`
                  }}
                  aria-label="负债率环形图"
                >
                  <span>{pressurePercent.toFixed(1)}%</span>
                </div>
                <div className="finance-overview-bars" aria-label="关键指标柱状图">
                  <div className="finance-overview-bar-row">
                    <span>最低还款额</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.min(100, (debtSummary.totalMinimumPayment / Math.max(1, monthlyIncome || debtSummary.totalMinimumPayment)) * 100)}%`
                        }}
                      />
                    </div>
                    <strong>¥{debtSummary.totalMinimumPayment.toFixed(0)}</strong>
                  </div>
                  <div className="finance-overview-bar-row">
                    <span>总负债</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.min(100, (overviewTotalDebt / Math.max(1, monthlyIncome * 12 || overviewTotalDebt)) * 100)}%`
                        }}
                      />
                    </div>
                    <strong>¥{overviewTotalDebt.toFixed(0)}</strong>
                  </div>
                </div>
              </div>
              <div className="finance-overview-grid finance-overview-grid-strong">
                <article className="finance-overview-metric-card">
                  <p className="finance-overview-label">💰 总负债</p>
                  <p className="finance-overview-value">
                    <span className="finance-overview-number">{overviewTotalDebt.toFixed(2)}</span>
                    <span className="finance-overview-unit">¥</span>
                  </p>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    仅统计进行中的负债
                  </p>
                </article>
                <article className="finance-overview-metric-card">
                  <p className="finance-overview-label">📉 每月最低还款</p>
                  <p className="finance-overview-value">
                    <span className="finance-overview-number">
                      {debtSummary.totalMinimumPayment.toFixed(2)}
                    </span>
                    <span className="finance-overview-unit">¥</span>
                  </p>
                </article>
                <article
                  className={`finance-overview-metric-card finance-overview-pressure-card finance-overview-pressure-${pressureLevel.tone}`}
                >
                  <p className="finance-overview-label">⚠️ 负债率（{pressureLevel.label}）</p>
                  <p className="finance-overview-value">
                    <span className="finance-overview-number">
                      {(debtSummary.pressureRatio * 100).toFixed(1)}
                    </span>
                    <span className="finance-overview-unit">%</span>
                  </p>
                </article>
                <article className="finance-overview-metric-card finance-overview-health-card">
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
                <article className="finance-overview-metric-card">
                  <p className="finance-overview-label">🧾 净负债</p>
                  <p className="finance-overview-value">
                    <span className="finance-overview-number">{overviewTotalDebt.toFixed(2)}</span>
                    <span className="finance-overview-unit">¥</span>
                  </p>
                </article>
                <article className="finance-overview-metric-card">
                  <p className="finance-overview-label">🗂️ 历史负债</p>
                  <p className="finance-overview-value">
                    <span className="finance-overview-number">{archivedDebts.length}</span>
                    <span className="finance-overview-unit">笔</span>
                  </p>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    余额合计 ¥{archivedTotalDebt.toFixed(2)}
                  </p>
                </article>
                <article className="finance-overview-metric-card">
                  <p className="finance-overview-label">📚 负债笔数</p>
                  <p className="finance-overview-value">
                    <span className="finance-overview-number">{debts.length}</span>
                    <span className="finance-overview-unit">笔</span>
                  </p>
                </article>
                <article className="finance-overview-metric-card">
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
              <p className="muted" style={{ margin: '8px 0 0' }}>
                总负债与净负债均基于“负债明细”计算；负债率按“每月最低还款 / 月收入”计算。
              </p>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                负债健康度基于负债明细中的还款压力；建议补充账单日/还款日以获得更准确提醒。
              </p>
            </>
          ) : null}
          <div className="finance-overview-income-actions">
            <button
              type="button"
              className="finance-income-inline-action"
              onClick={() => void resolveMonthlyIncomeByAi(true)}
              disabled={incomeLoading}
            >
              {incomeLoading ? '估算中...' : 'AI 月收入'}
            </button>
            <form className="finance-income-inline-manual" onSubmit={onManualIncomeSubmit}>
              <RepaymentUnitInput
                value={manualIncomeInput}
                onChange={setManualIncomeInput}
                unit="¥"
                min={0}
                step="1"
                placeholder="手动月收入"
                ariaLabel="手动月收入"
              />
              <button type="submit" className="finance-income-inline-action">
                保存收入
              </button>
            </form>
          </div>
          {incomeHint ? <p className="muted finance-income-inline-hint">{incomeHint}</p> : null}
        </div>

        <div ref={debtEntrySectionRef}>
          <FinanceCollapsibleSection
            title="第 1 步：添加负债"
            subtitle="先把欠款录进去，再继续补日期、账户和规则。"
            icon="💳"
            defaultOpen={debts.length === 0}
            className="card finance-secondary-panel finance-debt-entry-card finance-mobile-collapsible-section"
          >
          <div className="finance-debt-entry-header">
            <div>
              <h3 style={{ margin: 0 }}>添加负债</h3>
              <p className="muted" style={{ margin: '4px 0 0 0' }}>
                两种方式：上传截图自动识别，或手动逐项填写。
              </p>
            </div>
            <span className="finance-debt-entry-icon" aria-hidden>
              💳
            </span>
          </div>

          <div className="finance-debt-dual-entry">
            <button
              type="button"
              className="finance-debt-entry-action button-with-icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={extractLoading}
            >
              <img src={IMAGE_ICON_URL} alt="" aria-hidden="true" />
              {extractLoading
                ? '正在生成AI建议中...'
                : extractSuccess
                  ? '识别完成'
                  : '上传账单自动识别'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              title="上传负债截图"
              aria-label="上传负债截图"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onExtractDebtFromScreenshot}
            />
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
            先填名称、类型、余额；其余设置可以稍后补充。
          </p>
          <form onSubmit={onAddDebt} className="finance-debt-form-grid">
            <div className="finance-debt-form-row finance-debt-form-row-primary">
              <input
                className="finance-debt-form-control"
                value={debtName}
                onChange={(event) => {
                  setDebtName(event.target.value);
                  setDebtFormError('');
                }}
                placeholder="负债名称（如：招商银行信用卡）"
                aria-label="负债名称"
              />
              <select
                className="finance-debt-form-control"
                value={debtType}
                onChange={(event) => setDebtType(event.target.value as DebtType)}
                aria-label="负债类型"
              >
                <option value="credit-card">负债类型：信用卡</option>
                <option value="consumer-loan">负债类型：消费贷</option>
                <option value="loan">负债类型：贷款</option>
              </select>
            </div>
            <div className="finance-debt-form-row finance-debt-form-row-key">
              <RepaymentUnitInput
                value={debtBalance}
                onChange={(value) => {
                  setDebtBalance(value);
                  setDebtFormError('');
                }}
                unit="\u00a5"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder={'\u5269\u4f59\u672c\u91d1'}
                ariaLabel={'\u5269\u4f59\u672c\u91d1'}
              />
            </div>
            <div className="finance-debt-form-row finance-debt-form-row-schedule">
              <input
                className="finance-debt-form-control"
                value={debtPaymentAccount}
                onChange={(event) => {
                  setDebtPaymentAccount(event.target.value);
                  setDebtFormError('');
                }}
                placeholder="扣款账户（如：招商银行储蓄卡）"
                aria-label="扣款账户"
              />
              <RepaymentUnitInput
                value={debtBillDay}
                onChange={(value) => {
                  setDebtBillDay(value);
                  setDebtFormError('');
                }}
                unit="日"
                min={1}
                max={31}
                placeholder={isLoanType ? '贷款无账单日' : '账单日'}
                ariaLabel="账单日"
                disabled={isLoanType}
              />
              <RepaymentUnitInput
                value={debtRepaymentDay}
                onChange={(value) => {
                  setDebtRepaymentDay(value);
                  setDebtFormError('');
                }}
                unit="日"
                min={1}
                max={31}
                placeholder="还款日"
                ariaLabel="还款日"
              />
              <select
                className="finance-debt-form-control"
                value={debtRepaymentMethod}
                onChange={(event) => {
                  setDebtRepaymentMethod(event.target.value as DebtRepaymentMethod);
                  setDebtFormError('');
                }}
                aria-label="还款方式"
              >
                <option value="minimum-payment">还款方式：最低还款</option>
                <option value="equal-installment">还款方式：等额本息</option>
                <option value="equal-principal">还款方式：等额本金</option>
                <option value="custom">还款方式：自定义</option>
              </select>
              <select
                className="finance-debt-form-control"
                value={debtRepaymentRecordMode}
                onChange={(event) => {
                  setDebtRepaymentRecordMode(event.target.value as DebtRepaymentRecordMode);
                  setDebtFormError('');
                }}
                aria-label="记录方式"
              >
                <option value="manual">记录方式：手动登记</option>
                <option value="transaction-match">记录方式：交易匹配</option>
                <option value="auto-debit">记录方式：自动扣款</option>
              </select>
              <select
                className="finance-debt-form-control"
                value={debtStatus}
                onChange={(event) => {
                  setDebtStatus(event.target.value as DebtLifecycleStatus);
                  setDebtFormError('');
                }}
                aria-label="负债状态"
              >
                <option value="active">状态：进行中</option>
                <option value="settled">状态：已结清</option>
                <option value="closed">状态：已关闭</option>
                <option value="paused">状态：暂缓处理</option>
              </select>
              <RepaymentUnitInput
                value={debtGraceDays}
                onChange={(value) => {
                  setDebtGraceDays(value);
                  setDebtFormError('');
                }}
                unit="天"
                min={0}
                max={30}
                placeholder="宽限期"
                ariaLabel="宽限期"
              />
            </div>
            {isLoanType ? (
              <details className="finance-debt-form-advanced" open>
                <summary>
                  <span>{'\u8d37\u6b3e\u8865\u5145\u4fe1\u606f'}</span>
                  <span className="muted">{'\u5229\u7387\u3001\u671f\u6570\u548c\u603b\u8fd8\u6b3e'}</span>
                </summary>
                <div className="finance-debt-form-row finance-debt-form-row-detail">
                  <RepaymentUnitInput
                value={debtAnnualRate}
                onChange={(value) => {
                  setDebtAnnualRate(value);
                  setDebtFormError('');
                }}
                unit="%"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder={isLoanType ? '年化利率（可留空并由公式反推）' : '年化利率'}
                ariaLabel="年化利率"
                disabled={!isLoanType}
              />
              <RepaymentUnitInput
                value={debtMonths}
                onChange={(value) => {
                  setDebtMonths(value);
                  setDebtFormError('');
                }}
                unit="月"
                min={1}
                placeholder={isLoanType ? '剩余期数' : '剩余期数'}
                ariaLabel="剩余期数"
                disabled={!isLoanType}
              />
              <RepaymentUnitInput
                value={debtTotalPeriods}
                onChange={(value) => {
                  setDebtTotalPeriods(value);
                  setDebtFormError('');
                }}
                unit="期"
                min={1}
                placeholder="总期数"
                ariaLabel="总期数"
              />
              <RepaymentUnitInput
                value={debtPaidPeriods}
                onChange={(value) => {
                  setDebtPaidPeriods(value);
                  setDebtFormError('');
                }}
                unit="期"
                min={0}
                placeholder="已还期数"
                ariaLabel="已还期数"
              />
              <RepaymentUnitInput
                value={debtLoanPrincipal}
                onChange={(value) => {
                  setDebtLoanPrincipal(value);
                  setDebtFormError('');
                }}
                unit="¥"
                min={0}
                step="0.01"
                placeholder="借款金额"
                ariaLabel="借款金额"
              />
              <RepaymentUnitInput
                value={debtTotalRepayment}
                onChange={(value) => {
                  setDebtTotalRepayment(value);
                  setDebtFormError('');
                }}
                unit="¥"
                min={0}
                step="0.01"
                placeholder="总还款"
                ariaLabel="总还款"
              />
                </div>
              </details>
            ) : null}
            <p className="muted finance-debt-form-helper">
              {isLoanType
                ? '贷款支持总期数、已还期数、借款金额、总还款；可自动反推年化利率。请同时补充扣款账户、记录方式和宽限期。'
                : '信用卡/消费贷建议补充账单日、还款日、扣款账户与记录方式，方便后续做严谨监控。'}
            </p>
            {debtFormError ? (
              <p className="muted finance-debt-form-error">{debtFormError}</p>
            ) : null}
            <div className="finance-debt-form-actions">
              <button
                type="submit"
                className="primary finance-debt-submit"
                disabled={!canSubmitDebt}
              >
                {addDebtSuccess
                  ? editingDebtId
                    ? '✔ 负债已更新'
                    : '✔ 负债已添加'
                  : editingDebtId
                    ? '保存这笔负债修改'
                    : '+ 添加这笔负债'}
              </button>
              {editingDebtId ? (
                <button
                  type="button"
                  className="finance-debt-secondary-btn"
                  onClick={() => {
                    setEditingDebtId('');
                    setDebtName('');
                    setDebtBalance('');
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
                    setDebtGraceDays('0');
                    setDebtFormError('');
                    setPrefillHint('');
                  }}
                >
                  取消编辑
                </button>
              ) : null}
            </div>
          </form>

          <div className="finance-debt-recent">
            <h4 className="finance-debt-recent-title">最近添加（最多 3 条）</h4>
            {debts.length === 0 ? <p className="muted">还没有负债记录，先新增一条吧。</p> : null}
            <div className="finance-debt-recent-list">
              {[...debts]
                .slice(-3)
                .reverse()
                .map((item) => {
                  const minimum = calculateDebtMinimumPayment(item);
                  return (
                    <div
                      key={item.id}
                      className={`finance-debt-item ${item.id === newDebtId ? 'finance-debt-item-enter' : ''}`}
                    >
                      <div>
                        <strong>
                          {item.name} ·
                          {item.type === 'credit-card'
                            ? '信用卡'
                            : item.type === 'consumer-loan'
                              ? '消费贷'
                              : '贷款'}
                        </strong>
                        <p className="muted" style={{ margin: 0 }}>
                          剩余本金 ¥{item.balance.toFixed(2)} · 最低还款 ¥{minimum.toFixed(2)} ·
                          {DEBT_STATUS_LABELS[normalizeDebtLifecycleStatus(item.status, item.balance)]} ·
                          {item.paymentAccount || '未设扣款账户'} ·
                          {REPAYMENT_RECORD_MODE_LABELS[item.repaymentRecordMode || 'manual']}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          </FinanceCollapsibleSection>
        </div>

        <FinanceCollapsibleSection
          title="第 2 步：检查还款安排"
          subtitle="重点看日期、金额、扣款账户和是否有缺口。"
          icon="🧮"
          defaultOpen={debts.length > 0 && debts.length <= 2}
          className="card finance-debt-ledger-panel finance-mobile-collapsible-section"
        >
          <div className="finance-ledger-header">
            <div>
              <h3 style={{ marginTop: 0 }}>📒 还款台账预览</h3>
              <p className="muted" style={{ margin: '4px 0 0 0' }}>
                先把每笔负债的还款日期、计算方式、记录方式、扣款账户与风险缺口放到一个可核对视图里。
              </p>
            </div>
            <span className="finance-debt-entry-icon" aria-hidden>
              🧮
            </span>
          </div>

          {repaymentLedgerPreview.length === 0 ? (
            <p className="muted">还没有负债记录，暂时无法生成还款台账。</p>
          ) : (
            <div className="finance-ledger-grid">
              {repaymentLedgerPreview.map((item) => (
                <article key={item.id} className="finance-ledger-card">
                  <div className="finance-ledger-card-top">
                    <strong>{item.name}</strong>
                    <span className={`finance-ledger-status finance-ledger-status-${item.statusTone}`}>
                      {item.statusLabel}
                    </span>
                  </div>
                  <div className="finance-ledger-meta-grid">
                    <span>应还日：{item.repaymentDay || '--'} 日</span>
                    <span>账单日：{item.billDay || '--'} 日</span>
                    <span>最低/期供：¥{item.minimumPayment.toFixed(2)}</span>
                    <span>剩余本金：¥{item.principal.toFixed(2)}</span>
                    <span>计算方式：{REPAYMENT_METHOD_LABELS[item.repaymentMethod]}</span>
                    <span>记录方式：{REPAYMENT_RECORD_MODE_LABELS[item.repaymentRecordMode]}</span>
                    <span>扣款账户：{item.paymentAccount || '未设置'}</span>
                    <span>宽限期：{item.graceDays || 0} 天</span>
                    <span>
                      APR/年化：
                      {item.apr > 0 ? `${item.apr.toFixed(2)}%` : '待补充'}
                      {item.rateSource === 'explicit' ? '（明确值）' : item.rateSource === 'inferred' ? '（推算值）' : ''}
                    </span>
                    <span>月利率：{item.monthlyRate > 0 ? `${item.monthlyRate.toFixed(3)}%` : '待补充'}</span>
                    <span>日利率：{item.dailyRate > 0 ? `${item.dailyRate.toFixed(4)}%` : '待补充'}</span>
                    <span>预计月供：¥{item.estimatedMonthlyPayment.toFixed(2)}</span>
                    <span>剩余利息：{item.remainingInterestCost !== null ? `¥${item.remainingInterestCost.toFixed(2)}` : '待补充'}</span>
                    <span>剩余总成本：{item.remainingTotalCost !== null ? `¥${item.remainingTotalCost.toFixed(2)}` : '待补充'}</span>
                    <span>
                      期数：
                      {item.totalPeriods ? `${item.paidPeriods || 0}/${item.totalPeriods}` : item.remainingMonths ? `剩余 ${item.remainingMonths} 期` : '--'}
                    </span>
                  </div>
                  {item.missingFields.length > 0 ? (
                    <p className="muted finance-ledger-missing">
                      待补字段：{item.missingFields.join('、')}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </FinanceCollapsibleSection>

        <FinanceCollapsibleSection
          title="第 3 步：登记实际还款"
          subtitle="记录你已经还了多少钱、哪天还的、从哪个账户扣的。"
          icon="💸"
          defaultOpen={recentRepaymentRecords.length === 0}
          className="card finance-debt-manager-panel finance-mobile-collapsible-section"
        >
          <div className="finance-ledger-header">
            <div>
              <h3 style={{ marginTop: 0 }}>🧾 登记一笔还款</h3>
              <p className="muted" style={{ margin: '4px 0 0 0' }}>
                手动记录实际还款时间、金额、扣款账户和备注，开始形成真实还款记录层。
              </p>
            </div>
            <span className="finance-debt-entry-icon" aria-hidden>
              💸
            </span>
          </div>
          <form onSubmit={onAddRepaymentRecord} className="finance-debt-form-grid">
            <div className="finance-debt-form-row finance-debt-form-row-detail">
              <select
                className="finance-debt-form-control"
                value={repaymentDebtId}
                onChange={(event) => {
                  setRepaymentDebtId(event.target.value);
                  setRepaymentRecordError('');
                }}
                aria-label="选择负债"
              >
                <option value="">选择要登记还款的负债</option>
                {debts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
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
                <option value="manual">记录方式：手动登记</option>
                <option value="transaction-match">记录方式：交易匹配</option>
                <option value="auto-debit">记录方式：自动扣款</option>
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
            </div>
            {repaymentRecordError ? (
              <p className="muted finance-debt-form-error">{repaymentRecordError}</p>
            ) : null}
            <div className="finance-debt-form-actions">
              <button type="submit" className="primary finance-debt-submit" disabled={debts.length === 0}>
                + 记录这笔还款
              </button>
            </div>
          </form>

          <div className="finance-debt-recent">
            <h4 className="finance-debt-recent-title">最近还款记录</h4>
            {recentRepaymentRecords.length === 0 ? (
              <p className="muted">还没有实际还款记录，先登记一笔看看。</p>
            ) : (
              <div className="finance-debt-recent-list">
                {recentRepaymentRecords.map((item) => (
                  <div key={item.id} className="finance-debt-item">
                    <div>
                      <strong>
                        {item.debtName} · ¥{item.amount.toFixed(2)}
                      </strong>
                      <p className="muted" style={{ margin: 0 }}>
                        {item.paidAt} · {item.paymentAccount || '未填扣款账户'} ·{' '}
                        {REPAYMENT_RECORD_MODE_LABELS[item.recordMode]} · {item.resultLabel}
                      </p>
                      <p className="muted" style={{ margin: '4px 0 0' }}>
                        {item.resultTag === 'partial'
                          ? `未达到最低/期供 ¥${item.matchedMinimumPayment.toFixed(2)}，当前更像补记部分还款。`
                          : item.resultTag === 'overpayment'
                            ? `本次金额已覆盖剩余本金，台账余额已归零。`
                            : `已联动回写台账，当前剩余本金 ¥${(item.debtBalanceAfter || 0).toFixed(2)}。`}
                      </p>
                      {item.note ? (
                        <p className="muted" style={{ margin: '4px 0 0' }}>
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
          </div>
        </FinanceCollapsibleSection>

        <FinanceCollapsibleSection
          title="第 4 步：管理全部负债"
          subtitle="最后统一改、删、核对，不用在上面来回翻。"
          icon="📚"
          defaultOpen={debts.length > 0 && debts.length <= 3}
          className="card finance-debt-manager-panel finance-mobile-collapsible-section"
        >
          <h3 style={{ marginTop: 0 }}>🧾 负债列表管理</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            集中查看与维护全部负债，避免在“添加负债”卡片内堆叠过长。
          </p>
          <div className="finance-debt-list" style={{ display: 'grid', gap: 8 }}>
            {debtsWithStatus.length === 0 ? <p className="muted">还没有负债记录，先新增一条吧。</p> : null}
            {debtsWithStatus.map((item) => {
              const minimum = calculateDebtMinimumPayment(item);
              const annualRate = getDebtAssumedAnnualRate(
                item.type,
                item.annualRate,
                item.loanPrincipal,
                item.totalRepayment,
                item.totalPeriods
              );
              const lifecycleStatus = normalizeDebtLifecycleStatus(item.status, item.balance);
              return (
                <div key={item.id} className="finance-debt-item">
                  <div>
                    <strong>
                      {item.name} ·
                      {item.type === 'credit-card'
                        ? '信用卡'
                        : item.type === 'consumer-loan'
                          ? '消费贷'
                          : '贷款'}
                    </strong>
                    <p className="muted" style={{ margin: 0 }}>
                      状态 {DEBT_STATUS_LABELS[lifecycleStatus]} · 剩余本金 ¥{item.balance.toFixed(2)} · 最低还款 ¥{minimum.toFixed(2)}
                      {item.type === 'loan'
                        ? ` · 年化 ${annualRate.toFixed(2)}% · 期数 ${item.paidPeriods || 0}/${item.totalPeriods || '--'} · 还款日 ${item.repaymentDay || '--'}`
                        : ` · 账单日 ${item.billDay || '--'} · 还款日 ${item.repaymentDay || '--'}`}
                    </p>
                    <p className="muted" style={{ margin: '4px 0 0' }}>
                      计算方式 {REPAYMENT_METHOD_LABELS[item.repaymentMethod || (item.type === 'loan' ? 'equal-installment' : 'minimum-payment')]} ·
                      记录方式 {REPAYMENT_RECORD_MODE_LABELS[item.repaymentRecordMode || 'manual']} ·
                      扣款账户 {item.paymentAccount || '未设置'} · 宽限期 {item.graceDays || 0} 天
                    </p>
                  </div>
                  <div className="finance-debt-item-actions">
                    <button type="button" onClick={() => startEditingDebt(item)}>
                      编辑
                    </button>
                    {(['active', 'settled', 'closed', 'paused'] as DebtLifecycleStatus[])
                      .filter((status) => status !== lifecycleStatus)
                      .map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => updateDebt(item.id, { ...item, status })}
                        >
                          {status === 'active'
                            ? '恢复进行中'
                            : status === 'settled'
                              ? '标记已结清'
                              : status === 'closed'
                                ? '标记已关闭'
                                : '标记暂缓'}
                        </button>
                      ))}
                    <button type="button" onClick={() => removeDebt(item.id)}>
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </FinanceCollapsibleSection>

        <FinanceCollapsibleSection
          title="AI 还款策略"
          subtitle="推荐优先级、压力提示、模拟器与审计提醒集中收纳，手机端默认折叠。"
          icon="🤖"
          sideLabel="AI 建议"
          className="card finance-primary-panel finance-mobile-collapsible-section"
        >
          <h3 style={{ marginTop: 0 }}>🤖 AI 还款策略</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            输出优先级排序、每月还款压力提示，并可模拟额外还款的提前结清效果。
          </p>

          <div className="finance-ai-insight-grid">
            <div className="finance-ai-insight-card">
              <h4 style={{ margin: '0 0 8px 0' }}>推荐还款优先级</h4>
              {repaymentPriority.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  你还未创建负债，点击“添加负债”或“上传账单自动识别”继续。
                </p>
              ) : (
                <ol style={{ margin: 0, paddingInlineStart: 18 }}>
                  {repaymentPriority.map((item) => (
                    <li
                      key={item.id}
                      className={`finance-priority-item finance-priority-${item.recommendationTone}`}
                    >
                      <span className="finance-priority-badge" aria-hidden>
                        {item.recommendationTone === 'danger'
                          ? '⚠️'
                          : item.recommendationTone === 'warning'
                            ? '💡'
                            : '✅'}
                      </span>
                      {item.name}（APR {item.annualRate.toFixed(1)}%，余额 ¥
                      {item.balance.toFixed(0)}，最低 ¥{item.minimumPayment.toFixed(0)}{item.remainingInterestCost !== null ? `，剩余利息约 ¥${item.remainingInterestCost.toFixed(0)}` : ''}）
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="finance-ai-insight-card">
              <h4 style={{ margin: '0 0 8px 0' }}>每月还款压力提示</h4>
              <p style={{ margin: 0 }}>
                当前每月最低还款占收入
                <strong> {(debtSummary.pressureRatio * 100).toFixed(1)}%</strong>， 负债余额占年收入
                <strong> {(debtToIncomeRatio * 100).toFixed(1)}%</strong>。
              </p>
            </div>
          </div>

          <div className="finance-ai-insight-card" style={{ marginTop: 10 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>还款模拟器（策略对比）</h4>
            <div className="finance-simulator-row">
              <label htmlFor="simulator-extra">每月额外还款金额（¥）</label>
              <input
                id="simulator-extra"
                className="finance-debt-form-control"
                type="number"
                min={0}
                step="1"
                value={simulatorExtraPayment}
                onChange={(event) => setSimulatorExtraPayment(event.target.value)}
              />
            </div>
            {simulatorResult.best ? (
              <div className="finance-simulator-best-card">
                <p className="muted" style={{ margin: 0 }}>
                  最优策略：
                  <strong>{REPAYMENT_STRATEGY_LABELS[simulatorResult.best.strategy]}</strong>
                  ，预计提前还清
                  <strong> {simulatorResult.best.savedMonths}</strong> 个月，预计节省利息
                  <strong> ¥{simulatorResult.best.savedInterest.toFixed(2)}</strong>。
                </p>
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  这更接近“提前还款 / 压降利息”场景，不是单纯把月供平均摊开。
                </p>
              </div>
            ) : null}
            <div className="finance-strategy-compare-grid">
              {simulatorResult.strategyComparison.map((result) => (
                <article key={result.strategy} className="finance-strategy-card">
                  <strong>{REPAYMENT_STRATEGY_LABELS[result.strategy]}</strong>
                  <p className="muted" style={{ margin: '6px 0 0' }}>
                    基线：{result.baseline.months} 个月 · 利息 ¥{result.baseline.totalInterest.toFixed(0)}
                  </p>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    加速后：{result.accelerated.months} 个月 · 利息 ¥{result.accelerated.totalInterest.toFixed(0)}
                  </p>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    节省：{result.savedMonths} 个月 / ¥{result.savedInterest.toFixed(0)}
                  </p>
                </article>
              ))}
            </div>
            {repaymentPriority.length > 0 ? (
              <div className="finance-prepay-focus-list">
                <h5 style={{ margin: '12px 0 8px 0' }}>优先考虑提前处理</h5>
                <div className="finance-prepay-focus-grid">
                  {repaymentPriority.slice(0, 3).map((item) => (
                    <article key={item.id} className="finance-prepay-focus-card">
                      <strong>{item.name}</strong>
                      <p className="muted" style={{ margin: '6px 0 0' }}>
                        APR {item.annualRate.toFixed(2)}% · 余额 ¥{item.balance.toFixed(0)}
                      </p>
                      <p className="muted" style={{ margin: '4px 0 0' }}>
                        {item.remainingInterestCost !== null
                          ? `剩余利息约 ¥${item.remainingInterestCost.toFixed(0)}，更适合拿来做提前还款优先级。`
                          : '当前缺少完整利息测算，建议先补齐期数/利率后再做提前结清决策。'}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="finance-ai-insight-card" style={{ marginTop: 10 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>风险标签与解释</h4>
            {debtRiskTags.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                当前未发现明显的高利率、到期集中、账户缺失或已还流水缺口。
              </p>
            ) : (
              <div className="finance-risk-tag-grid">
                {debtRiskTags.map((tag) => (
                  <article key={tag.id} className={`finance-risk-tag-card finance-risk-tag-${tag.tone}`}>
                    <div className="finance-risk-tag-head">
                      <strong>{tag.label}</strong>
                      <span>{tag.dimension === 'rate' ? '利率' : tag.dimension === 'schedule' ? '计划' : tag.dimension === 'account' ? '账户' : tag.dimension === 'actual' ? '流水' : '资料'}</span>
                    </div>
                    <p className="muted" style={{ margin: '8px 0 0' }}>{tag.explanation}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="finance-ai-insight-card" style={{ marginTop: 10 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>严谨性审计提醒</h4>
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
          </div>

          <div className="finance-ai-insight-card" style={{ marginTop: 10 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>计划 / 账户 / 已还流水上下文</h4>
            {repaymentContextSnapshots.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>请先录入至少一笔负债。</p>
            ) : (
              <div className="finance-risk-tag-grid">
                {repaymentContextSnapshots.slice(0, 6).map((item) => (
                  <article key={item.debtId} className="finance-risk-tag-card finance-risk-tag-info">
                    <div className="finance-risk-tag-head">
                      <strong>{item.debtName}</strong>
                      <span>3.4 预留</span>
                    </div>
                    <p className="muted" style={{ margin: '8px 0 0' }}>
                      计划还款日：{item.plannedRepaymentDay || '--'} 日 · 计划账户：{item.plannedPaymentAccount || '未设置'}
                    </p>
                    <p className="muted" style={{ margin: '4px 0 0' }}>
                      已发生还款：{item.actualRepaymentCount} 笔{item.latestActualRepaymentAt ? ` · 最近一次 ${item.latestActualRepaymentAt}` : ''}
                    </p>
                    <p className="muted" style={{ margin: '4px 0 0' }}>
                      实际账户：{item.actualPaymentAccounts.length > 0 ? item.actualPaymentAccounts.join(' / ') : '暂无流水记录'}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="finance-ai-insight-card" style={{ marginTop: 10 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>到期提醒</h4>
            {repaymentLedgerPreview.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                请先在负债列表中创建至少一条记录。
              </p>
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {repaymentLedgerPreview.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    {item.name}：账单日 {item.billDay || '--'} 日，还款日 {item.repaymentDay || '--'} 日，
                    {Number.isFinite(item.dueInDays)
                      ? item.dueInDays === 0
                        ? '今天到期'
                        : `${item.dueInDays} 天后到期`
                      : '待补还款日'}（最低 ¥{item.minimumPayment.toFixed(0)}）
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="finance-ai-action-row">
            <button type="button" onClick={onGenerateRepaymentAdvice} disabled={repaymentLoading}>
              {repaymentLoading ? '正在生成AI建议...' : '生成 AI 还款建议'}
            </button>
          </div>
          {repaymentCacheHint ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              {repaymentCacheHint}
            </p>
          ) : null}
          {repaymentAdvice ? (
            <>
              <p className="finance-generate-done">✅ AI建议已生成，可继续调整参数后重新生成。</p>
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
              <div className="finance-ai-result">{renderAiStructuredText(repaymentReasoning)}</div>
            </details>
          ) : null}
        </FinanceCollapsibleSection>

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
