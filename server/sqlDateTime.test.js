import assert from 'node:assert/strict';
import test from 'node:test';
import { toMysqlDate } from './sqlDateTime.js';

/**
 * 这个模块是为了修一个真 bug 才存在的:
 * `relationalDatabase.js` 在 MySQL 迁移路径上用了 `toMysqlDate`,但既没定义也没 import ——
 * 走到那行就 ReferenceError,被 catch 抓住后回滚,迁移失败。
 *
 * 它之所以长期没被发现,是因为 `server/` 下的 .js 没有任何静态检查(eslint 只匹配 TS/TSX,
 * tsconfig 只 include src)。给 server 套上 JS 规则后,no-undef 立刻指了出来。
 *
 * 这里直接测函数本身:格式、UTC、以及无效输入的下场。
 */

test('输出 MySQL DATETIME 的形状:YYYY-MM-DD HH:MM:SS(.mmm)', () => {
  const result = toMysqlDate('2026-11-25T04:00:00.000Z');
  assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  assert.equal(result, '2026-11-25 04:00:00.000');
  // 不该带 T 或 Z —— MySQL 收不下
  assert.ok(!result.includes('T'));
  assert.ok(!result.includes('Z'));
});

test('按 UTC 换算(与 Date.toISOString 一致)', () => {
  const value = new Date('2026-11-25T04:00:00.000Z');
  assert.equal(toMysqlDate(value), '2026-11-25 04:00:00.000');
});

test('无效输入回落到「现在」,而不是抛错或给出 Invalid Date', () => {
  const before = Date.now();
  const result = toMysqlDate('不是日期');
  const after = Date.now();

  assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  assert.ok(!result.includes('NaN'));
  assert.ok(!result.includes('Invalid'));

  // 落点应当落在这次调用的前后之间(把字符串按 UTC 解析回来比)
  const parsed = Date.parse(result.replace(' ', 'T') + 'Z');
  assert.ok(parsed >= before - 1000 && parsed <= after + 1000, `落点应接近现在,实际 ${result}`);
});

test('空值也走「现在」', () => {
  const result = toMysqlDate();
  assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
});
