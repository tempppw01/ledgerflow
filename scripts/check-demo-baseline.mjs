#!/usr/bin/env node
/**
 * 演示账本基线核对。
 *
 * 为什么需要:手工验证都拿演示库做,而它**会被改动**(我这一段为了验证反复改过 —— 有一次
 * 写完忘了清,还有一次清干净了但忘了回写账户余额缓存,都是靠人肉核对才发现的)。
 * 文档里那张基线表如果不变成可执行的检查,就只是"希望它没变"。
 *
 * 这里只**读**库,核对 counts / 关键余额 / 退款夹具 / 外键与回收站是否为空。
 * 钱的恒等式(逐月收支、净值构成等)交给 `npm run audit:ledger-math` —— 两者互补。
 *
 * 用法:node scripts/check-demo-baseline.mjs [--email=...]
 * 库不存在或该账号不存在时**跳过**(不算失败),这样别的环境里跑也不会误报。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith('--email='));
const EMAIL = emailArg ? emailArg.slice('--email='.length) : 'demo.mcp@ledgerflow.local';

const DB_PATH = process.env.SQLITE_PATH || path.join(ROOT, 'data/ledgerflow.sqlite');
if (!existsSync(DB_PATH)) {
  console.log('跳过:本地库不存在(' + DB_PATH + ')');
  process.exit(0);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const authUser = db.prepare('SELECT ledger_user_id FROM auth_users WHERE email = ?').get(EMAIL);
if (!authUser?.ledger_user_id) {
  console.log('跳过:库里没有账号 ' + EMAIL);
  process.exit(0);
}
const uid = authUser.ledger_user_id;

const count = (table, extra = '') =>
  db.prepare('SELECT COUNT(*) c FROM ' + table + ' WHERE user_id = ?' + extra).get(uid).c;

/** 文档 docs/HANDOVER.md「演示账本的基线」一节里的数字,保持同步。 */
const BASELINE = [
  { label: '交易(未删除)', actual: count('ledger_transactions', ' AND trashed_at IS NULL'), expected: 298 },
  { label: '回收站里的交易', actual: count('ledger_transactions', ' AND trashed_at IS NOT NULL'), expected: 0 },
  { label: '账户(未删除)', actual: count('ledger_accounts', ' AND trashed_at IS NULL'), expected: 6 },
  { label: '回收站里的账户', actual: count('ledger_accounts', ' AND trashed_at IS NOT NULL'), expected: 0 },
  { label: '分类', actual: count('ledger_categories'), expected: 21 },
  { label: '订阅', actual: count('ledger_subscriptions'), expected: 3 },
  { label: '负债', actual: count('ledger_debts'), expected: 3 },
  { label: '投资持仓', actual: count('investment_positions'), expected: 5 },
  { label: '投资目标', actual: count('investment_goals'), expected: 2 },
  { label: 'settings', actual: count('ledger_user_settings'), expected: 11 },
  {
    label: '「现金」账户余额',
    actual: db.prepare("SELECT balance FROM ledger_accounts WHERE user_id = ? AND name = '现金'").get(uid)?.balance,
    expected: -595.2
  },
  {
    label: '¥390.55 那对(支出+退款)',
    actual: db.prepare('SELECT COUNT(*) c FROM ledger_transactions WHERE user_id = ? AND amount = 390.55').get(uid).c,
    expected: 2
  },
  { label: '外键悬垂行', actual: db.prepare('PRAGMA foreign_key_check').all().length, expected: 0 }
];

const bad = BASELINE.filter((row) => Number(row.actual) !== Number(row.expected));

console.log('演示账本基线(' + EMAIL + '):');
for (const row of BASELINE) {
  const ok = Number(row.actual) === Number(row.expected);
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + row.label + ': ' + row.actual + (ok ? '' : ' (应为 ' + row.expected + ')'));
}

db.close();

if (bad.length === 0) {
  console.log('\n与文档基线一致。');
  process.exit(0);
}

console.log('\n以下项与 docs/HANDOVER.md 记录的基线不一致:');
for (const row of bad) console.log('  ✗ ' + row.label + ':实际 ' + row.actual + ',基线 ' + row.expected);
console.log(
  '\n多半是手工验证写进了演示库(比如记了一笔测试交易)。清理时注意两点:\n' +
    '  · 交易与它的 ledger_balance_changes 行要一起删;\n' +
    '  · 删完还要把账户的 balance 缓存回写成审计算出的值(audit:ledger-math 会告诉你是多少)。\n' +
    '改完跑 npm run audit:ledger-math 确认钱的口径也自洽。'
);
process.exit(1);