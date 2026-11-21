import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { formatCurrencyFixed2 } from '../../shared/lib/format';
import { useTFallback } from '../../shared/lib/useTFallback';
import { EmptyState } from '../../shared/ui/EmptyState';
import { LoadingSkeleton } from '../../shared/ui/LoadingSkeleton';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { ALIPAY_LOGO_URL, WECHAT_LOGO_URL } from '../../shared/config/brandAssets';
import {
  getAccountDisplayIcon,
  getAccountDisplayIconUrl,
  getAccountTypeLabel,
  isAlipayAccountName,
  isWechatAccountName
} from '../../features/accounts/model/accountTypes';
import type { AccountType } from '../../features/accounts/model/accountTypes';
import type { Category } from '../../entities/category/types';

function normalizeNameInput(raw: string) {
  return raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

function isValidName(name: string) {
  return name.length >= 1 && name.length <= 24;
}

const GENERAL_ACCOUNT_TYPES: AccountType[] = ['cash', 'debit', 'savings', 'virtual'];
const CATEGORY_COLORS = [
  '#f97316',
  '#ec4899',
  '#8b5cf6',
  '#22c55e',
  '#06b6d4',
  '#ef4444',
  '#6366f1'
];
const CATEGORY_ICONS = ['🍜', '💰', '🛍️', '🏠', '🚇', '🎁', '📚', '💡', '📦'];

const CATEGORY_APPEARANCE_RULES: Array<{ pattern: RegExp; icon: string; color: string }> = [
  { pattern: /(工资|薪资|奖金|收入|salary|bonus|income)/i, icon: '💰', color: '#22c55e' },
  { pattern: /(餐|饭|外卖|奶茶|咖啡|food|meal|restaurant)/i, icon: '🍜', color: '#f97316' },
  { pattern: /(交通|地铁|公交|打车|加油|停车|taxi|metro|bus)/i, icon: '🚇', color: '#06b6d4' },
  { pattern: /(住房|房租|家居|物业|home|rent|house)/i, icon: '🏠', color: '#8b5cf6' },
  { pattern: /(购物|网购|衣服|日用|shopping|mall|store)/i, icon: '🛍️', color: '#ec4899' },
  { pattern: /(礼物|人情|gift|present|红包)/i, icon: '🎁', color: '#ef4444' },
  { pattern: /(学习|教育|课程|书|study|book|course)/i, icon: '📚', color: '#6366f1' }
];

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function inferCategoryAppearance(name: string, kind: 'income' | 'expense') {
  const normalized = name.trim();
  if (normalized) {
    const matched = CATEGORY_APPEARANCE_RULES.find((rule) => rule.pattern.test(normalized));
    if (matched) {
      return { icon: matched.icon, color: matched.color };
    }
  }

  if (kind === 'income') {
    return { icon: '💰', color: '#22c55e' };
  }

  const seed = hashString(`${normalized}-${kind}`);
  return {
    icon: CATEGORY_ICONS[seed % CATEGORY_ICONS.length],
    color: CATEGORY_COLORS[seed % CATEGORY_COLORS.length]
  };
}

export function CategoriesAccountsPage() {
  const navigate = useNavigate();
  const tf = useTFallback();
  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const transactions = useFinanceStore((s) => s.transactions);
  const addCategory = useFinanceStore((s) => s.addCategory);
  const updateCategory = useFinanceStore((s) => s.updateCategory);
  const reorderCategories = useFinanceStore((s) => s.reorderCategories);
  const removeCategory = useFinanceStore((s) => s.removeCategory);
  const addAccount = useFinanceStore((s) => s.addAccount);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const updateAccountBalance = useFinanceStore((s) => s.updateAccountBalance);
  const reorderAccounts = useFinanceStore((s) => s.reorderAccounts);
  const removeAccount = useFinanceStore((s) => s.removeAccount);

  const [categoryName, setCategoryName] = useState('');
  const [categoryKind, setCategoryKind] = useState<'income' | 'expense'>('expense');
  const [newCategoryParentId, setNewCategoryParentId] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryParentId, setEditCategoryParentId] = useState('');
  const [categoryActionError, setCategoryActionError] = useState('');
  /** 收起的父级分类 id:让「两级结构」能一眼看清,而不是 16 行平铺。 */
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<string[]>([]);
  /** 展开的「更多操作」行;同一时间只开一行,避免又变回一排按钮。 */
  const [openCategoryActionId, setOpenCategoryActionId] = useState<string | null>(null);
  const categoryNameInputRef = useRef<HTMLInputElement | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType | ''>('');
  const [accountInitialBalance, setAccountInitialBalance] = useState('0');
  const [adjustAmounts, setAdjustAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState<string | null>(null);
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null);
  const [pendingRemoveTagLabel, setPendingRemoveTagLabel] = useState<string | null>(null);
  const [editingBalances, setEditingBalances] = useState<Record<string, string>>({});
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [accountError, setAccountError] = useState('');
  const [mergeTargetByTag, setMergeTargetByTag] = useState<Record<string, string>>({});
  const [editingTagKey, setEditingTagKey] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editingBalanceAccountId, setEditingBalanceAccountId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<'categories' | 'accounts'>('categories');

  const ACCOUNT_COLLAPSE_THRESHOLD = 8;

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 120);
    return () => window.clearTimeout(timer);
  }, []);

  function submitCategory(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeNameInput(categoryName);
    if (!isValidName(normalized)) {
      setCategoryError(
        tf('categoriesAccounts.error.categoryName', '分类名称需为 1-24 个字符\uFF0C且不能包含 < 或 >。')
      );
      return;
    }
    const appearance = inferCategoryAppearance(normalized, categoryKind);
    addCategory(normalized, {
      kind: categoryKind,
      color: appearance.color,
      icon: appearance.icon,
      parentId: newCategoryParentId || undefined
    });
    setCategoryName('');
    setCategoryError('');
  }

  function submitAccount(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeNameInput(accountName);
    if (!isValidName(normalized)) {
      setAccountError(
        tf('categoriesAccounts.error.accountName', '账户名称需为 1-24 个字符，且不能包含 < 或 >。')
      );
      return;
    }
    if (!accountType) {
      setAccountError(tf('categoriesAccounts.error.accountType', '请选择账户类型后再添加账户。'));
      return;
    }
    const initialBalance = Number(accountInitialBalance || '0');
    addAccount(normalized, accountType, Number.isFinite(initialBalance) ? initialBalance : 0);
    setAccountName('');
    setAccountType('');
    setAccountInitialBalance('0');
    setAccountError('');
    setShowAccountForm(false);
  }

  const managedAccounts = useMemo(
    () =>
      accounts
        .filter((item) => !item.type || GENERAL_ACCOUNT_TYPES.includes(item.type))
        .sort(
          (a, b) =>
            Number(a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
              Number(b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
            a.name.localeCompare(b.name, 'zh-CN')
        ),
    [accounts]
  );

  const pendingDeleteLinkedCount = pendingDeleteAccountId
    ? transactions.filter((item) => item.accountId === pendingDeleteAccountId).length
    : 0;

  const pendingDeleteCategoryUsageCount = pendingDeleteCategoryId
    ? transactions.filter((item) => item.categoryId === pendingDeleteCategoryId).length
    : 0;

  const pendingDeleteCategoryChildCount = pendingDeleteCategoryId
    ? categories.filter((item) => item.parentId === pendingDeleteCategoryId).length
    : 0;

  const pendingRemoveTagUsageCount = pendingRemoveTagLabel
    ? transactions.reduce((count, tx) => {
        const exists = tx.tags.some(
          (tag) => tag.trim().toLowerCase() === pendingRemoveTagLabel.trim().toLowerCase()
        );
        return exists ? count + 1 : count;
      }, 0)
    : 0;

  const orderedCategories = useMemo(() => {
    return [...categories].sort(
      (a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
    );
  }, [categories]);

  const tagGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    transactions.forEach((tx) => {
      tx.tags.forEach((raw) => {
        const label = String(raw || '').trim();
        if (!label) {
          return;
        }
        const key = label.toLowerCase();
        const found = map.get(key);
        if (found) {
          found.count += 1;
          return;
        }
        map.set(key, { key, label, count: 1 });
      });
    });
    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.label.localeCompare(b.label, 'zh-CN');
    });
  }, [transactions]);

  const categoryUsageMap = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((tx) => {
      const prev = map.get(tx.categoryId) || 0;
      map.set(tx.categoryId, prev + 1);
    });
    return map;
  }, [transactions]);

  /** 当前收支类型下参与展示的分类。 */
  const activeKindCategories = useMemo(
    () => orderedCategories.filter((item) => (item.kind || 'expense') === categoryKind),
    [orderedCategories, categoryKind]
  );

  /** 只允许挂在一级分类下,保证最多两级。 */
  const rootCategoryOptions = useMemo(
    () => activeKindCategories.filter((item) => !item.parentId),
    [activeKindCategories]
  );

  const categoryTree = useMemo(() => {
    const knownIds = new Set(activeKindCategories.map((item) => item.id));
    const childrenByParent = new Map<string, Category[]>();
    activeKindCategories.forEach((item) => {
      const parentId = item.parentId && knownIds.has(item.parentId) ? item.parentId : '';
      if (!parentId) return;
      const list = childrenByParent.get(parentId) || [];
      list.push(item);
      childrenByParent.set(parentId, list);
    });

    return activeKindCategories
      .filter((item) => !item.parentId || !knownIds.has(item.parentId))
      .map((root) => {
        const children = childrenByParent.get(root.id) || [];
        const totalCount =
          (categoryUsageMap.get(root.id) || 0) +
          children.reduce((sum, child) => sum + (categoryUsageMap.get(child.id) || 0), 0);
        return { root, children, totalCount };
      });
  }, [activeKindCategories, categoryUsageMap]);

  const childCategoryCount = useMemo(
    () => orderedCategories.filter((item) => Boolean(item.parentId)).length,
    [orderedCategories]
  );

  const displayAccounts = useMemo(
    () =>
      showAllAccounts ? managedAccounts : managedAccounts.slice(0, ACCOUNT_COLLAPSE_THRESHOLD),
    [managedAccounts, showAllAccounts]
  );

  const hiddenAccountCount = Math.max(0, managedAccounts.length - displayAccounts.length);

  const accountBalanceMap = useMemo(() => {
    const map = new Map<string, number>();
    accounts.forEach((account) => {
      const balance = Number(account.balance ?? account.initialBalance ?? 0);
      map.set(account.id, Number.isFinite(balance) ? balance : 0);
    });
    return map;
  }, [accounts]);

  const applyAccountBalance = (accountId: string) => {
    const current = accounts.find((item) => item.id === accountId);
    if (!current) {
      return;
    }
    const raw =
      editingBalances[accountId] ??
      Number(
        accountBalanceMap.get(accountId) ?? current.balance ?? current.initialBalance ?? 0
      ).toFixed(2);
    const parsed = Number(raw || '0');
    if (!Number.isFinite(parsed)) {
      return;
    }
    const normalized = Math.round(parsed * 100) / 100;
    updateAccountBalance(accountId, normalized);
    setEditingBalances((prev) => ({ ...prev, [accountId]: normalized.toFixed(2) }));
    setEditingBalanceAccountId((prev) => (prev === accountId ? null : prev));
  };

  const startEditBalance = (accountId: string, computedBalance: number) => {
    setEditingBalanceAccountId(accountId);
    setEditingBalances((prev) => ({
      ...prev,
      [accountId]: Number.isFinite(computedBalance) ? computedBalance.toFixed(2) : '0.00'
    }));
  };

  const cancelEditBalance = (accountId: string, computedBalance: number) => {
    setEditingBalances((prev) => ({
      ...prev,
      [accountId]: Number.isFinite(computedBalance) ? computedBalance.toFixed(2) : '0.00'
    }));
    setEditingBalanceAccountId((prev) => (prev === accountId ? null : prev));
  };

  const handleBalanceInputKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    accountId: string,
    computedBalance: number
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyAccountBalance(accountId);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditBalance(accountId, computedBalance);
    }
  };

  const applySingleAdjustment = (accountId: string) => {
    const value = Number(adjustAmounts[accountId] || '0');
    if (!Number.isFinite(value) || value === 0) {
      return;
    }
    const category = categories.find((item) => item.kind === (value > 0 ? 'income' : 'expense'));
    if (!category) {
      return;
    }
    addTransaction({
      type: value > 0 ? 'income' : 'expense',
      categoryId: category.id,
      accountId,
      amount: Math.abs(value),
      date: new Date().toISOString(),
      note: tf('categoriesAccounts.adjustmentNote', '账户单笔调整'),
      tags: [tf('categoriesAccounts.adjustmentTag', '账户校准')],
      source: 'manual',
      status: 'completed'
    });
    setAdjustAmounts((prev) => ({ ...prev, [accountId]: '' }));
  };

  /** 同一层级内上下移动:只和相邻的同级分类交换顺序,不会跨父级乱跳。 */
  const moveCategoryWithinSiblings = (
    categoryId: string,
    direction: -1 | 1,
    siblingIds: string[]
  ) => {
    const siblingIndex = siblingIds.indexOf(categoryId);
    const swapWithId = siblingIds[siblingIndex + direction];
    if (siblingIndex < 0 || !swapWithId) return;

    const orderedIds = [...categories]
      .sort(
        (a, b) =>
          (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
      )
      .map((item) => item.id);
    const currentIndex = orderedIds.indexOf(categoryId);
    const targetIndex = orderedIds.indexOf(swapWithId);
    if (currentIndex < 0 || targetIndex < 0) return;

    const next = [...orderedIds];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    reorderCategories(next);
  };

  const startEditCategory = (item: Category) => {
    setEditingCategoryId(item.id);
    setEditCategoryName(item.name);
    setEditCategoryParentId(item.parentId || '');
    setCategoryActionError('');
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditCategoryName('');
    setEditCategoryParentId('');
    setCategoryActionError('');
  };

  const saveEditCategory = () => {
    if (!editingCategoryId) return;
    const normalized = normalizeNameInput(editCategoryName);
    if (!isValidName(normalized)) {
      setCategoryActionError(
        tf('categoriesAccounts.error.categoryName', '分类名称需为 1-24 个字符\uFF0C且不能包含 < 或 >。')
      );
      return;
    }
    updateCategory(editingCategoryId, {
      name: normalized,
      // 父级留空表示提升为一级分类;禁止把自己设成自己的父级。
      parentId:
        editCategoryParentId && editCategoryParentId !== editingCategoryId
          ? editCategoryParentId
          : undefined
    });
    cancelEditCategory();
  };

  const moveAccount = (accountId: string, direction: -1 | 1) => {
    const orderedIds = managedAccounts.map((item) => item.id);
    const currentIndex = orderedIds.indexOf(accountId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) {
      return;
    }
    const next = [...orderedIds];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    reorderAccounts(next);
  };

  const accountCards = useMemo(
    () =>
      displayAccounts.map((item) => {
        const computedBalance =
          accountBalanceMap.get(item.id) ?? Number(item.balance ?? item.initialBalance ?? 0);
        return {
          ...item,
          computedBalance
        };
      }),
    [displayAccounts, accountBalanceMap]
  );

  const removeTagFromAllTransactions = (tagLabel: string) => {
    const normalized = tagLabel.trim().toLowerCase();
    if (!normalized) {
      return;
    }
    transactions.forEach((tx) => {
      const nextTags = tx.tags.filter((t) => t.trim().toLowerCase() !== normalized);
      if (nextTags.length !== tx.tags.length) {
        updateTransaction(tx.id, { ...tx, tags: nextTags });
      }
    });
  };

  const startEditTag = (tag: { key: string; label: string }) => {
    setEditingTagKey(tag.key);
    setEditTagName(tag.label);
  };

  /** 把一个标签改名到新名字,同名标签自动去重。 */
  const renameTag = (fromLabel: string, toLabelRaw: string) => {
    const target = normalizeNameInput(toLabelRaw);
    const from = fromLabel.trim().toLowerCase();
    if (!target || !from) return;
    if (target.toLowerCase() === from) {
      setEditingTagKey(null);
      setEditTagName('');
      return;
    }
    transactions.forEach((tx) => {
      const hasTag = tx.tags.some((tag) => tag.trim().toLowerCase() === from);
      if (!hasTag) return;
      const seen = new Set<string>();
      const nextTags: string[] = [];
      tx.tags.forEach((tag) => {
        const value = tag.trim();
        if (!value) return;
        const next = value.toLowerCase() === from ? target : value;
        const key = next.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        nextTags.push(next);
      });
      updateTransaction(tx.id, { ...tx, tags: nextTags });
    });
    setEditingTagKey(null);
    setEditTagName('');
  };

  const mergeTagIntoAnother = (fromLabel: string, toLabel: string) => {
    const from = fromLabel.trim().toLowerCase();
    const to = toLabel.trim();
    if (!from || !to || from === to.toLowerCase()) {
      return;
    }
    transactions.forEach((tx) => {
      let touched = false;
      const normalizedSet = new Set<string>();
      const nextTags = tx.tags
        .map((tag) => {
          const key = tag.trim().toLowerCase();
          if (!key) {
            return '';
          }
          if (key === from) {
            touched = true;
            return to;
          }
          return tag.trim();
        })
        .filter((item) => {
          if (!item) return false;
          const key = item.toLowerCase();
          if (normalizedSet.has(key)) {
            return false;
          }
          normalizedSet.add(key);
          return true;
        });
      if (touched) {
        updateTransaction(tx.id, { ...tx, tags: nextTags });
      }
    });
  };

  const totalBalance = useMemo(
    () => accountCards.reduce((sum, item) => sum + item.computedBalance, 0),
    [accountCards]
  );

  const negativeAccounts = useMemo(
    () => accountCards.filter((item) => item.computedBalance < 0).length,
    [accountCards]
  );

  const renderCategoryNode = (
    item: Category,
    options: {
      isChild: boolean;
      siblingIds: string[];
      usage?: number;
      /** 一级分类下的子分类数量;大于 0 时显示折叠箭头与「N 个子分类」。 */
      childCount?: number;
      /** 该父级当前是否收起。 */
      collapsed?: boolean;
    }
  ) => {
    // 一级分类显示「自己 + 子分类」的合计,和点击后的筛选结果保持一致。
    const usage = options.usage ?? categoryUsageMap.get(item.id) ?? 0;

    if (editingCategoryId === item.id) {
      return (
        <li key={item.id} className="category-node is-editing">
          <form
            className="category-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveEditCategory();
            }}
          >
            <span className="category-node-icon" aria-hidden="true">
              {item.icon || '📁'}
            </span>
            <input
              value={editCategoryName}
              onChange={(event) => setEditCategoryName(event.target.value)}
              maxLength={24}
              aria-label={tf('categoriesAccounts.renameCategoryAria', '重命名分类 {name}').replace(
                '{name}',
                String(item.name)
              )}
              autoFocus
            />
            <select
              aria-label={tf('categoriesAccounts.setParentAria', '设置分类 {name} 的上级').replace(
                '{name}',
                String(item.name)
              )}
              value={editCategoryParentId}
              onChange={(event) => setEditCategoryParentId(event.target.value)}
            >
              <option value="">{tf('categoriesAccounts.parentNone', '作为一级分类')}</option>
              {rootCategoryOptions
                .filter((root) => root.id !== item.id)
                .map((root) => (
                  <option key={root.id} value={root.id}>
                    {tf('categoriesAccounts.parentIntoPrefix', '归入')} {root.name}
                  </option>
                ))}
            </select>
            <button className="primary" type="submit">
              {tf('common.save', '保存')}
            </button>
            <button type="button" onClick={cancelEditCategory}>
              {tf('confirmDialog.cancel', '取消')}
            </button>
          </form>
          {categoryActionError ? (
            <p className="category-action-error">{categoryActionError}</p>
          ) : null}
        </li>
      );
    }

    const childCount = options.childCount ?? 0;
    const hasChildren = !options.isChild && childCount > 0;
    const isCollapsed = options.collapsed === true;
    const isActionOpen = openCategoryActionId === item.id;

    return (
      <li
        key={item.id}
        className={`category-node ${options.isChild ? 'is-child' : 'is-root'}${
          hasChildren ? ' has-children' : ''
        }${isCollapsed ? ' is-collapsed' : ''}`}
      >
        <span className="category-node-main">
          {hasChildren ? (
            <button
              type="button"
              className="category-node-caret"
              aria-expanded={!isCollapsed}
              aria-label={(
                isCollapsed
                  ? tf('categoriesAccounts.expandCategoryAria', '展开 {name} 的子分类')
                  : tf('categoriesAccounts.collapseCategoryAria', '收起 {name} 的子分类')
              ).replace('{name}', String(item.name))}
              onClick={() =>
                setCollapsedCategoryIds((prev) =>
                  prev.includes(item.id)
                    ? prev.filter((idValue) => idValue !== item.id)
                    : [...prev, item.id]
                )
              }
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="category-node-caret-spacer" aria-hidden="true" />
          )}
          <span className="category-node-icon" aria-hidden="true">
            {item.icon || '📁'}
          </span>
          <span className="category-node-title">
            <strong>{item.name}</strong>
            {options.isChild ? (
              <small>{tf('categoriesAccounts.childBadge', '子分类')}</small>
            ) : hasChildren ? (
              <small>
                {tf('categoriesAccounts.childCountLabel', '{count} 个子分类').replace(
                  '{count}',
                  String(childCount)
                )}
              </small>
            ) : null}
          </span>
        </span>
        <span className="category-node-actions">
          <button
            type="button"
            className="category-count-chip"
            onClick={() => navigate(`/transactions?categoryId=${encodeURIComponent(item.id)}`)}
            aria-label={tf(
              'categoriesAccounts.viewCategoryTxAria',
              '查看分类 {name} 的 {count} 条交易'
            )
              .replace('{name}', String(item.name))
              .replace('{count}', String(usage))}
          >
            {usage} {tf('categoriesAccounts.countItems', '条')}
          </button>
          {!options.isChild ? (
            <button
              type="button"
              className="category-action"
              onClick={() => {
                setNewCategoryParentId(item.id);
                setCategoryName('');
                categoryNameInputRef.current?.focus();
              }}
            >
              {tf('categoriesAccounts.addChild', '＋子分类')}
            </button>
          ) : null}
          <button type="button" className="category-action" onClick={() => startEditCategory(item)}>
            {tf('categoriesAccounts.edit', '编辑')}
          </button>
          {/*
            排序与删除收进「更多操作」:原来每一行都平铺 +子分类 / 编辑 / ↑ / ↓ / 删除
            五个按钮,16 行就是 96 个按钮,整页 136 个 —— 这正是「凌乱」的来源。
            主操作(编辑、加子分类)保持常显,低频操作点一下再出现。
          */}
          <button
            type="button"
            className={`category-icon-action category-more-toggle${
              isActionOpen ? ' is-open' : ''
            }`}
            aria-expanded={isActionOpen}
            aria-label={tf('categoriesAccounts.moreActionsAria', '{name} 的更多操作').replace(
              '{name}',
              String(item.name)
            )}
            onClick={() => setOpenCategoryActionId(isActionOpen ? null : item.id)}
          >
            ⋯
          </button>
        </span>
        {isActionOpen ? (
          <div className="category-secondary-actions">
            <button
              type="button"
              className="category-action"
              onClick={() => {
                moveCategoryWithinSiblings(item.id, -1, options.siblingIds);
                setOpenCategoryActionId(null);
              }}
            >
              {tf('categoriesAccounts.moveUp', '↑ 上移')}
            </button>
            <button
              type="button"
              className="category-action"
              onClick={() => {
                moveCategoryWithinSiblings(item.id, 1, options.siblingIds);
                setOpenCategoryActionId(null);
              }}
            >
              {tf('categoriesAccounts.moveDown', '↓ 下移')}
            </button>
            <button
              type="button"
              className="category-action is-danger"
              onClick={() => {
                setPendingDeleteCategoryId(item.id);
                setOpenCategoryActionId(null);
              }}
            >
              {tf('categoriesAccounts.delete', '删除')}
            </button>
          </div>
        ) : null}
      </li>
    );
  };
  return (
    <div className="categories-accounts-page vi-page">
      <header className="categories-console-header">
        <div>
          <p className="categories-console-eyebrow">
            {tf('categoriesAccounts.eyebrow', '记账设置')}
          </p>
          <h1>{tf('nav.categoriesAccounts', '账户与分类')}</h1>
        </div>
        <div
          className="categories-console-stat"
          aria-label={tf('categoriesAccounts.statAria', '账户与分类概览')}
        >
          <strong>{categories.length + managedAccounts.length}</strong>
          <span>{tf('categoriesAccounts.statUnit', '项基础设置')}</span>
        </div>
      </header>

      <nav
        className="categories-console-tabs"
        aria-label={tf('categoriesAccounts.tabsAria', '账户与分类工作区')}
      >
        <button
          type="button"
          className={workspace === 'categories' ? 'is-active' : undefined}
          aria-current={workspace === 'categories' ? 'page' : undefined}
          onClick={() => setWorkspace('categories')}
        >
          {tf('categoriesAccounts.tabCategories', '分类与标签')}{' '}
          <span>{categories.length + tagGroups.length}</span>
        </button>
        <button
          type="button"
          className={workspace === 'accounts' ? 'is-active' : undefined}
          aria-current={workspace === 'accounts' ? 'page' : undefined}
          onClick={() => setWorkspace('accounts')}
        >
          {tf('categoriesAccounts.tabAccounts', '资金账户')} <span>{managedAccounts.length}</span>
        </button>
      </nav>

      {workspace === 'categories' ? (
        <section className="categories-console-workspace">
          <header className="categories-accounts-head">
            <div>
              <span className="categories-console-kicker">
                {tf('categoriesAccounts.categoriesKicker', '分类与标签')}
              </span>
              <h2>{tf('categoriesAccounts.categoriesTitle', '分类与标签管理')}</h2>
            </div>
            <div
              className="categories-accounts-metrics"
              aria-label={tf('categoriesAccounts.categoriesMetricsAria', '分类统计')}
            >
              <span className="metric-chip">
                {tf('categoriesAccounts.metricRoot', '一级分类')}{' '}
                <strong>{rootCategoryOptions.length}</strong>
              </span>
              <span className="metric-chip">
                {tf('categoriesAccounts.metricChild', '子分类')}{' '}
                <strong>{childCategoryCount}</strong>
              </span>
              <span className="metric-chip">
                {tf('categoriesAccounts.metricTag', '标签')} <strong>{tagGroups.length}</strong>
              </span>
            </div>
          </header>

          <div
            className="category-kind-switch"
            role="tablist"
            aria-label={tf('categoriesAccounts.kindTabsAria', '分类收支类型')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={categoryKind === 'expense'}
              className={categoryKind === 'expense' ? 'is-active' : undefined}
              onClick={() => {
                setCategoryKind('expense');
                setNewCategoryParentId('');
                setEditingCategoryId(null);
              }}
            >
              {tf('categoriesAccounts.kindExpense', '支出分类')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={categoryKind === 'income'}
              className={categoryKind === 'income' ? 'is-active' : undefined}
              onClick={() => {
                setCategoryKind('income');
                setNewCategoryParentId('');
                setEditingCategoryId(null);
              }}
            >
              {tf('categoriesAccounts.kindIncome', '收入分类')}
            </button>
          </div>

          <form onSubmit={submitCategory} className="category-create-form">
            <input
              ref={categoryNameInputRef}
              placeholder={
                categoryKind === 'expense'
                  ? tf('categoriesAccounts.newExpensePlaceholder', '新增支出分类')
                  : tf('categoriesAccounts.newIncomePlaceholder', '新增收入分类')
              }
              value={categoryName}
              onChange={(event) => {
                setCategoryName(event.target.value);
                if (categoryError) setCategoryError('');
              }}
              maxLength={24}
              aria-label={tf('categoriesAccounts.newCategoryNameAria', '新增分类名称')}
            />
            <select
              aria-label={tf('categoriesAccounts.parentCategoryAria', '上级分类')}
              value={newCategoryParentId}
              onChange={(event) => setNewCategoryParentId(event.target.value)}
            >
              <option value="">{tf('categoriesAccounts.parentNone', '作为一级分类')}</option>
              {rootCategoryOptions.map((root) => (
                <option key={root.id} value={root.id}>
                  {tf('categoriesAccounts.parentIntoPrefix', '归入')} {root.name}
                </option>
              ))}
            </select>
            <button className="primary" type="submit">
              {tf('categoriesAccounts.add', '添加')}
            </button>
          </form>
          {categoryError ? <small className="error">{categoryError}</small> : null}

          {loading ? (
            <LoadingSkeleton lines={4} />
          ) : categoryTree.length === 0 ? (
            <EmptyState
              title={tf('categoriesAccounts.emptyCategoriesTitle', '暂无分类')}
              description={tf(
                'categoriesAccounts.emptyCategoriesDescription',
                '先添加一个一级分类\uFF0C再往下挂子分类。'
              )}
              icon="🧩"
            />
          ) : (
            <section className="categories-fold-block">
              <div className="category-block-head">
                <strong>{tf('categoriesAccounts.structureTitle', '分类结构')}</strong>
                <small>
                  {categoryKind === 'expense'
                    ? tf('categoriesAccounts.kindExpenseShort', '支出')
                    : tf('categoriesAccounts.kindIncomeShort', '收入')}
                </small>
              </div>
              <ul className="category-tree">
                {categoryTree.map(({ root, children, totalCount }) => {
                  const isCollapsed = collapsedCategoryIds.includes(root.id);
                  return (
                    <li key={root.id} className="category-group">
                      <ul className="category-group-list">
                        {renderCategoryNode(root, {
                          isChild: false,
                          siblingIds: categoryTree.map((group) => group.root.id),
                          usage: totalCount,
                          childCount: children.length,
                          collapsed: isCollapsed
                        })}
                        {isCollapsed
                          ? null
                          : children.map((child) =>
                              renderCategoryNode(child, {
                                isChild: true,
                                siblingIds: children.map((item) => item.id)
                              })
                            )}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="categories-fold-block categories-fold-block-tags">
            <div className="category-block-head">
              <strong>{tf('categoriesAccounts.tagLibraryTitle', '标签库')}</strong>
            </div>
            {tagGroups.length === 0 ? (
              <EmptyState
                title={tf('categoriesAccounts.emptyTagsTitle', '暂无标签')}
                description={tf(
                  'categoriesAccounts.emptyTagsDescription',
                  '在交易里加标签后会自动汇总到这里。'
                )}
                icon="🏷️"
              />
            ) : (
              <ul className="tag-manage-list">
                {tagGroups.map((tag) => (
                  <li key={tag.key} className="tag-manage-item">
                    {editingTagKey === tag.key ? (
                      <form
                        className="tag-rename-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          renameTag(tag.label, editTagName);
                        }}
                      >
                        <input
                          value={editTagName}
                          onChange={(event) => setEditTagName(event.target.value)}
                          maxLength={24}
                          aria-label={tf(
                            'categoriesAccounts.renameTagAria',
                            '重命名标签 {name}'
                          ).replace('{name}', String(tag.label))}
                          autoFocus
                        />
                        <button className="primary" type="submit">
                          {tf('common.save', '保存')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTagKey(null);
                            setEditTagName('');
                          }}
                        >
                          {tf('confirmDialog.cancel', '取消')}
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="tag-manage-name">#{tag.label}</span>
                        <button
                          type="button"
                          className="category-count-chip"
                          onClick={() =>
                            navigate(`/transactions?keyword=${encodeURIComponent(tag.label)}`)
                          }
                        >
                          {tag.count} {tf('categoriesAccounts.countItems', '条')}
                        </button>
                        <span className="tag-manage-actions">
                          <button
                            type="button"
                            className="category-action"
                            onClick={() => startEditTag(tag)}
                          >
                            {tf('categoriesAccounts.rename', '重命名')}
                          </button>
                          <select
                            aria-label={tf(
                              'categoriesAccounts.mergeTargetAria',
                              '选择 {name} 的合并目标'
                            ).replace('{name}', String(tag.label))}
                            value={mergeTargetByTag[tag.key] || ''}
                            onChange={(event) =>
                              setMergeTargetByTag((prev) => ({
                                ...prev,
                                [tag.key]: event.target.value
                              }))
                            }
                          >
                            <option value="">
                              {tf('categoriesAccounts.mergeIntoPlaceholder', '合并到…')}
                            </option>
                            {tagGroups
                              .filter((item) => item.key !== tag.key)
                              .map((item) => (
                                <option key={item.key} value={item.label}>
                                  {item.label}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            className="category-action"
                            onClick={() =>
                              mergeTagIntoAnother(tag.label, mergeTargetByTag[tag.key] || '')
                            }
                          >
                            {tf('categoriesAccounts.merge', '合并')}
                          </button>
                          <button
                            type="button"
                            className="category-icon-action is-danger"
                            aria-label={tf(
                              'categoriesAccounts.deleteTagAria',
                              '删除标签 {name}'
                            ).replace('{name}', String(tag.label))}
                            onClick={() => setPendingRemoveTagLabel(tag.label)}
                          >
                            {tf('categoriesAccounts.delete', '删除')}
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      ) : (
        <section className="accounts-console-workspace">
          <header className="categories-accounts-head">
            <div>
              <span className="categories-console-kicker">
                {tf('categoriesAccounts.accountsKicker', '账户与资金')}
              </span>
              <h2>{tf('categoriesAccounts.accountsTitle', '账户管理')}</h2>
            </div>
            <div
              className="categories-accounts-metrics"
              aria-label={tf('categoriesAccounts.accountsMetricsAria', '账户统计')}
            >
              <span className="metric-chip metric-chip-highlight">
                {tf('categoriesAccounts.totalBalance', '当前总余额')}{' '}
                <strong>{formatCurrencyFixed2(totalBalance)}</strong>
              </span>
              <span className="metric-chip">
                {tf('categoriesAccounts.negativeBalance', '负余额')}{' '}
                <strong>{negativeAccounts}</strong>
              </span>
            </div>
          </header>

          {showAccountForm ? (
            <form onSubmit={submitAccount} className="account-create-form">
              <div className="account-create-grid">
                <div className="field">
                  <label>{tf('categoriesAccounts.accountName', '账户名称')}</label>
                  <input
                    placeholder={tf(
                      'categoriesAccounts.accountNamePlaceholder',
                      '如：招商银行卡 / 零钱 / 花呗'
                    )}
                    value={accountName}
                    onChange={(e) => {
                      setAccountName(e.target.value);
                      if (accountError) setAccountError('');
                    }}
                    maxLength={24}
                  />
                </div>
                <div className="field">
                  <label>{tf('categoriesAccounts.accountTypeLabel', '账户类型')}</label>
                  <select
                    aria-label={tf('categoriesAccounts.accountTypeLabel', '账户类型')}
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value as AccountType | '')}
                  >
                    <option value="">
                      {tf('categoriesAccounts.accountTypePlaceholder', '请选择类型')}
                    </option>
                    <option value="cash">
                      {tf('categoriesAccounts.accountTypeOption.cash', '💵 现金')}
                    </option>
                    <option value="debit">
                      {tf('categoriesAccounts.accountTypeOption.debit', '💳 借记卡')}
                    </option>
                    <option value="savings">
                      {tf('categoriesAccounts.accountTypeOption.savings', '🏦 储蓄卡')}
                    </option>
                    <option value="virtual">
                      {tf('categoriesAccounts.accountTypeOption.virtual', '📱 虚拟账户')}
                    </option>
                  </select>
                </div>
                <div className="field">
                  <label>{tf('categoriesAccounts.initialBalance', '初始余额')}</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={accountInitialBalance}
                    onChange={(e) => setAccountInitialBalance(e.target.value)}
                  />
                </div>
              </div>
              <div className="account-create-actions">
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAccountForm(false);
                      setAccountError('');
                    }}
                  >
                    {tf('confirmDialog.cancel', '取消')}
                  </button>
                  <button className="primary" type="submit">
                    {tf('categoriesAccounts.saveAccount', '保存账户')}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="account-create-toolbar">
              <div>
                <strong>{tf('categoriesAccounts.tabAccounts', '资金账户')}</strong>
              </div>
              <button className="primary" type="button" onClick={() => setShowAccountForm(true)}>
                {tf('categoriesAccounts.addAccount', '＋ 新增账户')}
              </button>
            </div>
          )}
          {accountError ? <small className="error">{accountError}</small> : null}

          {loading ? (
            <LoadingSkeleton lines={4} />
          ) : managedAccounts.length === 0 ? (
            <EmptyState
              title={tf('categoriesAccounts.emptyAccountsTitle', '暂无账户')}
              description={tf(
                'categoriesAccounts.emptyAccountsDescription',
                '请添加第一个资金账户。'
              )}
              icon="💳"
            />
          ) : (
            <>
              <div className="account-card-grid">
                {accountCards.map((item) => {
                  const balanceValue =
                    editingBalances[item.id] ?? Number(item.computedBalance || 0).toFixed(2);
                  const isEditingBalance = editingBalanceAccountId === item.id;
                  const accountIconUrl = getAccountDisplayIconUrl(item.name, item.type);
                  return (
                    <article key={item.id} className="account-card">
                      <header className="account-card-head">
                        <span className="account-card-icon" aria-hidden="true">
                          {isAlipayAccountName(item.name) ? (
                            <img
                              className="account-card-brand-icon alipay-icon"
                              src={ALIPAY_LOGO_URL}
                              alt=""
                            />
                          ) : isWechatAccountName(item.name) ? (
                            <img
                              className="account-card-brand-icon wechat-icon"
                              src={WECHAT_LOGO_URL}
                              alt=""
                            />
                          ) : accountIconUrl ? (
                            <img className="account-card-brand-icon" src={accountIconUrl} alt="" />
                          ) : (
                            getAccountDisplayIcon(item.name, item.type)
                          )}
                        </span>
                        <div className="account-card-main">
                          <strong>{item.name}</strong>
                          {item.type ? (
                            <span className="account-type-badge">
                              {tf(
                                `categoriesAccounts.accountType.${item.type}`,
                                getAccountTypeLabel(item.type)
                              )}
                            </span>
                          ) : null}
                          <small>
                            {tf('categoriesAccounts.initialPrefix', '初始：')}
                            {formatCurrencyFixed2(item.initialBalance ?? 0)}
                          </small>
                        </div>
                        <div className="account-card-balance-wrap">
                          {isEditingBalance ? (
                            <div className="account-card-balance-editor">
                              <input
                                className="account-balance-input account-card-balance-editor-input"
                                type="number"
                                inputMode="decimal"
                                aria-label={`account-balance-editor-${item.id}`}
                                placeholder={tf(
                                  'categoriesAccounts.balancePlaceholder',
                                  '输入余额'
                                )}
                                value={balanceValue}
                                onChange={(e) =>
                                  setEditingBalances((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value
                                  }))
                                }
                                onKeyDown={(event) =>
                                  handleBalanceInputKeyDown(event, item.id, item.computedBalance)
                                }
                                autoFocus
                              />
                              <div className="account-card-balance-editor-actions">
                                <button type="button" onClick={() => applyAccountBalance(item.id)}>
                                  {tf('common.save', '保存')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelEditBalance(item.id, item.computedBalance)}
                                >
                                  {tf('confirmDialog.cancel', '取消')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={`mono-inline account-card-balance account-card-balance-trigger ${
                                  item.computedBalance < 0
                                    ? 'account-card-balance-negative'
                                    : 'account-card-balance-positive'
                                }`}
                                onDoubleClick={() =>
                                  startEditBalance(item.id, item.computedBalance)
                                }
                                title={tf('categoriesAccounts.balanceEditTitle', '双击编辑余额')}
                                aria-label={`account-balance-display-${item.id}`}
                              >
                                {formatCurrencyFixed2(item.computedBalance)}
                              </button>
                              <small>
                                {tf(
                                  'categoriesAccounts.balanceAutoHint',
                                  '按交易自动汇总，双击可校准'
                                )}
                              </small>
                            </>
                          )}
                        </div>
                      </header>

                      <details className="account-card-tools">
                        <summary>{tf('categoriesAccounts.toolsSummary', '管理')}</summary>
                        <div className="account-card-tools-body">
                          <label>
                            <span>{tf('categoriesAccounts.singleAdjustment', '单笔调整')}</span>
                            <input
                              className="account-balance-input"
                              type="number"
                              placeholder={tf(
                                'categoriesAccounts.adjustmentPlaceholder',
                                '+收入 / -支出'
                              )}
                              value={adjustAmounts[item.id] || ''}
                              onChange={(e) =>
                                setAdjustAmounts((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value
                                }))
                              }
                            />
                          </label>
                          <button type="button" onClick={() => applySingleAdjustment(item.id)}>
                            {tf('categoriesAccounts.addAdjustment', '添加单笔调整')}
                          </button>
                          <button
                            type="button"
                            onClick={() => moveAccount(item.id, -1)}
                            aria-label={tf(
                              'categoriesAccounts.moveAccountUpAria',
                              '上移账户 {name}'
                            ).replace('{name}', String(item.name))}
                          >
                            {tf('categoriesAccounts.moveUp', '↑ 上移')}
                          </button>
                          <button
                            type="button"
                            onClick={() => moveAccount(item.id, 1)}
                            aria-label={tf(
                              'categoriesAccounts.moveAccountDownAria',
                              '下移账户 {name}'
                            ).replace('{name}', String(item.name))}
                          >
                            {tf('categoriesAccounts.moveDown', '↓ 下移')}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => setPendingDeleteAccountId(item.id)}
                          >
                            {tf('categoriesAccounts.delete', '删除')}
                          </button>
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>

              {managedAccounts.length > ACCOUNT_COLLAPSE_THRESHOLD ? (
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                  <small style={{ color: 'var(--color-text-secondary)' }}>
                    {tf('categoriesAccounts.shownPrefix', '已显示')} {displayAccounts.length}/
                    {managedAccounts.length}
                  </small>
                  <button type="button" onClick={() => setShowAllAccounts((prev) => !prev)}>
                    {showAllAccounts
                      ? tf('categoriesAccounts.collapse', '收起')
                      : tf('categoriesAccounts.expandRemaining', '展开剩余 {count} 项').replace(
                          '{count}',
                          String(hiddenAccountCount)
                        )}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteCategoryId)}
        title={tf('categoriesAccounts.confirmTrashTitle', '确认移入回收站')}
        description={
          pendingDeleteCategoryUsageCount > 0
            ? `${tf('categoriesAccounts.confirm.categoryUsage', '该分类下存在 {count} 条交易记录,').replace('{count}', String(pendingDeleteCategoryUsageCount))}${pendingDeleteCategoryChildCount > 0 ? tf('categoriesAccounts.confirm.categoryChildren', '其中 {count} 个子分类会提升为一级分类,').replace('{count}', String(pendingDeleteCategoryChildCount)) : ''}${tf('categoriesAccounts.confirm.categoryTrashed', '移入回收站后这些交易会继续保留并归入“未分类”。是否继续?')}`
            : `${pendingDeleteCategoryChildCount > 0 ? tf('categoriesAccounts.confirm.categoryChildren', '其中 {count} 个子分类会提升为一级分类,').replace('{count}', String(pendingDeleteCategoryChildCount)) : ''}${tf('categoriesAccounts.confirm.categoryTrashedOnly', '该分类将先移入回收站\uFF0C你之后仍可恢复或彻底删除。是否继续?')}`
        }
        confirmText={tf('categoriesAccounts.moveToTrash', '移入回收站')}
        cancelText={tf('confirmDialog.cancel', '取消')}
        danger
        onConfirm={() => {
          if (!pendingDeleteCategoryId) return;
          removeCategory(pendingDeleteCategoryId);
          setPendingDeleteCategoryId(null);
        }}
        onCancel={() => setPendingDeleteCategoryId(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingRemoveTagLabel)}
        title={tf('categoriesAccounts.confirmRemoveTagTitle', '确认移除标签')}
        description={
          pendingRemoveTagUsageCount > 0
            ? tf(
                'categoriesAccounts.confirm.tagUsage',
                '该标签已用于 {count} 条交易，移除后将从这些交易中清除。是否继续？'
              ).replace('{count}', String(pendingRemoveTagUsageCount))
            : tf('categoriesAccounts.confirm.tagRemovePlain', '移除后将无法恢复，是否继续？')
        }
        confirmText={tf('categoriesAccounts.confirmRemove', '确认移除')}
        cancelText={tf('confirmDialog.cancel', '取消')}
        danger
        onConfirm={() => {
          if (!pendingRemoveTagLabel) return;
          removeTagFromAllTransactions(pendingRemoveTagLabel);
          setPendingRemoveTagLabel(null);
        }}
        onCancel={() => setPendingRemoveTagLabel(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteAccountId)}
        title={tf('categoriesAccounts.confirmTrashTitle', '确认移入回收站')}
        description={
          pendingDeleteLinkedCount > 0
            ? tf(
                'categoriesAccounts.confirm.accountUsage',
                '该账户下存在 {count} 条交易记录，移入回收站后仅移除账户本身，交易仍会保留。是否继续？'
              ).replace('{count}', String(pendingDeleteLinkedCount))
            : tf(
                'categoriesAccounts.confirm.accountTrashPlain',
                '该账户将先移入回收站，你之后仍可恢复或彻底删除。是否继续？'
              )
        }
        confirmText={tf('categoriesAccounts.moveToTrash', '移入回收站')}
        cancelText={tf('confirmDialog.cancel', '取消')}
        danger
        onConfirm={() => {
          if (!pendingDeleteAccountId) return;
          removeAccount(pendingDeleteAccountId);
          setPendingDeleteAccountId(null);
        }}
        onCancel={() => setPendingDeleteAccountId(null)}
      />
    </div>
  );
}
