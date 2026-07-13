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

export const EASTMONEY_MARKET_INDEXES: EastmoneyMarketIndex[] = [
  { secId: '1.000001', code: '000001', name: '上证指数', shortName: '上证' },
  { secId: '0.399001', code: '399001', name: '深证成指', shortName: '深证' },
  { secId: '0.399006', code: '399006', name: '创业板指', shortName: '创业板' },
  { secId: '1.000688', code: '000688', name: '科创50', shortName: '科创50' }
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

export async function fetchEastmoneyMarketQuotes(): Promise<EastmoneyMarketQuote[]> {
  const secids = EASTMONEY_MARKET_INDEXES.map((item) => item.secId).join(',');
  const response = await fetch(
    `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${encodeURIComponent(
      secids
    )}&fields=f12,f13,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18&fltt=2&invt=2`
  );

  if (!response.ok) {
    throw new Error('大盘行情加载失败，请稍后重试。');
  }

  const payload = (await response.json()) as EastmoneyQuotePayload;
  return (payload.data?.diff || []).map((item) => {
    const code = String(item.f12 || '').trim();
    const secId = getSecIdByMarketAndCode(item.f13, code);

    return {
      secId,
      code,
      name: String(item.f14 || '').trim() || code,
      value: toNullableNumber(item.f2),
      changePercent: toNullableNumber(item.f3),
      change: toNullableNumber(item.f4),
      volume: toNullableNumber(item.f5),
      amount: toNullableNumber(item.f6),
      high: toNullableNumber(item.f15),
      low: toNullableNumber(item.f16),
      open: toNullableNumber(item.f17),
      previousClose: toNullableNumber(item.f18)
    };
  });
}

export async function fetchEastmoneyIndexTrend(
  secId: string
): Promise<EastmoneyMarketTrendPoint[]> {
  const response = await fetch(
    `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${encodeURIComponent(
      secId
    )}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&iscca=0&ndays=1`
  );

  if (!response.ok) {
    throw new Error('大盘分时加载失败，请稍后重试。');
  }

  const payload = (await response.json()) as EastmoneyTrendPayload;
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

export async function fetchEastmoneyMarketOverview(
  selectedSecId = EASTMONEY_MARKET_INDEXES[0].secId
): Promise<EastmoneyMarketOverview> {
  const [quotes, trend] = await Promise.all([
    fetchEastmoneyMarketQuotes(),
    fetchEastmoneyIndexTrend(selectedSecId)
  ]);

  return {
    selectedSecId,
    quotes,
    trend,
    updatedAt: new Date().toISOString()
  };
}

export async function fetchEastmoneyMarketNews(
  column = EASTMONEY_MARKET_NEWS_CATEGORIES[0].column,
  pageSize = 12
): Promise<EastmoneyMarketNewsItem[]> {
  const trace = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const response = await fetch(
    `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=${encodeURIComponent(
      column
    )}&sortEnd=&pageSize=${pageSize}&req_trace=${encodeURIComponent(trace)}`
  );

  if (!response.ok) {
    throw new Error('快讯加载失败，请稍后重试。');
  }

  const payload = (await response.json()) as EastmoneyFastNewsPayload;
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
