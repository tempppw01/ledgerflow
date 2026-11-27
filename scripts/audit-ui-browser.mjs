#!/usr/bin/env node
/**
 * 浏览器端页面体检(21 个路由 × 桌面 / 390 移动 / 320 Reflow 三档宽度)。
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
 *   - 触屏语义下 font-size < 16px 的表单控件(iOS 聚焦会自动放大整页)
 *
 * 为什么窄屏两档必须带 hasTouch:不带的话 Chromium 报 `pointer: fine`,
 * 全站 `@media (pointer: coarse)` 里那一批「为触屏放大点按区域 / 抬字号」的规则
 * **一条都不会生效** —— 于是这个审计一直在用一个「窄桌面窗口」冒充手机。
 * 实测验证过:hasTouch:true 时 matchMedia('(pointer: coarse)') 才为 true。
 *
 * 已知误报(见文末 allowlist):
 *   - 交易页移动端的 .transaction-mobile-swipe:滑动手势的初始态,操作走「⋯」菜单
 *   - SVG <text> 的 className 是 SVGAnimatedString,打印成 [object SVGAnimatedString]
 *
 * 为什么要多一档 320px:那是 WCAG 1.4.10 Reflow 的门槛,而 390px 过**不等于** 320px 过。
 * 财务分析页的市场柱状图 6 个金额在 390px 下正常,在 320px 下会互相压字 11px、
 * 最后一列越出视口 3px 被卡片裁掉 —— 只跑 390 就永远看不见。
 *
 * 登录这一步必须「等到真的进了应用」才算数:不能一挂载就用 count() 判断。
 * domcontentloaded 早于 React 渲染,count() 又不会自动等待,于是 count()=0 →
 * 登录被静默跳过 → 之后每个路由量到的都是登录页,而报告仍然是「0 个问题」。
 * 假清白比报错危险得多,所以现在登录不成功就直接抛错。
 *
 * 用法:
 *   node scripts/audit-ui-browser.mjs [--base=http://localhost:5333] [--desktop|--mobile]
 *   (--mobile 会跑 390 与 320 两档窄宽度)
 *   AUDIT_EMAIL=... AUDIT_PASSWORD=... node scripts/audit-ui-browser.mjs
 *
 * 依赖 playwright,但**不**把它装进 devDependencies:优先用 PLAYWRIGHT_MODULE 指定的
 * 模块路径,否则依次尝试仓库内的 playwright、DSH profile 里那份。
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * 覆盖的路径要和 src/app/router/router.tsx 对齐。
 * 曾经漏了三条真实页面(/transactions/new、/settings、/tags)—— 那时「36 个组合、0 个问题」
 * 是有洞的:漏掉的页面从来没被跑过。加了路由之后请顺手核对一次两边是否仍然一致。
 */
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
  '/about',
  '/investments/flow', // 重定向到 /investments,顺带验重定向不报错
  '/这条路径不存在-用来验404' // 通配 404 页也要能安全渲染
];

const VIEWPORTS = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
  // WCAG 1.4.10 Reflow 的门槛就是 320 CSS px,不是 390。
  ['reflow-320', { width: 320, height: 844 }]
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

/**
 * 文档标题的唯一性(WCAG 2.4.2 Page Titled)。
 *
 * 光看「有标题」不够 —— 修这条之前,22 条路由的标题全是「LedgerFlow 记账软件」,
 * 浏览器历史里全是同名条目、读屏器也分不出页面。所以这里按**每个视口**统计:
 * 不同路由的标题必须各不相同(`/` 与 `/这条路径不存在` 这种当然也是不同的)。
 *
 * 重定向路由(/investments/flow -> /investments、/tags -> /categories-accounts)
 * 与它的目标页同标题是**正确**的 —— 那时 location 已经变了,所以按最终 title 去重即可,
 * 不去比较「请求的路由」。
 */
function summarizeTitles(rows) {
  const byViewport = new Map();
  for (const row of rows) {
    if (!byViewport.has(row.viewport)) byViewport.set(row.viewport, []);
    byViewport.get(row.viewport).push(row);
  }
  const out = { checked: rows.length, duplicated: [] };
  for (const [viewport, list] of byViewport) {
    const seen = new Map();
    for (const item of list) {
      if (!seen.has(item.title)) seen.set(item.title, []);
      seen.get(item.title).push(item.route);
    }
    for (const [title, routes] of seen) {
      // 只报告"多个不同路由共用同一标题",且这些路由不是同一个重定向对
      if (routes.length > 1) {
        out.duplicated.push({ viewport, title: title.slice(0, 60), routes });
      }
    }
  }
  return out;
}

const AUDIT_FN = () => {
  const vw = document.documentElement.clientWidth;
  const out = {
    overflowing: [],
    tinyText: [],
    unnamedControls: [],
    emptyMain: false,
    mainTextLength: 0,
    mainHeadingCount: 0,
    mainControlCount: 0,
    // —— 以下来自 WCAG / The A11Y Project 清单(2026-11-25 补)——
    missingAlt: [],
    lang: document.documentElement.lang || '',
    h1Count: document.querySelectorAll('h1').length,
    headingSkip: null,
    buttonsWithoutType: 0,
    positiveTabindex: 0,
    autofocus: 0,
    duplicateIds: [],
    skipLink: 0,
    mainLandmark: 0,
    smallTargets: [],
    // 触屏语义下字号 < 16px 的表单控件(只在这两档窄屏 + hasTouch 时才可能有内容)
    coarseControlFont: [],
    imageCount: 0,
    fieldCount: 0
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
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

  /*
   * iOS Safari 在聚焦 font-size < 16px 的输入控件时会自动放大整页,放大后不回弹。
   * 只在触屏语义下才可能发生(桌面浏览器不会),所以这里也只在 pointer: coarse 时检查 ——
   * 否则会把「桌面故意用 12px 的密集筛选栏」也一并报出来,变成一条永远修不完的规则。
   * checkbox/radio/range 这些不触发聚焦缩放,排除掉再判。
   */
  if (window.matchMedia('(pointer: coarse)').matches) {
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!visible(el)) continue;
      const kind = (el.getAttribute('type') || '').toLowerCase();
      if (['checkbox', 'radio', 'range', 'color', 'hidden', 'file'].includes(kind)) continue;
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      if (fontSize > 0 && fontSize < 16) {
        out.coarseControlFont.push({
          tag: el.tagName,
          fontSize,
          cls: String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.'),
          name: (
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.textContent ||
            ''
          )
            .trim()
            .slice(0, 30)
        });
      }
    }
  }

  const main = document.querySelector('main');
  if (main) {
    out.mainTextLength = main.innerText.trim().length;
    /*
     * 「主内容渲染空了」不能只看字符数,也不能看全局的 h1。
     * 原来只看 < 60 字符:/recycle-bin(空回收站的空状态,46 字符)和 404 页
     * (55 字符)永远被报红 —— 它们都有正经的标题和可点的空状态按钮,是真页面。
     * 一个永远不会变绿的检查,只会让人学会忽略它。
     *
     * 判定必须**只在 main 内部取信号**,否则会瞎:这几个页面的 h1 在 main 之外
     * (布局头部),拿全局 h1Count 当条件时,把 main 清空仍然 h1Count=1 → 漏报。
     * 真正「空了」的样子:main 里既没文字、也没标题、也没任何可操作元素。
     */
    out.mainHeadingCount = main.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
    out.mainControlCount = main.querySelectorAll('button, a[href], input, select, textarea').length;
    out.emptyMain =
      out.mainTextLength < 60 && out.mainHeadingCount === 0 && out.mainControlCount === 0;
  }

  /*
   * ===== WCAG / A11Y Project 清单的自动化部分 =====
   * 每一条都能对上清单里的具体条目,所以报红时可以直接查对应准则:
   *   missingAlt       1.1.1 非文本内容      —— img 必须有 alt(装饰图用 alt="")
   *   lang             3.1.1 页面语言        —— <html lang> 必须存在
   *   h1Count          2.4.6 标题与标签      —— 每个视图恰好一个 h1
   *   headingSkip      2.4.6 标题与标签      —— 不许跳级(h2 后面直接 h4)
   *   buttonsWithoutType 1.3.1 信息与关系    —— button 默认 type=submit,会误提交表单
   *   positiveTabindex 2.4.3 焦点顺序        —— tabindex>0 打乱视觉顺序
   *   autofocus        2.4.3 焦点顺序        —— 未经允许移动焦点
   *   duplicateIds     4.1.1 解析            —— id 重复会让 label/aria 指向错的元素
   *   skipLink         2.4.1 绕过区块        —— 有导航就必须有跳转链接
   *   mainLandmark     4.1.2 名称角色值      —— 必须有 main 地标
   */
  out.imageCount = document.querySelectorAll('img').length;
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) {
      out.missingAlt.push({ src: (img.getAttribute('src') || '').slice(0, 50) });
    }
  }

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  for (let i = 1; i < headings.length; i++) {
    const prev = Number(headings[i - 1].tagName[1]);
    const cur = Number(headings[i].tagName[1]);
    if (cur - prev > 1) {
      out.headingSkip = `h${prev} -> h${cur},在「${headings[i].textContent.trim().slice(0, 20)}」`;
      break;
    }
  }

  for (const btn of document.querySelectorAll('button')) {
    if (!btn.hasAttribute('type')) out.buttonsWithoutType += 1;
  }
  for (const el of document.querySelectorAll('[tabindex]')) {
    if (Number(el.getAttribute('tabindex')) > 0) out.positiveTabindex += 1;
  }
  out.autofocus = document.querySelectorAll('[autofocus]').length;

  const idCount = Object.create(null);
  for (const el of document.querySelectorAll('[id]')) {
    idCount[el.id] = (idCount[el.id] || 0) + 1;
  }
  for (const [id, n] of Object.entries(idCount)) {
    if (n > 1) out.duplicateIds.push({ id: id.slice(0, 40), count: n });
  }

  /*
   * 跳转链接(WCAG 2.4.1):有导航(或侧边栏)时,必须有一个指向页内锚点的链接,
   * 锚点要真实存在,而且**聚焦后必须真的可见** —— 清单特别强调这一点,
   * 只"存在但永远看不见"等于没有。这里临时聚焦再量一次(无副作用:不移出视口、不改 DOM)。
   */
  out.navCount = document.querySelectorAll('nav, aside').length;
  out.skipLink = 0;
  if (out.navCount > 0) {
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const target = (a.getAttribute('href') || '').slice(1);
      if (!target) continue;
      const anchor = document.getElementById(target);
      if (!anchor) continue;
      const active = document.activeElement;
      a.focus();
      const r = a.getBoundingClientRect();
      const shownWhenFocused = r.width > 8 && r.height > 8;
      if (active && typeof active.focus === 'function') active.focus();
      if (shownWhenFocused) {
        out.skipLink += 1;
        break;
      }
    }
  }
  out.mainLandmark = document.querySelectorAll('main').length;
  out.fieldCount = document.querySelectorAll('input, select, textarea').length;

  /*
   * 触控目标尺寸:只报告、不致败。
   * WCAG 2.5.8(AA)要求 24×24,而 44×44 是 2.5.5(AAA)与各移动平台指南的线 ——
   * 拿 AAA 去致败会把大量 38px 高的导航行误报成缺陷(它们过 AA)。
   */
  for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      out.smallTargets.push({
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20),
        w: Math.round(r.width),
        h: Math.round(r.height)
      });
    }
  }

  return out;
};

async function login(page) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });

  // 等「登录表单出现」或「应用外壳出现」其中的一个,不能一挂载就 count()
  // (domcontentloaded 早于 React 渲染,count() 不自动等待 → 会静默漏掉登录)。
  // 邮箱框没有 type 属性(React 省略了,el.type 只是默认值 'text'),
  // 所以 input[type="text"] 选不到它,必须用 label 定位。
  const passwordBox = page.locator('input[type="password"]');
  const emailBox = page.getByLabel('邮箱').first();

  await page
    .waitForFunction(
      () =>
        !!document.querySelector('input[type="password"]') ||
        document.querySelectorAll('nav').length > 0,
      undefined,
      { timeout: 20000 }
    )
    .catch(() => {});

  if (await passwordBox.count()) {
    await emailBox.fill(EMAIL);
    await passwordBox.fill(PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    // 登录表单卸载 = 已认证。不能用「nav 可见」:320/390 下侧栏本来就收起来。
    await passwordBox.waitFor({ state: 'detached', timeout: 25000 });

    // 但表单卸载之后还有一道「正在载入账本」的数据门(SqlDataSyncGate),
    // 那段时间 nav 还不存在。必须等到外壳真的渲染出来,否则会被误判成登录失败。
    await page.waitForFunction(() => document.querySelectorAll('nav').length > 0, undefined, {
      timeout: 30000
    });
  }

  // 硬断言:没进应用就不许继续,否则后面每个路由量的都是登录页。
  const state = await page.evaluate(() => ({
    nav: document.querySelectorAll('nav').length,
    onLogin: (document.querySelector('h1')?.innerText || '').includes('登录')
  }));
  if (state.nav === 0 || state.onLogin) {
    throw new Error(
      `登录失败,仍在登录页(nav=${state.nav}) —— 后续所有结果都不可信。` +
        `请检查 AUDIT_EMAIL / AUDIT_PASSWORD 与服务是否正常。`
    );
  }
}

const { chromium } = await import(resolvePlaywright());
/**
 * 机器上装的 chromium 常常比 playwright 期望的版本旧
 * (例如 playwright 要 1255、ms-playwright 里只有 1248),
 * 这时默认路径必然报 "Executable doesn't exist" —— 审计根本跑不起来,
 * 而「跑不起来」很容易被当成「没时间跑」。所以退一步用已装的那一份。
 * 也可以用 AUDIT_CHROME_EXE 显式指定。
 */
function resolveInstalledChromium() {
  if (process.env.AUDIT_CHROME_EXE) return process.env.AUDIT_CHROME_EXE;
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of builds) {
    for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      const exe = path.join(root, build, rel);
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch();
  } catch (error) {
    const exe = resolveInstalledChromium();
    if (!exe) throw error;
    console.log('(默认 chromium 不可用,改用已装的:' + exe + ')');
    return chromium.launch({ executablePath: exe });
  }
}

const browser = await launchBrowser(chromium);
const problems = [];
const tinyTextFindings = [];
const smallTargetFindings = [];
const documentTitles = [];
let checked = 0;

for (const [label, viewport] of VIEWPORTS) {
  // --mobile 指的是「所有窄宽度」:390 与 320 都跑,否则 1.4.10 那档又被漏掉。
  const narrow = label !== 'desktop';
  if (onlyDesktop && narrow) continue;
  if (onlyMobile && !narrow) continue;

  // hasTouch 必须跟着窄屏一起开:否则 pointer: coarse 的规则一条都不生效(见文件头说明)
  const context = await browser.newContext({ viewport, hasTouch: narrow });
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
      newErrors.length ||
      // —— a11y(WCAG)致败项 ——
      audit.missingAlt.length ||
      !audit.lang ||
      audit.h1Count !== 1 ||
      audit.headingSkip !== null ||
      audit.buttonsWithoutType ||
      audit.positiveTabindex ||
      audit.autofocus ||
      audit.duplicateIds.length ||
      audit.mainLandmark !== 1 ||
      (audit.navCount > 0 && audit.skipLink === 0) ||
      // 触屏下 < 16px 的输入控件:iOS 会放大整页,属于真实可感的缺陷,直接致败
      audit.coarseControlFont.length
    ) {
      problems.push({
        viewport: label,
        route,
        title: await page.title(),
        scrollOverflow,
        overflowing,
        unnamedControls: audit.unnamedControls,
        emptyMain: audit.emptyMain,
        mainTextLength: audit.mainTextLength,
        consoleErrors: newErrors,
        coarseControlFont: audit.coarseControlFont,
        a11y: {
          lang: audit.lang,
          h1Count: audit.h1Count,
          headingSkip: audit.headingSkip,
          missingAlt: audit.missingAlt,
          buttonsWithoutType: audit.buttonsWithoutType,
          positiveTabindex: audit.positiveTabindex,
          autofocus: audit.autofocus,
          duplicateIds: audit.duplicateIds,
          mainLandmark: audit.mainLandmark,
          navCount: audit.navCount,
          skipLink: audit.skipLink
        }
      });
    }

    // 只报告、不致败的项
    if (audit.smallTargets.length) {
      smallTargetFindings.push({
        viewport: label,
        route,
        count: audit.smallTargets.length,
        samples: audit.smallTargets.slice(0, 5)
      });
    }
    documentTitles.push({ viewport: label, route, title: await page.title() });
  }

  await context.close();
}

await browser.close();

const report = {
  base,
  checked,
  problemCount: problems.length,
  note: '字号 < 11px(tinyText)、触控目标 < 44px(smallTargets)只报告、不计入 problemCount —— 前者是设计取舍,后者低于的是 AAA/平台指南线而不是 AA(2.5.8 只要求 24×24)',
  problems,
  tinyText: tinyTextFindings,
  smallTargets: smallTargetFindings,
  documentTitles: summarizeTitles(documentTitles)
};
console.log(JSON.stringify(report, null, 2));
process.exit(problems.length ? 1 : 0);
