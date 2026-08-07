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
  DebtType
} from '../../features/debt/model/debtMetrics';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { IMAGE_ICON_URL } from '../../shared/config/brandAssets';
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
  const [repaymentRecordToastVariant, setRepaymentRecordToastVariant] = useState<
    'success' | 'warning'
  >('success');
  const [addDebtSuccess, setAddDebtSuccess] = useState(false);
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
  const [showAddDebtModal, setShowAddDebtModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setDebtRepaymentMethod(
      item.repaymentMethod || (item.type === 'loan' ? 'equal-installment' : 'minimum-payment')
    );
    setDebtRepaymentRecordMode(item.repaymentRecordMode || 'manual');
    setDebtStatus(normalizeDebtLifecycleStatus(item.status, item.balance));
    setDebtGraceDays(String(item.graceDays ?? 0));
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
          repaymentMethod:
            item.repaymentMethod ||
            (item.type === 'loan' ? 'equal-installment' : 'minimum-payment'),
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
    return debtsWithStatus.map((debt) => {
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
    (Number.isFinite(graceDays) &&
      Number.isInteger(graceDays) &&
      graceDays >= 0 &&
      graceDays <= 30);

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
    setShowAddDebtModal(false);
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
          const annualRate =
            item.type === 'loan' ? `，年化利率 ${annualRateValue.toFixed(2)}%` : '';
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
      <section className="panel finance-page">
        <h2 style={{ marginTop: 0 }}>💳 负债管理</h2>
        <p className="muted surface-note">
          支持信用卡、消费贷、贷款，自动计算每月最低还款额与总负债压力。
        </p>

        <RepaymentDashboard debts={debtsWithStatus} repaymentRecords={repaymentRecords} />

        {debts.length > 0 ? (
          <div
            className="finance-overview-grid finance-overview-grid-strong"
            style={{ marginTop: 12 }}
          >
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

        <div className="finance-overview-income-actions" style={{ marginTop: 12 }}>
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
                    setPrefillHint('');
                    setShowAddDebtModal(true);
                  }}
                >
                  + 新增
                </button>
              </div>
            </div>

            {repaymentLedgerPreview.length === 0 ? (
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
                {repaymentLedgerPreview.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`repayment-debt-list-item${selectedDebtId === item.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedDebtId(item.id)}
                  >
                    <span className={`repayment-debt-status-dot tone-${item.statusTone}`} />
                    <div className="repayment-debt-list-item-main">
                      <strong>{item.name}</strong>
                      <span className="muted">
                        {item.type === 'credit-card'
                          ? '信用卡'
                          : item.type === 'consumer-loan'
                            ? '消费贷'
                            : '贷款'}
                        {' · ¥'}
                        {item.principal.toFixed(0)}
                      </span>
                    </div>
                    <span className={`repayment-debt-due-badge tone-${item.statusTone}`}>
                      {item.statusLabel}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="repayment-debt-detail-panel">
            {selectedDebt && selectedDebtOriginal ? (
              <>
                <div className="repayment-debt-detail-header">
                  <div>
                    <h3 style={{ margin: 0 }}>{selectedDebt.name}</h3>
                    <p className="muted" style={{ margin: '4px 0 0 0' }}>
                      {selectedDebt.type === 'credit-card'
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

                <div className="repayment-debt-detail-metrics">
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">剩余本金</span>
                    <span className="repayment-debt-metric-value">
                      ¥{selectedDebt.principal.toFixed(2)}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">最低/期供</span>
                    <span className="repayment-debt-metric-value">
                      ¥{selectedDebt.minimumPayment.toFixed(2)}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">年化利率</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.apr > 0 ? `${selectedDebt.apr.toFixed(2)}%` : '待补充'}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">月利率</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.monthlyRate > 0
                        ? `${selectedDebt.monthlyRate.toFixed(3)}%`
                        : '—'}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">日利率</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.dailyRate > 0 ? `${selectedDebt.dailyRate.toFixed(4)}%` : '—'}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">预计月供</span>
                    <span className="repayment-debt-metric-value">
                      ¥{selectedDebt.estimatedMonthlyPayment.toFixed(2)}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">剩余利息</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.remainingInterestCost !== null
                        ? `¥${selectedDebt.remainingInterestCost.toFixed(2)}`
                        : '待补充'}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">剩余总成本</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.remainingTotalCost !== null
                        ? `¥${selectedDebt.remainingTotalCost.toFixed(2)}`
                        : '待补充'}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">还款日</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.repaymentDay || '--'} 日
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">账单日</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.billDay || '--'} 日
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">扣款账户</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.paymentAccount || '未设置'}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">还款方式</span>
                    <span className="repayment-debt-metric-value">
                      {REPAYMENT_METHOD_LABELS[selectedDebt.repaymentMethod]}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">记录方式</span>
                    <span className="repayment-debt-metric-value">
                      {REPAYMENT_RECORD_MODE_LABELS[selectedDebt.repaymentRecordMode]}
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">宽限期</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.graceDays || 0} 天
                    </span>
                  </div>
                  <div className="repayment-debt-metric">
                    <span className="repayment-debt-metric-label">期数</span>
                    <span className="repayment-debt-metric-value">
                      {selectedDebt.totalPeriods
                        ? `${selectedDebt.paidPeriods || 0}/${selectedDebt.totalPeriods}`
                        : selectedDebt.remainingMonths
                          ? `剩余 ${selectedDebt.remainingMonths} 期`
                          : '--'}
                    </span>
                  </div>
                </div>

                {selectedDebt.missingFields.length > 0 ? (
                  <p className="muted" style={{ margin: '8px 0 0 0' }}>
                    待补字段：{selectedDebt.missingFields.join('、')}
                  </p>
                ) : null}

                <div className="repayment-debt-detail-repay">
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
                </div>

                <div className="repayment-debt-detail-records">
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
                </div>
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
                      {item.balance.toFixed(0)}，最低 ¥{item.minimumPayment.toFixed(0)}
                      {item.remainingInterestCost !== null
                        ? `，剩余利息约 ¥${item.remainingInterestCost.toFixed(0)}`
                        : ''}
                      ）
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
                    基线：{result.baseline.months} 个月 · 利息 ¥
                    {result.baseline.totalInterest.toFixed(0)}
                  </p>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    加速后：{result.accelerated.months} 个月 · 利息 ¥
                    {result.accelerated.totalInterest.toFixed(0)}
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
                  <article
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
              <p className="muted" style={{ margin: 0 }}>
                请先录入至少一笔负债。
              </p>
            ) : (
              <div className="finance-risk-tag-grid">
                {repaymentContextSnapshots.slice(0, 6).map((item) => (
                  <article
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
                    {item.name}：账单日 {item.billDay || '--'} 日，还款日{' '}
                    {item.repaymentDay || '--'} 日，
                    {Number.isFinite(item.dueInDays)
                      ? item.dueInDays === 0
                        ? '今天到期'
                        : `${item.dueInDays} 天后到期`
                      : '待补还款日'}
                    （最低 ¥{item.minimumPayment.toFixed(0)}）
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
                  先填名称、类型、余额；其余设置可以稍后补充。
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
                        <option value="credit-card">信用卡</option>
                        <option value="consumer-loan">消费贷</option>
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
                            setDebtBalance(event.target.value);
                            setDebtFormError('');
                          }}
                          placeholder="0.00"
                          aria-label="剩余本金"
                        />
                      </span>
                    </label>
                  </div>

                  <details className="debt-form-advanced">
                    <summary className="debt-form-advanced-summary">
                      更多设置
                      <small>还款日、账户、记录方式等</small>
                    </summary>
                    <div className="debt-form-fields">
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
                          value={debtPaymentAccount}
                          onChange={(event) => {
                            setDebtPaymentAccount(event.target.value);
                            setDebtFormError('');
                          }}
                          placeholder="招商储蓄卡"
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
                      <label className="debt-form-field">
                        <span className="debt-form-field-label">宽限期</span>
                        <span className="debt-form-money">
                          <input
                            className="debt-form-input debt-form-input-money"
                            type="number"
                            min={0}
                            max={30}
                            value={debtGraceDays}
                            onChange={(event) => {
                              setDebtGraceDays(event.target.value);
                              setDebtFormError('');
                            }}
                            placeholder="0"
                            aria-label="宽限期"
                          />
                          <span className="debt-form-money-unit">天</span>
                        </span>
                      </label>
                      {isLoanType ? (
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
                                  setDebtMonths(event.target.value);
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
                                  setDebtTotalPeriods(event.target.value);
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
                                  setDebtPaidPeriods(event.target.value);
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
                    </div>
                  </details>

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
