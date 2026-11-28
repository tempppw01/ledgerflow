import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearEastmoneyMarketQuoteCache,
  EASTMONEY_MARKET_THEMES,
  EASTMONEY_MARKET_NEWS_CATEGORIES,
  fetchEastmoneyMarketBoards,
  fetchEastmoneyMarketBoardConstituents,
  fetchEastmoneyIndexHistory,
  fetchEastmoneyMarketThemeBoards,
  fetchEastmoneyMarketQuotes,
  fetchGlobalMarketSectorBoards,
  fetchGlobalMarketHistory
} from './eastmoneyMarketClient';

describe('fetchEastmoneyIndexHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('通过同源接口获取并解析指数日线', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            data: {
              klines: ['2026-08-07,3980,4000,4010,3970,120000,300000000,1.00,0.50,20,0.80']
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const points = await fetchEastmoneyIndexHistory('1.000001', { range: '3m' });

    expect(points).toEqual([
      {
        date: '2026-08-07',
        value: 4000,
        open: 3980,
        high: 4010,
        low: 3970,
        changePercent: 0.5,
        volume: 120000,
        amount: 300000000
      }
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/market/eastmoney/history?secid=1.000001&range=3m'
    );
  });
});

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
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe('fetchGlobalMarketHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('通过同源接口获取并解析国际指数日线', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            points: [
              {
                date: '2026-08-07',
                value: 100,
                open: 98,
                high: 101,
                low: 97,
                changePercent: 1.5,
                volume: 1000,
                amount: null
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(fetchGlobalMarketHistory('us-dow', { range: '1y' })).resolves.toEqual([
      {
        date: '2026-08-07',
        value: 100,
        open: 98,
        high: 101,
        low: 97,
        changePercent: 1.5,
        volume: 1000,
        amount: null
      }
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/market/global-history?id=us-dow&range=1y'
    );
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

describe('全球行业交叉参照', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('通过同源接口获取 Yahoo 行业 ETF 的涨跌幅', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            total: 1,
            diff: [{ f12: 'YF:XLK', f14: '科技', f2: 200, f3: 1.25, f4: 2.5 }]
          },
          meta: {
            source: 'Yahoo Finance 行业 ETF',
            updatedAt: '2026-08-07T15:00:00.000Z',
            freshness: 'live'
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(fetchGlobalMarketSectorBoards()).resolves.toMatchObject({
      boards: [
        expect.objectContaining({
          code: 'YF:XLK',
          name: '科技',
          changePercent: 1.25
        })
      ],
      meta: expect.objectContaining({
        source: 'Yahoo Finance 行业 ETF',
        freshness: 'live'
      })
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/market/global-sectors');
  });
});

describe('板块成分股行情', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('通过同源接口获取板块内领涨公司并解析涨跌幅', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            data: {
              diff: [
                { f12: '300001', f14: '特锐德', f2: 31.2, f3: 4.5, f4: 1.34 },
                { f12: '600001', f14: '示例股份', f2: 12.3, f3: -1.2, f4: -0.15 }
              ]
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(fetchEastmoneyMarketBoardConstituents('bk0001', 3)).resolves.toEqual([
      {
        code: '300001',
        name: '特锐德',
        value: 31.2,
        change: 1.34,
        changePercent: 4.5
      },
      {
        code: '600001',
        name: '示例股份',
        value: 12.3,
        change: -0.15,
        changePercent: -1.2
      }
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/market/eastmoney/board-stocks?code=BK0001&pageSize=3'
    );
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

describe('fetchGlobalMarketOverview 的字段映射', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 这里曾经真的丢过数据:映射是**白名单**逐字段挑的,服务端明明返回了 extended(盘前/盘后),
   * 客户端没显式带上就被丢掉 —— 接口有数据、界面什么都没有。这条钉住"扩展时段字段必须活着穿过映射"。
   */
  it('盘前/盘后字段能穿过映射,不被白名单丢掉', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            source: 'Yahoo Finance',
            updatedAt: '2026-11-24T10:30:00.000Z',
            quotes: [
              {
                id: 'us-sp500',
                market: '美股',
                name: '标普 500',
                symbol: '^GSPC',
                value: 7237.17,
                change: 339.1,
                changePercent: 4.9,
                high: 7240,
                low: 6900,
                previousClose: 6898.07,
                updatedAt: '2026-11-24T10:30:00.000Z',
                source: 'Yahoo Finance',
                extended: {
                  session: 'pre',
                  symbol: 'SPY',
                  price: 718.65,
                  change: 28.84,
                  changePercent: 4.18,
                  previousClose: 689.81,
                  updatedAt: '2026-11-24T10:30:50.000Z'
                }
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { fetchGlobalMarketOverview } = await import('./eastmoneyMarketClient');
    const overview = await fetchGlobalMarketOverview();

    expect(overview.quotes[0].extended).toEqual({
      session: 'pre',
      symbol: 'SPY',
      price: 718.65,
      change: 28.84,
      changePercent: 4.18,
      previousClose: 689.81,
      updatedAt: '2026-11-24T10:30:50.000Z'
    });
  });

  it('时段字段不合法时映射为 null(宁可不显示,也不显示可疑数字)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            source: 'Yahoo Finance',
            updatedAt: '2026-11-24T10:30:00.000Z',
            quotes: [
              {
                id: 'us-sp500',
                market: '美股',
                name: '标普 500',
                symbol: '^GSPC',
                value: 7237.17,
                changePercent: 4.9,
                previousClose: 6898.07,
                updatedAt: '2026-11-24T10:30:00.000Z',
                extended: { session: 'lunch', symbol: 'SPY', price: 718.65, changePercent: 4.18 }
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { fetchGlobalMarketOverview } = await import('./eastmoneyMarketClient');
    const overview = await fetchGlobalMarketOverview();

    expect(overview.quotes[0].extended).toBeNull();
  });
});

describe('行情源整体故障时的兜底节流', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearEastmoneyMarketQuoteCache();
  });

  const okJson = (diff: unknown[]) =>
    new Response(JSON.stringify({ data: { data: { diff } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  const serverError = () => new Response('{"ok":false}', { status: 500 });

  // 批量请求的 secids 用 encodeURIComponent 拼过,逗号会变成 %2C;单只请求没有逗号。
  const isBatchUrl = (url: string) => url.includes('%2C');

  /** 单只指数请求按 URL 里的 secId 回一条行情,保证兜底确实能救回数据 */
  function singleQuoteResponse(url: string) {
    const secId = /secids=([0-9]+\.[0-9]+)/.exec(url)?.[1] || '';
    const [market, code] = secId.split('.');
    return okJson([{ f12: code, f13: Number(market), f14: code, f2: 100, f3: 0.25 }]);
  }

  function mockFetch(respondBatch: (call: number) => Response) {
    const calls: string[] = [];
    let batchCall = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (isBatchUrl(url)) {
        batchCall += 1;
        return respondBatch(batchCall);
      }
      return singleQuoteResponse(url);
    });
    return { fetchMock, calls };
  }

  it('整批失败后 60 秒内不再重复兜底,缓存里的行情照常返回', async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { calls } = mockFetch(() => serverError());

    // 第一个周期:批量失败 → 兜底,单只请求把 5 条全救回来
    const first = await fetchEastmoneyMarketQuotes();
    expect(calls.filter(isBatchUrl)).toHaveLength(1);
    expect(calls).toHaveLength(6);
    expect(first.map((quote) => quote.secId)).toEqual([
      '1.000001',
      '0.399001',
      '0.399006',
      '1.000688',
      '1.000300'
    ]);

    // 10 秒后的下一个轮询周期:只打批量,不再重放 5 次兜底
    calls.length = 0;
    now += 10_000;
    const second = await fetchEastmoneyMarketQuotes();
    expect(calls.filter(isBatchUrl)).toHaveLength(1);
    expect(calls).toHaveLength(1);
    // 兜底被跳过,但缓存里的行情还在,界面不会因此变空
    expect(second.map((quote) => quote.secId)).toEqual(first.map((quote) => quote.secId));

    // 冷却结束后再给兜底一次机会(部分故障仍能靠它恢复)
    calls.length = 0;
    now += 60_000;
    await fetchEastmoneyMarketQuotes();
    expect(calls).toHaveLength(6);
  });

  it('批量成功但少几条时不受节流影响,该补还是补', async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    // 第一次整批失败,把冷却期打开
    const { calls } = mockFetch((call) =>
      call === 1
        ? serverError()
        : okJson([
            { f12: '399001', f13: 0, f14: '深证成指', f2: 14600, f3: -1.2 },
            { f12: '399006', f13: 0, f14: '创业板指', f2: 3751, f3: -2.38 },
            { f12: '000688', f13: 1, f14: '科创50', f2: 900, f3: 0.4 },
            { f12: '000300', f13: 1, f14: '沪深300', f2: 4200, f3: 0.2 }
          ])
    );
    await fetchEastmoneyMarketQuotes();
    expect(calls).toHaveLength(6);

    // 紧接着一次批量「成功但缺了上证指数」:路径不同,不受冷却限制
    calls.length = 0;
    now += 5_000;
    const quotes = await fetchEastmoneyMarketQuotes();
    expect(calls.filter(isBatchUrl)).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(quotes.map((quote) => quote.secId)).toContain('1.000001');
  });

  it('行情源正常时批量一次就够,不触发任何兜底', async () => {
    const { calls } = mockFetch(() =>
      okJson([
        { f12: '000001', f13: 1, f14: '上证指数', f2: 3900, f3: 0.5 },
        { f12: '399001', f13: 0, f14: '深证成指', f2: 14600, f3: -1.2 },
        { f12: '399006', f13: 0, f14: '创业板指', f2: 3751, f3: -2.38 },
        { f12: '000688', f13: 1, f14: '科创50', f2: 900, f3: 0.4 },
        { f12: '000300', f13: 1, f14: '沪深300', f2: 4200, f3: 0.2 }
      ])
    );

    const quotes = await fetchEastmoneyMarketQuotes();

    expect(calls).toHaveLength(1);
    expect(quotes).toHaveLength(5);
  });
});

describe('并发请求同一轮行情(StrictMode 双挂载)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearEastmoneyMarketQuoteCache();
  });

  const okJson = (diff: unknown[]) =>
    new Response(JSON.stringify({ data: { data: { diff } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  const isBatchUrl = (url: string) => url.includes('%2C');

  function singleQuoteResponse(url: string) {
    const secId = /secids=([0-9]+\.[0-9]+)/.exec(url)?.[1] || '';
    const [market, code] = secId.split('.');
    return okJson([{ f12: code, f13: Number(market), f14: code, f2: 100, f3: 0.25 }]);
  }

  it('两个并发调用共用一轮上游请求,结果也一致', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (isBatchUrl(url)) return new Response('{"ok":false}', { status: 500 });
      return singleQuoteResponse(url);
    });

    const [first, second] = await Promise.all([
      fetchEastmoneyMarketQuotes(),
      fetchEastmoneyMarketQuotes()
    ]);

    // 一轮 = 1 次批量 + 5 次兜底;第二个调用等第一个的结果,不另开一轮
    expect(calls).toHaveLength(6);
    expect(first).toHaveLength(5);
    expect(second).toBe(first);
  });

  it('上一轮结束后不再复用旧结果,下一个周期正常发起', async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (isBatchUrl(url)) return new Response('{"ok":false}', { status: 500 });
      return singleQuoteResponse(url);
    });

    await fetchEastmoneyMarketQuotes();
    expect(calls).toHaveLength(6);

    // 在途标记已经清掉:下一次调用会真的再打一轮(只是兜底被冷却挡住)
    calls.length = 0;
    now += 1_000;
    const next = await fetchEastmoneyMarketQuotes();
    expect(calls).toHaveLength(1);
    expect(next).toHaveLength(5);
  });
});
