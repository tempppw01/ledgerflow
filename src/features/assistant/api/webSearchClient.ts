import { ENV } from '../../../shared/config/env';
import type { WebSearchSettings } from '../../../shared/store/useAiSettings';

type WebSearchProvider = 'tavily' | 'local';
export type InvestmentNewsSource = '10jqka' | 'xueqiu';

export interface WebSearchResultItem {
  title: string;
  url: string;
  content: string;
  sourceLabel?: string;
  publishedDate?: string;
  score?: number;
}

export interface WebSearchSourceStatus {
  id: InvestmentNewsSource | 'public';
  label: string;
  status: 'success' | 'unavailable';
  resultCount: number;
  provider?: WebSearchProvider;
}

export interface WebSearchContext {
  provider?: WebSearchProvider;
  status: 'success' | 'unavailable';
  query: string;
  answer?: string;
  results: WebSearchResultItem[];
  sources?: string[];
  sourceStatuses?: WebSearchSourceStatus[];
  message?: string;
}

export type WebSearchOptions = {
  investmentNewsSources?: InvestmentNewsSource[];
};

type RawSearchResult = Partial<{
  title: unknown;
  url: unknown;
  content: unknown;
  snippet: unknown;
  description: unknown;
  published_date: unknown;
  publishedDate: unknown;
  score: unknown;
}>;

type RawSearchPayload = Partial<{
  answer: unknown;
  results: unknown;
}>;

type InvestmentSourceDefinition = {
  id: InvestmentNewsSource;
  label: string;
  domains: string[];
};

const INVESTMENT_SOURCE_DEFINITIONS: Record<InvestmentNewsSource, InvestmentSourceDefinition> = {
  '10jqka': {
    id: '10jqka',
    label: '同花顺',
    domains: ['10jqka.com.cn']
  },
  xueqiu: {
    id: 'xueqiu',
    label: '雪球',
    domains: ['xueqiu.com']
  }
};

function normalizeBaseUrl(value: string) {
  return (value || ENV.tavilyBaseUrl).trim().replace(/\/+$/, '') || ENV.tavilyBaseUrl;
}

function normalizeLocalEndpoint(value: string) {
  return (value || ENV.localWebSearchEndpoint).trim() || ENV.localWebSearchEndpoint;
}

function getUrlHostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostnameMatchesDomain(hostname: string, domain: string) {
  const normalizedDomain = domain.toLowerCase();
  return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
}

function getResultSourceLabel(url: string) {
  const hostname = getUrlHostname(url);
  return Object.values(INVESTMENT_SOURCE_DEFINITIONS).find((source) =>
    source.domains.some((domain) => hostnameMatchesDomain(hostname, domain))
  )?.label;
}

function normalizeResult(item: RawSearchResult): WebSearchResultItem | null {
  const title = String(item.title || '').trim();
  const url = String(item.url || '').trim();
  const content = String(item.content || item.snippet || item.description || '').trim();
  if (!title && !content) return null;

  return {
    title: title || url || '检索结果',
    url,
    content,
    sourceLabel: getResultSourceLabel(url),
    publishedDate: String(item.published_date || item.publishedDate || '').trim() || undefined,
    score: typeof item.score === 'number' ? item.score : undefined
  };
}

function normalizePayload(payload: RawSearchPayload): Pick<WebSearchContext, 'answer' | 'results'> {
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  return {
    answer: typeof payload.answer === 'string' ? payload.answer.trim() : undefined,
    results: rawResults
      .map((item) => normalizeResult((item || {}) as RawSearchResult))
      .filter(Boolean) as WebSearchResultItem[]
  };
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`联网检索失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as RawSearchPayload;
}

async function searchTavily(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  includeDomains: string[] = []
): Promise<WebSearchContext> {
  const apiKey = settings.tavilyApiKey || ENV.tavilyApiKey;
  if (!apiKey.trim()) {
    throw new Error('未配置 Tavily API Key');
  }

  const payload = await requestJson(`${normalizeBaseUrl(settings.tavilyBaseUrl)}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`
    },
    signal,
    body: JSON.stringify({
      query,
      topic: 'finance',
      search_depth: 'basic',
      include_answer: true,
      max_results: settings.maxResults,
      ...(includeDomains.length > 0 ? { include_domains: includeDomains } : {})
    })
  });
  const normalized = normalizePayload(payload);
  return {
    provider: 'tavily',
    status: 'success',
    query,
    ...normalized
  };
}

async function searchLocal(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal
): Promise<WebSearchContext> {
  const payload = await requestJson(normalizeLocalEndpoint(settings.localEndpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      query,
      maxResults: settings.maxResults,
      topic: 'finance'
    })
  });
  const normalized = normalizePayload(payload);
  return {
    provider: 'local',
    status: 'success',
    query,
    ...normalized
  };
}

function filterResultsByDomains(results: WebSearchResultItem[], domains: string[]) {
  return results.filter((item) => {
    const hostname = getUrlHostname(item.url);
    return domains.some((domain) => hostnameMatchesDomain(hostname, domain));
  });
}

function hasUsableContext(context: WebSearchContext, includeDomains: string[]) {
  if (includeDomains.length === 0) {
    return context.results.length > 0 || Boolean(context.answer);
  }
  return filterResultsByDomains(context.results, includeDomains).length > 0;
}

function normalizeRestrictedContext(context: WebSearchContext, includeDomains: string[]) {
  if (includeDomains.length === 0) return context;
  return {
    ...context,
    results: filterResultsByDomains(context.results, includeDomains)
  };
}

async function fetchSingleWebSearchContext(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  includeDomains: string[] = []
): Promise<WebSearchContext> {
  try {
    const tavily = await searchTavily(query, settings, signal, includeDomains);
    if (hasUsableContext(tavily, includeDomains)) {
      return normalizeRestrictedContext(tavily, includeDomains);
    }
  } catch {
    // Tavily 不可用时继续尝试本地同源检索。
  }

  try {
    const localQuery =
      includeDomains.length > 0
        ? `${query} ${includeDomains.map((domain) => `site:${domain}`).join(' ')}`
        : query;
    const local = await searchLocal(localQuery, settings, signal);
    if (hasUsableContext(local, includeDomains)) {
      return normalizeRestrictedContext(local, includeDomains);
    }
  } catch {
    // fall through to unavailable context
  }

  return {
    status: 'unavailable',
    query,
    results: [],
    message: 'Tavily 和本地联网检索都暂时不可用。'
  };
}

function getResultKey(item: WebSearchResultItem) {
  const normalizedUrl = item.url.trim().replace(/[?#].*$/, '').replace(/\/$/, '');
  return normalizedUrl || `${item.title.trim()}-${item.content.trim().slice(0, 80)}`;
}

function dedupeSearchResults(items: WebSearchResultItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getResultKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeBalancedSearchResults(resultGroups: WebSearchResultItem[][], limit: number) {
  const seen = new Set<string>();
  const merged: WebSearchResultItem[] = [];
  const maxLength = Math.max(0, ...resultGroups.map((items) => items.length));

  for (let index = 0; index < maxLength && merged.length < limit; index += 1) {
    for (const items of resultGroups) {
      const item = items[index];
      if (!item) continue;
      const key = getResultKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= limit) break;
    }
  }

  return merged;
}

function getRequestedInvestmentSources(sources: InvestmentNewsSource[]) {
  return Array.from(new Set(sources))
    .map((sourceId) => INVESTMENT_SOURCE_DEFINITIONS[sourceId])
    .filter(Boolean);
}

export async function fetchWebSearchContext(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  options: WebSearchOptions = {}
): Promise<WebSearchContext> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { status: 'unavailable', query, results: [], message: '检索问题为空。' };
  }

  const requestedSources = getRequestedInvestmentSources(options.investmentNewsSources || []);
  if (requestedSources.length === 0) {
    return fetchSingleWebSearchContext(trimmedQuery, settings, signal);
  }

  const sourceContexts = await Promise.all(
    requestedSources.map(async (source) => {
      const context = await fetchSingleWebSearchContext(
        trimmedQuery,
        settings,
        signal,
        source.domains
      );
      const results = dedupeSearchResults(
        context.results.map((item) => ({ ...item, sourceLabel: source.label }))
      );
      return { source, context: { ...context, results } };
    })
  );
  const availableSources = sourceContexts.filter(({ context }) => context.results.length > 0);
  const sourceStatuses: WebSearchSourceStatus[] = sourceContexts.map(({ source, context }) => ({
    id: source.id,
    label: source.label,
    status: context.results.length > 0 ? 'success' : 'unavailable',
    resultCount: context.results.length,
    provider: context.provider
  }));

  if (availableSources.length > 0) {
    const results = mergeBalancedSearchResults(
      availableSources.map(({ context }) => context.results),
      Math.max(5, settings.maxResults)
    );
    return {
      provider: availableSources[0].context.provider,
      status: 'success',
      query: trimmedQuery,
      answer: availableSources.find(({ context }) => context.answer)?.context.answer,
      results,
      sources: availableSources.map(({ source }) => source.label),
      sourceStatuses
    };
  }

  const publicContext = await fetchSingleWebSearchContext(trimmedQuery, settings, signal);
  const publicStatus: WebSearchSourceStatus = {
    id: 'public',
    label: '公开网络',
    status:
      publicContext.results.length > 0 || publicContext.answer ? 'success' : 'unavailable',
    resultCount: publicContext.results.length,
    provider: publicContext.provider
  };

  return {
    ...publicContext,
    sources: publicStatus.status === 'success' ? ['公开网络'] : [],
    sourceStatuses: [...sourceStatuses, publicStatus],
    message:
      publicStatus.status === 'success'
        ? '同花顺和雪球暂时未返回可用内容，已自动改用公开网络。'
        : '同花顺、雪球和公开网络本次都未返回可用内容。'
  };
}

function getSourceStatusLine(status: WebSearchSourceStatus) {
  if (status.status === 'success') {
    const provider = status.provider === 'tavily' ? 'Tavily' : '本地联网接口';
    return `- ${status.label}：已采用 ${status.resultCount} 条（${provider}）`;
  }
  return `- ${status.label}：本次未取得可用内容`;
}

export function buildWebSearchPrompt(context: WebSearchContext) {
  const sourceStatusRows = context.sourceStatuses?.map(getSourceStatusLine) || [];
  const adoptedSources = context.sources?.length ? context.sources.join('、') : '无';

  if (context.status !== 'success') {
    return [
      '联网核验状态：未取得实时检索结果。',
      sourceStatusRows.length > 0 ? `来源状态：\n${sourceStatusRows.join('\n')}` : '',
      context.message ? `原因：${context.message}` : '',
      '请明确说明当前无法实时联网核验，不要编造精确实时数据。'
    ]
      .filter(Boolean)
      .join('\n');
  }

  const rows = context.results.slice(0, 5).map((item, index) => {
    const source = item.url ? `来源：${item.url}` : '来源：未提供';
    const sourceLabel = item.sourceLabel ? `来源站点：${item.sourceLabel}；` : '';
    const date = item.publishedDate ? `；日期：${item.publishedDate}` : '';
    return `${index + 1}. ${item.title}\n${sourceLabel}${source}${date}\n摘要：${item.content}`;
  });

  return [
    '联网核验状态：已取得可用资讯。',
    sourceStatusRows.length > 0 ? `来源状态：\n${sourceStatusRows.join('\n')}` : '',
    `实际采用来源：${adoptedSources}`,
    context.message ? `自动切换：${context.message}` : '',
    context.answer ? `检索摘要：${context.answer}` : '',
    rows.length > 0 ? `检索结果：\n${rows.join('\n\n')}` : '',
    '请只把这些结果作为辅助核验来源；如果结果与用户截图或已知持仓冲突，请指出不确定性。'
  ]
    .filter(Boolean)
    .join('\n');
}
