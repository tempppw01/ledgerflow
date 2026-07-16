import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  InvestmentCategory,
  InvestmentFundAnalysis,
  InvestmentPosition,
  InvestmentWatchItem
} from '../../entities/investment/types';
import { sendAiChatStream } from '../../features/assistant/api/openaiCompatibleClient';
import {
  fetchWebSearchContext,
  buildWebSearchPrompt
} from '../../features/assistant/api/webSearchClient';
import { InvestmentChatPanel } from '../../features/assistant/investment-chat/InvestmentChatPanel';
import { fetchEastmoneyFundSnapshot } from '../../features/investments/api/eastmoneyFundClient';
import {
  EASTMONEY_MARKET_INDEXES,
  EASTMONEY_MARKET_NEWS_CATEGORIES,
  EASTMONEY_MARKET_THEMES,
  fetchEastmoneyMarketBoards,
  fetchEastmoneyMarketOverview,
  fetchEastmoneyMarketNews,
  fetchEastmoneyMarketThemeBoards,
  type EastmoneyMarketBoard,
  type EastmoneyMarketOverview,
  type EastmoneyMarketNewsItem,
  type EastmoneyMarketQuote,
  type EastmoneyMarketTrendPoint
} from '../../features/investments/api/eastmoneyMarketClient';
import {
  BRAIN_ICON_URL,
  CHEVRON_UP_ICON_URL,
  INFO_ICON_URL,
  ROTATE_CCW_ICON_URL
} from '../../shared/config/brandAssets';
import { formatCurrencyAuto } from '../../shared/lib/format';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { Toast, type ToastVariant } from '../../shared/ui/Toast';
import {
  buildInvestmentAssistantAuxiliaryInfo,
  buildInvestmentFundAnalysisPrompt,
  createInvestmentAiMessage,
  extractInvestmentAnalysis,
  summarizeInvestmentAnalysis,
  trimInvestmentAiMessages
} from './investmentAi';
import {
  ASSISTANT_ACTIVE_MODE_STORAGE_KEY,
  ASSISTANT_MODE_CHANGED_EVENT
} from '../../features/assistant/shared/assistantMode';
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

function buildRuleSuggestions({
  positions,
  marketChange,
  monthlyInvestableCash
}: {
  positions: InvestmentPosition[];
  marketChange: number | null;
  monthlyInvestableCash: number;
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
            ? `依据：本月可投 ${formatCurrencyAuto(monthlyInvestableCash)}，分批比一次性投入更从容。`
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
        reason: '依据：先比较自己的浮盈和板块强弱，再决定是否调整。'
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
      reason: '依据：大盘波动不大，未触发追涨或急跌的暂停规则。'
    },
    {
      tone: 'neutral',
      emoji: '🧭',
      title: '不要临时加码',
      reason: '依据：定投按节奏走，单日行情不决定长期计划。'
    }
  ];
}

function HoldingsTodayPanel({
  positions,
  totalCurrentValue,
  totalProfit,
  profitRate,
  marketChange
}: {
  positions: InvestmentPosition[];
  totalCurrentValue: number;
  totalProfit: number;
  profitRate: number;
  marketChange: number | null;
}) {
  const estimatedTodayProfit =
    marketChange === null ? null : (totalCurrentValue * marketChange) / 100;

  return (
    <section className="panel investments-today-holdings-panel" aria-label="今日持仓">
      <div className="investments-today-panel-head">
        <div>
          <h2>今日持仓</h2>
          <p>先看自己今天大概赚了还是亏了。</p>
        </div>
        <span className="badge">{positions.length} 笔</span>
      </div>

      <div className="investments-today-summary">
        <div className={totalProfit >= 0 ? 'is-positive' : 'is-negative'}>
          <span>总浮盈浮亏</span>
          <strong>{formatCurrencyAuto(totalProfit)}</strong>
          <em>{(profitRate * 100).toFixed(1)}%</em>
        </div>
        <div className={getMarketTone(marketChange)}>
          <span>今日市场估算</span>
          <strong>
            {estimatedTodayProfit === null ? '--' : formatCurrencyAuto(estimatedTodayProfit)}
          </strong>
          <em>
            {marketChange === null
              ? '等待行情'
              : `${getMovementEmoji(marketChange)} ${formatMarketPercent(marketChange)}`}
          </em>
        </div>
      </div>

      <p className="investments-today-note">
        今日估算按主要指数平均涨跌计算；基金逐日净值接入后会替换为真实收益。
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
      </div>
    </section>
  );
}

function PlainMarketBriefingPanel({
  marketChange,
  themeBoards,
  news
}: {
  marketChange: number | null;
  themeBoards: EastmoneyMarketBoard[];
  news: EastmoneyMarketNewsItem[];
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
          <p>收盘后这里会汇总成一条简报。</p>
        </div>
        <span aria-hidden="true">🗣️</span>
      </div>
      <strong className="investments-plain-briefing-lead">
        {getPlainMarketLine(marketChange)}
      </strong>
      <div className="investments-plain-briefing-points">
        <p>
          <span>板块</span>
          {strongestTheme
            ? `${strongestTheme.name} ${formatMarketPercent(strongestTheme.changePercent)}，今天相对有劲。`
            : '板块数据还在加载。'}
        </p>
        <p>
          <span>回避</span>
          {weakestTheme && weakestTheme.code !== strongestTheme?.code
            ? `${weakestTheme.name} ${formatMarketPercent(weakestTheme.changePercent)}，今天偏弱，别急着接。`
            : '暂时没有明显的弱势板块。'}
        </p>
        <p>
          <span>{policyNews ? '政策' : '资讯'}</span>
          {topNews
            ? topNews.summary || '有一条新资讯正在影响市场关注。'
            : '资讯正在同步，稍后刷新看看。'}
        </p>
      </div>
    </section>
  );
}

function RuleSuggestionsPanel({ suggestions }: { suggestions: RuleSuggestion[] }) {
  return (
    <section className="panel investments-rule-suggestions-panel" aria-label="规则提示">
      <div className="investments-today-panel-head">
        <div>
          <h2>今天怎么做</h2>
          <p>按预设规则给的参考，不是交易指令。</p>
        </div>
        <span aria-hidden="true">🧠</span>
      </div>
      <div className="investments-rule-suggestion-list">
        {suggestions.map((suggestion) => (
          <article key={suggestion.title} className={`is-${suggestion.tone}`}>
            <span aria-hidden="true">{suggestion.emoji}</span>
            <div>
              <strong>{suggestion.title}</strong>
              <p>{suggestion.reason}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

type MarketSession = {
  isOpen: boolean;
  label: string;
  detail: string;
  countdown: string;
};

function getNextWeekday(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 30, 0, 0);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function getMarketSession(now = new Date()): MarketSession {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const morningOpen = new Date(now);
  morningOpen.setHours(9, 30, 0, 0);
  const lunchOpen = new Date(now);
  lunchOpen.setHours(13, 0, 0, 0);
  const close = new Date(now);
  close.setHours(15, 0, 0, 0);

  if (day === 0 || day === 6) {
    const nextOpen = getNextWeekday(now);
    return {
      isOpen: false,
      label: '周末休市',
      detail: '下个交易日 09:30 开盘',
      countdown: formatCountdown(nextOpen.getTime() - now.getTime())
    };
  }

  if (minutes >= 570 && minutes < 690) {
    return {
      isOpen: true,
      label: '交易中',
      detail: '距收盘',
      countdown: formatCountdown(close.getTime() - now.getTime())
    };
  }

  if (minutes >= 780 && minutes < 900) {
    return {
      isOpen: true,
      label: '交易中',
      detail: '距收盘',
      countdown: formatCountdown(close.getTime() - now.getTime())
    };
  }

  if (minutes >= 690 && minutes < 780) {
    return {
      isOpen: false,
      label: '午间休市',
      detail: '距下午开盘',
      countdown: formatCountdown(lunchOpen.getTime() - now.getTime())
    };
  }

  const nextOpen = minutes < 570 ? morningOpen : getNextWeekday(now);
  return {
    isOpen: false,
    label: minutes < 570 ? '未开盘' : '已收盘',
    detail: minutes < 570 ? '距开盘' : '下个交易日开盘',
    countdown: formatCountdown(nextOpen.getTime() - now.getTime())
  };
}

function MarketSessionStatus() {
  const [session, setSession] = useState(() => getMarketSession());

  useEffect(() => {
    const update = () => setSession(getMarketSession());
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`investments-market-session ${session.isOpen ? 'is-open' : 'is-closed'}`}
      data-testid="market-session-status"
    >
      <span className="investments-market-session-dot" aria-hidden="true" />
      <div>
        <strong>{session.label}</strong>
        <span>{session.detail}</span>
      </div>
      <b>{session.countdown}</b>
    </div>
  );
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
  const indexRailRef = useRef<HTMLDivElement | null>(null);
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

  function scrollIndexRail(direction: -1 | 1) {
    indexRailRef.current?.scrollBy({ left: direction * 276, behavior: 'smooth' });
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
          <MarketSessionStatus />
          <button type="button" onClick={onRefresh} disabled={status === 'loading'}>
            {status === 'loading' ? '刷新中' : '刷新'}
          </button>
          <button type="button" className="primary" onClick={onAskMarket}>
            问 AI 怎么看
          </button>
        </div>
      </div>

      <div className="investments-market-index-rail">
        <button
          type="button"
          className="investments-market-rail-control is-previous"
          aria-label="查看上一组指数"
          onClick={() => scrollIndexRail(-1)}
        >
          <img src={CHEVRON_UP_ICON_URL} alt="" aria-hidden="true" />
        </button>
        <div
          ref={indexRailRef}
          className="investments-market-tabs"
          role="tablist"
          aria-label="大盘指数"
        >
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
        <button
          type="button"
          className="investments-market-rail-control is-next"
          aria-label="查看下一组指数"
          onClick={() => scrollIndexRail(1)}
        >
          <img src={CHEVRON_UP_ICON_URL} alt="" aria-hidden="true" />
        </button>
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
  view,
  selectedThemeCode,
  status,
  error,
  onSelectView,
  onSelectTheme,
  onRefresh
}: {
  themeBoards: EastmoneyMarketBoard[];
  industryBoards: EastmoneyMarketBoard[];
  view: MarketBoardView;
  selectedThemeCode: string;
  status: 'idle' | 'loading' | 'error';
  error: string;
  onSelectView: (view: MarketBoardView) => void;
  onSelectTheme: (code: string) => void;
  onRefresh: () => void;
}) {
  const selectedTheme =
    themeBoards.find((item) => item.code === selectedThemeCode) || themeBoards[0] || null;
  const industryLeader = industryBoards[0] || null;
  const breadth = getMarketBreadth(
    view === 'theme' ? (selectedTheme ? [selectedTheme] : []) : industryBoards
  );

  return (
    <section
      className={`panel investments-market-boards-panel ${status === 'loading' ? 'is-loading' : ''}`}
      aria-label="行业和概念板块监控"
    >
      <div className="investments-market-news-head">
        <div>
          <h3>板块健康度</h3>
          <p>用当日涨跌和板块广度，快速判断该追还是该等。</p>
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
              {EASTMONEY_MARKET_THEMES.map((theme) => (
                <option key={theme.code} value={theme.code}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>

          <div className="investments-market-board-insight">
            <MarketBreadthDonut breadth={breadth} label={selectedTheme?.name || '热门题材'} />
            <div className="investments-market-board-headline">
              <span>{selectedTheme?.name || '题材数据加载中'}</span>
              <strong>{formatMarketIndexValue(selectedTheme?.value)}</strong>
              <b className={getMarketTone(selectedTheme?.changePercent)}>
                {formatMarketPercent(selectedTheme?.changePercent)}
              </b>
              <small
                className={`investments-board-health ${getBoardHealth(selectedTheme?.changePercent).className}`}
              >
                {getBoardHealth(selectedTheme?.changePercent).emoji}{' '}
                {getBoardHealth(selectedTheme?.changePercent).label}
              </small>
            </div>
          </div>
        </>
      ) : industryBoards.length === 0 && status !== 'loading' ? (
        <div className="investments-market-news-empty">
          <strong>暂无行业数据</strong>
          <span>稍后刷新，或切换回热门题材。</span>
        </div>
      ) : (
        <>
          <div className="investments-market-board-insight">
            <MarketBreadthDonut breadth={breadth} label="行业榜" />
            <div className="investments-market-board-headline">
              <span>{industryLeader?.name || '行业数据加载中'}</span>
              <strong>{formatMarketIndexValue(industryLeader?.value)}</strong>
              <b className={getMarketTone(industryLeader?.changePercent)}>
                {formatMarketPercent(industryLeader?.changePercent)}
              </b>
              <small
                className={`investments-board-health ${getBoardHealth(industryLeader?.changePercent).className}`}
              >
                {getBoardHealth(industryLeader?.changePercent).emoji}{' '}
                {getBoardHealth(industryLeader?.changePercent).label}
              </small>
            </div>
          </div>
          <div className="investments-market-board-list is-compact">
            {industryBoards.slice(0, 3).map((board, index) => (
              <article
                className="investments-market-board-item"
                key={board.code || `${board.name}-${index}`}
              >
                <div className="investments-market-board-name">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong title={board.name}>{board.name}</strong>
                </div>
                <div
                  className={`investments-market-board-change ${getMarketTone(board.changePercent)}`}
                >
                  <strong>{formatMarketPercent(board.changePercent)}</strong>
                  <span>
                    {getBoardHealth(board.changePercent).emoji}{' '}
                    {getBoardHealth(board.changePercent).label}
                  </span>
                </div>
              </article>
            ))}
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

export function InvestmentsPage() {
  const navigate = useNavigate();
  const transactions = useFinanceStore((state) => state.transactions);
  const positions = useAppPreferences((state) => state.investmentPositions);
  const investmentWatchlist = useAppPreferences((state) => state.investmentWatchlist);
  const investmentAiMessages = useAppPreferences((state) => state.investmentAiMessages);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const removeInvestmentWatchItem = useAppPreferences((state) => state.removeInvestmentWatchItem);
  const upsertInvestmentWatchItem = useAppPreferences((state) => state.upsertInvestmentWatchItem);
  const setInvestmentAiMessages = useAppPreferences((state) => state.setInvestmentAiMessages);
  const { baseUrl, apiKey, model, webSearch } = useAiSettings();

  const [fundLookupCode, setFundLookupCode] = useState('');
  const [fundLookupStatus, setFundLookupStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fundLookupError, setFundLookupError] = useState('');
  const [selectedWatchCategoryId, setSelectedWatchCategoryId] =
    useState<WatchCategoryFilterId>('all');
  const [watchGridColumns, setWatchGridColumns] = useState<WatchGridColumnCount>(3);
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
  const [selectedNewsCategoryId, setSelectedNewsCategoryId] = useState(
    EASTMONEY_MARKET_NEWS_CATEGORIES[0].id
  );
  const [marketNews, setMarketNews] = useState<EastmoneyMarketNewsItem[]>([]);
  const [marketNewsStatus, setMarketNewsStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [marketNewsError, setMarketNewsError] = useState('');
  const [marketBoardView, setMarketBoardView] = useState<MarketBoardView>('theme');
  const [selectedMarketThemeCode, setSelectedMarketThemeCode] = useState(
    EASTMONEY_MARKET_THEMES[0].code
  );
  const [marketThemeBoards, setMarketThemeBoards] = useState<EastmoneyMarketBoard[]>([]);
  const [marketIndustryBoards, setMarketIndustryBoards] = useState<EastmoneyMarketBoard[]>([]);
  const [marketBoardsStatus, setMarketBoardsStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle'
  );
  const [marketBoardsError, setMarketBoardsError] = useState('');
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

  const monthlyInvestableCash = useMemo(() => {
    const baseline = monthlyIncome > 0 ? monthlyIncome - monthExpenseTotal : monthNetBalance;
    return Math.max(0, baseline);
  }, [monthExpenseTotal, monthNetBalance, monthlyIncome]);

  const averageMarketChange = useMemo(
    () => getAverageMarketChange(marketOverview),
    [marketOverview]
  );

  const ruleSuggestions = useMemo(
    () =>
      buildRuleSuggestions({
        positions: activePositions,
        marketChange: averageMarketChange,
        monthlyInvestableCash
      }),
    [activePositions, averageMarketChange, monthlyInvestableCash]
  );

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
        generatedAt: new Date().toISOString(),
        updatedAt: marketOverview?.updatedAt || new Date().toISOString(),
        marketIndexes: (marketOverview?.quotes || []).slice(0, 4).map((quote) => ({
          name: quote.name,
          code: quote.code,
          value: quote.value,
          changePercent: quote.changePercent,
          amount: quote.amount
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
    marketNews,
    marketOverview,
    marketThemeBoards,
    selectedMarketThemeCode,
    selectedNewsCategoryId
  ]);

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

  useEffect(() => {
    let cancelled = false;

    async function loadMarketBoards() {
      setMarketBoardsStatus('loading');
      setMarketBoardsError('');

      try {
        const [themesResult, industriesResult] = await Promise.allSettled([
          fetchEastmoneyMarketThemeBoards(),
          fetchEastmoneyMarketBoards('industry')
        ]);
        if (cancelled) return;
        if (themesResult.status === 'fulfilled') setMarketThemeBoards(themesResult.value);
        if (industriesResult.status === 'fulfilled')
          setMarketIndustryBoards(industriesResult.value);

        if (themesResult.status === 'rejected' && industriesResult.status === 'rejected') {
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
  }, []);

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

  async function refreshMarketBoards() {
    if (marketBoardsStatus === 'loading') return;

    setMarketBoardsStatus('loading');
    setMarketBoardsError('');

    try {
      const [themesResult, industriesResult] = await Promise.allSettled([
        fetchEastmoneyMarketThemeBoards(),
        fetchEastmoneyMarketBoards('industry')
      ]);
      if (themesResult.status === 'fulfilled') setMarketThemeBoards(themesResult.value);
      if (industriesResult.status === 'fulfilled') setMarketIndustryBoards(industriesResult.value);
      if (themesResult.status === 'rejected' && industriesResult.status === 'rejected') {
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
      const timeContext = await buildTimeContext();
      const webContext = buildWebSearchPrompt(
        await fetchWebSearchContext(
          [item.name, item.code, item.platform, '行业 政策 最新 影响'].filter(Boolean).join(' '),
          webSearch
        )
      );
      const auxiliaryInfo = buildInvestmentAssistantAuxiliaryInfo({
        webEnabled: true,
        webQuery: [item.name, item.code, item.platform, '行业 政策 最新 影响']
          .filter(Boolean)
          .join(' '),
        timeContext,
        contextNote: marketContextSummary,
        webSearchPrompt: webContext
      });
      let fullReasoning = '';
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
            timeContext,
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
          onReasoningDelta: (delta) => {
            fullReasoning += delta;
          },
          onDone: (content) => {
            fullContent = content || fullContent;
          }
        }
      );

      const rawContent = result.content || fullContent;
      const rawReasoning = result.reasoning || fullReasoning;
      const { displayText, analysis } = extractInvestmentAnalysis(rawContent);
      const analysisText = summarizeInvestmentAnalysis(displayText, analysis);
      const assistantMessage = createInvestmentAiMessage({
        id: `investment-assistant-${Date.now()}`,
        role: 'assistant',
        text: analysisText || analysis?.summary || rawContent.trim() || '已完成分析。',
        createdAt: new Date().toISOString(),
        reasoning: rawReasoning,
        webTrace: auxiliaryInfo.webTrace,
        auxiliaryInfo: auxiliaryInfo.relatedData,
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

  return (
    <div className="page-stack investments-page investments-management-page">
      <section className="investments-management-grid">
        <aside className="investments-management-column investments-support-column">
          <section className="investments-core-grid" aria-label="今日投资看板">
            <HoldingsTodayPanel
              positions={activePositions}
              totalCurrentValue={positionSummary.totalCurrentValue}
              totalProfit={positionSummary.totalProfit}
              profitRate={positionSummary.profitRate}
              marketChange={averageMarketChange}
            />
            <PlainMarketBriefingPanel
              marketChange={averageMarketChange}
              themeBoards={marketThemeBoards}
              news={marketNews}
            />
            <RuleSuggestionsPanel suggestions={ruleSuggestions} />
          </section>

          <section
            className="investments-market-news-grid investments-market-dashboard-grid"
            aria-label="大盘和市场监控"
          >
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
            <MarketBoardsPanel
              themeBoards={marketThemeBoards}
              industryBoards={marketIndustryBoards}
              view={marketBoardView}
              selectedThemeCode={selectedMarketThemeCode}
              status={marketBoardsStatus}
              error={marketBoardsError}
              onSelectView={setMarketBoardView}
              onSelectTheme={setSelectedMarketThemeCode}
              onRefresh={refreshMarketBoards}
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
                  className="investments-watchlist-flow-btn"
                  onClick={() => navigate('/investments/flow')}
                  aria-label="打开投资风向"
                  title="打开投资风向"
                >
                  <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
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

            {investmentWatchlist.length === 0 ? (
              <div className="investments-watchlist-empty">
                <strong>还没有自选基金</strong>
                <p>分析后觉得值得跟踪，就加入这里。</p>
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
                              {editingWatchHoldingId === item.id ? (
                                <input
                                  autoFocus
                                  aria-label={`${item.name}持有份额`}
                                  className="investments-watch-holding-input"
                                  inputMode="decimal"
                                  onChange={(event) => setEditingWatchHoldingValue(event.target.value)}
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
                                  title="点击输入持有份额"
                                >
                                  {formatHoldingShares(item.holdingShares) || '待获取'}
                                </button>
                              )}
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

          <section
            className="panel investments-quick-chat-panel"
            data-investment-support-title="快捷问答"
          >
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
