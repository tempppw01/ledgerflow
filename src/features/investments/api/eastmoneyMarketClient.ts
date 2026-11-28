/** 接口错误文案跟随界面语言。
 * 这里不在模块顶层引入 i18n 单例(避免模块求值时就初始化 i18n),
 * 改为在页面启动时由 src/i18n 注册进来;locales 尚未合并时退回中文兜底。
 */
import { tApiError } from '../../../shared/lib/apiErrorTranslator';
export interface EastmoneyMarketIndex {
  secId: string;
  code: string;
  name: string;
  shortName: string;
}

export interface EastmoneyMarketQuote {
  secId: string;
  code: string;
  name: string;
  value: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  previousClose: number | null;
  volume: number | null;
  amount: number | null;
}

export interface EastmoneyMarketTrendPoint {
  time: string;
  label: string;
  value: number;
  volume: number | null;
  amount: number | null;
  average: number | null;
}

export interface EastmoneyMarketOverview {
  selectedSecId: string;
  quotes: EastmoneyMarketQuote[];
  trend: EastmoneyMarketTrendPoint[];
  updatedAt: string;
}

export type EastmoneyMarketHistoryRange = '1m' | '3m' | '6m' | '1y' | '3y';

export interface EastmoneyMarketHistoryPoint {
  date: string;
  value: number;
  open: number | null;
  high: number | null;
  low: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
}

export interface GlobalMarketIndex {
  id: string;
  market: string;
  name: string;
  symbol: string;
  flag: string;
}

export interface GlobalMarketQuote {
  id: string;
  market: string;
  name: string;
  symbol: string;
  value: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  updatedAt: string;
  source: string;
  /**
   * 盘前/盘后(仅美股指数有)。
   *
   * 美股**指数**本身没有盘前/盘后交易,所以服务端用对应 ETF 的价格代替
   * (道琼斯→DIA、标普500→SPY、纳斯达克→ONEQ、纳斯达克100→QQQ),
   * `symbol` 就是那个 ETF 的代码 —— 界面上必须把它显示出来,否则会被误认为指数在涨跌。
   *
   * 只在**当前确实处于盘前或盘后时段**时才有值;其它时候为 null,界面不显示。
   */
  extended?: {
    session: 'pre' | 'post';
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    previousClose: number;
    updatedAt: string;
  } | null;
}

export interface GlobalMarketOverview {
  quotes: GlobalMarketQuote[];
  updatedAt: string;
  source: string;
}

export type GlobalMarketHistoryPoint = EastmoneyMarketHistoryPoint;

export interface GlobalMarketTrendPoint {
  dateTime: string;
  label: string;
  value: number;
  open: number | null;
  high: number | null;
  low: number | null;
  average: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
}

export interface EastmoneyMarketNewsCategory {
  id: string;
  label: string;
  column: string;
}

export interface EastmoneyMarketNewsItem {
  id: string;
  title: string;
  summary: string;
  time: string;
  link: string;
  stocks: string[];
}

export type EastmoneyMarketBoardType = 'industry' | 'concept';

export interface EastmoneyMarketBoard {
  code: string;
  name: string;
  value: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
  upCount: number | null;
  downCount: number | null;
  flatCount: number | null;
}

export interface EastmoneyMarketBoardTrendPoint {
  time: string;
  value: number;
}

export interface MarketDataMeta {
  source: string;
  updatedAt: string;
  freshness: 'live' | 'stale';
  fallback?: boolean;
}

export interface MarketBoardSnapshot {
  boards: EastmoneyMarketBoard[];
  meta: MarketDataMeta;
}

export interface EastmoneyMarketConstituent {
  code: string;
  name: string;
  value: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface EastmoneyMarketTheme {
  code: string;
  name: string;
}

export interface EastmoneyStockSearchResult {
  code: string;
  name: string;
  secId: string;
  market: string;
  securityType: string;
  securityTypeName: string;
  pinyin: string;
}

type EastmoneyQuotePayload = {
  data?: {
    diff?: Array<{
      f2?: number | string;
      f3?: number | string;
      f4?: number | string;
      f5?: number | string;
      f6?: number | string;
      f12?: string;
      f13?: number | string;
      f14?: string;
      f15?: number | string;
      f16?: number | string;
      f17?: number | string;
      f18?: number | string;
    }>;
  };
};

type EastmoneyTrendPayload = {
  data?: {
    trends?: string[];
  };
};

type EastmoneyHistoryPayload = {
  data?: {
    klines?: string[];
  };
};

type EastmoneyFastNewsPayload = {
  code?: string;
  message?: string;
  data?: {
    fastNewsList?: Array<{
      code?: string;
      title?: string;
      summary?: string;
      showTime?: string;
      stockList?: string[];
    }>;
  };
};

type EastmoneyBoardPayload = {
  data?: {
    diff?: Array<{
      f2?: number | string;
      f3?: number | string;
      f4?: number | string;
      f5?: number | string;
      f6?: number | string;
      f12?: string;
      f14?: string;
      f104?: number | string;
      f105?: number | string;
      f106?: number | string;
    }>;
  };
  diff?: Array<{
    f2?: number | string;
    f3?: number | string;
    f4?: number | string;
    f5?: number | string;
    f6?: number | string;
    f12?: string;
    f14?: string;
    f104?: number | string;
    f105?: number | string;
    f106?: number | string;
  }>;
};

type EastmoneyBoardConstituentPayload = {
  data?: {
    diff?: Array<{
      f2?: number | string;
      f3?: number | string;
      f4?: number | string;
      f12?: string;
      f14?: string;
    }>;
  };
};

type MarketBoardResponse = {
  data?: EastmoneyBoardPayload;
  meta?: Partial<MarketDataMeta>;
};

type EastmoneyStockSearchPayload = {
  results?: Array<Partial<EastmoneyStockSearchResult>>;
};

type GlobalMarketPayload = {
  data?: {
    quotes?: Array<Partial<GlobalMarketQuote>>;
    updatedAt?: string;
    source?: string;
  };
};

type GlobalMarketHistoryPayload = {
  data?: {
    points?: Array<Partial<GlobalMarketHistoryPoint>>;
  };
};

type GlobalMarketTrendPayload = {
  data?: {
    points?: Array<Partial<GlobalMarketTrendPoint>>;
    updatedAt?: string;
    source?: string;
  };
};

export const EASTMONEY_MARKET_INDEXES: EastmoneyMarketIndex[] = [
  { secId: '1.000001', code: '000001', name: '上证指数', shortName: '上证' },
  { secId: '0.399001', code: '399001', name: '深证成指', shortName: '深证' },
  { secId: '0.399006', code: '399006', name: '创业板指', shortName: '创业板' },
  { secId: '1.000688', code: '000688', name: '科创50', shortName: '科创50' },
  { secId: '1.000300', code: '000300', name: '沪深300', shortName: '沪深300' }
];

export const GLOBAL_MARKET_INDEXES: GlobalMarketIndex[] = [
  { id: 'us-dow', market: '美股', name: '道琼斯', symbol: '^DJI', flag: '🇺🇸' },
  { id: 'us-sp500', market: '美股', name: '标普 500', symbol: '^GSPC', flag: '🇺🇸' },
  { id: 'us-nasdaq', market: '美股', name: '纳斯达克', symbol: '^IXIC', flag: '🇺🇸' },
  { id: 'us-nasdaq100', market: '美股', name: '纳斯达克 100', symbol: '^NDX', flag: '🇺🇸' },
  { id: 'jp-nikkei', market: '日股', name: '日经 225', symbol: '^N225', flag: '🇯🇵' },
  { id: 'kr-kospi', market: '韩股', name: '韩国综合', symbol: '^KS11', flag: '🇰🇷' }
];

export const EASTMONEY_MARKET_NEWS_CATEGORIES: EastmoneyMarketNewsCategory[] = [
  { id: 'all-day', label: '7×24', column: '102' },
  { id: 'focus', label: '焦点', column: '101' },
  { id: 'listed-company', label: '上市公司', column: '103' },
  { id: 'china-market', label: '中国股市', column: '104' },
  { id: 'global-market', label: '全球股市', column: '105' },
  { id: 'commodity', label: '商品', column: '106' },
  { id: 'forex', label: '外汇', column: '107' },
  { id: 'bond', label: '债券', column: '108' },
  { id: 'fund', label: '基金', column: '109' }
];

export const EASTMONEY_MARKET_THEMES: EastmoneyMarketTheme[] = [
  { code: 'BK1106', name: '创新药' },
  { code: 'BK1128', name: 'CPO概念' },
  { code: 'BK0877', name: 'PCB概念' },
  { code: 'BK1134', name: '算力概念' },
  { code: 'BK1649', name: '油气资源' },
  { code: 'BK0512', name: '化工原料' },
  { code: 'BK0963', name: '商业航天' },
  { code: 'BK0695', name: '小金属概念' }
];

/**
 * 盘前/盘后字段的校验映射。
 *
 * 来的是外部数据(服务端转发 Yahoo),这里逐字段校验:时段只认 pre/post、价格与涨跌幅必须是有限数、
 * ETF 代码必须非空 —— 任何一项不对就返回 null,**界面宁可不显示,也不显示可疑的数字**。
 */
function toNullableExtendedQuote(value: unknown): GlobalMarketQuote['extended'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const session = raw.session === 'pre' ? 'pre' : raw.session === 'post' ? 'post' : null;
  const symbol = String(raw.symbol || '').trim();
  const price = toNullableNumber(raw.price);
  const changePercent = toNullableNumber(raw.changePercent);
  const change = toNullableNumber(raw.change);
  const previousClose = toNullableNumber(raw.previousClose);
  if (!session || !symbol || price === null || changePercent === null) return null;
  return {
    session,
    symbol,
    price,
    change: change ?? 0,
    changePercent,
    previousClose: previousClose ?? 0,
    updatedAt: String(raw.updatedAt || '').trim()
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '-' || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getSecIdByMarketAndCode(market: unknown, code: string) {
  const normalizedMarket = String(market ?? '').trim();
  if (!normalizedMarket || !code) return '';
  return `${normalizedMarket}.${code}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripFastNewsSummaryTitle(title: string, summary: string) {
  const trimmed = summary.trim();
  if (!title || !trimmed) return trimmed;
  return trimmed.replace(new RegExp(`^【${escapeRegExp(title)}】`), '').trim();
}

const marketQuoteCache = new Map<string, EastmoneyMarketQuote>();

/**
 * 单指数兜底请求的冷却窗口(毫秒)。
 *
 * 批量查询失败时会退化成 5 次单指数请求 —— 这一步本来是为了救「批量被拒、单个
 * 还能用」的部分故障,但行情源整体不可用时(最常见的情况)它是白打上游:页面
 * 每 10 秒轮询一次,每一轮都要重放这 5 次。
 * 所以「整批失败」这个信号出现后 60 秒内不再重复兜底:部分故障仍有第一次机会,
 * 整体故障时退回每轮 1 次批量请求,缓存里的上一笔行情继续显示。
 * 只有「批量请求本身抛错」才计入冷却;批量成功但少了几条属于数据缺口,那条路径
 * 每次都照补(行情源是活的,补几条很便宜)。
 */
const MARKET_QUOTE_FAN_OUT_COOLDOWN_MS = 60_000;
let marketQuoteFanOutCooldownUntil = 0;

export function clearEastmoneyMarketQuoteCache() {
  marketQuoteCache.clear();
  marketQuoteFanOutCooldownUntil = 0;
}

function parseMarketQuote(
  item: NonNullable<NonNullable<EastmoneyQuotePayload['data']>['diff']>[number],
  fallbackIndex?: EastmoneyMarketIndex
) {
  const code = String(item.f12 || fallbackIndex?.code || '').trim();
  const secId = getSecIdByMarketAndCode(item.f13, code) || fallbackIndex?.secId || '';

  return {
    secId,
    code,
    name: String(item.f14 || fallbackIndex?.name || '').trim() || code,
    value: toNullableNumber(item.f2),
    changePercent: toNullableNumber(item.f3),
    change: toNullableNumber(item.f4),
    volume: toNullableNumber(item.f5),
    amount: toNullableNumber(item.f6),
    high: toNullableNumber(item.f15),
    low: toNullableNumber(item.f16),
    open: toNullableNumber(item.f17),
    previousClose: toNullableNumber(item.f18)
  } satisfies EastmoneyMarketQuote;
}

function buildMarketQuoteUrl(secids: string) {
  return `/api/market/eastmoney/quotes?secids=${encodeURIComponent(secids)}`;
}

async function fetchMarketQuotePayload(secids: string) {
  const response = await fetch(buildMarketQuoteUrl(secids));
  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.大盘行情加载失败请稍后重',
        '大盘行情加载失败，请稍后重试。'
      )
    );
  const body = (await response.json()) as { data?: EastmoneyQuotePayload };
  return body.data || {};
}

async function loadEastmoneyMarketQuotes(): Promise<EastmoneyMarketQuote[]> {
  const bySecId = new Map<string, EastmoneyMarketQuote>();
  let batchFailed = false;

  try {
    const payload = await fetchMarketQuotePayload(
      EASTMONEY_MARKET_INDEXES.map((item) => item.secId).join(',')
    );
    (payload.data?.diff || []).forEach((item) => {
      const quote = parseMarketQuote(
        item,
        EASTMONEY_MARKET_INDEXES.find((index) => index.code === item.f12)
      );
      if (quote.secId) bySecId.set(quote.secId, quote);
    });
  } catch {
    // Individual requests below and the in-memory cache can still recover a partial outage.
    batchFailed = true;
  }

  const missingIndexes = EASTMONEY_MARKET_INDEXES.filter((item) => !bySecId.has(item.secId));
  const now = Date.now();
  const fanOutAllowed =
    missingIndexes.length > 0 && (!batchFailed || now >= marketQuoteFanOutCooldownUntil);
  if (batchFailed && fanOutAllowed) {
    marketQuoteFanOutCooldownUntil = now + MARKET_QUOTE_FAN_OUT_COOLDOWN_MS;
  }
  const recovered = fanOutAllowed
    ? await Promise.allSettled(
        missingIndexes.map(async (index) => {
          const payload = await fetchMarketQuotePayload(index.secId);
          const item = payload.data?.diff?.find((entry) => String(entry.f12 || '') === index.code);
          if (!item) throw new Error(`Missing quote for ${index.code}`);
          return parseMarketQuote(item, index);
        })
      )
    : [];

  recovered.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.secId)
      bySecId.set(result.value.secId, result.value);
  });

  return EASTMONEY_MARKET_INDEXES.flatMap((index) => {
    const quote = bySecId.get(index.secId) || marketQuoteCache.get(index.secId);
    if (!quote) return [];
    marketQuoteCache.set(index.secId, quote);
    return [quote];
  });
}

let marketQuoteInFlight: Promise<EastmoneyMarketQuote[]> | null = null;

/**
 * 同一时刻只打一轮行情请求。
 *
 * 页面挂载时 StrictMode 会把 effect 跑两遍,切换指数或离开再回来也会再要一次:
 * 两次都在途时各自打一轮上游(一次访问能到 12 次 quotes 请求),而**后发的空结果
 * 还会把先取回来的行情覆盖成「--」** —— 因为缓存要等第一轮兜底回来才有值。
 * 在途请求共享同一个 Promise 就能同时消掉这两个问题:第二个调用等第一轮的结果。
 */
export function fetchEastmoneyMarketQuotes(): Promise<EastmoneyMarketQuote[]> {
  if (marketQuoteInFlight) return marketQuoteInFlight;

  const request = loadEastmoneyMarketQuotes().finally(() => {
    if (marketQuoteInFlight === request) marketQuoteInFlight = null;
  });
  marketQuoteInFlight = request;
  return request;
}

export async function fetchEastmoneyIndexTrend(
  secId: string
): Promise<EastmoneyMarketTrendPoint[]> {
  const response = await fetch(`/api/market/eastmoney/trend?secid=${encodeURIComponent(secId)}`);

  if (!response.ok) {
    throw new Error(
      tApiError(
        'investments.api.market.marketError.大盘分时加载失败请稍后重',
        '大盘分时加载失败，请稍后重试。'
      )
    );
  }

  const body = (await response.json()) as { data?: EastmoneyTrendPayload };
  const payload = body.data || {};
  return (payload.data?.trends || [])
    .map((item) => {
      const [time = '', , close, , , volume, amount, average] = item.split(',');
      const value = toNullableNumber(close);
      if (value === null) return null;

      return {
        time,
        label: time.slice(11, 16),
        value,
        volume: toNullableNumber(volume),
        amount: toNullableNumber(amount),
        average: toNullableNumber(average)
      };
    })
    .filter((item): item is EastmoneyMarketTrendPoint => Boolean(item));
}

export async function fetchEastmoneyIndexHistory(
  secId: string,
  options: {
    range?: EastmoneyMarketHistoryRange;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<EastmoneyMarketHistoryPoint[]> {
  const params = new URLSearchParams({ secid: secId });
  if (options.range) params.set('range', options.range);
  if (options.startDate) params.set('start', options.startDate);
  if (options.endDate) params.set('end', options.endDate);
  const response = await fetch(`/api/market/eastmoney/history?${params.toString()}`);
  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.大盘历史行情加载失败请稍',
        '大盘历史行情加载失败，请稍后重试。'
      )
    );

  const body = (await response.json()) as { data?: EastmoneyHistoryPayload };
  return (body.data?.data?.klines || [])
    .map((item) => {
      const [date = '', open, close, high, low, volume, amount, , changePercent] = item.split(',');
      const value = toNullableNumber(close);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value === null) return null;
      return {
        date,
        value,
        open: toNullableNumber(open),
        high: toNullableNumber(high),
        low: toNullableNumber(low),
        changePercent: toNullableNumber(changePercent),
        volume: toNullableNumber(volume),
        amount: toNullableNumber(amount)
      };
    })
    .filter((item): item is EastmoneyMarketHistoryPoint => Boolean(item));
}

export async function fetchEastmoneyMarketOverview(
  selectedSecId = EASTMONEY_MARKET_INDEXES[0].secId
): Promise<EastmoneyMarketOverview> {
  const [quotesResult, trendResult] = await Promise.allSettled([
    fetchEastmoneyMarketQuotes(),
    fetchEastmoneyIndexTrend(selectedSecId)
  ]);

  const quotes = quotesResult.status === 'fulfilled' ? quotesResult.value : [];
  const trend = trendResult.status === 'fulfilled' ? trendResult.value : [];

  if (quotesResult.status === 'rejected' && trendResult.status === 'rejected') {
    throw new Error(
      tApiError(
        'investments.api.market.marketError.大盘行情加载失败请稍后重',
        '大盘行情加载失败，请稍后重试。'
      )
    );
  }

  return {
    selectedSecId,
    quotes,
    trend,
    updatedAt: new Date().toISOString()
  };
}

export async function fetchEastmoneyStockSearch(
  query: string,
  pageSize = 8
): Promise<EastmoneyStockSearchResult[]> {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return [];

  const response = await fetch(
    `/api/market/eastmoney/stock-search?query=${encodeURIComponent(
      normalizedQuery
    )}&pageSize=${Math.min(12, Math.max(1, pageSize))}`
  );

  if (!response.ok) {
    throw new Error(
      tApiError(
        'investments.api.market.marketError.个股搜索失败请稍后重试',
        '个股搜索失败，请稍后重试。'
      )
    );
  }

  const body = (await response.json()) as { data?: EastmoneyStockSearchPayload };
  const results = body.data?.results || [];
  return results
    .map((item) => ({
      code: String(item.code || '').trim(),
      name: String(item.name || '').trim(),
      secId: String(item.secId || '').trim(),
      market: String(item.market || '').trim(),
      securityType: String(item.securityType || '').trim(),
      securityTypeName: String(item.securityTypeName || '').trim(),
      pinyin: String(item.pinyin || '').trim()
    }))
    .filter((item) => item.code && item.name && item.secId);
}

export async function fetchGlobalMarketOverview(): Promise<GlobalMarketOverview> {
  const response = await fetch('/api/market/global-quotes');
  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.美日韩大盘暂时无法更新',
        '美日韩大盘暂时无法更新。'
      )
    );

  const payload = (await response.json()) as GlobalMarketPayload;
  const quotes = (payload.data?.quotes || [])
    .map((item) => ({
      id: String(item.id || '').trim(),
      market: String(item.market || '').trim(),
      name: String(item.name || '').trim(),
      symbol: String(item.symbol || '').trim(),
      value: toNullableNumber(item.value),
      change: toNullableNumber(item.change),
      changePercent: toNullableNumber(item.changePercent),
      high: toNullableNumber(item.high),
      low: toNullableNumber(item.low),
      previousClose: toNullableNumber(item.previousClose),
      updatedAt: String(item.updatedAt || '').trim(),
      source: String(item.source || payload.data?.source || 'Yahoo Finance').trim(),
      // 盘前/盘后:这里是**白名单映射**,不显式带上就会被丢掉(实测过一次)
      extended: toNullableExtendedQuote(item.extended)
    }))
    .filter((item) => item.id && item.value !== null);

  if (quotes.length === 0)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.美日韩大盘暂时没有可用数',
        '美日韩大盘暂时没有可用数据。'
      )
    );

  return {
    quotes,
    updatedAt: String(payload.data?.updatedAt || new Date().toISOString()),
    source: String(payload.data?.source || quotes[0].source || 'Yahoo Finance')
  };
}

export async function fetchGlobalMarketHistory(
  indexId: string,
  options: {
    range?: EastmoneyMarketHistoryRange;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<GlobalMarketHistoryPoint[]> {
  const params = new URLSearchParams({ id: indexId });
  if (options.range) params.set('range', options.range);
  if (options.startDate) params.set('start', options.startDate);
  if (options.endDate) params.set('end', options.endDate);
  const response = await fetch(`/api/market/global-history?${params.toString()}`);
  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.国际大盘历史行情加载失败',
        '国际大盘历史行情加载失败，请稍后重试。'
      )
    );

  const payload = (await response.json()) as GlobalMarketHistoryPayload;
  return (payload.data?.points || [])
    .map((item) => {
      const date = String(item.date || '').trim();
      const value = toNullableNumber(item.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value === null) return null;
      return {
        date,
        value,
        open: toNullableNumber(item.open),
        high: toNullableNumber(item.high),
        low: toNullableNumber(item.low),
        changePercent: toNullableNumber(item.changePercent),
        volume: toNullableNumber(item.volume),
        amount: toNullableNumber(item.amount)
      } satisfies GlobalMarketHistoryPoint;
    })
    .filter((item): item is GlobalMarketHistoryPoint => Boolean(item));
}

export async function fetchGlobalMarketTrend(indexId: string): Promise<GlobalMarketTrendPoint[]> {
  const params = new URLSearchParams({ id: indexId });
  const response = await fetch(`/api/market/global-trend?${params.toString()}`);
  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.国际大盘实时走势加载失败',
        '国际大盘实时走势加载失败，请稍后重试。'
      )
    );

  const payload = (await response.json()) as GlobalMarketTrendPayload;
  return (payload.data?.points || [])
    .map((item) => {
      const dateTime = String(item.dateTime || '').trim();
      const value = toNullableNumber(item.value);
      if (!dateTime || value === null) return null;
      return {
        dateTime,
        label: String(item.label || '').trim(),
        value,
        open: toNullableNumber(item.open),
        high: toNullableNumber(item.high),
        low: toNullableNumber(item.low),
        average: toNullableNumber(item.average),
        changePercent: toNullableNumber(item.changePercent),
        volume: toNullableNumber(item.volume),
        amount: toNullableNumber(item.amount)
      } satisfies GlobalMarketTrendPoint;
    })
    .filter((item): item is GlobalMarketTrendPoint => Boolean(item));
}

export async function fetchEastmoneyMarketNews(
  column = EASTMONEY_MARKET_NEWS_CATEGORIES[0].column,
  pageSize = 12
): Promise<EastmoneyMarketNewsItem[]> {
  const trace = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const response = await fetch(
    `/api/market/eastmoney/fast-news?column=${encodeURIComponent(
      column
    )}&pageSize=${pageSize}&trace=${encodeURIComponent(trace)}`
  );

  if (!response.ok) {
    throw new Error(
      tApiError(
        'investments.api.market.marketError.快讯加载失败请稍后重试',
        '快讯加载失败，请稍后重试。'
      )
    );
  }

  const body = (await response.json()) as { data?: EastmoneyFastNewsPayload };
  const payload = body.data || {};
  if (payload.code !== '1') {
    throw new Error(payload.message || '快讯加载失败，请稍后重试。');
  }

  return (payload.data?.fastNewsList || []).map((item) => {
    const id = String(item.code || item.showTime || item.title || trace);
    const title = String(item.title || '').trim() || '未命名快讯';
    const summary = stripFastNewsSummaryTitle(title, String(item.summary || ''));

    return {
      id,
      title,
      summary,
      time: String(item.showTime || '').trim(),
      link: `https://finance.eastmoney.com/a/${id}.html`,
      stocks: Array.isArray(item.stockList) ? item.stockList.slice(0, 4) : []
    };
  });
}

export async function fetchEastmoneyMarketBoards(
  type: EastmoneyMarketBoardType = 'industry',
  pageSize = 8
): Promise<EastmoneyMarketBoard[]> {
  const snapshot = await fetchEastmoneyMarketBoardsSnapshot(type, pageSize);
  return snapshot.boards;
}

function parseMarketBoards(payload: EastmoneyBoardPayload): EastmoneyMarketBoard[] {
  const diff = payload.data?.diff || payload.diff || [];
  return diff.map((item) => ({
    code: String(item.f12 || '').trim(),
    name: String(item.f14 || '').trim() || '未命名板块',
    value: toNullableNumber(item.f2),
    changePercent: toNullableNumber(item.f3),
    change: toNullableNumber(item.f4),
    volume: toNullableNumber(item.f5),
    amount: toNullableNumber(item.f6),
    upCount: toNullableNumber(item.f104),
    downCount: toNullableNumber(item.f105),
    flatCount: toNullableNumber(item.f106)
  }));
}

function normalizeMarketBoardMeta(meta?: Partial<MarketDataMeta>): MarketDataMeta {
  return {
    source: String(meta?.source || '东方财富公开行情'),
    updatedAt: String(meta?.updatedAt || new Date().toISOString()),
    freshness: meta?.freshness === 'stale' ? 'stale' : 'live',
    fallback: meta?.fallback === true
  };
}

export async function fetchEastmoneyMarketBoardsSnapshot(
  type: EastmoneyMarketBoardType = 'industry',
  pageSize = 8
): Promise<MarketBoardSnapshot> {
  const response = await fetch(`/api/market/eastmoney/boards?type=${type}&pageSize=${pageSize}`);

  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.板块行情加载失败请稍后重',
        '板块行情加载失败，请稍后重试。'
      )
    );

  const body = (await response.json()) as MarketBoardResponse;
  return {
    boards: parseMarketBoards(body.data || {}),
    meta: normalizeMarketBoardMeta(body.meta)
  };
}

export async function fetchEastmoneyMarketBoardConstituents(
  boardCode: string,
  pageSize = 3
): Promise<EastmoneyMarketConstituent[]> {
  const code = String(boardCode || '')
    .trim()
    .toUpperCase();
  if (!/^BK\d{4}$/.test(code)) return [];
  const response = await fetch(
    `/api/market/eastmoney/board-stocks?code=${encodeURIComponent(code)}&pageSize=${pageSize}`
  );

  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.板块成分股加载失败请稍后',
        '板块成分股加载失败，请稍后重试。'
      )
    );

  const body = (await response.json()) as { data?: EastmoneyBoardConstituentPayload };
  return (body.data?.data?.diff || []).map((item) => ({
    code: String(item.f12 || '').trim(),
    name: String(item.f14 || '').trim() || '未命名公司',
    value: toNullableNumber(item.f2),
    change: toNullableNumber(item.f4),
    changePercent: toNullableNumber(item.f3)
  }));
}

export async function fetchEastmoneyMarketBoardTrend(
  code: string
): Promise<EastmoneyMarketBoardTrendPoint[]> {
  const normalizedCode = String(code || '')
    .trim()
    .toUpperCase();
  if (!/^BK\d{4}$/.test(normalizedCode)) return [];
  const response = await fetch(
    `/api/market/eastmoney/board-trend?code=${encodeURIComponent(normalizedCode)}`
  );
  if (!response.ok)
    throw new Error(
      tApiError('investments.api.market.marketError.行业走势图加载失败', '行业走势图加载失败。')
    );
  const body = (await response.json()) as { data?: { data?: { trends?: unknown[] } } };
  return (body.data?.data?.trends || []).flatMap((entry) => {
    const [time, value] = String(entry || '').split(',');
    const numericValue = toNullableNumber(value);
    return time && numericValue !== null ? [{ time, value: numericValue }] : [];
  });
}

export async function fetchEastmoneyMarketThemeBoards(
  themes: EastmoneyMarketTheme[] = EASTMONEY_MARKET_THEMES
): Promise<EastmoneyMarketBoard[]> {
  const snapshot = await fetchEastmoneyMarketThemeBoardsSnapshot(themes);
  return snapshot.boards;
}

export async function fetchEastmoneyMarketThemeBoardsSnapshot(
  themes: EastmoneyMarketTheme[] = EASTMONEY_MARKET_THEMES
): Promise<MarketBoardSnapshot> {
  if (themes.length === 0) {
    return {
      boards: [],
      meta: normalizeMarketBoardMeta({ source: '东方财富公开题材行情' })
    };
  }
  const response = await fetch(
    `/api/market/eastmoney/theme-quotes?codes=${encodeURIComponent(
      themes.map((item) => item.code).join(',')
    )}`
  );

  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.热门题材加载失败请稍后重',
        '热门题材加载失败，请稍后重试。'
      )
    );

  const body = (await response.json()) as MarketBoardResponse;
  const payload = body.data || {};
  const byCode = new Map(
    (payload.data?.diff || []).map((item) => [
      String(item.f12 || '').trim(),
      {
        code: String(item.f12 || '').trim(),
        name: String(item.f14 || '').trim() || '未命名板块',
        value: toNullableNumber(item.f2),
        changePercent: toNullableNumber(item.f3),
        change: toNullableNumber(item.f4),
        volume: toNullableNumber(item.f5),
        amount: toNullableNumber(item.f6),
        upCount: toNullableNumber(item.f104),
        downCount: toNullableNumber(item.f105),
        flatCount: toNullableNumber(item.f106)
      } satisfies EastmoneyMarketBoard
    ])
  );

  const boards = themes.flatMap((theme) => {
    const board = byCode.get(theme.code);
    return board ? [board] : [];
  });
  return {
    boards,
    meta: normalizeMarketBoardMeta(body.meta)
  };
}

export async function fetchGlobalMarketSectorBoards(): Promise<MarketBoardSnapshot> {
  const response = await fetch('/api/market/global-sectors');
  if (!response.ok)
    throw new Error(
      tApiError(
        'investments.api.market.marketError.全球行业行情加载失败请稍',
        '全球行业行情加载失败，请稍后重试。'
      )
    );
  const body = (await response.json()) as MarketBoardResponse;
  return {
    boards: parseMarketBoards(body.data || {}),
    meta: normalizeMarketBoardMeta({
      source: 'Yahoo Finance 行业 ETF',
      ...body.meta
    })
  };
}
