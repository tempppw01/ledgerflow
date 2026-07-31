import { useEffect, useMemo, useState } from 'react';
import { TrendChart } from '../../features/dashboard/components/TrendChart';
import { CategoryBreakdownChart } from '../../features/dashboard/components/CategoryBreakdownChart';
import { NetAssetCurveCard } from '../../features/dashboard/components/NetAssetCurveCard';
import { DashboardModuleCustomizer } from '../../features/dashboard/components/DashboardModuleCustomizer';
import { DashboardAnomalyInsights } from '../../features/dashboard/components/DashboardAnomalyInsights';
import { DashboardHistoryCompareCard } from '../../features/dashboard/components/DashboardHistoryCompareCard';
import { DashboardTopTransactionsCard } from '../../features/dashboard/components/DashboardTopTransactionsCard';
import { DashboardMonthlyTrendSummaryCard } from '../../features/dashboard/components/DashboardMonthlyTrendSummaryCard';
import { DashboardWelcomeBanner } from '../../features/dashboard/components/DashboardWelcomeBanner';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { DebugLogPanel } from '../../features/debug-log/ui/DebugLogPanel';
import {
  ForecastPayload,
  MonthlyInsightPayload,
  getGreeting,
  monthKey,
  monthLabel,
  isActualExpenseType,
  extractJson,
  toSafeNumber,
  monthBounds,
  getConstellationLabel
} from '../../features/dashboard/model/utils';
import { APP_VERSION } from '../../shared/config/app';
import { formatCurrency } from '../../shared/lib/format';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { EmptyState } from '../../shared/ui/EmptyState';

const FORECAST_CACHE_KEY = 'dashboard_forecast_cache_v1';
const DASHBOARD_MODULES_KEY = 'dashboard_custom_modules_v1';

const DASHBOARD_MODULE_CATALOG = [
  { id: 'dynamic-charts', label: '趋势雷达', description: '钱花在哪、占比多少，一眼扫完' },
  {
    id: 'anomaly-insights',
    label: '省钱雷达',
    description: '帮你捞出需要留意和做得不错的地方'
  },
  { id: 'top-transactions', label: '大额账单', description: '本月最值得回看的几笔钱' },
  {
    id: 'history-compare',
    label: '消费人设',
    description: '把历史对比和本月消费风格放一起看'
  }
] as const;

type DashboardModuleId = (typeof DASHBOARD_MODULE_CATALOG)[number]['id'];

function normalizeForecastPayload(raw: unknown, fallback: number): ForecastPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<ForecastPayload>;
  const points = Array.isArray(parsed.points)
    ? parsed.points.slice(0, 3).map((n) => toSafeNumber(n, fallback))
    : [fallback, fallback, fallback];
  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : '模型已完成分析，建议结合预算目标跟踪未来三个月现金流。';
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .slice(0, 3)
        .map((item) => String(item).trim())
        .filter(Boolean)
    : [];
  return { summary, points, suggestions };
}

function readForecastCache(
  fallback: number
): { payload: ForecastPayload; updatedAt: string } | null {
  try {
    const raw = localStorage.getItem(FORECAST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload?: unknown; updatedAt?: unknown };
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
    const payload = normalizeForecastPayload(parsed.payload, fallback);
    if (!payload || !updatedAt) return null;
    return { payload, updatedAt };
  } catch {
    return null;
  }
}

function saveForecastCache(payload: ForecastPayload, updatedAt: string) {
  try {
    localStorage.setItem(FORECAST_CACHE_KEY, JSON.stringify({ payload, updatedAt }));
  } catch {
    // ignore cache errors
  }
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return '';
  return points.reduce((path, point, index, list) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }
    const prev = list[index - 1];
    const midX = (prev.x + point.x) / 2;
    return `${path} C ${midX} ${prev.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
  }, '');
}

export function DashboardPage() {
  const { t } = useTranslation();
  const tFallback = (key: string, fallback: string) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };
  const navigate = useNavigate();
  const transactions = useFinanceStore((s) => s.transactions);
  const accounts = useFinanceStore((s) => s.accounts);
  const categories = useFinanceStore((s) => s.categories);
  const subscriptions = useFinanceStore((s) => s.subscriptions);

  const baseUrl = useAiSettings((s) => s.baseUrl);
  const apiKey = useAiSettings((s) => s.apiKey);
  const model = useAiSettings((s) => s.model);

  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [forecastStatus, setForecastStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  );
  const [forecastError, setForecastError] = useState('');
  const [forecastUpdatedAt, setForecastUpdatedAt] = useState<string>('');
  const [forecastRequestToken, setForecastRequestToken] = useState(0);

  const [monthlyInsight, setMonthlyInsight] = useState<MonthlyInsightPayload | null>(null);
  const [monthlyInsightStatus, setMonthlyInsightStatus] = useState<
    'idle' | 'loading' | 'streaming' | 'done' | 'error'
  >('idle');
  const [monthlyInsightError, setMonthlyInsightError] = useState('');
  const [monthlyInsightRequestToken, setMonthlyInsightRequestToken] = useState(0);
  const [hoveredChartPoint, setHoveredChartPoint] = useState<{
    label: string;
    value: number;
  } | null>(null);
  const [isWelcomeExpanded, setIsWelcomeExpanded] = useState(false);
  const [trendGranularity, setTrendGranularity] = useState<'week' | 'month' | 'year'>('week');
  const [trendMonthOffset, setTrendMonthOffset] = useState(0);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState<number | null>(null);
  const [cashflowView, setCashflowView] = useState<'expense' | 'income' | 'net'>('expense');
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [moduleOrder, setModuleOrder] = useState<DashboardModuleId[]>(() =>
    DASHBOARD_MODULE_CATALOG.map((item) => item.id)
  );
  const [moduleVisibility, setModuleVisibility] = useState<Record<DashboardModuleId, boolean>>(
    () =>
      Object.fromEntries(DASHBOARD_MODULE_CATALOG.map((item) => [item.id, true])) as Record<
        DashboardModuleId,
        boolean
      >
  );
  const [draggingModule, setDraggingModule] = useState<DashboardModuleId | null>(null);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthly = transactions.filter((t) => {
    const d = new Date(t.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });
  const hasExpenseTransactions = transactions.some((item) => isActualExpenseType(item.type));
  const income = monthly.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expense = monthly
    .filter((t) => isActualExpenseType(t.type))
    .reduce((sum, t) => sum + t.amount, 0);
  const monthlyBalance = income - expense;

  const liabilityNameKeywords = [
    '信用卡',
    '花呗',
    '白条',
    '借呗',
    '欠款',
    '负债',
    'credit',
    'visa',
    'master'
  ];
  const isLiabilityAccount = (account: (typeof accounts)[number]) => {
    if (account.type === 'credit' || account.type === 'liability') {
      return true;
    }
    const name = String(account.name || '').toLowerCase();
    return liabilityNameKeywords.some((keyword) => name.includes(keyword.toLowerCase()));
  };

  const liabilities = accounts.filter(isLiabilityAccount).reduce((sum, account) => {
    const balance = Number(account.balance ?? account.initialBalance ?? 0);
    if (!Number.isFinite(balance)) {
      return sum;
    }
    return sum + (balance < 0 ? Math.abs(balance) : balance);
  }, 0);

  const subscriptionAlerts = useMemo(
    () =>
      subscriptions
        .filter((item) => item.status === 'due-soon' || item.status === 'expired')
        .slice(0, 3),
    [subscriptions]
  );

  const assetBalance = accounts
    .filter((account) => !isLiabilityAccount(account))
    .reduce((sum, account) => {
      const balance = Number(account.balance ?? account.initialBalance ?? 0);
      return Number.isFinite(balance) ? sum + balance : sum;
    }, 0);

  const netAssets = assetBalance - liabilities;

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
        const shortLabel = `${d.getMonth() + 1}月`;
        return {
          key,
          shortLabel,
          income: mIncome,
          expense: mExpense,
          balance: mIncome - mExpense,
          transactionCount: rows.length
        };
      }),
    [currentMonth, currentYear, transactions]
  );

  /** 本月趋势仅展示：上月、当月、下月 */

  const aiInput = useMemo(() => {
    const txRows = transactions
      .slice()
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, 40)
      .map((item) => ({
        date: item.date,
        type: item.type,
        amount: item.amount,
        category: categories.find((c) => c.id === item.categoryId)?.name || item.categoryId,
        note: String(item.note || '').slice(0, 24)
      }));

    return {
      monthBalance: monthlyBalance,
      recentMonths: recentMonths.slice(-3).map((item) => ({
        month: item.shortLabel,
        income: item.income,
        expense: item.expense,
        balance: item.balance
      })),
      accountSummary: accounts.map((item) => ({
        name: item.name,
        balance: Number(item.balance ?? item.initialBalance ?? 0)
      })),
      transactions: txRows
    };
  }, [accounts, categories, monthlyBalance, recentMonths, transactions]);

  const monthlyInsightInput = useMemo(() => {
    const categoryMap = new Map<
      string,
      { name: string; income: number; expense: number; count: number }
    >();
    monthly.forEach((item) => {
      const name =
        categories.find((c) => c.id === item.categoryId)?.name || item.categoryId || '未分类';
      const entry = categoryMap.get(name) || { name, income: 0, expense: 0, count: 0 };
      if (item.type === 'income') {
        entry.income += item.amount;
      } else if (isActualExpenseType(item.type)) {
        entry.expense += item.amount;
      }
      entry.count += 1;
      categoryMap.set(name, entry);
    });

    const categoryRows = Array.from(categoryMap.values())
      .map((entry) => ({
        name: entry.name,
        income: entry.income,
        expense: entry.expense,
        count: entry.count,
        total: entry.income - entry.expense
      }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

    const topTransactions = monthly
      .slice()
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 4)
      .map((item) => ({
        date: item.date,
        category:
          categories.find((c) => c.id === item.categoryId)?.name || item.categoryId || '未分类',
        amount: item.amount,
        type: item.type,
        note: String(item.note || '').slice(0, 24)
      }));

    return {
      month: `${currentYear}年${currentMonth + 1}月`,
      income,
      expense,
      balance: monthlyBalance,
      categories: categoryRows,
      topTransactions,
      recentMonths: recentMonths.slice(-3).map((item) => ({
        month: item.shortLabel,
        income: item.income,
        expense: item.expense,
        balance: item.balance
      }))
    };
  }, [
    categories,
    currentMonth,
    currentYear,
    income,
    monthly,
    monthlyBalance,
    expense,
    recentMonths
  ]);

  useEffect(() => {
    if (transactions.length === 0) {
      setForecast(null);
      setForecastStatus('idle');
      setForecastError('');
      setForecastUpdatedAt('');
      setMonthlyInsight(null);
      setMonthlyInsightStatus('idle');
      setMonthlyInsightError('');
      return;
    }

    const cached = readForecastCache(monthlyBalance);
    if (cached) {
      setForecast(cached.payload);
      setForecastStatus('done');
      setForecastError('');
      setForecastUpdatedAt(cached.updatedAt);
    }
  }, [monthlyBalance, transactions.length]);

  useEffect(() => {
    if (transactions.length === 0) return;
    if (forecastRequestToken <= 0) return;

    let canceled = false;

    const run = async () => {
      setForecastStatus('loading');
      setForecastError('');
      try {
        const res = await sendAiChat({
          baseUrl,
          apiKey,
          model,
          systemPrompt:
            '你是财务趋势分析助手。仅输出 JSON：{"summary":"简明结论","points":[n1,n2,n3],"suggestions":["建议1","建议2"]}。points 仅保留未来 3 个月。',
          messages: [
            {
              role: 'user',
              text: `请分析以下账务数据并返回未来三个月结余趋势\n${JSON.stringify(aiInput)}`
            }
          ]
        });

        const parsed = JSON.parse(extractJson(res.content)) as Partial<ForecastPayload>;
        const next = normalizeForecastPayload(parsed, monthlyBalance) ?? {
          summary: '模型已完成分析，建议结合预算目标跟踪未来三个月现金流。',
          points: [monthlyBalance, monthlyBalance, monthlyBalance],
          suggestions: []
        };
        const updatedAt = new Date().toISOString();

        if (!canceled) {
          setForecast(next);
          setForecastStatus('done');
          setForecastUpdatedAt(updatedAt);
          saveForecastCache(next, updatedAt);
        }
      } catch (error) {
        if (!canceled) {
          setForecastStatus('error');
          setForecastError(error instanceof Error ? error.message : '未来趋势分析失败');
          const fallback = {
            summary: 'AI 分析暂不可用，当前已展示基于本地数据的动态趋势，请稍后重试。',
            points: [monthlyBalance, monthlyBalance * 0.96, monthlyBalance * 0.92],
            suggestions: ['优先保证必要支出预算', '对波动较大的品类设置上限']
          };
          setForecast(fallback);
          setForecastUpdatedAt('');
        }
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [aiInput, apiKey, baseUrl, forecastRequestToken, model, monthlyBalance, transactions.length]);

  useEffect(() => {
    if (transactions.length === 0) return;
    if (monthlyInsightRequestToken <= 0) return;

    let canceled = false;

    const run = async () => {
      setMonthlyInsightStatus('loading');
      setMonthlyInsightError('');
      try {
        const res = await sendAiChat({
          baseUrl,
          apiKey,
          model,
          systemPrompt:
            '你是财务洞察分析助手。只输出 JSON：{"summary":"字符串","categoryBreakdown":[{"name":"分类","amount":123,"percent":12.3}],"topTransactions":[{"date":"YYYY-MM-DD","category":"分类","amount":123,"note":""}],"highlights":["要点1","要点2"],"profile":{"timePreference":"字符串","topMerchant":"字符串","personality":"字符串","crowdCompare":"字符串"}}。要求：1) categoryBreakdown.percent 是 0~100 的百分比数值，不带%符号；2) 占比必须基于“本月总交易额（收入+支出+还款）”，不能超过100；3) 若数据不足，明确写“暂无足够数据”，不要臆测。',
          messages: [
            {
              role: 'user',
              text: `请基于以下本月账务数据进行洞察，关注分类结构、异常支出与改善建议。\n${JSON.stringify(monthlyInsightInput)}`
            }
          ]
        });

        if (canceled) return;
        const parsed = JSON.parse(extractJson(res.content)) as Partial<MonthlyInsightPayload>;
        const categoryBreakdown = Array.isArray(parsed.categoryBreakdown)
          ? parsed.categoryBreakdown
              .map((item) => ({
                name: String(item?.name || '未分类'),
                amount: toSafeNumber(item?.amount, 0),
                percent: Math.min(100, Math.max(0, toSafeNumber(item?.percent, 0)))
              }))
              .filter((item) => item.name)
          : [];
        const topTransactions = Array.isArray(parsed.topTransactions)
          ? parsed.topTransactions
              .map((item) => ({
                date: String(item?.date || ''),
                category: String(item?.category || '未分类'),
                amount: toSafeNumber(item?.amount, 0),
                note: String(item?.note || '')
              }))
              .filter((item) => item.date)
          : [];
        const highlights = Array.isArray(parsed.highlights)
          ? parsed.highlights.map((item) => String(item).trim()).filter(Boolean)
          : [];
        const summary =
          typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
            ? parsed.summary.trim()
            : '本月洞察已生成，可结合分类与大额交易进行预算调整。';
        const profile =
          parsed.profile && typeof parsed.profile === 'object'
            ? {
                timePreference: String(
                  (parsed.profile as Record<string, unknown>).timePreference || '暂无足够数据'
                ),
                topMerchant: String(
                  (parsed.profile as Record<string, unknown>).topMerchant || '暂无足够数据'
                ),
                personality: String(
                  (parsed.profile as Record<string, unknown>).personality || '暂无足够数据'
                ),
                crowdCompare: String(
                  (parsed.profile as Record<string, unknown>).crowdCompare || '暂无足够数据'
                )
              }
            : undefined;
        const next: MonthlyInsightPayload = {
          summary,
          categoryBreakdown,
          topTransactions,
          highlights,
          profile
        };
        setMonthlyInsight(next);
        setMonthlyInsightStatus('done');
      } catch (error) {
        if (!canceled) {
          setMonthlyInsightStatus('error');
          setMonthlyInsightError(error instanceof Error ? error.message : '本月趋势分析失败');
        }
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [
    apiKey,
    baseUrl,
    model,
    monthlyInsightInput,
    monthlyInsightRequestToken,
    transactions.length
  ]);

  const handleRefreshForecast = () => {
    setForecastRequestToken((prev) => prev + 1);
  };

  const handleRefreshMonthlyInsight = () => {
    setMonthlyInsightRequestToken((prev) => prev + 1);
  };

  const reducedHistoryMonths = useMemo(() => recentMonths.slice(-4), [recentMonths]);
  const currentIndex = Math.max(reducedHistoryMonths.length - 1, 0);

  const trendBaseDate = useMemo(
    () => new Date(currentYear, currentMonth + trendMonthOffset, 1),
    [currentMonth, currentYear, trendMonthOffset]
  );
  const trendBaseMonth = trendBaseDate.getMonth();
  const trendBaseYear = trendBaseDate.getFullYear();

  const chartData = useMemo(() => {
    const history = reducedHistoryMonths.map((item) => ({
      label: item.shortLabel,
      value: item.balance,
      type: 'history' as const
    }));
    const future = (forecast?.points || []).slice(0, 3).map((value, index) => {
      const d = new Date(currentYear, currentMonth + index + 1, 1);
      return {
        label: monthLabel(d),
        value: toSafeNumber(value, monthlyBalance),
        type: 'forecast' as const
      };
    });
    return [...history, ...future];
  }, [currentMonth, currentYear, forecast?.points, monthlyBalance, reducedHistoryMonths]);

  const chartRange = useMemo(() => {
    const values = chartData.map((item) => item.value);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);
    return { max, min, range };
  }, [chartData]);

  const axisTicks = useMemo(() => {
    const mid = (chartRange.max + chartRange.min) / 2;
    return [chartRange.max, mid, chartRange.min];
  }, [chartRange.max, chartRange.min]);

  const chartPoints = useMemo(() => {
    if (chartData.length < 2) return [];
    const width = 600;
    const height = 240;
    const pad = 20;
    return chartData.map((item, index) => {
      const x = pad + (index * (width - pad * 2)) / (chartData.length - 1);
      const y = pad + ((chartRange.max - item.value) / chartRange.range) * (height - pad * 2);
      return { x, y, label: item.label, type: item.type, value: item.value };
    });
  }, [chartData, chartRange.max, chartRange.range]);

  const historySegment = useMemo(() => {
    if (chartPoints.length < 2 || currentIndex < 1) return '';
    return buildSmoothPath(chartPoints.slice(0, currentIndex + 1));
  }, [chartPoints, currentIndex]);

  const forecastSegment = useMemo(() => {
    if (chartPoints.length - currentIndex < 2) return '';
    return buildSmoothPath(chartPoints.slice(currentIndex, chartPoints.length));
  }, [chartPoints, currentIndex]);

  const lastMonthBalance = recentMonths[recentMonths.length - 2]?.balance ?? 0;
  const monthOverMonthChange = monthlyBalance - lastMonthBalance;
  const monthOverMonthRate =
    lastMonthBalance === 0
      ? monthOverMonthChange === 0
        ? 0
        : 100
      : (monthOverMonthChange / Math.abs(lastMonthBalance)) * 100;
  const monthOverMonthDirection = monthOverMonthChange >= 0 ? 'up' : 'down';
  const monthOverMonthArrow = monthOverMonthChange >= 0 ? '↗' : '↘';
  const forecastMonths = useMemo(() => {
    const values = forecast?.points?.slice(0, 3) || [
      monthlyBalance,
      monthlyBalance * 0.98,
      monthlyBalance * 0.96
    ];
    return values.map((value, index) => {
      const d = new Date(currentYear, currentMonth + index + 1, 1);
      return {
        label: monthLabel(d),
        value: toSafeNumber(value, monthlyBalance)
      };
    });
  }, [currentMonth, currentYear, forecast?.points, monthlyBalance]);

  const forecastBarScale = useMemo(
    () => Math.max(...chartData.map((item) => Math.abs(item.value)), 1),
    [chartData]
  );

  const forecastBarHeight = (value: number) =>
    `${Math.max(12, (Math.abs(value) / forecastBarScale) * 92)}px`;

  const currentMonthLabel = `${currentYear}年${currentMonth + 1}月`;
  const monthlyInsightActionLabel =
    monthlyInsightStatus === 'loading' || monthlyInsightStatus === 'streaming'
      ? '分析中...'
      : monthlyInsightStatus === 'done'
        ? '重新分析'
        : '手动分析';

  const monthlyTurnover = useMemo(
    () => monthly.reduce((sum, item) => sum + Math.abs(toSafeNumber(item.amount, 0)), 0),
    [monthly]
  );

  const displayCategoryBreakdown = useMemo(
    () =>
      monthlyInsight?.categoryBreakdown?.length
        ? monthlyInsight.categoryBreakdown.map((item) => ({
            name: item.name,
            amount: item.amount,
            percent: Math.min(100, Math.max(0, toSafeNumber(item.percent, 0)))
          }))
        : monthlyInsightInput.categories.map((item) => ({
            name: item.name,
            amount: item.total,
            percent:
              monthlyTurnover > 0
                ? Math.min(
                    100,
                    Math.max(0, Math.round((Math.abs(item.total) / monthlyTurnover) * 1000) / 10)
                  )
                : 0
          })),
    [monthlyInsight, monthlyInsightInput, monthlyTurnover]
  );

  const displayTopTransactions = useMemo(
    () =>
      monthlyInsight?.topTransactions?.length
        ? monthlyInsight.topTransactions
        : monthlyInsightInput.topTransactions.map((item) => ({
            date: item.date,
            category: item.category,
            amount: item.amount,
            note: item.note
          })),
    [monthlyInsight, monthlyInsightInput]
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
  const categoryNameMap = useMemo(
    () => new Map(categories.map((item) => [item.id, item.name])),
    [categories]
  );
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

  const mysticInsight = useMemo(() => {
    const expenseRows = monthly.filter((item) => isActualExpenseType(item.type));
    if (expenseRows.length === 0) {
      return {
        title: '消费玄学分析',
        lines: ['本月还没有支出账目，玄学老师掐指一算：你先记一笔再开卦。'],
        disclaimer: '玄学仅供娱乐，理性消费才是王道。'
      };
    }

    const totalExpense = expenseRows.reduce((sum, item) => sum + item.amount, 0);
    const weekdayTotal = Array.from({ length: 7 }, () => 0);
    expenseRows.forEach((item) => {
      weekdayTotal[new Date(item.date).getDay()] += item.amount;
    });
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const topWeekdayEntry = weekdayTotal
      .map((amount, day) => ({ day, amount }))
      .sort((a, b) => b.amount - a.amount)[0];
    const topWeekdayPercent = totalExpense
      ? Math.round((topWeekdayEntry.amount / totalExpense) * 100)
      : 0;

    const drinkPattern = /奶茶|咖啡|饮品|茶饮|果茶|coffee|tea/i;
    const spendOn8Days = expenseRows.filter((item) => {
      const day = new Date(item.date).getDate();
      return day % 10 === 8;
    });
    const drinkCountOn8Days = spendOn8Days.filter((item) => {
      const category = categoryNameMap.get(item.categoryId) || '';
      return drinkPattern.test(`${item.note} ${category}`);
    }).length;
    const unique8Dates = Array.from(new Set(spendOn8Days.map((item) => item.date.slice(8, 10))));

    const colorRules = [
      { color: '蓝色', pattern: /电子|数码|学习|办公|网课|科技/i },
      { color: '红色', pattern: /餐|外卖|奶茶|咖啡|美食/i },
      { color: '绿色', pattern: /交通|地铁|公交|骑行|出行/i },
      { color: '紫色', pattern: /娱乐|社交|游戏|电影|聚会/i }
    ];
    const colorCount = new Map<string, number>(colorRules.map((item) => [item.color, 0]));
    expenseRows.forEach((item) => {
      const category = categoryNameMap.get(item.categoryId) || '';
      const text = `${category} ${item.note}`;
      const matched = colorRules.find((rule) => rule.pattern.test(text));
      if (matched) {
        colorCount.set(matched.color, (colorCount.get(matched.color) || 0) + 1);
      }
    });
    const luckyColor =
      Array.from(colorCount.entries()).sort((a, b) => a[1] - b[1])[0]?.[0] || '蓝色';

    const nowDate = new Date();
    const constellation = getConstellationLabel(nowDate.getMonth() + 1, nowDate.getDate());
    const zodiacAnimals = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
    const zodiac = zodiacAnimals[(nowDate.getFullYear() - 4) % 12];

    return {
      title: '消费玄学分析',
      lines: [
        `你是${constellation}＋生肖${zodiac}，但本月${weekdayNames[topWeekdayEntry.day]}贡献了支出 ${topWeekdayPercent}%：看似水逆，其实是周中摸鱼手滑。`,
        unique8Dates.length
          ? `逢 8 日（${unique8Dates.join('/')}）你一共消费 ${spendOn8Days.length} 笔，其中奶茶/咖啡 ${drinkCountOn8Days} 杯，建议把外卖券藏起来。`
          : '本月暂未触发“逢 8 必买”Buff，恭喜你避开了数字玄学消费陷阱。',
        `你的消费幸运色是${luckyColor}：本月相关消费出现次数最少，建议把“理性消费”设成今日主色调。`
      ],
      disclaimer: '玄学仅供娱乐，理性消费才是王道。'
    };
  }, [categoryNameMap, monthly]);

  const quarterExpense = useMemo(
    () =>
      transactions
        .filter((item) => {
          const d = new Date(item.date);
          return (
            d.getFullYear() === currentYear &&
            Math.floor(d.getMonth() / 3) === Math.floor(currentMonth / 3)
          );
        })
        .filter((item) => isActualExpenseType(item.type))
        .reduce((sum, item) => sum + item.amount, 0),
    [currentMonth, currentYear, transactions]
  );
  const yearlyExpense = useMemo(
    () =>
      transactions
        .filter((item) => new Date(item.date).getFullYear() === currentYear)
        .filter((item) => isActualExpenseType(item.type))
        .reduce((sum, item) => sum + item.amount, 0),
    [currentYear, transactions]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_MODULES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        order?: DashboardModuleId[];
        visibility?: Partial<Record<DashboardModuleId, boolean>>;
      };
      if (Array.isArray(parsed.order)) {
        const safeOrder = parsed.order.filter((id): id is DashboardModuleId =>
          DASHBOARD_MODULE_CATALOG.some((item) => item.id === id)
        );
        if (safeOrder.length) {
          const missing = DASHBOARD_MODULE_CATALOG.map((item) => item.id).filter(
            (id) => !safeOrder.includes(id)
          );
          setModuleOrder([...safeOrder, ...missing]);
        }
      }
      if (parsed.visibility) {
        setModuleVisibility((prev) => ({ ...prev, ...parsed.visibility }));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        DASHBOARD_MODULES_KEY,
        JSON.stringify({ order: moduleOrder, visibility: moduleVisibility })
      );
    } catch {
      // ignore
    }
  }, [moduleOrder, moduleVisibility]);

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
          label: `${String(targetYear).slice(-2)}年`,
          shortLabel: `${String(targetYear).slice(-2)}`,
          value: yearExpense,
          dateFrom: `${targetYear}-01-01`,
          dateTo: `${targetYear}-12-31`
        };
      });
    }

    if (trendGranularity === 'month') {
      return recentMonths.map((item) => {
        const [year, month] = item.key.split('-').map(Number);
        return {
          label: item.shortLabel,
          shortLabel: item.shortLabel.replace('月', ''),
          value: item.expense,
          dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
          dateTo: new Date(year, month, 0).toISOString().slice(0, 10)
        };
      });
    }

    const daysInMonth = new Date(trendBaseYear, trendBaseMonth + 1, 0).getDate();
    const dailyMap = new Map<number, number>();
    transactions.forEach((item) => {
      if (!isActualExpenseType(item.type)) return;
      const date = new Date(item.date);
      if (date.getMonth() !== trendBaseMonth || date.getFullYear() !== trendBaseYear) return;
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
        label: `${trendBaseMonth + 1}月第${index + 1}周`,
        shortLabel: `第${index + 1}周`,
        value,
        dateFrom: `${trendBaseYear}-${String(trendBaseMonth + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`,
        dateTo: `${trendBaseYear}-${String(trendBaseMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
      };
    });
  }, [currentYear, recentMonths, transactions, trendBaseMonth, trendBaseYear, trendGranularity]);

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

  const netAssetCurve = useMemo(() => {
    const balances = recentMonths.map((item) => item.balance);
    const current = netAssets;
    const points = new Array(balances.length);
    let running = current;
    for (let i = balances.length - 1; i >= 0; i -= 1) {
      points[i] = running;
      running -= balances[i];
    }
    return recentMonths.map((item, index) => {
      const [year, month] = item.key.split('-').map(Number);
      return {
        key: item.key,
        label: year === currentYear ? item.shortLabel : `${String(year).slice(-2)}年${month}月`,
        value: points[index],
        dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
        dateTo: new Date(year, month, 0).toISOString().slice(0, 10),
        hasTransactions: item.transactionCount > 0,
        isCurrent: year === currentYear && month === currentMonth + 1
      };
    });
  }, [currentMonth, currentYear, netAssets, recentMonths]);

  const anomalyInsight = useMemo(() => {
    const expenseRows = transactions.filter((item) => isActualExpenseType(item.type));
    if (!expenseRows.length) {
      return {
        anomalies: ['暂无支出数据，暂无法识别异常。'],
        highlights: ['先记一笔账单，系统即可生成亮点分析。']
      };
    }

    const merchantThisWeek = new Map<string, number>();
    const merchantPrevWeek = new Map<string, number>();
    const today = new Date();
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - 6);
    const prevWeekStart = new Date(today);
    prevWeekStart.setDate(today.getDate() - 13);

    expenseRows.forEach((item) => {
      const date = new Date(item.date);
      const merchant =
        (item.note || '').trim().slice(0, 12) || categoryNameMap.get(item.categoryId) || '未知商家';
      if (date >= thisWeekStart) {
        merchantThisWeek.set(merchant, (merchantThisWeek.get(merchant) || 0) + item.amount);
      } else if (date >= prevWeekStart && date < thisWeekStart) {
        merchantPrevWeek.set(merchant, (merchantPrevWeek.get(merchant) || 0) + item.amount);
      }
    });

    const anomalies = Array.from(merchantThisWeek.entries())
      .map(([merchant, amount]) => {
        const prev = merchantPrevWeek.get(merchant) || 0;
        return { merchant, amount, prev, ratio: prev > 0 ? amount / prev : amount > 0 ? 99 : 0 };
      })
      .filter((item) => item.amount > 100 && item.ratio >= 1.8)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 2)
      .map(
        (item) =>
          `⚠️ ${item.merchant} 本周支出 ${formatCurrency(item.amount)}，较上周提升 ${item.prev ? `${((item.ratio - 1) * 100).toFixed(0)}%` : '显著增长'}。`
      );

    const monthlyByDay = new Map<string, number>();
    monthly.forEach((item) => {
      if (!isActualExpenseType(item.type)) return;
      const key = item.date.slice(0, 10);
      monthlyByDay.set(key, (monthlyByDay.get(key) || 0) + item.amount);
    });
    const dayValues = Array.from(monthlyByDay.values());
    const dayAvg = dayValues.reduce((sum, value) => sum + value, 0) / Math.max(dayValues.length, 1);
    const lowerDays = dayValues.filter((value) => value < dayAvg * 0.7).length;

    const highlights = [
      `✅ 本月日均支出约 ${formatCurrency(dayAvg)}，其中 ${lowerDays} 天低于均值 70%，节奏控制较好。`,
      ...(monthlyInsight?.highlights?.slice(0, 2).map((item) => `✨ AI：${item}`) || [])
    ].slice(0, 3);

    return {
      anomalies: anomalies.length ? anomalies : ['未发现明显异常消费激增，当前消费波动相对稳定。'],
      highlights
    };
  }, [categoryNameMap, monthly, monthlyInsight?.highlights, transactions]);
  void anomalyInsight;

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

  const anomalyInsightDisplay = useMemo(() => {
    const expenseRows = transactions.filter((item) => isActualExpenseType(item.type));
    if (!expenseRows.length) {
      return {
        anomalies: ['暂无支出数据，暂时无法识别异常。'],
        highlights: ['先记一笔账单，系统就能开始给出异常与亮点判断。'],
        supportFacts: [] as string[]
      };
    }

    const merchantThisWeek = new Map<string, number>();
    const merchantPrevWeek = new Map<string, number>();
    const today = new Date();
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - 6);
    const prevWeekStart = new Date(today);
    prevWeekStart.setDate(today.getDate() - 13);

    expenseRows.forEach((item) => {
      const date = new Date(item.date);
      const merchant =
        (item.note || '').trim().slice(0, 12) || categoryNameMap.get(item.categoryId) || '未知商家';
      if (date >= thisWeekStart) {
        merchantThisWeek.set(merchant, (merchantThisWeek.get(merchant) || 0) + item.amount);
      } else if (date >= prevWeekStart && date < thisWeekStart) {
        merchantPrevWeek.set(merchant, (merchantPrevWeek.get(merchant) || 0) + item.amount);
      }
    });

    const anomalies = Array.from(merchantThisWeek.entries())
      .map(([merchant, amount]) => {
        const prev = merchantPrevWeek.get(merchant) || 0;
        return { merchant, amount, prev, ratio: prev > 0 ? amount / prev : amount > 0 ? 99 : 0 };
      })
      .filter((item) => item.amount > 100 && item.ratio >= 1.8)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 2)
      .map((item) => {
        const changeText = item.prev
          ? `较上周提高 ${((item.ratio - 1) * 100).toFixed(0)}%`
          : '较上周明显抬升';
        return `${item.merchant} 本周支出 ${formatCurrency(item.amount)}，${changeText}。`;
      });

    const monthlyByDay = new Map<string, number>();
    monthly.forEach((item) => {
      if (!isActualExpenseType(item.type)) return;
      const key = item.date.slice(0, 10);
      monthlyByDay.set(key, (monthlyByDay.get(key) || 0) + item.amount);
    });
    const dayValues = Array.from(monthlyByDay.values());
    const dayAvg = dayValues.reduce((sum, value) => sum + value, 0) / Math.max(dayValues.length, 1);
    const lowerDays = dayValues.filter((value) => value < dayAvg * 0.7).length;
    const topExpenseCategory = [...cashflowCategoryRows]
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount)[0];

    return {
      anomalies: anomalies.length ? anomalies : ['今天账单挺稳，暂时没有异常波动。'],
      highlights: [
        `日均支出约 ${formatCurrency(dayAvg)}，有 ${lowerDays} 天属于轻量消费，节奏不错。`,
        ...(monthlyInsight?.highlights?.slice(0, 2) || [])
      ].slice(0, 3),
      supportFacts: [
        `本月花了 ${formatCurrency(expense)}`,
        `已记 ${expenseRows.length} 笔`,
        topExpenseCategory ? `花最多：${topExpenseCategory.name}` : ''
      ].filter(Boolean)
    };
  }, [
    cashflowCategoryRows,
    categoryNameMap,
    expense,
    monthly,
    monthlyInsight?.highlights,
    transactions
  ]);

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

  const netAssetRows = useMemo(() => {
    return netAssetCurve
      .map((item, index) => {
        const prev = index > 0 ? netAssetCurve[index - 1].value : item.value;
        return { ...item, delta: item.value - prev };
      })
      .filter((item) => item.hasTransactions);
  }, [netAssetCurve]);

  const netAssetWorstDrop = useMemo(() => {
    const candidates = netAssetRows.filter((_, index) => index > 0);
    if (!candidates.length) return null;
    const worst = candidates.reduce((currentWorst, current) =>
      current.delta < currentWorst.delta ? current : currentWorst
    );
    return worst.delta < 0 ? worst : null;
  }, [netAssetRows]);

  const moveModule = (from: DashboardModuleId, to: DashboardModuleId) => {
    if (from === to) return;
    setModuleOrder((prev) => {
      const next = prev.slice();
      const fromIndex = next.indexOf(from);
      const toIndex = next.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      return next;
    });
  };

  return (
    <div>
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
              <strong className="stat-value">{formatCurrency(netAssets)}</strong>
            </div>
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
              <strong className="stat-value">{formatCurrency(monthlyBalance)}</strong>
            </div>
          </button>
        </div>
        <DashboardModuleCustomizer
          title={tFallback('dashboard.ui.moduleCustomize', '首页模块')}
          hint={tFallback('dashboard.ui.moduleCustomizeHint', '拖动排序，关掉暂时用不上的卡片。')}
          items={moduleOrder.reduce<
            Array<{ id: DashboardModuleId; label: string; description: string; checked: boolean }>
          >((acc, moduleId) => {
            const module = DASHBOARD_MODULE_CATALOG.find((item) => item.id === moduleId);
            if (!module) return acc;
            acc.push({
              id: module.id,
              label: module.label,
              description: module.description,
              checked: moduleVisibility[module.id]
            });
            return acc;
          }, [])}
          draggingModuleId={draggingModule}
          onDragStart={(moduleId) => setDraggingModule(moduleId as DashboardModuleId)}
          onDrop={(moduleId) => {
            if (draggingModule) moveModule(draggingModule, moduleId as DashboardModuleId);
            setDraggingModule(null);
          }}
          onDragEnd={() => setDraggingModule(null)}
          onToggle={(moduleId, checked) =>
            setModuleVisibility((prev) => ({ ...prev, [moduleId as DashboardModuleId]: checked }))
          }
        />

        {moduleOrder.map((moduleId) => {
          if (!moduleVisibility[moduleId]) return null;
          if (moduleId === 'dynamic-charts') {
            return (
              <section key={moduleId} className="dashboard-dynamic-grid">
                <TrendChart
                  trendSeries={trendSeries}
                  activeTrendIndex={activeTrendIndex}
                  trendPeakIndex={trendPeakIndex}
                  trendGranularity={trendGranularity}
                  trendBaseYear={trendBaseYear}
                  trendBaseMonth={trendBaseMonth}
                  expenseTrendAverage={expenseTrendAverage}
                  trendMonthOffset={trendMonthOffset}
                  onTrendGranularityChange={setTrendGranularity}
                  onTrendMonthOffsetChange={setTrendMonthOffset}
                  onSelectedTrendIndexChange={setSelectedTrendIndex}
                  onNavigateToTransactions={(dateFrom: string, dateTo: string) =>
                    navigate(
                      `/transactions?datePreset=custom&dateFrom=${dateFrom}&dateTo=${dateTo}`
                    )
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
                {netAssetRows.length > 0 ? (
                  <NetAssetCurveCard
                    rows={netAssetRows}
                    worstDropKey={netAssetWorstDrop?.key}
                    worstDropDelta={netAssetWorstDrop?.delta}
                    onNavigateToMonth={(dateFrom, dateTo) => {
                      navigate(
                        `/transactions?datePreset=custom&dateFrom=${dateFrom}&dateTo=${dateTo}`
                      );
                    }}
                  />
                ) : null}
              </section>
            );
          }

          if (moduleId === 'anomaly-insights') {
            if (!hasExpenseTransactions && subscriptionAlerts.length === 0) {
              return null;
            }
            return (
              <DashboardAnomalyInsights
                key={moduleId}
                anomalyInsight={anomalyInsightDisplay}
                subscriptionAlerts={subscriptionAlerts}
                onNavigateToSmartBudget={() => navigate('/smart-budget')}
                onNavigateToTransactions={() => navigate('/transactions')}
                onNavigateToSubscriptions={() => navigate('/subscriptions')}
              />
            );
          }

          if (moduleId === 'top-transactions') {
            return <DashboardTopTransactionsCard key={moduleId} items={displayTopTransactions} />;
          }

          if (moduleId === 'history-compare') {
            return (
              <DashboardHistoryCompareCard
                key={moduleId}
                previousMonthExpense={recentMonths[recentMonths.length - 2]?.expense || 0}
                quarterExpense={quarterExpense}
                yearlyExpense={yearlyExpense}
                profile={monthlyInsight?.profile}
                monthlyInsightStatus={monthlyInsightStatus}
              />
            );
          }

          return (
            <article key={moduleId} className="panel" style={{ marginTop: 12 }}>
              <h3>{mysticInsight.title}</h3>
              {mysticInsight.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p>
                <strong>{mysticInsight.disclaimer}</strong>
              </p>
            </article>
          );
        })}
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
      ) : (
        <div className="grid grid-2 dashboard-main-grid" style={{ marginTop: 16 }}>
          <DashboardMonthlyTrendSummaryCard
            title={tFallback('dashboard.ui.thisMonthTrend', '本月趋势')}
            currentMonthLabel={currentMonthLabel}
            monthlyInsightActionLabel={monthlyInsightActionLabel}
            monthlyInsightStatus={monthlyInsightStatus}
            monthlyInsightError={monthlyInsightError}
            monthlyBalance={monthlyBalance}
            income={income}
            expense={expense}
            transactionCount={monthly.length}
            monthOverMonthChange={monthOverMonthChange}
            monthOverMonthRate={monthOverMonthRate}
            monthOverMonthDirection={monthOverMonthDirection}
            monthOverMonthArrow={monthOverMonthArrow}
            displayCategoryBreakdown={displayCategoryBreakdown}
            onRefresh={handleRefreshMonthlyInsight}
            refreshDisabled={
              monthlyInsightStatus === 'loading' ||
              monthlyInsightStatus === 'streaming' ||
              transactions.length === 0
            }
          />

          <section className="panel">
            <h3>{tFallback('dashboard.ui.futureTrend', '未来现金流')}</h3>
            <div className="dashboard-forecast-header">
              <p className="dashboard-ai-badge">
                模型：{model || '默认模型'} ·{' '}
                {forecastStatus === 'loading'
                  ? '分析中'
                  : forecastStatus === 'done'
                    ? '已完成'
                    : forecastStatus === 'error'
                      ? '降级展示'
                      : '待分析'}
                {forecastUpdatedAt
                  ? ` · 上次分析 ${new Date(forecastUpdatedAt).toLocaleString('zh-CN')}`
                  : ''}
              </p>
              <button
                type="button"
                className="dashboard-forecast-refresh"
                onClick={handleRefreshForecast}
                disabled={forecastStatus === 'loading' || transactions.length === 0}
              >
                手动分析
              </button>
            </div>
            {forecastError ? <p className="dashboard-future-tip">{forecastError}</p> : null}

            <div className="dashboard-forecast-chart" aria-label="未来趋势动态图表">
              <div className="dashboard-forecast-summary-card">
                <strong>{forecast?.summary || '点击“手动分析”生成未来趋势分析。'}</strong>
                <span>改成柱状图后，可以更快看清历史走势和未来 3 个月预测。</span>
              </div>
              <div
                className="dashboard-forecast-bars"
                role="list"
                aria-label="历史与未来趋势柱状图"
              >
                {chartData.map((item, index) => {
                  const klass =
                    index === currentIndex
                      ? 'current'
                      : item.type === 'forecast'
                        ? 'forecast'
                        : 'history';
                  return (
                    <div
                      key={`bar-${item.label}-${index}`}
                      role="listitem"
                      className={`dashboard-forecast-bar-item ${klass}`.trim()}
                    >
                      <span className="dashboard-forecast-bar-value">
                        {formatCurrency(item.value)}
                      </span>
                      <div className="dashboard-forecast-bar-track">
                        <i
                          className={item.value >= 0 ? 'is-positive' : 'is-negative'}
                          style={{ height: forecastBarHeight(item.value) }}
                        />
                      </div>
                      <strong>{item.label}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="dashboard-forecast-axes">
                <div className="dashboard-forecast-axis-y" aria-label="金额轴">
                  {axisTicks.map((value, index) => (
                    <span key={`y-${index}`}>{formatCurrency(value)}</span>
                  ))}
                </div>
                <svg viewBox="0 0 600 240" role="img" aria-label="历史与未来趋势折线图">
                  <line
                    x1="24"
                    y1="20"
                    x2="24"
                    y2="220"
                    stroke="var(--color-border)"
                    strokeWidth="1"
                  />
                  <line
                    x1="24"
                    y1="220"
                    x2="580"
                    y2="220"
                    stroke="var(--color-border)"
                    strokeWidth="1"
                  />
                  {historySegment ? (
                    <path
                      d={historySegment}
                      className="history-line dashboard-forecast-path"
                      fill="none"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {forecastSegment ? (
                    <path
                      d={forecastSegment}
                      className="forecast-line dashboard-forecast-path"
                      fill="none"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {chartPoints.map((point, index) => (
                    <g key={`point-${point.label}-${index}`} className="dashboard-forecast-point">
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={index === currentIndex ? 4.8 : 3.6}
                        onMouseEnter={() =>
                          setHoveredChartPoint({
                            label: point.label,
                            value: point.value
                          })
                        }
                      />
                      <title>{`${point.label}：${formatCurrency(point.value)}`}</title>
                    </g>
                  ))}
                </svg>
              </div>
              <div className="dashboard-forecast-axis-x" aria-label="时间轴">
                {chartData.map((item, index) => {
                  const klass =
                    index === currentIndex
                      ? 'current'
                      : item.type === 'forecast'
                        ? 'forecast'
                        : 'history';
                  return (
                    <span key={`x-${item.label}-${index}`} className={klass}>
                      {item.label}
                    </span>
                  );
                })}
              </div>
              <div className="dashboard-forecast-key" aria-label="趋势颜色说明">
                <span className="history">历史</span>
                <span className="forecast">预测</span>
              </div>
              <div className="dashboard-forecast-hover-card">
                <strong>{hoveredChartPoint ? hoveredChartPoint.label : '悬停数据点'}</strong>
                <span>
                  {hoveredChartPoint ? formatCurrency(hoveredChartPoint.value) : '查看具体数值'}
                </span>
                <em>{hoveredChartPoint ? '历史 / 预测属性预览' : '支持鼠标悬停预览'}</em>
              </div>
              <div className="dashboard-forecast-legend">
                {chartData.map((item, index) => {
                  const klass = item.type === 'forecast' ? 'forecast' : 'history';
                  const prefix = item.type === 'forecast' ? '预测' : '';
                  return (
                    <span key={`${item.label}-${index}`} className={klass}>
                      {prefix}
                      {item.label}：{formatCurrency(item.value)}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="dashboard-forecast-quick-cards">
              <article className="dashboard-forecast-quick-card">
                <p>未来3个月预测</p>
                <div className="dashboard-forecast-quick-values">
                  {forecastMonths.map((item) => (
                    <div key={item.label} className="dashboard-forecast-quick-value-item">
                      <span>{item.label}</span>
                      <strong>{formatCurrency(item.value)}</strong>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <p className="dashboard-future-text">
              {forecast?.summary || '点击“手动分析”生成未来趋势分析。'}
            </p>
            <p className="dashboard-future-tip">
              分析输入源：当前本地账目数据（若已同步数据库，数据会先落地到本地再用于模型分析）。
            </p>
          </section>
        </div>
      )}

      <DebugLogPanel />
    </div>
  );
}
