#!/usr/bin/env node
/**
 * 文档引用体检:docs/verified-invariants.md 里提到的测试文件必须真实存在,表格结构要完整。
 *
 * 为什么需要:那份清单的价值全在「照着它能找到守门的那条测试」。一旦某个测试被改名或删掉,
 * 文档就变成**指向空处的承诺** —— 比没有文档更糟,因为它让人以为有东西守着。
 *
 * 检查两件事:
 *   1. 反引号里出现的 `*.test.ts(x)` / `*.test.js` 都能在仓库里找到(支持 `store/xxx.test.ts` 这种末段简写);
 *   2. 每张表格里各行列数与表头一致(多一列少一列会让渲染错位)。
 *
 * 用法:node scripts/check-doc-invariants.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = path.join(ROOT, 'docs/verified-invariants.md');

if (!existsSync(DOC)) {
  console.error('找不到 docs/verified-invariants.md');
  process.exit(1);
}

const doc = readFileSync(DOC, 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.test\.(ts|tsx|js)$/.test(entry)) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/').toLowerCase());
    }
  }
  return out;
}

const allTests = walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'server')));
const referenced = [
  ...new Set([...doc.matchAll(/`([a-zA-Z0-9_/.-]*\.test\.(?:ts|tsx|js))`/g)].map((match) => match[1]))
];

const missing = referenced.filter((ref) => {
  const needle = ref.toLowerCase();
  return !allTests.some((candidate) => candidate === needle || candidate.endsWith('/' + needle));
});

const lines = doc.split(/\r?\n/);
const columnIssues = [];
let headerCols = null;
let tableStart = 0;
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (!line.trimStart().startsWith('|')) {
    headerCols = null;
    continue;
  }
  const cols = line.split('|').length - 2;
  if (headerCols === null) {
    headerCols = cols;
    tableStart = index + 1;
    continue;
  }
  if (cols !== headerCols) {
    columnIssues.push(`第 ${index + 1} 行(表格起于第 ${tableStart} 行):期望 ${headerCols} 列,实际 ${cols} 列`);
  }
}

console.log(
  '文档引用的测试文件 ' + referenced.length + ' 个,仓库里共 ' + allTests.length + ' 个测试文件'
);

if (missing.length === 0 && columnIssues.length === 0) {
  console.log('文档引用体检通过:引用的测试文件全部存在,表格列数一致。');
  process.exit(0);
}

if (missing.length > 0) {
  console.log('\n以下引用找不到对应文件(测试改名/删除后忘了同步文档):');
  for (const ref of missing) console.log('  ✗ ' + ref);
}
if (columnIssues.length > 0) {
  console.log('\n表格列数不一致(渲染会错位):');
  for (const issue of columnIssues) console.log('  ✗ ' + issue);
}
process.exit(1);