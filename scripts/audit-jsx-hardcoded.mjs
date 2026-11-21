#!/usr/bin/env node
/**
 * JSX 文本节点里的硬编码中文清单。
 *
 * `check-i18n-keys.mjs` 的 HARDCODED 闸门只覆盖 `-eyebrow/-kicker/-badge` 这类标签元素,
 * HARDCODED-ATTR 只覆盖 aria-label/title/placeholder 三个属性。剩下最大的一块是
 * **夹在 `>` 和 `<` 之间的中文**(`<h4>今日财务雷达</h4>` 这种),它既不在 key 引用里,
 * 也不在任何属性里,只能单独扫。
 *
 * 排除 `{...}` 表达式:那里面通常是 `{tf('key', '中文')}`,中文属于兜底文案,是既有写法。
 *
 * 用法:
 *   node scripts/audit-jsx-hardcoded.mjs           # 汇总 + 每个文件前几条
 *   node scripts/audit-jsx-hardcoded.mjs --all     # 逐条列出
 *   node scripts/audit-jsx-hardcoded.mjs --count   # 只输出总数(CI/趋势用)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

function listTsx(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__snapshots__') continue;
      listTsx(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const TEXT_RE = />([^<>{}]*[\u4e00-\u9fa5][^<>{}]*)</g;
const hits = [];

/** 去掉注释再扫:注释里带 `>` `<` 时会被上面的正则误当成 JSX 文本。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line, prefix) => prefix + ' '.repeat(line.length - prefix.length));
}

for (const file of listTsx(path.join(root, 'src'))) {
  const src = stripComments(readFileSync(file, 'utf8'));
  TEXT_RE.lastIndex = 0;
  let match;
  while ((match = TEXT_RE.exec(src)) !== null) {
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^[\s|·、,，。:：]+$/.test(text)) continue;
    // 代码片段(含运算符/分号/括号)不是文案
    if (/[=;(){}\[\]$]/.test(text)) continue;
    // 装饰性文字(外层 aria-hidden)不该翻译,例如品牌字标「同」。
    // 注意 match.index 指在 `>` 上,所以上下文末尾没有那个 `>`。
    const context = src.slice(Math.max(0, match.index - 400), match.index);
    if (/aria-hidden="true"\s*$/.test(context)) continue;
    hits.push({
      file: path.relative(root, file).replace(/\\/g, '/'),
      line: src.slice(0, match.index).split('\n').length,
      text
    });
  }
}

if (args.has('--count')) {
  console.log(hits.length);
  process.exit(0);
}

// --fail:有存量就以非 0 退出,给 CI 用
if (args.has('--fail') && hits.length > 0) {
  console.log('JSX 文本节点里仍有 ' + hits.length + ' 处硬编码中文:');
  for (const hit of hits) console.log('  ' + hit.file + ':' + hit.line + '  ' + hit.text.slice(0, 60));
  process.exit(1);
}

const byFile = new Map();
for (const hit of hits) {
  if (!byFile.has(hit.file)) byFile.set(hit.file, []);
  byFile.get(hit.file).push(hit);
}
const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

console.log(`JSX 文本节点里的硬编码中文:${hits.length} 处,分布在 ${ranked.length} 个文件\n`);
for (const [file, list] of ranked) {
  console.log(`${String(list.length).padStart(4)}  ${file}`);
  if (args.has('--all')) {
    for (const item of list) console.log(`        L${item.line}  ${item.text.slice(0, 60)}`);
  } else if (list.length <= 8) {
    for (const item of list) console.log(`        L${item.line}  ${item.text.slice(0, 60)}`);
  }
}