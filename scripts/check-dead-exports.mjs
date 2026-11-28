#!/usr/bin/env node
/**
 * 闸门:不许留下「导出了却没人引用」的符号。
 *
 * 起因:上一轮清死代码时发现 8 个文件是纯粹的遗留 —— 7 个仪表盘组件在
 * `feat: remove low-value dashboard insight sections` 里被**主动删掉**、
 * 组件文件却留在原地;`useSyncStore` 更直白,它自己的方法里写着「在线数据库同步已移除」,
 * 却还挂着 39 行没人调用的代码。
 *
 * TypeScript 与 ESLint 都只查**未使用的局部变量**,不查未使用的 export —— 所以这类问题
 * 编译器一句话都不会说。更早的一次提交标题里就写着「并发现 13 个没人渲染的组件」,
 * 但没人清理,于是留到了现在。
 *
 * 判据(两遍,避免误判),**引用只算非测试代码**:
 *   1. 符号名在非测试代码里只出现一次(即它自己的导出声明);
 *   2. **并且**文件名也没被非测试代码 import 引用 —— 动态导入按路径写,不出现符号名。
 * 第一次只查了第 1 条,33 个里 25 个是误报(它们是按文件路径被 import 的)。
 *
 * 为什么把测试文件排除在「引用来源」之外(2026-11-28 补):测试文件也算引用,会放过
 * 一整类死代码 —— **写好了、只有自己的测试在用、产品代码里没有任何入口**。
 * 这类东西的测试永远绿,因为测的就是它自己。补上后立刻抓到两处:
 * `AccountPresetPicker`(组件只有自己的测试渲染)与 `connectionClient`
 * (「测试连接」的请求函数,全仓没有界面调用它)。
 *
 * 作用范围(如实说明):仍然抓不到「文件活得很好、里面个别导出没人用」的情况 ——
 * 那要按导出逐个判定,历史上试过一次,33 个里 25 个是误报。这类靠评审加人工核查:
 * 2026-11-28 这样查出的两处冗余导出(`isCacheValid`、`BUDGET_ACTION_LABEL`)
 * 已删除,记录见 docs/verified-invariants.md。
 *
 * 用法:node scripts/check-dead-exports.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 豁免:确认"没人用"、但**有意保留**的符号,必须写明理由。
 * 目前只有一条 —— 它像是一个写好了却没接上的功能,留着等产品决定。
 */
const ALLOW = new Map([
  [
    'src/shared/hooks/usePwaInstallPrompt.ts',
    '「添加到主屏幕」引导 hook:写完就没接过(唯一引用它的提交就是加它那次)。留着待决定是否启用,删掉会丢意图'
  ],
  [
    'src/features/accounts/ui/AccountPresetPicker.tsx',
    '账户预设选择器:产品代码里没有入口(只有自己的测试渲染它)。待决定「接上还是删掉」,见 docs/verified-invariants.md'
  ],
  [
    'src/shared/api/connectionClient.ts',
    '「测试连接」请求函数:全仓没有界面调用它(只有自己的测试在用)。同上,待决定'
  ]
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = [
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'server')),
  ...walk(path.join(ROOT, 'scripts'))
].map((file) => [path.relative(ROOT, file).split(path.sep).join('/'), readFileSync(file, 'utf8')]);
/**
 * 测试文件不算「引用来源」:只有自己的测试在用,等于产品代码里没有入口。
 * (路径里带 /test/ 的辅助文件同理,它们只在测试里被 import。)
 */
const isTestFile = (rel) => /\.test\.(ts|tsx|js|mjs)$/.test(rel) || rel.split('/').includes('test');
const prodText = sources
  .filter(([rel]) => !isTestFile(rel))
  // **闸门自己的文本不算引用来源**(2026-11-28 补):它的注释与 ALLOW 清单里会写到
  // 被检查的符号名 —— 那样一来「在闸门里提一句」就等于给自己发豁免。实测:注释里写了
  // isCacheValid / BUDGET_ACTION_LABEL 之后,这两个没人调用的导出就再也报不出来了。
  .filter(([rel]) => rel !== 'scripts/check-dead-exports.mjs')
  .map(([, text]) => text)
  .join('\n');

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
const dead = [];

for (const [rel, text] of sources) {
  // 只看实现代码;测试文件里的导出通常是给测试用的
  if (!rel.startsWith('src/')) continue;
  if (/\.test\.(ts|tsx)$/.test(rel)) continue;
  // 类型声明文件声明的是全局类型,没有「被引用」这回事(.d.ts 里的 JSDOM 就属于这种)
  if (rel.endsWith('.d.ts')) continue;
  if (ALLOW.has(rel)) continue;

  const base = path.basename(rel).replace(/\.(ts|tsx)$/, '');
  for (const line of text.split(/\r?\n/)) {
    const match = EXPORT_RE.exec(line.trim());
    if (!match) continue;
    const name = match[1];

    const nameHits = (prodText.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
    const fileHits = (prodText.match(new RegExp('[/\'"]' + base + '[\'"]', 'g')) || []).length;
    if (nameHits <= 1 && fileHits <= 1) dead.push({ file: rel, name });
  }
}

if (dead.length === 0) {
  console.log('死代码检查通过:没有「导出了却没人引用」的符号。');
  process.exit(0);
}

console.log('以下导出在全仓都没有引用(符号名与文件路径都查过):');
for (const item of dead) console.log('  ✗ ' + item.file + ' → ' + item.name);
console.log('\n确实没用了就删掉;有意保留请在脚本的 ALLOW 里写明理由。');
process.exit(1);
