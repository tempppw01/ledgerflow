import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { formatCurrencyFixed2 } from '../../shared/lib/format';
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

const MIN_CATEGORY_PANEL_WIDTH = 360;
const MIN_ACCOUNTS_PANEL_WIDTH = 420;
const DEFAULT_CATEGORY_PANEL_WIDTH = 520;

export function CategoriesAccountsPage() {
  const navigate = useNavigate();
  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const transactions = useFinanceStore((s) => s.transactions);
  const addCategory = useFinanceStore((s) => s.addCategory);
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
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType | ''>('');
  const [accountInitialBalance, setAccountInitialBalance] = useState('0');
  const [adjustAmounts, setAdjustAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState<string | null>(null);
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null);
  const [pendingRemoveTagLabel, setPendingRemoveTagLabel] = useState<string | null>(null);
  const [editingBalances, setEditingBalances] = useState<Record<string, string>>({});
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [accountError, setAccountError] = useState('');
  const [mergeTargetByTag, setMergeTargetByTag] = useState<Record<string, string>>({});
  const [editingBalanceAccountId, setEditingBalanceAccountId] = useState<string | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(DEFAULT_CATEGORY_PANEL_WIDTH);

  const ACCOUNT_COLLAPSE_THRESHOLD = 8;

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 120);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const clampByContainer = () => {
      const node = layoutRef.current;
      if (!node) {
        return;
      }
      const total = node.getBoundingClientRect().width;
      const maxLeft = Math.max(MIN_CATEGORY_PANEL_WIDTH, total - MIN_ACCOUNTS_PANEL_WIDTH);
      setLeftPanelWidth((prev) => Math.min(Math.max(prev, MIN_CATEGORY_PANEL_WIDTH), maxLeft));
    };

    clampByContainer();
    window.addEventListener('resize', clampByContainer);

    return () => {
      window.removeEventListener('resize', clampByContainer);
    };
  }, []);

  const handleDividerMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = layoutRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const maxLeft = Math.max(MIN_CATEGORY_PANEL_WIDTH, rect.width - MIN_ACCOUNTS_PANEL_WIDTH);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(
        Math.max(moveEvent.clientX - rect.left, MIN_CATEGORY_PANEL_WIDTH),
        maxLeft
      );
      setLeftPanelWidth(nextWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('categories-accounts-resizing');
    };

    document.body.classList.add('categories-accounts-resizing');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  function submitCategory(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeNameInput(categoryName);
    if (!isValidName(normalized)) {
      setCategoryError('分类名称需为 1-24 个字符，且不能包含 < 或 >。');
      return;
    }
    const appearance = inferCategoryAppearance(normalized, categoryKind);
    addCategory(normalized, {
      kind: categoryKind,
      color: appearance.color,
      icon: appearance.icon
    });
    setCategoryName('');
    setCategoryError('');
  }

  function submitAccount(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeNameInput(accountName);
    if (!isValidName(normalized)) {
      setAccountError('账户名称需为 1-24 个字符，且不能包含 < 或 >。');
      return;
    }
    if (!accountType) {
      setAccountError('请选择账户类型后再添加账户。');
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

  const displayCategories = useMemo(
    () => (showAllCategories ? orderedCategories : []),
    [orderedCategories, showAllCategories]
  );

  const categoryUsageMap = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((tx) => {
      const prev = map.get(tx.categoryId) || 0;
      map.set(tx.categoryId, prev + 1);
    });
    return map;
  }, [transactions]);

  const displayTags = useMemo(() => (showAllTags ? tagGroups : []), [tagGroups, showAllTags]);

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
      note: '账户单笔调整',
      tags: ['账户校准'],
      source: 'manual',
      status: 'completed'
    });
    setAdjustAmounts((prev) => ({ ...prev, [accountId]: '' }));
  };

  const moveCategory = (categoryId: string, direction: -1 | 1) => {
    const orderedIds = [...categories]
      .sort(
        (a, b) =>
          (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
      )
      .map((item) => item.id);
    const currentIndex = orderedIds.indexOf(categoryId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) {
      return;
    }
    const next = [...orderedIds];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    reorderCategories(next);
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

  const renderCategoryRow = (item: Category) => (
    <li key={item.id} className="row categories-row">
      <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{ width: 20, height: 20, display: 'inline-grid', placeItems: 'center' }}
        >
          {item.icon || '📁'}
        </span>
        <strong>{item.name}</strong>
        <button
          type="button"
          className="tag-count-chip tag-count-chip-link"
          onClick={() => navigate(`/transactions?categoryId=${encodeURIComponent(item.id)}`)}
          aria-label={`查看分类 ${item.name} 的 ${categoryUsageMap.get(item.id) || 0} 条交易`}
        >
          {categoryUsageMap.get(item.id) || 0} 条
        </button>
      </span>
      <button type="button" onClick={() => moveCategory(item.id, -1)}>
        ↑
      </button>
      <button type="button" onClick={() => moveCategory(item.id, 1)}>
        ↓
      </button>
      <button type="button" className="danger" onClick={() => setPendingDeleteCategoryId(item.id)}>
        删除
      </button>
    </li>
  );

  return (
    <div
      className="grid categories-accounts-page"
      ref={layoutRef}
      style={{ '--categories-left-width': `${leftPanelWidth}px` } as CSSProperties}
    >
      <section className="panel categories-panel">
        <header className="categories-accounts-head">
          <h2>分类与标签管理</h2>
          <div className="categories-accounts-metrics" aria-label="分类统计">
            <span className="metric-chip">
              分类 <strong>{categories.length}</strong>
            </span>
            <span className="metric-chip">
              标签 <strong>{tagGroups.length}</strong>
            </span>
          </div>
        </header>
        <form
          onSubmit={submitCategory}
          className="row categories-form-row"
          style={{ marginBottom: 16 }}
        >
          <input
            placeholder="新增分类名称"
            value={categoryName}
            onChange={(e) => {
              setCategoryName(e.target.value);
              if (categoryError) setCategoryError('');
            }}
            style={{ flex: 1 }}
            maxLength={24}
          />
          <select
            aria-label="分类类型"
            value={categoryKind}
            onChange={(e) => setCategoryKind(e.target.value as 'income' | 'expense')}
          >
            <option value="expense">支出分类</option>
            <option value="income">收入分类</option>
          </select>
          <button className="primary" type="submit">
            添加
          </button>
        </form>
        {categoryError ? <small className="error">{categoryError}</small> : null}
        {loading ? (
          <LoadingSkeleton lines={4} />
        ) : categories.length === 0 ? (
          <EmptyState title="暂无分类" description="请添加第一个交易分类。" icon="🧩" />
        ) : (
          <section className="categories-fold-block">
            <button
              type="button"
              className="categories-fold-summary"
              aria-expanded={showAllCategories}
              onClick={() => setShowAllCategories((prev) => !prev)}
            >
              <span>
                <strong>分类库</strong>
                <small>统一管理名称、排序和删除</small>
              </span>
              <span className="categories-fold-meta">
                {categories.length} 个<i aria-hidden="true">{showAllCategories ? '⌃' : '⌄'}</i>
              </span>
            </button>
            {showAllCategories ? (
              <ul className="categories-list">{displayCategories.map(renderCategoryRow)}</ul>
            ) : null}
          </section>
        )}

        {tagGroups.length === 0 ? (
          <EmptyState
            title="暂无标签"
            description="新增交易时会自动建议并创建标签，后续可在此集中管理。"
            icon="🏷️"
          />
        ) : (
          <section className="categories-fold-block categories-fold-block-tags">
            <button
              type="button"
              className="categories-fold-summary"
              aria-expanded={showAllTags}
              onClick={() => setShowAllTags((prev) => !prev)}
            >
              <span>
                <strong>标签库</strong>
                <small>集中合并、清理交易标签</small>
              </span>
              <span className="categories-fold-meta">
                {tagGroups.length} 个<i aria-hidden="true">{showAllTags ? '⌃' : '⌄'}</i>
              </span>
            </button>
            {showAllTags ? (
              <ul className="categories-list">
                {displayTags.map((tag) => (
                  <li key={tag.key} className="row categories-row">
                    <span style={{ flex: 1 }}>
                      #{tag.label}
                      <button
                        type="button"
                        className="tag-count-chip tag-count-chip-link"
                        onClick={() =>
                          navigate(`/transactions?keyword=${encodeURIComponent(tag.label)}`)
                        }
                      >
                        {tag.count} 条
                      </button>
                    </span>
                    <select
                      aria-label={`选择 ${tag.label} 的合并目标`}
                      value={mergeTargetByTag[tag.key] || ''}
                      onChange={(e) =>
                        setMergeTargetByTag((prev) => ({ ...prev, [tag.key]: e.target.value }))
                      }
                    >
                      <option value="">选择合并目标</option>
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
                      onClick={() =>
                        mergeTagIntoAnother(tag.label, mergeTargetByTag[tag.key] || '')
                      }
                    >
                      合并
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => setPendingRemoveTagLabel(tag.label)}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )}
      </section>

      <div
        className="categories-accounts-resize-divider"
        role="separator"
        aria-label="调整分类与账户面板宽度"
        aria-orientation="vertical"
        onMouseDown={handleDividerMouseDown}
      />

      <section className="panel accounts-panel">
        <header className="categories-accounts-head">
          <h2>账户管理</h2>
          <div className="categories-accounts-metrics" aria-label="账户统计">
            <span className="metric-chip metric-chip-highlight">
              当前总余额 <strong>{formatCurrencyFixed2(totalBalance)}</strong>
            </span>
            <span className="metric-chip">
              负余额 <strong>{negativeAccounts}</strong>
            </span>
          </div>
        </header>

        {showAccountForm ? (
          <form onSubmit={submitAccount} className="account-create-form">
            <div className="account-create-grid">
              <div className="field">
                <label>账户名称</label>
                <input
                  placeholder="如：招商银行卡 / 零钱 / 花呗"
                  value={accountName}
                  onChange={(e) => {
                    setAccountName(e.target.value);
                    if (accountError) setAccountError('');
                  }}
                  maxLength={24}
                />
              </div>
              <div className="field">
                <label>账户类型</label>
                <select
                  aria-label="账户类型"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType | '')}
                >
                  <option value="">请选择类型</option>
                  <option value="cash">💵 现金</option>
                  <option value="debit">💳 借记卡</option>
                  <option value="savings">🏦 储蓄卡</option>
                  <option value="virtual">📱 虚拟账户</option>
                </select>
              </div>
              <div className="field">
                <label>初始余额</label>
                <input
                  type="number"
                  placeholder="0"
                  value={accountInitialBalance}
                  onChange={(e) => setAccountInitialBalance(e.target.value)}
                />
              </div>
            </div>
            <div className="account-create-actions">
              <span className="muted">新账户将参与交易汇总和余额统计。</span>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAccountForm(false);
                    setAccountError('');
                  }}
                >
                  取消
                </button>
                <button className="primary" type="submit">
                  保存账户
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="account-create-toolbar">
            <div>
              <strong>资金账户</strong>
              <p className="muted">集中管理银行卡、现金和虚拟账户，方便交易记录与余额追踪。</p>
            </div>
            <button className="primary" type="button" onClick={() => setShowAccountForm(true)}>
              ＋ 新增账户
            </button>
          </div>
        )}
        {accountError ? <small className="error">{accountError}</small> : null}

        {loading ? (
          <LoadingSkeleton lines={4} />
        ) : managedAccounts.length === 0 ? (
          <EmptyState title="暂无账户" description="请添加第一个资金账户。" icon="💳" />
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
                            {getAccountTypeLabel(item.type)}
                          </span>
                        ) : null}
                        <small>初始：{formatCurrencyFixed2(item.initialBalance ?? 0)}</small>
                      </div>
                      <div className="account-card-balance-wrap">
                        {isEditingBalance ? (
                          <div className="account-card-balance-editor">
                            <input
                              className="account-balance-input account-card-balance-editor-input"
                              type="number"
                              inputMode="decimal"
                              aria-label={`account-balance-editor-${item.id}`}
                              placeholder="输入余额"
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
                                保存
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelEditBalance(item.id, item.computedBalance)}
                              >
                                取消
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
                              onDoubleClick={() => startEditBalance(item.id, item.computedBalance)}
                              title="双击编辑余额"
                              aria-label={`account-balance-display-${item.id}`}
                            >
                              {formatCurrencyFixed2(item.computedBalance)}
                            </button>
                            <small>按交易自动汇总，双击可校准</small>
                          </>
                        )}
                      </div>
                    </header>

                    <details className="account-card-tools">
                      <summary>管理</summary>
                      <div className="account-card-tools-body">
                        <label>
                          <span>单笔调整</span>
                          <input
                            className="account-balance-input"
                            type="number"
                            placeholder="+收入 / -支出"
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
                          添加单笔调整
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAccount(item.id, -1)}
                          aria-label={`上移账户 ${item.name}`}
                        >
                          ↑ 上移
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAccount(item.id, 1)}
                          aria-label={`下移账户 ${item.name}`}
                        >
                          ↓ 下移
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => setPendingDeleteAccountId(item.id)}
                        >
                          删除
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
                  已显示 {displayAccounts.length}/{managedAccounts.length}
                </small>
                <button type="button" onClick={() => setShowAllAccounts((prev) => !prev)}>
                  {showAllAccounts ? '收起' : `展开剩余 ${hiddenAccountCount} 项`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(pendingDeleteCategoryId)}
        title="确认移入回收站"
        description={
          pendingDeleteCategoryUsageCount > 0
            ? `该分类下存在 ${pendingDeleteCategoryUsageCount} 条交易记录，移入回收站后这些交易会继续保留并归入“未分类”。是否继续？`
            : '该分类将先移入回收站，你之后仍可恢复或彻底删除。是否继续？'
        }
        confirmText="移入回收站"
        cancelText="取消"
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
        title="确认移除标签"
        description={
          pendingRemoveTagUsageCount > 0
            ? `该标签已用于 ${pendingRemoveTagUsageCount} 条交易，移除后将从这些交易中清除。是否继续？`
            : '移除后将无法恢复，是否继续？'
        }
        confirmText="确认移除"
        cancelText="取消"
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
        title="确认移入回收站"
        description={
          pendingDeleteLinkedCount > 0
            ? `该账户下存在 ${pendingDeleteLinkedCount} 条交易记录，移入回收站后仅移除账户本身，交易仍会保留。是否继续？`
            : '该账户将先移入回收站，你之后仍可恢复或彻底删除。是否继续？'
        }
        confirmText="移入回收站"
        cancelText="取消"
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
