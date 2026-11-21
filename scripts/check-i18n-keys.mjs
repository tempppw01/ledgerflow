#!/usr/bin/env node
/**
 * 全量 i18n key 校验。
 *
 * 背景:之前的 scripts/check-i18n-keys.py 只覆盖 16 个手写文件,且正则里把
 * `\b` / `\(` 写成了 `\\b` / `\\(`(在 Python 原始字符串里等于「反斜杠 + b」),
 * 因此永远匹配不到任何 key,一直「0 缺失」地报成功。结果是像
 * `dashboard.ui.simulation.horizonMonths` 这种 key 缺失后直接以原始 key 的形式
 * 渲染到界面上,没有任何环节会拦下来。
 *
 * 本脚本扫描 src 下全部 ts/tsx,提取 t()/t2()/i18n.t() 静态 key,与 zh / en 两份
 * 资源做双向比对:
 *   MISSING  —— 代码用到但资源里没有(会在界面上露出原始 key)
 *   UNUSED   —— 资源里有但代码里搜不到(死 key,可清理)
 *
 * 动态拼出来的 key(模板字符串、变量)无法静态解析,单独列出来,避免误判成 UNUSED。
 *
 * 用法:
 *   node scripts/check-i18n-keys.mjs            # 只报 MISSING,有问题退出码 1
 *   node scripts/check-i18n-keys.mjs --unused   # 附带 UNUSED 报告
 *   node scripts/check-i18n-keys.mjs --json     # 机器可读输出
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const localesDir = path.join(srcDir, 'i18n', 'locales');

const args = new Set(process.argv.slice(2));
const showUnused = args.has('--unused');
const asJson = args.has('--json');

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__snapshots__') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function loadLocale(lang) {
  return JSON.parse(readFileSync(path.join(localesDir, lang, 'translation.json'), 'utf8'));
}

function flatten(tree, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : prefix + key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, full, out);
    } else {
      out.set(full, value);
    }
  }
  return out;
}

/**
 * 只接受「点号分层」的 key:至少两段,每段都由字母/数字/下划线组成。
 * 这样 `t('zh')`、`t('weekday.short')` 之类都能覆盖,又不会把 CSS 类名当 key。
 */
const STATIC_KEY = /^(?![0-9])[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

const CALL_RE = /(?:^|[^\w$.])(?:t|tf|t2|i18n\.t)\(\s*(['"])([^'"\\]+)\1/g;
const CONST_KEY_RE =
  /\b(?:key|i18nKey|translationKey|titleKey|labelKey|messageKey)\s*:\s*(['"])([^'"\\]+)\1/g;
const DYNAMIC_RE = /(?:^|[^\w$.])(?:t|tf|t2|i18n\.t)\(\s*`/g;
/**
 * 动态 key 的静态前缀: `t(\`help.${section}.title\`)` -> `help.`,
 * `t('dashboard.greeting.' + slot)` -> `dashboard.greeting.`
 * 这些前缀下的所有资源 key 都算「已被引用」,否则 UNUSED 会把整棵子树误报成死 key。
 */
const DYNAMIC_PREFIX_RE =
  /(?:^|[^\w$.])(?:t|tf|t2|i18n\.t)\(\s*(?:`([^`$]*)|\s*(['"])([^'"\\]+)\2\s*\+)/g;

const files = listSourceFiles(srcDir);
const used = new Map();
const dynamic = [];
const dynamicPrefixes = new Set();

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');

  for (const re of [CALL_RE, CONST_KEY_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      const key = match[2];
      if (!STATIC_KEY.test(key)) continue;
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(rel);
    }
  }

  DYNAMIC_RE.lastIndex = 0;
  let dyn;
  while ((dyn = DYNAMIC_RE.exec(source)) !== null) {
    const line = source.slice(0, dyn.index).split('\n').length;
    dynamic.push(`${rel}:${line}`);
  }

  DYNAMIC_PREFIX_RE.lastIndex = 0;
  let pre;
  while ((pre = DYNAMIC_PREFIX_RE.exec(source)) !== null) {
    const raw = pre[1] !== undefined ? pre[1] : pre[3];
    const prefix = String(raw || '').trim();
    if (prefix.includes('.') && STATIC_KEY.test(`${prefix}x`)) dynamicPrefixes.add(prefix);
  }
}

function isCoveredByDynamicPrefix(key) {
  for (const prefix of dynamicPrefixes) {
    if (key === prefix.replace(/\.$/, '') || key.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * 这里刻意不做 i18next 的 `key_one` / `key_other` 复数后缀兜底:
 * translationParity.test.ts 要求 zh / en 的 key 集合完全一致,所以本仓库的
 * 单复数一律写成显式的成对 key(如 dashboard.ui.cashflow.onePlan / manyPlans),
 * 永远不会出现只在一种语言里存在的 `_one` 变体。
 */
function hasKey(tree, key) {
  return tree.has(key);
}

const zh = flatten(loadLocale('zh'));
const en = flatten(loadLocale('en'));

const missing = [];
for (const [key, where] of [...used.entries()].sort()) {
  const miss = [];
  if (!hasKey(zh, key)) miss.push('zh');
  if (!hasKey(en, key)) miss.push('en');
  if (miss.length) missing.push({ key, langs: miss, files: [...where].sort() });
}

const onlyZh = [...zh.keys()].filter((key) => !hasKey(en, key)).sort();
const onlyEn = [...en.keys()].filter((key) => !hasKey(zh, key)).sort();

// 标签类元素(-eyebrow / -kicker / -badge)里直接写死的文案。
// 这些元素永远是界面文案、不会是用户数据,所以出现字面量就是「绕过 i18n」,
// 无法翻译。历史上这里漏过 9 处(BOOKKEEPING SETUP / Agent 等),此规则用于锁住。
const HARDCODED_LABEL_RE =
  /className="[^"]*-(?:eyebrow|kicker|badge)(?:[\s"][^"]*)?"\s*>\s*([^<>{]+?)\s*</g;
const hardcodedLabels = [];
for (const file of files) {
  if (!file.endsWith('.tsx')) continue;
  const src = readFileSync(file, 'utf8');
  HARDCODED_LABEL_RE.lastIndex = 0;
  let m;
  while ((m = HARDCODED_LABEL_RE.exec(src)) !== null) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!/[A-Za-z\u4e00-\u9fa5]/.test(text)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    hardcodedLabels.push(`${path.relative(root, file)}:${line}  "${text}"`);
  }
}
const unused = [...zh.keys()]
  .filter((key) => !used.has(key) && !isCoveredByDynamicPrefix(key))
  .sort();

const result = {
  scannedFiles: files.length,
  usedKeys: used.size,
  missing,
  dynamicCallSites: dynamic,
  dynamicPrefixes: [...dynamicPrefixes].sort(),
  zhKeys: zh.size,
  enKeys: en.size,
  onlyZh,
  onlyEn,
  unused
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    `scanned ${result.scannedFiles} files · used ${result.usedKeys} keys · zh ${result.zhKeys} / en ${result.enKeys}`
  );

  const section = (title, lines) => {
    console.log(`\n${title} (${lines.length})`);
    for (const line of lines) console.log(`  ${line}`);
  };

  section(
    'MISSING — 代码引用但资源缺失(界面会露出原始 key)',
    missing.map(({ key, langs, files: f }) => `${key}  [${langs.join(',')}]  <- ${f.join(', ')}`)
  );
  section('ONLY-ZH — 只在 zh 里有', onlyZh);
  section('ONLY-EN — 只在 en 里有', onlyEn);

  if (showUnused) {
    section('UNUSED — 资源里有但代码搜不到', unused);
  }

  if (dynamic.length) {
    section('DYNAMIC — 模板字符串拼 key,需人工确认', dynamic);
  }

  if (hardcodedLabels.length) {
    section('HARDCODED — 标签类元素里写死的文案(无法翻译)', hardcodedLabels);
  }
}

process.exit(
  missing.length || onlyZh.length || onlyEn.length || hardcodedLabels.length ? 1 : 0
);
