import { useEffect, useMemo, useState } from 'react';
import { TrendChart } from '../../features/dashboard/components/TrendChart';
import { CategoryBreakdownChart } from '../../features/dashboard/components/CategoryBreakdownChart';
import { DashboardNetWorthSummary } from '../../features/dashboard/components/DashboardNetWorthSummary';
import { buildNetWorthTrend } from '../../features/dashboard/model/netWorth';
import { DashboardWelcomeBanner } from '../../features/dashboard/components/DashboardWelcomeBanner';
import { DashboardCashflowAgenda } from '../../features/dashboard/components/DashboardCashflowAgenda';
import { AssetLiabilitySimulationPanel } from '../../features/dashboard/components/AssetLiabilitySimulationPanel';
import { buildAssetLiabilitySimulation } from '../../features/dashboard/model/assetLiabilitySimulation';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { DebugLogPanel } from '../../features/debug-log/ui/DebugLogPanel';
import {
  getGreeting,
  monthKey,
  isActualExpenseType,
  monthBounds
} from '../../features/dashboard/model/utils';
import { APP_VERSION } from '../../shared/config/app';
import { formatCurrencyAuto } from '../../shared/lib/format';
import { formatMonth } from '../../shared/lib/i18nDate';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { EmptyState } from '../../shared/ui/EmptyState';

const DASHBOARD_DENSITY_KEY = 'dashboard_density_v1';

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const tFallback = (key: string, fallback: string) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };
  const navigate = useNavigate();
  const transactions = useFinanceStore((s) => s.transactions);
  const accounts = useFinanceStore((s) => s.accounts);
  const categories = useFinanceStore((s) => s.categories);
  const subscriptions = useFinanceStore((s) => s.subscriptions);
  const investmentPositions = useAppPreferences((s) => s.investmentPositions);
  const investmentPositionHistory = useAppPreferences((s) => s.investmentPositionHistory);
  const debts = useAppPreferences((s) => s.debts);
  const repaymentRecords = useAppPreferences((s) => s.repaymentRecords);

  const [isWelcomeExpanded, setIsWelcomeExpanded] = useState(true);
  const [trendGranularity, setTrendGranularity] = useState<'week' | 'month' | 'year'>('week');
  const [trendMonthOffset, setTrendMonthOffset] = useState(0);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState<number | null>(null);
  const [cashflowView, setCashflowView] = useState<'expense' | 'income' | 'net'>('expense');
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [simulationMonths, setSimulationMonths] = useState<1 | 3 | 6 | 12>(1);
  const [dashboardDensity, setDashboardDensity] = useState<'core' | 'full'>(() => {
    try {
      return localStorage.getItem(DASHBOARD_DENSITY_KEY) === 'full' ? 'full' : 'core';
    } catch {
      return 'core';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_DENSITY_KEY, dashboardDensity);
    } catch {
      // ignore preference storage errors
    }
  }, [dashboardDensity]);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthly = transactions.filter((t) => {
    const d = new Date(t.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });
  const income = monthly.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expense = monthly
    .filter((t) => isActualExpenseType(t.type))
    .reduce((sum, t) => sum + t.amount, 0);
  const monthlyBalance = income - expense;

  const netWorthTrend = useMemo(
    () =>
      buildNetWorthTrend({
        accounts,
        transactions,
        investmentPositions,
        investmentHistory: investmentPositionHistory,
        debts,
        repaymentRecords,
        months: 6
      }),
    [
      accounts,
      debts,
      investmentPositionHistory,
      investmentPositions,
      repaymentRecords,
      transactions
    ]
  );
  const netAssets = netWorthTrend.currentValue;
  const assetLiabilitySimulation = useMemo(
    () =>
      buildAssetLiabilitySimulation({
        accounts,
        investmentPositions,
        transactions,
        subscriptions,
        debts,
        repaymentRecords,
        days: simulationMonths * 30
      }),
    [
      accounts,
      debts,
      investmentPositions,
      repaymentRecords,
      subscriptions,
      transactions,
      simulationMonths
    ]
  );

  const recentMonths = useMemo(
    () =>
      Array.from({ length: 6 }).map((_, i) => {
        const d = new Date(currentYear, currentMonth - (5 - i), 1);
        const key = monthKey(d);
        const rows = transactions.filter((t) => monthKey(new Date(t.date)) === key);
        const mIncome = rows
          .filter((t) => t.type === 'income')
          .reduce((sum, t) => sum + t.amount, 0);
        const mExpense = rows
          .filter((t) => isActualExpenseType(t.type))
          .reduce((sum, t) => sum + t.amount, 0);
        const shortLabel = formatMonth(d, locale);
        return {
          key,
          shortLabel,
          income: mIncome,
          expense: mExpense,
          balance: mIncome - mExpense,
          transactionCount: rows.length
        };
      }),
    [currentMonth, currentYear, locale, transactions]
  );

  const localizedTips = useMemo(
    () => [
      t('dashboard.tips.1'),
      t('dashboard.tips.2'),
      t('dashboard.tips.3'),
      t('dashboard.tips.4'),
      t('dashboard.tips.5'),
      t('dashboard.tips.6')
    ],
    [t]
  );
  const tipIndex = new Date().getDate() % localizedTips.length;
  const categoryMetaMap = useMemo(
    () =>
      new Map(
        categories.map((item) => [
          item.id,
          { name: item.name, icon: item.icon || '🏷️', color: item.color }
        ])
      ),
    [categories]
  );

  const trendSeries = useMemo(() => {
    if (trendGranularity === 'year') {
      return Array.from({ length: 6 }).map((_, index) => {
        const targetYear = currentYear - (5 - index);
        const rows = transactions.filter(
          (item) => new Date(item.date).getFullYear() === targetYear
        );
        const yearExpense = rows
          .filter((item) => isActualExpenseType(item.type))
          .reduce((sum, item) => sum + item.amount, 0);
        return {
          label: String(targetYear),
          shortLabel: String(targetYear),
          value: yearExpense,
          dateFrom: `${targetYear}-01-01`,
          dateTo: `${targetYear}-12-31`
        };
      });
    }

    if (trendGranularity === 'month') {
      return recentMonths.map((item) => {
        const [year, month] = item.key.split('-').map(Number);
        const date = new Date(year, month - 1, 1);
        return {
          label: formatMonth(date, locale),
          shortLabel: formatMonth(date, locale),
          value: item.expense,
          dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
          dateTo: new Date(year, month, 0).toISOString().slice(0, 10)
        };
      });
    }

    const baseDate = new Date(currentYear, currentMonth + trendMonthOffset, 1);
    const baseYear = baseDate.getFullYear();
    const baseMonth = baseDate.getMonth();
    const daysInMonth = new Date(baseYear, baseMonth + 1, 0).getDate();
    const dailyMap = new Map<number, number>();
    transactions.forEach((item) => {
      if (!isActualExpenseType(item.type)) return;
      const date = new Date(item.date);
      if (date.getMonth() !== baseMonth || date.getFullYear() !== baseYear) return;
      const day = date.getDate();
      dailyMap.set(day, (dailyMap.get(day) || 0) + item.amount);
    });

    const weekCount = Math.ceil(daysInMonth / 7);
    return Array.from({ length: weekCount }).map((_, index) => {
      const startDay = index * 7 + 1;
      const endDay = Math.min(startDay + 6, daysInMonth);
      let value = 0;
      for (let day = startDay; day <= endDay; day += 1) {
        value += dailyMap.get(day) || 0;
      }

      return {
        label: t('dashboard.ui.weekLabel', {
          month: formatMonth(baseDate, locale),
          week: index + 1
        }),
        shortLabel: t('dashboard.ui.weekShort', { week: index + 1 }),
        value,
        dateFrom: `${baseYear}-${String(baseMonth + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`,
        dateTo: `${baseYear}-${String(baseMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
      };
    });
  }, [
    currentMonth,
    currentYear,
    locale,
    recentMonths,
    t,
    transactions,
    trendGranularity,
    trendMonthOffset
  ]);

  const trendBaseDate = useMemo(
    () => new Date(currentYear, currentMonth + trendMonthOffset, 1),
    [currentMonth, currentYear, trendMonthOffset]
  );

  const trendPeakIndex = useMemo(() => {
    if (!trendSeries.length) return -1;
    return trendSeries.reduce(
      (bestIndex, item, index, arr) => (item.value > arr[bestIndex].value ? index : bestIndex),
      0
    );
  }, [trendSeries]);

  useEffect(() => {
    if (!trendSeries.length) {
      setSelectedTrendIndex(null);
      return;
    }
    setSelectedTrendIndex((prev) => {
      if (prev !== null && prev >= 0 && prev < trendSeries.length) {
        return prev;
      }
      return trendPeakIndex >= 0 ? trendPeakIndex : 0;
    });
  }, [trendPeakIndex, trendSeries]);

  const activeTrendIndex =
    selectedTrendIndex !== null &&
    selectedTrendIndex >= 0 &&
    selectedTrendIndex < trendSeries.length
      ? selectedTrendIndex
      : trendPeakIndex >= 0
        ? trendPeakIndex
        : 0;

  const trendMaxValue = useMemo(
    () => Math.max(...trendSeries.map((item) => item.value), 1),
    [trendSeries]
  );

  const trendBarHeight = (value: number) => {
    if (value <= 0 || trendMaxValue <= 0) {
      return '4px';
    }
    return `${Math.max(10, (value / trendMaxValue) * 100)}%`;
  };

  const expenseTrendAverage = useMemo(() => {
    if (!trendSeries.length) return 0;
    return trendSeries.reduce((sum, item) => sum + item.value, 0) / trendSeries.length;
  }, [trendSeries]);

  const cashflowCategoryRows = useMemo(() => {
    const map = new Map<
      string,
      { amount: number; prevAmount: number; icon: string; color?: string }
    >();

    const thisMonthRows = transactions.filter((item) => {
      const d = new Date(item.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const prevMonth = prevMonthDate.getMonth();
    const prevYear = prevMonthDate.getFullYear();
    const prevMonthRows = transactions.filter((item) => {
      const d = new Date(item.date);
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });

    const includeRow = (type: string) => {
      if (cashflowView === 'expense') {
        return type === 'expense' || type === 'repayment';
      }
      if (cashflowView === 'income') {
        return type === 'income';
      }
      return type === 'income' || type === 'expense' || type === 'repayment';
    };

    const signedAmount = (type: string, amount: number) => {
      if (cashflowView === 'net') {
        return type === 'income' ? amount : -amount;
      }
      return amount;
    };

    thisMonthRows.forEach((item) => {
      if (!includeRow(item.type)) return;
      const categoryMeta = categoryMetaMap.get(item.categoryId);
      const name = categoryMeta?.name || item.categoryId || '未分类';
      const current = map.get(name) || {
        amount: 0,
        prevAmount: 0,
        icon: categoryMeta?.icon || '🏷️',
        color: categoryMeta?.color
      };
      current.amount += signedAmount(item.type, item.amount);
      map.set(name, current);
    });

    prevMonthRows.forEach((item) => {
      if (!includeRow(item.type)) return;
      const categoryMeta = categoryMetaMap.get(item.categoryId);
      const name = categoryMeta?.name || item.categoryId || '未分类';
      const current = map.get(name) || {
        amount: 0,
        prevAmount: 0,
        icon: categoryMeta?.icon || '🏷️',
        color: categoryMeta?.color
      };
      current.prevAmount += signedAmount(item.type, item.amount);
      map.set(name, current);
    });

    const rows = Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        amount: value.amount,
        prevAmount: value.prevAmount,
        icon: value.icon,
        color: value.color
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    const top = rows.slice(0, 5);
    const other = rows.slice(5).reduce(
      (acc, item) => {
        acc.amount += item.amount;
        acc.prevAmount += item.prevAmount;
        return acc;
      },
      { amount: 0, prevAmount: 0 }
    );
    if (Math.abs(other.amount) > 0) {
      top.push({
        name: '其他',
        amount: other.amount,
        prevAmount: other.prevAmount,
        icon: '🧩',
        color: undefined
      });
    }

    const total = top.reduce((sum, item) => sum + Math.abs(item.amount), 0);
    return top.map((item, index) => ({
      ...item,
      percent: total > 0 ? (Math.abs(item.amount) / total) * 100 : 0,
      diffRate:
        item.prevAmount !== 0
          ? ((item.amount - item.prevAmount) / Math.abs(item.prevAmount)) * 100
          : null,
      ringColor:
        item.color ||
        ['#2563eb', '#60a5fa', '#93c5fd', '#c4b5fd', '#34d399', '#d1d5db'][index] ||
        '#d1d5db'
    }));
  }, [cashflowView, categoryMetaMap, currentMonth, currentYear, transactions]);

  useEffect(() => {
    if (!cashflowCategoryRows.length) {
      setSelectedCategoryName(null);
      return;
    }
    setSelectedCategoryName((prev) => {
      if (prev && cashflowCategoryRows.some((item) => item.name === prev)) {
        return prev;
      }
      return cashflowCategoryRows[0]?.name || null;
    });
  }, [cashflowCategoryRows]);

  const activeCategoryItem =
    cashflowCategoryRows.find((item) => item.name === selectedCategoryName) ||
    cashflowCategoryRows[0] ||
    null;

  const donutChart = useMemo(() => {
    const size = 220;
    const radius = 76;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return cashflowCategoryRows.map((item) => {
      const length = circumference * (item.percent / 100);
      const segment = {
        ...item,
        size,
        radius,
        circumference,
        dasharray: `${length} ${Math.max(circumference - length, 0)}`,
        dashoffset: -offset
      };
      offset += length;
      return segment;
    });
  }, [cashflowCategoryRows]);

  return (
    <div className="vi-page dashboard-page">
      <DashboardWelcomeBanner
        versionLabel={APP_VERSION}
        isExpanded={isWelcomeExpanded}
        greeting={getGreeting(t)}
        welcomeTitle={tFallback('dashboard.ui.welcome', 'LedgerFlow')}
        welcomeSubtitle={tFallback(
          'dashboard.ui.welcomeSubtitle',
          '今天的钱花在哪、还剩多少、哪里能省一点，这里直接告诉你。'
        )}
        monthlyBalance={monthlyBalance}
        netAssets={netAssets}
        tip={localizedTips[tipIndex]}
        onToggleExpanded={() => setIsWelcomeExpanded((prev) => !prev)}
        onNavigateToQuickAdd={() => navigate('/transactions/new?quick=1')}
        onNavigateToAssistant={() => navigate('/assistant')}
      />

      <section className="dashboard-overview-workspace">
        <h2>{tFallback('dashboard.ui.corePanel', '今日财务看板')}</h2>
        <div className="grid grid-2 dashboard-stat-grid">
          <button
            type="button"
            className="stat-card stat-balance stat-card-gradient"
            onClick={() => {
              const { from, to } = monthBounds();
              navigate(`/transactions?datePreset=custom&dateFrom=${from}&dateTo=${to}`);
            }}
            title="点击追溯本月交易"
          >
            <span className="stat-icon">🧭</span>
            <div>
              <h3>净资产</h3>
              <strong className="stat-value">{formatCurrencyAuto(netAssets)}</strong>
            </div>
            <DashboardNetWorthSummary
              value={netAssets}
              accountBalance={netWorthTrend.breakdown.accountBalance}
              investmentValue={netWorthTrend.breakdown.investmentValue}
              debtBalance={netWorthTrend.breakdown.debtBalance}
            />
          </button>
          <button
            type="button"
            className="stat-card stat-income stat-card-gradient"
            onClick={() => {
              const { from, to } = monthBounds();
              navigate(`/transactions?datePreset=custom&dateFrom=${from}&dateTo=${to}`);
            }}
            title="点击追溯本月交易"
          >
            <span className="stat-icon">💎</span>
            <div>
              <h3>本月结余</h3>
              <strong className="stat-value">{formatCurrencyAuto(monthlyBalance)}</strong>
            </div>
          </button>
        </div>
        <DashboardCashflowAgenda
          debts={debts}
          subscriptions={subscriptions}
          transactions={transactions}
          onNavigateToRepayments={() => navigate('/repayment-management')}
          onNavigateToSubscriptions={() => navigate('/subscriptions')}
          onNavigateToTransactions={() => navigate('/transactions')}
        />
        <AssetLiabilitySimulationPanel
          {...assetLiabilitySimulation}
          horizonMonths={simulationMonths}
          onHorizonChange={setSimulationMonths}
        />
        <div className="dashboard-density-control" role="group" aria-label="首页信息密度">
          <span>首页显示</span>
          <button
            type="button"
            className={dashboardDensity === 'core' ? 'is-active' : ''}
            onClick={() => setDashboardDensity('core')}
          >
            核心信息
          </button>
          <button
            type="button"
            className={dashboardDensity === 'full' ? 'is-active' : ''}
            onClick={() => setDashboardDensity('full')}
          >
            完整分析
          </button>
        </div>
        {dashboardDensity === 'full' ? (
          trendSeries.some((item) => Math.abs(item.value) > 0.005) ||
          cashflowCategoryRows.some((item) => Math.abs(item.amount) > 0.005) ? (
            <section className="dashboard-dynamic-grid dashboard-analysis-workspace">
              <TrendChart
                trendSeries={trendSeries}
                activeTrendIndex={activeTrendIndex}
                trendPeakIndex={trendPeakIndex}
                trendGranularity={trendGranularity}
                trendBaseYear={trendBaseDate.getFullYear()}
                trendBaseMonth={trendBaseDate.getMonth()}
                expenseTrendAverage={expenseTrendAverage}
                trendMonthOffset={trendMonthOffset}
                onTrendGranularityChange={setTrendGranularity}
                onTrendMonthOffsetChange={setTrendMonthOffset}
                onSelectedTrendIndexChange={setSelectedTrendIndex}
                onNavigateToTransactions={(dateFrom: string, dateTo: string) =>
                  navigate(`/transactions?datePreset=custom&dateFrom=${dateFrom}&dateTo=${dateTo}`)
                }
                trendBarHeight={trendBarHeight}
              />
              <CategoryBreakdownChart
                cashflowView={cashflowView}
                activeCategoryItem={activeCategoryItem}
                donutChart={donutChart}
                cashflowCategoryRows={cashflowCategoryRows}
                onCashflowViewChange={setCashflowView}
                onSelectedCategoryNameChange={setSelectedCategoryName}
              />
            </section>
          ) : (
            <div className="dashboard-chart-empty" role="status">
              <strong>记下一笔，趋势就会开始出现</strong>
              <span>有了真实收支后，这里会展示花钱节奏和分类结构。</span>
              <button type="button" onClick={() => navigate('/transactions/new?quick=1')}>
                记第一笔
              </button>
            </div>
          )
        ) : null}
        {dashboardDensity === 'full' ? (
          <p className="dashboard-density-hint">
            已显示完整趋势与分类分析；切换到“核心信息”可收起次要图表。
          </p>
        ) : null}
      </section>

      {transactions.length === 0 ? (
        <section className="panel">
          <EmptyState
            icon="📝"
            title={tFallback('dashboard.ui.emptyTitle', '还没有账单，先记第一笔')}
            description={tFallback(
              'dashboard.ui.emptyDesc',
              '记录一笔收入或支出后，这里会自动生成趋势、分类和提醒。'
            )}
            secondaryAction={{
              label: tFallback('dashboard.ui.findAssistant', '找助手聊聊'),
              onClick: () => {
                navigate('/assistant');
              }
            }}
            primaryAction={{
              label: tFallback('dashboard.ui.quickAdd', '马上记一笔'),
              variant: 'primary',
              onClick: () => {
                navigate('/transactions/new?quick=1');
              }
            }}
          />
        </section>
      ) : null}

      <DebugLogPanel />
    </div>
  );
}
