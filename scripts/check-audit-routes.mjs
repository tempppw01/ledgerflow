#!/usr/bin/env node
/**
 * 守卫:界面审计覆盖的路径必须与应用路由对齐。
 *
 * 为什么需要:审计的 ROUTES 是手写的,而 router.tsx 会继续加页面 —— 曾经就这样漏掉了
 * 三条真实页面(`/transactions/new`、`/settings`、`/tags`),而那时「36 个组合、0 个问题」
 * 仍然打印得很好看:**漏掉的页面从来没被跑过,报告里看不出来**。手工核对不管用,
 * 所以把它变成一道会失败的检查。
 *
 * 规则:
 *   · 动态段(如 `/transactions/:id`)不要求单独列出 —— 审计跑的是列表/新建等静态入口;
 *   · 通配 404 用任一「不存在的路径」代表即可,脚本按前缀匹配放过;
 *   · 重定向路由(`/investments/flow`)要求列出 —— 它也要能被安全访问。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = path.join(ROOT, 'src/app/router/router.tsx');
const AUDIT = path.join(ROOT, 'scripts/audit-ui-browser.mjs');

const routerSource = readFileSync(ROUTER, 'utf8');
const auditSource = readFileSync(AUDIT, 'utf8');

const normalize = (value) => '/' + String(value).replace(/^\//, '');

const appRoutes = [...routerSource.matchAll(/path: '([^']+)'/g)]
  .map((match) => match[1])
  .filter((value) => !value.includes(':'))
  .filter((value) => value !== '*')
  .map(normalize);

const auditMatch = auditSource.match(/const ROUTES = \[([\s\S]*?)\];/);
if (!auditMatch) {
  console.error('在 scripts/audit-ui-browser.mjs 里找不到 ROUTES 常量。');
  process.exit(1);
}
const auditedRoutes = [...auditMatch[1].matchAll(/'([^']+)'/g)].map((match) => normalize(match[1]));

const missing = appRoutes.filter((route) => !auditedRoutes.includes(route));
const unknown = auditedRoutes.filter((route) => !appRoutes.includes(route));

console.log(
  '应用路由 ' + appRoutes.length + ' 条(不含动态段与通配),审计覆盖 ' + auditedRoutes.length + ' 条'
);

if (missing.length === 0) {
  if (unknown.length > 0) {
    // 只提示不失败:审计里可能故意多跑一条不存在的路径来验 404 页,
    // 关键方向是「有没有页面从没被跑过」。
    console.log('\n提示:以下路径在路由表里没有(如果是故意验 404 的探针就忽略):');
    for (const route of unknown) console.log('  · ' + route);
  }
  console.log('界面审计覆盖了全部静态路由。');
  process.exit(0);
}

console.log('\n以下路由**没有被界面审计覆盖**(请加进 scripts/audit-ui-browser.mjs 的 ROUTES):');
for (const route of missing) console.log('  ✗ ' + route);
process.exit(1);