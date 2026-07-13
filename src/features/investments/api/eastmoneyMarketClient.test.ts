import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EASTMONEY_MARKET_NEWS_CATEGORIES,
  fetchEastmoneyMarketQuotes
} from './eastmoneyMarketClient';

describe('fetchEastmoneyMarketQuotes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('保留深市市场编号 0 并生成可匹配的 secId', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const quotes = await fetchEastmoneyMarketQuotes();

    expect(quotes.map((quote) => quote.secId)).toEqual(['0.399001', '0.399006']);
  });
});

describe('EASTMONEY_MARKET_NEWS_CATEGORIES', () => {
  it('使用东方财富当前快讯栏目编号', () => {
    expect(
      EASTMONEY_MARKET_NEWS_CATEGORIES.map(({ label, column }) => [label, column])
    ).toEqual([
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
