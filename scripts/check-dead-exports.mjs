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
 * 判据(两遍,避免误判):
 *   1. 符号名在全仓只出现一次(即它自己的导出声明);
 *   2. **并且**文件名也没被任何 import 引用 —— 动态导入按路径写,不出现符号名。
 * 第一次只查了第 1 条,33 个里 25 个是误报(它们是按文件路径被 import 的)。
 *
 * 作用范围(如实说明):它抓的是**整个文件都没人引用**的情况。
 * 一个「活得很好」的文件里如果有个别导出没人用,这条闸门看不出来 —— 那是为避开大量误报做的取舍
 * (第一次只按符号名查,33 个里 25 个是误报:那些符号是按文件路径被 import 的)。
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
const allText = sources.map(([, text]) => text).join('\n');

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
const dead = [];

for (const [rel, text] of sources) {
  // 只看实现代码;测试文件里的导出通常是给测试用的
  if (!rel.startsWith('src/')) continue;
  if (/\.test\.(ts|tsx)$/.test(rel)) continue;
  if (ALLOW.has(rel)) continue;

  const base = path.basename(rel).replace(/\.(ts|tsx)$/, '');
  for (const line of text.split(/\r?\n/)) {
    const match = EXPORT_RE.exec(line.trim());
    if (!match) continue;
    const name = match[1];

    const nameHits = (allText.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
    const fileHits = (allText.match(new RegExp('[/\'"]' + base + '[\'"]', 'g')) || []).length;
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