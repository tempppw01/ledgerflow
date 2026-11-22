#!/usr/bin/env node
/**
 * 金额格式闸门:JSX 里不准手写 `¥{...toFixed(...)}`。
 *
 * 为什么要有这条:还款管理页出现过同一笔钱两种写法 —— 概览卡用 `formatCurrency`
 * (¥12,860.40),而负债列表与详情面板是手写的 `¥{x.toFixed(2)}`(¥12860.40,没有千分位)。
 * 页面上同时存在两种格式,读起来像两套账。
 *
 * 规则:**JSX 文本里的** `¥{…toFixed…}` 一律算违规,应该用
 * `formatCurrency` / `formatCurrencyFixed2` / `formatMoneyByCurrency`。
 * 模板字符串里的 `¥${…}` 不在此规则内 —— 那多半是给 AI 的提示词文本,
 * 不是界面展示(提示词里用哪种写法无所谓)。
 *
 * 用法:
 *   node scripts/check-money-format.mjs          # 有命中就非 0 退出
 *   node scripts/check-money-format.mjs --list
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

/** file:line → 理由。这里留空:目前全项目已清零。 */
const ALLOW = new Map();

const PATTERN = /¥\s*\{[^}]*toFixed\(/;

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      listFiles(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const hits = [];
for (const file of listFiles(path.join(root, 'src'))) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (!PATTERN.test(line)) return;
    const key = `${relative}:${index + 1}`;
    if (ALLOW.has(key)) return;
    hits.push({ key, code: trimmed.slice(0, 96) });
  });
}

if (hits.length === 0) {
  console.log('金额格式检查通过:JSX 里没有手写的 ¥{…toFixed(…)}');
  process.exit(0);
}

console.log(`发现 ${hits.length} 处手写金额格式:\n`);
for (const hit of hits) console.log(`  ${hit.key}\n      ${hit.code}`);
console.log(
  '\n请改用 src/shared/lib/format.ts 里的 formatCurrency / formatCurrencyFixed2 / formatMoneyByCurrency。'
);
console.log('若这里确实是提示词等非界面文本,请在脚本 ALLOW 里显式列出并写明理由。');

process.exit(args.has('--list') ? 0 : 1);
