import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSearchProvider } from '../../../shared/config/webSearchProviders';
import type {
  WebSearchProviderCredential,
  WebSearchSettings
} from '../../../shared/store/useAiSettings';
import { buildWebSearchPrompt, fetchWebSearchContext } from './webSearchClient';

const fetchMock = vi.fn();

function createSettings(overrides: Partial<WebSearchSettings> = {}): WebSearchSettings {
  return {
    provider: 'tavily',
    credentials: {
      tavily: { apiKey: 'tvly-test', baseUrl: 'https://api.tavily.com', engineId: '' },
      brave: { apiKey: '', baseUrl: 'https://api.search.brave.com', engineId: '' },
      serper: { apiKey: '', baseUrl: 'https://google.serper.dev', engineId: '' },
      exa: { apiKey: '', baseUrl: 'https://api.exa.ai', engineId: '' },
      google: { apiKey: '', baseUrl: 'https://www.googleapis.com', engineId: '' }
    },
    localEndpoint: '/api/web-search',
    maxResults: 5,
    ...overrides
  };
}

function withProvider(
  provider: WebSearchProvider,
  credential: Partial<WebSearchProviderCredential>,
  overrides: Partial<WebSearchSettings> = {}
): WebSearchSettings {
  const base = createSettings();
  return {
    ...base,
    provider,
    credentials: {
      ...base.credentials,
      [provider]: { ...base.credentials[provider], ...credential }
    },
    ...overrides
  };
}

const settings = createSettings();

function response(results: Array<{ title: string; url: string; content: string }>, answer?: string) {
  return {
    ok: true,
    json: async () => ({ results, ...(answer ? { answer } : {}) })
  };
}

function sourceResult(source: '10jqka' | 'xueqiu', index: number) {
  const domain = source === '10jqka' ? '10jqka.com.cn' : 'xueqiu.com';
  return {
    title: `${source}-${index}`,
    url: `https://${domain}/article/${index}`,
    content: `${source} 资讯 ${index}`
  };
}

describe('webSearchClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('同花顺和雪球都成功时会合并、去重并显示实际来源', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body || '{}')) as { include_domains?: string[] };
      if (body.include_domains?.[0] === '10jqka.com.cn') {
        return response([
          sourceResult('10jqka', 1),
          { ...sourceResult('10jqka', 1), url: 'https://10jqka.com.cn/article/1/' },
          sourceResult('10jqka', 2)
        ]);
      }
      return response([sourceResult('xueqiu', 1), sourceResult('xueqiu', 2)]);
    });

    const context = await fetchWebSearchContext('分析这只基金', settings, undefined, {
      investmentNewsSources: ['10jqka', 'xueqiu']
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(context.sources).toEqual(['同花顺', '雪球']);
    expect(context.results.map((item) => item.sourceLabel)).toEqual([
      '同花顺',
      '雪球',
      '同花顺',
      '雪球'
    ]);
    expect(context.results).toHaveLength(4);
    expect(context.sourceStatuses).toEqual([
      expect.objectContaining({ label: '同花顺', status: 'success', resultCount: 2 }),
      expect.objectContaining({ label: '雪球', status: 'success', resultCount: 2 })
    ]);
    const prompt = buildWebSearchPrompt(context);
    expect(prompt).toContain('同花顺：已采用 2 条');
    expect(prompt).toContain('雪球：已采用 2 条');
    expect(prompt).toContain('实际采用来源：同花顺、雪球');
  });

  it('雪球失败时继续使用同花顺，不回退到普通网络', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body || '{}')) as { include_domains?: string[]; query?: string };
      if (body.include_domains?.[0] === '10jqka.com.cn') {
        return response([sourceResult('10jqka', 1)]);
      }
      if (body.include_domains?.[0] === 'xueqiu.com' || body.query?.includes('site:xueqiu.com')) {
        throw new Error('雪球暂不可用');
      }
      throw new Error('不应调用普通网络');
    });

    const context = await fetchWebSearchContext('分析这只基金', settings, undefined, {
      investmentNewsSources: ['10jqka', 'xueqiu']
    });

    expect(context.status).toBe('success');
    expect(context.sources).toEqual(['同花顺']);
    expect(context.results[0].sourceLabel).toBe('同花顺');
    expect(context.sourceStatuses).toEqual([
      expect.objectContaining({ label: '同花顺', status: 'success' }),
      expect.objectContaining({ label: '雪球', status: 'unavailable' })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('同花顺失败时继续使用雪球', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body || '{}')) as { include_domains?: string[]; query?: string };
      if (body.include_domains?.[0] === 'xueqiu.com') {
        return response([sourceResult('xueqiu', 1)]);
      }
      if (body.include_domains?.[0] === '10jqka.com.cn' || body.query?.includes('site:10jqka.com.cn')) {
        throw new Error('同花顺暂不可用');
      }
      throw new Error('不应调用普通网络');
    });

    const context = await fetchWebSearchContext('分析这只基金', settings, undefined, {
      investmentNewsSources: ['10jqka', 'xueqiu']
    });

    expect(context.status).toBe('success');
    expect(context.sources).toEqual(['雪球']);
    expect(context.results[0].sourceLabel).toBe('雪球');
    expect(context.sourceStatuses?.find((item) => item.label === '同花顺')).toMatchObject({
      status: 'unavailable'
    });
    expect(context.sourceStatuses?.find((item) => item.label === '雪球')).toMatchObject({
      status: 'success'
    });
  });

  it('两个投资来源都失败时才回退普通公开网络', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body || '{}')) as { include_domains?: string[]; query?: string };
      if (body.include_domains?.length || body.query?.includes('site:')) {
        throw new Error('投资来源暂不可用');
      }
      return response([
        {
          title: '公开市场快讯',
          url: 'https://example.com/market-news',
          content: '公开网络回退资讯。'
        }
      ]);
    });

    const context = await fetchWebSearchContext('分析这只基金', settings, undefined, {
      investmentNewsSources: ['10jqka', 'xueqiu']
    });

    expect(context.status).toBe('success');
    expect(context.sources).toEqual(['公开网络']);
    expect(context.message).toContain('自动改用公开网络');
    expect(context.sourceStatuses).toEqual([
      expect.objectContaining({ label: '同花顺', status: 'unavailable' }),
      expect.objectContaining({ label: '雪球', status: 'unavailable' }),
      expect.objectContaining({ label: '公开网络', status: 'success' })
    ]);
    expect(buildWebSearchPrompt(context)).toContain('自动切换');
  });

  it('calls Brave with its subscription token and normalizes web results', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://api.search.brave.com');
      expect(parsed.pathname).toBe('/res/v1/web/search');
      expect(parsed.searchParams.get('q')).toBe('黄金价格');
      expect(parsed.searchParams.get('count')).toBe('4');
      expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('brave-test');
      return {
        ok: true,
        json: async () => ({
          web: {
            results: [
              {
                title: 'Brave 黄金快讯',
                url: 'https://example.com/gold',
                description: '金价站上新高。',
                page_age: '2026-11-01'
              }
            ]
          }
        })
      };
    });

    const context = await fetchWebSearchContext(
      '黄金价格',
      withProvider('brave', { apiKey: 'brave-test' }, { maxResults: 4 })
    );

    expect(context.provider).toBe('brave');
    expect(context.results).toEqual([
      expect.objectContaining({
        title: 'Brave 黄金快讯',
        url: 'https://example.com/gold',
        content: '金价站上新高。',
        publishedDate: '2026-11-01'
      })
    ]);
  });

  it('calls Serper with its API key and normalizes organic results', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://google.serper.dev/search');
      expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('serper-test');
      const body = JSON.parse(String(init.body)) as { q: string; num: number };
      expect(body.q).toBe('A股行情');
      expect(body.num).toBe(5);
      return {
        ok: true,
        json: async () => ({
          organic: [
            {
              title: 'Serper A股',
              link: 'https://example.com/stock',
              snippet: '沪深两市收涨。',
              date: '2026-11-02'
            }
          ]
        })
      };
    });

    const context = await fetchWebSearchContext(
      'A股行情',
      withProvider('serper', { apiKey: 'serper-test' })
    );

    expect(context.provider).toBe('serper');
    expect(context.results[0]).toMatchObject({
      title: 'Serper A股',
      url: 'https://example.com/stock',
      content: '沪深两市收涨。',
      publishedDate: '2026-11-02'
    });
  });

  it('calls Exa with its API key and normalizes semantic results', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.exa.ai/search');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('exa-test');
      const body = JSON.parse(String(init.body)) as { query: string; numResults: number };
      expect(body.query).toBe('新能源基金');
      expect(body.numResults).toBe(5);
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Exa 新能源',
              url: 'https://example.com/energy',
              text: '新能源主题基金近一年回撤明显。',
              publishedDate: '2026-10-30',
              score: 0.87
            }
          ]
        })
      };
    });

    const context = await fetchWebSearchContext(
      '新能源基金',
      withProvider('exa', { apiKey: 'exa-test' })
    );

    expect(context.provider).toBe('exa');
    expect(context.results[0]).toMatchObject({
      title: 'Exa 新能源',
      content: '新能源主题基金近一年回撤明显。',
      publishedDate: '2026-10-30',
      score: 0.87
    });
  });

  it('calls Google CSE with key and engine id, then normalizes items', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://www.googleapis.com');
      expect(parsed.pathname).toBe('/customsearch/v1');
      expect(parsed.searchParams.get('key')).toBe('google-test');
      expect(parsed.searchParams.get('cx')).toBe('cx-test');
      expect(parsed.searchParams.get('q')).toBe('汇率');
      expect(parsed.searchParams.get('num')).toBe('5');
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              title: 'Google CSE 汇率',
              link: 'https://example.com/fx',
              snippet: '人民币汇率保持稳定。'
            }
          ]
        })
      };
    });

    const context = await fetchWebSearchContext(
      '汇率',
      withProvider('google', { apiKey: 'google-test', engineId: 'cx-test' })
    );

    expect(context.provider).toBe('google');
    expect(context.results[0]).toMatchObject({
      title: 'Google CSE 汇率',
      url: 'https://example.com/fx',
      content: '人民币汇率保持稳定。'
    });
  });

  it('falls back to the local endpoint when the selected provider has no key', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/web-search');
      const body = JSON.parse(String(init.body)) as { query: string };
      expect(body.query).toBe('今日金价');
      return response([
        { title: '本地结果', url: 'https://example.com/local', content: '本地检索内容' }
      ]);
    });

    const context = await fetchWebSearchContext(
      '今日金价',
      withProvider('brave', { apiKey: '' })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(context.provider).toBe('local');
    expect(context.status).toBe('success');
    expect(context.results[0].title).toBe('本地结果');
  });
});
