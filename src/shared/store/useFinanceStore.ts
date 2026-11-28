import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { sqlOnlyStorage } from './sqlOnlyStorage';
import { Account } from '../../entities/account/types';
import { Category } from '../../entities/category/types';
import {
  BalanceChangeEntry,
  BalanceChangeType,
  DEFAULT_TRANSACTION_STATUS,
  TransactionAdjustmentKind,
  TransactionItem
} from '../../entities/transaction/types';
import { SubscriptionItem } from '../../entities/subscription/types';
import { syncChangeIfNeeded } from '../lib/dataSync';
import { generateId } from '../lib/id';
import { getSignedAmount, isTransactionRefundLike } from '../lib/transactionMetrics';
import { isBalanceAffectingStatus, isSameLocalDay } from '../lib/localDate';
import { advanceSubscriptionDate } from '../lib/subscriptionSchedule';
import { roundMoney } from '../lib/money';
import {
  applyCategoryCorrection,
  suggestCategoryFromRules,
  type CategoryLearningEvent,
  type CategoryLearningInput,
  type CategoryLearningRule
} from '../lib/categoryLearning';
import { resolveSubscriptionStatus } from '../../features/subscriptions/model/subscriptionStatus';

// 定义只有一份:分类学习的结构放在 shared/lib/categoryLearning.ts,这里直接引用。
// (原来 store 里有一份同结构定义,再引入一份就会两处漂移。)

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

/**
 * 彻底删除账户的结果。被交易引用时会拒绝(见 useFinanceStore.permanentlyDeleteAccount)。
 * 导出给回收站页面用:它需要把「有 N 笔交易挡着」的原因显示给用户。
 */
export type PermanentlyDeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: 'hasTransactions'; count: number };

/**
 * 清空回收站的结果。被交易挡住的账户会**跳过**(与「彻底删除账户」同一条规则),
 * 数量交给界面去说明,不允许静默少清几个。
 */
export type ClearRecycleBinResult = {
  /** 真正清掉的条目数(四类相加) */
  clearedCount: number;
  /** 被跳过的账户数 */
  blockedAccountCount: number;
  /** 这些账户名下挡着的交易数 */
  blockedTransactionCount: number;
};

/**
 * 恢复交易的结果。
 *
 * 恢复时若原分类**已不在启用列表**(被移入回收站或已彻底删除),这笔会按「未分类」恢复 ——
 * 因为「不在启用分类里」的 id 会让列表、筛选、助手计数、首页占比四处口径互相矛盾
 * (见 restoreCategoryReference.test.ts 的说明)。笔数交给界面说明,不允许静默改口径。
 */
export type RestoreTransactionResult = {
  /** 真正恢复回来的流水数(退款/冲正一并回来的也算) */
  restoredCount: number;
  /** 其中因为原分类不在启用列表而按「未分类」恢复的笔数 */
  uncategorizedCount: number;
};

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

export type TransactionWritePayload = Omit<TransactionItem, 'id'>;
export type AccountUpdatePayload = Partial<
  Pick<Account, 'name' | 'type' | 'initialBalance' | 'sortOrder'>
>;

export type TransactionBatchOperation =
  | { operation: 'add'; payload: TransactionWritePayload }
  | { operation: 'update'; id: string; payload: TransactionWritePayload };

export interface TransactionBatchWriteResult {
  addedIds: string[];
  updatedIds: string[];
}

export interface AddTransactionAction {
  (payload: TransactionWritePayload): string;
  (operations: TransactionBatchOperation[]): TransactionBatchWriteResult;
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
  addTransaction: AddTransactionAction;
  updateTransaction: (
    id: string,
    payload: Omit<TransactionItem, 'id'>,
    options?: { allowRefundOverflow?: boolean; skipCategoryLearning?: boolean }
  ) => void;
  removeTransaction: (id: string) => void;
  restoreTransaction: (id: string) => RestoreTransactionResult;
  permanentlyDeleteTransaction: (id: string) => void;
  refundTransaction: (input: RefundTransactionInput) => RefundTransactionResult;
  addCategory: (
    name: string,
    options?: {
      kind?: Category['kind'];
      color?: string;
      icon?: string;
      /** 上级分类 id;留空表示一级分类。 */
      parentId?: string;
    }
  ) => string;
  updateCategory: (id: string, payload: Partial<Omit<Category, 'id'>>) => void;
  reorderCategories: (orderedIds: string[]) => void;
  removeCategory: (id: string) => void;
  restoreCategory: (id: string) => void;
  permanentlyDeleteCategory: (id: string) => void;
  addAccount: (name: string, type?: Account['type'], initialBalance?: number) => string;
  updateAccount: (id: string, payload: AccountUpdatePayload) => void;
  updateAccountBalance: (id: string, balance: number) => void;
  reorderAccounts: (orderedIds: string[]) => void;
  removeAccount: (id: string) => void;
  restoreAccount: (id: string) => void;
  permanentlyDeleteAccount: (id: string) => PermanentlyDeleteAccountResult;
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
  clearRecycleBin: () => ClearRecycleBinResult;
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

/**
 * 一个账户挡着多少笔交易 —— 「能不能彻底删掉这个账户」的唯一判据。
 *
 * `includeTrashed`:逐个删账户时算上**回收站里的交易**(那条路径不会顺手清掉它们,
 * 留着就会出现指向已删账户的行);清空回收站时不算 —— 那一步本来就会把回收站里的
 * 交易一起删掉,再拿它们当理由跳过账户只会让用户困惑(点第二次又突然能清了)。
 */
function countBlockingTransactions(
  state: Pick<FinanceState, 'transactions' | 'trashedTransactions'>,
  accountId: string,
  includeTrashed: boolean
): number {
  const active = state.transactions.filter((item) => item.accountId === accountId).length;
  if (!includeTrashed) return active;
  return active + state.trashedTransactions.filter((item) => item.accountId === accountId).length;
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
  // 统一走 shared/lib/money:全项目只保留一套取整算法,避免 1.005 在不同模块得到
  // 1.00 / 1.01 两种结果。
  return roundMoney(raw);
}

function inferSubscriptionCategoryId(item: SubscriptionItem): string {
  if (item.kind === 'mobile') return 'cat-communication';
  if (item.kind === 'membership' || item.kind === 'digital') return 'cat-entertainment';
  return 'cat-other';
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
  // 注意:这里**不**用 `status === 'refunded'` 作为「这行是退款」的依据。
  // 应用在「全额退款」后会把**原交易**的 status 置为 refunded(见 refundTransaction),
  // 那行本质是支出;把它当成退款会让方向反转,账户余额差出两个金额
  // (支出 100 → 余额从 900 变成 1100)。
  // 应用自己写的退款行都会显式带 adjustmentKind: 'refund',不依赖这里的推断。
  if (REFUND_HINT_PATTERN.test(categoryName) || REFUND_HINT_PATTERN.test(note)) {
    return 'refund';
  }

  return 'normal';
}

function normalizeTransactionSemantic(tx: TransactionItem, categoryName: string): TransactionItem {
  const adjustmentKind = normalizeAdjustmentKind(tx, categoryName);
  // 退款/冲正行保留原始收支类型,方向由 getTransactionDirection 依类型取反计算,
  // 这样「收入退款」才会正确地表现为资金流出而不是又记一笔流入。
  const nextType = tx.type;

  return {
    ...tx,
    amount: roundCurrency(tx.amount),
    type: nextType,
    categoryId: tx.categoryId || '',
    adjustmentKind,
    updatedAt: tx.updatedAt || tx.date || new Date().toISOString()
  };
}

function categoryNameKey(raw: string): string {
  return normalizeCategoryName(raw).toLocaleLowerCase('zh-CN');
}

/**
 * 同名、同父级的分类在账本里视为同一个分类。
 * 导入、助手和界面三处都必须按同一条规则判重,
 * 否则「输入后表单清空、却什么都没创建」这种没有反馈的失败就会复现。
 */
export function findDuplicateCategory(
  categories: Category[],
  name: string,
  parentId?: string,
  excludeId?: string
): Category | undefined {
  const key = categoryNameKey(name);
  const targetParentId = parentId || '';
  return categories.find(
    (item) =>
      item.id !== excludeId &&
      categoryNameKey(item.name) === key &&
      (item.parentId || '') === targetParentId
  );
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
    // 同名分类只要上级不同就允许共存,例如「餐饮 / 其他」与「交通 / 其他」。
    const key = `${categoryNameKey(normalizedName)}::${item.parentId || ''}`;
    const found = canonicalByKey.get(key);
    if (found) {
      categoryIdAlias.set(item.id, found.id);
      return;
    }
    const normalizedRow = { ...item, name: normalizedName };
    canonicalByKey.set(key, normalizedRow);
    mergedCategories.push(normalizedRow);
  });

  // 父分类若被合并或已删除,子分类要跟到规范化后的父 id,或退回一级分类。
  const categoryIdSet = new Set(mergedCategories.map((item) => item.id));
  const normalizedCategories = mergedCategories.map((item) => {
    if (!item.parentId) return item;
    const resolvedParentId = categoryIdAlias.get(item.parentId) || item.parentId;
    return categoryIdSet.has(resolvedParentId)
      ? { ...item, parentId: resolvedParentId }
      : { ...item, parentId: undefined };
  });

  const categoryNameById = new Map(normalizedCategories.map((item) => [item.id, item.name]));
  const normalizeTransactionList = (rows: TransactionItem[]) =>
    rows.map((tx) => {
      const remappedCategoryId = categoryIdAlias.get(tx.categoryId);
      const resolvedCategoryId =
        remappedCategoryId ||
        (tx.categoryId && categoryIdSet.has(tx.categoryId) ? tx.categoryId : '');

      const categoryName = categoryNameById.get(resolvedCategoryId) || '';

      return normalizeTransactionSemantic({ ...tx, categoryId: resolvedCategoryId }, categoryName);
    });

  const nextTransactions = normalizeTransactionList(transactions);
  const nextExtraTransactions = normalizeTransactionList(extraTransactions);

  // 两个数组必须互斥、且各自内部不重复:
  // - 主列表里带着 trashedAt 的行属于回收站,否则交易列表会把已删除的记录当正常记录展示
  //   (账户余额本来就排除它,列表和数字就对不上了);
  // - 同一个 id 同时出现在两边时**以回收站为准** —— 宁可让用户手动恢复,也不要凭空
  //   把一笔已删除的钱重新加回账本。
  const trashedById = new Map(nextExtraTransactions.map((item) => [item.id, item]));
  const liveTransactions: TransactionItem[] = [];
  for (const row of nextTransactions) {
    if (trashedById.has(row.id)) {
      continue;
    }
    if (row.trashedAt) {
      trashedById.set(row.id, row);
      continue;
    }
    liveTransactions.push(row);
  }

  return {
    categories: normalizedCategories,
    transactions: liveTransactions,
    extraTransactions: [...trashedById.values()]
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
        status: resolveSubscriptionStatus(item)
      }))
    : [];
  const incomingTrashedSubscriptions = Array.isArray(payload.trashedSubscriptions)
    ? ensureUniqueById(
        payload.trashedSubscriptions.map((item) => ({
          ...item,
          status: resolveSubscriptionStatus(item)
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
  // 单趟累加:原实现对每个账户都遍历一遍全部流水(O(账户 × 流水)),1 万条 × 5 账户
  // 就是 5 万次循环,而这段在**每次写操作**时都会跑。这里改成遍历一次流水、按账户累加,
  // 语义完全一致(同一账户内的相加顺序不变,结果同样先求和再取整)。
  const accountIds = new Set(normalizedAccounts.map((item) => item.id));
  const deltas = new Map<string, number>();
  for (const item of transactions) {
    const accountId = item.accountId;
    if (!accountId || !accountIds.has(accountId)) continue;
    if (item.trashedAt || !isBalanceAffectingStatus(item.status)) continue;
    deltas.set(accountId, (deltas.get(accountId) ?? 0) + getSignedAmount(item));
  }

  return normalizedAccounts.map((account) => {
    const base = roundCurrency(Number(account.initialBalance ?? 0));
    return {
      ...account,
      initialBalance: base,
      balance: roundCurrency(base + (deltas.get(account.id) ?? 0))
    };
  });
}

function getBalanceChangeType(tx: TransactionItem): BalanceChangeType {
  if (isTransactionRefundLike(tx)) {
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

  // 先算好排序键再排:原实现把 new Date(...) 放在比较函数里,每次比较都要解析两次日期 ——
  // 1 万条流水约有 12 万次比较,等于每次写操作都要分配二十多万个 Date 对象。
  // 排序规则不变:先按日期,再按更新时间,最后按 id。
  const sortKeys = new Map<string, { date: number; updated: number }>();
  for (const tx of transactions) {
    sortKeys.set(tx.id, {
      date: new Date(tx.date).getTime(),
      updated: new Date(tx.updatedAt || tx.date).getTime()
    });
  }
  const sortedTransactions = [...transactions].sort((a, b) => {
    const keyA = sortKeys.get(a.id);
    const keyB = sortKeys.get(b.id);
    const dateDiff = (keyA?.date ?? 0) - (keyB?.date ?? 0);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    const updatedDiff = (keyA?.updated ?? 0) - (keyB?.updated ?? 0);
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
      remark: isTransactionRefundLike(tx)
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

function createTransactionRow(
  payload: Omit<TransactionItem, 'id'>,
  id: string,
  now: string
): TransactionItem {
  return {
    ...payload,
    amount: roundCurrency(payload.amount),
    adjustmentKind: payload.adjustmentKind || 'normal',
    // 显式落一个状态:助手导入账单那条路径不传 status,于是库里出现 transaction_status
    // 为 NULL 的行(手工记账都会传 'completed')。缺状态的行虽然照样计入余额,
    // 但列表以前显示成「-」、与筛选器口径不一致。这里兜住,写入侧就不会再产出这种行。
    status: payload.status ?? DEFAULT_TRANSACTION_STATUS,
    updatedAt: payload.updatedAt || now,
    id
  };
}

function mergeTransactionRow(
  existing: TransactionItem,
  payload: Omit<TransactionItem, 'id'>,
  id: string,
  now: string
): TransactionItem {
  return {
    ...existing,
    ...payload,
    amount: roundCurrency(payload.amount),
    adjustmentKind: payload.adjustmentKind ?? existing.adjustmentKind ?? 'normal',
    refundOfTransactionId: payload.refundOfTransactionId ?? existing.refundOfTransactionId,
    attachments: payload.attachments ?? existing.attachments,
    // 编辑历史行时把缺失的状态补上,顺带修掉那些 NULL 行。
    status: payload.status ?? existing.status ?? DEFAULT_TRANSACTION_STATUS,
    updatedAt: now,
    id
  };
}

export const useFinanceStore = create<FinanceState>()(
  persist(
    (set, get) => ({
      hasHydrated: true,
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
      addTransaction: ((payloadOrOperations) => {
        if (Array.isArray(payloadOrOperations)) {
          if (payloadOrOperations.length === 0) {
            return { addedIds: [], updatedIds: [] };
          }

          const state = get();
          const transactions = [...state.transactions];
          const transactionIndexById = new Map(transactions.map((item, index) => [item.id, index]));
          const addedIds: string[] = [];
          const updatedIds: string[] = [];
          const changedRows: Array<{
            action: 'insert' | 'update';
            row: TransactionItem;
            id: string;
          }> = [];
          const now = new Date().toISOString();

          payloadOrOperations.forEach((operation) => {
            if (operation.operation === 'update') {
              const index = transactionIndexById.get(operation.id);
              if (index === undefined) {
                throw new Error(`覆盖目标交易不存在: ${operation.id}`);
              }
              const row = mergeTransactionRow(
                transactions[index],
                operation.payload,
                operation.id,
                now
              );
              transactions[index] = row;
              updatedIds.push(operation.id);
              changedRows.push({ action: 'update', row, id: operation.id });
              return;
            }

            const id = generateId();
            const row = createTransactionRow(operation.payload, id, now);
            transactionIndexById.set(id, transactions.length);
            transactions.push(row);
            addedIds.push(id);
            changedRows.push({ action: 'insert', row, id });
          });

          set({
            transactions,
            ...rebuildStateSlices(state.accounts, transactions, state.balanceChangeEntries)
          });
          changedRows.forEach(({ action, row, id }) => {
            if (action === 'insert') {
              void syncChangeIfNeeded({ entity: 'transactions', action, row });
            } else {
              void syncChangeIfNeeded({ entity: 'transactions', action, row, id });
            }
          });
          return { addedIds, updatedIds };
        }

        const id = generateId();
        const row = createTransactionRow(payloadOrOperations, id, new Date().toISOString());
        set((s) => {
          const transactions = [...s.transactions, row];
          return {
            transactions,
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        void syncChangeIfNeeded({ entity: 'transactions', action: 'insert', row });
        return id;
      }) as AddTransactionAction,
      updateTransaction: (id, payload, options) => {
        let updatedRow: TransactionItem | null = null;
        // 退款关联的不变量:同一笔交易的退款/冲正总额不得超过它的金额。
        // 创建退款那条路径已经守住了,但**编辑**绕过它 —— 把原交易金额改小、或把退款金额
        // 改大,都会让这个不变量失效:账户净额会凭空多出一笔钱(支出变小、退款照旧流入)。
        // 这里在写入前挡下来,错误信息由调用方展示(与 refundTransaction 的处理方式一致)。
        if (!options?.allowRefundOverflow) {
          const rows = get().transactions;
          const existing = rows.find((item) => item.id === id);
          if (existing) {
            const nextAmount = roundCurrency(payload.amount);
            const refundedForThisRow = getRefundedAmount(rows, id);
            if (refundedForThisRow > 0 && nextAmount < refundedForThisRow) {
              throw new Error(
                `这笔已退 ${refundedForThisRow.toFixed(2)} 元,金额不能低于该值。请先处理对应的退款单。`
              );
            }

            const nextAdjustmentKind =
              payload.adjustmentKind ?? existing.adjustmentKind ?? 'normal';
            const originalId = payload.refundOfTransactionId ?? existing.refundOfTransactionId;
            const isRefundLike =
              nextAdjustmentKind === 'refund' || nextAdjustmentKind === 'reversal';
            if (isRefundLike && originalId) {
              const original = rows.find((item) => item.id === originalId);
              if (original) {
                // 已退总额里含本行,先减去本行旧值,再加上改后的值
                const others = roundCurrency(
                  getRefundedAmount(rows, originalId) - Math.abs(roundCurrency(existing.amount))
                );
                const nextTotal = roundCurrency(others + Math.abs(nextAmount));
                const originalAmount = roundCurrency(original.amount);
                if (nextTotal > originalAmount) {
                  throw new Error(
                    `退款总额不能超过原交易金额 ${originalAmount.toFixed(2)} 元(其余退款已占 ${others.toFixed(2)} 元)。`
                  );
                }
              }
            }
          }
        }
        let previousRow: TransactionItem | null = null;
        set((s) => {
          const existing = s.transactions.find((item) => item.id === id);
          if (!existing) {
            return s;
          }
          previousRow = existing;
          // 编辑表单只提交可编辑字段;退款关联、附件等仅在详情页维护的字段必须保留,
          // 否则一次普通编辑就会把退款单改成普通流水,导致余额方向反掉。
          const row = mergeTransactionRow(existing, payload, id, new Date().toISOString());
          updatedRow = row;
          const transactions = s.transactions.map((item) => (item.id === id ? row : item));
          return {
            transactions,
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        if (updatedRow) {
          /*
           * 分类被改动时学一条规则 —— 这是「分类学习」唯一的触发点。
           * 不在这里记录的话,那套规则永远不会产生(它之前确实是空壳)。
           *
           * 但**机器猜的分类不算**:AI 重分类(`recategorizeByAi`)与关键词兜底也会走
           * `updateTransaction` 改 categoryId,若照记不误,那些**猜测**就会被当成
           * "用户的一次修正"存进规则里,以后同类交易按 AI 当时猜的走 —— 规则本该学的是人的习惯。
           * 所以那些路径传 skipCategoryLearning: true。
           */
          // 这两个变量都是在闭包里赋的值,TS 的控制流分析会把它们收窄成 never,这里显式取出来
          const row = updatedRow as TransactionItem;
          const prev = previousRow as TransactionItem | null;
          if (!options?.skipCategoryLearning && prev && prev.categoryId !== row.categoryId) {
            get().recordCategoryCorrection({
              type: row.type,
              note: row.note || '',
              merchantOrderNo: row.merchantOrderNo,
              orderNo: row.orderNo,
              fromCategoryId: prev.categoryId,
              toCategoryId: row.categoryId
            });
          }
          void syncChangeIfNeeded({
            entity: 'transactions',
            action: 'update',
            row: updatedRow,
            id
          });
        }
      },
      removeTransaction: (id) => {
        let trashedRows: TransactionItem[] = [];
        set((s) => {
          const target = s.transactions.find((item) => item.id === id);
          if (!target) {
            return s;
          }
          /*
           * 退款 / 冲正单是这笔交易的附属记录,不能留在账上。
           * 原先只移送目标这一行:删掉一笔 ¥100 的支出、留下 ¥40 的退款,
           * 余额反而从 ¥1000 变成 ¥1040 —— 退款成了凭空多出来的收入
           * (演示账本里「家居小物 ¥390.55」就是一对,删原交易会凭空多出 ¥390.55)。
           */
          const dependents = s.transactions.filter(
            (item) =>
              item.id !== id && item.refundOfTransactionId === id && isTransactionRefundLike(item)
          );
          const removingIds = new Set([id, ...dependents.map((item) => item.id)]);
          trashedRows = [target, ...dependents].map((item) => markTrashedAt(item));
          const transactions = s.transactions.filter((item) => !removingIds.has(item.id));

          /*
           * 被删的这笔如果是某个订阅「生成支出」写出来的,订阅那一侧必须跟着退回去:
           * 生成时把续费日推进了一期,删掉流水却不退,再点一次生成就会**再推进一期** ——
           * 演示账本 iCloud+ 实测:基线 11/28 → 生成 12/28 → 删掉流水(仍 12/28)
           * → 再生成 2027/01/28,整段 12 月被跳过(提醒与资产负债预测都用这个日期)。
           *
           * 注意这里**不清理** prev 快照与 lastGeneratedTransactionId:回收站是**可逆**的,
           * 用户把流水恢复回来时要靠它们把日期推回「已生成」的状态(见 restoreTransaction)。
           * 真正该清掉的是**彻底删除**——那时才不可逆。
           */
          const subscriptions = s.subscriptions.map((item) => {
            if (
              !item.lastGeneratedTransactionId ||
              !removingIds.has(item.lastGeneratedTransactionId)
            ) {
              return item;
            }
            const reverted = {
              ...item,
              renewalDate: item.prevRenewalDate ?? item.renewalDate,
              expireDate: item.prevExpireDate ?? item.expireDate
            };
            return {
              ...reverted,
              status: resolveSubscriptionStatus(reverted)
            };
          });
          const subscriptionsChanged = subscriptions.some(
            (item, index) => item !== s.subscriptions[index]
          );

          return {
            transactions,
            ...(subscriptionsChanged ? { subscriptions } : {}),
            trashedTransactions: ensureUniqueById([...s.trashedTransactions, ...trashedRows]),
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        trashedRows.forEach((row) => {
          void syncChangeIfNeeded({ entity: 'transactions', action: 'delete', id: row.id });
        });
      },
      restoreTransaction: (id) => {
        let restoredRows: TransactionItem[] = [];
        let uncategorizedCount = 0;
        set((s) => {
          const target = s.trashedTransactions.find((item) => item.id === id);
          if (!target) {
            return s;
          }
          /*
           * 与 removeTransaction 对称:删除时退款/冲正会**随原交易一起**进回收站
           * (确认框也明确写了「其中 1 笔退款/冲正会一并移入回收站」),所以恢复时也必须
           * 一起回来。只恢复原交易的话:支出回来了、退款还留在回收站,账上凭空少掉退款那一笔
           * —— 演示账本那对 ¥390.55,恢复后支付宝余额从 −26,556.20 变成 −26,946.75,
           * 而且那笔支出状态是「已退款」却找不到退款记录。
           */
          const dependents = s.trashedTransactions.filter(
            (item) =>
              item.id !== id && item.refundOfTransactionId === id && isTransactionRefundLike(item)
          );
          const restoringIds = new Set([id, ...dependents.map((item) => item.id)]);
          /*
           * 恢复时把「分类已不在启用列表」的引用清成 ''(=未分类)。
           *
           * 为什么必须清:删分类清掉的是**启用列表**里那些交易的引用(removeCategory 遍历的是
           * s.transactions),回收站里那一份仍然指着它 —— 原样搬回启用列表,就会留下一个既不是 ''
           * (未分类的正式表示)、也没有对应分类的 id。这个 id 会让同一份数据在四处口径互相矛盾:
           * 列表/导出查不到就显示「未分类」,但「未分类」筛选、助手待分类计数都按 !categoryId 判断,
           * 认不出它;首页分类占比还会按两个 key 分出两行同名的「未分类」。
           *
           * 与「删分类 → 这些交易归入未分类」是同一句承诺,只是换了一条路径。笔数交给界面说明。
           */
          const activeCategoryIds = new Set(s.categories.map((item) => item.id));
          const restoredAt = new Date().toISOString();
          restoredRows = [target, ...dependents].map((row) => {
            const revived = clearTrashedAt(row);
            if (!revived.categoryId || activeCategoryIds.has(revived.categoryId)) {
              return revived;
            }
            uncategorizedCount += 1;
            return { ...revived, categoryId: '', updatedAt: restoredAt };
          });
          const transactions = ensureUniqueById([...s.transactions, ...restoredRows]);
          /*
           * 与 removeTransaction 对称:删除时把续费日退回了(并保留了 prev 快照与关联),
           * 所以恢复这笔「生成的流水」时要把日期**推回生成后的状态**,否则订阅会落后一期 ——
           * 提醒按错的日期算,而且再点一次生成会为同一个周期重复记一笔(直接是钱的问题)。
           * 推进用的是生成时同一个函数,结果确定(月末夹取也一样)。
           */
          const subscriptions = s.subscriptions.map((item) => {
            if (
              !item.lastGeneratedTransactionId ||
              !restoringIds.has(item.lastGeneratedTransactionId)
            ) {
              return item;
            }
            const advanced = {
              ...item,
              renewalDate: advanceSubscriptionDate(
                item.prevRenewalDate ?? item.renewalDate,
                item.billingCycle,
                item.customCycleDays
              ),
              expireDate: advanceSubscriptionDate(
                item.prevExpireDate ?? item.expireDate,
                item.billingCycle,
                item.customCycleDays
              )
            };
            delete advanced.prevRenewalDate;
            delete advanced.prevExpireDate;
            return { ...advanced, status: resolveSubscriptionStatus(advanced) };
          });
          const subscriptionsChanged = subscriptions.some(
            (item, index) => item !== s.subscriptions[index]
          );
          return {
            transactions,
            ...(subscriptionsChanged ? { subscriptions } : {}),
            trashedTransactions: s.trashedTransactions.filter((item) => !restoringIds.has(item.id)),
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        restoredRows.forEach((row) => {
          void syncChangeIfNeeded({ entity: 'transactions', action: 'insert', row });
        });
        return { restoredCount: restoredRows.length, uncategorizedCount };
      },
      permanentlyDeleteTransaction: (id) => {
        /*
         * 彻底删除才**不可逆** —— 到这里才把订阅侧的快照与关联清掉。
         * (回收站里那一份仍然留着,因为还能恢复。)
         */
        set((s) => {
          const subscriptions = s.subscriptions.map((item) => {
            if (item.lastGeneratedTransactionId !== id) {
              return item;
            }
            const cleared = { ...item, lastGeneratedTransactionId: undefined };
            delete cleared.prevRenewalDate;
            delete cleared.prevExpireDate;
            return cleared;
          });
          const subscriptionsChanged = subscriptions.some(
            (item, index) => item !== s.subscriptions[index]
          );
          return {
            trashedTransactions: s.trashedTransactions.filter((item) => item.id !== id),
            ...(subscriptionsChanged ? { subscriptions } : {})
          };
        });
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
          if (isTransactionRefundLike(original)) {
            thrownError = new Error('退款单或冲正单不能再次发起退款。');
            return s;
          }
          if (original.status && original.status !== 'completed') {
            thrownError = new Error('只有已完成的交易才能发起退款。');
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
            type: original.type,
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
          const existing = findDuplicateCategory(s.categories, normalizedName, options?.parentId);
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
            parentId: options?.parentId,
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
        const affectedTransactions: TransactionItem[] = [];
        const reparentedCategories: Category[] = [];
        set((s) => {
          const target = s.categories.find((item) => item.id === id);
          if (!target) {
            return s;
          }
          const updatedAt = new Date().toISOString();
          const transactions = s.transactions.map((item) => {
            if (item.categoryId !== id) {
              return item;
            }
            const next = { ...item, categoryId: '', updatedAt };
            affectedTransactions.push(next);
            return next;
          });
          // 子分类不跟着父分类一起消失,直接提升为一级分类。
          const categories = s.categories
            .filter((item) => item.id !== id)
            .map((item) => {
              if (item.parentId !== id) return item;
              const next: Category = { ...item, parentId: undefined };
              reparentedCategories.push(next);
              return next;
            });
          return {
            categories,
            transactions,
            trashedCategories: ensureUniqueById([...s.trashedCategories, markTrashedAt(target)]),
            ...rebuildStateSlices(s.accounts, transactions, s.balanceChangeEntries)
          };
        });
        reparentedCategories.forEach((row) => {
          void syncChangeIfNeeded({ entity: 'categories', action: 'update', row, id: row.id });
        });
        affectedTransactions.forEach((row) => {
          void syncChangeIfNeeded({ entity: 'transactions', action: 'update', row, id: row.id });
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
      updateAccount: (id, payload) => {
        let updatedRow: Account | null = null;
        set((s) => {
          const target = s.accounts.find((item) => item.id === id);
          if (!target) return s;

          const nextName =
            payload.name !== undefined ? payload.name.trim().slice(0, 24) : target.name;
          const accounts = s.accounts.map((item) => {
            if (item.id !== id) return item;
            updatedRow = {
              ...item,
              ...payload,
              name: nextName || item.name
            };
            return updatedRow;
          });
          const rebuilt = rebuildStateSlices(accounts, s.transactions, s.balanceChangeEntries);
          return {
            accounts: rebuilt.accounts,
            balanceChangeEntries: rebuilt.balanceChangeEntries
          };
        });
        if (updatedRow) {
          void syncChangeIfNeeded({ entity: 'accounts', action: 'update', row: updatedRow, id });
        }
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
            if (tx.accountId !== id || tx.trashedAt || !isBalanceAffectingStatus(tx.status)) {
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
        /*
         * 拒绝彻底删除「仍被交易引用」的账户。
         *
         * 为什么:账户被彻底删除后,引用它的交易在下一次同步时会被服务端**静默丢弃**
         * (导入器丢掉引用无法解析的行),而库里那条 `account_id` 是 NOT NULL、外键也不允许
         * 悬垂引用 —— 于是「保留交易」这件事在当前数据模型里根本表达不出来。
         *
         * 回收站里的确认框此前写的是「移入回收站后仅移除账户本身,交易仍会保留」——
         * 那一步确实是准的,但用户接着点「彻底删除」时并不知道交易也要跟着没了。
         * 与其让它静默丢掉,不如在这里挡住,并告诉用户有哪几条挡着。
         *
         * (备选方案:把交易重指派到另一个账户 —— 那要用户选目标账户,属产品决策。)
         */
        let result: PermanentlyDeleteAccountResult = { ok: true };
        set((s) => {
          const blocking = countBlockingTransactions(s, id, true);
          if (blocking > 0) {
            result = { ok: false, reason: 'hasTransactions', count: blocking };
            return s;
          }
          return {
            trashedAccounts: s.trashedAccounts.filter((item) => item.id !== id)
          };
        });
        return result;
      },
      addSubscription: (payload) => {
        const id = generateId();
        const now = new Date().toISOString();
        const row: SubscriptionItem = {
          ...payload,
          id,
          amount: roundCurrency(payload.amount),
          currency: String(payload.currency || 'CNY').toUpperCase(),
          status: resolveSubscriptionStatus({
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
                  status: resolveSubscriptionStatus({
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
          const explicitAccountId = subscription.accountId;
          const accountId = explicitAccountId
            ? s.accounts.some((account) => account.id === explicitAccountId)
              ? explicitAccountId
              : undefined
            : s.accounts[0]?.id;
          if (!accountId) {
            // 订阅绑定的账户被删掉时不能照样写流水:那会留下指向不存在账户的 accountId,
            // 余额里看不到它、支出统计里却有它(同一屏两套数)。
            /*
             * 先区分「一个账户都没有」和「绑定的那个被删了」—— 前者说&#39;账户已不存在&#39;会误导:
             * 用户根本没有账户可指定。(这条是写测试时发现的,原本两种情况共用同一句。)
             */
            thrownError = new Error(
              s.accounts.length === 0
                ? '当前没有可用账户,无法生成支出记录。'
                : '订阅绑定的账户已不存在,请先重新指定账户。'
            );
            return s;
          }

          const today = new Date().toISOString();
          const existing = s.transactions.find(
            (item) =>
              item.accountId === accountId &&
              item.amount === roundCurrency(subscription.amount) &&
              isSameLocalDay(item.date, today) &&
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
          const subscriptions = s.subscriptions.map((item) => {
            if (item.id !== id) {
              return item;
            }
            // 记完这一期就把日期推到下一期。不推进的话,月付订阅过了第一期会
            // 永远停在「已到期」:支出已经记了,首页却在提示「续费已逾期」。
            const advanced = {
              ...item,
              renewalDate: advanceSubscriptionDate(
                item.renewalDate,
                item.billingCycle,
                item.customCycleDays
              ),
              expireDate: advanceSubscriptionDate(
                item.expireDate,
                item.billingCycle,
                item.customCycleDays
              ),
              /*
               * 记下**推进前**的日期:用户把这笔生成的流水删掉时,要把续费日精确退回上一期。
               * 不能靠倒推一期来还原 —— 日期推算是夹过月尾的(1月31日 +1月 = 2月28日,
               * 倒推只能得到 1月28日),存下来才是一分不差的还原。
               */
              prevRenewalDate: item.renewalDate,
              prevExpireDate: item.expireDate
            };
            return {
              ...advanced,
              lastGeneratedAt: today,
              lastGeneratedTransactionId: transaction.id,
              updatedAt: today,
              // 用推进后的日期重算状态;下面这行以前是空转(日期没变,结果必然相同)。
              status: resolveSubscriptionStatus(advanced)
            };
          });

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
        /*
         * 与「彻底删除账户」同一条规则:**仍被交易引用的账户不能真删**。
         *
         * 这里原来是无条件把四个数组清空 —— 于是「逐个删」被挡住的东西,从
         * 「清空回收站」这扇大门直接放走了:账户行真删之后,引用它的交易会在下一次
         * 整份导入时被服务端静默丢掉(见 permanentlyDeleteAccount 的说明)。
         * 现在跳过这些账户,并把数量交给界面说明;其余条目照常清掉。
         */
        const state = get();
        const blocked = state.trashedAccounts
          .map((item) => ({ id: item.id, count: countBlockingTransactions(state, item.id, false) }))
          .filter((entry) => entry.count > 0);
        const blockedIds = new Set(blocked.map((entry) => entry.id));

        const clearedCount =
          state.trashedTransactions.length +
          state.trashedCategories.length +
          state.trashedSubscriptions.length +
          state.trashedAccounts.length -
          blocked.length;

        set({
          trashedTransactions: [],
          trashedCategories: [],
          trashedAccounts: state.trashedAccounts.filter((item) => blockedIds.has(item.id)),
          trashedSubscriptions: []
        });

        return {
          clearedCount,
          blockedAccountCount: blocked.length,
          blockedTransactionCount: blocked.reduce((sum, entry) => sum + entry.count, 0)
        };
      },
      suggestCategoryByLearning: (input) => {
        // 原来是 () => null 的空壳:管道(数据模型/备份/同步/设置页文案)都建好了,逻辑没写
        return suggestCategoryFromRules(input, get().categoryLearningRules);
      },
      recordCategoryCorrection: (input) => {
        const { rules, event } = applyCategoryCorrection(get().categoryLearningRules, input);
        set((s) => ({
          categoryLearningRules: rules,
          // 事件只留最近 200 条,避免无限增长(同步载荷也会跟着变小)
          categoryLearningEvents: [event, ...s.categoryLearningEvents].slice(0, 200)
        }));
      },
      undoLatestCategoryLearning: () => {
        const events = get().categoryLearningEvents;
        if (events.length === 0) return false;
        const [latest, ...rest] = events;
        set((s) => ({
          categoryLearningEvents: rest,
          // 撤销是"尽力而为":把这次动过的规则整条移除。
          // 若这条规则是**更新**出来的(之前已有次数),移除后那一小段历史就找不回来了。
          categoryLearningRules: s.categoryLearningRules.filter(
            (rule) => !latest.ruleIds.includes(rule.id)
          )
        }));
        return true;
      },
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
      storage: sqlOnlyStorage,
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
