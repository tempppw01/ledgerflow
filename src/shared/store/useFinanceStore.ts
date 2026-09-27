import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Account } from '../../entities/account/types';
import { Category } from '../../entities/category/types';
import {
  BalanceChangeEntry,
  BalanceChangeType,
  TransactionAdjustmentKind,
  TransactionItem,
  TransactionType
} from '../../entities/transaction/types';
import { SubscriptionItem } from '../../entities/subscription/types';
import { syncChangeIfNeeded } from '../lib/dataSync';
import { generateId } from '../lib/id';
import { getSignedAmount } from '../lib/transactionMetrics';

interface CategoryLearningRule {
  id: string;
  token: string;
  type: TransactionType;
  categoryId: string;
  hitCount: number;
  createdAt: string;
  lastAppliedAt: string;
}

interface CategoryLearningEvent {
  id: string;
  createdAt: string;
  type: TransactionType;
  fromCategoryId: string;
  toCategoryId: string;
  tokens: string[];
  ruleIds: string[];
}

interface CategoryLearningInput {
  type: TransactionType;
  note: string;
  merchantOrderNo?: string;
  orderNo?: string;
}

interface RefundTransactionInput {
  transactionId: string;
  amount: number;
  note?: string;
}

interface RefundTransactionResult {
  refundTransactionId: string;
  refundedAmount: number;
  fullyRefunded: boolean;
  remainingRefundableAmount: number;
}

interface GenerateSubscriptionTransactionResult {
  transactionId: string;
  duplicated: boolean;
}

export interface FinanceDataSnapshot {
  transactions: TransactionItem[];
  categories: Category[];
  accounts: Account[];
  subscriptions?: SubscriptionItem[];
  trashedTransactions?: TransactionItem[];
  trashedCategories?: Category[];
  trashedAccounts?: Account[];
  balanceChangeEntries?: BalanceChangeEntry[];
  trashedSubscriptions?: SubscriptionItem[];
}

interface FinanceState {
  hasHydrated: boolean;
  transactions: TransactionItem[];
  categories: Category[];
  accounts: Account[];
  trashedTransactions: TransactionItem[];
  trashedCategories: Category[];
  trashedAccounts: Account[];
  balanceChangeEntries: BalanceChangeEntry[];
  subscriptions: SubscriptionItem[];
  trashedSubscriptions: SubscriptionItem[];
  categoryLearningRules: CategoryLearningRule[];
  categoryLearningEvents: CategoryLearningEvent[];
  addTransaction: (payload: Omit<TransactionItem, 'id'>) => string;
  updateTransaction: (id: string, payload: Omit<TransactionItem, 'id'>) => void;
  removeTransaction: (id: string) => void;
  restoreTransaction: (id: string) => void;
  permanentlyDeleteTransaction: (id: string) => void;
  refundTransaction: (input: RefundTransactionInput) => RefundTransactionResult;
  addCategory: (
    name: string,
    options?: { kind?: Category['kind']; color?: string; icon?: string }
  ) => string;
  updateCategory: (id: string, payload: Partial<Omit<Category, 'id'>>) => void;
  reorderCategories: (orderedIds: string[]) => void;
  removeCategory: (id: string) => void;
  restoreCategory: (id: string) => void;
  permanentlyDeleteCategory: (id: string) => void;
  addAccount: (name: string, type?: Account['type'], initialBalance?: number) => string;
  updateAccountBalance: (id: string, balance: number) => void;
  reorderAccounts: (orderedIds: string[]) => void;
  removeAccount: (id: string) => void;
  restoreAccount: (id: string) => void;
  permanentlyDeleteAccount: (id: string) => void;
  addSubscription: (
    payload: Omit<SubscriptionItem, 'id' | 'createdAt' | 'updatedAt' | 'status'>
  ) => string;
  updateSubscription: (
    id: string,
    payload: Omit<SubscriptionItem, 'id' | 'createdAt' | 'updatedAt'>
  ) => void;
  removeSubscription: (id: string) => void;
  restoreSubscription: (id: string) => void;
  permanentlyDeleteSubscription: (id: string) => void;
  generateSubscriptionTransaction: (id: string) => GenerateSubscriptionTransactionResult;
  clearAllAccountBills: () => void;
  clearRecycleBin: () => void;
  suggestCategoryByLearning: (input: CategoryLearningInput) => {
    categoryId: string;
    confidence: number;
    token: string;
  } | null;
  recordCategoryCorrection: (
    input: CategoryLearningInput & { fromCategoryId: string; toCategoryId: string }
  ) => void;
  undoLatestCategoryLearning: () => boolean;
  clearCategoryLearning: () => void;
  replaceAllData: (payload: FinanceDataSnapshot) => void;
}

const defaultCategories: Category[] = [
  { id: 'cat-food', name: '餐饮', kind: 'expense', icon: '🍜', color: '#f97316', sortOrder: 1 },
  {
    id: 'cat-clothing',
    name: '衣物穿搭',
    kind: 'expense',
    icon: '👕',
    color: '#ec4899',
    sortOrder: 2
  },
  { id: 'cat-housing', name: '住房', kind: 'expense', icon: '🏠', color: '#8b5cf6', sortOrder: 3 },
  {
    id: 'cat-utilities',
    name: '水电燃气',
    kind: 'expense',
    icon: '💡',
    color: '#22c55e',
    sortOrder: 4
  },
  {
    id: 'cat-transport',
    name: '交通',
    kind: 'expense',
    icon: '🚇',
    color: '#06b6d4',
    sortOrder: 5
  },
  {
    id: 'cat-shopping',
    name: '购物日用',
    kind: 'expense',
    icon: '🛍️',
    color: '#ef4444',
    sortOrder: 6
  },
  {
    id: 'cat-communication',
    name: '通讯网络',
    kind: 'expense',
    icon: '📶',
    color: '#0ea5e9',
    sortOrder: 7
  },
  {
    id: 'cat-health',
    name: '医疗健康',
    kind: 'expense',
    icon: '🩺',
    color: '#14b8a6',
    sortOrder: 8
  },
  {
    id: 'cat-education',
    name: '教育学习',
    kind: 'expense',
    icon: '📚',
    color: '#6366f1',
    sortOrder: 9
  },
  {
    id: 'cat-entertainment',
    name: '娱乐社交',
    kind: 'expense',
    icon: '🎮',
    color: '#a855f7',
    sortOrder: 10
  },
  { id: 'cat-travel', name: '旅行', kind: 'expense', icon: '🧳', color: '#f59e0b', sortOrder: 11 },
  {
    id: 'cat-gift',
    name: '人情往来',
    kind: 'expense',
    icon: '🎁',
    color: '#e11d48',
    sortOrder: 12
  },
  { id: 'cat-salary', name: '工资', kind: 'income', icon: '💰', color: '#16a34a', sortOrder: 13 },
  { id: 'cat-bonus', name: '奖金', kind: 'income', icon: '🎉', color: '#22c55e', sortOrder: 14 },
  {
    id: 'cat-invest-income',
    name: '理财收益',
    kind: 'income',
    icon: '📈',
    color: '#15803d',
    sortOrder: 15
  },
  {
    id: 'cat-refund',
    name: '退款返现',
    kind: 'income',
    icon: '💸',
    color: '#10b981',
    sortOrder: 16
  },
  {
    id: 'cat-insurance',
    name: '保险',
    kind: 'expense',
    icon: '🛡️',
    color: '#0284c7',
    sortOrder: 17
  },
  { id: 'cat-tax', name: '税费', kind: 'expense', icon: '🧾', color: '#7c3aed', sortOrder: 18 },
  { id: 'cat-loan', name: '还款', kind: 'expense', icon: '🏦', color: '#475569', sortOrder: 19 },
  { id: 'cat-other', name: '其他', kind: 'expense', icon: '📦', color: '#6b7280', sortOrder: 20 }
];

const defaultAccounts: Account[] = [
  { id: 'acc-cash', name: '现金', initialBalance: 0, balance: 0, sortOrder: 1 },
  { id: 'acc-card', name: '银行卡', initialBalance: 0, balance: 0, sortOrder: 2 }
];

const defaultTransactions: TransactionItem[] = [];
const defaultTrashedTransactions: TransactionItem[] = [];
const defaultBalanceChangeEntries: BalanceChangeEntry[] = [];
const defaultSubscriptions: SubscriptionItem[] = [];
const defaultTrashedSubscriptions: SubscriptionItem[] = [];
const defaultCategoryLearningRules: CategoryLearningRule[] = [];
const defaultCategoryLearningEvents: CategoryLearningEvent[] = [];
const defaultTrashedCategories: Category[] = [];
const defaultTrashedAccounts: Account[] = [];

const REFUND_HINT_PATTERN = /(退款|退回|退货|冲正)/i;
const TX_BALANCE_CHANGE_TYPES = new Set<BalanceChangeType>([
  'transaction-income',
  'transaction-expense',
  'transaction-budget',
  'transaction-repayment',
  'transaction-refund'
]);

function roundCurrency(raw: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function normalizeSubscriptionStatus(
  item: Pick<SubscriptionItem, 'expireDate' | 'renewalDate' | 'status'>
): SubscriptionItem['status'] {
  if (item.status === 'paused') return 'paused';
  const now = new Date();
  const target = item.expireDate || item.renewalDate;
  if (!target) return 'active';
  const time = new Date(target).getTime();
  if (Number.isNaN(time)) return 'active';
  const diffDays = Math.ceil((time - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 7) return 'due-soon';
  return 'active';
}

function inferSubscriptionCategoryId(item: SubscriptionItem): string {
  if (item.kind === 'mobile') return 'cat-communication';
  if (item.kind === 'membership' || item.kind === 'digital') return 'cat-entertainment';
  return 'cat-other';
}

function isSameDay(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.slice(0, 10) === right.slice(0, 10);
}

function normalizeCategoryName(raw: string): string {
  return String(raw || '')
    .replace(/[\u00A0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAdjustmentKind(
  tx: TransactionItem,
  categoryName: string
): TransactionAdjustmentKind {
  if (
    tx.adjustmentKind === 'normal' ||
    tx.adjustmentKind === 'refund' ||
    tx.adjustmentKind === 'reversal'
  ) {
    return tx.adjustmentKind;
  }

  const note = String(tx.note || '');
  if (
    tx.status === 'refunded' ||
    REFUND_HINT_PATTERN.test(categoryName) ||
    REFUND_HINT_PATTERN.test(note)
  ) {
    return 'refund';
  }

  return 'normal';
}

function normalizeTransactionSemantic(
  tx: TransactionItem,
  categoryName: string,
  fallbackCategoryId?: string
): TransactionItem {
  const nextCategoryId = tx.categoryId || fallbackCategoryId || tx.categoryId;
  const adjustmentKind = normalizeAdjustmentKind(tx, categoryName);
  const nextType =
    adjustmentKind === 'normal' ? tx.type : tx.type === 'income' ? 'expense' : tx.type;

  return {
    ...tx,
    amount: roundCurrency(tx.amount),
    type: nextType,
    categoryId: nextCategoryId,
    adjustmentKind,
    updatedAt: tx.updatedAt || tx.date || new Date().toISOString()
  };
}

function categoryNameKey(raw: string): string {
  return normalizeCategoryName(raw).toLocaleLowerCase('zh-CN');
}

function normalizeAccountOrder(accounts: Account[]): Account[] {
  const uniqueIds = new Set<string>();
  const ordered = [...accounts]
    .map((item, index) => {
      const safeId = String(item.id || '').trim();
      if (!safeId || uniqueIds.has(safeId)) {
        return null;
      }
      uniqueIds.add(safeId);
      const sortOrder = Number(item.sortOrder);
      return {
        ...item,
        initialBalance: roundCurrency(Number(item.initialBalance ?? 0)),
        balance: roundCurrency(Number(item.balance ?? item.initialBalance ?? 0)),
        sortOrder: Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : index + 1
      } as Account;
    })
    .filter(Boolean) as Account[];

  return ordered
    .sort((a, b) => {
      const orderDiff =
        Number(a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        Number(b.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) {
        return orderDiff;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    })
    .map((item, index) => ({
      ...item,
      sortOrder: index + 1
    }));
}

function sanitizeCategoriesAndTransactions(
  categories: Category[],
  transactions: TransactionItem[],
  extraTransactions: TransactionItem[] = []
): {
  categories: Category[];
  transactions: TransactionItem[];
  extraTransactions: TransactionItem[];
} {
  const mergedCategories: Category[] = [];
  const canonicalByKey = new Map<string, Category>();
  const categoryIdAlias = new Map<string, string>();

  categories.forEach((item) => {
    const normalizedName = normalizeCategoryName(item.name);
    if (!normalizedName) {
      return;
    }
    const key = categoryNameKey(normalizedName);
    const found = canonicalByKey.get(key);
    if (found) {
      categoryIdAlias.set(item.id, found.id);
      return;
    }
    const normalizedRow = { ...item, name: normalizedName };
    canonicalByKey.set(key, normalizedRow);
    mergedCategories.push(normalizedRow);
  });

  const fallbackCategoryId = mergedCategories[0]?.id;
  const categoryNameById = new Map(mergedCategories.map((item) => [item.id, item.name]));
  const normalizeTransactionList = (rows: TransactionItem[]) =>
    rows.map((tx) => {
      const remappedCategoryId = categoryIdAlias.get(tx.categoryId);
      const resolvedCategoryId =
        remappedCategoryId ||
        (tx.categoryId && mergedCategories.some((category) => category.id === tx.categoryId)
          ? tx.categoryId
          : fallbackCategoryId || tx.categoryId);

      const categoryName = categoryNameById.get(resolvedCategoryId) || '';

      return normalizeTransactionSemantic(
        { ...tx, categoryId: resolvedCategoryId },
        categoryName,
        fallbackCategoryId
      );
    });

  const nextTransactions = normalizeTransactionList(transactions);
  const nextExtraTransactions = normalizeTransactionList(extraTransactions);

  return {
    categories: mergedCategories,
    transactions: nextTransactions,
    extraTransactions: nextExtraTransactions
  };
}

export function normalizeImportedFinanceSnapshot(payload: FinanceDataSnapshot) {
  const incomingCategories = Array.isArray(payload.categories) ? payload.categories : [];
  const incomingTransactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const incomingTrashedTransactions = Array.isArray(payload.trashedTransactions)
    ? payload.trashedTransactions
    : [];
  const incomingAccounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const incomingBalanceEntries = Array.isArray(payload.balanceChangeEntries)
    ? payload.balanceChangeEntries
    : [];
  const incomingSubscriptions = Array.isArray(payload.subscriptions)
    ? payload.subscriptions.map((item) => ({
        ...item,
        status: normalizeSubscriptionStatus(item)
      }))
    : [];
  const incomingTrashedSubscriptions = Array.isArray(payload.trashedSubscriptions)
    ? ensureUniqueById(
        payload.trashedSubscriptions.map((item) => ({
          ...item,
          status: normalizeSubscriptionStatus(item)
        }))
      )
    : [];

  const compacted = sanitizeCategoriesAndTransactions(
    incomingCategories,
    incomingTransactions,
    incomingTrashedTransactions
  );
  const rebuilt = rebuildStateSlices(
    incomingAccounts,
    compacted.transactions,
    incomingBalanceEntries
  );

  return {
    categories: compacted.categories,
    transactions: compacted.transactions,
    accounts: rebuilt.accounts,
    balanceChangeEntries: rebuilt.balanceChangeEntries,
    subscriptions: incomingSubscriptions,
    trashedTransactions: ensureUniqueById(compacted.extraTransactions),
    trashedCategories: Array.isArray(payload.trashedCategories)
      ? ensureUniqueById(payload.trashedCategories)
      : [],
    trashedAccounts: Array.isArray(payload.trashedAccounts)
      ? ensureUniqueById(payload.trashedAccounts)
      : [],
    trashedSubscriptions: incomingTrashedSubscriptions
  };
}

function computeAccountBalances(accounts: Account[], transactions: TransactionItem[]): Account[] {
  const normalizedAccounts = normalizeAccountOrder(accounts);
  return normalizedAccounts.map((account) => {
    const base = roundCurrency(Number(account.initialBalance ?? 0));
    const delta = transactions.reduce((sum, item) => {
      if (item.accountId !== account.id) {
        return sum;
      }
      return sum + getSignedAmount(item);
    }, 0);

    return {
      ...account,
      initialBalance: base,
      balance: roundCurrency(base + delta)
    };
  });
}

function getBalanceChangeType(tx: TransactionItem): BalanceChangeType {
  if (tx.adjustmentKind === 'refund' || tx.adjustmentKind === 'reversal') {
    return 'transaction-refund';
  }
  if (tx.type === 'income') {
    return 'transaction-income';
  }
  if (tx.type === 'budget') {
    return 'transaction-budget';
  }
  if (tx.type === 'repayment') {
    return 'transaction-repayment';
  }
  return 'transaction-expense';
}

function buildTransactionBalanceChangeEntries(
  accounts: Account[],
  transactions: TransactionItem[]
): BalanceChangeEntry[] {
  const balanceMap = new Map<string, number>(
    normalizeAccountOrder(accounts).map((item) => [
      item.id,
      roundCurrency(Number(item.initialBalance ?? 0))
    ])
  );

  const sortedTransactions = [...transactions].sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }
    const updatedDiff =
      new Date(a.updatedAt || a.date).getTime() - new Date(b.updatedAt || b.date).getTime();
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return a.id.localeCompare(b.id, 'zh-CN');
  });

  return sortedTransactions.reduce<BalanceChangeEntry[]>((entries, tx) => {
    if (!balanceMap.has(tx.accountId)) {
      return entries;
    }
    const beforeBalance = roundCurrency(balanceMap.get(tx.accountId) || 0);
    const signedAmount = roundCurrency(getSignedAmount(tx));
    const afterBalance = roundCurrency(beforeBalance + signedAmount);
    balanceMap.set(tx.accountId, afterBalance);
    entries.push({
      id: `balchg-tx-${tx.id}`,
      accountId: tx.accountId,
      transactionId: tx.id,
      relatedTransactionId: tx.refundOfTransactionId,
      type: getBalanceChangeType(tx),
      amount: Math.abs(roundCurrency(tx.amount)),
      beforeBalance,
      afterBalance,
      createdAt: tx.updatedAt || tx.date,
      note: tx.note,
      remark:
        tx.adjustmentKind === 'refund' || tx.adjustmentKind === 'reversal'
          ? tx.refundOfTransactionId
            ? '退款已关联原交易'
            : '退款记录缺少原交易关联'
          : undefined
    });
    return entries;
  }, []);
}

function mergeBalanceChangeEntries(
  accounts: Account[],
  transactions: TransactionItem[],
  existingEntries: BalanceChangeEntry[] = []
): BalanceChangeEntry[] {
  const accountIds = new Set(normalizeAccountOrder(accounts).map((item) => item.id));
  const preservedManualEntries = existingEntries.filter(
    (item) => !TX_BALANCE_CHANGE_TYPES.has(item.type) && accountIds.has(item.accountId)
  );

  return [
    ...buildTransactionBalanceChangeEntries(accounts, transactions),
    ...preservedManualEntries
  ]
    .sort((a, b) => {
      const dateDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return a.id.localeCompare(b.id, 'zh-CN');
    })
    .map((item) => ({
      ...item,
      amount: roundCurrency(item.amount),
      beforeBalance: roundCurrency(item.beforeBalance),
      afterBalance: roundCurrency(item.afterBalance)
    }));
}

function rebuildStateSlices(
  accounts: Account[],
  transactions: TransactionItem[],
  existingEntries: BalanceChangeEntry[] = []
) {
  const nextAccounts = computeAccountBalances(accounts, transactions);
  return {
    accounts: nextAccounts,
    balanceChangeEntries: mergeBalanceChangeEntries(nextAccounts, transactions, existingEntries)
  };
}

function getRefundedAmount(transactions: TransactionItem[], transactionId: string): number {
  return roundCurrency(
    transactions.reduce((sum, item) => {
      if (
        item.refundOfTransactionId !== transactionId ||
        (item.adjustmentKind !== 'refund' && item.adjustmentKind !== 'reversal')
      ) {
        return sum;
      }
      return sum + Math.abs(roundCurrency(item.amount));
    }, 0)
  );
}

function markTrashedAt<T extends { trashedAt?: string }>(item: T): T {
  return {
    ...item,
    trashedAt: new Date().toISOString()
  };
}

function clearTrashedAt<T extends { trashedAt?: string }>(item: T): T {
  const rest = { ...item };
  delete rest.trashedAt;
  return rest as T;
}

function ensureUniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((item) => {
    if (!item?.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function restoreFromTrash<T extends { id: string; trashedAt?: string }>(
  active: T[],
  trashed: T[],
  id: string
): { active: T[]; trashed: T[]; restored: T | null } {
  const target = trashed.find((item) => item.id === id) || null;
  if (!target) {
    return { active, trashed, restored: null };
  }

  return {
    active: [...active, clearTrashedAt(target)],
    trashed: trashed.filter((item) => item.id !== id),
    restored: clearTrashedAt(target)
  };
}

function createManualAdjustmentEntry(params: {
  accountId: string;
  beforeBalance: number;
  afterBalance: number;
  note?: string;
}): BalanceChangeEntry {
  const amount = roundCurrency(Math.abs(params.afterBalance - params.beforeBalance));
  return {
    id: generateId(),
    accountId: params.accountId,
    type: 'manual-adjustment',
    amount,
    beforeBalance: roundCurrency(params.beforeBalance),
    afterBalance: roundCurrency(params.afterBalance),
    createdAt: new Date().toISOString(),
    note: params.note || '手动调整账户余额',
    remark: params.afterBalance >= params.beforeBalance ? '手动调增余额' : '手动调减余额'
  };
}

export const useFinanceStore = create<FinanceState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      transactions: defaultTransactions,
      categories: defaultCategories,
      accounts: defaultAccounts,
      trashedTransactions: defaultTrashedTransactions,
      trashedCategories: defaultTrashedCategories,
      trashedAccounts: defaultTrashedAccounts,
      balanceChangeEntries: defaultBalanceChangeEntries,
      subscriptions: defaultSubscriptions,
      trashedSubscriptions: defaultTrashedSubscriptions,
      categoryLearningRules: defaultCategoryLearningRules,
      categoryLearningEvents: defaultCategoryLearningEvents,
      addTransaction: (payload) => {
        const id = generateId();
        const row: TransactionItem = {
          ...payload,
          amount: roundCurrency(payload.amount),
          adjustmentKind: payload.adjustmentKind || 'normal',
          updatedAt: payload.updatedAt || new Date().toISOString(),
          id
        };
        set((s) => {
          const transactions = [...s.transactions, row];
          return {
            transactions,
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        void syncChangeIfNeeded({ entity: 'transactions', action: 'insert', row });
        return id;
      },
      updateTransaction: (id, payload) => {
        const row: TransactionItem = {
          ...payload,
          amount: roundCurrency(payload.amount),
          adjustmentKind: payload.adjustmentKind || 'normal',
          updatedAt: new Date().toISOString(),
          id
        };
        set((s) => {
          const transactions = s.transactions.map((item) => (item.id === id ? row : item));
          return {
            transactions,
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        void syncChangeIfNeeded({ entity: 'transactions', action: 'update', row, id });
      },
      removeTransaction: (id) => {
        let trashedRow: TransactionItem | null = null;
        set((s) => {
          const target = s.transactions.find((item) => item.id === id);
          if (!target) {
            return s;
          }
          trashedRow = markTrashedAt(target);
          const transactions = s.transactions.filter((item) => item.id !== id);
          return {
            transactions,
            trashedTransactions: ensureUniqueById([...s.trashedTransactions, trashedRow]),
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        void syncChangeIfNeeded({ entity: 'transactions', action: 'delete', id });
      },
      restoreTransaction: (id) => {
        let restoredRow: TransactionItem | null = null;
        set((s) => {
          const restored = restoreFromTrash(s.transactions, s.trashedTransactions, id);
          if (!restored.restored) {
            return s;
          }
          restoredRow = restored.restored;
          const transactions = ensureUniqueById(restored.active);
          return {
            transactions,
            trashedTransactions: restored.trashed,
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        if (restoredRow) {
          void syncChangeIfNeeded({ entity: 'transactions', action: 'insert', row: restoredRow });
        }
      },
      permanentlyDeleteTransaction: (id) => {
        set((s) => ({
          trashedTransactions: s.trashedTransactions.filter((item) => item.id !== id)
        }));
      },
      refundTransaction: (input) => {
        const refundAmount = roundCurrency(input.amount);
        let result: RefundTransactionResult | null = null;
        let thrownError: Error | null = null;

        set((s) => {
          const original = s.transactions.find((item) => item.id === input.transactionId);
          if (!original) {
            thrownError = new Error('未找到要退款的原始记录。');
            return s;
          }
          if (original.adjustmentKind === 'refund' || original.adjustmentKind === 'reversal') {
            thrownError = new Error('退款单或冲正单不能再次发起退款。');
            return s;
          }
          if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
            thrownError = new Error('退款金额必须大于 0。');
            return s;
          }

          const refundedAmount = getRefundedAmount(s.transactions, original.id);
          const remainingRefundableAmount = roundCurrency(original.amount - refundedAmount);
          if (remainingRefundableAmount <= 0) {
            thrownError = new Error('该记录可退款金额已用尽，不能重复退款。');
            return s;
          }
          if (refundAmount > remainingRefundableAmount) {
            thrownError = new Error(
              `退款金额不能超过剩余可退金额 ${remainingRefundableAmount.toFixed(2)}。`
            );
            return s;
          }

          const refundRow: TransactionItem = {
            id: generateId(),
            type: original.type === 'income' ? 'expense' : original.type,
            categoryId: original.categoryId,
            accountId: original.accountId,
            amount: refundAmount,
            date: new Date().toISOString(),
            note: (input.note || `退款：${original.note || '原始记录'}`).trim(),
            tags: Array.from(new Set([...(original.tags || []), '退款'])),
            source: 'manual',
            orderNo: original.orderNo,
            merchantOrderNo: original.merchantOrderNo,
            status: 'completed',
            adjustmentKind: 'refund',
            refundOfTransactionId: original.id,
            updatedAt: new Date().toISOString()
          };

          const nextRefundedAmount = roundCurrency(refundedAmount + refundAmount);
          const fullyRefunded = nextRefundedAmount >= roundCurrency(original.amount);
          const nextOriginal: TransactionItem = {
            ...original,
            status: fullyRefunded ? 'refunded' : original.status || 'completed',
            updatedAt: new Date().toISOString()
          };

          const transactions = s.transactions.map((item) =>
            item.id === original.id ? nextOriginal : item
          );
          transactions.push(refundRow);

          result = {
            refundTransactionId: refundRow.id,
            refundedAmount: refundAmount,
            fullyRefunded,
            remainingRefundableAmount: roundCurrency(original.amount - nextRefundedAmount)
          };

          return {
            transactions,
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });

        if (thrownError) {
          throw thrownError;
        }
        if (!result) {
          throw new Error('退款失败，请稍后重试。');
        }

        const state = get();
        const refundRow = state.transactions.find(
          (item) => item.id === result?.refundTransactionId
        );
        const originalRow = state.transactions.find((item) => item.id === input.transactionId);
        if (refundRow) {
          void syncChangeIfNeeded({ entity: 'transactions', action: 'insert', row: refundRow });
        }
        if (originalRow) {
          void syncChangeIfNeeded({
            entity: 'transactions',
            action: 'update',
            row: originalRow,
            id: originalRow.id
          });
        }

        return result;
      },
      addCategory: (name, options) => {
        const normalizedName = normalizeCategoryName(name);
        if (!normalizedName) {
          return defaultCategories[0]?.id || 'cat-unknown';
        }

        let insertedRow: Category | null = null;
        let resolvedId = defaultCategories[0]?.id || 'cat-unknown';

        set((s) => {
          const key = categoryNameKey(normalizedName);
          const existing = s.categories.find((item) => categoryNameKey(item.name) === key);
          if (existing) {
            resolvedId = existing.id;
            return s;
          }

          insertedRow = {
            id: generateId(),
            name: normalizedName,
            kind: options?.kind,
            color: options?.color,
            icon: options?.icon,
            sortOrder: s.categories.length + 1
          };
          resolvedId = insertedRow.id;
          const compacted = sanitizeCategoriesAndTransactions(
            [...s.categories, insertedRow],
            s.transactions
          );
          return {
            categories: compacted.categories,
            transactions: compacted.transactions,
            ...rebuildStateSlices(s.accounts, compacted.transactions, s.balanceChangeEntries)
          };
        });

        if (insertedRow) {
          void syncChangeIfNeeded({ entity: 'categories', action: 'insert', row: insertedRow });
        }

        return resolvedId;
      },
      updateCategory: (id, payload) => {
        let updatedRow: Category | null = null;
        set((s) => {
          const categories = s.categories.map((item) => {
            if (item.id !== id) {
              return item;
            }
            updatedRow = { ...item, ...payload };
            return updatedRow;
          });
          return { categories };
        });
        if (updatedRow) {
          void syncChangeIfNeeded({ entity: 'categories', action: 'update', row: updatedRow, id });
        }
      },
      reorderCategories: (orderedIds) => {
        set((s) => {
          const orderMap = new Map(orderedIds.map((categoryId, index) => [categoryId, index + 1]));
          const categories = s.categories.map((item) => ({
            ...item,
            sortOrder: orderMap.get(item.id) ?? item.sortOrder ?? s.categories.length + 1
          }));
          return { categories };
        });
      },
      removeCategory: (id) => {
        set((s) => {
          const target = s.categories.find((item) => item.id === id);
          if (!target) {
            return s;
          }
          return {
            categories: s.categories.filter((item) => item.id !== id),
            trashedCategories: ensureUniqueById([...s.trashedCategories, markTrashedAt(target)])
          };
        });
        void syncChangeIfNeeded({ entity: 'categories', action: 'delete', id });
      },
      restoreCategory: (id) => {
        set((s) => {
          const restored = restoreFromTrash(s.categories, s.trashedCategories, id);
          if (!restored.restored) {
            return s;
          }
          return {
            categories: restored.active,
            trashedCategories: restored.trashed
          };
        });
      },
      permanentlyDeleteCategory: (id) => {
        set((s) => ({
          trashedCategories: s.trashedCategories.filter((item) => item.id !== id)
        }));
      },
      addAccount: (name, type, initialBalance = 0) => {
        const row: Account = {
          id: generateId(),
          name: name.trim(),
          type,
          initialBalance: roundCurrency(initialBalance),
          balance: roundCurrency(initialBalance),
          sortOrder: normalizeAccountOrder(get().accounts).length + 1
        };
        set((s) => {
          const accounts = [...s.accounts, row];
          return {
            ...rebuildStateSlices(accounts, s.transactions, s.balanceChangeEntries)
          };
        });
        void syncChangeIfNeeded({ entity: 'accounts', action: 'insert', row });
        return row.id;
      },
      updateAccountBalance: (id, balance) => {
        let updatedRow: Account | null = null;
        set((s) => {
          const target = s.accounts.find((item) => item.id === id);
          if (!target) {
            return s;
          }

          const normalizedBalance = roundCurrency(balance);
          const beforeBalance = roundCurrency(Number(target.balance ?? target.initialBalance ?? 0));
          const transactions = s.transactions;
          const txDelta = transactions.reduce((sum, tx) => {
            if (tx.accountId !== id) {
              return sum;
            }
            return sum + getSignedAmount(tx);
          }, 0);

          const nextInitial = roundCurrency(normalizedBalance - txDelta);
          const accounts = s.accounts.map((item) => {
            if (item.id !== id) {
              return item;
            }

            updatedRow = {
              ...item,
              initialBalance: nextInitial,
              balance: normalizedBalance
            };
            return updatedRow;
          });

          const rebuilt = rebuildStateSlices(accounts, transactions, s.balanceChangeEntries);
          const manualEntry =
            beforeBalance === normalizedBalance
              ? null
              : createManualAdjustmentEntry({
                  accountId: id,
                  beforeBalance,
                  afterBalance: normalizedBalance,
                  note: '手动调整账户余额'
                });

          return {
            accounts: rebuilt.accounts,
            balanceChangeEntries: manualEntry
              ? [...rebuilt.balanceChangeEntries, manualEntry].sort(
                  (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                )
              : rebuilt.balanceChangeEntries
          };
        });
        if (updatedRow) {
          void syncChangeIfNeeded({ entity: 'accounts', action: 'update', row: updatedRow, id });
        }
      },
      reorderAccounts: (orderedIds) => {
        set((s) => {
          const normalizedAccounts = normalizeAccountOrder(s.accounts);
          const seen = new Set<string>();
          const safeOrderedIds = orderedIds.filter((id) => {
            if (!normalizedAccounts.some((item) => item.id === id) || seen.has(id)) {
              return false;
            }
            seen.add(id);
            return true;
          });
          const remainingIds = normalizedAccounts
            .map((item) => item.id)
            .filter((id) => !seen.has(id));
          const finalIds = [...safeOrderedIds, ...remainingIds];
          const orderMap = new Map(finalIds.map((accountId, index) => [accountId, index + 1]));
          const accounts = normalizedAccounts.map((item) => ({
            ...item,
            sortOrder: orderMap.get(item.id) ?? item.sortOrder ?? normalizedAccounts.length + 1
          }));
          return {
            accounts: normalizeAccountOrder(accounts)
          };
        });
      },
      removeAccount: (id) => {
        set((s) => {
          const target = s.accounts.find((item) => item.id === id);
          if (!target) {
            return s;
          }
          const accounts = normalizeAccountOrder(s.accounts.filter((item) => item.id !== id));
          const rebuilt = rebuildStateSlices(accounts, s.transactions, s.balanceChangeEntries);
          return {
            accounts: rebuilt.accounts,
            balanceChangeEntries: rebuilt.balanceChangeEntries,
            trashedAccounts: ensureUniqueById([...s.trashedAccounts, markTrashedAt(target)])
          };
        });
        void syncChangeIfNeeded({ entity: 'accounts', action: 'delete', id });
      },
      restoreAccount: (id) => {
        set((s) => {
          const restored = restoreFromTrash(s.accounts, s.trashedAccounts, id);
          if (!restored.restored) {
            return s;
          }
          const accounts = normalizeAccountOrder(restored.active);
          const rebuilt = rebuildStateSlices(accounts, s.transactions, s.balanceChangeEntries);
          return {
            accounts: rebuilt.accounts,
            balanceChangeEntries: rebuilt.balanceChangeEntries,
            trashedAccounts: restored.trashed
          };
        });
      },
      permanentlyDeleteAccount: (id) => {
        set((s) => ({
          trashedAccounts: s.trashedAccounts.filter((item) => item.id !== id)
        }));
      },
      addSubscription: (payload) => {
        const id = generateId();
        const now = new Date().toISOString();
        const row: SubscriptionItem = {
          ...payload,
          id,
          amount: roundCurrency(payload.amount),
          currency: String(payload.currency || 'CNY').toUpperCase(),
          status: normalizeSubscriptionStatus({
            expireDate: payload.expireDate,
            renewalDate: payload.renewalDate,
            status: 'active'
          }),
          createdAt: now,
          updatedAt: now
        };
        set((s) => ({ subscriptions: [row, ...s.subscriptions] }));
        return id;
      },
      updateSubscription: (id, payload) => {
        set((s) => ({
          subscriptions: s.subscriptions.map((item) =>
            item.id === id
              ? {
                  ...payload,
                  id,
                  amount: roundCurrency(payload.amount),
                  currency: String(payload.currency || 'CNY').toUpperCase(),
                  status: normalizeSubscriptionStatus({
                    expireDate: payload.expireDate,
                    renewalDate: payload.renewalDate,
                    status: payload.status
                  }),
                  createdAt: item.createdAt,
                  updatedAt: new Date().toISOString()
                }
              : item
          )
        }));
      },
      removeSubscription: (id) => {
        set((s) => {
          const target = s.subscriptions.find((item) => item.id === id);
          if (!target) {
            return s;
          }
          return {
            subscriptions: s.subscriptions.filter((item) => item.id !== id),
            trashedSubscriptions: ensureUniqueById([
              ...s.trashedSubscriptions,
              markTrashedAt(target)
            ])
          };
        });
      },
      restoreSubscription: (id) => {
        set((s) => {
          const restored = restoreFromTrash(s.subscriptions, s.trashedSubscriptions, id);
          if (!restored.restored) {
            return s;
          }
          return {
            subscriptions: restored.active,
            trashedSubscriptions: restored.trashed
          };
        });
      },
      permanentlyDeleteSubscription: (id) => {
        set((s) => ({
          trashedSubscriptions: s.trashedSubscriptions.filter((item) => item.id !== id)
        }));
      },
      generateSubscriptionTransaction: (id) => {
        let result: GenerateSubscriptionTransactionResult | null = null;
        let thrownError: Error | null = null;

        set((s) => {
          const subscription = s.subscriptions.find((item) => item.id === id);
          if (!subscription) {
            thrownError = new Error('未找到订阅项目。');
            return s;
          }
          const accountId = subscription.accountId || s.accounts[0]?.id;
          if (!accountId) {
            thrownError = new Error('当前没有可用账户，无法生成支出记录。');
            return s;
          }

          const today = new Date().toISOString();
          const existing = s.transactions.find(
            (item) =>
              item.accountId === accountId &&
              item.amount === roundCurrency(subscription.amount) &&
              isSameDay(item.date, today) &&
              item.tags?.includes('订阅') &&
              item.note.includes(subscription.name)
          );

          if (existing) {
            result = { transactionId: existing.id, duplicated: true };
            return s;
          }

          const currencyTag =
            subscription.currency && subscription.currency !== 'CNY'
              ? [`币种:${subscription.currency}`]
              : [];
          const noteParts = [
            `订阅支出：${subscription.name}`,
            subscription.provider ? `服务商:${subscription.provider}` : '',
            subscription.currency && subscription.currency !== 'CNY'
              ? `原币种:${subscription.currency}`
              : '',
            subscription.note || ''
          ].filter(Boolean);

          const transaction: TransactionItem = {
            id: generateId(),
            type: 'expense',
            categoryId: inferSubscriptionCategoryId(subscription),
            accountId,
            amount: roundCurrency(subscription.amount),
            date: today,
            note: noteParts.join('｜'),
            tags: Array.from(new Set(['订阅', subscription.name, ...currencyTag])),
            source: 'manual',
            status: 'completed',
            updatedAt: today
          };

          const transactions = [...s.transactions, transaction];
          const subscriptions = s.subscriptions.map((item) =>
            item.id === id
              ? {
                  ...item,
                  lastGeneratedAt: today,
                  lastGeneratedTransactionId: transaction.id,
                  updatedAt: today,
                  status: normalizeSubscriptionStatus(item)
                }
              : item
          );

          result = { transactionId: transaction.id, duplicated: false };
          return {
            subscriptions,
            transactions,
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });

        if (thrownError) throw thrownError;
        if (!result) throw new Error('生成订阅支出失败，请稍后重试。');

        const finalResult = result as GenerateSubscriptionTransactionResult;
        const state = get();
        const row = state.transactions.find((item) => item.id === finalResult.transactionId);
        if (row && !finalResult.duplicated) {
          void syncChangeIfNeeded({ entity: 'transactions', action: 'insert', row });
        }
        return finalResult;
      },
      clearAllAccountBills: () => {
        set((s) => ({
          trashedTransactions: ensureUniqueById([
            ...s.trashedTransactions,
            ...s.transactions.map((item) => markTrashedAt(item))
          ]),
          transactions: [],
          ...rebuildStateSlices(s.accounts, [], [])
        }));
      },
      clearRecycleBin: () => {
        set({
          trashedTransactions: [],
          trashedCategories: [],
          trashedAccounts: [],
          trashedSubscriptions: []
        });
      },
      suggestCategoryByLearning: () => {
        return null;
      },
      recordCategoryCorrection: () => {
        // noop
      },
      undoLatestCategoryLearning: () => false,
      clearCategoryLearning: () => {
        set({
          categoryLearningRules: [],
          categoryLearningEvents: []
        });
      },
      replaceAllData: (payload) => {
        const normalized = normalizeImportedFinanceSnapshot(payload);
        set(() => ({
          ...normalized
        }));
      }
    }),
    {
      name: 'ledgerflow-finance',
      version: 5,
      onRehydrateStorage: () => () => {
        useFinanceStore.setState({ hasHydrated: true });
      },
      merge: (persistedState, currentState) => {
        const incoming = (persistedState as Partial<FinanceState>) || {};
        const normalized = normalizeImportedFinanceSnapshot({
          transactions: Array.isArray(incoming.transactions)
            ? incoming.transactions
            : currentState.transactions,
          categories: Array.isArray(incoming.categories)
            ? incoming.categories
            : currentState.categories,
          accounts: Array.isArray(incoming.accounts) ? incoming.accounts : currentState.accounts,
          subscriptions: Array.isArray(incoming.subscriptions)
            ? incoming.subscriptions
            : currentState.subscriptions,
          trashedTransactions: Array.isArray(incoming.trashedTransactions)
            ? incoming.trashedTransactions
            : currentState.trashedTransactions,
          trashedCategories: Array.isArray(incoming.trashedCategories)
            ? incoming.trashedCategories
            : currentState.trashedCategories,
          trashedAccounts: Array.isArray(incoming.trashedAccounts)
            ? incoming.trashedAccounts
            : currentState.trashedAccounts,
          balanceChangeEntries: Array.isArray(incoming.balanceChangeEntries)
            ? incoming.balanceChangeEntries
            : currentState.balanceChangeEntries,
          trashedSubscriptions: Array.isArray(incoming.trashedSubscriptions)
            ? incoming.trashedSubscriptions
            : currentState.trashedSubscriptions
        });

        return {
          ...currentState,
          ...incoming,
          hasHydrated: true,
          ...normalized,
          categoryLearningRules: Array.isArray(
            (incoming as Partial<FinanceState>).categoryLearningRules
          )
            ? (incoming as Partial<FinanceState>).categoryLearningRules || []
            : currentState.categoryLearningRules,
          categoryLearningEvents: Array.isArray(
            (incoming as Partial<FinanceState>).categoryLearningEvents
          )
            ? (incoming as Partial<FinanceState>).categoryLearningEvents || []
            : currentState.categoryLearningEvents
        };
      }
    }
  )
);
