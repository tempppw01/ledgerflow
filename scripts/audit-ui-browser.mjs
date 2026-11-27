#!/usr/bin/env node
/**
 * 浏览器端页面体检(23 个路由 × 桌面 / 390 移动 / 320 Reflow 三档宽度)。
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
 *   - 可点区域小于 24×24 且不命中 WCAG 2.5.8 的四条豁免(AA)
 *   - 表格格子里内容画到隔壁格子上
 *   - 触摸端「悬停粘住」:漏了 @media (hover: hover) 守卫,点过的控件一直亮着
 *   - 窄屏 @media 里写了 grid 专属属性但父级是 flex(声明等于没写,几何上看得出来)
 *   - 键盘焦点不可见(2.4.7)或被 sticky/fixed 内容完全遮住(2.4.11)
 *   - placeholder 长到显示不全(只报告)
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
    // WCAG 2.5.8(AA)24×24:命中四条豁免的不算,见下面判定处
    targetSize25x8: [],
    minTargetSkipped: { srOnly: 0, exempt: 0 },
    // 触屏语义下字号 < 16px 的表单控件(只在这两档窄屏 + hasTouch 时才可能有内容)
    coarseControlFont: [],
    // 单元格里的内容画到隔壁格子上(见下面判定处的说明)
    cellOverflow: [],
    // placeholder 长到显示不全(只报告)
    longPlaceholders: [],
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

  /*
   * 「格子里的字画到隔壁格子上」——表格最常见的坏样子,而且单测完全看不见。
   *
   * 成因通常是三件事叠一起:table-layout: fixed 把列宽定死、窄屏又隐藏了几列,
   * 而隐藏列的百分比宽度仍然被保留,于是可见列被挤得比内容还窄;
   * 单元格自己的 overflow 又是 visible,内容就直接画到隔壁格子上了 ——
   * 两组字叠在一起,日期还会被下一格标签的底色盖掉一半(看着像被截断)。
   *
   * 判据:单元格 overflow-x 是 visible 时,里面有子元素右边界越过该格的内容区右边界。
   * 刻意排除的情况(否则全是误报):
   *   · 绝对/固定定位的子元素 —— 下拉菜单、浮层本来就该溢出
   *   · 子元素与自己所属格子之间有任何一层会裁剪(overflow-x 不是 visible)的祖先
   */
  out.cellOverflow = [];
  for (const cell of document.querySelectorAll('td, th')) {
    if (!visible(cell)) continue;
    const cellStyle = getComputedStyle(cell);
    if (cellStyle.overflowX !== 'visible') continue; // 自己会裁/会滚,不会画到隔壁
    const box = cell.getBoundingClientRect();
    const limit = box.right - (parseFloat(cellStyle.paddingRight) || 0);
    /*
     * 先看裸文本:金额这类直接写在 td 里的文字没有子元素可查,
     * 但 scrollWidth 会如实变大。少了这一条,「金额悄悄溢出格子」永远查不出来。
     */
    if (cell.scrollWidth > cell.clientWidth + 1 && !cell.querySelector('*')) {
      out.cellOverflow.push({
        cell: cell.tagName + (cell.className ? '.' + String(cell.className).split(' ')[0] : ''),
        child: '(裸文本)',
        overBy: cell.scrollWidth - cell.clientWidth,
        text: (cell.textContent || '').trim().slice(0, 24)
      });
      continue;
    }
    for (const child of cell.querySelectorAll('*')) {
      if (!visible(child)) continue;
      const childStyle = getComputedStyle(child);
      if (childStyle.position === 'absolute' || childStyle.position === 'fixed') continue;
      // 中间只要有一层会裁剪,这个子元素其实看不见那部分,不算
      let clipped = false;
      for (let p = child.parentElement; p && p !== cell; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      const r = child.getBoundingClientRect();
      if (r.right > limit + 1) {
        out.cellOverflow.push({
          cell: cell.tagName + (cell.className ? '.' + String(cell.className).split(' ')[0] : ''),
          child:
            child.tagName.toLowerCase() +
            (child.className ? '.' + String(child.className).split(' ')[0] : ''),
          overBy: Math.round(r.right - limit),
          text: (cell.textContent || '').trim().slice(0, 24)
        });
        break;
      }
    }
  }

  /*
   * 占位提示被截断:placeholder 是"示例",不是文档,长到显示不全就失去意义,
   * 而且用户看不到的那半句等于不存在。用 canvas 按控件自己的字体量出文字宽度,
   * 再和控件的内容区宽度比。只报告、不致败 —— 它不违反任何 WCAG 条款。
   *
   * 注意这份审计只跑中文界面。英文界面里同一行的按钮更宽,输入框因此更窄
   * (实测还款页那个输入框:英文内容区 98px,中文 126px)—— 改文案时两边都要量。
   */
  out.longPlaceholders = [];
  for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const text = el.getAttribute('placeholder') || '';
    if (!text) continue;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const textWidth = ctx.measureText(text).width;
    const content =
      el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    if (content > 0 && textWidth > content + 1) {
      out.longPlaceholders.push({
        placeholder: text.slice(0, 30),
        textWidth: Math.round(textWidth),
        content: Math.round(content),
        font: style.fontSize,
        cls: String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')
      });
    }
  }

  /*
   * WCAG 2.5.8 Target Size (Minimum, AA):可点区域至少 24×24 CSS px ——
   * 除非命中它自己列出的四条豁免。这一条**比 44px 那档重要得多**:
   * 44 是 AAA / 平台指南线,24 才是 AA 的底线。
   *
   * 以前这里是"一律报小于 44 的",结果 63 个组合报出 1989 条,全是噪声
   * (桌面上的跳转链接、品牌链接、24×24 的图标按钮……),真正不达标的混在里面看不见。
   * 现在按 2.5.8 的判据来:
   *
   *   1) 间距:居中于目标的 24px 直径圆,若与其它目标都不相交 → 豁免
   *   2) 行内:目标处在句子里(所在块级元素还有明显更多的文字)→ 豁免
   *   3) 用户代理:原生控件且作者没改尺寸(未改过的 checkbox/radio/range/select)→ 豁免
   *   4) 必要:尺寸本身就是信息 —— 机器判不了,留在结果里人工复核
   *
   * 另外排除「只在获得焦点时出现」的跳转链接:平时是 1×1 裁着的,
   * 那是标准做法(键盘与读屏仍可用),不是一个"指不到"的目标。
   */
  out.targetSize25x8 = [];
  out.minTargetSkipped = { srOnly: 0, exempt: 0 };
  {
    const SEL =
      'button, a[href], select, input:not([type=hidden]), textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], [tabindex]:not([tabindex="-1"])';
    const targets = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (!visible(el)) continue;
      targets.push({ el, r: el.getBoundingClientRect() });
    }
    const label = (el) =>
      String(
        el.getAttribute('aria-label') ||
          el.textContent ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder') ||
          ''
      )
        .trim()
        .slice(0, 24);

    for (const t of targets) {
      const w = t.r.width;
      const h = t.r.height;
      if (w <= 2 && h <= 2) {
        out.minTargetSkipped.srOnly += 1;
        continue;
      }
      if (w >= 24 && h >= 24) continue;

      const tag = t.el.tagName.toLowerCase();
      const kind = (t.el.getAttribute('type') || '').toLowerCase();
      const uaNative =
        (tag === 'input' && ['checkbox', 'radio', 'range', 'file', 'color'].includes(kind)) ||
        tag === 'select';
      const uaUnstyled = uaNative && getComputedStyle(t.el).width === 'auto';

      let inline = false;
      for (let p = t.el.parentElement; p; p = p.parentElement) {
        if (['P', 'LI', 'TD', 'DD', 'LABEL', 'SPAN', 'SMALL'].includes(p.tagName)) {
          if ((p.textContent || '').trim().length > label(t.el).length + 12) {
            inline = true;
            break;
          }
        }
        if (p.tagName === 'TD') break;
      }

      // 间距豁免:把 24px 直径的圆居中在目标上,看它与别的目标相不相交
      const cx = t.r.left + w / 2;
      const cy = t.r.top + h / 2;
      let spaced = true;
      for (const o of targets) {
        if (o.el === t.el || t.el.contains(o.el) || o.el.contains(t.el)) continue;
        const ox = Math.min(Math.max(cx, o.r.left), o.r.right);
        const oy = Math.min(Math.max(cy, o.r.top), o.r.bottom);
        if ((cx - ox) ** 2 + (cy - oy) ** 2 < 12 * 12) {
          spaced = false;
          break;
        }
      }

      const reasons = [];
      if (inline) reasons.push('行内');
      if (uaUnstyled) reasons.push('用户代理');
      if (spaced) reasons.push('间距');
      if (reasons.length) {
        out.minTargetSkipped.exempt += 1;
        continue;
      }
      out.targetSize25x8.push({
        tag: t.el.tagName,
        size: `${w.toFixed(1)}x${h.toFixed(1)}`,
        name: label(t.el),
        cls: String(t.el.className).split(' ').filter(Boolean).slice(0, 2).join('.')
      });
    }
  }

  /*
   * 44px 那档(AAA / iOS 44pt / Android 48dp)保留,但**只在触屏上算**。
   * 以前不分档位一律报,桌面也跟着报,63 个组合 1989 条 —— 那种量级的噪声
   * 只会让人学会忽略它,所以它此前一直是"只报告"里最没人看的一项。
   */
  if (window.matchMedia('(pointer: coarse)').matches) {
    for (const el of document.querySelectorAll(
      'button, a[href], select, input:not([type=hidden]), textarea'
    )) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 2 && r.height <= 2) continue;
      if (r.width < 44 || r.height < 44) {
        out.smallTargets.push({
          text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height)
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

/*
 * 触摸端的「悬停粘住」—— 这里量的是「漏没漏 @media (hover: hover) 守卫」。
 *
 * 触摸设备没有真正的悬停能力,浏览器却会把一次点按当成 hover,松手后还不撤销:
 * 实测 390 触摸视口点一下 .mobile-nav-toggle,它的 background 从 transparent
 * 变成 oklab(...)/0.083 并一直保持到用户点别处 —— 点过的控件看起来一直是"热"的。
 *
 * 判据很直接:在 (hover: none) 的环境里用鼠标移上去,如果可见样式变了,
 * 就说明那条 :hover 规则在触摸端也会生效,也就是漏了守卫。
 * 桌面档位不跑这一项 —— 那里的 hover 本来就该生效。
 *
 * 注意必须从 Node 侧驱动鼠标:page.evaluate 里的函数跑在页面里,没法自己造 hover。
 */
const HOVER_PROPS = [
  'backgroundColor',
  'transform',
  'boxShadow',
  'borderColor',
  'color',
  'opacity',
  'filter',
  'outlineColor'
];

/*
 * 键盘焦点体检:WCAG 2.4.7(焦点可见)+ 2.2 的 2.4.11(焦点不被完全遮住)。
 *
 * 起因:主题切换器在 ≤768px 折叠成「只露当前项」,而非当前项是
 * `width: 0; opacity: 0; pointer-events: none` 却**仍在 Tab 序列里** ——
 * 键盘用户 Tab 到「深色 / 浅色」时,屏幕上什么都看不到(实测 box 0x32)。
 * 2.5.8 的尺寸检查抓不到它:元素本来就是 0 宽,那条检查会当成「不可见、跳过」。
 *
 * 判据(两步,先便宜后昂贵):
 *   1. Tab 后量当前焦点元素,肉眼不可见(宽或高 < 2px、opacity 0、visibility hidden)
 *      或完全不在视口内 → **可疑**;
 *   2. 可疑的等 320ms 再量一次(折叠展开是 width/transform 过渡,一按就量会抓到中间帧,
 *      实测 1x22 —— 那不是稳定状态),仍然不可见才算问题。
 *
 * 2.4.11 另算:焦点元素 5 个采样点(四角+中心)全被 sticky/fixed 内容盖住 =
 * 完全被遮住。用浏览器自己的命中测试判断,绘制顺序只有它知道。
 * 吸顶元素先打一遍标记,只在焦点元素与吸顶区域有交叠时才做采样。
 */
async function findFocusProblems(page, maxTabs = 60, cap = 8) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-lf-sticky]').forEach((el) => el.removeAttribute('data-lf-sticky'));
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      el.setAttribute('data-lf-sticky', '1');
    }
  });

  const probe = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { skip: 'no-focus' };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const desc = `${el.tagName.toLowerCase()}${
        typeof el.className === 'string' && el.className
          ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.')
          : ''
      }`;
      const base = {
        sel: desc,
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        top: Math.round(r.top)
      };

      const invisible =
        r.width < 2 || r.height < 2 || cs.opacity === '0' || cs.visibility === 'hidden';
      const offscreen =
        r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
      if (!invisible && !offscreen) {
        // 不便宜就别做命中测试:先看焦点元素跟吸顶区域有没有交叠
        const stickies = [...document.querySelectorAll('[data-lf-sticky]')];
        const overlaps = stickies.some((s) => {
          if (s.contains(el)) return false;
          const sr = s.getBoundingClientRect();
          return !(r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom);
        });
        if (!overlaps) return { ...base, ok: true };

        const pts = [
          [r.left + 3, r.top + 3],
          [r.right - 3, r.top + 3],
          [r.left + 3, r.bottom - 3],
          [r.right - 3, r.bottom - 3],
          [r.left + r.width / 2, r.top + r.height / 2]
        ];
        const coverers = new Set();
        for (const [x, y] of pts) {
          if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
            coverers.add('(视口外采样点)');
            continue;
          }
          const top = document.elementsFromPoint(x, y)[0];
          if (!top || top === el || el.contains(top) || top.contains(el)) continue;
          const root = top.closest('[data-lf-sticky]');
          if (root && !root.contains(el)) {
            coverers.add(
              `${root.tagName.toLowerCase()}.${
                typeof root.className === 'string' ? root.className.split(' ').filter(Boolean)[0] : ''
              }`
            );
          }
        }
        if (coverers.size === pts.length) {
          return { ...base, ok: false, kind: 'obscured', detail: `被 ${[...coverers].join(', ')} 完全盖住` };
        }
        return { ...base, ok: true };
      }

      return {
        ...base,
        ok: false,
        kind: invisible ? 'invisible' : 'offscreen',
        detail: invisible
          ? `宽${Math.round(r.width)} 高${Math.round(r.height)} opacity=${cs.opacity} visibility=${cs.visibility}`
          : `box 在视口外(top=${Math.round(r.top)}, bottom=${Math.round(r.bottom)})`,
        opacity: cs.opacity,
        visibility: cs.visibility
      };
    });

  const out = [];
  await page.evaluate(() => document.body.focus());

  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');
    const first = await probe();
    if (first.skip || first.ok) continue;

    // 可疑 → 等过渡落定再确认一次,避免把动画中间帧当成缺陷
    await page.waitForTimeout(320);
    const second = await probe();
    if (second.skip || second.ok) continue;
    if (second.sel !== first.sel) continue; // 焦点已经跑到别处,这一帧不算

    out.push({ tab: i + 1, ...second });
    if (out.length >= cap) break;
  }
  return out;
}

/*
 * 「写了却一个字都不管用」的窄屏规则。
 *
 * 起因:今日财务看板在 ≤720px 想让摘要整行落到数值下面,写的是
 * `grid-column: 1 / -1`,而父级 `.stat-card` 是 `display: flex` ——
 * grid item 专属属性在 flex 父级里完全不生效,浏览器不报错、computed style
 * 照样回显指定值,所以它活了很久没人发现(720px 三列被压到 48px)。
 * 欢迎横幅上还有一处同类写法(`justify-self`,父级同样 flex)。
 *
 * 判据(必须三样同时成立才算问题):
 *   1. 声明位于某个 @media 里,且该条件在当前视口下 matchMedia().matches;
 *   2. 选择器命中真实元素、该元素有自己的盒子(排除 display:none/contents);
 *   3. 元素的**父级** computed display 是 flex/inline-flex ——
 *      grid 专属声明没有任何作用,规则等于没写。
 *
 * 只在 @media 里找:基础样式里的同类写法在静态检查(check:*)之外,
 * 且历史上出问题的都是窄屏覆盖块。
 */
async function findInertGridRules(page, cap = 8) {
  return page.evaluate((max) => {
    const GRID_ONLY =
      /^(grid-column|grid-row|grid-area|grid-column-start|grid-column-end|grid-row-start|grid-row-end|justify-self)$/;
    const hits = [];
    const seen = new Set();

    const inspect = (rule, mediaText) => {
      const props = [];
      for (let i = 0; i < rule.style.length; i += 1) {
        const prop = rule.style[i];
        if (GRID_ONLY.test(prop)) props.push(prop);
      }
      if (!props.length) return;

      let els;
      try {
        els = document.querySelectorAll(rule.selectorText);
      } catch {
        return;
      }
      for (const el of els) {
        const parent = el.parentElement;
        if (!parent) continue;
        const self = getComputedStyle(el);
        if (self.display === 'none' || self.display === 'contents') continue;
        const pd = getComputedStyle(parent).display;
        if (pd !== 'flex' && pd !== 'inline-flex') continue;

        const parentCls = typeof parent.className === 'string' ? parent.className : '';
        const key = `${rule.selectorText}|${parent.tagName}.${parentCls}|${props.join()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = el.getBoundingClientRect();
        hits.push({
          selector: rule.selectorText.replace(/\s+/g, ' ').slice(0, 90),
          props,
          media: mediaText,
          parent: `${parent.tagName.toLowerCase()}.${parentCls.split(' ').filter(Boolean).slice(0, 2).join('.')}`,
          parentDisplay: pd,
          box: `${Math.round(r.width)}x${Math.round(r.height)}`
        });
        if (hits.length >= max) return;
      }
    };

    const walk = (list, mediaText) => {
      for (const rule of list) {
        // CSSMediaRule 才有 media;嵌套 @media 逐层带下来
        if (rule.media) {
          walk(rule.cssRules, mediaText ? `${mediaText} and ${rule.media.mediaText}` : rule.media.mediaText);
          continue;
        }
        if (!mediaText || !rule.selectorText || !rule.style) continue;
        if (!window.matchMedia(mediaText).matches) continue;
        inspect(rule, mediaText);
        if (hits.length >= max) return;
      }
    };

    for (const sheet of document.styleSheets) {
      let rules;
      // 跨域样式表读 cssRules 会抛;跳过而不是让整页审计挂掉
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      walk(rules, '');
      if (hits.length >= max) break;
    }
    return hits;
  }, cap);
}

/*
 * 折叠起来的内容,上面那个检查是看不见的。
 *
 * 时间轴的刻度就是这种情况:默认折叠,不点开那 7 个 `<span>` 根本不在 DOM 里,
 * 于是「叠字」这个缺陷在 69 个组合里**一次都不会被报出来** —— 这和 focusWalk
 * 第一版只跑桌面档是同一类错误(写了一检查,却抓不到它要抓的东西)。
 *
 * 所以:量到没问题时,把页面上「展开」类的开关点开再量一遍。
 * 限制在 main 里、名字像展开、最多 3 个 —— 开别的东西(模态、菜单)可能引入
 * 与本次检查无关的假阳性,而这些开关点开只是把更多内容渲染出来。
 */
async function expandDisclosures(page, max = 3) {
  const buttons = page.locator('main button[aria-expanded="false"]');
  const count = Math.min(await buttons.count(), max);
  let opened = 0;
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const name = ((await button.getAttribute('aria-label')) || (await button.innerText()) || '').trim();
    if (!/展开|更多|显示|show|expand|more/i.test(name)) continue;
    await button.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(350);
    opened += 1;
  }
  return opened;
}

/*
 * 绝对定位的文字标签互相压住。
 *
 * 起因:全球市场时间轴的 24 小时刻度是 7 个 `position: absolute` + `translateX(-50%)`
 * 的 `<span>`,视口窄到 375px 时首尾两个就已经贴住(-0.5px),320px 时压掉 6.7px:
 * 「00:00」的尾数被「04:00」盖住,读出来是错的数。单元测试碰不到 —— 标签是绝对定位,
 * 有没有叠在一起只有渲染完才知道。
 *
 * 判据刻意收得很紧,避免把「故意叠」的设计(头像角标、未读小红点)算进来:
 *   1. 元素是 absolute/fixed,自己**直接**写了文字(包裹层不算),文字 ≤ 24 字;
 *   2. 同一个父级下两个这样的元素,包围盒在 x 与 y 上**都**重叠 > 1px;
 *   3. 两者都不是 `visibility: hidden` / `opacity: 0`(那是刻意藏起来的)。
 * 小红点、角标里通常没有文字(或只有一个字),而且父级不同,不会命中。
 */
async function findOverlappingLabels(page, cap = 8) {
  return page.evaluate((max) => {
    const byParent = new Map();
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      if (!ownText) continue;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 24) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight * 3) continue;
      const parent = el.parentElement;
      if (!parent) continue;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push({ text, r });
    }

    const hits = [];
    for (const [parent, list] of byParent) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i].r;
          const b = list[j].r;
          const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (dx <= 1 || dy <= 1) continue;
          const pCls = typeof parent.className === 'string' ? parent.className : '';
          hits.push({
            parent: `${parent.tagName.toLowerCase()}.${pCls.split(' ').filter(Boolean).slice(0, 2).join('.')}`,
            a: list[i].text.slice(0, 16),
            b: list[j].text.slice(0, 16),
            overlap: `${dx.toFixed(1)}x${dy.toFixed(1)}px`
          });
          if (hits.length >= max) return hits;
        }
      }
    }
    return hits;
  }, cap);
}

async function findTouchHoverReactive(page, cap = 10) {  const cands = await page.evaluate(
    ({ max, props }) => {
      const SEL =
        'button, a[href], [role="button"], li, tr, [class*="card"], [class*="btn"], [class*="item"], [class*="row"]';
      const els = [];
      for (const el of document.querySelectorAll(SEL)) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 16) continue;
        if (r.bottom < 0 || r.top > window.innerHeight * 3) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        els.push(el);
        if (els.length >= max) break;
      }
      // 存下来,后面按索引读同一个元素的前后样式
      window.__hoverProbe = els;
      window.__hoverProps = props;
      return els.map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          i,
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '')
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .join('.')
        };
      });
    },
    { max: cap, props: HOVER_PROPS }
  );

  if (!cands.length) return [];

  const sig = (i) =>
    page.evaluate((idx) => {
      const el = window.__hoverProbe[idx];
      if (!el) return null;
      const cs = getComputedStyle(el);
      const o = {};
      for (const p of window.__hoverProps) o[p] = cs[p];
      return o;
    }, i);

  await page.mouse.move(1, 1);
  await page.waitForTimeout(120);
  const pre = {};
  for (const c of cands) pre[c.i] = await sig(c.i);

  const hits = [];
  for (const c of cands) {
    await page.mouse.move(c.x, c.y);
    await page.waitForTimeout(120);
    const post = await sig(c.i);
    if (pre[c.i] && post) {
      const changed = HOVER_PROPS.filter((p) => pre[c.i][p] !== post[p]);
      if (changed.length) {
        hits.push({
          el: `${c.tag}.${c.cls}`.replace(/\.$/, ''),
          changed,
          before: Object.fromEntries(changed.map((p) => [p, pre[c.i][p]])),
          onHover: Object.fromEntries(changed.map((p) => [p, post[p]]))
        });
      }
    }
    await page.mouse.move(1, 1);
    await page.waitForTimeout(40);
  }
  return hits;
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
const longPlaceholderFindings = [];
const touchHoverFindings = [];
const inertGridFindings = [];
const focusWalkFindings = [];
const overlapFindings = [];
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

    /*
     * 悬停探测放在这里(算完 newErrors 之后):移鼠标可能顺手触发一些
     * 懒加载 / tooltip,那些报错不该算到这条路由头上。
     * 只跑触摸档位 —— 桌面档的悬停本来就该生效。
     */
    const hoverHits = narrow ? await findTouchHoverReactive(page) : [];
    if (hoverHits.length) {
      touchHoverFindings.push({ viewport: label, route, items: hoverHits });
    }

    /*
     * 「窄屏规则写了却不生效」—— 与悬停探测同理,放在算完 newErrors 之后。
     * 这条不区分触屏/桌面:flex 父级里写 grid-column,两种设备一样无效。
     */
    const inertHits = await findInertGridRules(page);
    if (inertHits.length) {
      inertGridFindings.push({ viewport: label, route, items: inertHits });
    }

    /*
     * 键盘走一遍。三档视口都跑 —— 第一版只在桌面档跑,结果它**抓不到**自己刚修的
     * 那个 bug:主题切换器的折叠例外是写在 @media (max-width: 768px) 里的,
     * 只在窄档复现。「触屏没有 Tab 键」这个理由也不成立:窄视口不等于触屏,
     * 而且外接键盘、开关控制、读屏器的虚拟光标都会产生真实焦点。
     * 每条路由 60 次 Tab 实测约 130~190ms(可疑项才多等 320ms 落定),
     * 69 个组合大约十几秒,可以接受。
     */
    const focusHits = await findFocusProblems(page);
    if (focusHits.length) {
      focusWalkFindings.push({ viewport: label, route, items: focusHits });
    }

    /*
     * 绝对定位的文字互相压住。先量折叠态,干净的话把「展开」类开关点开再量一遍
     * —— 时间轴刻度只在展开后才存在(见 expandDisclosures 的说明)。
     */
    let overlapHits = await findOverlappingLabels(page);
    if (!overlapHits.length) {
      const opened = await expandDisclosures(page);
      if (opened) overlapHits = await findOverlappingLabels(page);
    }
    if (overlapHits.length) {
      overlapFindings.push({ viewport: label, route, items: overlapHits });
    }

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
      audit.coarseControlFont.length ||
      // 格子里的字画到隔壁格子上:两组字叠在一起,读不了,直接致败
      audit.cellOverflow.length ||
      // WCAG 2.5.8(AA):可点区域小于 24×24 且不命中任何豁免
      audit.targetSize25x8.length ||
      // 触摸端「悬停粘住」:漏了 @media (hover: hover) 守卫,点过的控件一直亮着
      hoverHits.length ||
      // 窄屏覆盖写了 grid 专属属性、父级却是 flex:这条声明等于没写
      inertHits.length ||
      // 键盘焦点落到看不见的地方(2.4.7)/ 被吸顶内容完全盖住(2.4.11)
      focusHits.length ||
      // 绝对定位的文字标签互相压住:字读出来是错的(时间轴刻度、坐标轴标签)
      overlapHits.length
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
        cellOverflow: audit.cellOverflow,
        targetSize25x8: audit.targetSize25x8,
        touchHoverReactive: hoverHits,
        inertGridRules: inertHits,
        focusWalk: focusHits,
        overlappingLabels: overlapHits,
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
    // 只报告、不致败的项
    if (audit.longPlaceholders.length) {
      longPlaceholderFindings.push({
        viewport: label,
        route,
        items: audit.longPlaceholders
      });
    }

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
  note: '字号 < 11px(tinyText)、触控目标 < 44px(smallTargets,只在触屏档位算)、placeholder 显示不全(longPlaceholders)只报告、不计入 problemCount —— 44px 是 AAA/平台指南线而不是 AA(2.5.8 只要求 24×24,那一项另算且致败),字号与 placeholder 是设计取舍/不违反 WCAG 条款。touchHoverReactive(触摸端悬停粘住)、inertGridRules(@media 里写了 grid 专属属性但父级是 flex,声明等于没写)、focusWalk(键盘焦点不可见 2.4.7 / 被吸顶内容完全遮住 2.4.11,每条路由最多走 60 次 Tab)、overlappingLabels(绝对定位的文字标签互相压住 —— 先量折叠态,干净就点开「展开」类开关再量一遍)是致败项',
  problems,
  tinyText: tinyTextFindings,
  smallTargets: smallTargetFindings,
  longPlaceholders: longPlaceholderFindings,
  touchHoverReactive: touchHoverFindings,
  inertGridRules: inertGridFindings,
  focusWalk: focusWalkFindings,
  overlappingLabels: overlapFindings,
  documentTitles: summarizeTitles(documentTitles)
};
console.log(JSON.stringify(report, null, 2));
process.exit(problems.length ? 1 : 0);
