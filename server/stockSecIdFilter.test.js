import assert from 'node:assert/strict';
import test from 'node:test';
import { createLedgerFlowServer } from './mysqlSnapshotServer.js';

/**
 * 个股行情:secid 不能被「只放行 A 股」的过滤挡掉。
 *
 * 这是「添加了个股但看不到净值」的根因:两个客户端(前端 fetch 与这个接口)原来都用
 * `/^[01]\.\d{6}$/` 过滤 —— 那是 A 股形状,美股 `105.AAPL`、港股 `116.00700` 全被拒,
 * 接口直接 500,于是个股永远取不到价,界面上停在「净值 待更新」。
 *
 * 东财的 secid 形态是「市场.代码」,代码未必是纯数字 —— 这里同时钉住三种市场,
 * 也钉住「乱码仍然要被拒」(过滤不能放宽到什么都收)。
 */

async function withServer(run) {
  const server = createLedgerFlowServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = 'http://127.0.0.1:' + port;
  try {
    await run(base);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

/** 只把东财行情接口 mock 掉,其余请求放行(否则测试自己请求本地服务端会被拦)。 */
function installQuoteMock() {
  const original = global.fetch;
  const requested = [];
  global.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('push2.eastmoney.com')) {
      const secids = (new URL(url).searchParams.get('secids') || '').split(',');
      requested.push(...secids);
      return new Response(
        JSON.stringify({
          rc: 0,
          data: {
            diff: secids.map((secid) => {
              const [market, code] = secid.split('.');
              return { f12: code, f13: Number(market), f14: code + ' 名称', f2: 100.5, f3: 1.23 };
            })
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return original(input, init);
  };
  return { requested, restore: () => { global.fetch = original; } };
}

test('secid 过滤:A 股、美股、港股都放行,乱码仍然拒绝', async () => {
  const mock = installQuoteMock();
  try {
    await withServer(async (base) => {
      // 三种市场一起请求
      const ok = await fetch(
        base + '/api/market/stock-quotes?secids=' + encodeURIComponent('0.000001,105.AAPL,116.00700')
      );
      assert.equal(ok.status, 200, 'A股/美股/港股都应当被接受');
      const body = await ok.json();
      assert.deepEqual(
        body.data.quotes.map((quote) => quote.secId),
        ['0.000001', '105.AAPL', '116.00700']
      );
      assert.equal(body.data.quotes[1].price, 100.5, '带上最新价(f2)');
      assert.ok(mock.requested.includes('105.AAPL'), '美股确实被转发到上游');

      // 乱码必须被拒 —— 不能放宽到什么都收
      const bad = await fetch(base + '/api/market/stock-quotes?secids=' + encodeURIComponent('not-a-secid'));
      assert.equal(bad.status, 500);
    });
  } finally {
    mock.restore();
  }
});

test('secid 过滤:空的一批也算非法(不能拿空数组去请求上游)', async () => {
  const mock = installQuoteMock();
  try {
    await withServer(async (base) => {
      const response = await fetch(base + '/api/market/stock-quotes?secids=,,,');
      assert.equal(response.status, 500);
      assert.equal(mock.requested.length, 0, '非法输入时不该请求上游');
    });
  } finally {
    mock.restore();
  }
});