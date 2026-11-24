import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYahooExtendedSession } from './mysqlSnapshotServer.js';

/**
 * 盘前/盘后(用对应 ETF 代理)的解析。
 *
 * 这段逻辑决定「界面在盘前/盘后显示什么价格」,错了就是显示一个错误的数 —— 所以用
 * 构造好的 Yahoo chart 响应把几条边界钉住:
 *   · 在盘前窗口内 → session='pre',取窗口内最后一个价;
 *   · 在盘后窗口内 → session='post';
 *   · 两个窗口之外 → null(界面不显示,避免展示过时数据);
 *   · 上一时段的残留点(时间戳早于窗口起点)→ 不能拿来当本时段价格;
 *   · 缺 previousClose → null(算不出涨跌就不显示)。
 */

const INDEX = { id: 'us-sp500', symbol: '^GSPC', extendedSymbol: 'SPY' };

/** 构造一个 Yahoo chart 响应。时间用秒。 */
function payload({ pre, post, points, previousClose = 500 }) {
  return {
    chart: {
      result: [
        {
          meta: {
            chartPreviousClose: previousClose,
            currentTradingPeriod: {
              pre: pre || {},
              regular: {},
              post: post || {}
            }
          },
          timestamp: points.map((p) => p.ts),
          indicators: { quote: [{ close: points.map((p) => p.close) }] }
        }
      ]
    }
  };
}

test('盘前窗口内:取盘前最后一个价,并以昨收为基准算涨跌', () => {
  const pre = { start: 1000, end: 2000 };
  const post = { start: 3000, end: 4000 };
  const data = payload({
    pre,
    post,
    // 盘前两个点、一个盘前之后的点(不该被选中)
    points: [
      { ts: 1100, close: 501 },
      { ts: 1500, close: 505 },
      { ts: 1600, close: 999 }
    ]
  });

  const result = parseYahooExtendedSession(INDEX, data, 1700);
  assert.ok(result, '盘前应当返回数据');
  assert.equal(result.session, 'pre');
  assert.equal(result.symbol, 'SPY');
  assert.equal(result.price, 999, '取窗口内最后一个点(1500/1600 都在窗口内,后写的 999 更新)');
  assert.equal(result.previousClose, 500);
  assert.equal(result.change, 499);
  assert.equal(result.changePercent, 99.8);
});

test('盘后窗口内:session=post', () => {
  const pre = { start: 1000, end: 2000 };
  const post = { start: 3000, end: 4000 };
  const data = payload({ pre, post, points: [{ ts: 3500, close: 510 }] });

  const result = parseYahooExtendedSession(INDEX, data, 3600);
  assert.ok(result);
  assert.equal(result.session, 'post');
  assert.equal(result.price, 510);
});

test('不在盘前也不在盘后:返回 null(界面不显示)', () => {
  const pre = { start: 1000, end: 2000 };
  const post = { start: 3000, end: 4000 };
  const data = payload({ pre, post, points: [{ ts: 2500, close: 505 }] });

  assert.equal(parseYahooExtendedSession(INDEX, data, 2500), null, '盘中不该显示盘前/盘后');
  assert.equal(parseYahooExtendedSession(INDEX, data, 5000), null, '收盘后很久也不该显示');
});

test('只有上一时段的残留点:返回 null,不能拿它当本时段价格', () => {
  const pre = { start: 1000, end: 2000 };
  const post = { start: 3000, end: 4000 };
  const data = payload({
    pre,
    post,
    // 点都在盘前窗口之前(比如前一天的盘后残留)
    points: [
      { ts: 500, close: 480 },
      { ts: 900, close: 490 }
    ]
  });

  assert.equal(parseYahooExtendedSession(INDEX, data, 1200), null);
});

test('缺少 previousClose:算不出涨跌就返回 null', () => {
  const pre = { start: 1000, end: 2000 };
  const data = {
    chart: {
      result: [
        {
          meta: { currentTradingPeriod: { pre, regular: {}, post: {} } },
          timestamp: [1100],
          indicators: { quote: [{ close: [501] }] }
        }
      ]
    }
  };
  assert.equal(parseYahooExtendedSession(INDEX, data, 1200), null);
});

test('响应结构不完整时不抛异常,返回 null', () => {
  assert.equal(parseYahooExtendedSession(INDEX, {}, 1200), null);
  assert.equal(parseYahooExtendedSession(INDEX, { chart: { result: [] } }, 1200), null);
  assert.equal(parseYahooExtendedSession(INDEX, null, 1200), null);
});