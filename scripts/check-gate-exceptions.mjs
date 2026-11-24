#!/usr/bin/env node
/**
 * 例外清单的"到期检查":各闸门 ALLOW / JUSTIFIED 里写的条目,还成立吗?
 *
 * 为什么需要:闸门只检查"命中是否在清单里",**从不检查清单里的条目是否还成立**。
 * 于是代码改过之后,一条失效的例外会静静躺着 —— 今天无害,但将来同一位置出现真违规时,
 * 它会把人放过去。这个会话里已经有三道闸门被证明"洞是真会有的"
 * (注释能压制共享谓词检查、解构写法逃过日期检查、动态键删掉无人发现),所以例外清单
 * 也该有人看着。
 *
 * 支持两种形式:
 *   · `path/to/file.ts:123`       -> 文件必须存在
 *   · `path/to/file.ts|ctx1|ctx2` -> 文件必须存在,且每段 ctx 仍出现在文件里
 *
 * 局限(刻意保持简单):
 *   · 只认条目以 `src/` 开头(当前所有例外都是);
 *   · 只从单/双引号里抓,**注释里写的不算** —— 所以新增格式时要同步改这里;
 *   · 不做行号漂移检查(file:line 只验文件存在)—— 行号会随代码移动,强求会天天误报。
 *
 * 用法:node scripts/check-gate-exceptions.mjs
 *      有失效条目就非 0 退出。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 带例外清单的闸门。 */
const GATES = [
  'scripts/check-date-usage.mjs',
  'scripts/check-shared-predicates.mjs',
  'scripts/audit-handrolled-sums.mjs',
  'scripts/check-i18n-keys.mjs'
];

const entries = [];
for (const gate of GATES) {
  const full = path.join(ROOT, gate);
  if (!existsSync(full)) continue;
  const source = readFileSync(full, 'utf8');
  for (const match of source.matchAll(/['"](src\/[^'"]+)['"]/g)) {
    const raw = match[1];
    if (!/:\d+$/.test(raw) && !raw.includes('|')) continue;
    entries.push({ gate, raw });
  }
}

if (entries.length === 0) {
  console.log('例外清单检查:没有找到可核对的条目');
  process.exit(0);
}

const problems = [];
for (const { gate, raw } of entries) {
  const [file, ...rest] = raw.split('|');
  const fileOnly = file.split(':')[0];
  const full = path.join(ROOT, fileOnly);

  if (!existsSync(full)) {
    problems.push(`${raw}  —— 文件已不存在(来自 ${gate})`);
    continue;
  }

  const text = readFileSync(full, 'utf8');
  for (const context of rest.filter((part) => part.trim().length > 0)) {
    if (!text.includes(context)) {
      problems.push(`${raw}  —— 文件里已经找不到这段上下文(来自 ${gate})`);
    }
  }
}

if (problems.length > 0) {
  console.log('以下例外条目已经失效 —— 它们会把将来同一位置的真违规放过去:\n');
  for (const problem of problems) console.log('  ✗ ' + problem);
  console.log('\n要么删掉这条例外,要么确认现状后重写它的依据。');
  process.exit(1);
}

console.log(
  `例外清单检查通过:${entries.length} 条条目,引用的文件都在,上下文都还在。`
);