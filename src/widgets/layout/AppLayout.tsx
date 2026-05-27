import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ASSISTANT_MODE_CHANGED_EVENT,
  getAssistantModeLabel,
  readAssistantModeFromSessionStorage
} from '../../features/assistant/shared/assistantMode';
import { ThemeSwitcher } from '../../features/theme-switcher/ThemeSwitcher';
import { APP_LOGO_URL } from '../../shared/config/app';
import {
  BRAIN_ICON_URL,
  CHAT_ICON_URL,
  CHEVRONS_LEFT_RIGHT_ICON_URL,
  CHEVRONS_RIGHT_LEFT_ICON_URL,
  CIRCLE_USER_ICON_URL,
  DATABASE_ICON_URL
} from '../../shared/config/brandAssets';
import { formatCurrency } from '../../shared/lib/format';
import { summarizeTransactions } from '../../shared/lib/transactionMetrics';
import { useFinanceStore } from '../../shared/store/useFinanceStore';

type NavItem = {
  label: string;
  icon: string;
  iconSrc?: string;
  to?: string;
  end?: boolean;
  disabled?: boolean;
};

type QuickEntry = {
  label: string;
  icon: string;
  iconSrc?: string;
  to: string;
  end?: boolean;
};

const SIDEBAR_COLLAPSED_WIDTH = 76;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;

function truncateMobileInsightText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function renderNavIcon(item: { icon: string; iconSrc?: string }, className: string) {
  if (item.iconSrc) {
    return <img className={`${className} nav-image-icon`} src={item.iconSrc} alt="" />;
  }

  return <span className={className}>{item.icon}</span>;
}

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const [assistantWorkspaceTitle, setAssistantWorkspaceTitle] = useState(() =>
    getAssistantModeLabel(readAssistantModeFromSessionStorage(), t)
  );

  const navSections: Array<{ title: string; items: NavItem[] }> = useMemo(
    () => [
      {
        title: t('nav.assistant'),
        items: [
          {
            to: '/assistant',
            label: t('nav.assistantBookkeeping'),
            icon: '🤖',
            iconSrc: CHAT_ICON_URL
          },
          { to: '/smart-budget', label: t('nav.smartBudget'), icon: '🧠', iconSrc: BRAIN_ICON_URL },
          { to: '/global-memory', label: '全局记忆', icon: '🗃️' }
        ]
      },
      {
        title: t('nav.incomeExpense'),
        items: [
          { to: '/transactions', label: t('nav.transactions'), icon: '📋' },
          { to: '/', label: t('nav.dashboard'), icon: '📊', end: true },
          { to: '/financial-analysis', label: '财务分析', icon: '🧠' }
        ]
      },
      {
        title: t('nav.assetsDebt'),
        items: [
          { to: '/categories-accounts', label: t('nav.categoriesAccounts'), icon: '🗂️' },
          { to: '/balance-changes', label: '余额明细', icon: '📚' },
          { to: '/subscriptions', label: '订阅管理', icon: '🧾' },
          { to: '/repayment-management', label: t('nav.repayment'), icon: '💳' }
        ]
      },
      {
        title: t('nav.toolsInfo'),
        items: [
          { to: '/help', label: '帮助', icon: '❓' },
          { to: '/settings', label: t('nav.settings'), icon: '⚙️' },
          { to: '/database-settings', label: t('nav.dbSettings'), icon: '🗄️', iconSrc: DATABASE_ICON_URL },
          { to: '/recycle-bin', label: '回收站', icon: '🗑️' },
          { to: '/exchange', label: t('nav.exchange'), icon: '💱' },
          { to: '/salary-tools', label: '工资工具', icon: '💼' },
          { to: '/finance', label: t('nav.finance'), icon: '📰' },
          { to: '/about', label: t('nav.about'), icon: 'ℹ️' }
        ]
      }
    ],
    [t]
  );

  const mobileQuickGroups: Array<{ title: string; items: QuickEntry[] }> = useMemo(
    () => [
      {
        title: t('nav.commonFeatures'),
        items: [
          {
            label: t('nav.assistantBookkeeping'),
            icon: '🤖',
            iconSrc: CHAT_ICON_URL,
            to: '/assistant'
          },
          { label: '财务分析', icon: '🧠', to: '/financial-analysis' },
          { label: '订阅管理', icon: '🧾', to: '/subscriptions' },
          { label: t('nav.transactions'), icon: '📋', to: '/transactions' },
          { label: t('nav.dashboard'), icon: '📊', to: '/', end: true },
          { label: t('nav.categoriesAccounts'), icon: '🗂️', to: '/categories-accounts' },
          { label: '余额明细', icon: '📚', to: '/balance-changes' },
          { label: t('nav.smartBudget'), icon: '🧠', iconSrc: BRAIN_ICON_URL, to: '/smart-budget' },
          { label: '全局记忆', icon: '🗃️', to: '/global-memory' },
          { label: t('nav.repayment'), icon: '💳', to: '/repayment-management' },
          { label: '工资工具', icon: '💼', to: '/salary-tools' },
          { label: t('nav.finance'), icon: '📰', to: '/finance' },
          { label: t('nav.exchange'), icon: '💱', to: '/exchange' }
        ]
      },
      {
        title: t('nav.systemFeatures'),
        items: [
          { label: '帮助', icon: '❓', to: '/help' },
          { label: t('nav.settings'), icon: '⚙️', to: '/settings' },
          { label: t('nav.dbSettings'), icon: '🗄️', iconSrc: DATABASE_ICON_URL, to: '/database-settings' },
          { label: '回收站', icon: '🗑️', to: '/recycle-bin' },
          { label: t('nav.about'), icon: 'ℹ️', to: '/about' }
        ]
      }
    ],
    [t]
  );

  const currentWorkspaceTitle = useMemo(() => {
    const pathname = location.pathname;

    if (pathname === '/') {
      return t('nav.dashboard');
    }

    if (pathname.startsWith('/assistant')) {
      return assistantWorkspaceTitle;
    }

    const navItems = navSections.flatMap((section) => section.items);
    const matchedItem = navItems.find((item) => {
      if (!item.to || item.to === '/') {
        return false;
      }

      return pathname === item.to || pathname.startsWith(`${item.to}/`);
    });

    return matchedItem?.label ?? t('layout.workspaceTitle');
  }, [assistantWorkspaceTitle, location.pathname, navSections, t]);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navSections.map((section) => [section.title, true]))
  );

  useEffect(() => {
    setExpandedSections((prev) => {
      const next = Object.fromEntries(navSections.map((section) => [section.title, true]));
      for (const section of navSections) {
        if (prev[section.title] !== undefined) {
          next[section.title] = prev[section.title];
        }
      }
      return next;
    });
  }, [navSections]);

  useEffect(() => {
    const syncAssistantWorkspaceTitle = () => {
      setAssistantWorkspaceTitle(getAssistantModeLabel(readAssistantModeFromSessionStorage(), t));
    };

    syncAssistantWorkspaceTitle();
    window.addEventListener(ASSISTANT_MODE_CHANGED_EVENT, syncAssistantWorkspaceTitle);

    return () => {
      window.removeEventListener(ASSISTANT_MODE_CHANGED_EVENT, syncAssistantWorkspaceTitle);
    };
  }, [t]);

  const draggingRef = useRef(false);
  const transactions = useFinanceStore((s) => s.transactions);

  const monthLabel = new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'long'
  }).format(new Date());

  const todayLabel = new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const thisMonth = new Date();
  const monthTransactions = transactions.filter((item) => {
    const date = new Date(item.date);
    return (
      date.getMonth() === thisMonth.getMonth() && date.getFullYear() === thisMonth.getFullYear()
    );
  });
  const monthSummary = summarizeTransactions(monthTransactions);
  const monthIncome = monthSummary.incomeTotal;
  const monthExpense = monthSummary.expenseTotal;
  const monthBalance = monthSummary.netTotal;
  const monthTransactionCount = monthTransactions.length;
  const latestMonthTransaction = useMemo(
    () =>
      [...monthTransactions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )[0] ?? null,
    [monthTransactions]
  );
  const isEnglish = i18n.language === 'en';
  const mobileNavInsight = useMemo(() => {
    const defaultReviewTo = location.pathname.startsWith('/assistant')
      ? '/transactions?datePreset=thisMonth'
      : '/assistant';
    const defaultReviewAction = location.pathname.startsWith('/assistant')
      ? isEnglish
        ? 'Review month'
        : '查看本月流水'
      : isEnglish
        ? 'Ask AI'
        : '去 AI 复盘';

    if (monthTransactionCount === 0) {
      return {
        tone: 'idle',
        icon: '🧾',
        eyebrow: isEnglish ? 'This month' : '本月动态',
        title: isEnglish ? 'No records yet' : '本月还没有新流水',
        description: isEnglish
          ? 'Add one real transaction first, then the assistant can give more grounded follow-up suggestions.'
          : '先补一笔真实收支，再回来追问或复盘，会比固定提示更有参考价值。',
        actionLabel: isEnglish ? 'Quick add one' : '去补一笔',
        to: '/transactions?quickAdd=1&entry=layout'
      };
    }

    if (monthBalance < 0) {
      return {
        tone: 'warning',
        icon: '⚠️',
        eyebrow: isEnglish ? 'Cash flow' : '资金提醒',
        title: isEnglish
          ? `Monthly balance ${formatCurrency(monthBalance)}`
          : `本月结余 ${formatCurrency(monthBalance)}`,
        description: isEnglish
          ? `You've logged ${monthTransactionCount} records this month. Check budget pressure before continuing.`
          : `本月已记录 ${monthTransactionCount} 笔，当前已经偏紧，先看看预算或高频支出会更稳。`,
        actionLabel: isEnglish ? 'Open budget' : '去看预算',
        to: '/smart-budget'
      };
    }

    if (monthIncome === 0 && monthExpense > 0) {
      return {
        tone: 'focus',
        icon: '💸',
        eyebrow: isEnglish ? 'Income gap' : '记录提醒',
        title: isEnglish
          ? `Expenses ${formatCurrency(monthExpense)}`
          : `本月支出 ${formatCurrency(monthExpense)}`,
        description: isEnglish
          ? 'Expenses are already recorded, but income is still blank. Completing the flow will make monthly review clearer.'
          : '支出已经开始累积，但收入侧还是空白，补齐之后月度结余会更准确。',
        actionLabel: isEnglish ? 'Continue bookkeeping' : '继续记账',
        to: '/transactions?quickAdd=1&entry=layout'
      };
    }

    const latestSummary = latestMonthTransaction?.note?.trim()
      ? truncateMobileInsightText(latestMonthTransaction.note.trim(), isEnglish ? 36 : 18)
      : latestMonthTransaction
        ? latestMonthTransaction.type === 'income'
          ? isEnglish
            ? 'Latest record is an income entry'
            : '最近一笔是收入记录'
          : latestMonthTransaction.type === 'repayment'
            ? isEnglish
              ? 'Latest record is a repayment entry'
              : '最近一笔是还款记录'
            : isEnglish
              ? 'Latest record is an expense entry'
              : '最近一笔是支出记录'
        : '';

    return {
      tone: 'positive',
      icon: '✨',
      eyebrow: isEnglish ? 'Latest update' : '最近更新',
      title: isEnglish
        ? `${monthTransactionCount} records this month`
        : `本月已记录 ${monthTransactionCount} 笔`,
      description: isEnglish
        ? latestSummary
          ? `${latestSummary}. Keep going or open the assistant for a quick review.`
          : 'Your monthly ledger is moving. Continue bookkeeping or open the assistant for a quick review.'
        : latestSummary
          ? `${latestSummary}。继续补齐，或者让 AI 直接帮你做一轮复盘。`
          : '这个月已经有连续记录了，继续补齐，或者让 AI 帮你做一轮复盘。',
      actionLabel: defaultReviewAction,
      to: defaultReviewTo
    };
  }, [
    isEnglish,
    latestMonthTransaction,
    location.pathname,
    monthBalance,
    monthExpense,
    monthIncome,
    monthTransactionCount
  ]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current || collapsed) {
        return;
      }

      const nextWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, event.clientX));
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [collapsed]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }

      if (event.key === 'N' || event.key === 'n') {
        event.preventDefault();
        navigate('/transactions?quickAdd=1&entry=layout');
      }

      if (event.key === 'B' || event.key === 'b') {
        event.preventDefault();
        navigate('/smart-budget');
      }

      if (event.key === 'A' || event.key === 'a') {
        event.preventDefault();
        navigate('/assistant');
      }

      if (event.key === 'G' || event.key === 'g') {
        event.preventDefault();
        navigate('/');
      }

      if (event.key === 'H' || event.key === 'h') {
        event.preventDefault();
        navigate('/help');
      }

      if (event.key === 'D' || event.key === 'd') {
        event.preventDefault();
        navigate('/database-settings');
      }

      if (event.key === '/') {
        event.preventDefault();
        navigate('/transactions');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const onViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', onViewportChange);

    return () => {
      mediaQuery.removeEventListener('change', onViewportChange);
    };
  }, []);

  const shouldShowTopbar = collapsed || isMobileViewport;

  return (
    <div
      className={`layout-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`.trim()}
      style={{
        ['--sidebar-width' as string]: `${collapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth}px`
      }}
    >
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="sidebar-header">
          {!collapsed ? (
            <Link to="/" className="brand" title={t('layout.brand')}>
              <img className="brand-logo" src={APP_LOGO_URL} alt="" />
              <span>{t('layout.brand')}</span>
            </Link>
          ) : null}
          <button
            type="button"
            className="icon-btn sidebar-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={
              collapsed ? t('layout.toggleSidebarExpand') : t('layout.toggleSidebarCollapse')
            }
          >
            <img
              className="sidebar-collapse-icon"
              src={collapsed ? CHEVRONS_LEFT_RIGHT_ICON_URL : CHEVRONS_RIGHT_LEFT_ICON_URL}
              alt=""
              aria-hidden="true"
            />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.title} className="sidebar-section">
              {collapsed ? null : (
                <button
                  type="button"
                  className="sidebar-section-toggle motion-pill-btn"
                  onClick={() =>
                    setExpandedSections((prev) => ({
                      ...prev,
                      [section.title]: !prev[section.title]
                    }))
                  }
                >
                  <span className="sidebar-section-title">{section.title}</span>
                  <span>{expandedSections[section.title] ? '▾' : '▸'}</span>
                </button>
              )}
              {(collapsed || expandedSections[section.title]) &&
                section.items.map((item) => {
                  if (!item.to || item.disabled) {
                    return (
                      <div
                        key={`${section.title}-${item.label}`}
                        className="sidebar-link disabled"
                        title={item.label}
                      >
                        {renderNavIcon(item, 'sidebar-link-icon')}
                        {collapsed ? null : (
                          <span className="sidebar-link-label">{item.label}</span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <NavLink
                      key={`${section.title}-${item.label}`}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        isActive
                          ? 'sidebar-link active motion-pill-btn'
                          : 'sidebar-link motion-pill-btn'
                      }
                      title={item.label}
                    >
                      {renderNavIcon(item, 'sidebar-link-icon')}
                      {collapsed ? null : <span className="sidebar-link-label">{item.label}</span>}
                    </NavLink>
                  );
                })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <ThemeSwitcher />
        </div>

        {!collapsed ? (
          <div className="sidebar-resize-handle" onMouseDown={() => (draggingRef.current = true)} />
        ) : null}
      </aside>

      <div className="workspace">
        {shouldShowTopbar ? (
          <header className="workspace-topbar">
            <div className="topbar-left">
              <button
                type="button"
                className="icon-btn mobile-nav-toggle"
                onClick={() => setMobileNavOpen(true)}
                aria-label={t('layout.openDrawer')}
              >
                ☰
              </button>
              {isMobileViewport ? (
                <div className="workspace-topbar-title" title={currentWorkspaceTitle}>
                  {currentWorkspaceTitle}
                </div>
              ) : null}
              {collapsed && !isMobileViewport ? (
                <div className="topbar-brand-copy compact">
                  <img className="brand-logo compact" src={APP_LOGO_URL} alt="" />
                  <h1>{t('layout.brand')}</h1>
                  <span>{t('layout.workspaceTitle')}</span>
                </div>
              ) : null}
            </div>
          </header>
        ) : null}

        <main className="content">
          <Outlet />
        </main>
      </div>

      {mobileNavOpen ? (
        <div
          className="mobile-nav-overlay"
          role="presentation"
          onClick={() => setMobileNavOpen(false)}
        >
          <aside
            className="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('layout.drawerAria')}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mobile-nav-header mobile-nav-profile">
              <div className="mobile-nav-profile-copy">
                <img
                  className="mobile-nav-profile-mark"
                  src={CIRCLE_USER_ICON_URL}
                  alt=""
                  aria-hidden="true"
                />
                <div>
                  <p className="mobile-nav-name">{t('layout.drawerUser')}</p>
                  <p className="mobile-nav-subtitle">
                    {t('layout.drawerSubtitle', { today: todayLabel })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMobileNavOpen(false)}
                aria-label={t('layout.closeDrawer')}
              >
                ✕
              </button>
            </header>

            <section className="mobile-nav-summary-card">
              <h3>{monthLabel}</h3>
              <p>{t('layout.monthlyBalance', { amount: formatCurrency(monthBalance) })}</p>
              <p>
                {t('layout.monthlyIncomeExpense', {
                  income: formatCurrency(monthIncome),
                  expense: formatCurrency(monthExpense)
                })}
              </p>
            </section>

            <section className={`mobile-nav-insight-card is-${mobileNavInsight.tone}`}>
              <div className="mobile-nav-insight-head">
                <span className="mobile-nav-insight-icon" aria-hidden="true">
                  {mobileNavInsight.icon}
                </span>
                <div className="mobile-nav-insight-copy">
                  <small>{mobileNavInsight.eyebrow}</small>
                  <strong>{mobileNavInsight.title}</strong>
                  <p>{mobileNavInsight.description}</p>
                </div>
              </div>
              <Link
                to={mobileNavInsight.to}
                className="mobile-nav-insight-link motion-pill-btn"
                onClick={() => setMobileNavOpen(false)}
              >
                {mobileNavInsight.actionLabel}
              </Link>
            </section>

            {mobileQuickGroups.map((group) => (
              <section key={group.title} className="mobile-nav-grid-card">
                <h3>{group.title}</h3>
                <div className="mobile-nav-grid">
                  {group.items.map((item) => (
                    <NavLink
                      key={`${group.title}-${item.label}`}
                      to={item.to}
                      end={item.end}
                      className="mobile-nav-grid-item motion-pill-btn"
                      onClick={() => setMobileNavOpen(false)}
                    >
                      {renderNavIcon(item, 'mobile-nav-grid-icon')}
                      <strong>{item.label}</strong>
                    </NavLink>
                  ))}
                </div>
              </section>
            ))}

            <div className="mobile-nav-footer">
              <span>{t('layout.themeMode')}</span>
              <ThemeSwitcher />
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
