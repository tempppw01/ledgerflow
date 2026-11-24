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
const fragmentIssues = [];
let headerCols = null;
let tableStart = 0;
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const isRow = line.trimStart().startsWith('|');
  if (!isRow) {
    headerCols = null;
    continue;
  }
  /*
   * 表格残块:一行表格行如果是「一块表格的第一行」,它**下面必须紧跟分隔行**(`| --- |`)。
   * 缺分隔行说明这是一段没有表头的残表,Markdown 会把它渲染成纯文本。
   *
   * 这个检查针对我自己犯过的错:把一段说明插进表格中间,后半段表格就悄悄失效了。
   * 旧版只比列数,完全看不出来 —— 而且正文两侧即使留了空行也照样会切断表格,
   * 所以判据要看「有没有表头 + 分隔行」,而不是看上一行是不是正文。
   */
  const previous = (lines[index - 1] || '').trim();
  const startsTableBlock = !previous || !previous.startsWith('|');
  if (startsTableBlock) {
    const separator = (lines[index + 1] || '').trim();
    const hasSeparator = /^\|[\s:|-]+\|$/.test(separator) && separator.includes('-');
    if (!hasSeparator) {
      fragmentIssues.push(
        `第 ${index + 1} 行:表格残块(这一行是一块表格的开头,但下一行不是 | --- | 分隔行,后半段会被渲染成纯文本)`
      );
    }
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

/**
 * 代码块必须成对:未闭合的 ``` 会把后面整段文档吞成代码块(渲染出来面目全非),
 * 而只看表格列数的检查完全看不到这件事。
 */
const FENCE_FILES = ["docs/verified-invariants.md", "docs/HANDOVER.md"];
const fenceIssues = [];
for (const rel of FENCE_FILES) {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) continue;
  const count = readFileSync(full, "utf8").split("```").length - 1;
  if (count % 2 !== 0) {
    fenceIssues.push(rel + ": ``` 出现 " + count + " 次(奇数,有未闭合的代码块)");
  }
}

if (missing.length === 0 && columnIssues.length === 0 && fragmentIssues.length === 0 && fenceIssues.length === 0) {
  console.log('文档引用体检通过:引用的测试文件全部存在,表格列数一致,没有被打断的表格,代码块成对。');
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
if (fenceIssues.length > 0) {
  console.log("\n代码块未闭合(后半段会被渲染成代码):");
  for (const issue of fenceIssues) console.log("  ✗ " + issue);
}
if (fragmentIssues.length > 0) {
  console.log('\n表格被正文从中间切断(后半段会渲染成纯文本):');
  for (const issue of fragmentIssues) console.log('  ✗ ' + issue);
  console.log('\n请把说明挪到整张表之后,表格中间不要夹正文。');
}
process.exit(1);