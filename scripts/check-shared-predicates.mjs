#!/usr/bin/env node
/**
 * 「共享谓词」闸门:禁止在别处重新手写退款/冲正判断。
 *
 * 为什么需要它:`adjustmentKind === 'refund' || adjustmentKind === 'reversal'` 这句话
 * 曾经在仓库里被手写了 24 遍。手写不会立刻出错,但会慢慢走形 —— 已经出过一次真事故:
 * 财务分析的「资金动态看板」按月汇总时只对 `type === 'expense'` 求和、忘了排除退款,
 * 于是同一页上页头(走 summarizeTransactions)是净额、卡片是「净额 + 2×退款」,
 * 演示账本 11 月因此多算 ¥781.10。
 *
 * 现在这些点都改成调用 `isTransactionRefundLike`,这道闸门负责让它别再长回来
 * —— 与 check:dates / check:money 同一套路。
 *
 * 刻意不检查的地方(都有理由,不是漏网):
 *   · 谓词自身的实现文件 —— 那是唯一真源;
 *   · 测试文件 —— 测试必须自己把条件写一遍才有意义:如果断言也用实现里的谓词,
 *     谓词写错了测试会跟着一起错,等于没测;
 *   · 本脚本 —— 上面这几行说明里就写着那个模式。
 *
 * 从 adjustmentKind 里**取标签**(`refund ? '退款' : '冲正'`)不是谓词判断,
 * 它本来就只出现在「已知是退款类」的分支里,不会与谓词走形,因此不拦。
 *
 * 用法:
 *   node scripts/check-shared-predicates.mjs          # 有命中就非 0 退出
 *   node scripts/check-shared-predicates.mjs --list   # 只列出来,不失败
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-shared-predicates.mjs';
const args = new Set(process.argv.slice(2));

const PATTERNS = [
  {
    re: /adjustmentKind\s*===\s*'refund'[\s\S]{0,80}adjustmentKind\s*===\s*'reversal'/,
    why: '手写「退款/冲正」谓词 —— 请改用 isTransactionRefundLike(tx)'
  },
  {
    re: /adjustmentKind\s*===\s*'reversal'[\s\S]{0,80}adjustmentKind\s*===\s*'refund'/,
    why: '手写「退款/冲正」谓词(顺序相反)—— 请改用 isTransactionRefundLike(tx)'
  }
];

/** 整份文件豁免,理由必须写清。 */
const SKIP_FILES = new Map([
  ['src/shared/lib/transactionMetrics.ts', 'isTransactionRefundLike 自身的实现,唯一真源'],
  [SELF, '本脚本的说明文字里就含这个模式']
]);

/** file:line 级豁免(确实不是同一个判断)。 */
const ALLOW = new Map([
  [
    'src/shared/store/useFinanceStore.ts:330',
    'normalizeAdjustmentKind:判断的是「是否已是三种已知 kind 之一」(含 normal),不是退款判断'
  ]
]);

function isSkipped(rel) {
  if (SKIP_FILES.has(rel)) return true;
  return /\.test\.(ts|tsx)$/.test(rel);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const hits = [];
for (const file of walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'scripts')))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (isSkipped(rel)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  // 把相邻两行拼起来看,这样 `a === 'x' ||\n a === 'y'` 这种换行写法也能命中。
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let matched = false;
    const joined = lines.slice(index, index + 2).join(' ');
    for (const { re, why } of PATTERNS) {
      if (!re.test(joined)) continue;
      const key = rel + ':' + (index + 1);
      if (ALLOW.has(key)) continue;
      hits.push({ key, why });
      matched = true;
      break;
    }
    // 命中后跳过下一行:同一个写法会被相邻两次窗口各命中一次。
    if (matched) index += 1;
  }
}

if (hits.length === 0) {
  console.log('共享谓词检查通过:没有手写的「退款/冲正」判断(统一走 isTransactionRefundLike)。');
  process.exit(0);
}

console.log('发现 ' + hits.length + ' 处手写的「退款/冲正」判断:');
for (const hit of hits) console.log('  ' + hit.key + '\n    ' + hit.why);
if (args.has('--list')) process.exit(0);
process.exit(1);
