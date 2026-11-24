#!/usr/bin/env node
/**
 * 「自己又算了一遍」清单:列出所有对交易金额做手工求和的地方。
 *
 * 为什么需要它:我这一路修的真 bug,有三分之一长在同一个形状上 ——
 * **绕过共享汇总,自己写一遍对交易的求和**,于是同一屏里出现两个口径:
 *   · 资金动态看板的月支出(自己求和,忘了排除退款)
 *   · 投资页的 monthExpenseTotal(自己求和)
 *   · 助手工作台的 totals(自己求和)
 * 这些地方单看都不像错,只有把同一页的另一个数字拿来对照才暴露。
 *
 * 这个脚本不判对错(页面合计本来就该对自己看到的行求和),它做的是**把候选点摆出来**,
 * 并标出最可疑的一类:文件里在对交易求和,却**没有**引用共享的 transactionMetrics。
 *
 * 判定收得很紧:只认「有 .amount,且同行/上下文带 type 判断或 transactions/rows」的行 ——
 * 第一版没有这层过滤,把持仓、负债、预算、向量范数都算了进去,55 条里大半是噪声。
 *
 * 用法:
 *   node scripts/audit-handrolled-sums.mjs            # 全部列出
 *   node scripts/audit-handrolled-sums.mjs --risky    # 只列没引用共享汇总的
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const SUMMING = [
  { re: /\.reduce\(\s*\(?\s*(?:sum|total|acc)\b/i, why: 'reduce 累加' },
  { re: /\+=\s*(?:Number\()?(?:item|row|tx|entry)\.amount/i, why: '+= 金额累加' }
];

const SHARED = ['transactionMetrics', 'summarizeTransactions', 'filterCountableTransactions'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const rows = [];
for (const file of walk(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const text = readFileSync(file, 'utf8');
  const usesShared = SHARED.some((needle) => text.includes(needle));
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    // 只认「交易金额」:必须有 .amount,而且这一行或其上一行带 type 判断 / transactions,
    // 否则会把持仓、负债、预算、向量范数全都算进来(第一版就是这样,55 条里大半是噪声)。
    if (!/\.amount\b/.test(line)) return;
    const context = line + ' ' + (lines[index - 1] || '');
    if (!/type\s*===|transactions|rows\b|records\b/.test(context)) return;
    for (const { re, why } of SUMMING) {
      if (!re.test(line)) continue;
      rows.push({ rel, line: index + 1, code: line.trim().slice(0, 110), why, usesShared });
      break;
    }
  });
}

const risky = rows.filter((row) => !row.usesShared);
const target = args.has('--risky') ? risky : rows;

const byFile = new Map();
for (const row of target) {
  if (!byFile.has(row.rel)) byFile.set(row.rel, []);
  byFile.get(row.rel).push(row);
}

console.log('对交易金额手工求和的地方:' + rows.length + ' 处,其中 ' + risky.length + ' 处所在文件没有引用共享汇总\n');
for (const [file, list] of [...byFile.entries()].sort()) {
  const flag = list[0].usesShared ? '  ' : '⚠ ';
  console.log(flag + file + '  (' + list.length + ' 处)');
  for (const row of list) {
    console.log('    ' + row.line + ': ' + row.code);
  }
}

console.log(
  '\n⚠ = 文件内没有任何共享汇总的引用。这些是「同一屏两个口径」的高发区,' +
    '值得逐个确认:它求的是「你看到的这批行」,还是「账户口径的合计」。'
);

/*
 * 从「清单」升级成「闸门」:被标 ⚠ 的文件必须在下面给出一条**显式理由**,否则非 0 退出。
 *
 * 起因很具体:`workbenchUtils` 里那处手写聚合把**退款也算成一笔支出**(与 v0.50.20 修过的
 * 是同一个 bug),而这份清单当时只是把它们打印出来、不做判断 —— 于是它躺了很久没人管。
 * 现在的规则是:要么改用共享汇总,要么在这里说明「它求的不是交易行」。
 */
const JUSTIFIED = new Map([
  [
    'src/features/smart-budget/model/budgetPlan.ts',
    '这里求的是**预算分配行**(各分类的预算额度),不是交易行 —— 与「账户口径的合计」无关'
  ]
]);

const unjustified = [...byFile.keys()].filter(
  (file) => !rows.find((row) => row.rel === file)?.usesShared && !JUSTIFIED.has(file)
);

if (unjustified.length > 0) {
  console.log('\n以下文件在手工求交易金额、却既没引用共享汇总、也没有在 JUSTIFIED 里说明理由:');
  for (const file of unjustified) console.log('  ✗ ' + file);
  console.log('\n要么改用 shared/lib/transactionMetrics 的汇总,要么在脚本的 JUSTIFIED 里写清为什么这里求的不是交易行。');
  process.exit(1);
}

if (JUSTIFIED.size > 0) {
  console.log('\n已说明理由的例外:');
  for (const [file, why] of JUSTIFIED) console.log('  · ' + file + ' —— ' + why);
}