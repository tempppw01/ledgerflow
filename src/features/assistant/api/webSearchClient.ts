import { ENV } from '../../../shared/config/env';
import type { WebSearchSettings } from '../../../shared/store/useAiSettings';

type WebSearchProvider = 'tavily' | 'local';

export interface WebSearchResultItem {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
  score?: number;
}

export interface WebSearchContext {
  provider?: WebSearchProvider;
  status: 'success' | 'unavailable';
  query: string;
  answer?: string;
  results: WebSearchResultItem[];
  message?: string;
}

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

function normalizeBaseUrl(value: string) {
  return (value || ENV.tavilyBaseUrl).trim().replace(/\/+$/, '') || ENV.tavilyBaseUrl;
}

function normalizeLocalEndpoint(value: string) {
  return (value || ENV.localWebSearchEndpoint).trim() || ENV.localWebSearchEndpoint;
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
  signal?: AbortSignal
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
      max_results: settings.maxResults
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

export async function fetchWebSearchContext(
  query: string,
  settings: WebSearchSettings,
  signal?: AbortSignal
): Promise<WebSearchContext> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { status: 'unavailable', query, results: [], message: '检索问题为空。' };
  }

  try {
    const tavily = await searchTavily(trimmedQuery, settings, signal);
    if (tavily.results.length > 0 || tavily.answer) return tavily;
  } catch {
    // Tavily 不可用时继续尝试本地同源检索。
  }

  try {
    const local = await searchLocal(trimmedQuery, settings, signal);
    if (local.results.length > 0 || local.answer) return local;
  } catch {
    // fall through to unavailable context
  }

  return {
    status: 'unavailable',
    query: trimmedQuery,
    results: [],
    message: 'Tavily 和本地联网检索都暂时不可用。'
  };
}

export function buildWebSearchPrompt(context: WebSearchContext) {
  if (context.status !== 'success') {
    return [
      '联网核验状态：未取得实时检索结果。',
      context.message ? `原因：${context.message}` : '',
      '请明确说明当前无法实时联网核验，不要编造精确实时数据。'
    ]
      .filter(Boolean)
      .join('\n');
  }

  const rows = context.results.slice(0, 5).map((item, index) => {
    const source = item.url ? `来源：${item.url}` : '来源：未提供';
    const date = item.publishedDate ? `；日期：${item.publishedDate}` : '';
    return `${index + 1}. ${item.title}\n${source}${date}\n摘要：${item.content}`;
  });

  return [
    `联网核验状态：已通过 ${context.provider === 'tavily' ? 'Tavily' : '本地联网接口'} 检索。`,
    context.answer ? `检索摘要：${context.answer}` : '',
    rows.length > 0 ? `检索结果：\n${rows.join('\n\n')}` : '',
    '请只把这些结果作为辅助核验来源；如果结果与用户截图或已知持仓冲突，请指出不确定性。'
  ]
    .filter(Boolean)
    .join('\n');
}
