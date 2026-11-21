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

/**
 * 会被当成「取文案」的函数名。
 *
 * 漏掉一个别名不会报 MISSING,而是把用到的 key 全部误报成 UNUSED ——
 * 于是「死 key 清理」会照着错的清单删掉还在用的 key。
 * `tFallback`(AppLayout / DashboardPage 里的本地包装)就漏过一次:
 * 79 处调用点、319 个 UNUSED 里绝大多数是这么来的。
 * 新增包装函数时把它加进来,下面的 UNKNOWN_CALLEE 会提示漏掉的。
 */
const TRANSLATE_ALIASES = ['i18n.t', 'tFallback', 'tf', 't2', 't'];
const ALIAS_PATTERN = TRANSLATE_ALIASES.map((name) =>
  name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
).join('|');

const CALL_RE = new RegExp(
  `(?:^|[^\\w$.])(?:${ALIAS_PATTERN})\\(\\s*(['"])([^'"\\\\]+)\\1`,
  'g'
);
const CONST_KEY_RE =
  /\b(?:key|i18nKey|translationKey|titleKey|labelKey|messageKey)\s*:\s*(['"])([^'"\\]+)\1/g;
/**
 * key 先存进 state、渲染时再 t(stateKey) 的写法:
 * `setErrorKey('finance.ui.loadFailed')` -> 这个 key 在别处被 t() 取用,
 * 但静态扫描看不到「变量当参数」的那一次,不补这条就会误报成 UNUSED。
 */
const KEY_SETTER_RE = /\b[A-Za-z_$][\w$]*Key\(\s*(['"])([^'"\\]+)\1/g;
const DYNAMIC_RE = new RegExp(`(?:^|[^\\w$.])(?:${ALIAS_PATTERN})\\(\\s*\``, 'g');

/**
 * 「名字没在别名表里,但第一个参数是一个点号 key」的调用。
 * 这类调用要么是漏登记的新包装函数(会让 key 被误报成死 key),
 * 要么只是恰好长得像 key 的普通参数,人工过一眼就能分。
 */
const UNKNOWN_CALLEE_RE = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\(\s*(['"])([^'"\\]+)\2/g;

/**
 * 拼 key 的模板前缀,不必出现在 t() 里面:
 * `function getCurrencyNameKey(code) { return \`exchange.currency.${code}\`; }`
 * 之后 `tf(getCurrencyNameKey(base), ...)` —— key 是变量,静态扫描看不到。
 * 这类 helper 很常见,所以直接在整份源码里收集「像 key 前缀的模板字面量」,
 * 前缀确实命中资源树时才登记,避免把无关字符串当成前缀。
 */
const KEY_TEMPLATE_RE = /`([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+\.)\$\{/g;
/** 同样的拼接,写成字符串相加: `const key = 'a.b.' + name;` */
const KEY_CONCAT_RE = /(['"])([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+\.)\1\s*\+/g;
/**
 * 动态 key 的静态前缀: `t(\`help.${section}.title\`)` -> `help.`,
 * `t('dashboard.greeting.' + slot)` -> `dashboard.greeting.`
 * 这些前缀下的所有资源 key 都算「已被引用」,否则 UNUSED 会把整棵子树误报成死 key。
 */
const DYNAMIC_PREFIX_RE = new RegExp(
  `(?:^|[^\\w$.])(?:${ALIAS_PATTERN})\\(\\s*(?:\`([^\`$]*)|\\s*(['"])([^'"\\\\]+)\\2\\s*\\+)`,
  'g'
);

const files = listSourceFiles(srcDir);
const used = new Map();
const dynamic = [];
const dynamicPrefixes = new Set();
const unknownCallees = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');

  for (const re of [CALL_RE, CONST_KEY_RE, KEY_SETTER_RE]) {
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

  UNKNOWN_CALLEE_RE.lastIndex = 0;
  let unknown;
  while ((unknown = UNKNOWN_CALLEE_RE.exec(source)) !== null) {
    const callee = unknown[1];
    const key = unknown[3];
    if (TRANSLATE_ALIASES.includes(callee)) continue;
    // 名字以 Key 结尾的 setter 已由 KEY_SETTER_RE 收录,不必再单独提示。
    if (callee.endsWith('Key')) continue;
    if (!STATIC_KEY.test(key)) continue;
    const line = source.slice(0, unknown.index).split('\n').length;
    unknownCallees.push(`${rel}:${line}  ${callee}('${key}')`);
  }

  KEY_TEMPLATE_RE.lastIndex = 0;
  let tpl;
  while ((tpl = KEY_TEMPLATE_RE.exec(source)) !== null) {
    const prefix = tpl[1];
    if (STATIC_KEY.test(`${prefix}x`)) dynamicPrefixes.add(prefix);
  }

  KEY_CONCAT_RE.lastIndex = 0;
  let concat;
  while ((concat = KEY_CONCAT_RE.exec(source)) !== null) {
    const prefix = concat[2];
    if (STATIC_KEY.test(`${prefix}x`)) dynamicPrefixes.add(prefix);
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

/**
 * `aria-label` / `title` / `placeholder` 里写死的中文。
 *
 * 这三个属性永远是界面文案、不可能是用户数据:写死之后英文界面里就是中文,
 * 读屏器还会用中文念出来。历史上一共 55 处(43 种文案),集中在 AI 助手与投资页。
 * 单独的 `placeholder="—"` 这类纯符号不算(正则要求含汉字)。
 *
 * 注意:像 `querySelector('[aria-label="实际还款金额"]')` 这种「按文案找元素」的写法
 * 也会被这条规则命中 —— 那本身就是脆弱写法(文案翻译后选择器就失效),应改成 id。
 */
const HARDCODED_ATTR_RE = /\b(aria-label|title|placeholder)="([^"]*[\u4e00-\u9fa5][^"]*)"/g;
const hardcodedAttrs = [];
for (const file of files) {
  if (!file.endsWith('.tsx')) continue;
  // 测试文件里的字面量是用来做断言的,不是界面文案。
  if (/.test.tsx$/.test(file)) continue;
  const src = readFileSync(file, 'utf8');
  HARDCODED_ATTR_RE.lastIndex = 0;
  let a;
  while ((a = HARDCODED_ATTR_RE.exec(src)) !== null) {
    // 模板字符串里已经包了 tf(...) 的不算写死(如打印 HTML 片段)。
    if (a[2].includes('${tf(') || a[2].includes('${t(')) continue;
    const line = src.slice(0, a.index).split('\n').length;
    hardcodedAttrs.push(`${path.relative(root, file)}:${line}  ${a[1]}="${a[2]}"`);
  }
}

const result = {
  scannedFiles: files.length,
  usedKeys: used.size,
  missing,
  dynamicCallSites: dynamic,
  dynamicPrefixes: [...dynamicPrefixes].sort(),
  unknownCallees,
  zhKeys: zh.size,
  enKeys: en.size,
  onlyZh,
  onlyEn,
  unused,
  hardcodedAttrs
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

  if (unknownCallees.length) {
    section(
      'UNKNOWN-CALLEE — 函数名不在别名表里、但第一个参数像 i18n key(漏登记会让 key 被误报成 UNUSED)',
      unknownCallees
    );
  }

  if (hardcodedLabels.length) {
    section('HARDCODED — 标签类元素里写死的文案(无法翻译)', hardcodedLabels);
  }

  if (hardcodedAttrs.length) {
    section('HARDCODED-ATTR — aria-label/title/placeholder 里写死的中文', hardcodedAttrs);
  }
}

process.exit(
  missing.length || onlyZh.length || onlyEn.length || hardcodedLabels.length || hardcodedAttrs.length
    ? 1
    : 0
);
