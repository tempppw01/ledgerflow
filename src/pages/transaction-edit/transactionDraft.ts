import type { TransactionStatus } from '../../entities/transaction/types';
import type { TransactionType } from '../../entities/transaction/types';

export interface TransactionDraft {
  type: 'income' | 'expense' | 'budget' | 'repayment';
  categoryId: string;
  accountId: string;
  amount: string;
  date: string;
  note: string;
  tags: string;
  orderNo: string;
  merchantOrderNo: string;
  status: TransactionStatus;
  calculatorExpression: string;
}

const STORAGE_PREFIX = 'ledgerflow-transaction-draft-v1:';
const QUICK_STORAGE_PREFIX = 'ledgerflow-quick-transaction-draft-v1:';
const TYPES = new Set<TransactionDraft['type']>(['income', 'expense', 'budget', 'repayment']);
const STATUSES = new Set<TransactionStatus>(['pending', 'completed', 'refunded', 'closed', 'failed']);

export function transactionDraftStorageKey(ledgerUserId: string) {
  return `${STORAGE_PREFIX}${ledgerUserId}`;
}

function isDraft(value: unknown): value is TransactionDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<TransactionDraft>;
  return (
    typeof draft.type === 'string' &&
    TYPES.has(draft.type as TransactionDraft['type']) &&
    typeof draft.categoryId === 'string' &&
    typeof draft.accountId === 'string' &&
    typeof draft.amount === 'string' &&
    typeof draft.date === 'string' &&
    typeof draft.note === 'string' &&
    typeof draft.tags === 'string' &&
    typeof draft.orderNo === 'string' &&
    typeof draft.merchantOrderNo === 'string' &&
    typeof draft.status === 'string' &&
    STATUSES.has(draft.status as TransactionStatus) &&
    typeof draft.calculatorExpression === 'string'
  );
}

export function readTransactionDraft(ledgerUserId: string): TransactionDraft | null {
  if (!ledgerUserId) return null;
  try {
    const raw = window.localStorage.getItem(transactionDraftStorageKey(ledgerUserId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTransactionDraft(ledgerUserId: string, draft: TransactionDraft) {
  if (!ledgerUserId) return;
  try {
    window.localStorage.setItem(transactionDraftStorageKey(ledgerUserId), JSON.stringify(draft));
  } catch {
    // Keep the form usable when browser storage is unavailable or full.
  }
}

export function clearTransactionDraft(ledgerUserId: string) {
  if (!ledgerUserId) return;
  try {
    window.localStorage.removeItem(transactionDraftStorageKey(ledgerUserId));
  } catch {
    // Ignore storage failures; a future page visit can still overwrite the draft.
  }
}

export interface QuickTransactionDraft {
  type: TransactionType;
  categoryId: string;
  accountId: string;
  expression: string;
  date: string;
  note: string;
}

export function quickTransactionDraftStorageKey(ledgerUserId: string) {
  return `${QUICK_STORAGE_PREFIX}${ledgerUserId}`;
}

function isQuickDraft(value: unknown): value is QuickTransactionDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<QuickTransactionDraft>;
  return (
    (draft.type === 'income' || draft.type === 'expense') &&
    typeof draft.categoryId === 'string' &&
    typeof draft.accountId === 'string' &&
    typeof draft.expression === 'string' &&
    typeof draft.date === 'string' &&
    typeof draft.note === 'string'
  );
}

export function readQuickTransactionDraft(ledgerUserId: string): QuickTransactionDraft | null {
  if (!ledgerUserId) return null;
  try {
    const raw = window.localStorage.getItem(quickTransactionDraftStorageKey(ledgerUserId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isQuickDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeQuickTransactionDraft(ledgerUserId: string, draft: QuickTransactionDraft) {
  if (!ledgerUserId) return;
  try {
    window.localStorage.setItem(quickTransactionDraftStorageKey(ledgerUserId), JSON.stringify(draft));
  } catch {
    // Keep the quick-entry drawer usable when browser storage is unavailable or full.
  }
}

export function clearQuickTransactionDraft(ledgerUserId: string) {
  if (!ledgerUserId) return;
  try {
    window.localStorage.removeItem(quickTransactionDraftStorageKey(ledgerUserId));
  } catch {
    // Ignore storage failures; a future page visit can still overwrite the draft.
  }
}
