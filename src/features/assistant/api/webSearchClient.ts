import { ENV } from '../../../shared/config/env';
import {
  getWebSearchProviderDefinition,
  isWebSearchProvider,
  type WebSearchProvider
} from '../../../shared/config/webSearchProviders';
import type {
  WebSearchProviderCredential,
  WebSearchSettings
} from '../../../shared/store/useAiSettings';

type WebSearchRuntimeProvider = WebSearchProvider | 'local';
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
  provider?: WebSearchRuntimeProvider;
}

export interface WebSearchContext {
  provider?: WebSearchRuntimeProvider;
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
  link: unknown;
  content: unknown;
  snippet: unknown;
  description: unknown;
  text: unknown;
  published_date: unknown;
  publishedDate: unknown;
  page_age: unknown;
  date: unknown;
  score: unknown;
}>;

type RawSearchPayload = Partial<{
  answer: unknown;
  results: unknown;
  organic: unknown;
  items: unknown;
  web: unknown;
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

const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchRuntimeProvider, string> = {
  tavily: 'Tavily',
  brave: 'Brave Search',
  serper: 'Serper',
  exa: 'Exa',
  google: 'Google CSE',
  local: '本地联网接口'
};

function getRuntimeProviderLabel(provider: WebSearchRuntimeProvider | undefined) {
  if (!provider) return '联网检索';
  return WEB_SEARCH_PROVIDER_LABELS[provider] || '联网检索';
}

function clampMaxResults(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(10, Math.max(1, Math.round(parsed)));
}

function resolveCredential(
  settings: WebSearchSettings,
  provider: WebSearchProvider
): WebSearchProviderCredential {
  const definition = getWebSearchProviderDefinition(provider);
  const incoming = settings.credentials?.[provider];
  const fallbackApiKey = provider === 'tavily' ? ENV.tavilyApiKey : '';
  const rawBaseUrl = String(incoming?.baseUrl || definition.defaultBaseUrl).trim();
  return {
    apiKey: String(incoming?.apiKey || fallbackApiKey).trim(),
    baseUrl: rawBaseUrl.replace(/\/+$/, '') || definition.defaultBaseUrl,
    engineId: String(incoming?.engineId || '').trim()
  };
}

function requireApiKey(credential: WebSearchProviderCredential, provider: WebSearchProvider) {
  if (credential.apiKey) return credential.apiKey;
  throw new Error(`未配置 ${WEB_SEARCH_PROVIDER_LABELS[provider]} API Key`);
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
  const url = String(item.url || item.link || '').trim();
  const content = String(
    item.content || item.snippet || item.description || item.text || ''
  ).trim();
  if (!title && !content) return null;

  return {
    title: title || url || '检索结果',
    url,
    content,
    sourceLabel: getResultSourceLabel(url),
    publishedDate:
      String(item.published_date || item.publishedDate || item.page_age || item.date || '').trim() ||
      undefined,
    score: typeof item.score === 'number' ? item.score : undefined
  };
}

function normalizeResultList(value: unknown): WebSearchResultItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeResult((item || {}) as RawSearchResult))
    .filter(Boolean) as WebSearchResultItem[];
}

function pickResultList(provider: WebSearchProvider, payload: RawSearchPayload) {
  if (provider === 'brave') {
    const web = payload.web;
    if (web && typeof web === 'object') {
      return (web as RawSearchPayload).results;
    }
    return undefined;
  }
  if (provider === 'serper') return payload.organic;
  if (provider === 'google') return payload.items;
  return payload.results;
}

function normalizePayload(
  provider: WebSearchProvider,
  payload: RawSearchPayload
): Pick<WebSearchContext, 'answer' | 'results'> {
  const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
  return {
    answer: answer || undefined,
    results: normalizeResultList(pickResultList(provider, payload))
  };
}

function buildSiteScopedQuery(query: string, includeDomains: string[]) {
  if (includeDomains.length === 0) return query;
  return `${query} ${includeDomains.map((domain) => `site:${domain}`).join(' ')}`;
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
  const credential = resolveCredential(settings, 'tavily');
  const apiKey = requireApiKey(credential, 'tavily');
  const payload = await requestJson(`${credential.baseUrl}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    signal,
    body: JSON.stringify({
      query,
      topic: 'finance',
      search_depth: 'basic',
      include_answer: true,
      max_results: clampMaxResults(settings.maxResults),
      ...(includeDomains.length > 0 ? { include_domains: includeDomains } : {})
    })
  });
  return {
    provider: 'tavily',
    status: 'success',
    query,
    ...normalizePayload('tavily', payload)
  };
}

async function searchBrave(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  includeDomains: string[] = []
): Promise<WebSearchContext> {
  const credential = resolveCredential(settings, 'brave');
  const apiKey = requireApiKey(credential, 'brave');
  const params = new URLSearchParams({
    q: buildSiteScopedQuery(query, includeDomains),
    count: String(clampMaxResults(settings.maxResults))
  });
  const payload = await requestJson(`${credential.baseUrl}/res/v1/web/search?${params}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey
    },
    signal
  });
  return {
    provider: 'brave',
    status: 'success',
    query,
    ...normalizePayload('brave', payload)
  };
}

async function searchSerper(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  includeDomains: string[] = []
): Promise<WebSearchContext> {
  const credential = resolveCredential(settings, 'serper');
  const apiKey = requireApiKey(credential, 'serper');
  const payload = await requestJson(`${credential.baseUrl}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-KEY': apiKey
    },
    signal,
    body: JSON.stringify({
      q: buildSiteScopedQuery(query, includeDomains),
      num: clampMaxResults(settings.maxResults),
      gl: 'cn',
      hl: 'zh-cn'
    })
  });
  return {
    provider: 'serper',
    status: 'success',
    query,
    ...normalizePayload('serper', payload)
  };
}

async function searchExa(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  includeDomains: string[] = []
): Promise<WebSearchContext> {
  const credential = resolveCredential(settings, 'exa');
  const apiKey = requireApiKey(credential, 'exa');
  const payload = await requestJson(`${credential.baseUrl}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': apiKey
    },
    signal,
    body: JSON.stringify({
      query,
      type: 'auto',
      numResults: clampMaxResults(settings.maxResults),
      ...(includeDomains.length > 0 ? { includeDomains } : {}),
      contents: {
        text: { maxCharacters: 1200 }
      }
    })
  });
  return {
    provider: 'exa',
    status: 'success',
    query,
    ...normalizePayload('exa', payload)
  };
}

async function searchGoogle(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  includeDomains: string[] = []
): Promise<WebSearchContext> {
  const credential = resolveCredential(settings, 'google');
  const apiKey = requireApiKey(credential, 'google');
  if (!credential.engineId) {
    throw new Error('未配置 Google 搜索引擎 ID(CX)');
  }
  const params = new URLSearchParams({
    key: apiKey,
    cx: credential.engineId,
    q: buildSiteScopedQuery(query, includeDomains),
    num: String(clampMaxResults(settings.maxResults))
  });
  const payload = await requestJson(`${credential.baseUrl}/customsearch/v1?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal
  });
  return {
    provider: 'google',
    status: 'success',
    query,
    ...normalizePayload('google', payload)
  };
}

async function searchSelectedProvider(
  provider: WebSearchProvider,
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal,
  includeDomains: string[] = []
): Promise<WebSearchContext> {
  switch (provider) {
    case 'brave':
      return searchBrave(query, settings, signal, includeDomains);
    case 'serper':
      return searchSerper(query, settings, signal, includeDomains);
    case 'exa':
      return searchExa(query, settings, signal, includeDomains);
    case 'google':
      return searchGoogle(query, settings, signal, includeDomains);
    case 'tavily':
    default:
      return searchTavily(query, settings, signal, includeDomains);
  }
}

async function searchLocal(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal
): Promise<WebSearchContext> {
  const payload = await requestJson(normalizeLocalEndpoint(settings.localEndpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal,
    body: JSON.stringify({
      query,
      maxResults: clampMaxResults(settings.maxResults),
      topic: 'finance'
    })
  });
  return {
    provider: 'local',
    status: 'success',
    query,
    ...normalizePayload('tavily', payload)
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
  const provider = isWebSearchProvider(settings.provider) ? settings.provider : 'tavily';

  try {
    const context = await searchSelectedProvider(
      provider,
      query,
      settings,
      signal,
      includeDomains
    );
    if (hasUsableContext(context, includeDomains)) {
      return normalizeRestrictedContext(context, includeDomains);
    }
  } catch {
    // 所选搜索服务不可用时继续尝试本地同源检索。
  }

  try {
    const local = await searchLocal(buildSiteScopedQuery(query, includeDomains), settings, signal);
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
    message: `${getRuntimeProviderLabel(provider)} 和本地联网检索都暂时不可用。`
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
      Math.max(5, clampMaxResults(settings.maxResults))
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
    return `- ${status.label}：已采用 ${status.resultCount} 条（${getRuntimeProviderLabel(
      status.provider
    )}）`;
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
