#!/usr/bin/env node
/**
 * 造/清临时测试用户 —— 手工验证用。
 *
 * 为什么需要:浏览器端到端验证要一个干净账号,而**绝不能用演示账号**(演示库是要保持基线的)。
 * 这个脚本在本会话里被我手写了四次,每次都重新推导"按依赖顺序删表",而且第一次还因为
 * 用错了账号往演示库写进了一笔测试交易(靠人肉对表才发现)。
 *
 * 所以它有两个结构性保护:
 *   1. **拒绝碰演示账号**(按 email 与 ledger_user_id 双重比对)—— 让那个错误无法再发生;
 *   2. 清理时按**依赖顺序**删表(session → tags → balance_changes → transactions → … → users),
 *      顺序写死在这里,不用每次重新想。
 *
 * 用法:
 *   node scripts/dev-test-user.mjs --create  <ledgerUserId> <email>
 *   node scripts/dev-test-user.mjs --cleanup <ledgerUserId> <email>
 *
 * 密码沿用演示账号的哈希(本地调试用,不用于任何部署)。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.SQLITE_PATH || path.join(ROOT, 'data/ledgerflow.sqlite');
const DEMO_EMAIL = 'demo.mcp@ledgerflow.local';

const [mode, ledgerUserId, email] = process.argv.slice(2);
if (!['--create', '--cleanup'].includes(mode) || !ledgerUserId || !email) {
  console.error('用法:node scripts/dev-test-user.mjs --create|--cleanup <ledgerUserId> <email>');
  process.exit(2);
}
if (!existsSync(DB_PATH)) {
  console.error('找不到本地库:' + DB_PATH);
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH);
const demo = db.prepare('SELECT ledger_user_id FROM auth_users WHERE email = ?').get(DEMO_EMAIL);
if (!demo) {
  console.error('库里没有演示账号,无法取得密码哈希(也不该在这里创建测试用户)');
  process.exit(2);
}

/** 保护:绝不碰演示账号 —— 这正是我第一次犯的错。 */
if (email === DEMO_EMAIL || ledgerUserId === demo.ledger_user_id) {
  console.error('拒绝执行:目标是演示账号(' + DEMO_EMAIL + ' / ' + demo.ledger_user_id + ')。');
  console.error('演示库是要保持基线的;请换一个测试用 id 与 email。');
  process.exit(1);
}

if (mode === '--create') {
  const existing = db.prepare('SELECT id FROM auth_users WHERE email = ?').get(email);
  if (existing) {
    console.log('已存在,不重复创建:' + email);
    process.exit(0);
  }
  const hash = db
    .prepare('SELECT password_hash, status FROM auth_users WHERE email = ?')
    .get(DEMO_EMAIL);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT OR REPLACE INTO ledger_users (id, display_name, created_at, updated_at) VALUES (?,?,?,?)'
  ).run(ledgerUserId, ledgerUserId, now, now);
  db.prepare(
    `INSERT OR REPLACE INTO auth_users
       (id, ledger_user_id, email, password_hash, display_name, status, password_updated_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    'auth-' + ledgerUserId,
    ledgerUserId,
    email,
    hash.password_hash,
    ledgerUserId,
    hash.status || 'active',
    now,
    now,
    now
  );
  console.log('已创建测试用户:' + email + '(ledgerUserId=' + ledgerUserId + ',密码与演示账号相同)');
  db.close();
  process.exit(0);
}

/** 清理:顺序写死,避免每次重新推导。外键约束要求先删引用方。 */
const cleanupOrder = [
  'auth_sessions', // 按 auth user id 删,单独处理
  'ledger_transaction_tags',
  'ledger_balance_changes',
  'ledger_transactions',
  'ledger_subscriptions',
  'investment_position_history',
  'investment_positions',
  'investment_goals',
  'investment_watchlists',
  'ledger_debt_repayments',
  'ledger_debts',
  'ledger_accounts',
  'ledger_categories',
  'ledger_user_settings'
];

let deleted = 0;
db.exec('BEGIN');
try {
  for (const authRow of db.prepare('SELECT id FROM auth_users WHERE email = ?').all(email)) {
    deleted += db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(authRow.id).changes;
  }
  for (const table of cleanupOrder.slice(1)) {
    const columns = db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name);
    if (!columns.includes('user_id')) continue;
    deleted += db.prepare('DELETE FROM ' + table + ' WHERE user_id = ?').run(ledgerUserId).changes;
  }
  db.prepare('DELETE FROM auth_users WHERE email = ?').run(email);
  db.prepare('DELETE FROM ledger_users WHERE id = ?').run(ledgerUserId);
  db.exec('COMMIT');
  console.log('已清理测试用户:' + email + '(共删除 ' + deleted + ' 行)');
} catch (error) {
  db.exec('ROLLBACK');
  console.error('清理失败已回滚:' + error.message);
  process.exit(1);
}

db.close();