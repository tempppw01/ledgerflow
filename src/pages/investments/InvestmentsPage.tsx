import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account } from '../../entities/account/types';
import type {
  InvestmentCategory,
  InvestmentFundAnalysis,
  InvestmentWatchItem,
  InvestmentWatchlistReviewItem
} from '../../entities/investment/types';
import { sendAiChatStream } from '../../features/assistant/api/openaiCompatibleClient';
import { fetchWebSearchContext, buildWebSearchPrompt } from '../../features/assistant/api/webSearchClient';
import { InvestmentChatPanel } from '../../features/assistant/investment-chat/InvestmentChatPanel';
import { fetchEastmoneyFundSnapshot } from '../../features/investments/api/eastmoneyFundClient';
import {
  EASTMONEY_MARKET_INDEXES,
  EASTMONEY_MARKET_NEWS_CATEGORIES,
  fetchEastmoneyMarketOverview,
  fetchEastmoneyMarketNews,
  type EastmoneyMarketOverview,
  type EastmoneyMarketNewsItem,
  type EastmoneyMarketQuote,
  type EastmoneyMarketTrendPoint
} from '../../features/investments/api/eastmoneyMarketClient';
import {
  BRAIN_ICON_URL,
  INFO_ICON_URL,
  ROTATE_CCW_ICON_URL
} from '../../shared/config/brandAssets';
import { formatCurrencyAuto } from '../../shared/lib/format';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { Toast, type ToastVariant } from '../../shared/ui/Toast';
import {
  buildInvestmentFundAnalysisPrompt,
  buildInvestmentWatchlistReviewPrompt,
  createInvestmentAiMessage,
  extractInvestmentAnalysis,
  extractInvestmentWatchlistReview,
  summarizeInvestmentAnalysis,
  trimInvestmentAiMessages
} from './investmentAi';
import {
  ASSISTANT_ACTIVE_MODE_STORAGE_KEY,
  ASSISTANT_MODE_CHANGED_EVENT
} from '../../features/assistant/shared/assistantMode';

const POSITION_CATEGORY_LABELS: Record<InvestmentCategory, string> = {
  cash: '现金理财',
  'fixed-income': '固收',
  'index-fund': '指数基金',
  'active-fund': '主动基金',
  stock: '股票',
  gold: '黄金',
  other: '其他'
};


type WatchCategoryFilterId =
  | 'all'
  | 'index-fund'
  | 'active-fund'
  | 'fixed-income'
  | 'cash'
  | 'other';

const WATCH_CATEGORY_FILTERS: Array<{ id: WatchCategoryFilterId; label: string; mark: string }> = [
  { id: 'all', label: '全部', mark: '全' },
  { id: 'index-fund', label: '指数', mark: '指' },
  { id: 'active-fund', label: '主动', mark: '主' },
  { id: 'fixed-income', label: '债券', mark: '债' },
  { id: 'cash', label: '货币', mark: '货' },
  { id: 'other', label: '其他', mark: '其' }
];

const WATCH_GRID_COLUMN_OPTIONS = [1, 2, 3] as const;

type WatchGridColumnCount = (typeof WATCH_GRID_COLUMN_OPTIONS)[number];

function isPositiveAccount(account: Account) {
  return account.type !== 'liability' && account.type !== 'credit';
}

function getMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

function formatDateTimeLabel(value?: string) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
}

function getAnalysisRiskLabel(riskLevel?: InvestmentFundAnalysis['riskLevel']) {
  if (riskLevel === 'low') return '偏稳';
  if (riskLevel === 'medium') return '均衡';
  if (riskLevel === 'high') return '进取';
  return '待判断';
}

function getAnalysisRiskClass(riskLevel?: InvestmentFundAnalysis['riskLevel']) {
  if (riskLevel === 'low') return 'is-low';
  if (riskLevel === 'medium') return 'is-medium';
  if (riskLevel === 'high') return 'is-high';
  return 'is-unknown';
}

type WatchDetailSection = {
  title: string;
  kind: 'chart' | 'chips' | 'stat' | 'text';
  items: string[];
};

function compactWatchDetailSections(item: InvestmentWatchItem): WatchDetailSection[] {
  return [
    { title: '历史业绩', kind: 'chart' as const, items: item.performanceHistory || [] },
    { title: '基金分析', kind: 'text' as const, items: item.fundAnalysis || [] },
    { title: '基金持仓', kind: 'chips' as const, items: item.fundHoldings || [] },
    { title: '基金资产分布', kind: 'chips' as const, items: item.assetAllocation || [] },
    { title: '行业分布', kind: 'chips' as const, items: item.industryAllocation || [] },
    { title: '买入费率', kind: 'stat' as const, items: item.buyFeeRate ? [item.buyFeeRate] : [] },
    { title: '基金公司', kind: 'stat' as const, items: item.fundCompany ? [item.fundCompany] : [] },
    { title: '判断依据', kind: 'text' as const, items: item.adviceReasons || [] },
    { title: '风险提示', kind: 'text' as const, items: item.riskNotes || [] }
  ].filter((section) => section.items.length > 0);
}

type WatchPerformancePoint = {
  label: string;
  value: number;
  caption: string;
};

type MarketTrendChartPoint = EastmoneyMarketTrendPoint & {
  x: number;
  y: number;
  index: number;
};

function formatWatchPerformanceCaption(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function parseWatchPerformancePoints(items: string[]): WatchPerformancePoint[] {
  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => {
      const periodMatch = item.match(/^(近\s*\d+\s*[月周日年])\s+(-?\d+(?:\.\d+)?)%?$/);
      if (periodMatch) {
        const value = Number(periodMatch[2] || 0);
        return {
          label: periodMatch[1].replace(/\s+/g, ''),
          value,
          caption: formatWatchPerformanceCaption(value)
        };
      }

      const timestampMatch = item.match(/^(\d{10,13})\s+(-?\d+(?:\.\d+)?)%?$/);
      if (timestampMatch) {
        const timestamp = Number(timestampMatch[1]);
        const value = Number(timestampMatch[2] || 0);
        const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
        const label = Number.isNaN(date.getTime())
          ? item
          : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
        return {
          label,
          value,
          caption: formatWatchPerformanceCaption(value)
        };
      }

      const valueMatch = item.match(/(-?\d+(?:\.\d+)?)%$/);
      const value = valueMatch ? Number(valueMatch[1] || 0) : 0;

      return {
        label: item.slice(0, 4),
        value,
        caption: item
      };
    })
    .filter((point) => Number.isFinite(point.value));
}

function getWatchSectionClassName(kind: WatchDetailSection['kind']) {
  if (kind === 'chart') return 'is-chart';
  if (kind === 'chips') return 'is-chips';
  if (kind === 'stat') return 'is-stat';
  return 'is-text';
}

function formatWatchPreviewItem(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';

  const timestampMatch = text.match(/^(\d{10,13})\s+(-?\d+(?:\.\d+)?)%?$/);
  if (timestampMatch) {
    const timestamp = Number(timestampMatch[1]);
    const metric = Number(timestampMatch[2] || 0);
    const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
    if (!Number.isNaN(date.getTime())) {
      return `${date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit'
      })} ${metric.toFixed(2)}`;
    }
  }

  return text;
}

function formatMarketIndexValue(value?: number | null) {
  return typeof value === 'number' ? value.toFixed(2) : '--';
}

function formatMarketPercent(value?: number | null) {
  if (typeof value !== 'number') return '--';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMarketAmount(value?: number | null) {
  if (typeof value !== 'number' || value <= 0) return '--';
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(value >= 1e10 ? 0 : 1)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(0)}万`;
  return value.toFixed(0);
}

function formatMarketNewsTime(value?: string) {
  if (!value) return '刚刚';
  const timePart = value.match(/(\d{2}:\d{2})(?::\d{2})?$/)?.[1];
  if (timePart) return timePart;

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  return value;
}

function getMarketTone(value?: number | null) {
  if (typeof value !== 'number') return 'is-flat';
  if (value > 0) return 'is-positive';
  if (value < 0) return 'is-negative';
  return 'is-flat';
}

function buildMarketTrendGeometry(points: EastmoneyMarketTrendPoint[]) {
  const width = 560;
  const height = 176;
  const paddingX = 6;
  const paddingY = 12;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const values = points.map((item) => item.value).filter((value) => Number.isFinite(value));

  if (values.length < 2) {
    return {
      width,
      height,
      linePath: '',
      areaPath: '',
      min: null as number | null,
      max: null as number | null,
      mid: null as number | null,
      points: [] as MarketTrendChartPoint[],
      labels: [] as string[]
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.01);
  const coords = points.map((point, index) => {
    const x = paddingX + (index / Math.max(points.length - 1, 1)) * usableWidth;
    const y = paddingY + (1 - (point.value - min) / spread) * usableHeight;
    return { ...point, x, y, index };
  });
  const linePath = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${height.toFixed(2)} L ${first.x.toFixed(
    2
  )} ${height.toFixed(2)} Z`;
  const middle = points[Math.floor(points.length / 2)];

  return {
    width,
    height,
    linePath,
    areaPath,
    min,
    max,
    mid: min + spread / 2,
    points: coords,
    labels: [points[0]?.label, middle?.label, points[points.length - 1]?.label].filter(Boolean)
  };
}

function MarketOverviewPanel({
  overview,
  selectedSecId,
  status,
  error,
  onSelect,
  onRefresh,
  onAskMarket
}: {
  overview: EastmoneyMarketOverview | null;
  selectedSecId: string;
  status: 'idle' | 'loading' | 'error';
  error: string;
  onSelect: (secId: string) => void;
  onRefresh: () => void;
  onAskMarket: () => void;
}) {
  const quotes = overview?.quotes || [];
  const quoteBySecId = new Map(quotes.map((quote) => [quote.secId, quote]));
  const activeIndex = EASTMONEY_MARKET_INDEXES.find((item) => item.secId === selectedSecId);
  const selectedQuote =
    quoteBySecId.get(selectedSecId) ||
    quotes.find((quote) => quote.code === activeIndex?.code) ||
    quotes[0] ||
    EASTMONEY_MARKET_INDEXES.find((item) => item.secId === selectedSecId);
  const isTrendCurrent = overview?.selectedSecId === selectedSecId;
  const selectedTrend = isTrendCurrent ? overview?.trend || [] : [];
  const chart = buildMarketTrendGeometry(selectedTrend);
  const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);
  const totalAmount = quotes.reduce((sum, item) => sum + (item.amount || 0), 0);
  const selectedQuoteData =
    selectedQuote && 'amount' in selectedQuote ? (selectedQuote as EastmoneyMarketQuote) : null;
  const updatedAt = overview?.updatedAt ? formatDateTimeLabel(overview.updatedAt) : '';
  const isSwitchingTrend = status === 'loading' && !isTrendCurrent;
  const activeTrendPoint =
    chart.points[hoveredTrendIndex ?? chart.points.length - 1] ||
    chart.points[chart.points.length - 1] ||
    null;

  useEffect(() => {
    setHoveredTrendIndex(null);
  }, [selectedSecId]);

  function handleChartPointerMove(event: MouseEvent<HTMLDivElement>) {
    if (!chart.points.length) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const x = ((event.clientX - rect.left) / rect.width) * chart.width;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    chart.points.forEach((point, index) => {
      const distance = Math.abs(point.x - x);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setHoveredTrendIndex(closestIndex);
  }

  const activeTrendText =
    activeTrendPoint && Number.isFinite(activeTrendPoint.value)
      ? `${activeTrendPoint.label || '当前'} · ${formatMarketIndexValue(activeTrendPoint.value)}`
      : '等待分时线';

  return (
    <section
      className={`panel investments-market-panel ${status === 'loading' ? 'is-loading' : ''}`}
      data-investment-support-title="大盘概览"
    >
      <div className="investments-market-head">
        <div>
          <h3>大盘概览</h3>
          <p>{updatedAt ? `东方财富行情 · ${updatedAt}` : '东方财富行情'}</p>
        </div>
        <div className="investments-market-actions">
          <button type="button" onClick={onRefresh} disabled={status === 'loading'}>
            {status === 'loading' ? '刷新中' : '刷新'}
          </button>
          <button type="button" className="primary" onClick={onAskMarket}>
            问 AI 怎么看
          </button>
        </div>
      </div>

      <div className="investments-market-tabs" role="tablist" aria-label="大盘指数">
        {EASTMONEY_MARKET_INDEXES.map((item) => {
          const quote = quoteBySecId.get(item.secId);
          const changePercent = quote?.changePercent ?? null;
          return (
            <button
              key={item.secId}
              type="button"
              role="tab"
              aria-selected={selectedSecId === item.secId}
              className={`investments-market-tab ${selectedSecId === item.secId ? 'is-active' : ''} ${getMarketTone(
                changePercent
              )}`}
              onClick={() => onSelect(item.secId)}
            >
              <span>{item.name}</span>
              <strong>{formatMarketPercent(changePercent)}</strong>
            </button>
          );
        })}
      </div>

      <div className="investments-market-body">
        <div className="investments-market-main">
          <div
            className="investments-market-mini-stats"
            aria-label={`${activeIndex?.name || '大盘'}关键数据`}
          >
            <span>
              最新 <strong>{formatMarketIndexValue(selectedQuoteData?.value)}</strong>
            </span>
            <span>
              最高 <strong>{formatMarketIndexValue(selectedQuoteData?.high)}</strong>
            </span>
            <span>
              最低 <strong>{formatMarketIndexValue(selectedQuoteData?.low)}</strong>
            </span>
            <span>
              成交额 <strong>{formatMarketAmount(selectedQuoteData?.amount)}</strong>
            </span>
          </div>

          <div
            className="investments-market-chart-wrap"
            key={selectedSecId}
            onMouseLeave={() => setHoveredTrendIndex(null)}
          >
            {chart.linePath ? (
              <div className="investments-market-chart-stage" onMouseMove={handleChartPointerMove}>
                <svg
                  className={`investments-market-chart ${getMarketTone(
                    selectedQuoteData?.changePercent
                  )}`}
                  viewBox={`0 0 ${chart.width} ${chart.height}`}
                  role="img"
                  aria-label={`${activeIndex?.name || '指数'}分时走势`}
                >
                  <defs>
                    <linearGradient id="investments-market-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path className="investments-market-chart-area" d={chart.areaPath} />
                  {[0.25, 0.5, 0.75].map((ratio) => (
                    <line
                      key={ratio}
                      className="investments-market-chart-grid"
                      x1="0"
                      x2={chart.width}
                      y1={chart.height * ratio}
                      y2={chart.height * ratio}
                    />
                  ))}
                  {activeTrendPoint ? (
                    <>
                      <line
                        className="investments-market-chart-cursor"
                        x1={activeTrendPoint.x}
                        x2={activeTrendPoint.x}
                        y1="0"
                        y2={chart.height}
                      />
                      <circle
                        className="investments-market-chart-point"
                        cx={activeTrendPoint.x}
                        cy={activeTrendPoint.y}
                        r="4.5"
                      />
                    </>
                  ) : null}
                  <path className="investments-market-chart-line" d={chart.linePath} />
                </svg>
                {activeTrendPoint ? (
                  <div
                    className="investments-market-chart-tooltip"
                    style={{
                      left: `${(activeTrendPoint.x / chart.width) * 100}%`,
                      top: `${Math.max(8, ((activeTrendPoint.y - 14) / chart.height) * 100)}%`
                    }}
                    aria-hidden="true"
                  >
                    <strong>{activeTrendPoint.label}</strong>
                    <span>{formatMarketIndexValue(activeTrendPoint.value)}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="investments-market-chart-empty">
                <strong>
                  {status === 'error'
                    ? '行情暂时没有连上'
                    : isSwitchingTrend
                      ? '正在切换指数'
                      : '等待分时线'}
                </strong>
                <span>{error || `${activeIndex?.name || '指数'}分时线加载后会显示在这里。`}</span>
              </div>
            )}

            {chart.labels.length ? (
              <div className="investments-market-time-axis" aria-hidden="true">
                {chart.labels.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
            ) : null}

            <div className="investments-market-chart-foot">
              <div>
                <strong>{activeTrendText}</strong>
                <span>
                  {activeTrendPoint
                    ? `均价 ${formatMarketIndexValue(activeTrendPoint.average)}`
                    : '分时点位'}
                </span>
              </div>
              <div>
                <span>
                  成交额 <strong>{formatMarketAmount(activeTrendPoint?.amount)}</strong>
                </span>
                <span>
                  成交量 <strong>{formatMarketAmount(activeTrendPoint?.volume)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        <aside className="investments-market-side" aria-label="大盘成交概览">
          <div className="investments-market-turnover-card">
            <span>四大指数成交额</span>
            <strong>{formatMarketAmount(totalAmount)}</strong>
            <em>
              {activeIndex?.shortName || '指数'}{' '}
              {formatMarketPercent(selectedQuoteData?.changePercent)}
            </em>
          </div>
          <div className="investments-market-side-grid">
            <span>
              选中指数
              <strong>{formatMarketAmount(selectedQuoteData?.amount)}</strong>
            </span>
            <span>
              昨收
              <strong>{formatMarketIndexValue(selectedQuoteData?.previousClose)}</strong>
            </span>
          </div>
        </aside>
      </div>

      {error && status === 'error' ? <p className="investments-market-error">{error}</p> : null}
    </section>
  );
}

function MarketNewsPanel({
  news,
  selectedCategoryId,
  status,
  error,
  onSelectCategory,
  onRefresh
}: {
  news: EastmoneyMarketNewsItem[];
  selectedCategoryId: string;
  status: 'idle' | 'loading' | 'error';
  error: string;
  onSelectCategory: (categoryId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section
      className={`panel investments-market-news-panel ${status === 'loading' ? 'is-loading' : ''}`}
      data-investment-support-title="快讯"
    >
      <div className="investments-market-news-head">
        <div>
          <h3>
            快讯 <span>7x24</span>
          </h3>
        </div>
        <button type="button" onClick={onRefresh} disabled={status === 'loading'}>
          {status === 'loading' ? '刷新中' : '刷新'}
        </button>
      </div>

      <div className="investments-market-news-tabs" role="tablist" aria-label="快讯分类">
        {EASTMONEY_MARKET_NEWS_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selectedCategoryId === item.id}
            className={selectedCategoryId === item.id ? 'is-active' : ''}
            onClick={() => onSelectCategory(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && status === 'error' ? (
        <p className="investments-market-news-error">{error}</p>
      ) : null}

      {news.length === 0 && status !== 'loading' ? (
        <div className="investments-market-news-empty">
          <strong>暂无快讯</strong>
          <span>稍后刷新，或切换其他分类看看。</span>
        </div>
      ) : (
        <div className="investments-market-news-list" aria-label="市场快讯">
          {news.slice(0, 8).map((item) => (
            <a
              key={item.id}
              className="investments-market-news-item"
              href={item.link}
              target="_blank"
              rel="noreferrer"
            >
              <span className="investments-market-news-time">
                {formatMarketNewsTime(item.time)}
              </span>
              <strong>{item.title}</strong>
              {item.summary ? <p>{item.summary}</p> : null}
              {item.stocks.length ? (
                <div className="investments-market-news-tags" aria-label="关联代码">
                  {item.stocks.map((stock) => (
                    <em key={stock}>{stock}</em>
                  ))}
                </div>
              ) : null}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function getWatchItemCategoryId(item: InvestmentWatchItem): WatchCategoryFilterId {
  const searchText = [
    item.name,
    item.code,
    item.platform,
    item.lastVerdict,
    item.lastSummary,
    item.investmentAdvice,
    item.note,
    ...(item.tags || []),
    ...(item.fundAnalysis || []),
    ...(item.fundHoldings || []),
    ...(item.assetAllocation || []),
    ...(item.industryAllocation || [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(指数|etf|lof|联接|index|宽基|沪深|中证|上证|深证|创业板|科创)/i.test(searchText)) {
    return 'index-fund';
  }

  if (/(债|固收|纯债|短债|可转债|利率|信用债|fixed)/i.test(searchText)) {
    return 'fixed-income';
  }

  if (/(货币|现金|添利|余额|money|cash)/i.test(searchText)) {
    return 'cash';
  }

  if (/(主动|混合|股票型|灵活配置|成长|价值|精选|消费|医药|新能源|红利)/i.test(searchText)) {
    return 'active-fund';
  }

  return 'other';
}

function formatHoldingShares(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '';
  }

  const rounded = Number(value.toFixed(2));
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)} 份`;
}

function mergeWatchlistReview(
  watchlist: InvestmentWatchItem[],
  reviewItems: InvestmentWatchlistReviewItem[]
): InvestmentWatchItem[] {
  const reviewedAt = new Date().toISOString();
  const reviewById = new Map(reviewItems.map((item) => [item.id, item]));

  return watchlist
    .map((item, index) => {
      const review = reviewById.get(item.id);
      if (!review) {
        return {
          item,
          rank: 9999 + index
        };
      }

      return {
        item: {
          ...item,
          tags: review.watchTags?.length ? review.watchTags : item.tags,
          note: review.note || item.note,
          lastVerdict: review.verdict || item.lastVerdict,
          lastSummary: review.summary || item.lastSummary,
          lastRiskLevel: review.riskLevel || item.lastRiskLevel,
          investmentAdvice: review.investmentAdvice || item.investmentAdvice,
          adviceReasons: review.adviceReasons?.length ? review.adviceReasons : item.adviceReasons,
          riskNotes: review.riskNotes?.length ? review.riskNotes : item.riskNotes,
          nextActions: review.nextActions?.length ? review.nextActions : item.nextActions,
          holdingShares: item.holdingShares,
          performanceHistory: review.performanceHistory?.length
            ? review.performanceHistory
            : item.performanceHistory,
          fundAnalysis: review.fundAnalysis?.length ? review.fundAnalysis : item.fundAnalysis,
          fundHoldings: review.fundHoldings?.length ? review.fundHoldings : item.fundHoldings,
          assetAllocation: review.assetAllocation?.length
            ? review.assetAllocation
            : item.assetAllocation,
          industryAllocation: review.industryAllocation?.length
            ? review.industryAllocation
            : item.industryAllocation,
          netValue: review.netValue || item.netValue,
          addedReturn: review.addedReturn || item.addedReturn,
          holdingReturn: review.holdingReturn || item.holdingReturn,
          buyFeeRate: review.buyFeeRate || item.buyFeeRate,
          fundCompany: review.fundCompany || item.fundCompany,
          lastAnalysisAt: reviewedAt,
          updatedAt: reviewedAt
        },
        rank: review.rank || 9999 + index
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

export function InvestmentsPage() {
  const navigate = useNavigate();
  const accounts = useFinanceStore((state) => state.accounts);
  const transactions = useFinanceStore((state) => state.transactions);
  const positions = useAppPreferences((state) => state.investmentPositions);
  const investmentWatchlist = useAppPreferences((state) => state.investmentWatchlist);
  const investmentAiMessages = useAppPreferences((state) => state.investmentAiMessages);
  const debts = useAppPreferences((state) => state.debts);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const removeInvestmentWatchItem = useAppPreferences((state) => state.removeInvestmentWatchItem);
  const upsertInvestmentWatchItem = useAppPreferences((state) => state.upsertInvestmentWatchItem);
  const setInvestmentWatchlist = useAppPreferences((state) => state.setInvestmentWatchlist);
  const setInvestmentAiMessages = useAppPreferences((state) => state.setInvestmentAiMessages);
  const { baseUrl, apiKey, model, webSearch } = useAiSettings();

  const [watchlistReviewStatus, setWatchlistReviewStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [watchlistReviewError, setWatchlistReviewError] = useState('');
  const [fundLookupCode, setFundLookupCode] = useState('');
  const [fundLookupStatus, setFundLookupStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fundLookupError, setFundLookupError] = useState('');
  const [selectedWatchCategoryId, setSelectedWatchCategoryId] =
    useState<WatchCategoryFilterId>('all');
  const [watchGridColumns, setWatchGridColumns] = useState<WatchGridColumnCount>(3);
  const [refreshingWatchItemId, setRefreshingWatchItemId] = useState<string | null>(null);
  const [refreshingAllWatchItems, setRefreshingAllWatchItems] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: ToastVariant }>({
    visible: false,
    message: '',
    variant: 'success'
  });
  const [expandedWatchItemId, setExpandedWatchItemId] = useState<string | null>(null);
  const [selectedMarketSecId, setSelectedMarketSecId] = useState(EASTMONEY_MARKET_INDEXES[0].secId);
  const [marketOverview, setMarketOverview] = useState<EastmoneyMarketOverview | null>(null);
  const [marketStatus, setMarketStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [marketError, setMarketError] = useState('');
  const [selectedNewsCategoryId, setSelectedNewsCategoryId] = useState(
    EASTMONEY_MARKET_NEWS_CATEGORIES[0].id
  );
  const [marketNews, setMarketNews] = useState<EastmoneyMarketNewsItem[]>([]);
  const [marketNewsStatus, setMarketNewsStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [marketNewsError, setMarketNewsError] = useState('');
  const [analyzingWatchItemId, setAnalyzingWatchItemId] = useState<string | null>(null);

  const activePositions = useMemo(() => positions.filter((item) => item.isActive), [positions]);

  const { monthExpenseTotal, monthNetBalance } = useMemo(() => {
    const { start, end } = getMonthBounds();
    const monthTransactions = transactions.filter((item) => {
      const date = new Date(item.date);
      return date >= start && date < end;
    });

    const incomeTotal = monthTransactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + item.amount, 0);
    const expenseTotal = monthTransactions
      .filter((item) => item.type === 'expense' || item.type === 'repayment')
      .reduce((sum, item) => sum + item.amount, 0);

    return {
      monthExpenseTotal: expenseTotal,
      monthNetBalance: incomeTotal - expenseTotal
    };
  }, [transactions]);

  const positionSummary = useMemo(() => {
    const totalInvested = activePositions.reduce((sum, item) => sum + item.investedAmount, 0);
    const totalCurrentValue = activePositions.reduce((sum, item) => sum + item.currentValue, 0);
    const totalMonthlyContribution = activePositions.reduce(
      (sum, item) => sum + (item.monthlyContribution || 0),
      0
    );
    const totalProfit = totalCurrentValue - totalInvested;
    const profitRate = totalInvested > 0 ? totalProfit / totalInvested : 0;

    const allocationRows = Object.entries(POSITION_CATEGORY_LABELS)
      .map(([category, label]) => {
        const value = activePositions
          .filter((item) => item.category === category)
          .reduce((sum, item) => sum + item.currentValue, 0);
        const share = totalCurrentValue > 0 ? value / totalCurrentValue : 0;
        return {
          category: category as InvestmentCategory,
          label,
          value,
          share
        };
      })
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);

    return {
      totalInvested,
      totalCurrentValue,
      totalMonthlyContribution,
      totalProfit,
      profitRate,
      allocationRows
    };
  }, [activePositions]);

  const accountAssetBalance = useMemo(
    () =>
      accounts
        .filter(isPositiveAccount)
        .reduce((sum, item) => sum + Math.max(0, Number(item.balance || 0)), 0),
    [accounts]
  );

  const debtBalance = useMemo(
    () => debts.reduce((sum, item) => sum + Math.max(0, Number(item.balance || 0)), 0),
    [debts]
  );

  const monthlyInvestableCash = useMemo(() => {
    const baseline = monthlyIncome > 0 ? monthlyIncome - monthExpenseTotal : monthNetBalance;
    return Math.max(0, baseline);
  }, [monthExpenseTotal, monthNetBalance, monthlyIncome]);

  const estimatedNetAssets = Math.max(
    0,
    accountAssetBalance + positionSummary.totalCurrentValue - debtBalance
  );
  const investmentAssetRatio =
    estimatedNetAssets > 0 ? positionSummary.totalCurrentValue / estimatedNetAssets : 0;



  const watchCategoryCounts = useMemo<Record<WatchCategoryFilterId, number>>(() => {
    const counts: Record<WatchCategoryFilterId, number> = {
      all: investmentWatchlist.length,
      'index-fund': 0,
      'active-fund': 0,
      'fixed-income': 0,
      cash: 0,
      other: 0
    };

    investmentWatchlist.forEach((item) => {
      counts[getWatchItemCategoryId(item)] += 1;
    });

    return counts;
  }, [investmentWatchlist]);

  const filteredInvestmentWatchlist = useMemo(
    () =>
      selectedWatchCategoryId === 'all'
        ? investmentWatchlist
        : investmentWatchlist.filter(
            (item) => getWatchItemCategoryId(item) === selectedWatchCategoryId
          ),
    [investmentWatchlist, selectedWatchCategoryId]
  );

  const marketContextSummary = useMemo(() => {
    const overviewSummary = marketOverview?.quotes
      ?.slice(0, 4)
      .map((quote) => {
        const amount = formatMarketAmount(quote.amount);
        const percent = formatMarketPercent(quote.changePercent);
        const value = formatMarketIndexValue(quote.value);
        return `${quote.name} ${value} ${percent} 成交额 ${amount}`;
      })
      .join('；');

    const newsSummary = marketNews
      .slice(0, 3)
      .map((item) => `${formatMarketNewsTime(item.time)} ${item.title}`)
      .join('；');

    return [overviewSummary, newsSummary].filter(Boolean).join('\n');
  }, [marketNews, marketOverview]);

  const hasInvestmentSummary =
    activePositions.length > 0 ||
    positionSummary.totalCurrentValue > 0 ||
    positionSummary.totalInvested > 0;

  useEffect(() => {
    let cancelled = false;

    async function loadMarketOverview() {
      setMarketStatus('loading');
      setMarketError('');

      try {
        const overview = await fetchEastmoneyMarketOverview(selectedMarketSecId);
        if (cancelled) return;
        setMarketOverview(overview);
        setMarketStatus('idle');
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '大盘行情加载失败，请稍后重试。';
        setMarketError(message);
        setMarketStatus('error');
      }
    }

    loadMarketOverview();

    return () => {
      cancelled = true;
    };
  }, [selectedMarketSecId]);

  useEffect(() => {
    let cancelled = false;
    const category = EASTMONEY_MARKET_NEWS_CATEGORIES.find(
      (item) => item.id === selectedNewsCategoryId
    );

    async function loadMarketNews() {
      setMarketNewsStatus('loading');
      setMarketNewsError('');

      try {
        const nextNews = await fetchEastmoneyMarketNews(category?.column);
        if (cancelled) return;
        setMarketNews(nextNews);
        setMarketNewsStatus('idle');
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '快讯加载失败，请稍后重试。';
        setMarketNewsError(message);
        setMarketNewsStatus('error');
      }
    }

    loadMarketNews();

    return () => {
      cancelled = true;
    };
  }, [selectedNewsCategoryId]);


  function setToastState(message: string, variant: ToastVariant = 'success') {
    setToast({ visible: true, message, variant });
  }

  async function refreshMarketOverview() {
    if (marketStatus === 'loading') return;

    setMarketStatus('loading');
    setMarketError('');

    try {
      const overview = await fetchEastmoneyMarketOverview(selectedMarketSecId);
      setMarketOverview(overview);
      setMarketStatus('idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : '大盘行情加载失败，请稍后重试。';
      setMarketError(message);
      setMarketStatus('error');
      setToastState(message, 'warning');
    }
  }

  async function refreshMarketNews() {
    if (marketNewsStatus === 'loading') return;

    const category = EASTMONEY_MARKET_NEWS_CATEGORIES.find(
      (item) => item.id === selectedNewsCategoryId
    );
    setMarketNewsStatus('loading');
    setMarketNewsError('');

    try {
      const nextNews = await fetchEastmoneyMarketNews(category?.column);
      setMarketNews(nextNews);
      setMarketNewsStatus('idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : '快讯加载失败，请稍后重试。';
      setMarketNewsError(message);
      setMarketNewsStatus('error');
      setToastState(message, 'warning');
    }
  }

  function toggleWatchItemDetails(itemId: string) {
    setExpandedWatchItemId((current) => (current === itemId ? null : itemId));
  }

  function handleWatchCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, itemId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleWatchItemDetails(itemId);
  }

  function handleSetWatchItemHoldingShares(item: InvestmentWatchItem) {
    const currentValue =
      typeof item.holdingShares === 'number' && item.holdingShares > 0
        ? String(item.holdingShares)
        : '';
    const nextValue = window.prompt(`请输入 ${item.name} 的持有份额`, currentValue);
    if (nextValue === null) return;

    const cleaned = nextValue.trim();
    const shares = cleaned ? Number(cleaned.replace(/[^\d.-]/g, '')) : undefined;
    if (cleaned && (!Number.isFinite(shares as number) || (shares as number) < 0)) {
      setToastState('请输入有效的持有份额。', 'warning');
      return;
    }

    upsertInvestmentWatchItem({
      ...item,
      holdingShares: shares === undefined ? undefined : Number((shares as number).toFixed(2)),
      updatedAt: new Date().toISOString()
    });
    setToastState(
      shares === undefined
        ? `已清空“${item.name}”的持有份额。`
        : `已更新“${item.name}”持有 ${formatHoldingShares(shares)}。`
    );
  }

  function handleFollowWatchItem(item: InvestmentWatchItem) {
    const nextTags = Array.from(new Set(['关注中', ...(item.tags || [])])).slice(0, 6);
    upsertInvestmentWatchItem({
      ...item,
      tags: nextTags,
      lastVerdict: item.lastVerdict || '已加入关注',
      investmentAdvice: item.investmentAdvice || '先加入关注列表，后续再决定是否加仓。',
      updatedAt: new Date().toISOString()
    });
    setToastState(`已把“${item.name}”加入关注。`);
  }

  async function handleAnalyzeWatchItem(item: InvestmentWatchItem) {
    if (analyzingWatchItemId === item.id) return;

    if (!apiKey.trim()) {
      setToastState('请先在设置中配置可用的 AI Key。', 'warning');
      return;
    }

    setAnalyzingWatchItemId(item.id);

    const userMessage = createInvestmentAiMessage({
      id: `investment-user-${Date.now()}`,
      role: 'user',
      text: `请分析 ${item.name}${item.code ? `（${item.code}）` : ''} 是否该加仓减仓，说明行业、政策影响、重仓产品比例和当前建议。`,
      createdAt: new Date().toISOString()
    });
    const nextMessages = trimInvestmentAiMessages([...investmentAiMessages, userMessage]);
    setInvestmentAiMessages(nextMessages);

    try {
      const webContext = buildWebSearchPrompt(
        await fetchWebSearchContext(
          [item.name, item.code, item.platform, '行业 政策 最新 影响'].filter(Boolean).join(' '),
          webSearch
        )
      );
      let fullContent = '';
      const result = await sendAiChatStream(
        {
          baseUrl,
          apiKey,
          model,
          systemPrompt: buildInvestmentFundAnalysisPrompt({
            watchItem: item,
            positions: activePositions,
            marketContext: marketContextSummary,
            webContext
          }),
          messages: [
            {
              role: 'user',
              text: `请分析 ${item.name}${item.code ? `（${item.code}）` : ''}，重点回答是否加仓、减仓、继续持有，以及行业和政策影响。`
            }
          ]
        },
        {
          onDelta: (delta) => {
            fullContent += delta;
          },
          onDone: (content) => {
            fullContent = content || fullContent;
          }
        }
      );

      const rawContent = result.content || fullContent;
      const { displayText, analysis } = extractInvestmentAnalysis(rawContent);
      const analysisText = summarizeInvestmentAnalysis(displayText, analysis);
      const assistantMessage = createInvestmentAiMessage({
        id: `investment-assistant-${Date.now()}`,
        role: 'assistant',
        text: analysisText || analysis?.summary || rawContent.trim() || '已完成分析。',
        createdAt: new Date().toISOString(),
        analysis
      });
      setInvestmentAiMessages(trimInvestmentAiMessages([...nextMessages, assistantMessage]));

      const normalizedAnalysis = analysis;
      if (normalizedAnalysis) {
        const nextTags = Array.from(
          new Set([...(normalizedAnalysis.watchTags || []), ...(item.tags || [])])
        ).slice(0, 8);

        upsertInvestmentWatchItem({
          ...item,
          tags: nextTags,
          lastVerdict: normalizedAnalysis.verdict || item.lastVerdict || '已完成分析',
          lastSummary: normalizedAnalysis.summary || analysisText || item.lastSummary,
          lastRiskLevel: normalizedAnalysis.riskLevel || item.lastRiskLevel || 'unknown',
          investmentAdvice:
            normalizedAnalysis.verdict || normalizedAnalysis.summary || item.investmentAdvice,
          adviceReasons: normalizedAnalysis.highlights?.length
            ? normalizedAnalysis.highlights
            : item.adviceReasons,
          riskNotes: normalizedAnalysis.risks?.length ? normalizedAnalysis.risks : item.riskNotes,
          nextActions: normalizedAnalysis.actions?.length
            ? normalizedAnalysis.actions
            : item.nextActions,
          fundAnalysis: normalizedAnalysis.fundAnalysis?.length
            ? normalizedAnalysis.fundAnalysis
            : item.fundAnalysis,
          fundHoldings: normalizedAnalysis.fundHoldings?.length
            ? normalizedAnalysis.fundHoldings
            : item.fundHoldings,
          assetAllocation: normalizedAnalysis.assetAllocation?.length
            ? normalizedAnalysis.assetAllocation
            : item.assetAllocation,
          industryAllocation: normalizedAnalysis.industryAllocation?.length
            ? normalizedAnalysis.industryAllocation
            : item.industryAllocation,
          netValue: normalizedAnalysis.netValue || item.netValue,
          addedReturn: normalizedAnalysis.addedReturn || item.addedReturn,
          holdingReturn: normalizedAnalysis.holdingReturn || item.holdingReturn,
          buyFeeRate: normalizedAnalysis.buyFeeRate || item.buyFeeRate,
          fundCompany: normalizedAnalysis.fundCompany || item.fundCompany,
          platform: normalizedAnalysis.platform || item.platform,
          note: normalizedAnalysis.note || item.note,
          lastAnalysisAt: new Date().toISOString()
        });
      }

      setToastState(
        normalizedAnalysis?.verdict || normalizedAnalysis?.summary || '已完成基金分析。'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '基金分析失败，请稍后再试。';
      setToastState(message, 'warning');
    } finally {
      setAnalyzingWatchItemId((current) => (current === item.id ? null : current));
    }
  }

  async function refreshWatchItemSnapshot(item: InvestmentWatchItem) {
    if (!item.code) throw new Error('这只基金没有代码，暂时无法刷新。');

    const snapshot = await fetchEastmoneyFundSnapshot(item.code);
    const estimatedChange = snapshot.estimatedChangePercent
      ? `${Number(snapshot.estimatedChangePercent) >= 0 ? '+' : ''}${snapshot.estimatedChangePercent}%`
      : '';

    upsertInvestmentWatchItem({
      ...item,
      name: snapshot.name || item.name,
      code: snapshot.code || item.code,
      platform: item.platform || '东方财富',
      lastSummary:
        [
          snapshot.netValue ? `单位净值 ${snapshot.netValue}` : '',
          estimatedChange ? `估算涨跌 ${estimatedChange}` : '',
          snapshot.buyFeeRate ? `申购费率 ${snapshot.buyFeeRate}` : ''
        ]
          .filter(Boolean)
          .join(' · ') || item.lastSummary,
      performanceHistory: snapshot.performanceHistory.length
        ? snapshot.performanceHistory
        : item.performanceHistory,
      fundAnalysis: snapshot.fundAnalysis.length ? snapshot.fundAnalysis : item.fundAnalysis,
      fundHoldings: snapshot.fundHoldings.length ? snapshot.fundHoldings : item.fundHoldings,
      assetAllocation: snapshot.assetAllocation.length
        ? snapshot.assetAllocation
        : item.assetAllocation,
      netValue: snapshot.netValue || item.netValue,
      addedReturn: estimatedChange || item.addedReturn,
      buyFeeRate: snapshot.buyFeeRate || item.buyFeeRate,
      lastAnalysisAt: new Date().toISOString()
    });

    return snapshot.name || item.name;
  }

  async function handleRefreshWatchItem(item: InvestmentWatchItem) {
    if (refreshingAllWatchItems || refreshingWatchItemId === item.id) return;

    setRefreshingWatchItemId(item.id);

    try {
      const refreshedName = await refreshWatchItemSnapshot(item);
      setToastState(`已刷新“${refreshedName}”。`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取更新失败，请稍后再试。';
      setToastState(message, 'warning');
    } finally {
      setRefreshingWatchItemId((current) => (current === item.id ? null : current));
    }
  }

  async function handleRefreshAllWatchItems() {
    if (refreshingAllWatchItems || refreshingWatchItemId || investmentWatchlist.length === 0) {
      return;
    }

    setRefreshingAllWatchItems(true);

    try {
      const results = await Promise.allSettled(
        investmentWatchlist.map((item) => refreshWatchItemSnapshot(item))
      );
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      setToastState(
        failedCount > 0
          ? `已刷新 ${successCount} 只，${failedCount} 只未能更新。`
          : `已刷新全部 ${successCount} 只自选基金。`,
        failedCount > 0 ? 'warning' : 'success'
      );
    } finally {
      setRefreshingAllWatchItems(false);
    }
  }

  function handleActionSuggestionClick(item: {
    label: string;
    hint: string;
    to?: string;
    action?: 'open-investment-assistant';
  }) {
    if (item.action === 'open-investment-assistant') {
      try {
        window.sessionStorage.setItem(ASSISTANT_ACTIVE_MODE_STORAGE_KEY, 'investment');
      } catch {
        // ignore storage write errors
      }
      window.dispatchEvent(
        new CustomEvent(ASSISTANT_MODE_CHANGED_EVENT, { detail: { mode: 'investment' } })
      );
      navigate('/assistant');
      return;
    }

    if (item.to) {
      navigate(item.to);
    }
  }

  async function handleFundLookupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fundLookupStatus === 'loading') return;

    const code = fundLookupCode.replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) {
      setFundLookupStatus('error');
      setFundLookupError('请输入 6 位基金代码。');
      return;
    }

    setFundLookupStatus('loading');
    setFundLookupError('');

    try {
      const snapshot = await fetchEastmoneyFundSnapshot(code);
      const existing = investmentWatchlist.find((item) => item.code === snapshot.code);
      const estimatedChange = snapshot.estimatedChangePercent
        ? `${Number(snapshot.estimatedChangePercent) >= 0 ? '+' : ''}${snapshot.estimatedChangePercent}%`
        : '';

      upsertInvestmentWatchItem({
        id: existing?.id,
        name: snapshot.name,
        code: snapshot.code,
        platform: existing?.platform || '东方财富',
        tags: existing?.tags?.length ? existing.tags : ['东方财富'],
        note: snapshot.estimatedAt ? `东方财富更新于 ${snapshot.estimatedAt}` : existing?.note,
        lastVerdict: existing?.lastVerdict || '已接入东方财富资料',
        lastSummary:
          [
            snapshot.netValue ? `单位净值 ${snapshot.netValue}` : '',
            estimatedChange ? `估算涨跌 ${estimatedChange}` : '',
            snapshot.buyFeeRate ? `申购费率 ${snapshot.buyFeeRate}` : ''
          ]
            .filter(Boolean)
            .join(' · ') || existing?.lastSummary,
        lastRiskLevel: existing?.lastRiskLevel || 'unknown',
        investmentAdvice:
          existing?.investmentAdvice || '先加入自选观察，再结合持仓和风险偏好决定。',
        adviceReasons: existing?.adviceReasons || [],
        riskNotes: existing?.riskNotes || [],
        nextActions: existing?.nextActions || [],
        holdingShares: existing?.holdingShares,
        performanceHistory: snapshot.performanceHistory.length
          ? snapshot.performanceHistory
          : existing?.performanceHistory,
        fundAnalysis: snapshot.fundAnalysis.length ? snapshot.fundAnalysis : existing?.fundAnalysis,
        fundHoldings: snapshot.fundHoldings.length
          ? snapshot.fundHoldings
          : existing?.fundHoldings || [],
        assetAllocation: snapshot.assetAllocation.length
          ? snapshot.assetAllocation
          : existing?.assetAllocation || [],
        industryAllocation: existing?.industryAllocation || [],
        netValue: snapshot.netValue || existing?.netValue,
        addedReturn: estimatedChange || existing?.addedReturn,
        holdingReturn: existing?.holdingReturn,
        buyFeeRate: snapshot.buyFeeRate || existing?.buyFeeRate,
        fundCompany: existing?.fundCompany,
        lastAnalysisAt: new Date().toISOString(),
        createdAt: existing?.createdAt,
        updatedAt: existing?.updatedAt
      });

      setFundLookupCode('');
      setFundLookupStatus('idle');
      setToastState(`已从东方财富添加“${snapshot.name}”。`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '基金资料获取失败，请稍后重试。';
      setFundLookupStatus('error');
      setFundLookupError(message);
      setToastState(message, 'warning');
    }
  }

  async function handleReviewWatchlist() {
    if (watchlistReviewStatus === 'loading') return;

    if (investmentWatchlist.length === 0) {
      setToastState('先加入几只自选基金，我再帮你分析排序。', 'warning');
      return;
    }

    if (!apiKey.trim()) {
      setWatchlistReviewStatus('error');
      setWatchlistReviewError('请先在设置中配置可用的 AI Key，再来分析自选基金。');
      setToastState('请先配置可用的 AI Key。', 'warning');
      return;
    }

    setWatchlistReviewStatus('loading');
    setWatchlistReviewError('');

    try {
      let fullContent = '';
      const result = await sendAiChatStream(
        {
          baseUrl,
          apiKey,
          model,
          systemPrompt: buildInvestmentWatchlistReviewPrompt({
            positions: activePositions,
            watchlist: investmentWatchlist,
            monthlyInvestableCash
          }),
          messages: [
            {
              role: 'user',
              text: '请复盘并排序当前所有自选基金，返回可持久化的 JSON。'
            }
          ]
        },
        {
          onDelta: (delta) => {
            fullContent += delta;
          },
          onDone: (content) => {
            fullContent = content || fullContent;
          }
        }
      );

      const reviews = extractInvestmentWatchlistReview(result.content || fullContent);
      const knownReviews = reviews.filter((review) =>
        investmentWatchlist.some((item) => item.id === review.id)
      );

      if (knownReviews.length === 0) {
        throw new Error('AI 没有返回可排序的自选基金结果，请稍后再试。');
      }

      const nextWatchlist = mergeWatchlistReview(investmentWatchlist, knownReviews);
      setInvestmentWatchlist(nextWatchlist);
      setExpandedWatchItemId(nextWatchlist[0]?.id ?? null);
      setWatchlistReviewStatus('idle');
      setToastState(`已分析 ${knownReviews.length} 只自选基金，并按优先级重新排序。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '自选基金分析失败，请稍后再试。';
      setWatchlistReviewStatus('error');
      setWatchlistReviewError(message);
      setToastState(message, 'warning');
    }
  }

  return (
    <div className="page-stack investments-page investments-management-page">
      <section className="investments-management-grid">
        <aside className="investments-management-column investments-support-column">
          <section className="investments-market-news-grid" aria-label="大盘和快讯">
            <MarketOverviewPanel
              overview={marketOverview}
              selectedSecId={selectedMarketSecId}
              status={marketStatus}
              error={marketError}
              onSelect={setSelectedMarketSecId}
              onRefresh={refreshMarketOverview}
              onAskMarket={() =>
                handleActionSuggestionClick({
                  label: '问 AI 怎么看大盘',
                  hint: '带着当前大盘概览去投资助手里继续分析。',
                  action: 'open-investment-assistant'
                })
              }
            />
            <MarketNewsPanel
              news={marketNews}
              selectedCategoryId={selectedNewsCategoryId}
              status={marketNewsStatus}
              error={marketNewsError}
              onSelectCategory={setSelectedNewsCategoryId}
              onRefresh={refreshMarketNews}
            />
          </section>

          <section className="panel investments-hero investments-flat-section investments-support-summary-card">
            <div className="investments-flat-head">
              <div>{!hasInvestmentSummary ? <p>先添加基金代码或第一笔持仓。</p> : null}</div>
              <span className="badge">{activePositions.length} 笔持仓</span>
            </div>

            {hasInvestmentSummary ? (
              <>
                <div className="investments-flat-summary" aria-label="投资资产总览">
                  <article className="investments-flat-metric is-primary">
                    <span>总市值</span>
                    <strong>{formatCurrencyAuto(positionSummary.totalCurrentValue)}</strong>
                  </article>
                  <article
                    className={`investments-flat-metric is-primary ${
                      positionSummary.totalProfit >= 0 ? 'is-positive' : 'is-negative'
                    }`}
                  >
                    <span>浮动收益</span>
                    <strong>
                      {formatCurrencyAuto(positionSummary.totalProfit)} /{' '}
                      {(positionSummary.profitRate * 100).toFixed(1)}%
                    </strong>
                  </article>
                  <article className="investments-flat-metric is-primary">
                    <span>本月可投</span>
                    <strong>{formatCurrencyAuto(monthlyInvestableCash)}</strong>
                  </article>
                </div>

                <div className="investments-flat-mini-grid investments-flat-mini-grid-compact">
                  <span>
                    <em>本金</em>
                    <strong>{formatCurrencyAuto(positionSummary.totalInvested)}</strong>
                  </span>
                  <span>
                    <em>净资产占比</em>
                    <strong>{(investmentAssetRatio * 100).toFixed(1)}%</strong>
                  </span>
                </div>
              </>
            ) : (
              <div className="investments-watchlist-empty investments-summary-empty">
                <strong>先录一笔，再看总览</strong>
                <p>基金代码和持仓都能接进来，录入后这里才会展开成配置总览。</p>
              </div>
            )}

            <div className="investments-flat-actions">
              <button
                type="button"
                className="button-with-icon primary"
                onClick={() => navigate('/investments/flow')}
              >
                <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                投资风向
              </button>
            </div>
          </section>

          <aside
            className="panel investments-watchlist-panel"
            data-investment-support-title="基金自选"
          >
            <div className="investments-section-head investments-watchlist-head">
              <div>
                <h3>基金自选</h3>
              </div>
              <div className="investments-watchlist-actions">
                <span className="badge">{investmentWatchlist.length} 只</span>
                <button
                  type="button"
                  className={`investments-watchlist-refresh-all-btn ${refreshingAllWatchItems ? 'is-loading' : ''}`}
                  onClick={() => void handleRefreshAllWatchItems()}
                  disabled={
                    refreshingAllWatchItems ||
                    refreshingWatchItemId !== null ||
                    investmentWatchlist.length === 0
                  }
                  aria-label="刷新全部自选基金资料"
                  title="刷新全部自选基金资料"
                >
                  <img src={ROTATE_CCW_ICON_URL} alt="" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="primary button-with-icon investments-watchlist-review-btn"
                  onClick={handleReviewWatchlist}
                  disabled={watchlistReviewStatus === 'loading' || investmentWatchlist.length === 0}
                >
                  <img src={BRAIN_ICON_URL} alt="" aria-hidden="true" />
                  {watchlistReviewStatus === 'loading' ? '分析中' : 'AI 排序'}
                </button>
                <button
                  type="button"
                  className="button-with-icon investments-watchlist-flow-btn"
                  onClick={() => navigate('/investments/flow')}
                >
                  <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                  投资风向
                </button>
              </div>
            </div>

            {watchlistReviewError ? (
              <p className="investments-watchlist-review-error">{watchlistReviewError}</p>
            ) : null}

            <form className="investments-fund-lookup" onSubmit={handleFundLookupSubmit}>
              <label htmlFor="investment-fund-code">添加基金代码</label>
              <div className="investments-fund-lookup-row">
                <input
                  id="investment-fund-code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={fundLookupCode}
                  placeholder="例如 161725"
                  onChange={(event) => {
                    setFundLookupCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                    if (fundLookupError) setFundLookupError('');
                    if (fundLookupStatus === 'error') setFundLookupStatus('idle');
                  }}
                  disabled={fundLookupStatus === 'loading'}
                />
                <button
                  type="submit"
                  className="button-with-icon primary"
                  disabled={fundLookupStatus === 'loading' || fundLookupCode.length < 6}
                >
                  <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                  {fundLookupStatus === 'loading' ? '获取中' : '获取资料'}
                </button>
              </div>
              <p className={fundLookupError ? 'investments-fund-lookup-error' : ''}>
                {fundLookupError ||
                  '从东方财富读取净值、估算涨跌、费率和近期表现，添加到自选基金。'}
              </p>
            </form>

            {investmentWatchlist.length === 0 ? (
              <div className="investments-watchlist-empty">
                <strong>还没有自选基金</strong>
                <p>分析后觉得值得跟踪，就加入这里。</p>
              </div>
            ) : (
              <>
                <div className="investments-watchlist-tools">
                  <div className="investments-watch-category-tabs" aria-label="自选基金分类">
                    {WATCH_CATEGORY_FILTERS.map((category) => {
                      const count = watchCategoryCounts[category.id];
                      const isActive = selectedWatchCategoryId === category.id;

                      return (
                        <button
                          key={category.id}
                          type="button"
                          className={isActive ? 'is-active' : ''}
                          onClick={() => setSelectedWatchCategoryId(category.id)}
                          disabled={count === 0 && category.id !== 'all'}
                          aria-pressed={isActive}
                        >
                          <span>{category.mark}</span>
                          <strong>{category.label}</strong>
                          <em>{count}</em>
                        </button>
                      );
                    })}
                  </div>
                  <div className="investments-watch-grid-controls" aria-label="每行卡片数量">
                    <span>每行</span>
                    {WATCH_GRID_COLUMN_OPTIONS.map((count) => (
                      <button
                        key={count}
                        type="button"
                        className={watchGridColumns === count ? 'is-active' : ''}
                        onClick={() => setWatchGridColumns(count)}
                        aria-pressed={watchGridColumns === count}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredInvestmentWatchlist.length === 0 ? (
                  <div className="investments-watchlist-empty investments-watchlist-filter-empty">
                    <strong>当前分类没有自选基金</strong>
                    <p>切换到其他分类，或用基金代码添加一只新的。</p>
                  </div>
                ) : (
                  <div className={`investments-watchlist-list is-columns-${watchGridColumns}`}>
                    {filteredInvestmentWatchlist.map((item) => {
                      const isExpanded = expandedWatchItemId === item.id;
                      const detailSections = compactWatchDetailSections(item);
                      const performanceSection = detailSections.find(
                        (section) => section.title === '历史业绩'
                      );
                      const otherDetailSections = detailSections.filter(
                        (section) => section.title !== '历史业绩'
                      );
                      const primaryTag = item.tags[0];
                      const holdingsPreview = item.fundHoldings?.slice(0, 3) || [];
                      const assetAllocationPreview = item.assetAllocation?.slice(0, 3) || [];
                      const performancePoints = parseWatchPerformancePoints(
                        performanceSection?.items || []
                      );
                      const maxPositivePerformance = Math.max(
                        ...performancePoints.map((point) => Math.max(point.value, 0)),
                        0
                      );
                      const maxNegativePerformance = Math.max(
                        ...performancePoints.map((point) => Math.max(-point.value, 0)),
                        0
                      );
                      const performanceZeroPosition =
                        maxPositivePerformance > 0 && maxNegativePerformance > 0
                          ? (maxPositivePerformance /
                              (maxPositivePerformance + maxNegativePerformance)) *
                            100
                          : maxPositivePerformance > 0
                            ? 94
                            : 6;
                      const watchCategory =
                        WATCH_CATEGORY_FILTERS.find(
                          (category) => category.id === getWatchItemCategoryId(item)
                        ) || WATCH_CATEGORY_FILTERS[WATCH_CATEGORY_FILTERS.length - 1];
                      const isRefreshing =
                        refreshingAllWatchItems || refreshingWatchItemId === item.id;
                      const isFollowing = item.tags.includes('关注中');

                      return (
                        <article
                          key={item.id}
                          className={`investments-watch-card ${isExpanded ? 'is-expanded' : ''}`}
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onClick={() => toggleWatchItemDetails(item.id)}
                          onKeyDown={(event) => handleWatchCardKeyDown(event, item.id)}
                        >
                          <div className="investments-watch-card-head">
                            <div>
                              <strong>{item.name}</strong>
                              <p>
                                {item.code || '未记录代码'}
                                {item.platform ? ` · ${item.platform}` : ''}
                              </p>
                            </div>
                            <div className="investments-watch-card-actions">
                              <span className="investments-watch-card-category">
                                {watchCategory.label}
                              </span>
                              {item.lastRiskLevel ? (
                                <span
                                  className={`investments-analysis-risk ${getAnalysisRiskClass(
                                    item.lastRiskLevel
                                  )}`}
                                >
                                  {getAnalysisRiskLabel(item.lastRiskLevel)}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="danger investments-watch-card-remove"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeInvestmentWatchItem(item.id);
                                }}
                                aria-label={`移除 ${item.name}`}
                              >
                                移除
                              </button>
                            </div>
                          </div>
                          <div className="investments-watch-card-brief">
                            <strong>
                              {item.investmentAdvice || item.lastVerdict || '等待下一次分析'}
                            </strong>
                            {primaryTag ? <span className="badge">{primaryTag}</span> : null}
                          </div>
                          {item.lastSummary ? (
                            <p className="investments-watch-card-summary">{item.lastSummary}</p>
                          ) : null}
                          <div
                            className="investments-watch-card-mini-stats"
                            aria-label="基金关键数据"
                          >
                            <span>
                              <em>净值</em>
                              <strong>{item.netValue || '待更新'}</strong>
                            </span>
                            <span>
                              <em>收益</em>
                              <strong>{item.addedReturn || '待更新'}</strong>
                            </span>
                            <span>
                              <em>持有</em>
                              <button
                                type="button"
                                className={`investments-watch-holding-btn ${
                                  item.holdingShares ? 'has-value' : 'is-empty'
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleSetWatchItemHoldingShares(item);
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleSetWatchItemHoldingShares(item);
                                }}
                                title="右键或点击设置持有份额"
                              >
                                {formatHoldingShares(item.holdingShares) || '待获取'}
                              </button>
                            </span>
                          </div>
                          <div className="investments-watch-card-split-grid">
                            <article className="investments-watch-card-split is-holdings">
                              <span>重仓</span>
                              {holdingsPreview.length > 0 ? (
                                <div
                                  className="investments-watch-chip-list"
                                  aria-label="基金重仓股票"
                                >
                                  {holdingsPreview.map((value) => {
                                    const displayValue = formatWatchPreviewItem(value);
                                    return (
                                      <strong
                                        key={`${item.id}-holding-${value}`}
                                        title={displayValue}
                                      >
                                        {displayValue}
                                      </strong>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p>待更新</p>
                              )}
                            </article>
                            <article className="investments-watch-card-split is-assets">
                              <span>资产</span>
                              {assetAllocationPreview.length > 0 ? (
                                <div
                                  className="investments-watch-chip-list"
                                  aria-label="基金资产分布"
                                >
                                  {assetAllocationPreview.map((value) => {
                                    const displayValue = formatWatchPreviewItem(value);
                                    return (
                                      <strong
                                        key={`${item.id}-asset-${value}`}
                                        title={displayValue}
                                      >
                                        {displayValue}
                                      </strong>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p>待更新</p>
                              )}
                            </article>
                          </div>
                          <div className="investments-watch-card-ai-actions">
                            <button
                              type="button"
                              className={`investments-watch-analyze-btn ${
                                analyzingWatchItemId === item.id ? 'is-loading' : ''
                              }`}
                              disabled={analyzingWatchItemId === item.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleAnalyzeWatchItem(item);
                              }}
                              aria-label={`AI 分析 ${item.name}`}
                              title="AI 分析"
                            >
                              <img src={BRAIN_ICON_URL} alt="" aria-hidden="true" />
                              {analyzingWatchItemId === item.id ? '分析中' : 'AI 分析'}
                            </button>
                            {!isFollowing ? (
                              <button
                                type="button"
                                className="investments-watch-follow-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleFollowWatchItem(item);
                                }}
                              >
                                添加关注
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={`investments-watch-refresh-btn ${isRefreshing ? 'is-loading' : ''}`}
                              aria-label={`刷新 ${item.name} 基金资料`}
                              title="刷新基金资料"
                              disabled={isRefreshing}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRefreshWatchItem(item);
                              }}
                            >
                              <img src={ROTATE_CCW_ICON_URL} alt="" aria-hidden="true" />
                            </button>
                          </div>
                          <div className="investments-watch-card-meta">
                            <span>
                              {item.lastAnalysisAt
                                ? `更新于 ${formatDateTimeLabel(item.lastAnalysisAt)}`
                                : '暂未分析'}
                            </span>
                          </div>

                          {isExpanded ? (
                            <div className="investments-watch-card-details">
                              {detailSections.length > 0 ? (
                                <>
                                  {performanceSection && performancePoints.length > 0 ? (
                                    <section className="investments-watch-performance-panel">
                                      <div className="investments-watch-detail-head">
                                        <span>{performanceSection.title}</span>
                                        <small>最近四个区间的表现</small>
                                      </div>
                                      <div
                                        className="investments-watch-performance-chart"
                                        role="list"
                                        aria-label="历史业绩图表"
                                      >
                                        {performancePoints.map((point, index) => {
                                          const isPositive = point.value >= 0;
                                          const scaleMax = isPositive
                                            ? maxPositivePerformance
                                            : maxNegativePerformance;
                                          const availableHeight = isPositive
                                            ? performanceZeroPosition
                                            : 100 - performanceZeroPosition;
                                          const height =
                                            point.value === 0 || scaleMax === 0
                                              ? 0
                                              : Math.max(
                                                  6,
                                                  (Math.abs(point.value) / scaleMax) *
                                                    availableHeight
                                                );

                                          return (
                                            <div
                                              key={`${item.id}-performance-${point.label}-${index}`}
                                              className={`investments-watch-performance-bar ${
                                                point.value >= 0 ? 'is-positive' : 'is-negative'
                                              }`}
                                              role="listitem"
                                              title={`${point.label} ${point.caption}`}
                                            >
                                              <span className="investments-watch-performance-track">
                                                <span
                                                  className="investments-watch-performance-zero"
                                                  style={{ top: `${performanceZeroPosition}%` }}
                                                  aria-hidden="true"
                                                />
                                                <i
                                                  style={{
                                                    height: `${height}%`,
                                                    ...(isPositive
                                                      ? {
                                                          bottom: `${100 - performanceZeroPosition}%`
                                                        }
                                                      : { top: `${performanceZeroPosition}%` })
                                                  }}
                                                />
                                              </span>
                                              <strong>{point.label}</strong>
                                              <em>{point.caption}</em>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </section>
                                  ) : null}

                                  <div className="investments-watch-detail-grid">
                                    {otherDetailSections.map((section) => (
                                      <section
                                        key={`${item.id}-${section.title}`}
                                        className={`investments-watch-detail-card ${getWatchSectionClassName(
                                          section.kind
                                        )}`}
                                      >
                                        <div className="investments-watch-detail-head">
                                          <span>{section.title}</span>
                                          {section.kind === 'chips' ? (
                                            <small>精选摘要</small>
                                          ) : null}
                                        </div>
                                        {section.kind === 'chips' ? (
                                          <div className="investments-watch-chip-list">
                                            {section.items.map((value) => (
                                              <strong
                                                key={`${item.id}-${section.title}-${value}`}
                                                title={value}
                                              >
                                                {value}
                                              </strong>
                                            ))}
                                          </div>
                                        ) : section.kind === 'stat' ? (
                                          <strong className="investments-watch-detail-stat">
                                            {section.items[0]}
                                          </strong>
                                        ) : (
                                          <div className="investments-watch-detail-copy">
                                            {section.items.map((value) => (
                                              <p key={`${item.id}-${section.title}-${value}`}>
                                                {value}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                      </section>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <p className="investments-watch-card-empty-detail">
                                  暂无更多资料。
                                </p>
                              )}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </aside>

            <section className="panel investments-quick-chat-panel" data-investment-support-title="快捷问答">
              <div className="investments-section-head investments-quick-chat-head">
                <div>
                  <h3>快捷问答</h3>
                </div>
                <span className="badge">联网</span>
              </div>
              <InvestmentChatPanel
                showHero={false}
                defaultWebEnabled
                contextNote={marketContextSummary}
              />
            </section>
        </aside>
      </section>



      <Toast
        visible={toast.visible}
        message={toast.message}
        variant={toast.variant}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

    </div>
  );
}
