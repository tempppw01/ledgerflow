import assert from 'node:assert/strict';
import test from 'node:test';
import { clearGlobalMarketQuoteCache, createLedgerFlowServer } from './mysqlSnapshotServer.js';

/**
 * 全球行情的故障转移。
 *
 * 原来只有 Yahoo 一个源,它慢或挂的时候整块就空了。现在按 Yahoo → 东方财富 → 新浪 依次退。
 * 这几条测试盯的就是「真的会退」以及「主源正常时不要去打扰备用源」:
 *
 *   · Yahoo 全挂          → 东财补上,source 反映实际来源
 *   · Yahoo + 东财都挂     → 新浪补上美股那几个
 *   · Yahoo 正常          → 一次备用源请求都不发(不浪费配额与延迟)
 */

const INDEX_NAMES = {
  '^DJI': 'Dow Jones',
  '^GSPC': 'S&P 500',
  '^IXIC': 'NASDAQ Composite',
  '^NDX': 'NASDAQ 100',
  '^N225': 'Nikkei 225',
  '^KS11': 'KOSPI'
};

const EASTMONEY_BY_SECID = {
  '100.DJIA': { f43: 49595.31, f60: 48147.33, f169: 1447.98, f170: 3.01 },
  '100.SPX': { f43: 7237.17, f60: 6910.39, f169: 326.78, f170: 4.73 },
  '100.NDX': { f43: 24089.56, f60: 22617.73, f169: 1471.83, f170: 6.51 },
  '100.NDX100': { f43: 26746.1, f60: 25028.98, f169: 1717.12, f170: 6.86 },
  '100.N225': { f43: 58644.63, f60: 56436.65, f169: 2207.98, f170: 3.91 },
  '100.KS11': { f43: 5006.03, f60: 4708.54, f169: 297.49, f170: 6.32 }
};

function yahooPayload(symbol) {
  return {
    chart: {
      result: [
        {
          meta: {
            shortName: INDEX_NAMES[symbol],
            regularMarketPrice: 100,
            regularMarketChange: 1.5,
            regularMarketChangePercent: 1.5,
            chartPreviousClose: 98.5,
            regularMarketDayHigh: 101,
            regularMarketDayLow: 97
          },
          timestamp: [Date.parse('2026-08-07T08:00:00Z') / 1000],
          indicators: { quote: [{ close: [100], high: [101], low: [97] }] }
        }
      ]
    }
  };
}

async function withServer(run) {
  // 模块级缓存会跨用例残留(缓存本身是正确行为),每个用例前清一次
  clearGlobalMarketQuoteCache();
  const server = createLedgerFlowServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run('http://127.0.0.1:' + port);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

/** 装一个按域名分流的 fetch mock,返回调用计数。 */
function installFetchMock({ yahoo = 'ok', eastmoney = 'ok', sina = 'ok' } = {}) {
  const calls = { yahoo: 0, eastmoney: 0, sina: 0 };
  const original = global.fetch;
  global.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('query1.finance.yahoo.com')) {
      calls.yahoo += 1;
      if (yahoo === 'fail') return new Response('', { status: 503 });
      const symbol = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      return new Response(JSON.stringify(yahooPayload(symbol)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.includes('push2.eastmoney.com')) {
      calls.eastmoney += 1;
      if (eastmoney === 'fail') return new Response('', { status: 503 });
      const secid = new URL(url).searchParams.get('secid');
      const data = EASTMONEY_BY_SECID[secid] || null;
      return new Response(JSON.stringify({ rc: 0, data: data ? { ...data, f58: secid } : null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.includes('hq.sinajs.cn')) {
      calls.sina += 1;
      if (sina === 'fail') return new Response('', { status: 503 });
      // 新浪用的是路径形式 /list=gb_$dji,...(没有 ?),别从 search 里取
      const list = (url.split('/list=')[1] || '').split('&')[0];
      const body = list
        .split(',')
        .map((code) => `var hq_str_${code}="NAME,7000.1234,1.23,2026-11-24 05:42:47,85.0000,6915.1234";`)
        .join('\n');
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    // 不是行情域名的一律放行 —— 否则测试自己请求本地服务端也会被拦(踩过一次)
    return original(input, init);
  };
  return { calls, restore: () => { global.fetch = original; } };
}

test('Yahoo 全挂时由东方财富补上,source 反映实际来源', async () => {
  const mock = installFetchMock({ yahoo: 'fail' });
  try {
    await withServer(async (base) => {
      const response = await fetch(base + '/api/market/global-quotes');
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.data.quotes.length, 6, '6 个指数都应当有数据');
      assert.equal(body.data.source, '东方财富');
      assert.ok(mock.calls.eastmoney >= 6, '每个缺失的指数都去问过东财');
      assert.equal(mock.calls.sina, 0, '东财够了就不该再问新浪');

      const dow = body.data.quotes.find((quote) => quote.id === 'us-dow');
      assert.equal(dow.value, 49595.31, '价格必须与东财一致(fltt=2 缩放正确)');
      assert.equal(dow.changePercent, 3.01);
      assert.equal(dow.source, '东方财富');
      // 备用源没有盘前/盘后,不能编一个出来
      assert.equal(dow.extended, undefined);
    });
  } finally {
    mock.restore();
  }
});

test('Yahoo 与东财都挂时,新浪补上美股那几个', async () => {
  const mock = installFetchMock({ yahoo: 'fail', eastmoney: 'fail' });
  try {
    await withServer(async (base) => {
      const response = await fetch(base + '/api/market/global-quotes');
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.ok(mock.calls.sina > 0, '应当退到新浪');
      const byId = new Map(body.data.quotes.map((quote) => [quote.id, quote]));
      assert.equal(byId.get('us-dow').value, 7000.1234);
      assert.equal(byId.get('us-dow').source, '新浪财经');
      // 新浪不覆盖日经/韩国综指 —— 那两个没有就没有,不能编
      assert.equal(byId.has('jp-nikkei'), false);
      assert.equal(byId.has('kr-kospi'), false);
    });
  } finally {
    mock.restore();
  }
});

test('Yahoo 正常时一次备用源请求都不发', async () => {
  const mock = installFetchMock();
  try {
    await withServer(async (base) => {
      const response = await fetch(base + '/api/market/global-quotes');
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.data.quotes.length, 6);
      assert.equal(mock.calls.eastmoney, 0, '主源正常就不该打扰备用源');
      assert.equal(mock.calls.sina, 0);
      assert.match(body.data.source, /Yahoo/);
    });
  } finally {
    mock.restore();
  }
});