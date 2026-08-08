import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearEastmoneyMarketQuoteCache,
  EASTMONEY_MARKET_THEMES,
  EASTMONEY_MARKET_NEWS_CATEGORIES,
  fetchEastmoneyMarketBoards,
  fetchEastmoneyMarketThemeBoards,
  fetchEastmoneyMarketQuotes
} from './eastmoneyMarketClient';

describe('fetchEastmoneyMarketQuotes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearEastmoneyMarketQuoteCache();
  });

  it('保留深市市场编号 0 并生成可匹配的 secId', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            data: {
              diff: [
                {
                  f12: '399001',
                  f13: 0,
                  f14: '深证成指',
                  f2: 14654.49,
                  f3: -2.61
                },
                {
                  f12: '399006',
                  f13: 0,
                  f14: '创业板指',
                  f2: 3751.33,
                  f3: -2.38
                }
              ]
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const quotes = await fetchEastmoneyMarketQuotes();

    expect(quotes.map((quote) => quote.secId)).toEqual(['0.399001', '0.399006']);
  });

  it('批量结果缺少指数时会尝试单独补拉', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      const isSingleQuoteRequest = url.includes('secids=1.000001');
      return new Response(
        JSON.stringify({
          data: {
            data: {
              diff: isSingleQuoteRequest
                ? [{ f12: '000001', f13: 1, f14: '上证指数', f2: 3900, f3: 0.5 }]
                : [{ f12: '399001', f13: 0, f14: '深证成指', f2: 14600, f3: -1.2 }]
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const quotes = await fetchEastmoneyMarketQuotes();

    expect(quotes.map((quote) => quote.secId)).toEqual(['1.000001', '0.399001']);
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });
});

describe('fetchEastmoneyMarketBoards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按行业或概念类型请求并解析板块统计', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            data: {
              diff: [
                {
                  f12: 'BK0001',
                  f14: '人工智能',
                  f2: 1200,
                  f3: 2.5,
                  f4: 30,
                  f5: 1000,
                  f6: 200000000,
                  f104: 20,
                  f105: 3,
                  f106: 1
                }
              ]
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const boards = await fetchEastmoneyMarketBoards('concept');

    expect(boards[0]).toMatchObject({
      code: 'BK0001',
      name: '人工智能',
      changePercent: 2.5,
      upCount: 20,
      downCount: 3,
      flatCount: 1
    });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('type=concept');
  });
});

describe('热门题材行情', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('使用预设题材代码批量获取概念报价', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            data: {
              diff: [
                {
                  f12: 'BK1106',
                  f14: '创新药',
                  f2: 1500,
                  f3: 1.2,
                  f4: 18,
                  f5: 1000,
                  f6: 100000000,
                  f104: 20,
                  f105: 4,
                  f106: 1
                }
              ]
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const boards = await fetchEastmoneyMarketThemeBoards();

    expect(boards).toEqual([
      expect.objectContaining({ code: 'BK1106', name: '创新药', changePercent: 1.2 })
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('codes=BK1106');
    expect(EASTMONEY_MARKET_THEMES.map((theme) => theme.name)).toContain('CPO概念');
  });
});

describe('EASTMONEY_MARKET_NEWS_CATEGORIES', () => {
  it('使用东方财富当前快讯栏目编号', () => {
    expect(EASTMONEY_MARKET_NEWS_CATEGORIES.map(({ label, column }) => [label, column])).toEqual([
      ['7×24', '102'],
      ['焦点', '101'],
      ['上市公司', '103'],
      ['中国股市', '104'],
      ['全球股市', '105'],
      ['商品', '106'],
      ['外汇', '107'],
      ['债券', '108'],
      ['基金', '109']
    ]);
  });
});
