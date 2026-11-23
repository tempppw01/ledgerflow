#!/usr/bin/env node
/**
 * 浏览器端页面体检(18 个路由 × 桌面 / 移动两档宽度)。
 *
 * 为什么需要它:这一版修的三个问题,`tsc` / `eslint` / 1035 个单元测试**全是绿的** ——
 *   · 概览页 .vi-page 的列被内容顶到 545px,右侧被 overflow-x:hidden 裁掉
 *   · 投资页把有符号的综合分拼进「每 15 分钟更新 …」这句话里,读成「更新 -23 分钟」
 *   · 自己导出的 CSV 导回来 0 条
 * 它们都有共同特征:**界面照样给"正常"的反馈**。单元测试断言不了「这条是不是被裁掉了」,
 * 只能靠真的在浏览器里量。
 *
 * 检查项:
 *   - 整页横向溢出(scrollWidth > clientWidth)
 *   - 元素越过视口右边界,且不在横向滚动容器内(这类元素既不滚动也点不到)
 *   - 字号 < 11px 的纯文本节点
 *   - 没有可读名称(aria-label / 文本 / title 都空)的 button 与 a[href]
 *   - 每个路由新产生的 console error
 *
 * 已知误报(见文末 allowlist):
 *   - 交易页移动端的 .transaction-mobile-swipe:滑动手势的初始态,操作走「⋯」菜单
 *   - SVG <text> 的 className 是 SVGAnimatedString,打印成 [object SVGAnimatedString]
 *
 * 用法:
 *   node scripts/audit-ui-browser.mjs [--base=http://localhost:5333] [--desktop|--mobile]
 *   AUDIT_EMAIL=... AUDIT_PASSWORD=... node scripts/audit-ui-browser.mjs
 *
 * 依赖 playwright,但**不**把它装进 devDependencies:优先用 PLAYWRIGHT_MODULE 指定的
 * 模块路径,否则依次尝试仓库内的 playwright、DSH profile 里那份。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROUTES = [
  '/',
  '/transactions',
  '/smart-budget',
  '/assistant',
  '/global-memory',
  '/financial-analysis',
  '/categories-accounts',
  '/balance-changes',
  '/investments',
  '/subscriptions',
  '/repayment-management',
  '/database-settings',
  '/recycle-bin',
  '/exchange',
  '/salary-tools',
  '/finance',
  '/help',
  '/about'
];

const VIEWPORTS = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }]
];

/** 已知误报:命中的元素不算问题 */
const ALLOWED_OVERFLOW_CLASSES = ['transaction-mobile-swipe', 'transaction-mobile-delete'];

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('--base=')) || '--base=http://localhost:5333').slice(7);
const onlyDesktop = args.includes('--desktop');
const onlyMobile = args.includes('--mobile');
const EMAIL = process.env.AUDIT_EMAIL || 'demo.mcp@ledgerflow.local';
const PASSWORD = process.env.AUDIT_PASSWORD || 'ledgerflow-mcp-2026';

function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'),
    path.join(
      process.env.USERPROFILE || '',
      '.dsh',
      'profiles',
      'desktop',
      'node_modules',
      'playwright',
      'index.mjs'
    ),
    path.join(
      process.env.USERPROFILE || '',
      '.dsh',
      'mcp',
      'playwright-mcp',
      'node_modules',
      'playwright',
      'index.mjs'
    )
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error(
    '找不到 playwright。用 PLAYWRIGHT_MODULE 指定它的 index.mjs,或 npx playwright install 后重试。\n' +
      '试过:\n' +
      candidates.map((c) => `  - ${c}`).join('\n')
  );
}

function isAllowedOverflow(className) {
  return ALLOWED_OVERFLOW_CLASSES.some((allowed) => className.includes(allowed));
}

const AUDIT_FN = () => {
  const vw = document.documentElement.clientWidth;
  const out = {
    overflowing: [],
    tinyText: [],
    unnamedControls: [],
    emptyMain: false,
    mainTextLength: 0
  };

  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
      continue;

    if (rect.right > vw + 1) {
      // 横向滚动容器内部的内容"超出"是正常的(它就是用来滚的)
      let inScroller = false;
      let parent = el.parentElement;
      while (parent) {
        const parentStyle = getComputedStyle(parent);
        if (
          (parentStyle.overflowX === 'auto' || parentStyle.overflowX === 'scroll') &&
          parent.scrollWidth > parent.clientWidth
        ) {
          inScroller = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!inScroller) {
        out.overflowing.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          text: (el.textContent || '').trim().slice(0, 36),
          overBy: Math.round(rect.right - vw)
        });
      }
    }

    const fontSize = parseFloat(style.fontSize);
    const text = (el.textContent || '').trim();
    if (
      fontSize > 0 &&
      fontSize < 11 &&
      text &&
      el.children.length === 0 &&
      el.tagName.toLowerCase() !== 'text'
    ) {
      out.tinyText.push({
        text: text.slice(0, 36),
        fontSize,
        cls: String(el.className).slice(0, 50)
      });
    }
  }

  for (const el of document.querySelectorAll('button, a[href]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const name = (
      el.getAttribute('aria-label') ||
      el.textContent ||
      el.getAttribute('title') ||
      ''
    ).trim();
    if (!name) {
      out.unnamedControls.push({ tag: el.tagName, cls: String(el.className).slice(0, 60) });
    }
  }

  const main = document.querySelector('main');
  if (main) {
    out.mainTextLength = main.innerText.trim().length;
    out.emptyMain = out.mainTextLength < 60;
  }

  return out;
};

async function login(page) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const emailBox = page.getByRole('textbox', { name: '邮箱' });
  if (await emailBox.count()) {
    await emailBox.fill(EMAIL);
    await page.getByRole('textbox', { name: '密码' }).fill(PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForTimeout(2500);
  }
}

const { chromium } = await import(resolvePlaywright());
const browser = await chromium.launch();
const problems = [];
const tinyTextFindings = [];
let checked = 0;

for (const [label, viewport] of VIEWPORTS) {
  if (onlyDesktop && label !== 'desktop') continue;
  if (onlyMobile && label !== 'mobile') continue;

  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160));
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`));

  await login(page);

  for (const route of ROUTES) {
    const errorsBefore = consoleErrors.length;
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
    /*
     * 等页面「网络静默」再判定,最多 3 秒,之后再加 600ms 缓冲。
     *
     * 原来是固定 1200ms:晚于 1.2 秒才失败的异步请求会被整批漏掉,
     * 而这类失败的代价是「审计报 0 问题、实际有报错」。
     * 注意:networkidle 在被轮询/长连接的页面上可能一直不到,所以必须有超时兜底。
     */
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);

    const audit = await page.evaluate(AUDIT_FN);
    const scrollOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    const newErrors = consoleErrors.slice(errorsBefore);
    const overflowing = audit.overflowing.filter((item) => !isAllowedOverflow(item.cls));
    checked += 1;

    if (audit.tinyText.length) {
      tinyTextFindings.push({ viewport: label, route, items: audit.tinyText });
    }

    if (
      scrollOverflow > 1 ||
      overflowing.length ||
      audit.unnamedControls.length ||
      audit.emptyMain ||
      newErrors.length
    ) {
      problems.push({
        viewport: label,
        route,
        scrollOverflow,
        overflowing,
        unnamedControls: audit.unnamedControls,
        emptyMain: audit.emptyMain,
        mainTextLength: audit.mainTextLength,
        consoleErrors: newErrors
      });
    }
  }

  await context.close();
}

await browser.close();

const report = {
  base,
  checked,
  problemCount: problems.length,
  note: '字号 < 11px(tinyText)与滑动手势初始态只报告、不计入 problemCount —— 前者是设计取舍,先看趋势',
  problems,
  tinyText: tinyTextFindings
};
console.log(JSON.stringify(report, null, 2));
process.exit(problems.length ? 1 : 0);
