#!/usr/bin/env node
/**
 * 死 key 排查:在 check-i18n-keys.mjs 的 UNUSED 基础上,再对每条候选做取证,
 * 分成「可以安全删除」和「需要人工确认」两堆。
 *
 * 背景:`t('key')` 取不到文案时会直接把 key 渲染到界面上,而 `tf(key, fallback)`
 * 会退回 fallback —— 所以删错一条 key 不会崩,但会在界面上留下一个原始 key。
 * 这份脚本的每个「安全」判定都要过五道门,任何一道不过就退回人工确认:
 *
 *   1. key 字面量出现在代码里(含测试)
 *   2. key 末段可能被 `xxx.${...}` / `'xxx.' + ...` 拼出来
 *   3. 中文值出现在生产代码里(说明文案被硬编码,key 是重复品而非死 key)
 *   4. 多词英文值出现在生产代码里
 *   5. 父级路径出现在代码里(可能有 helper 在拼这棵子树下的 key)
 *
 * 注意:`tf(key, '中文')` 的 fallback 本身就是中文,所以 3 经常命中 ——
 * 那是本仓库的既有写法,不代表漏译。真正要小心的是 1/2/5。
 *
 * 用法:
 *   node scripts/check-i18n-keys.mjs --json --unused > .i18n-report.json
 *   node scripts/audit-unused-i18n.mjs [报告路径]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.resolve(root, process.argv[2] || '.i18n-report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const zh = JSON.parse(readFileSync(path.join(root, 'src/i18n/locales/zh/translation.json'), 'utf8'));
const en = JSON.parse(readFileSync(path.join(root, 'src/i18n/locales/en/translation.json'), 'utf8'));

const pick = (tree, key) =>
  key
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree);

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__snapshots__') continue;
      listFiles(full, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const sources = listFiles(path.join(root, 'src'))
  .filter((file) => !file.replace(/\\/g, '/').includes('/i18n/locales/'))
  .map((file) => ({
    file: path.relative(root, file).replace(/\\/g, '/'),
    text: readFileSync(file, 'utf8')
  }));

const HAS_CJK = /[\u4e00-\u9fff]/;
const safe = [];
const hold = [];

for (const key of report.unused) {
  const zhValue = pick(zh, key);
  const enValue = pick(en, key);
  const segments = key.split('.');
  const reasons = [];

  if (sources.some(({ text }) => text.includes(`'${key}'`) || text.includes(`"${key}"`))) {
    reasons.push('key 字面量出现在代码里');
  }

  const last = segments.at(-1);
  if (
    last &&
    last.length >= 4 &&
    sources.some(
      ({ text }) =>
        text.includes(`.${last}\``) || text.includes(`.${last}'`) || text.includes(`.${last}"`)
    )
  ) {
    reasons.push(`末段 ${last} 可能被拼接`);
  }

  if (typeof zhValue === 'string' && HAS_CJK.test(zhValue)) {
    const value = zhValue.replace(/\{\{\s*\w+\s*\}\}/g, '').trim();
    if (value.length >= 4) {
      const hit = sources.find(({ file, text }) => !/\.test\./.test(file) && text.includes(value));
      if (hit) reasons.push(`中文值出现在 ${hit.file}`);
    }
  }

  if (typeof enValue === 'string' && / /.test(enValue) && enValue.length >= 12) {
    const hit = sources.find(
      ({ file, text }) =>
        !/\.test\./.test(file) &&
        (text.includes(`'${enValue}'`) || text.includes(`"${enValue}"`))
    );
    if (hit) reasons.push(`英文值出现在 ${hit.file}`);
  }

  const parentPath = segments.slice(0, -1).join('.');
  if (parentPath && sources.some(({ text }) => text.includes(parentPath))) {
    reasons.push(`父路径 ${parentPath} 出现在代码里`);
  }

  if (reasons.length) hold.push({ key, reasons });
  else safe.push(key);
}

console.log(`候选(UNUSED)${report.unused.length} 条`);
console.log(`\n=== 可以安全删除(${safe.length}) ===`);
for (const key of safe) console.log(`  ${key}`);

console.log(`\n=== 需要人工确认(${hold.length}) ===`);
const tally = new Map();
for (const item of hold) {
  for (const reason of item.reasons) {
    const head = reason.split(' ')[0];
    tally.set(head, (tally.get(head) || 0) + 1);
  }
}
for (const [reason, count] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason}  ${count}`);
}
