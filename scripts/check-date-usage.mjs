#!/usr/bin/env node
/**
 * 日期用法闸门:禁止「按 UTC 取日」。
 *
 * 交易的 `date` 有两种形态:纯日期和带时间的 ISO 瞬间(用户在编辑页选的是本地时间)。
 * `date.slice(0, 10)` 取的是 **UTC 日**,在 UTC+8 的本地 00:00–07:59 会算到前一天 ——
 * 显示成昨天,还会掉出「本月」筛选。这个写法在项目里出现过 18 处,逐个换成
 * `resolveTransactionLocalDay()` 之后,用这道闸门防止它回来。
 *
 * 用法:
 *   node scripts/check-date-usage.mjs          # 有命中就非 0 退出
 *   node scripts/check-date-usage.mjs --list   # 只列出来,不失败
 *
 * 允许的例外(在 ALLOW 里显式列出,并写明理由):
 * - 文件名等非交易日期场景
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

/** file:line 形式的白名单,reason 必须是「为什么这里按 UTC 取日是对的」。 */
const ALLOW = new Map([
  [
    'src/features/dashboard/model/assetLiabilitySimulation.ts:467',
    // 预测账单的 date 不是时间戳:useAppPreferences.normalizeDateOnly() 在写入时已强制
    // 成纯 YYYY-MM-DD(不合法就存空串),不存在带时区的时间部分被截断的问题。
    '预测账单 date 已是纯 YYYY-MM-DD(写入时由 normalizeDateOnly 保证)'
  ]
]);

const PATTERNS = [
  { re: /\.date\.slice\(\s*0\s*,\s*10\s*\)/g, why: 'date.slice(0, 10) 取的是 UTC 日' },
  {
    re: /String\(\s*[A-Za-z_$][\w$.]*\.date\s*\|\|\s*''\s*\)\.slice\(\s*0\s*,\s*10\s*\)/g,
    why: "String(x.date || '').slice(0, 10) 取的是 UTC 日"
  },
  {
    /*
     * 两个 slice(0, 10) 直接比大小 —— 也就是「同一个 UTC 日」的写法。
     * 用 `shared/lib/localDate.isSameLocalDay(a, b)` 代替:它把两侧都归一到本地日。
     * (实测过的坑:判断「同一天是否已经生成过订阅支出」时,UTC 日与本地日在
     *  本地 00:00–07:59 会差一天。)
     */
    re: /[\w$.()[\]\s]*\.slice\(\s*0\s*,\s*10\s*\)\s*===\s*[\w$.()[\]\s]*\.slice\(\s*0\s*,\s*10\s*\)/g,
    why: '两个 slice(0, 10) 直接比较 = 比 UTC 日;请改用 isSameLocalDay(a, b)'
  }
];

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__snapshots__') continue;
      listFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const hits = [];
for (const file of listFiles(path.join(root, 'src')).concat(
  // server/ 与 scripts/ 原先在范围外 —— 而 server 里也会处理日期(例如 server/sqlDateTime.js)。
  // tsconfig 只 include src,所以这些文件连 tsc 都不走;范围越窄,闸门越像装饰。
  listFiles(path.join(root, 'server')),
  listFiles(path.join(root, 'scripts'))
)) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  // 规则实现自己当然会用这个写法(注释里也提到),跳过
  if (relative === 'src/shared/lib/localDate.ts') continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // 跳过注释行
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    for (const { re, why } of PATTERNS) {
      re.lastIndex = 0;
      if (!re.test(line)) continue;
      const key = `${relative}:${index + 1}`;
      if (ALLOW.has(key)) continue;
      hits.push({ key, why, code: trimmed.slice(0, 90) });
      break;
    }
  });
}

if (hits.length === 0) {
  console.log('日期用法检查通过:没有「按 UTC 取日」的写法');
  process.exit(0);
}

console.log(`发现 ${hits.length} 处「按 UTC 取日」:\n`);
for (const hit of hits) {
  console.log(`  ${hit.key}\n      ${hit.why}\n      ${hit.code}`);
}
console.log('\n请改用 src/shared/lib/localDate.ts 里的 resolveTransactionLocalDay()。');
console.log('若此处按 UTC 取日确实正确(例如导出文件名),请在脚本 ALLOW 里显式列出并写明理由。');

process.exit(args.has('--list') ? 0 : 1);
