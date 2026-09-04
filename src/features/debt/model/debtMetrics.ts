export type DebtType = 'credit-card' | 'consumer-loan' | 'loan';

export type DebtLifecycleStatus = 'active' | 'settled' | 'closed' | 'paused';

export type DebtRepaymentMethod =
  | 'minimum-payment'
  | 'equal-installment'
  | 'equal-principal'
  | 'custom';

export type DebtRepaymentRecordMode = 'manual' | 'transaction-match' | 'auto-debit';

/** A simple entry is a dated repayment reminder, not a balance-bearing debt. */
export type DebtEntryMode = 'standard' | 'simple';

export type RepaymentRecord = {
  id: string;
  debtId: string;
  amount: number;
  paidAt: string;
  paymentAccount?: string;
  note?: string;
  recordMode: DebtRepaymentRecordMode;
  createdAt: string;
};

export type ManualRepaymentItem = {
  id?: string;
  dueDate?: string;
  amount: number;
  label?: string;
};

export type DebtItem = {
  id: string;
  name: string;
  type: DebtType;
  status?: DebtLifecycleStatus;
  balance: number;
  annualRate?: number;
  remainingMonths?: number;
  totalPeriods?: number;
  paidPeriods?: number;
  loanPrincipal?: number;
  totalRepayment?: number;
  customMinPayment?: number;
  billDay?: number;
  repaymentDay?: number;
  repaymentMethod?: DebtRepaymentMethod;
  repaymentRecordMode?: DebtRepaymentRecordMode;
  paymentAccount?: string;
  graceDays?: number;
  manualRepayments?: ManualRepaymentItem[];
  entryMode?: DebtEntryMode;
  simpleDueDate?: string;
};

export type DebtSummary = {
  totalDebt: number;
  totalMinimumPayment: number;
  pressureRatio: number;
};

export type DebtRateSource = 'explicit' | 'inferred' | 'missing';

export interface DebtDerivedMetrics {
  annualRate: number;
  apr: number;
  monthlyRate: number;
  dailyRate: number;
  rateSource: DebtRateSource;
  minimumPayment: number;
  estimatedMonthlyPayment: number;
  totalInterest: number | null;
  remainingInterestCost: number | null;
  remainingTotalCost: number | null;
  remainingMonths: number | null;
}

export function calculateDebtHealthScore(summary: DebtSummary, monthlyIncome: number): number {
  const income = toPositiveNumber(monthlyIncome);
  if (income === 0) {
    return 0;
  }

  const annualIncome = income * 12;
  const debtRatio = summary.totalDebt / annualIncome;
  const debtRisk = Math.min(1, debtRatio / 1.5);
  const paymentRisk = Math.min(1, summary.pressureRatio / 0.6);
  const riskScore = debtRisk * 0.45 + paymentRisk * 0.55;

  return Math.max(0, Math.min(100, Math.round(100 - riskScore * 100)));
}

const debtRules: Record<DebtType, { rate: number; minFloor: number }> = {
  'credit-card': { rate: 0.1, minFloor: 100 },
  'consumer-loan': { rate: 0.1, minFloor: 50 },
  loan: { rate: 0.03, minFloor: 0 }
};

function normalizeDebtType(type: unknown): DebtType {
  if (type === 'huabei') return 'consumer-loan';
  if (type === 'credit-card' || type === 'consumer-loan' || type === 'loan') return type;
  return 'credit-card';
}

function toPositiveNumber(value: number | undefined): number {
  const safe = Number(value ?? 0);
  if (!Number.isFinite(safe) || safe <= 0) {
    return 0;
  }
  return safe;
}

function inferAnnualRateFromTotals(input: {
  principal?: number;
  totalRepayment?: number;
  totalPeriods?: number;
}): number | undefined {
  const principal = toPositiveNumber(input.principal);
  const totalRepayment = toPositiveNumber(input.totalRepayment);
  const totalPeriods = Math.max(1, Math.floor(toPositiveNumber(input.totalPeriods)));

  if (principal <= 0 || totalRepayment <= principal || totalPeriods <= 0) {
    return undefined;
  }

  const totalInterest = totalRepayment - principal;
  const approxAnnualRate = (totalInterest / principal) * (12 / totalPeriods) * 100;
  if (!Number.isFinite(approxAnnualRate) || approxAnnualRate < 0) {
    return undefined;
  }
  return Math.max(0, approxAnnualRate);
}

function resolveLoanAnnualRate(debt: DebtItem): number {
  const explicit = toPositiveNumber(debt.annualRate);
  if (explicit > 0) {
    return explicit;
  }

  const inferred = inferAnnualRateFromTotals({
    principal: debt.loanPrincipal,
    totalRepayment: debt.totalRepayment,
    totalPeriods: debt.totalPeriods
  });
  return toPositiveNumber(inferred);
}

function resolveDebtAnnualRate(debt: DebtItem): { annualRate: number; source: DebtRateSource } {
  const explicit = toPositiveNumber(debt.annualRate);
  if (explicit > 0) {
    return { annualRate: explicit, source: 'explicit' };
  }

  if (normalizeDebtType(debt.type) === 'loan') {
    const inferred = inferAnnualRateFromTotals({
      principal: debt.loanPrincipal,
      totalRepayment: debt.totalRepayment,
      totalPeriods: debt.totalPeriods
    });
    if (toPositiveNumber(inferred) > 0) {
      return { annualRate: toPositiveNumber(inferred), source: 'inferred' };
    }
  }

  return { annualRate: 0, source: 'missing' };
}

function resolveLoanRemainingMonths(debt: DebtItem): number {
  const explicit = Math.max(1, Math.floor(toPositiveNumber(debt.remainingMonths)));
  if (explicit > 0) {
    return explicit;
  }

  const total = Math.max(1, Math.floor(toPositiveNumber(debt.totalPeriods)));
  const paid = Math.max(0, Math.floor(toPositiveNumber(debt.paidPeriods)));
  return Math.max(1, total - paid);
}

function calcLoanAmortizedPayment(debt: DebtItem): number {
  const principal = toPositiveNumber(debt.balance);
  const safeMonths = resolveLoanRemainingMonths(debt);
  if (principal === 0) {
    return 0;
  }

  const monthlyRate = resolveLoanAnnualRate(debt) / 12 / 100;
  if (monthlyRate === 0) {
    return principal / safeMonths;
  }

  const pow = Math.pow(1 + monthlyRate, safeMonths);
  const payment = (principal * monthlyRate * pow) / (pow - 1);
  return Number.isFinite(payment) ? payment : 0;
}

export function calculateDebtMinimumPayment(debt: DebtItem): number {
  const principal = toPositiveNumber(debt.balance);
  if (principal === 0) {
    return 0;
  }

  const custom = toPositiveNumber(debt.customMinPayment);
  if (custom > 0) {
    return custom;
  }

  const normalizedType = normalizeDebtType(debt.type);

  if (normalizedType === 'loan') {
    return calcLoanAmortizedPayment(debt);
  }

  const rule = debtRules[normalizedType];
  return Math.max(principal * rule.rate, rule.minFloor);
}

export function calculateDebtDerivedMetrics(debt: DebtItem): DebtDerivedMetrics {
  const normalizedType = normalizeDebtType(debt.type);
  const principal = toPositiveNumber(debt.balance);
  const minimumPayment = calculateDebtMinimumPayment(debt);
  const rateMeta = resolveDebtAnnualRate(debt);
  const annualRate = rateMeta.annualRate;
  const monthlyRate = annualRate > 0 ? annualRate / 12 : 0;
  const dailyRate = annualRate > 0 ? annualRate / 360 : 0;
  const remainingMonths =
    normalizedType === 'loan'
      ? Math.max(1, resolveLoanRemainingMonths(debt))
      : typeof debt.remainingMonths === 'number' && debt.remainingMonths > 0
        ? Math.floor(debt.remainingMonths)
        : null;

  let totalInterest: number | null = null;
  let remainingInterestCost: number | null = null;
  let remainingTotalCost: number | null = null;

  if (normalizedType === 'loan' && principal > 0) {
    if (
      toPositiveNumber(debt.loanPrincipal) > 0 &&
      toPositiveNumber(debt.totalRepayment) > toPositiveNumber(debt.loanPrincipal)
    ) {
      totalInterest = Math.max(
        0,
        toPositiveNumber(debt.totalRepayment) - toPositiveNumber(debt.loanPrincipal)
      );
    }

    if (remainingMonths && minimumPayment > 0) {
      remainingTotalCost = minimumPayment * remainingMonths;
      remainingInterestCost = Math.max(0, remainingTotalCost - principal);
      if (totalInterest === null && remainingInterestCost > 0) {
        totalInterest = remainingInterestCost;
      }
    }
  }

  return {
    annualRate,
    apr: annualRate,
    monthlyRate,
    dailyRate,
    rateSource: rateMeta.source,
    minimumPayment,
    estimatedMonthlyPayment: minimumPayment,
    totalInterest,
    remainingInterestCost,
    remainingTotalCost,
    remainingMonths
  };
}

export function calculateDebtSummary(debts: DebtItem[], monthlyIncome: number): DebtSummary {
  const financialDebts = debts.filter((item) => item.entryMode !== 'simple');
  const totalDebt = financialDebts.reduce((sum, item) => sum + toPositiveNumber(item.balance), 0);
  const totalMinimumPayment = financialDebts.reduce(
    (sum, item) => sum + calculateDebtMinimumPayment(item),
    0
  );
  const income = toPositiveNumber(monthlyIncome);
  const pressureRatio = income > 0 ? totalMinimumPayment / income : 0;

  return {
    totalDebt,
    totalMinimumPayment,
    pressureRatio
  };
}
