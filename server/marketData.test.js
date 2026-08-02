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
