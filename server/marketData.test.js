import assert from 'node:assert/strict';
import test from 'node:test';
import { createLedgerFlowServer } from './mysqlSnapshotServer.js';

async function closeServer(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

test('fund realtime endpoint falls back to Tonghuashun when Eastmoney is unavailable', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('eastmoney.com')) {
      throw new Error('Eastmoney network error');
    }
    if (url.includes('fund.10jqka.com.cn')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              code: '004856',
              name: '广发中证全指建筑材料指数A',
              enddate: '2026-07-31',
              net: '0.8040',
              rate: '-0.20'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`Unexpected upstream: ${url}`);
  };

  const server = createLedgerFlowServer();
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/api/market/fund-realtime?code=004856`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, {
      fundcode: '004856',
      name: '广发中证全指建筑材料指数A',
      jzrq: '2026-07-31',
      dwjz: '0.8040',
      gsz: '0.8040',
      gszzl: '-0.20',
      gztime: '2026-07-31'
    });
  } finally {
    global.fetch = originalFetch;
    await closeServer(server);
  }
});

test('global market endpoint aggregates US, Japan and Korea indexes through Yahoo Finance', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/%5E/i);
    const symbol = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const names = {
      '^DJI': 'Dow Jones Industrial Average',
      '^GSPC': 'S&P 500',
      '^IXIC': 'NASDAQ Composite',
      '^NDX': 'NASDAQ 100',
      '^N225': 'Nikkei 225',
      '^KS11': 'KOSPI Composite Index'
    };
    return new Response(
      JSON.stringify({
        chart: {
          result: [
            {
              meta: {
                shortName: names[symbol],
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
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const server = createLedgerFlowServer();
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/api/market/global-quotes`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.source, 'Yahoo Finance');
    assert.equal(body.data.quotes.length, 6);
    assert.deepEqual(body.data.quotes[0], {
      id: 'us-dow',
      market: '美股',
      name: 'Dow Jones Industrial Average',
      symbol: '^DJI',
      value: 100,
      change: 1.5,
      changePercent: 1.5,
      high: 101,
      low: 97,
      previousClose: 98.5,
      updatedAt: '2026-08-07T08:00:00.000Z',
      source: 'Yahoo Finance'
    });
  } finally {
    global.fetch = originalFetch;
    await closeServer(server);
  }
});

test('global market history endpoint proxies Yahoo daily candles for simulation', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/%5EDJI/);
    assert.match(url, /interval=1d/);
    return new Response(
      JSON.stringify({
        chart: {
          result: [
            {
              timestamp: [Date.parse('2026-01-02T21:00:00Z') / 1000, Date.parse('2026-01-05T21:00:00Z') / 1000],
              indicators: {
                quote: [
                  {
                    open: [100, 105],
                    close: [102, 107],
                    high: [103, 108],
                    low: [99, 104],
                    volume: [1000, 1200]
                  }
                ]
              }
            }
          ]
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const server = createLedgerFlowServer();
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/api/market/global-history?id=us-dow&start=2026-01-01&end=2026-01-05`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.meta.symbol, '^DJI');
    assert.deepEqual(body.data.points, [
      {
        date: '2026-01-02',
        value: 102,
        open: 100,
        high: 103,
        low: 99,
        changePercent: null,
        volume: 1000,
        amount: null
      },
      {
        date: '2026-01-05',
        value: 107,
        open: 105,
        high: 108,
        low: 104,
        changePercent: (107 - 102) / 102 * 100,
        volume: 1200,
        amount: null
      }
    ]);
  } finally {
    global.fetch = originalFetch;
    await closeServer(server);
  }
});

test('A-share market history endpoint proxies daily kline ranges', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /push2his\.eastmoney\.com\/api\/qt\/stock\/kline\/get/);
    assert.match(url, /secid=1\.000001/);
    assert.match(url, /beg=20260101/);
    assert.match(url, /end=20260807/);
    return new Response(
      JSON.stringify({
        data: {
          code: '000001',
          name: '上证指数',
          klines: ['2026-08-07,3980,4000,4010,3970,120000,300000000,1.00,0.50,20,0.80']
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const server = createLedgerFlowServer();
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/api/market/eastmoney/history?secid=1.000001&start=2026-01-01&end=2026-08-07`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.meta.secId, '1.000001');
    assert.equal(body.meta.start, '20260101');
    assert.equal(body.meta.end, '20260807');
    assert.equal(body.data.data.klines.length, 1);
  } finally {
    global.fetch = originalFetch;
    await closeServer(server);
  }
});

test('Eastmoney board stocks endpoint proxies constituents for a board', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /push2\.eastmoney\.com\/api\/qt\/clist\/get/);
    assert.match(url, /fs=b%3ABK9999|fs=b:BK9999/);
    assert.match(url, /pz=3/);
    return new Response(
      JSON.stringify({
        data: {
          diff: [{ f12: '300001', f14: '示例公司', f2: 20, f3: 3.2, f4: 0.62 }]
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const server = createLedgerFlowServer();
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/api/market/eastmoney/board-stocks?code=bk9999&pageSize=3`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.data.diff, [
      { f12: '300001', f14: '示例公司', f2: 20, f3: 3.2, f4: 0.62 }
    ]);
  } finally {
    global.fetch = originalFetch;
    await closeServer(server);
  }
});
