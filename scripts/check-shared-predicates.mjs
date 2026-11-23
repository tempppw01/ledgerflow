#!/usr/bin/env node
/**
 * 「共享谓词」闸门:禁止在别处重新手写已经被共享出来的判断。
 *
 * 为什么需要它:这些判断曾经在仓库里被手写了很多遍 —— 手写不会立刻出错,但会慢慢走形。
 * 已经出过一次真事故:财务分析的「资金动态看板」按月汇总时只对 `type === 'expense'` 求和、
 * 忘了排除退款,于是同一页上页头(走 summarizeTransactions)是净额、卡片是
 * 「净额 + 2×退款」,演示账本 11 月因此多算 ¥781.10。
 *
 * 目前守两条(都对应 src/shared 里的唯一真源):
 *   1. 退款/冲正判断  → isTransactionRefundLike       (src/shared/lib/transactionMetrics.ts)
 *   2. 是否计入余额的状态 → isBalanceAffectingStatus  (src/shared/lib/localDate.ts)
 *
 * 刻意不检查的地方(都有理由,不是漏网):
 *   · 谓词自身的实现文件 —— 那是唯一真源;
 *   · 测试文件 —— 测试必须自己把条件写一遍才有意义:如果断言也用实现里的谓词,
 *     谓词写错了测试会跟着一起错,等于没测;
 *   · 本脚本 —— 上面这些说明里就写着那些模式。
 *
 * 另外不拦「从 adjustmentKind 里取标签」(`refund ? '退款' : '冲正'`):它只出现在
 * 「已知是退款类」的分支里,不会与谓词走形。债务生命周期的 settled/closed/paused
 * 是另一套状态,也不属于这条。
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

const REFUND_WHY = '手写「退款/冲正」谓词 —— 请改用 isTransactionRefundLike(tx)';
const STATUS_WHY = '手写「是否计入余额的状态」—— 请改用 isBalanceAffectingStatus(tx.status)';

/** 每一行(与下一行拼起来看)逐个匹配。 */
const CHECKS = [
  {
    name: 'refund',
    why: REFUND_WHY,
    test: (window) =>
      /adjustmentKind\s*===\s*'refund'[\s\S]{0,80}adjustmentKind\s*===\s*'reversal'/.test(window) ||
      /adjustmentKind\s*===\s*'reversal'[\s\S]{0,80}adjustmentKind\s*===\s*'refund'/.test(window)
  },
  {
    name: 'status',
    why: STATUS_WHY,
    // 一行里同时比对了两个以上的交易状态,基本就是把 ans 计入余额的规则抄了一遍。
    test: (window) => {
      const matches = ['pending', 'closed', 'failed'].filter((status) =>
        new RegExp(`status\\s*[!=]==?\\s*'${status}'`).test(window)
      );
      return matches.length >= 2;
    }
  }
];

/** 整份文件豁免,理由必须写清。 */
const SKIP_FILES = new Map([
  ['src/shared/lib/transactionMetrics.ts', 'isTransactionRefundLike 自身的实现,唯一真源'],
  ['src/shared/lib/localDate.ts', 'isBalanceAffectingStatus 自身的实现,唯一真源'],
  [SELF, '本脚本的说明文字里就含这些模式']
]);

/** file:line 级豁免(确实不是同一个判断)。 */
const ALLOW = new Map([
  [
    'src/shared/store/useFinanceStore.ts:330',
    'normalizeAdjustmentKind:判断的是「是否已是三种已知 kind 之一(含 normal)」,不是退款判断'
  ],
  [
    'src/pages/assistant/AssistantPage.tsx:1287',
    '助手待办:统计「待处理/失败」的还款笔数,与「是否计入余额」无关(它本来就是待处理项)'
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
    const pair = lines.slice(index, index + 2);
    const window = pair.join(' ');
    const hit = CHECKS.find((check) => check.test(window));
    if (!hit) continue;
    // 报「真正写着比较的那一行」,而不是两行窗口的起点 —— 人按这个行号去 grep 才找得到。
    const offset = pair.findIndex((line) => /adjustmentKind|\.status/.test(line));
    const key = rel + ':' + (index + 1 + (offset === -1 ? 0 : offset));
    if (!ALLOW.has(key)) hits.push({ key, why: hit.why });
    // 命中后跳过下一行:同一个写法会被相邻两次窗口各命中一次。
    index += 1;
  }
}

if (hits.length === 0) {
  console.log(
    '共享谓词检查通过:没有手写的「退款/冲正」判断,也没有手写的「是否计入余额的状态」。'
  );
  process.exit(0);
}

console.log('发现 ' + hits.length + ' 处重复实现:');
for (const hit of hits) console.log('  ' + hit.key + '\n    ' + hit.why);
if (args.has('--list')) process.exit(0);
process.exit(1);
