#!/usr/bin/env node
/**
 * WCAG 1.4.3 Contrast (Minimum) AA 扫描:浅色 + 深色两套主题 × 全部静态路由。
 *
 * 为什么需要:此前只逐个核对过「表单控件边框」(1.4.11 非文本对比度),
 * 没有系统扫过正文;而且界面审计一直只跑默认主题 —— **深色主题的对比度从没量过**。
 *
 * 判定(1.4.3 AA):
 *   普通文字 ≥ 4.5:1;大号文字(≥24px,或 ≥18.66px 且 bold)≥ 3:1。
 *
 * 两个必须绕开的测量陷阱(见 docs/a11y-focus-and-contrast.md §2):
 *   1. SVG 的 <text> 用 fill 而不是 color,直接读 color 会得到假失败;
 *   2. `.skip-to-content` 是 position:fixed 的 1px 隐藏文字,不排除的话
 *      会在每条路由上各报一次假的「rgb(0,0,238) on 深色底」(浏览器默认链接蓝)。
 *
 * 有意跳过(避免假阳性),单独计数:
 *   · 文字压在渐变/图片上 —— 算不出确定背景色;
 *   · 祖先有 opacity < 1 —— 实际颜色是合成后的;
 *   · 视觉隐藏文字(1px 技法 / clip rect / clip-path inset(50%))。
 *
 * 用法:
 *   node scripts/audit-contrast.mjs [--base=http://localhost:5333]
 *
 * 依赖 playwright,且需要一个已存在的演示账号,所以和 audit-ui-browser.mjs 一样
 * **不在 CI 里** —— 需要手动跑(或配合 scripts/audit-ui-local.mjs 起的服务)。
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = (
  process.argv.find((a) => a.startsWith('--base=')) || '--base=http://localhost:5333'
).slice(7);
const EMAIL = 'demo.mcp@ledgerflow.local';
const PASSWORD = 'ledgerflow-mcp-2026';

const ROUTES = [
  '/',
  '/transactions',
  '/transactions/new',
  '/tags',
  '/settings',
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

function resolvePlaywright() {
  for (const c of [
    path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'),
    path.join(
      process.env.USERPROFILE || '',
      '.dsh',
      'profiles',
      'desktop',
      'node_modules',
      'playwright',
      'index.mjs'
    )
  ])
    if (existsSync(c)) return pathToFileURL(c).href;
  throw new Error('找不到 playwright');
}
function exe() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const builds = readdirSync(root)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds)
    for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      const p = path.join(root, b, rel);
      if (existsSync(p)) return p;
    }
}

const SCAN = () => {
  const parseRgb = (value) => {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  /** 逐级向上找确定背景;遇到渐变/图片就返回不确定 */
  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { uncertain: true };
      const bg = parseRgb(cs.backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? over(acc, bg) : bg;
        if (bg.a >= 1) return { color: acc, uncertain: false };
      }
      if (parseFloat(cs.opacity) < 1) return { uncertain: true };
      node = node.parentElement;
    }
    const canvas = { r: 255, g: 255, b: 255, a: 1 };
    return { color: acc ? over(acc, canvas) : canvas, uncertain: false };
  };

  const out = { checked: 0, failures: [], skipped: 0, srOnly: 0, svgSkipped: 0 };

  /*
   * 「屏幕阅读器专用 / 视觉上隐藏」的文字不参与对比度判定,否则会得到假失败。
   * 注意判据不能只看 position:absolute —— `.skip-to-content` 是 position:fixed,
   * 漏掉它就会在全站 21 条路由上各报一次「rgb(0,0,238) on 深色底」,
   * 那是浏览器默认链接蓝,不是真实可见的文字。
   */
  const isVisuallyHidden = (el) => {
    if (el.clientHeight <= 1 || el.clientWidth <= 1) return true;
    const cs = getComputedStyle(el);
    const clip = cs.clip || '';
    if (/rect\(\s*0/.test(clip) && clip.includes('0 0 0')) return true;
    if (cs.clipPath && cs.clipPath.includes('inset(50%)')) return true;
    return false;
  };

  for (const el of document.querySelectorAll('body *')) {
    // SVG 的 <text> 用 fill 而不是 color,直接读 color 会得到假失败
    // (文档 §2 的「测量陷阱 1」:首页趋势图标签曾因此误报)。
    if (el.ownerSVGElement) {
      out.svgSkipped += 1;
      continue;
    }

    // 只看「自己直接含文字」的元素,避免父元素把子元素的文字重复算一遍
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (!ownText) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (isVisuallyHidden(el)) {
      out.srOnly += 1;
      continue;
    }

    const fg = parseRgb(cs.color);
    if (!fg) {
      out.skipped += 1;
      continue;
    }
    const bgInfo = effectiveBg(el);
    if (bgInfo.uncertain) {
      out.skipped += 1;
      continue;
    }
    const fgComposited = fg.a < 1 ? over(fg, bgInfo.color) : fg;

    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = isLarge ? 3 : 4.5;
    const got = ratio(fgComposited, bgInfo.color);

    out.checked += 1;
    if (got + 0.005 < need) {
      out.failures.push({
        text: ownText.slice(0, 42),
        cls: String(el.className).slice(0, 60),
        tag: el.tagName,
        ratio: Math.round(got * 100) / 100,
        need,
        size,
        weight,
        color: cs.color,
        bg: `rgb(${Math.round(bgInfo.color.r)}, ${Math.round(bgInfo.color.g)}, ${Math.round(bgInfo.color.b)})`
      });
    }
  }
  return out;
};

const { chromium } = await import(resolvePlaywright());
const browser = await chromium.launch({ executablePath: exe() });

const all = [];
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: scheme
  });
  const page = await context.newPage();

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const pw = page.locator('input[type="password"]');
  await pw.waitFor({ state: 'visible', timeout: 20000 });
  await page.getByLabel('邮箱').first().fill(EMAIL);
  await pw.fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await pw.waitFor({ state: 'detached', timeout: 25000 });
  await page.waitForFunction(() => document.querySelectorAll('nav').length > 0, undefined, {
    timeout: 30000
  });

  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`\n===== 主题 ${scheme}(实际 data-theme=${applied})=====`);

  for (const route of ROUTES) {
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (theme !== scheme) {
      console.log(`  ! ${route} 主题变成了 ${theme},该条作废`);
      continue;
    }
    const r = await page.evaluate(SCAN);
    const uniq = new Map();
    for (const f of r.failures) {
      const key = f.cls + '|' + f.color + '|' + f.bg + '|' + f.need;
      if (!uniq.has(key)) uniq.set(key, { ...f, count: 1 });
      else uniq.get(key).count += 1;
    }
    all.push({
      scheme,
      route,
      checked: r.checked,
      skipped: r.skipped,
      srOnly: r.srOnly,
      failures: [...uniq.values()]
    });
  }
  await context.close();
}

await browser.close();

const total = all.reduce((n, r) => n + r.checked, 0);
const skipped = all.reduce((n, r) => n + r.skipped, 0);
const failing = all.filter((r) => r.failures.length);
console.log(
  `\n===== 共检查 ${total} 个文字节点,跳过 ${skipped}(渐变/透明),${failing.length} 个路由有对比度不达标 =====\n`
);

for (const r of failing) {
  console.log(`[${r.scheme}] ${r.route}  (检查 ${r.checked} 个)`);
  for (const f of r.failures) {
    console.log(
      `   ${f.ratio}:1 (需 ${f.need}) ×${f.count}  ${f.size}px/${f.weight}  ${f.color} on ${f.bg}`
    );
    console.log(`      "${f.text}"  .${f.cls}`);
  }
}
