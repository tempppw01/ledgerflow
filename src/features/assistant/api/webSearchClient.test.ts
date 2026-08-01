import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSearchSettings } from '../../../shared/store/useAiSettings';
import { buildWebSearchPrompt, fetchWebSearchContext } from './webSearchClient';

const fetchMock = vi.fn();

const settings: WebSearchSettings = {
  tavilyApiKey: 'tvly-test',
  tavilyBaseUrl: 'https://api.tavily.com',
  localEndpoint: '/api/web-search',
  provider: 'tavily',
  maxResults: 5
};

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
});
