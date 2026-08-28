import {
  type CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  InvestmentCategory,
  InvestmentFundAnalysis,
  InvestmentPosition,
  InvestmentWatchItem
} from '../../entities/investment/types';
import { sendAiChatStream } from '../../features/assistant/api/openaiCompatibleClient';
import { InvestmentChatPanel } from '../../features/assistant/investment-chat/InvestmentChatPanel';
import {
  fetchEastmoneyFundSnapshot,
  fetchEastmoneyHoldingStockQuotes,
  type EastmoneyHoldingStockQuote
} from '../../features/investments/api/eastmoneyFundClient';
import {
  EASTMONEY_MARKET_INDEXES,
  EASTMONEY_MARKET_NEWS_CATEGORIES,
  EASTMONEY_MARKET_THEMES,
  GLOBAL_MARKET_INDEXES,
  fetchEastmoneyMarketBoards,
  fetchEastmoneyMarketBoardConstituents,
  fetchEastmoneyIndexHistory,
  fetchEastmoneyMarketOverview,
  fetchEastmoneyMarketNews,
  fetchEastmoneyStockSearch,
  fetchEastmoneyMarketThemeBoards,
  fetchGlobalMarketHistory,
  fetchGlobalMarketOverview,
  fetchGlobalMarketTrend,
  type EastmoneyMarketBoard,
  type EastmoneyMarketConstituent,
  type EastmoneyMarketHistoryPoint,
  type EastmoneyMarketHistoryRange,
  type EastmoneyMarketOverview,
  type EastmoneyMarketNewsItem,
  type EastmoneyMarketQuote,
  type EastmoneyStockSearchResult,
  type EastmoneyMarketTheme,
  type EastmoneyMarketTrendPoint,
  type GlobalMarketHistoryPoint,
  type GlobalMarketTrendPoint,
  type GlobalMarketQuote
} from '../../features/investments/api/eastmoneyMarketClient';
import {
  simulateInvestmentPlan,
  type InvestmentSimulationFrequency,
  type InvestmentSimulationResult
} from '../../features/investments/model/investmentSimulator';
import {
  INFO_ICON_URL,
  ROTATE_CCW_ICON_URL
} from '../../shared/config/brandAssets';
import { formatCurrencyAuto } from '../../shared/lib/format';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { Toast, type ToastVariant } from '../../shared/ui/Toast';
import {
  buildInvestmentMarketInsightPrompt,
  extractInvestmentMarketInsight,
  type InvestmentMarketInsight
} from './investmentAi';
import { buildTimeContext } from '../../features/assistant/workbench/workbenchUtils';

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
  | 'stock'
  | 'index-fund'
  | 'active-fund'
  | 'fixed-income'
  | 'cash'
  | 'other';

const WATCH_CATEGORY_FILTERS: Array<{ id: WatchCategoryFilterId; label: string; mark: string }> = [
  { id: 'all', label: '全部', mark: '全' },
  { id: 'stock', label: '个股', mark: '股' },
  { id: 'index-fund', label: '指数', mark: '指' },
  { id: 'active-fund', label: '主动', mark: '主' },
  { id: 'fixed-income', label: '债券', mark: '债' },
  { id: 'cash', label: '货币', mark: '货' },
  { id: 'other', label: '其他', mark: '其' }
];

const WATCH_GRID_COLUMN_OPTIONS = [1, 2, 3] as const;
const MARKET_THEME_STORAGE_KEY = 'ledgerflow-investment-market-themes-v1';

type WatchGridColumnCount = (typeof WATCH_GRID_COLUMN_OPTIONS)[number];
type WatchDisplayMode = 'grid' | 'list';
type InvestmentWorkspace = 'overview' | 'market' | 'boards' | 'watchlist' | 'news';

function normalizeTrackedMarketThemes(value: unknown): EastmoneyMarketTheme[] {
  if (!Array.isArray(value)) return EASTMONEY_MARKET_THEMES;
  const themes = value
    .map((item) => {
      const source = item as Partial<EastmoneyMarketTheme>;
      const code = String(source?.code || '')
        .trim()
        .toUpperCase();
      const name = String(source?.name || '').trim();
      return /^BK\d{4}$/.test(code) && name ? { code, name } : null;
    })
    .filter((item): item is EastmoneyMarketTheme => Boolean(item));
  return Array.from(new Map(themes.map((item) => [item.code, item])).values()).slice(0, 16);
}

function readTrackedMarketThemes() {
  try {
    const stored = localStorage.getItem(MARKET_THEME_STORAGE_KEY);
    if (!stored) return EASTMONEY_MARKET_THEMES;
    return normalizeTrackedMarketThemes(JSON.parse(stored));
  } catch {
    return EASTMONEY_MARKET_THEMES;
  }
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

type GlobalMarketTrendChartPoint = GlobalMarketTrendPoint & {
  x: number;
  y: number;
  index: number;
};

type GlobalKlineChartPoint = {
  label: string;
  value: number;
  x: number;
  openY: number;
  highY: number;
  lowY: number;
  closeY: number;
  tone: 'is-positive' | 'is-negative' | 'is-flat';
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

function WatchPerformanceLineChart({ points }: { points: WatchPerformancePoint[] }) {
  const width = 420;
  const height = 150;
  const paddingX = 18;
  const paddingTop = 16;
  const paddingBottom = 24;
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const spread = Math.max(max - min, 0.01);
  const plotHeight = height - paddingTop - paddingBottom;
  const plotWidth = width - paddingX * 2;
  const coords = points.map((point, index) => ({
    ...point,
    x: paddingX + (index / Math.max(points.length - 1, 1)) * plotWidth,
    y: paddingTop + (1 - (point.value - min) / spread) * plotHeight
  }));
  const zeroY = paddingTop + (1 - (0 - min) / spread) * plotHeight;
  const linePath = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const areaPath = linePath
    ? `${linePath} L ${coords[coords.length - 1].x} ${zeroY} L ${coords[0].x} ${zeroY} Z`
    : '';

  return (
    <div className="investments-watch-performance-line">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="历史业绩走线图">
        <line
          className="investments-watch-performance-zero-line"
          x1={paddingX}
          x2={width - paddingX}
          y1={zeroY}
          y2={zeroY}
        />
        <path className="investments-watch-performance-area" d={areaPath} />
        <path className="investments-watch-performance-line-path" d={linePath} />
        {coords.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text x={point.x} y={height - 6} textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="investments-watch-performance-values" aria-label="历史业绩数值">
        {points.map((point, index) => (
          <span
            className={point.value >= 0 ? 'is-positive' : 'is-negative'}
            key={`${point.label}-${index}`}
          >
            <strong>{point.label}</strong>
            <em>{point.caption}</em>
          </span>
        ))}
      </div>
    </div>
  );
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

function getFundHoldingStockCode(value: string) {
  const match = String(value || '').match(/(?:\(|（)?(\d{6})(?:\)|）)?/);
  return match?.[1] || '';
}

function formatFundHoldingStockName(value: string, quote?: EastmoneyHoldingStockQuote) {
  const original = formatWatchPreviewItem(value);
  const code = getFundHoldingStockCode(original);
  const withoutCode = original
    .replace(new RegExp(`[（(]?${code || '\\d{6}'}[）)]?`), '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!quote?.name) return withoutCode || original;
  if (!withoutCode || withoutCode === quote.name) return quote.name;
  if (withoutCode.startsWith(quote.name)) return withoutCode;
  return `${quote.name} ${withoutCode}`.trim();
}

function getFundHoldingStockSecId(code: string) {
  if (!/^\d{6}$/.test(code)) return '';
  return /^(600|601|603|605|688|689|900)/.test(code) ? `1.${code}` : `0.${code}`;
}

function formatHoldingStockChange(value?: number | null) {
  if (typeof value !== 'number') return '--';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function WatchHoldingQuoteList({
  holdings,
  quotesByCode
}: {
  holdings: string[];
  quotesByCode: Map<string, EastmoneyHoldingStockQuote>;
}) {
  return (
    <div className="investments-watch-holding-quote-list" aria-label="基金持仓实时涨跌">
      {holdings.map((value) => {
        const stockCode = getFundHoldingStockCode(value);
        const quote = stockCode ? quotesByCode.get(stockCode) : undefined;
        const displayValue = formatFundHoldingStockName(value, quote);
        const changePercent = quote?.changePercent ?? null;
        const changeClass =
          changePercent === null
            ? 'is-unavailable'
            : changePercent > 0
              ? 'is-positive'
              : changePercent < 0
                ? 'is-negative'
                : 'is-flat';

        return (
          <span key={`${stockCode || value}-${value}`} title={displayValue}>
            <strong>{displayValue}</strong>
            <em className={changeClass}>{formatHoldingStockChange(changePercent)}</em>
          </span>
        );
      })}
    </div>
  );
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

function isPolicySignalText(value: string) {
  return /政策|监管|国务院|证监|央行|财政|税务|发改|工信|降准|降息|印花税|利率|补贴|新规|支持|刺激|稳增长|房地产|地产|集采|国产替代/.test(
    value
  );
}

function getMarketTone(value?: number | null) {
  if (typeof value !== 'number') return 'is-flat';
  if (value > 0) return 'is-positive';
  if (value < 0) return 'is-negative';
  return 'is-flat';
}

function getAverageMarketChange(overview: EastmoneyMarketOverview | null) {
  const changes = (overview?.quotes || [])
    .map((quote) => quote.changePercent)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (!changes.length) return null;
  return changes.reduce((sum, value) => sum + value, 0) / changes.length;
}

function getMovementEmoji(value?: number | null) {
  if (typeof value !== 'number') return '😐';
  if (value >= 0.5) return '🔥';
  if (value <= -0.5) return '💧';
  return '😐';
}

function getPlainMarketLine(change?: number | null) {
  if (typeof change !== 'number') return '行情还在加载，先别急着下结论。';
  if (change >= 1) return '大盘今天挺有劲，热闹归热闹，别一上头就追。';
  if (change >= 0.25) return '大盘慢慢回暖，今天不是硬扛的一天。';
  if (change <= -1) return '大盘又被砸了，先把节奏稳住比急着补仓更重要。';
  if (change <= -0.25) return '市场有点泄气，今天更适合看，不适合冲动操作。';
  return '大盘还在犹豫，今天先看自己持仓，不用被每一根波动带着走。';
}

function getBoardHealth(change?: number | null) {
  if (typeof change !== 'number') {
    return { emoji: '⚪', label: '数据等待中', className: 'is-neutral' };
  }
  if (change >= 1) return { emoji: '🟢', label: '偏强，别追高', className: 'is-green' };
  if (change <= -1) return { emoji: '🔴', label: '偏弱，先等等', className: 'is-red' };
  return { emoji: '🟡', label: '观望一下', className: 'is-yellow' };
}

type RuleSuggestion = {
  tone: 'positive' | 'warning' | 'neutral';
  emoji: string;
  title: string;
  reason: string;
};

type MarketAlgorithmSignals = {
  score: number;
  riskScore: number;
  regime: string;
  breadth: string;
  strongestTheme: string;
  weakestTheme: string;
  newsSignal: string;
  concentration: string;
  formula: string;
};

type WatchHoldingSnapshot = {
  id: string;
  name: string;
  category: string;
  shares: number;
  currentValue: number;
  marketChange: number | null;
  estimatedTodayProfit: number | null;
};

type MarketInsightStatus = 'disabled' | 'waiting' | 'loading' | 'ready' | 'error';

function parseStoredPercent(value?: string) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getWatchHoldingSnapshot(item: InvestmentWatchItem): WatchHoldingSnapshot | null {
  if (typeof item.holdingShares !== 'number' || item.holdingShares <= 0) return null;
  const netValue = Number(String(item.netValue || '').replace(/,/g, ''));
  if (!Number.isFinite(netValue) || netValue <= 0) return null;

  const currentValue = Number((item.holdingShares * netValue).toFixed(2));
  const marketChange = parseStoredPercent(item.addedReturn);
  return {
    id: `watch-${item.id}`,
    name: item.name,
    category: item.tags?.[0] || '基金自选',
    shares: item.holdingShares,
    currentValue,
    marketChange,
    estimatedTodayProfit:
      marketChange === null ? null : Number(((currentValue * marketChange) / 100).toFixed(2))
  };
}

function rankWatchHoldingsByTodayChange(holdings: WatchHoldingSnapshot[]) {
  return [...holdings]
    .sort((a, b) => {
      if (a.marketChange === null && b.marketChange === null) return 0;
      if (a.marketChange === null) return 1;
      if (b.marketChange === null) return -1;
      return b.marketChange - a.marketChange || b.currentValue - a.currentValue;
    })
    .map((holding, index) => ({
      ...holding,
      todayRank: holding.marketChange === null ? null : index + 1
    }));
}

function clampSignal(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function buildMarketAlgorithmSignals({
  marketChange,
  themeBoards,
  industryBoards,
  news,
  positions,
  watchlist,
  totalCurrentValue
}: {
  marketChange: number | null;
  themeBoards: EastmoneyMarketBoard[];
  industryBoards: EastmoneyMarketBoard[];
  news: EastmoneyMarketNewsItem[];
  positions: InvestmentPosition[];
  watchlist: InvestmentWatchItem[];
  totalCurrentValue: number;
}): MarketAlgorithmSignals {
  const boards = [...themeBoards, ...industryBoards].filter(
    (item) => typeof item.changePercent === 'number' && Number.isFinite(item.changePercent)
  );
  const upBoards = boards.filter((item) => (item.changePercent || 0) > 0).length;
  const downBoards = boards.filter((item) => (item.changePercent || 0) < 0).length;
  const boardCount = boards.length || 1;
  const breadthScore = ((upBoards - downBoards) / boardCount) * 100;
  const averageBoardChange = boards.length
    ? boards.reduce((sum, item) => sum + (item.changePercent || 0), 0) / boards.length
    : 0;
  const indexScore = (marketChange || 0) * 22;
  const momentumScore = clampSignal(
    indexScore * 0.45 + breadthScore * 0.35 + averageBoardChange * 12 * 0.2
  );

  const newsText = news
    .slice(0, 12)
    .map((item) => `${item.title} ${item.summary}`)
    .join(' ');
  const positiveNewsCount = (
    newsText.match(/利好|增长|回暖|突破|支持|订单|创新|扩产|降息|降准/g) || []
  ).length;
  const negativeNewsCount = (
    newsText.match(/风险|下滑|承压|处罚|监管|冲突|亏损|下跌|减持|加息/g) || []
  ).length;
  const newsScore = clampSignal((positiveNewsCount - negativeNewsCount) * 12, -30, 30);

  const strongest = [...boards].sort(
    (a, b) =>
      (b.changePercent || Number.NEGATIVE_INFINITY) - (a.changePercent || Number.NEGATIVE_INFINITY)
  )[0];
  const weakest = [...boards].sort(
    (a, b) =>
      (a.changePercent || Number.POSITIVE_INFINITY) - (b.changePercent || Number.POSITIVE_INFINITY)
  )[0];
  const watchHoldingValue = watchlist.reduce((sum, item) => {
    const snapshot = getWatchHoldingSnapshot(item);
    return sum + (snapshot?.currentValue || 0);
  }, 0);
  const portfolioValue = totalCurrentValue + watchHoldingValue;
  const largestPositionShare = portfolioValue
    ? Math.max(
        ...positions.map((item) => item.currentValue),
        ...watchlist.map((item) => getWatchHoldingSnapshot(item)?.currentValue || 0),
        0
      ) / portfolioValue
    : 0;
  const volatilityScore = Math.min(
    40,
    Math.abs(marketChange || 0) * 18 + Math.abs(averageBoardChange) * 8
  );
  const score = Math.round(
    clampSignal(momentumScore * 0.58 + newsScore * 0.22 - volatilityScore * 0.2)
  );
  const riskScore = Math.round(
    clampSignal(50 - score * 0.35 + volatilityScore * 0.65 + largestPositionShare * 25, 0, 100)
  );

  return {
    score,
    riskScore,
    regime:
      score >= 35 ? '偏强但需防追高' : score <= -35 ? '偏弱，优先控风险' : '震荡分化，精选板块',
    breadth: boards.length
      ? `上涨 ${upBoards} / 下跌 ${downBoards} / 样本 ${boards.length}`
      : '板块数据不足',
    strongestTheme: strongest
      ? `${strongest.name} ${formatMarketPercent(strongest.changePercent)}`
      : '暂无强势板块',
    weakestTheme: weakest
      ? `${weakest.name} ${formatMarketPercent(weakest.changePercent)}`
      : '暂无弱势板块',
    newsSignal:
      positiveNewsCount || negativeNewsCount
        ? `利好词 ${positiveNewsCount} / 风险词 ${negativeNewsCount}`
        : '新闻信号不足',
    concentration: `${(largestPositionShare * 100).toFixed(0)}% 最大仓位占比`,
    formula:
      '综合分 = 指数动量×45% + 板块广度×35% + 板块均值×20%；再叠加新闻信号、波动率和集中度计算风险分。'
  };
}

function buildRuleSuggestions({
  positions,
  marketChange,
  monthlyInvestableCash,
  algorithmSignals
}: {
  positions: InvestmentPosition[];
  marketChange: number | null;
  monthlyInvestableCash: number;
  algorithmSignals?: MarketAlgorithmSignals;
}): RuleSuggestion[] {
  const weakestPosition = positions
    .map((item) => ({
      item,
      profitRate:
        item.investedAmount > 0
          ? (item.currentValue - item.investedAmount) / item.investedAmount
          : 0
    }))
    .sort((a, b) => a.profitRate - b.profitRate)[0];

  if (marketChange !== null && marketChange <= -1) {
    return [
      {
        tone: 'warning',
        emoji: '⚠️',
        title: '今天先别急着补仓',
        reason: `依据：主要指数平均 ${formatMarketPercent(marketChange)}，市场正在回撤。`
      },
      {
        tone: 'neutral',
        emoji: '🧭',
        title: '把可投资金先留在手里',
        reason:
          monthlyInvestableCash > 0
            ? `依据：${algorithmSignals?.breadth || '市场'}；本月可投 ${formatCurrencyAuto(monthlyInvestableCash)}，分批比一次性投入更从容。`
            : '依据：本月没有额外可投资金，先观察已有仓位。'
      }
    ];
  }

  if (marketChange !== null && marketChange >= 1) {
    return [
      {
        tone: 'warning',
        emoji: '🛑',
        title: '今天涨得快，先别追',
        reason: `依据：主要指数平均 ${formatMarketPercent(marketChange)}，上涨时更要控制节奏。`
      },
      {
        tone: 'neutral',
        emoji: '🔎',
        title: '重点看已有基金有没有跟上',
        reason: `依据：${algorithmSignals?.strongestTheme || '先比较自己的浮盈和板块强弱'}，再决定是否调整。`
      }
    ];
  }

  if (weakestPosition && weakestPosition.profitRate <= -0.08) {
    return [
      {
        tone: 'warning',
        emoji: '⏳',
        title: `${weakestPosition.item.name} 先等等`,
        reason: `依据：当前浮盈浮亏 ${(weakestPosition.profitRate * 100).toFixed(1)}%，先确认行情是否企稳。`
      },
      {
        tone: 'neutral',
        emoji: '🧭',
        title: '今天以观察为主',
        reason: '依据：大盘方向不明确，先把计划写清楚比临盘操作更重要。'
      }
    ];
  }

  return [
    {
      tone: 'positive',
      emoji: '✅',
      title: '今天可以按原计划定投',
      reason: `依据：${algorithmSignals?.regime || '大盘波动不大'}；未触发追涨或急跌的暂停规则。`
    },
    {
      tone: 'neutral',
      emoji: '🧩',
      title: algorithmSignals?.strongestTheme
        ? `重点观察 ${algorithmSignals.strongestTheme.split(' ')[0]}`
        : '不要临时加码',
      reason: algorithmSignals
        ? `依据：${algorithmSignals.strongestTheme}；${algorithmSignals.newsSignal}，先确认热点持续性。`
        : '依据：定投按节奏走，单日行情不决定长期计划。'
    }
  ];
}

function HoldingsTodayPanel({
  positions,
  watchlist,
  totalCurrentValue,
  totalProfit,
  profitRate,
  marketChange
}: {
  positions: InvestmentPosition[];
  watchlist: InvestmentWatchItem[];
  totalCurrentValue: number;
  totalProfit: number;
  profitRate: number;
  marketChange: number | null;
}) {
  const watchHoldings = watchlist
    .map(getWatchHoldingSnapshot)
    .filter((item): item is WatchHoldingSnapshot => Boolean(item));
  const rankedWatchHoldings = rankWatchHoldingsByTodayChange(watchHoldings);
  const estimatedPositionProfit =
    marketChange === null ? null : (totalCurrentValue * marketChange) / 100;
  const estimatedWatchProfit = watchHoldings.reduce(
    (sum, item) => sum + (item.estimatedTodayProfit || 0),
    0
  );
  const hasEstimatedWatchProfit = watchHoldings.some((item) => item.estimatedTodayProfit !== null);
  const estimatedTodayProfit =
    estimatedPositionProfit === null && !hasEstimatedWatchProfit
      ? null
      : Number(((estimatedPositionProfit || 0) + estimatedWatchProfit).toFixed(2));
  const estimatedValueBase =
    (estimatedPositionProfit === null ? 0 : totalCurrentValue) +
    watchHoldings.reduce(
      (sum, item) => sum + (item.estimatedTodayProfit === null ? 0 : item.currentValue),
      0
    );
  const effectiveMarketChange =
    estimatedTodayProfit !== null && estimatedValueBase > 0
      ? (estimatedTodayProfit / estimatedValueBase) * 100
      : marketChange;
  const holdingCount = positions.length + watchHoldings.length;
  const hasKnownCost = positions.length > 0;

  return (
    <section className="panel investments-today-holdings-panel" aria-label="今日持仓">
      <div className="investments-today-panel-head">
        <div>
          <h2>今日持仓</h2>
          <p>先看自己的持仓，别让大盘替你做决定。</p>
        </div>
        <span className="badge">{holdingCount} 笔</span>
      </div>

      <div className="investments-today-summary">
        <div className={totalProfit >= 0 ? 'is-positive' : 'is-negative'}>
          <span className="investments-key-label">账面盈亏</span>
          <strong className="investments-key-number">
            {hasKnownCost ? formatCurrencyAuto(totalProfit) : '--'}
          </strong>
          <em>{hasKnownCost ? `${(profitRate * 100).toFixed(1)}%` : '成本待录入'}</em>
        </div>
        <div className={getMarketTone(effectiveMarketChange)}>
          <span className="investments-key-label">今日市场估算</span>
          <strong className="investments-key-number">
            {estimatedTodayProfit === null ? '--' : formatCurrencyAuto(estimatedTodayProfit)}
          </strong>
          <em>
            {effectiveMarketChange === null
              ? '等待行情'
              : `${getMovementEmoji(effectiveMarketChange)} ${formatMarketPercent(effectiveMarketChange)}`}
          </em>
        </div>
      </div>

      <p className="investments-today-note">
        自选持仓按今日涨跌幅从高到低排列，TOP 3 仅标记有行情的基金；没有基金行情时再按主要指数平均涨跌估算。
      </p>

      <div className="investments-position-glance-list">
        {positions.slice(0, 6).map((position) => {
          const profit = position.currentValue - position.investedAmount;
          const positionProfitRate =
            position.investedAmount > 0 ? profit / position.investedAmount : 0;
          return (
            <article key={position.id} className="investments-position-glance-row">
              <span className="investments-position-glance-emoji" aria-hidden="true">
                {getMovementEmoji(positionProfitRate * 100)}
              </span>
              <div className="investments-position-glance-name">
                <strong title={position.name}>{position.name}</strong>
                <span>{POSITION_CATEGORY_LABELS[position.category]}</span>
              </div>
              <div>
                <span>当前市值</span>
                <strong>{formatCurrencyAuto(position.currentValue)}</strong>
              </div>
              <div>
                <span>持仓成本</span>
                <strong>{formatCurrencyAuto(position.investedAmount)}</strong>
              </div>
              <div className={profit >= 0 ? 'is-positive' : 'is-negative'}>
                <span>浮盈浮亏</span>
                <strong>{formatCurrencyAuto(profit)}</strong>
                <em>{(positionProfitRate * 100).toFixed(1)}%</em>
              </div>
            </article>
          );
        })}
        {rankedWatchHoldings.slice(0, Math.max(0, 6 - positions.length)).map((holding) => (
          <article key={holding.id} className="investments-position-glance-row is-watch-holding">
            <span className="investments-position-glance-emoji" aria-hidden="true">
              {getMovementEmoji(holding.marketChange)}
            </span>
            <div className="investments-position-glance-name">
              <div className="investments-position-glance-title-line">
                <strong title={holding.name}>{holding.name}</strong>
                {holding.todayRank !== null && holding.todayRank <= 3 ? (
                  <b className={`investments-holding-rank is-rank-${holding.todayRank}`}>
                    TOP {holding.todayRank}
                  </b>
                ) : null}
              </div>
              <span>{holding.category} · 自选持仓</span>
            </div>
            <div>
              <span>当前市值</span>
              <strong>{formatCurrencyAuto(holding.currentValue)}</strong>
            </div>
            <div>
              <span>持有份额</span>
              <strong>{formatHoldingShares(holding.shares)}</strong>
            </div>
            <div className={getMarketTone(holding.marketChange)}>
              <span>今日估算</span>
              <strong>
                {holding.estimatedTodayProfit === null
                  ? '--'
                  : formatCurrencyAuto(holding.estimatedTodayProfit)}
              </strong>
              <em>{formatMarketPercent(holding.marketChange)}</em>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlainMarketBriefingPanel({
  marketChange,
  themeBoards,
  news,
  insight,
  algorithmSignals,
  insightStatus
}: {
  marketChange: number | null;
  themeBoards: EastmoneyMarketBoard[];
  news: EastmoneyMarketNewsItem[];
  insight: InvestmentMarketInsight | null;
  algorithmSignals: MarketAlgorithmSignals;
  insightStatus: MarketInsightStatus;
}) {
  const strongestTheme = [...themeBoards].sort(
    (a, b) =>
      (b.changePercent || Number.NEGATIVE_INFINITY) - (a.changePercent || Number.NEGATIVE_INFINITY)
  )[0];
  const weakestTheme = [...themeBoards].sort(
    (a, b) =>
      (a.changePercent || Number.POSITIVE_INFINITY) - (b.changePercent || Number.POSITIVE_INFINITY)
  )[0];
  const policyNews = news.find((item) => isPolicySignalText(`${item.title} ${item.summary}`));
  const topNews = policyNews || news[0];

  return (
    <section className="panel investments-plain-briefing-panel" aria-label="今日行情播报">
      <div className="investments-today-panel-head">
        <div>
          <h2>今天的市场，说人话</h2>
          <p>把涨跌、板块和新闻拎成几句，够用就好。</p>
        </div>
        <span aria-hidden="true">🗣️</span>
      </div>
      <strong className="investments-plain-briefing-lead">
        {insight?.headline ||
          (marketChange === null && news.length
            ? '价格信号暂缺，先结合新闻热度观察，不做追涨判断。'
            : getPlainMarketLine(marketChange))}
      </strong>
      {insight?.summary ? <p className="investments-market-ai-summary">{insight.summary}</p> : null}
      <div className="investments-plain-briefing-points">
        {insight?.points.length
          ? insight.points.map((point) => (
              <p key={`${point.label}-${point.text}`}>
                <span>{point.label}</span>
                {point.text}
              </p>
            ))
          : [
              {
                label: '板块',
                text: strongestTheme
                  ? `${strongestTheme.name} ${formatMarketPercent(strongestTheme.changePercent)}，今天相对有劲。`
                  : '板块数据还在加载。'
              },
              {
                label: '回避',
                text:
                  weakestTheme && weakestTheme.code !== strongestTheme?.code
                    ? `${weakestTheme.name} ${formatMarketPercent(weakestTheme.changePercent)}，今天偏弱，别急着接。`
                    : '暂时没有明显的弱势板块。'
              },
              {
                label: policyNews ? '政策' : '资讯',
                text: topNews
                  ? topNews.summary || '有一条新资讯正在影响市场关注。'
                  : '资讯正在同步，稍后刷新看看。'
              }
            ].map((point) => (
              <p key={point.label}>
                <span>{point.label}</span>
                {point.text}
              </p>
            ))}
      </div>
      <small className="investments-market-insight-meta">
        {insightStatus === 'ready' && insight
          ? `结合行情、新闻和板块 · 每 15 分钟更新 · 综合 ${algorithmSignals.score} · 风险 ${algorithmSignals.riskScore}`
          : insightStatus === 'disabled'
            ? `先用本地信号 · 配置 AI 后每 15 分钟更新 · 综合 ${algorithmSignals.score} · 风险 ${algorithmSignals.riskScore}`
            : insightStatus === 'error'
              ? `本地信号可用，AI 暂不可用 · 综合 ${algorithmSignals.score} · 风险 ${algorithmSignals.riskScore}`
              : `正在整理行情和新闻 · 综合 ${algorithmSignals.score} · 风险 ${algorithmSignals.riskScore}`}
      </small>
    </section>
  );
}

function RuleSuggestionsPanel({
  suggestions,
  insight,
  algorithmSignals
}: {
  suggestions: RuleSuggestion[];
  insight: InvestmentMarketInsight | null;
  algorithmSignals: MarketAlgorithmSignals;
}) {
  const summary = insight
    ? `结合市场、热点与资讯整理，风险温度 ${algorithmSignals.riskScore} 分（满分 100）。`
    : `先以当前行情作参考，风险温度 ${algorithmSignals.riskScore} 分（满分 100）。`;

  return (
    <section className="panel investments-rule-suggestions-panel" aria-label="今日投资提示">
      <div className="investments-today-panel-head">
        <div>
          <span className="investments-briefing-eyebrow">晨间笔记</span>
          <h2>慢一点，也是在前进</h2>
          <p>{summary}</p>
        </div>
      </div>
      <div className="investments-rule-suggestion-list">
        {suggestions.map((suggestion, index) => (
          <article key={suggestion.title} className={`is-${suggestion.tone}`}>
            <span className="investments-rule-suggestion-index" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <strong>{suggestion.title}</strong>
              <p>{suggestion.reason.replace(/^依据：/, '')}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type GlobalMarketDefinition = {
  id: string;
  name: string;
  shortName: string;
  flag: string;
  timeZone: string;
  color: string;
  sessions: Array<{ start: number; end: number }>;
};

const GLOBAL_MARKETS: GlobalMarketDefinition[] = [
  {
    id: 'cn',
    name: 'A 股',
    shortName: '沪深',
    flag: '🇨🇳',
    timeZone: 'Asia/Shanghai',
    color: '#f59e0b',
    sessions: [
      { start: 9 * 60 + 30, end: 11 * 60 + 30 },
      { start: 13 * 60, end: 15 * 60 }
    ]
  },
  {
    id: 'hk',
    name: '港股',
    shortName: '香港',
    flag: '🇭🇰',
    timeZone: 'Asia/Hong_Kong',
    color: '#e879f9',
    sessions: [
      { start: 9 * 60 + 30, end: 12 * 60 },
      { start: 13 * 60, end: 16 * 60 }
    ]
  },
  {
    id: 'jp',
    name: '日股',
    shortName: '东京',
    flag: '🇯🇵',
    timeZone: 'Asia/Tokyo',
    color: '#ef4444',
    sessions: [
      { start: 9 * 60, end: 11 * 60 + 30 },
      { start: 12 * 60 + 30, end: 15 * 60 + 30 }
    ]
  },
  {
    id: 'kr',
    name: '韩股',
    shortName: '首尔',
    flag: '🇰🇷',
    timeZone: 'Asia/Seoul',
    color: '#22c55e',
    sessions: [{ start: 9 * 60, end: 15 * 60 + 30 }]
  },
  {
    id: 'uk',
    name: '英股',
    shortName: '伦敦',
    flag: '🇬🇧',
    timeZone: 'Europe/London',
    color: '#f97316',
    sessions: [{ start: 8 * 60, end: 16 * 60 + 30 }]
  },
  {
    id: 'de',
    name: '德股',
    shortName: '法兰克福',
    flag: '🇩🇪',
    timeZone: 'Europe/Berlin',
    color: '#8b5cf6',
    sessions: [{ start: 9 * 60, end: 17 * 60 + 30 }]
  },
  {
    id: 'us',
    name: '美股',
    shortName: '纽约',
    flag: '🇺🇸',
    timeZone: 'America/New_York',
    color: '#3b82f6',
    sessions: [{ start: 9 * 60 + 30, end: 16 * 60 }]
  }
];

const AUTO_REFRESH_MARKET_IDS = new Set(['cn', 'jp', 'kr', 'us']);

function getZonedClock(now: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  const year = values.year || now.getUTCFullYear();
  const month = values.month || now.getUTCMonth() + 1;
  const day = values.day || now.getUTCDate();
  const hour = values.hour || 0;
  const minute = values.minute || 0;
  const second = values.second || 0;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minutes: hour * 60 + minute + second / 60
  };
}

function getTimeZoneOffsetMinutes(now: Date, timeZone: string) {
  const zoned = getZonedClock(now, timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second
  );
  return (asUtc - now.getTime()) / 60000;
}

function getGlobalMarketState(market: GlobalMarketDefinition, now: Date) {
  const clock = getZonedClock(now, market.timeZone);
  const isWeekend = clock.weekday === 0 || clock.weekday === 6;
  const activeSession = isWeekend
    ? null
    : market.sessions.find(
        (session) => clock.minutes >= session.start && clock.minutes < session.end
      );
  const nextSession = market.sessions.find((session) => clock.minutes < session.start);
  const isLunchBreak =
    !isWeekend &&
    !activeSession &&
    market.sessions.length > 1 &&
    clock.minutes >= market.sessions[0].end &&
    clock.minutes < market.sessions[1].start;
  const label = activeSession
    ? '交易中'
    : isWeekend
      ? '周末休市'
      : isLunchBreak
        ? '午间休市'
        : nextSession
          ? '未开盘'
          : '已收盘';

  return {
    ...market,
    isOpen: Boolean(activeSession),
    label,
    localTime: `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
  };
}

function isLiveMarketPollingTime(now = new Date()) {
  return GLOBAL_MARKETS.some(
    (market) => AUTO_REFRESH_MARKET_IDS.has(market.id) && getGlobalMarketState(market, now).isOpen
  );
}

function buildViewerTimelineSegments(
  market: GlobalMarketDefinition,
  now: Date,
  viewerTimeZone: string
) {
  const viewerOffset = getTimeZoneOffsetMinutes(now, viewerTimeZone);
  const marketOffset = getTimeZoneOffsetMinutes(now, market.timeZone);
  const shift = viewerOffset - marketOffset;

  return market.sessions.flatMap((session, sessionIndex) =>
    [-1440, 0, 1440]
      .map((dayShift) => ({
        key: `${sessionIndex}-${dayShift}`,
        start: session.start + shift + dayShift,
        end: session.end + shift + dayShift
      }))
      .filter((segment) => segment.end > 0 && segment.start < 1440)
      .map((segment) => ({
        ...segment,
        start: Math.max(0, segment.start),
        end: Math.min(1440, segment.end)
      }))
  );
}

function GlobalMarketClock() {
  const [now, setNow] = useState(() => new Date());
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  const viewerClock = getZonedClock(now, viewerTimeZone);
  const isWeekend = viewerClock.weekday === 0 || viewerClock.weekday === 6;
  const marketStates = GLOBAL_MARKETS.map((market) => getGlobalMarketState(market, now));
  const openMarkets = marketStates.filter((market) => market.isOpen);
  const currentPosition = Math.min(100, Math.max(0, (viewerClock.minutes / 1440) * 100));
  const viewerZoneLabel = new Intl.DateTimeFormat('zh-CN', {
    timeZone: viewerTimeZone,
    timeZoneName: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="investments-global-clock" data-testid="market-session-status">
      <div className="investments-global-clock-head">
        <div>
          <span className="investments-global-clock-eyebrow">全球市场接力</span>
          <strong>
            {openMarkets.length > 0
              ? `${openMarkets.map((market) => market.name).join('、')}正在交易`
              : '当前常规交易时段均已休市'}
          </strong>
        </div>
        <div className="investments-global-clock-actions">
          <span className="investments-global-clock-zone">
            当前时区 · {viewerTimeZone} · {viewerZoneLabel}
          </span>
          <button
            type="button"
            aria-expanded={timelineExpanded}
            onClick={() => setTimelineExpanded((current) => !current)}
          >
            {timelineExpanded ? '收起时间轴' : '展开时间轴'}
          </button>
        </div>
      </div>

      <div className="investments-global-market-statuses" aria-label="全球股市开闭市状态">
        {marketStates.map((market) => (
          <div
            key={market.id}
            className={`investments-global-market-status ${market.isOpen ? 'is-open' : 'is-closed'}`}
            style={{ '--market-color': market.color } as CSSProperties}
          >
            <span aria-hidden="true">{market.flag}</span>
            <div>
              <strong>{market.name}</strong>
              <small>{market.localTime}</small>
            </div>
            <b>{market.label}</b>
          </div>
        ))}
      </div>

      {timelineExpanded ? (
        <div className="investments-global-timeline" aria-label="按当前时区显示的全球市场时间轴">
          <div className="investments-global-timeline-axis" aria-hidden="true">
            {[0, 4, 8, 12, 16, 20, 24].map((hour) => (
              <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {!isWeekend ? (
            <div
              className="investments-global-timeline-now"
              style={{ left: `calc(84px + ${currentPosition}% - ${currentPosition * 0.84}px)` }}
              aria-hidden="true"
            >
              <span>现在</span>
            </div>
          ) : null}
          {marketStates.map((market) => (
            <div
              className={`investments-global-timeline-lane ${market.isOpen ? 'is-open' : ''}`}
              key={market.id}
              style={{ '--market-color': market.color } as CSSProperties}
            >
              <span className="investments-global-timeline-label">
                {market.flag} {market.name}
              </span>
              <div className="investments-global-timeline-track">
                {buildViewerTimelineSegments(market, now, viewerTimeZone).map((segment) => (
                  <i
                    key={segment.key}
                    style={{
                      left: `${(segment.start / 1440) * 100}%`,
                      width: `${((segment.end - segment.start) / 1440) * 100}%`
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="investments-global-timeline-summary" aria-label="折叠的全球市场时间轴">
          <strong>交易时间轴</strong>
          {marketStates.map((market) => (
            <span
              className={market.isOpen ? 'is-open' : ''}
              key={market.id}
              style={{ '--market-color': market.color } as CSSProperties}
            >
              {market.flag} {market.name} {market.localTime}
            </span>
          ))}
        </div>
      )}
      <p className="investments-global-clock-note">
        常规交易时段 · 自动换算当前时区 · 不含节假日与盘前盘后
      </p>
    </div>
  );
}

function buildMarketTrendGeometry(points: EastmoneyMarketTrendPoint[]) {
  const width = 560;
  const height = 224;
  const paddingLeft = 46;
  const paddingRight = 10;
  const paddingTop = 16;
  const paddingBottom = 18;
  const usableWidth = width - paddingLeft - paddingRight;
  const usableHeight = height - paddingTop - paddingBottom;
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
      plotLeft: paddingLeft,
      plotRight: width - paddingRight,
      plotTop: paddingTop,
      plotBottom: height - paddingBottom,
      points: [] as MarketTrendChartPoint[],
      labels: [] as string[]
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.01);
  const coords = points.map((point, index) => {
    const x = paddingLeft + (index / Math.max(points.length - 1, 1)) * usableWidth;
    const y = paddingTop + (1 - (point.value - min) / spread) * usableHeight;
    return { ...point, x, y, index };
  });
  const linePath = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${(height - paddingBottom).toFixed(
    2
  )} L ${first.x.toFixed(2)} ${(height - paddingBottom).toFixed(2)} Z`;
  const middle = points[Math.floor(points.length / 2)];

  return {
    width,
    height,
    linePath,
    areaPath,
    min,
    max,
    mid: min + spread / 2,
    plotLeft: paddingLeft,
    plotRight: width - paddingRight,
    plotTop: paddingTop,
    plotBottom: height - paddingBottom,
    points: coords,
    labels: [points[0]?.label, middle?.label, points[points.length - 1]?.label].filter(Boolean)
  };
}

const GLOBAL_CHART_WIDTH = 560;
const GLOBAL_CHART_HEIGHT = 224;
const GLOBAL_CHART_PADDING = {
  left: 46,
  right: 10,
  top: 16,
  bottom: 18
};

function buildGlobalTrendChartGeometry(points: GlobalMarketTrendPoint[]) {
  const width = GLOBAL_CHART_WIDTH;
  const height = GLOBAL_CHART_HEIGHT;
  const paddingLeft = GLOBAL_CHART_PADDING.left;
  const paddingRight = GLOBAL_CHART_PADDING.right;
  const paddingTop = GLOBAL_CHART_PADDING.top;
  const paddingBottom = GLOBAL_CHART_PADDING.bottom;
  const usableWidth = width - paddingLeft - paddingRight;
  const usableHeight = height - paddingTop - paddingBottom;
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
      plotLeft: paddingLeft,
      plotRight: width - paddingRight,
      plotTop: paddingTop,
      plotBottom: height - paddingBottom,
      points: [] as GlobalMarketTrendChartPoint[],
      labels: [] as string[]
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.01);
  const coords = points.map((point, index) => {
    const x = paddingLeft + (index / Math.max(points.length - 1, 1)) * usableWidth;
    const y = paddingTop + (1 - (point.value - min) / spread) * usableHeight;
    return { ...point, x, y, index };
  });
  const linePath = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${(height - paddingBottom).toFixed(
    2
  )} L ${first.x.toFixed(2)} ${(height - paddingBottom).toFixed(2)} Z`;
  const middle = points[Math.floor(points.length / 2)];

  return {
    width,
    height,
    linePath,
    areaPath,
    min,
    max,
    mid: min + spread / 2,
    plotLeft: paddingLeft,
    plotRight: width - paddingRight,
    plotTop: paddingTop,
    plotBottom: height - paddingBottom,
    points: coords,
    labels: [points[0]?.label, middle?.label, points[points.length - 1]?.label].filter(Boolean)
  };
}

function buildGlobalKlineChartGeometry(points: GlobalMarketHistoryPoint[]) {
  const width = GLOBAL_CHART_WIDTH;
  const height = GLOBAL_CHART_HEIGHT;
  const paddingLeft = GLOBAL_CHART_PADDING.left;
  const paddingRight = GLOBAL_CHART_PADDING.right;
  const paddingTop = GLOBAL_CHART_PADDING.top;
  const paddingBottom = GLOBAL_CHART_PADDING.bottom;
  const usableWidth = width - paddingLeft - paddingRight;
  const usableHeight = height - paddingTop - paddingBottom;
  const chartPoints = points
    .map((point, index) => ({
      point,
      index,
      open: point.open ?? point.value,
      high: point.high ?? point.value,
      low: point.low ?? point.value,
      close: point.value
    }))
    .filter(
      (
        item
      ): item is {
        point: GlobalMarketHistoryPoint;
        index: number;
        open: number;
        high: number;
        low: number;
        close: number;
      } =>
        Number.isFinite(item.open) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.close)
    );

  if (chartPoints.length === 0) {
    return {
      width,
      height,
      min: null as number | null,
      max: null as number | null,
      plotLeft: paddingLeft,
      plotRight: width - paddingRight,
      plotTop: paddingTop,
      plotBottom: height - paddingBottom,
      candles: [] as GlobalKlineChartPoint[],
      labels: [] as string[]
    };
  }

  const min = Math.min(...chartPoints.map((item) => item.low));
  const max = Math.max(...chartPoints.map((item) => item.high));
  const spread = Math.max(max - min, 0.01);
  const candles = chartPoints.map((item) => {
    const x = paddingLeft + (item.index / Math.max(chartPoints.length - 1, 1)) * usableWidth;
    const y = (value: number) => paddingTop + (1 - (value - min) / spread) * usableHeight;
    const openY = y(item.open);
    const closeY = y(item.close);
    const tone =
      item.close > item.open ? 'is-positive' : item.close < item.open ? 'is-negative' : 'is-flat';
    return {
      label: item.point.date,
      value: item.close,
      x,
      openY,
      highY: y(item.high),
      lowY: y(item.low),
      closeY,
      tone
    };
  });
  const firstPoint = chartPoints[0].point;
  const middlePoint = chartPoints[Math.floor(chartPoints.length / 2)].point;
  const lastPoint = chartPoints[chartPoints.length - 1].point;

  return {
    width,
    height,
    min,
    max,
    plotLeft: paddingLeft,
    plotRight: width - paddingRight,
    plotTop: paddingTop,
    plotBottom: height - paddingBottom,
    candles,
    labels: [firstPoint.date, middlePoint.date, lastPoint.date].filter(Boolean)
  };
}

const MARKET_HISTORY_RANGES: Array<{
  id: EastmoneyMarketHistoryRange;
  label: string;
}> = [
  { id: '1m', label: '近 1 月' },
  { id: '3m', label: '近 3 月' },
  { id: '6m', label: '近 6 月' },
  { id: '1y', label: '近 1 年' },
  { id: '3y', label: '近 3 年' }
];

const SIMULATION_WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
];
const SIMULATION_MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

type MarketHistoryTarget = {
  id: string;
  provider: 'eastmoney' | 'yahoo';
  identifier: string;
  label: string;
};

const MARKET_HISTORY_TARGETS: MarketHistoryTarget[] = [
  ...EASTMONEY_MARKET_INDEXES.map((item) => ({
    id: `cn:${item.secId}`,
    provider: 'eastmoney' as const,
    identifier: item.secId,
    label: `🇨🇳 A 股 · ${item.name}`
  })),
  ...GLOBAL_MARKET_INDEXES.map((item) => ({
    id: `global:${item.id}`,
    provider: 'yahoo' as const,
    identifier: item.id,
    label: `${item.flag} ${item.market} · ${item.name}`
  }))
];

function formatDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDateByYears(date: Date, years: number) {
  const shifted = new Date(date);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - years);
  return shifted;
}

function formatHistoryDateLabel(value: string) {
  return value.slice(0, 7).replace('-', '/');
}

function getDateInputWeekday(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function MarketHistoryAndSimulator({ secId, indexName }: { secId: string; indexName: string }) {
  const today = useMemo(() => new Date(), []);
  const defaultStartDate = formatDateInputValue(shiftDateByYears(today, 1));
  const [historyRange, setHistoryRange] = useState<EastmoneyMarketHistoryRange>('1y');
  const [historyTargetId, setHistoryTargetId] = useState(`cn:${secId}`);
  const [historyPoints, setHistoryPoints] = useState<EastmoneyMarketHistoryPoint[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [historyError, setHistoryError] = useState('');
  const [simulationFrequency, setSimulationFrequency] =
    useState<InvestmentSimulationFrequency>('monthly');
  const [simulationWeekday, setSimulationWeekday] = useState(() =>
    getDateInputWeekday(defaultStartDate)
  );
  const [simulationDayOfMonth, setSimulationDayOfMonth] = useState(() =>
    Number(defaultStartDate.slice(-2))
  );
  const [simulationAmount, setSimulationAmount] = useState('1000');
  const [simulationStartDate, setSimulationStartDate] = useState(() =>
    defaultStartDate
  );
  const [simulationEndDate, setSimulationEndDate] = useState(() => formatDateInputValue(today));
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [simulationError, setSimulationError] = useState('');
  const [simulationResult, setSimulationResult] = useState<InvestmentSimulationResult | null>(null);
  const historyTarget =
    MARKET_HISTORY_TARGETS.find((item) => item.id === historyTargetId) || {
      id: `cn:${secId}`,
      provider: 'eastmoney' as const,
      identifier: secId,
      label: `🇨🇳 A 股 · ${indexName}`
    };

  useEffect(() => {
    setHistoryTargetId((current) => (current.startsWith('cn:') ? `cn:${secId}` : current));
  }, [secId]);

  useEffect(() => {
    let cancelled = false;
    setHistoryStatus('loading');
    setHistoryError('');
    const fetchHistory =
      historyTarget.provider === 'yahoo' ? fetchGlobalMarketHistory : fetchEastmoneyIndexHistory;
    void fetchHistory(historyTarget.identifier, { range: historyRange })
      .then((points) => {
        if (cancelled) return;
        setHistoryPoints(points);
        setHistoryStatus('idle');
      })
      .catch((error) => {
        if (cancelled) return;
        setHistoryPoints([]);
        setHistoryStatus('error');
        setHistoryError(error instanceof Error ? error.message : '大盘历史行情加载失败。');
      });
    return () => {
      cancelled = true;
    };
  }, [historyRange, historyTarget.identifier, historyTarget.provider]);

  const historyTrend = useMemo<EastmoneyMarketTrendPoint[]>(
    () =>
      historyPoints.map((point) => ({
        time: `${point.date} 00:00`,
        label: formatHistoryDateLabel(point.date),
        value: point.value,
        volume: point.volume,
        amount: point.amount,
        average: null
      })),
    [historyPoints]
  );
  const historyChart = buildMarketTrendGeometry(historyTrend);
  const firstHistoryPoint = historyPoints[0];
  const lastHistoryPoint = historyPoints.at(-1);
  const historyChange =
    firstHistoryPoint && lastHistoryPoint && firstHistoryPoint.value > 0
      ? (lastHistoryPoint.value - firstHistoryPoint.value) / firstHistoryPoint.value
      : null;
  const historyTone = getMarketTone(historyChange === null ? null : historyChange * 100);

  async function runSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSimulationStatus('loading');
    setSimulationError('');
    setSimulationResult(null);
    try {
      const fetchHistory =
        historyTarget.provider === 'yahoo' ? fetchGlobalMarketHistory : fetchEastmoneyIndexHistory;
      const points = await fetchHistory(historyTarget.identifier, {
        startDate: simulationStartDate,
        endDate: simulationEndDate
      });
      const result = simulateInvestmentPlan({
        points,
        startDate: simulationStartDate,
        endDate: simulationEndDate,
        amount: Number(simulationAmount),
        frequency: simulationFrequency,
        weekday: simulationWeekday,
        dayOfMonth: simulationDayOfMonth
      });
      if (!result) {
        throw new Error('所选区间没有足够的交易日数据，请调整日期或金额。');
      }
      setSimulationResult(result);
      setSimulationStatus('idle');
    } catch (error) {
      setSimulationStatus('error');
      setSimulationError(error instanceof Error ? error.message : '定投模拟失败，请稍后重试。');
    }
  }

  return (
    <section className="investments-market-history-section" aria-label="大盘历史行情和投资模拟">
      <div className="investments-market-history-head">
        <div>
          <h4>{historyTarget.label.replace(/^.+?·\s*/, '')}历史走势</h4>
          <p>
            {historyTarget.provider === 'yahoo' ? 'Yahoo Finance 日线数据' : '东方财富日线数据'} · 按需获取；优先内存缓存，配置 MySQL/SQLite 后落库 7 天，长期未访问自动清理
          </p>
        </div>
        <div className="investments-market-history-controls">
          <label className="investments-market-history-target">
            <span>历史模拟标的</span>
            <select
              value={historyTargetId}
              onChange={(event) => {
                setHistoryTargetId(event.target.value);
                setSimulationResult(null);
              }}
              aria-label="历史模拟标的"
            >
              {MARKET_HISTORY_TARGETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div
            className="investments-market-history-range-tabs"
            role="tablist"
            aria-label="历史行情区间"
          >
            {MARKET_HISTORY_RANGES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={historyRange === item.id}
                onClick={() => setHistoryRange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="investments-market-history-grid">
        <div className="investments-market-history-chart-card">
          {historyChart.linePath ? (
            <>
              <div className="investments-market-history-summary">
                <span>
                  起点 <strong>{formatMarketIndexValue(firstHistoryPoint?.value)}</strong>
                </span>
                <span>
                  最新 <strong>{formatMarketIndexValue(lastHistoryPoint?.value)}</strong>
                </span>
                <strong className={historyTone}>
                  {historyChange === null ? '--' : formatMarketPercent(historyChange * 100)}
                </strong>
              </div>
              <svg
                className={`investments-market-history-chart ${historyTone}`}
                viewBox={`0 0 ${historyChart.width} ${historyChart.height}`}
                role="img"
                aria-label={`${historyTarget.label.replace(/^.+?·\s*/, '')}${MARKET_HISTORY_RANGES.find((item) => item.id === historyRange)?.label || ''}历史走势`}
              >
                <defs>
                  <linearGradient id="investments-market-history-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {[0, 0.5, 1].map((ratio) => (
                  <line
                    key={ratio}
                    className="investments-market-chart-grid"
                    x1={historyChart.plotLeft}
                    x2={historyChart.plotRight}
                    y1={
                      historyChart.plotTop +
                      (historyChart.plotBottom - historyChart.plotTop) * ratio
                    }
                    y2={
                      historyChart.plotTop +
                      (historyChart.plotBottom - historyChart.plotTop) * ratio
                    }
                  />
                ))}
                <path className="investments-market-chart-area" d={historyChart.areaPath} />
                <path className="investments-market-chart-line" d={historyChart.linePath} />
                {[historyChart.min, historyChart.mid, historyChart.max].map((value, index) => (
                  <text
                    key={`${value}-${index}`}
                    className="investments-market-chart-axis-label"
                    x="2"
                    y={
                      historyChart.plotBottom -
                      (index / 2) * (historyChart.plotBottom - historyChart.plotTop)
                    }
                    dominantBaseline="middle"
                  >
                    {formatMarketIndexValue(value)}
                  </text>
                ))}
              </svg>
              <div className="investments-market-history-axis" aria-hidden="true">
                {historyChart.labels.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
            </>
          ) : (
            <div className="investments-market-chart-empty">
              <strong>{historyStatus === 'loading' ? '历史数据加载中' : '暂无历史数据'}</strong>
              <span>{historyError || '选择区间后会显示日线走势。'}</span>
            </div>
          )}
        </div>

        <form className="investments-simulation-panel" onSubmit={runSimulation}>
          <div>
            <h4>定投模拟</h4>
            <p>用历史收盘价估算：按计划投入后，期末大约剩多少。</p>
          </div>
          <div className="investments-simulation-fields">
            <label>
              <span>频率</span>
              <select
                value={simulationFrequency}
                onChange={(event) =>
                  setSimulationFrequency(event.target.value as InvestmentSimulationFrequency)
                }
              >
                <option value="trading-daily">每个交易日</option>
                <option value="monthly">每月</option>
                <option value="weekly">每周</option>
              </select>
            </label>
            {simulationFrequency === 'weekly' ? (
              <label>
                <span>每周几</span>
                <select
                  value={simulationWeekday}
                  onChange={(event) => setSimulationWeekday(Number(event.target.value))}
                  aria-label="定投每周几"
                >
                  {SIMULATION_WEEKDAYS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {simulationFrequency === 'monthly' ? (
              <label>
                <span>每月几号</span>
                <select
                  value={simulationDayOfMonth}
                  onChange={(event) => setSimulationDayOfMonth(Number(event.target.value))}
                  aria-label="定投每月几号"
                >
                  {SIMULATION_MONTH_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day} 号
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <span>每期金额</span>
              <input
                type="number"
                min="1"
                step="1"
                value={simulationAmount}
                onChange={(event) => setSimulationAmount(event.target.value)}
                aria-label="定投每期金额"
              />
            </label>
            <label>
              <span>开始日期</span>
              <input
                type="date"
                value={simulationStartDate}
                onChange={(event) => setSimulationStartDate(event.target.value)}
                aria-label="定投开始日期"
              />
            </label>
            <label>
              <span>结束日期</span>
              <input
                type="date"
                value={simulationEndDate}
                onChange={(event) => setSimulationEndDate(event.target.value)}
                aria-label="定投结束日期"
              />
            </label>
          </div>
          <button
            type="submit"
            className="primary investments-simulation-submit"
            disabled={simulationStatus === 'loading'}
          >
            {simulationStatus === 'loading' ? '模拟中…' : '开始模拟'}
          </button>
          {simulationError ? <p className="investments-market-error">{simulationError}</p> : null}
          {simulationResult ? (
            <div className="investments-simulation-result" aria-label="定投模拟结果">
              <div>
                <span>累计投入</span>
                <strong>{formatCurrencyAuto(simulationResult.investedAmount)}</strong>
              </div>
              <div>
                <span>期末资产</span>
                <strong>{formatCurrencyAuto(simulationResult.endingValue)}</strong>
              </div>
              <div className={simulationResult.profit >= 0 ? 'is-positive' : 'is-negative'}>
                <span>模拟盈亏</span>
                <strong>{formatCurrencyAuto(simulationResult.profit)}</strong>
              </div>
              <div className={simulationResult.returnRate >= 0 ? 'is-positive' : 'is-negative'}>
                <span>收益率</span>
                <strong>{formatMarketPercent(simulationResult.returnRate * 100)}</strong>
              </div>
              <small>
                共 {simulationResult.contributionCount} 次 · {simulationResult.firstBuyDate} 至{' '}
                {simulationResult.lastBuyDate} · 估值日 {simulationResult.valuationDate}
              </small>
            </div>
          ) : null}
        </form>
      </div>
      <p className="investments-market-source-note investments-simulation-method-note">
        计算口径：按计划日在历史日线中顺延到下一个可用交易日买入，期末按结束日前最后收盘价估值；收益率为模拟盈亏 ÷ 累计投入，未年化。仅模拟指数点位，不代表实际基金收益，且不含申购费、分红、税费和滑点。
      </p>
    </section>
  );
}

function MarketOverviewPanel({
  overview,
  globalQuotes,
  globalStatus,
  globalError,
  selectedSecId,
  status,
  error,
  onSelect
}: {
  overview: EastmoneyMarketOverview | null;
  globalQuotes: GlobalMarketQuote[];
  globalStatus: 'idle' | 'loading' | 'error';
  globalError: string;
  selectedSecId: string;
  status: 'idle' | 'loading' | 'error';
  error: string;
  onSelect: (secId: string) => void;
}) {
  const quotes = useMemo(() => overview?.quotes || [], [overview?.quotes]);
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
  const [flashingQuoteIds, setFlashingQuoteIds] = useState<Set<string>>(() => new Set());
  const previousQuoteValuesRef = useRef<Map<string, string>>(new Map());
  const flashTimerRef = useRef<number | null>(null);
  const totalAmount = quotes.reduce((sum, item) => sum + (item.amount || 0), 0);
  const selectedQuoteData =
    selectedQuote && 'amount' in selectedQuote ? (selectedQuote as EastmoneyMarketQuote) : null;
  const updatedAt = overview?.updatedAt ? formatDateTimeLabel(overview.updatedAt) : '';
  const isSwitchingTrend = status === 'loading' && !isTrendCurrent;
  const activeTrendPoint =
    chart.points[hoveredTrendIndex ?? chart.points.length - 1] ||
    chart.points[chart.points.length - 1] ||
    null;
  const hoveredTrendPoint = hoveredTrendIndex === null ? null : activeTrendPoint;
  const globalQuoteById = new Map(globalQuotes.map((quote) => [quote.id, quote]));
  const isAnyMarketOpen = isLiveMarketPollingTime();
  const [selectedGlobalId, setSelectedGlobalId] = useState<string | null>(null);
  const [globalChartMode, setGlobalChartMode] = useState<'line' | 'kline'>('line');
  const [globalTrendPoints, setGlobalTrendPoints] = useState<GlobalMarketTrendPoint[]>([]);
  const [globalKlinePoints, setGlobalKlinePoints] = useState<GlobalMarketHistoryPoint[]>([]);
  const [globalChartStatus, setGlobalChartStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [globalChartError, setGlobalChartError] = useState('');
  const [hoveredGlobalPointIndex, setHoveredGlobalPointIndex] = useState<number | null>(null);
  const selectedGlobalIndex = GLOBAL_MARKET_INDEXES.find((item) => item.id === selectedGlobalId);
  const selectedGlobalQuote =
    selectedGlobalId === null ? undefined : globalQuoteById.get(selectedGlobalId);
  const globalTrendChart = buildGlobalTrendChartGeometry(globalTrendPoints);
  const globalKlineChart = buildGlobalKlineChartGeometry(globalKlinePoints);
  const globalActiveTrendPoint =
    globalTrendChart.points[
      hoveredGlobalPointIndex ?? globalTrendChart.points.length - 1
    ] || globalTrendChart.points[globalTrendChart.points.length - 1] || null;
  const globalHoveredTrendPoint =
    hoveredGlobalPointIndex === null ? null : globalActiveTrendPoint;
  const quoteUpdateSignature = [
    ...quotes.map((quote) => `cn:${quote.secId}:${quote.value ?? ''}:${quote.changePercent ?? ''}`),
    ...globalQuotes.map(
      (quote) => `global:${quote.id}:${quote.value ?? ''}:${quote.changePercent ?? ''}`
    )
  ].join('|');

  useEffect(() => {
    setHoveredTrendIndex(null);
  }, [selectedSecId]);

  useEffect(() => {
    if (!selectedGlobalId) {
      setGlobalTrendPoints([]);
      setGlobalKlinePoints([]);
      setGlobalChartStatus('idle');
      setGlobalChartError('');
      setHoveredGlobalPointIndex(null);
      return;
    }

    let cancelled = false;
    setGlobalChartStatus('loading');
    setGlobalChartError('');
    setHoveredGlobalPointIndex(null);

    const request =
      globalChartMode === 'line'
        ? fetchGlobalMarketTrend(selectedGlobalId).then((points) => {
            if (!cancelled) setGlobalTrendPoints(points);
          })
        : fetchGlobalMarketHistory(selectedGlobalId, { range: '1m' }).then((points) => {
            if (!cancelled) setGlobalKlinePoints(points);
          });

    request
      .then(() => {
        if (!cancelled) setGlobalChartStatus('idle');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setGlobalChartStatus('error');
        setGlobalChartError(
          reason instanceof Error ? reason.message : '国际大盘走势加载失败，请稍后重试。'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [globalChartMode, selectedGlobalId]);

  useEffect(() => {
    const currentValues = new Map<string, string>();
    quotes.forEach((quote) => {
      currentValues.set(`cn:${quote.secId}`, `${quote.value ?? ''}:${quote.changePercent ?? ''}`);
    });
    globalQuotes.forEach((quote) => {
      currentValues.set(`global:${quote.id}`, `${quote.value ?? ''}:${quote.changePercent ?? ''}`);
    });

    const previousValues = previousQuoteValuesRef.current;
    const changedIds = new Set<string>();
    if (previousValues.size > 0) {
      currentValues.forEach((value, id) => {
        if (previousValues.has(id) && previousValues.get(id) !== value) changedIds.add(id);
      });
    }
    previousQuoteValuesRef.current = currentValues;

    if (changedIds.size === 0) return;
    setFlashingQuoteIds(changedIds);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashingQuoteIds(new Set());
      flashTimerRef.current = null;
    }, 920);
  }, [globalQuotes, quoteUpdateSignature, quotes]);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    []
  );

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

  function handleGlobalCardSelect(indexId: string) {
    setSelectedGlobalId((current) => (current === indexId ? null : indexId));
    setGlobalChartMode('line');
    setGlobalTrendPoints([]);
    setGlobalKlinePoints([]);
    setGlobalChartStatus('idle');
    setGlobalChartError('');
    setHoveredGlobalPointIndex(null);
  }

  function handleGlobalTrendPointerMove(event: MouseEvent<HTMLDivElement>) {
    if (!globalTrendChart.points.length) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const x =
      ((event.clientX - rect.left) / rect.width) * globalTrendChart.width;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    globalTrendChart.points.forEach((point, index) => {
      const distance = Math.abs(point.x - x);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setHoveredGlobalPointIndex(closestIndex);
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
        <div className="investments-market-live-status" aria-label="大盘自动更新状态">
          <span className="investments-market-live-dot" aria-hidden="true" />
          <div>
            <strong>实时轮询</strong>
            <small>
              {isAnyMarketOpen ? '交易中 · 每 10 秒自动更新' : '非交易时段 · 保留最近行情'}
            </small>
          </div>
        </div>
      </div>

      <GlobalMarketClock />

      <div className="investments-global-quotes" aria-label="美日韩大盘行情">
        <div className="investments-global-quotes-head">
          <div>
            <strong>美日韩大盘</strong>
            <span>Yahoo Finance · 同源代理</span>
          </div>
          {globalStatus === 'loading' ? <small>更新中…</small> : null}
          {globalStatus === 'error' ? <small>{globalError || '暂时无法更新'}</small> : null}
        </div>
        <div className="investments-global-quote-grid">
          {GLOBAL_MARKET_INDEXES.map((index) => {
            const quote = globalQuoteById.get(index.id);
            const tone = getMarketTone(quote?.changePercent ?? null);
            return (
              <article
                key={index.id}
                className={`investments-global-quote-card ${tone} ${
                  flashingQuoteIds.has(`global:${index.id}`) ? 'is-updating' : ''
                } ${selectedGlobalId === index.id ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={selectedGlobalId === index.id}
                onClick={() => handleGlobalCardSelect(index.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleGlobalCardSelect(index.id);
                  }
                }}
              >
                <div className="investments-global-quote-name">
                  <span>
                    <i aria-hidden="true">{index.flag}</i>
                    {index.market}
                  </span>
                  <strong>{index.name}</strong>
                </div>
                <b>{quote ? formatMarketIndexValue(quote.value) : '--'}</b>
                <span className={tone}>{formatMarketPercent(quote?.changePercent ?? null)}</span>
              </article>
            );
          })}
        </div>
      </div>

      {selectedGlobalId && selectedGlobalIndex ? (
        <section className="investments-global-trend-panel" aria-label="国际大盘走势图">
          <div className="investments-global-trend-head">
            <div>
              <strong>
                {selectedGlobalIndex.flag} {selectedGlobalIndex.market} · {selectedGlobalIndex.name}
              </strong>
              <span>
                {selectedGlobalQuote
                  ? `${formatMarketIndexValue(
                      selectedGlobalQuote.value
                    )} · 昨收 ${formatMarketIndexValue(selectedGlobalQuote.previousClose)}`
                  : 'Yahoo Finance 实时走势'}
              </span>
            </div>
            <div className="investments-global-trend-toggle" aria-label="走势图模式">
              <button
                type="button"
                className={globalChartMode === 'line' ? 'is-active' : ''}
                onClick={() => setGlobalChartMode('line')}
              >
                分时
              </button>
              <button
                type="button"
                className={globalChartMode === 'kline' ? 'is-active' : ''}
                onClick={() => setGlobalChartMode('kline')}
              >
                K 线
              </button>
            </div>
          </div>

          <div className="investments-global-trend-stage">
            {globalChartMode === 'line' ? (
              globalTrendChart.linePath ? (
                <div
                  className="investments-market-chart-wrap"
                  onMouseLeave={() => setHoveredGlobalPointIndex(null)}
                >
                  <div
                    className="investments-market-chart-stage"
                    onMouseMove={handleGlobalTrendPointerMove}
                  >
                    <svg
                      className={`investments-market-chart ${getMarketTone(
                        selectedGlobalQuote?.changePercent
                      )}`}
                      viewBox={`0 0 ${globalTrendChart.width} ${globalTrendChart.height}`}
                      role="img"
                      aria-label={`${selectedGlobalIndex.name}实时走势`}
                    >
                      <defs>
                        <linearGradient
                          id="investments-global-market-area"
                          x1="0"
                          x2="0"
                          y1="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <path
                        className="investments-market-chart-area"
                        d={globalTrendChart.areaPath}
                      />
                      {[0, 0.5, 1].map((ratio) => (
                        <line
                          key={ratio}
                          className="investments-market-chart-grid"
                          x1={globalTrendChart.plotLeft}
                          x2={globalTrendChart.plotRight}
                          y1={
                            globalTrendChart.plotTop +
                            (globalTrendChart.plotBottom - globalTrendChart.plotTop) * ratio
                          }
                          y2={
                            globalTrendChart.plotTop +
                            (globalTrendChart.plotBottom - globalTrendChart.plotTop) * ratio
                          }
                        />
                      ))}
                      {[0, 0.5, 1].map((ratio) => (
                        <line
                          key={`baseline-${ratio}`}
                          className="investments-market-chart-baseline"
                          x1={globalTrendChart.plotLeft}
                          x2={globalTrendChart.plotRight}
                          y1={globalTrendChart.plotTop + (globalTrendChart.plotBottom - globalTrendChart.plotTop) * ratio}
                          y2={globalTrendChart.plotTop + (globalTrendChart.plotBottom - globalTrendChart.plotTop) * ratio}
                        />
                      ))}
                      {[
                        { label: globalTrendChart.max, y: globalTrendChart.plotTop },
                        { label: globalTrendChart.mid, y: (globalTrendChart.plotTop + globalTrendChart.plotBottom) / 2 },
                        { label: globalTrendChart.min, y: globalTrendChart.plotBottom }
                      ].map((axis) => (
                        <text
                          key={`${axis.label}-${axis.y}`}
                          className="investments-market-chart-axis-label"
                          x="2"
                          y={axis.y}
                          dominantBaseline="middle"
                        >
                          {axis.label === null ? '' : formatMarketIndexValue(axis.label)}
                        </text>
                      ))}
                      {globalHoveredTrendPoint ? (
                        <>
                          <line
                            className="investments-market-chart-cursor"
                            x1={globalHoveredTrendPoint.x}
                            x2={globalHoveredTrendPoint.x}
                            y1={globalTrendChart.plotTop}
                            y2={globalTrendChart.plotBottom}
                          />
                          <circle
                            className="investments-market-chart-point"
                            cx={globalHoveredTrendPoint.x}
                            cy={globalHoveredTrendPoint.y}
                            r="4.5"
                          />
                        </>
                      ) : null}
                      <path
                        className="investments-market-chart-line"
                        d={globalTrendChart.linePath}
                      />
                    </svg>
                    {globalHoveredTrendPoint ? (
                      <div
                        className="investments-market-chart-tooltip"
                        style={{
                          left: `${(globalHoveredTrendPoint.x / globalTrendChart.width) * 100}%`,
                          top: `${Math.max(
                            8,
                            ((globalHoveredTrendPoint.y - 14) / globalTrendChart.height) * 100
                          )}%`
                        }}
                        aria-hidden="true"
                      >
                        <strong>{globalHoveredTrendPoint.label}</strong>
                        <span>{formatMarketIndexValue(globalHoveredTrendPoint.value)}</span>
                      </div>
                    ) : null}
                  </div>
                  {globalTrendChart.labels.length ? (
                    <div className="investments-market-time-axis" aria-hidden="true">
                      {globalTrendChart.labels.map((label, index) => (
                        <span key={`${label}-${index}`}>{label}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="investments-market-chart-empty">
                  <strong>
                    {globalChartStatus === 'error'
                      ? '走势暂时没有连上'
                      : globalChartStatus === 'loading'
                        ? '正在加载实时走势'
                        : '等待实时走势'}
                  </strong>
                  <span>{globalChartError || 'Yahoo Finance 分时数据加载后会显示在这里。'}</span>
                </div>
              )
            ) : globalKlineChart.candles.length ? (
              <div className="investments-global-kline-wrap">
                <svg
                  className={`investments-global-kline-svg ${getMarketTone(
                    selectedGlobalQuote?.changePercent
                  )}`}
                  viewBox={`0 0 ${globalKlineChart.width} ${globalKlineChart.height}`}
                  role="img"
                  aria-label={`${selectedGlobalIndex.name}K线图`}
                >
                  {[0, 0.5, 1].map((ratio) => (
                    <line
                      key={ratio}
                      className="investments-market-chart-grid"
                      x1={globalKlineChart.plotLeft}
                      x2={globalKlineChart.plotRight}
                      y1={globalKlineChart.plotTop + (globalKlineChart.plotBottom - globalKlineChart.plotTop) * ratio}
                      y2={globalKlineChart.plotTop + (globalKlineChart.plotBottom - globalKlineChart.plotTop) * ratio}
                    />
                  ))}
                  {[
                    { label: globalKlineChart.max, y: globalKlineChart.plotTop },
                    { label: (globalKlineChart.min ?? 0) + (globalKlineChart.max && globalKlineChart.min !== null ? (globalKlineChart.max - globalKlineChart.min) / 2 : 0), y: (globalKlineChart.plotTop + globalKlineChart.plotBottom) / 2 },
                    { label: globalKlineChart.min, y: globalKlineChart.plotBottom }
                  ].map((axis) => (
                    <text
                      key={`${axis.label}-${axis.y}`}
                      className="investments-market-chart-axis-label"
                      x="2"
                      y={axis.y}
                      dominantBaseline="middle"
                    >
                      {axis.label === null ? '' : formatMarketIndexValue(axis.label)}
                    </text>
                  ))}
                  {globalKlineChart.candles.map((candle) => {
                    const bodyTop = Math.min(candle.openY, candle.closeY);
                    const bodyHeight = Math.max(2, Math.abs(candle.closeY - candle.openY));
                    return (
                      <g className={`investments-global-kline-candle ${candle.tone}`} key={candle.label}>
                        <line x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} />
                        <rect
                          x={candle.x - 3}
                          y={bodyTop}
                          width="6"
                          height={bodyHeight}
                          rx="1"
                        />
                      </g>
                    );
                  })}
                </svg>
                {globalKlineChart.labels.length ? (
                  <div className="investments-market-time-axis" aria-hidden="true">
                    {globalKlineChart.labels.map((label, index) => (
                      <span key={`${label}-${index}`}>{label}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="investments-market-chart-empty">
                <strong>
                  {globalChartStatus === 'error'
                    ? 'K 线暂时没有连上'
                    : globalChartStatus === 'loading'
                      ? '正在加载 K 线'
                      : '等待 K 线数据'}
                </strong>
                <span>{globalChartError || 'Yahoo Finance 历史 K 线加载后会显示在这里。'}</span>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <div className="investments-market-index-rail">
        <div className="investments-market-tabs" role="tablist" aria-label="大盘指数">
          {EASTMONEY_MARKET_INDEXES.map((item) => {
            const quote = quoteBySecId.get(item.secId);
            const changePercent = quote?.changePercent ?? null;
            const tone = getMarketTone(changePercent);
            return (
              <button
                key={item.secId}
                type="button"
                role="tab"
                aria-selected={selectedSecId === item.secId}
                className={`investments-market-tab ${
                  selectedSecId === item.secId ? 'is-active' : ''
                } ${tone} ${flashingQuoteIds.has(`cn:${item.secId}`) ? 'is-updating' : ''}`}
                onClick={() => onSelect(item.secId)}
              >
                <div className="investments-market-tab-name">
                  <span>
                    <i aria-hidden="true">🇨🇳</i>A 股
                  </span>
                  <strong>{item.name}</strong>
                </div>
                <b>{formatMarketIndexValue(quote?.value)}</b>
                <em>{formatMarketPercent(changePercent)}</em>
              </button>
            );
          })}
        </div>
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
                  {[0, 0.5, 1].map((ratio) => (
                    <line
                      key={ratio}
                      className="investments-market-chart-grid"
                      x1={chart.plotLeft}
                      x2={chart.plotRight}
                      y1={chart.plotTop + (chart.plotBottom - chart.plotTop) * ratio}
                      y2={chart.plotTop + (chart.plotBottom - chart.plotTop) * ratio}
                    />
                  ))}
                  {chart.mid !== null ? (
                    <line
                      className="investments-market-chart-baseline"
                      x1={chart.plotLeft}
                      x2={chart.plotRight}
                      y1={(chart.plotTop + chart.plotBottom) / 2}
                      y2={(chart.plotTop + chart.plotBottom) / 2}
                    />
                  ) : null}
                  {[
                    { label: chart.max, y: chart.plotTop },
                    { label: chart.mid, y: (chart.plotTop + chart.plotBottom) / 2 },
                    { label: chart.min, y: chart.plotBottom }
                  ].map((axis) => (
                    <text
                      key={`${axis.label}-${axis.y}`}
                      className="investments-market-chart-axis-label"
                      x="2"
                      y={axis.y}
                      dominantBaseline="middle"
                    >
                      {axis.label === null ? '' : formatMarketIndexValue(axis.label)}
                    </text>
                  ))}
                  {hoveredTrendPoint ? (
                    <>
                      <line
                        className="investments-market-chart-cursor"
                        x1={hoveredTrendPoint.x}
                        x2={hoveredTrendPoint.x}
                        y1={chart.plotTop}
                        y2={chart.plotBottom}
                      />
                      <circle
                        className="investments-market-chart-point"
                        cx={hoveredTrendPoint.x}
                        cy={hoveredTrendPoint.y}
                        r="4.5"
                      />
                    </>
                  ) : null}
                  <path className="investments-market-chart-line" d={chart.linePath} />
                </svg>
                {hoveredTrendPoint ? (
                  <div
                    className="investments-market-chart-tooltip"
                    style={{
                      left: `${(hoveredTrendPoint.x / chart.width) * 100}%`,
                      top: `${Math.max(8, ((hoveredTrendPoint.y - 14) / chart.height) * 100)}%`
                    }}
                    aria-hidden="true"
                  >
                    <strong>{hoveredTrendPoint.label}</strong>
                    <span>{formatMarketIndexValue(hoveredTrendPoint.value)}</span>
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

      <MarketHistoryAndSimulator
        secId={selectedSecId}
        indexName={activeIndex?.name || '大盘指数'}
      />

      {error && status === 'error' ? <p className="investments-market-error">{error}</p> : null}
    </section>
  );
}

type MarketBoardView = 'theme' | 'industry';

type MarketBreadth = {
  up: number;
  flat: number;
  down: number;
};

function getMarketBreadth(boards: EastmoneyMarketBoard[]): MarketBreadth {
  return boards.reduce(
    (total, board) => ({
      up: total.up + (board.upCount || 0),
      flat: total.flat + (board.flatCount || 0),
      down: total.down + (board.downCount || 0)
    }),
    { up: 0, flat: 0, down: 0 }
  );
}

function MarketBreadthDonut({ breadth, label }: { breadth: MarketBreadth; label: string }) {
  const total = breadth.up + breadth.flat + breadth.down;
  const segments = [
    { id: 'up', value: breadth.up, color: 'var(--color-danger)' },
    { id: 'flat', value: breadth.flat, color: 'var(--color-text-tertiary)' },
    { id: 'down', value: breadth.down, color: 'var(--color-success)' }
  ];
  let offset = 0;

  return (
    <div className="investments-market-breadth-chart" aria-label={`${label}涨跌分布`}>
      <div className="investments-market-breadth-donut">
        <svg viewBox="0 0 100 100" role="img" aria-label={`${label}涨平跌占比`}>
          <circle className="investments-market-breadth-track" cx="50" cy="50" r="38" />
          {total > 0
            ? segments.map((segment) => {
                const percentage = (segment.value / total) * 100;
                const currentOffset = offset;
                offset += percentage;
                if (percentage <= 0) return null;
                return (
                  <circle
                    key={segment.id}
                    cx="50"
                    cy="50"
                    r="38"
                    pathLength="100"
                    stroke={segment.color}
                    strokeDasharray={`${percentage} ${100 - percentage}`}
                    strokeDashoffset={-currentOffset}
                    transform="rotate(-90 50 50)"
                  />
                );
              })
            : null}
        </svg>
        <div>
          <strong>{total || '--'}</strong>
          <span>样本</span>
        </div>
      </div>
      <div className="investments-market-breadth-legend">
        <span className="is-up">
          涨 <b>{breadth.up || '--'}</b>
        </span>
        <span>
          平 <b>{breadth.flat || '--'}</b>
        </span>
        <span className="is-down">
          跌 <b>{breadth.down || '--'}</b>
        </span>
      </div>
    </div>
  );
}

function MarketBoardsPanel({
  themeBoards,
  industryBoards,
  trackedThemes,
  conceptBoards,
  constituents,
  view,
  selectedThemeCode,
  status,
  error,
  onSelectView,
  onSelectTheme,
  onAddTheme,
  onRenameTheme,
  onRemoveTheme,
  onRefresh
}: {
  themeBoards: EastmoneyMarketBoard[];
  industryBoards: EastmoneyMarketBoard[];
  trackedThemes: EastmoneyMarketTheme[];
  conceptBoards: EastmoneyMarketBoard[];
  constituents: Record<string, EastmoneyMarketConstituent[]>;
  view: MarketBoardView;
  selectedThemeCode: string;
  status: 'idle' | 'loading' | 'error';
  error: string;
  onSelectView: (view: MarketBoardView) => void;
  onSelectTheme: (code: string) => void;
  onAddTheme: (code: string) => void;
  onRenameTheme: (code: string, name: string) => void;
  onRemoveTheme: (code: string) => void;
  onRefresh: () => void;
}) {
  const [newThemeCode, setNewThemeCode] = useState('');
  const [editingThemeCode, setEditingThemeCode] = useState('');
  const [editingThemeName, setEditingThemeName] = useState('');
  const availableConceptBoards = conceptBoards.filter(
    (board) => !trackedThemes.some((theme) => theme.code === board.code)
  );
  const boardUniverse = [...(view === 'theme' ? themeBoards : industryBoards)]
    .filter((board) => board.code)
    .sort(
      (a, b) =>
        (b.changePercent ?? Number.NEGATIVE_INFINITY) -
        (a.changePercent ?? Number.NEGATIVE_INFINITY)
    );
  const visibleBoards = boardUniverse.slice(0, 6);
  const breadth = getMarketBreadth(boardUniverse);

  return (
    <section
      className={`panel investments-market-boards-panel ${status === 'loading' ? 'is-loading' : ''}`}
      aria-label="行业和概念板块监控"
    >
      <div className="investments-market-news-head">
        <div>
          <h3>板块健康度</h3>
          <p>同时看多个板块，再看领涨公司，先判断市场是在普涨还是轮动。</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={status === 'loading'}>
          {status === 'loading' ? '刷新中' : '刷新'}
        </button>
      </div>

      <div className="investments-market-board-tabs" role="tablist" aria-label="板块类型">
        {(
          [
            ['theme', '热门题材'],
            ['industry', '行业榜']
          ] as const
        ).map(([itemView, label]) => (
          <button
            key={itemView}
            type="button"
            role="tab"
            aria-selected={view === itemView}
            className={view === itemView ? 'is-active' : ''}
            onClick={() => onSelectView(itemView)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && status === 'error' ? (
        <p className="investments-market-news-error">{error}</p>
      ) : null}

      {view === 'theme' ? (
        <>
          <label className="investments-market-theme-select">
            <span>跟踪题材</span>
            <select
              aria-label="选择热门题材"
              value={selectedThemeCode}
              onChange={(event) => onSelectTheme(event.target.value)}
            >
              {trackedThemes.length === 0 ? <option value="">暂未跟踪题材</option> : null}
              {trackedThemes.map((theme) => (
                <option key={theme.code} value={theme.code}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>

          <div className="investments-market-theme-actions">
            <select
              aria-label="添加可跟踪题材"
              value={newThemeCode}
              onChange={(event) => setNewThemeCode(event.target.value)}
            >
              <option value="">从东方财富概念板块中选择</option>
              {availableConceptBoards.map((theme) => (
                <option key={theme.code} value={theme.code}>
                  {theme.name} · {theme.code}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!newThemeCode}
              onClick={() => {
                onAddTheme(newThemeCode);
                setNewThemeCode('');
              }}
            >
              添加
            </button>
          </div>

          <details className="investments-market-theme-manager">
            <summary>管理已跟踪题材</summary>
            <div>
              {trackedThemes.map((theme) => (
                <div className="investments-market-theme-manager-row" key={theme.code}>
                  {editingThemeCode === theme.code ? (
                    <input
                      aria-label={`修改 ${theme.name} 的显示名称`}
                      value={editingThemeName}
                      onChange={(event) => setEditingThemeName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          onRenameTheme(theme.code, editingThemeName);
                          setEditingThemeCode('');
                        }
                        if (event.key === 'Escape') setEditingThemeCode('');
                      }}
                    />
                  ) : (
                    <span>
                      <strong>{theme.name}</strong>
                      <small>{theme.code}</small>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (editingThemeCode === theme.code) {
                        onRenameTheme(theme.code, editingThemeName);
                        setEditingThemeCode('');
                        return;
                      }
                      setEditingThemeCode(theme.code);
                      setEditingThemeName(theme.name);
                    }}
                  >
                    {editingThemeCode === theme.code ? '保存' : '修改'}
                  </button>
                  <button type="button" onClick={() => onRemoveTheme(theme.code)}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          </details>

          <div className="investments-market-board-overview">
            <MarketBreadthDonut breadth={breadth} label="热门题材" />
            <div>
              <strong>{visibleBoards.length || '--'} 个板块</strong>
              <span>按涨跌幅展示前 6 个，卡片内列出领涨公司</span>
            </div>
          </div>
          <div className="investments-market-board-grid">
            {visibleBoards.map((board, index) => {
              const boardConstituents = constituents[board.code] || [];
              const health = getBoardHealth(board.changePercent);
              return (
                <article
                  className={`investments-market-board-card ${
                    board.code === selectedThemeCode ? 'is-selected' : ''
                  }`}
                  key={board.code || `${board.name}-${index}`}
                >
                  <div className="investments-market-board-card-head">
                    <div>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong title={board.name}>{board.name}</strong>
                    </div>
                    <b className={getMarketTone(board.changePercent)}>
                      {formatMarketPercent(board.changePercent)}
                    </b>
                  </div>
                  <div className="investments-market-board-card-meta">
                    <span>{formatMarketIndexValue(board.value)}</span>
                    <em className={`investments-board-health ${health.className}`}>
                      {health.emoji} {health.label}
                    </em>
                  </div>
                  <div className="investments-market-board-card-stocks">
                    <small>领涨公司</small>
                    {boardConstituents.length > 0 ? (
                      boardConstituents.slice(0, 3).map((stock) => (
                        <div key={stock.code || stock.name}>
                          <span title={stock.name}>{stock.name}</span>
                          <b className={getMarketTone(stock.changePercent)}>
                            {formatMarketPercent(stock.changePercent)}
                          </b>
                        </div>
                      ))
                    ) : (
                      <span className="investments-market-board-card-loading">
                        {status === 'loading' ? '正在同步公司行情…' : '公司行情暂缺'}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <p className="investments-market-source-note">
            数据源：东方财富公开板块与成分股行情 · 服务端同源代理 · 仅展示涨幅靠前公司
          </p>
        </>
      ) : industryBoards.length === 0 && status !== 'loading' ? (
        <div className="investments-market-news-empty">
          <strong>暂无行业数据</strong>
          <span>稍后刷新，或切换回热门题材。</span>
        </div>
      ) : (
        <>
          <div className="investments-market-board-overview">
            <MarketBreadthDonut breadth={breadth} label="行业榜" />
            <div>
              <strong>{visibleBoards.length || '--'} 个行业</strong>
              <span>行业强弱与领涨公司一起看，减少只盯一个榜首的误判</span>
            </div>
          </div>
          <div className="investments-market-board-grid">
            {visibleBoards.map((board, index) => {
              const boardConstituents = constituents[board.code] || [];
              const health = getBoardHealth(board.changePercent);
              return (
                <article className="investments-market-board-card" key={board.code || `${board.name}-${index}`}>
                  <div className="investments-market-board-card-head">
                    <div>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong title={board.name}>{board.name}</strong>
                    </div>
                    <b className={getMarketTone(board.changePercent)}>
                      {formatMarketPercent(board.changePercent)}
                    </b>
                  </div>
                  <div className="investments-market-board-card-meta">
                    <span>{formatMarketIndexValue(board.value)}</span>
                    <em className={`investments-board-health ${health.className}`}>
                      {health.emoji} {health.label}
                    </em>
                  </div>
                  <div className="investments-market-board-card-stocks">
                    <small>领涨公司</small>
                    {boardConstituents.length > 0 ? (
                      boardConstituents.slice(0, 3).map((stock) => (
                        <div key={stock.code || stock.name}>
                          <span title={stock.name}>{stock.name}</span>
                          <b className={getMarketTone(stock.changePercent)}>
                            {formatMarketPercent(stock.changePercent)}
                          </b>
                        </div>
                      ))
                    ) : (
                      <span className="investments-market-board-card-loading">
                        {status === 'loading' ? '正在同步公司行情…' : '公司行情暂缺'}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
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
      <p className="investments-market-source-note">
        数据源：东方财富 7×24 快讯 · 服务端同源代理，避免部署环境浏览器跨域拦截
      </p>
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

  if (/(个股|股票|stock)/i.test(searchText)) {
    return 'stock';
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

export function InvestmentsPage() {
  const transactions = useFinanceStore((state) => state.transactions);
  const positions = useAppPreferences((state) => state.investmentPositions);
  const investmentWatchlist = useAppPreferences((state) => state.investmentWatchlist);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const removeInvestmentWatchItem = useAppPreferences((state) => state.removeInvestmentWatchItem);
  const upsertInvestmentWatchItem = useAppPreferences((state) => state.upsertInvestmentWatchItem);
  const { baseUrl, apiKey, model } = useAiSettings();

  const [fundLookupCode, setFundLookupCode] = useState('');
  const [fundLookupStatus, setFundLookupStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fundLookupError, setFundLookupError] = useState('');
  const [stockLookupQuery, setStockLookupQuery] = useState('');
  const [stockLookupResults, setStockLookupResults] = useState<EastmoneyStockSearchResult[]>([]);
  const [stockLookupStatus, setStockLookupStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [stockLookupError, setStockLookupError] = useState('');
  const [selectedWatchCategoryId, setSelectedWatchCategoryId] =
    useState<WatchCategoryFilterId>('all');
  const [watchGridColumns, setWatchGridColumns] = useState<WatchGridColumnCount>(3);
  const [watchDisplayMode, setWatchDisplayMode] = useState<WatchDisplayMode>('grid');
  const [refreshingWatchItemId, setRefreshingWatchItemId] = useState<string | null>(null);
  const [refreshingAllWatchItems, setRefreshingAllWatchItems] = useState(false);
  const [editingWatchHoldingId, setEditingWatchHoldingId] = useState<string | null>(null);
  const [editingWatchHoldingValue, setEditingWatchHoldingValue] = useState('');
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
  const [globalMarketQuotes, setGlobalMarketQuotes] = useState<GlobalMarketQuote[]>([]);
  const [globalMarketStatus, setGlobalMarketStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [globalMarketError, setGlobalMarketError] = useState('');
  const hasMarketOverviewRef = useRef(false);
  const hasGlobalMarketQuotesRef = useRef(false);
  const [selectedNewsCategoryId, setSelectedNewsCategoryId] = useState(
    EASTMONEY_MARKET_NEWS_CATEGORIES[0].id
  );
  const [investmentWorkspace, setInvestmentWorkspace] = useState<InvestmentWorkspace>('overview');
  const [marketNews, setMarketNews] = useState<EastmoneyMarketNewsItem[]>([]);
  const [marketNewsStatus, setMarketNewsStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [marketNewsError, setMarketNewsError] = useState('');
  const [marketBoardView, setMarketBoardView] = useState<MarketBoardView>('theme');
  const [trackedMarketThemes, setTrackedMarketThemes] =
    useState<EastmoneyMarketTheme[]>(readTrackedMarketThemes);
  const [selectedMarketThemeCode, setSelectedMarketThemeCode] = useState(
    () => readTrackedMarketThemes()[0]?.code || ''
  );
  const [marketThemeBoards, setMarketThemeBoards] = useState<EastmoneyMarketBoard[]>([]);
  const [marketIndustryBoards, setMarketIndustryBoards] = useState<EastmoneyMarketBoard[]>([]);
  const [marketConceptBoards, setMarketConceptBoards] = useState<EastmoneyMarketBoard[]>([]);
  const [marketBoardConstituents, setMarketBoardConstituents] = useState<
    Record<string, EastmoneyMarketConstituent[]>
  >({});
  const [marketBoardsStatus, setMarketBoardsStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [marketBoardsError, setMarketBoardsError] = useState('');
  const [holdingStockQuotes, setHoldingStockQuotes] = useState<
    Map<string, EastmoneyHoldingStockQuote>
  >(() => new Map());
  const [marketInsight, setMarketInsight] = useState<InvestmentMarketInsight | null>(null);
  const [marketInsightStatus, setMarketInsightStatus] = useState<MarketInsightStatus>('disabled');
  const marketInsightRequestAtRef = useRef(0);
  const marketInsightRequestInFlightRef = useRef(false);
  const trackedMarketThemesKey = trackedMarketThemes
    .map((theme) => `${theme.code}:${theme.name}`)
    .join('|');

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

  const monthlyInvestableCash = useMemo(() => {
    const baseline = monthlyIncome > 0 ? monthlyIncome - monthExpenseTotal : monthNetBalance;
    return Math.max(0, baseline);
  }, [monthExpenseTotal, monthNetBalance, monthlyIncome]);

  const averageMarketChange = useMemo(
    () => getAverageMarketChange(marketOverview),
    [marketOverview]
  );

  const marketAlgorithmSignals = useMemo(
    () =>
      buildMarketAlgorithmSignals({
        marketChange: averageMarketChange,
        themeBoards: marketThemeBoards,
        industryBoards: marketIndustryBoards,
        news: marketNews,
        positions: activePositions,
        watchlist: investmentWatchlist,
        totalCurrentValue: positionSummary.totalCurrentValue
      }),
    [
      activePositions,
      averageMarketChange,
      investmentWatchlist,
      marketIndustryBoards,
      marketNews,
      marketThemeBoards,
      positionSummary.totalCurrentValue
    ]
  );

  const marketInsightFingerprint = useMemo(
    () =>
      JSON.stringify({
        marketChange: averageMarketChange,
        signals: marketAlgorithmSignals,
        marketQuotes: (marketOverview?.quotes || []).map((item) => [
          item.secId,
          item.value,
          item.changePercent
        ]),
        themes: marketThemeBoards.map((item) => [item.code, item.changePercent]),
        industries: marketIndustryBoards.map((item) => [item.code, item.changePercent]),
        news: marketNews.slice(0, 8).map((item) => [item.id, item.title, item.summary]),
        positions: activePositions.map((item) => [item.id, item.currentValue, item.investedAmount]),
        watchlist: investmentWatchlist.map((item) => [
          item.id,
          item.holdingShares,
          item.netValue,
          item.addedReturn
        ])
      }),
    [
      activePositions,
      averageMarketChange,
      investmentWatchlist,
      marketAlgorithmSignals,
      marketIndustryBoards,
      marketNews,
      marketOverview?.quotes,
      marketThemeBoards
    ]
  );
  const marketInsightProfileKey = useMemo(
    () =>
      JSON.stringify({
        positions: activePositions.map((item) => item.id),
        watchlist: investmentWatchlist.map((item) => item.id)
      }),
    [activePositions, investmentWatchlist]
  );

  const ruleSuggestions = useMemo(
    () =>
      buildRuleSuggestions({
        positions: activePositions,
        marketChange: averageMarketChange,
        monthlyInvestableCash,
        algorithmSignals: marketAlgorithmSignals
      }),
    [activePositions, averageMarketChange, marketAlgorithmSignals, monthlyInvestableCash]
  );

  const watchCategoryCounts = useMemo<Record<WatchCategoryFilterId, number>>(() => {
    const counts: Record<WatchCategoryFilterId, number> = {
      all: investmentWatchlist.length,
      stock: 0,
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

  const holdingStockSecIds = useMemo(
    () =>
      Array.from(
        new Set(
          investmentWatchlist
            .flatMap((item) => item.fundHoldings || [])
            .map(getFundHoldingStockCode)
            .map(getFundHoldingStockSecId)
            .filter(Boolean)
        )
      ).slice(0, 32),
    [investmentWatchlist]
  );
  const holdingStockSecIdsKey = holdingStockSecIds.join(',');

  const marketContextSummary = useMemo(() => {
    const selectedTheme =
      marketThemeBoards.find((item) => item.code === selectedMarketThemeCode) ||
      marketThemeBoards[0] ||
      null;
    const toBoardContext = (board: EastmoneyMarketBoard) => ({
      name: board.name,
      code: board.code,
      value: board.value,
      changePercent: board.changePercent,
      amount: board.amount,
      upCount: board.upCount,
      flatCount: board.flatCount,
      downCount: board.downCount
    });
    const recentMarketNews = marketNews.slice(0, 5).map((item) => ({
      time: formatMarketNewsTime(item.time),
      title: item.title,
      summary: item.summary,
      stocks: item.stocks.slice(0, 4)
    }));
    const policySignals = marketNews
      .filter((item) => isPolicySignalText(`${item.title} ${item.summary}`))
      .slice(0, 5)
      .map((item) => ({
        time: formatMarketNewsTime(item.time),
        title: item.title,
        summary: item.summary
      }));

    return JSON.stringify(
      {
        source: '东方财富实时行情',
        updatedAt: marketOverview?.updatedAt || '',
        marketIndexes: (marketOverview?.quotes || []).slice(0, 4).map((quote) => ({
          name: quote.name,
          code: quote.code,
          value: quote.value,
          changePercent: quote.changePercent,
          amount: quote.amount
        })),
        globalIndexes: globalMarketQuotes.map((quote) => ({
          market: quote.market,
          name: quote.name,
          symbol: quote.symbol,
          value: quote.value,
          changePercent: quote.changePercent,
          updatedAt: quote.updatedAt,
          source: quote.source
        })),
        selectedHotTheme: selectedTheme ? toBoardContext(selectedTheme) : null,
        hotThemes: marketThemeBoards.slice(0, 8).map(toBoardContext),
        industryLeaders: marketIndustryBoards.slice(0, 5).map(toBoardContext),
        socialNews: recentMarketNews,
        policySignals,
        newsCategory:
          EASTMONEY_MARKET_NEWS_CATEGORIES.find((item) => item.id === selectedNewsCategoryId)
            ?.label || ''
      },
      null,
      2
    );
  }, [
    marketIndustryBoards,
    globalMarketQuotes,
    marketNews,
    marketOverview,
    marketThemeBoards,
    selectedMarketThemeCode,
    selectedNewsCategoryId
  ]);

  useEffect(() => {
    const minimumIntervalMs = 15 * 60 * 1000;
    if (!apiKey.trim() || !baseUrl.trim()) {
      setMarketInsightStatus('disabled');
      return;
    }
    const hasAnyMarketContext = Boolean(
      marketOverview || marketThemeBoards.length || marketIndustryBoards.length || marketNews.length
    );
    if (
      !hasAnyMarketContext &&
      (marketStatus === 'loading' ||
        marketBoardsStatus === 'loading' ||
        marketNewsStatus === 'loading')
    ) {
      setMarketInsightStatus('waiting');
      return;
    }

    const cacheKey = 'ledgerflow-investment-market-insight-v1';
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null') as {
        generatedAt?: string;
        profileKey?: string;
        insight?: InvestmentMarketInsight;
      } | null;
      const generatedAt = cached?.generatedAt ? Date.parse(cached.generatedAt) : 0;
      if (
        cached?.insight &&
        cached.profileKey === marketInsightProfileKey &&
        generatedAt > 0 &&
        Date.now() - generatedAt < minimumIntervalMs
      ) {
        setMarketInsight({
          ...cached.insight,
          source: 'ai',
          generatedAt: cached.generatedAt
        });
        setMarketInsightStatus('ready');
        marketInsightRequestAtRef.current = generatedAt;
        return;
      }
    } catch {
      // Ignore malformed session cache and continue with a fresh, rate-limited request.
    }

    if (
      marketInsightRequestInFlightRef.current ||
      Date.now() - marketInsightRequestAtRef.current < minimumIntervalMs
    ) {
      setMarketInsightStatus((current) => {
        if (marketInsight) return 'ready';
        return current === 'error' || current === 'loading' ? current : 'waiting';
      });
      return;
    }

    setMarketInsightStatus('waiting');
    const timer = window.setTimeout(() => {
      if (marketInsightRequestInFlightRef.current) return;
      marketInsightRequestInFlightRef.current = true;
      marketInsightRequestAtRef.current = Date.now();
      setMarketInsightStatus('loading');

      void (async () => {
        try {
          const timeContext = await buildTimeContext();
          let fullContent = '';
          const result = await sendAiChatStream(
            {
              baseUrl,
              apiKey,
              model,
              systemPrompt: buildInvestmentMarketInsightPrompt({
                marketContext: marketContextSummary,
                algorithmSignals: JSON.stringify(marketAlgorithmSignals, null, 2),
                positions: activePositions,
                watchlist: investmentWatchlist,
                monthlyInvestableCash,
                timeContext
              }),
              messages: [
                {
                  role: 'user',
                  text: '请生成今天的市场简报和今天怎么做，必须结合最新新闻、热点和板块数据。'
                }
              ]
            },
            {
              onDelta: (delta) => {
                fullContent += delta;
              }
            }
          );

          const insight = extractInvestmentMarketInsight(result.content || fullContent);
          if (!insight) {
            setMarketInsightStatus('error');
            return;
          }
          const generatedAt = new Date().toISOString();
          const nextInsight = { ...insight, source: 'ai' as const, generatedAt };
          setMarketInsight(nextInsight);
          setMarketInsightStatus('ready');
          try {
            sessionStorage.setItem(
              cacheKey,
              JSON.stringify({
                generatedAt,
                profileKey: marketInsightProfileKey,
                insight: nextInsight
              })
            );
          } catch {
            // Ignore storage quota or privacy-mode errors; the current page still shows the result.
          }
        } catch {
          setMarketInsightStatus('error');
          // Keep the local algorithm visible when the configured model is unavailable.
        } finally {
          marketInsightRequestInFlightRef.current = false;
        }
      })();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [
    activePositions,
    apiKey,
    baseUrl,
    marketAlgorithmSignals,
    marketBoardsStatus,
    marketContextSummary,
    marketIndustryBoards,
    marketNewsStatus,
    marketNews,
    marketStatus,
    marketInsight,
    marketInsightProfileKey,
    marketOverview,
    marketThemeBoards,
    model,
    monthlyInvestableCash,
    investmentWatchlist,
    marketInsightFingerprint
  ]);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    async function loadMarketData(showLoading = false) {
      if (requestInFlight) return;
      requestInFlight = true;
      if (showLoading) {
        setMarketStatus('loading');
        setGlobalMarketStatus('loading');
      }
      setMarketError('');
      setGlobalMarketError('');

      const [marketResult, globalResult] = await Promise.allSettled([
        fetchEastmoneyMarketOverview(selectedMarketSecId),
        fetchGlobalMarketOverview()
      ]);
      if (cancelled) return;

      if (marketResult.status === 'fulfilled') {
        setMarketOverview(marketResult.value);
        hasMarketOverviewRef.current = true;
        setMarketStatus('idle');
      } else if (!hasMarketOverviewRef.current) {
        setMarketError(
          marketResult.reason instanceof Error
            ? marketResult.reason.message
            : '大盘行情加载失败，请稍后重试。'
        );
        setMarketStatus('error');
      }

      if (globalResult.status === 'fulfilled' && globalResult.value.quotes.length > 0) {
        setGlobalMarketQuotes(globalResult.value.quotes);
        hasGlobalMarketQuotesRef.current = true;
        setGlobalMarketStatus('idle');
      } else if (!hasGlobalMarketQuotesRef.current) {
        setGlobalMarketError(
          globalResult.status === 'rejected' && globalResult.reason instanceof Error
            ? globalResult.reason.message
            : '美日韩大盘暂时无法更新。'
        );
        setGlobalMarketStatus('error');
      }
      requestInFlight = false;
    }

    void loadMarketData(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && isLiveMarketPollingTime()) {
        void loadMarketData();
      }
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
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

  useEffect(() => {
    try {
      localStorage.setItem(MARKET_THEME_STORAGE_KEY, JSON.stringify(trackedMarketThemes));
    } catch {
      // The current session still keeps the customized list when storage is unavailable.
    }
    if (
      trackedMarketThemes.length > 0 &&
      !trackedMarketThemes.some((theme) => theme.code === selectedMarketThemeCode)
    ) {
      setSelectedMarketThemeCode(trackedMarketThemes[0].code);
    }
  }, [selectedMarketThemeCode, trackedMarketThemes, trackedMarketThemesKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadMarketBoards() {
      setMarketBoardsStatus('loading');
      setMarketBoardsError('');

      try {
        const [themesResult, industriesResult, conceptsResult] = await Promise.allSettled([
          fetchEastmoneyMarketThemeBoards(trackedMarketThemes),
          fetchEastmoneyMarketBoards('industry'),
          fetchEastmoneyMarketBoards('concept', 200)
        ]);
        if (cancelled) return;
        if (themesResult.status === 'fulfilled') setMarketThemeBoards(themesResult.value);
        if (industriesResult.status === 'fulfilled')
          setMarketIndustryBoards(industriesResult.value);
        if (conceptsResult.status === 'fulfilled') setMarketConceptBoards(conceptsResult.value);

        if (
          themesResult.status === 'rejected' &&
          industriesResult.status === 'rejected' &&
          conceptsResult.status === 'rejected'
        ) {
          throw new Error('板块行情加载失败，请稍后重试。');
        }

        setMarketBoardsStatus('idle');
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '板块行情加载失败，请稍后重试。';
        setMarketBoardsError(message);
        setMarketBoardsStatus('error');
      }
    }

    loadMarketBoards();

    return () => {
      cancelled = true;
    };
  }, [trackedMarketThemes, trackedMarketThemesKey]);

  useEffect(() => {
    const boards = [...(marketBoardView === 'theme' ? marketThemeBoards : marketIndustryBoards)]
      .filter((board) => board.code)
      .sort(
        (a, b) =>
          (b.changePercent ?? Number.NEGATIVE_INFINITY) -
          (a.changePercent ?? Number.NEGATIVE_INFINITY)
      )
      .slice(0, 6);
    if (boards.length === 0) return;

    let cancelled = false;
    Promise.allSettled(
      boards.map(async (board) => ({
        code: board.code,
        stocks: await fetchEastmoneyMarketBoardConstituents(board.code, 3)
      }))
    ).then((results) => {
      if (cancelled) return;
      setMarketBoardConstituents((current) => {
        const next = { ...current };
        results.forEach((result) => {
          if (result.status === 'fulfilled') next[result.value.code] = result.value.stocks;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [marketBoardView, marketIndustryBoards, marketThemeBoards]);

  useEffect(() => {
    if (holdingStockSecIds.length === 0) {
      setHoldingStockQuotes(new Map());
      return;
    }

    let cancelled = false;

    async function loadHoldingStockQuotes() {
      try {
        const quotes = await fetchEastmoneyHoldingStockQuotes(holdingStockSecIds);
        if (cancelled) return;
        setHoldingStockQuotes(new Map(quotes.map((quote) => [quote.code, quote])));
      } catch {
        // Preserve the last successful quote while the upstream market feed recovers.
      }
    }

    void loadHoldingStockQuotes();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && isLiveMarketPollingTime()) {
        void loadHoldingStockQuotes();
      }
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [holdingStockSecIds, holdingStockSecIdsKey]);

  function setToastState(message: string, variant: ToastVariant = 'success') {
    setToast({ visible: true, message, variant });
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

  async function refreshMarketBoards() {
    if (marketBoardsStatus === 'loading') return;

    setMarketBoardsStatus('loading');
    setMarketBoardsError('');

    try {
      const [themesResult, industriesResult, conceptsResult] = await Promise.allSettled([
        fetchEastmoneyMarketThemeBoards(trackedMarketThemes),
        fetchEastmoneyMarketBoards('industry'),
        fetchEastmoneyMarketBoards('concept', 200)
      ]);
      if (themesResult.status === 'fulfilled') setMarketThemeBoards(themesResult.value);
      if (industriesResult.status === 'fulfilled') setMarketIndustryBoards(industriesResult.value);
      if (conceptsResult.status === 'fulfilled') setMarketConceptBoards(conceptsResult.value);
      if (
        themesResult.status === 'rejected' &&
        industriesResult.status === 'rejected' &&
        conceptsResult.status === 'rejected'
      ) {
        throw new Error('板块行情加载失败，请稍后重试。');
      }
      setMarketBoardsStatus('idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : '板块行情加载失败，请稍后重试。';
      setMarketBoardsError(message);
      setMarketBoardsStatus('error');
      setToastState(message, 'warning');
    }
  }

  function handleAddMarketTheme(code: string) {
    const theme = marketConceptBoards.find((item) => item.code === code);
    if (!theme || trackedMarketThemes.some((item) => item.code === code)) return;
    setTrackedMarketThemes((current) => [...current, { code: theme.code, name: theme.name }]);
    setSelectedMarketThemeCode(theme.code);
    setToastState(`已添加题材“${theme.name}”。`);
  }

  function handleRenameMarketTheme(code: string, name: string) {
    const normalizedName = name.trim().slice(0, 24);
    if (!normalizedName) return;
    setTrackedMarketThemes((current) =>
      current.map((item) => (item.code === code ? { ...item, name: normalizedName } : item))
    );
  }

  function handleRemoveMarketTheme(code: string) {
    const target = trackedMarketThemes.find((item) => item.code === code);
    const nextThemes = trackedMarketThemes.filter((item) => item.code !== code);
    setTrackedMarketThemes(nextThemes);
    if (selectedMarketThemeCode === code) {
      setSelectedMarketThemeCode(nextThemes[0]?.code || '');
    }
    if (target) setToastState(`已移除题材“${target.name}”。`);
  }

  function toggleWatchItemDetails(itemId: string) {
    setExpandedWatchItemId((current) => (current === itemId ? null : itemId));
  }

  function handleWatchCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, itemId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleWatchItemDetails(itemId);
  }

  function handleStartEditingWatchHoldingShares(item: InvestmentWatchItem) {
    setEditingWatchHoldingId(item.id);
    setEditingWatchHoldingValue(
      typeof item.holdingShares === 'number' && Number.isFinite(item.holdingShares)
        ? String(item.holdingShares)
        : ''
    );
  }

  function handleCommitWatchHoldingShares(item: InvestmentWatchItem) {
    const cleaned = editingWatchHoldingValue.trim();
    const shares = cleaned ? Number(cleaned.replace(/[，,\s]/g, '')) : undefined;
    if (cleaned && (!Number.isFinite(shares as number) || (shares as number) < 0)) {
      setToastState('请输入有效的持有份额。', 'warning');
      return;
    }

    upsertInvestmentWatchItem({
      ...item,
      holdingShares: shares === undefined ? undefined : Number((shares as number).toFixed(2)),
      updatedAt: new Date().toISOString()
    });
    setEditingWatchHoldingId(null);
    setEditingWatchHoldingValue('');
    setToastState(
      shares === undefined
        ? `已清空“${item.name}”的持有份额。`
        : `已更新“${item.name}”持有 ${formatHoldingShares(shares)}。`
    );
  }

  function handleCancelEditingWatchHoldingShares() {
    setEditingWatchHoldingId(null);
    setEditingWatchHoldingValue('');
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

  async function handleStockLookupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const query = stockLookupQuery.trim();
    if (!query || stockLookupStatus === 'loading') return;

    setStockLookupStatus('loading');
    setStockLookupError('');

    try {
      const results = await fetchEastmoneyStockSearch(query);
      setStockLookupResults(results);
      setStockLookupStatus('idle');
      if (results.length === 0) {
        setStockLookupError('没有搜到匹配个股，换个名称或代码试试。');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '个股搜索失败，请稍后重试。';
      setStockLookupError(message);
      setStockLookupStatus('error');
    }
  }

  function handleAddStockWatchItem(result: EastmoneyStockSearchResult) {
    const existing = investmentWatchlist.find(
      (item) =>
        item.code === result.code ||
        (item.tags.includes('个股') && item.name === result.name)
    );

    upsertInvestmentWatchItem({
      id: existing?.id,
      name: result.name,
      code: result.code,
      platform: existing?.platform || '东方财富',
      tags: existing?.tags?.length
        ? Array.from(new Set(['个股', ...existing.tags])).slice(0, 8)
        : ['个股', '东方财富'],
      note:
        existing?.note ||
        [result.securityTypeName, result.market ? `市场 ${result.market}` : '', result.secId]
          .filter(Boolean)
          .join(' · '),
      lastVerdict: existing?.lastVerdict || '已加入个股自选',
      lastSummary: existing?.lastSummary || '手动添加的个股自选，可在卡片中记录持有份额。',
      investmentAdvice: existing?.investmentAdvice || '先观察行情与异动，再决定是否建仓。',
      adviceReasons: existing?.adviceReasons || [],
      riskNotes: existing?.riskNotes || [],
      nextActions: existing?.nextActions || [],
      holdingShares: existing?.holdingShares,
      lastAnalysisAt: existing?.lastAnalysisAt || new Date().toISOString()
    });

    setSelectedWatchCategoryId('stock');
    setStockLookupResults((current) => current.filter((stock) => stock.code !== result.code));
    setStockLookupQuery('');
    setToastState(`已关注“${result.name}”。`);
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

  return (
    <div className="page-stack investments-page investments-management-page investments-console-page">
      <header className="investments-console-header">
        <div>
          <p className="investments-console-eyebrow">INVESTMENT CONTROL</p>
          <h1>投资理财</h1>
          <p>把今日判断、行情监控和基金自选放进一个工作台，按需切换，不再上下堆叠。</p>
        </div>
        <div className="investments-console-stat" aria-label="当前投资概览">
          <strong>{formatCurrencyAuto(positionSummary.totalCurrentValue)}</strong>
          <span>{investmentWatchlist.length} 只自选 · 今日 {formatMarketPercent(averageMarketChange)}</span>
        </div>
      </header>

      <nav className="investments-console-tabs" aria-label="投资理财板块">
        {(
          [
            ['overview', '今日总览'],
            ['market', '大盘行情'],
            ['boards', '板块监控'],
            ['watchlist', '基金自选'],
            ['news', '市场快讯']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={investmentWorkspace === key ? 'is-active' : undefined}
            aria-current={investmentWorkspace === key ? 'page' : undefined}
            onClick={() => setInvestmentWorkspace(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="investments-console-workspace">
        {investmentWorkspace === 'overview' ? (
          <section
            className="investments-core-grid investments-workspace-overview"
            aria-label="今日投资看板"
          >
            <HoldingsTodayPanel
              positions={activePositions}
              watchlist={investmentWatchlist}
              totalCurrentValue={positionSummary.totalCurrentValue}
              totalProfit={positionSummary.totalProfit}
              profitRate={positionSummary.profitRate}
              marketChange={averageMarketChange}
            />
            <PlainMarketBriefingPanel
              marketChange={averageMarketChange}
              themeBoards={marketThemeBoards}
              news={marketNews}
              insight={marketInsight}
              algorithmSignals={marketAlgorithmSignals}
              insightStatus={marketInsightStatus}
            />
            <RuleSuggestionsPanel
              suggestions={
                marketInsight?.suggestions.length ? marketInsight.suggestions : ruleSuggestions
              }
              insight={marketInsight}
              algorithmSignals={marketAlgorithmSignals}
            />
          </section>
        ) : null}

        {investmentWorkspace === 'market' ? (
          <section className="investments-workspace-market" aria-label="大盘和市场监控">
            <MarketOverviewPanel
              overview={marketOverview}
              globalQuotes={globalMarketQuotes}
              globalStatus={globalMarketStatus}
              globalError={globalMarketError}
              selectedSecId={selectedMarketSecId}
              status={marketStatus}
              error={marketError}
              onSelect={setSelectedMarketSecId}
            />
          </section>
        ) : null}

        {investmentWorkspace === 'boards' ? (
          <section className="investments-workspace-boards" aria-label="行业和概念板块监控">
            <MarketBoardsPanel
              themeBoards={marketThemeBoards}
              industryBoards={marketIndustryBoards}
              trackedThemes={trackedMarketThemes}
              conceptBoards={marketConceptBoards}
              constituents={marketBoardConstituents}
              view={marketBoardView}
              selectedThemeCode={selectedMarketThemeCode}
              status={marketBoardsStatus}
              error={marketBoardsError}
              onSelectView={setMarketBoardView}
              onSelectTheme={setSelectedMarketThemeCode}
              onAddTheme={handleAddMarketTheme}
              onRenameTheme={handleRenameMarketTheme}
              onRemoveTheme={handleRemoveMarketTheme}
              onRefresh={refreshMarketBoards}
            />
          </section>
        ) : null}

        {investmentWorkspace === 'news' ? (
          <section className="investments-workspace-news" aria-label="市场快讯">
            <MarketNewsPanel
              news={marketNews}
              selectedCategoryId={selectedNewsCategoryId}
              status={marketNewsStatus}
              error={marketNewsError}
              onSelectCategory={setSelectedNewsCategoryId}
              onRefresh={refreshMarketNews}
            />
          </section>
        ) : null}

        {investmentWorkspace === 'watchlist' ? (
          <section className="investments-workspace-watchlist" aria-label="基金自选">
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
              </div>
            </div>

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
              {fundLookupError ? (
                <p className="investments-fund-lookup-error">{fundLookupError}</p>
              ) : null}
            </form>

            <form
              className="investments-fund-lookup investments-stock-lookup"
              onSubmit={handleStockLookupSubmit}
            >
              <label htmlFor="investment-stock-query">添加个股自选</label>
              <div className="investments-fund-lookup-row">
                <input
                  id="investment-stock-query"
                  type="search"
                  autoComplete="off"
                  value={stockLookupQuery}
                  placeholder="搜索股票名、代码或拼音"
                  onChange={(event) => {
                    setStockLookupQuery(event.target.value);
                    if (stockLookupError) setStockLookupError('');
                    if (stockLookupStatus === 'error') setStockLookupStatus('idle');
                  }}
                  disabled={stockLookupStatus === 'loading'}
                />
                <button
                  type="submit"
                  className="button-with-icon primary"
                  disabled={stockLookupStatus === 'loading' || !stockLookupQuery.trim()}
                >
                  <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
                  {stockLookupStatus === 'loading' ? '搜索中' : '搜索个股'}
                </button>
              </div>
              {stockLookupError ? (
                <p className="investments-fund-lookup-error">{stockLookupError}</p>
              ) : null}
              {stockLookupResults.length > 0 ? (
                <div className="investments-stock-lookup-results" aria-label="个股搜索结果">
                  {stockLookupResults.map((result) => (
                    <button
                      key={result.secId}
                      type="button"
                      className="investments-stock-lookup-result"
                      onClick={() => handleAddStockWatchItem(result)}
                    >
                      <span>
                        <strong>{result.name}</strong>
                        <small>{result.code}</small>
                      </span>
                      <em>
                        {result.securityTypeName || '个股'} · {result.secId}
                      </em>
                    </button>
                  ))}
                </div>
              ) : null}
            </form>

            {investmentWatchlist.length === 0 ? (
              <div className="investments-watchlist-empty">
                <strong>还没有自选基金或个股</strong>
                <p>搜索后觉得值得跟踪，就把基金或股票加入这里。</p>
              </div>
            ) : (
              <>
                <div className="investments-watchlist-tools">
                  <label className="investments-watch-category-select">
                    <span>分类</span>
                    <select
                      aria-label="自选基金分类"
                      value={selectedWatchCategoryId}
                      onChange={(event) =>
                        setSelectedWatchCategoryId(event.target.value as WatchCategoryFilterId)
                      }
                    >
                      {WATCH_CATEGORY_FILTERS.map((category) => {
                        const count = watchCategoryCounts[category.id];

                        return (
                          <option
                            key={category.id}
                            disabled={count === 0 && category.id !== 'all'}
                            value={category.id}
                          >
                            {category.label} {count}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <div className="investments-watch-grid-controls" aria-label="每行卡片数量">
                    <button
                      type="button"
                      className={watchDisplayMode === 'grid' ? 'is-active' : ''}
                      onClick={() => setWatchDisplayMode('grid')}
                      aria-label="卡片监控视图"
                      aria-pressed={watchDisplayMode === 'grid'}
                      title="卡片监控视图"
                    >
                      <span aria-hidden="true">&#9638;</span>
                    </button>
                    <button
                      type="button"
                      className={watchDisplayMode === 'list' ? 'is-active' : ''}
                      onClick={() => setWatchDisplayMode('list')}
                      aria-label="列表监控视图"
                      aria-pressed={watchDisplayMode === 'list'}
                      title="列表监控视图"
                    >
                      <span aria-hidden="true">&#9779;</span>
                    </button>
                    {watchDisplayMode === 'grid'
                      ? WATCH_GRID_COLUMN_OPTIONS.map((count) => (
                          <button
                            key={count}
                            type="button"
                            className={watchGridColumns === count ? 'is-active' : ''}
                            onClick={() => setWatchGridColumns(count)}
                            aria-pressed={watchGridColumns === count}
                          >
                            {count}
                          </button>
                        ))
                      : null}
                  </div>
                </div>

                {filteredInvestmentWatchlist.length === 0 ? (
                  <div className="investments-watchlist-empty investments-watchlist-filter-empty">
                    <strong>当前分类没有自选基金</strong>
                    <p>切换到其他分类，或用基金代码添加一只新的。</p>
                  </div>
                ) : (
                  <div
                    className={`investments-watchlist-list is-${watchDisplayMode} is-columns-${watchGridColumns}`}
                  >
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
                            <span>自选记录</span>
                            <strong>
                              {item.investmentAdvice || item.lastVerdict || '等待补充观察记录'}
                            </strong>
                            {primaryTag ? <em>{primaryTag}</em> : null}
                          </div>
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
                            <span className="is-holding">
                              <em>持有</em>
                              {editingWatchHoldingId === item.id ? (
                                <input
                                  autoFocus
                                  aria-label={`${item.name}持有份额`}
                                  className="investments-watch-holding-input"
                                  inputMode="decimal"
                                  onChange={(event) =>
                                    setEditingWatchHoldingValue(event.target.value)
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      handleCommitWatchHoldingShares(item);
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      handleCancelEditingWatchHoldingShares();
                                    }
                                  }}
                                  placeholder="份额"
                                  type="text"
                                  value={editingWatchHoldingValue}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className={`investments-watch-holding-btn ${
                                    item.holdingShares ? 'has-value' : 'is-empty'
                                  }`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleStartEditingWatchHoldingShares(item);
                                  }}
                                  title="点击填写持有份额"
                                >
                                  {formatHoldingShares(item.holdingShares) || '待填写'}
                                </button>
                              )}
                            </span>
                          </div>
                          <div className="investments-watch-card-ai-actions">
                            {!isFollowing ? (
                              <button
                                type="button"
                                className="investments-watch-follow-btn"
                                aria-label="添加关注"
                                title="添加关注"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleFollowWatchItem(item);
                                }}
                              >
                                <span aria-hidden="true">+</span>
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
                              {item.lastSummary ? (
                                <section className="investments-watch-card-expanded-summary">
                                  <span>分析摘要</span>
                                  <p>{item.lastSummary}</p>
                                </section>
                              ) : null}
                              {detailSections.length > 0 ? (
                                <>
                                  {performanceSection && performancePoints.length > 0 ? (
                                    <section className="investments-watch-performance-panel">
                                      <div className="investments-watch-detail-head">
                                        <span>{performanceSection.title}</span>
                                        <small>按不同时间区间连接走势</small>
                                      </div>
                                      <WatchPerformanceLineChart points={performancePoints} />
                                    </section>
                                  ) : null}

                                  <div className="investments-watch-card-split-grid">
                                    <section className="investments-watch-card-split is-holdings">
                                      <span>重仓股票</span>
                                      {holdingsPreview.length > 0 ? (
                                        <WatchHoldingQuoteList
                                          holdings={holdingsPreview}
                                          quotesByCode={holdingStockQuotes}
                                        />
                                      ) : (
                                        <p>待更新</p>
                                      )}
                                    </section>
                                    <section className="investments-watch-card-split is-assets">
                                      <span>资产分布</span>
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
                                    </section>
                                  </div>

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
                                        {section.title === '基金持仓' ? (
                                          <WatchHoldingQuoteList
                                            holdings={section.items}
                                            quotesByCode={holdingStockQuotes}
                                          />
                                        ) : section.kind === 'chips' ? (
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
          </section>
        ) : null}

        <InvestmentChatPanel
          showHero={false}
          floating
          floatingPosition="bottom-right"
          defaultWebEnabled
          contextNote={marketContextSummary}
        />
      </main>

      <Toast
        visible={toast.visible}
        message={toast.message}
        variant={toast.variant}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
}
