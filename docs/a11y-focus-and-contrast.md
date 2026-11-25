# 焦点、对比度与页面结构(a11y 现状与复测方法)

这份文档记录容易被忽略、但直接影响「能不能用」的几件事:**键盘焦点看不看得见**、
**文字/图标够不够清楚**、**页面结构机器读不读得懂**。每处都附了复测方法,改动后可以重新量一遍。

## 1. 焦点可见性

### 问题

除了少数组件自定义了 `:focus-visible`,**绝大多数可聚焦元素回退到浏览器默认的
`outline: auto` 1px 深色描边** —— 在深色主题上对比度只有 1.0–1.3:1,键盘用户看不出焦点在哪。
实测(按 Tab 逐个检查 22 个焦点位置):

| 路由 | 仍用浏览器默认焦点环(改前) |
| --- | --- |
| 交易流水 | 18 / 22 |
| 首页 | 16 / 22 |
| 还款管理 | 17 / 22 |

### 改法

`global.css` 的 Reset 区加一条全局规则:

```css
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

组件自带的 `.x:focus-visible`(选择器更具体)仍然优先,不会破坏既有设计。
改后上面三条路由的「浏览器默认焦点环」计数全部为 **0**,焦点环是 2px 琥珀色、
带 2px 偏移,在深色底上约 8:1。

### 复测

用键盘 Tab 走一遍,读 `getComputedStyle(document.activeElement).outlineStyle/outlineWidth`;
`outlineStyle === 'auto'` 就说明还在吃浏览器默认样式。

## 2. 对比度(含一处品牌决策)

### 已修:主按钮

所有主按钮原本是「白字 + 琥珀底」。按 WCAG 公式计算,白色在 `#f59e0b` 上只有 **2.15:1**,
AA 要求 4.5:1。其它强调色同样不合格。

改法:新增 token `--color-on-primary`,按每个强调色算最优组合:

| 强调色 | 主色 | 文字色 | 对比度 |
| --- | --- | --- | --- |
| amber | `#f59e0b` | `#1c1917` | 8.14 |
| emerald | `#10b981` | `#1c1917` | 6.89 |
| rose | `#f43f5e` | `#1c1917` | 4.76 |
| violet | `#7c3aed`(压深一档) | `#ffffff` | 5.70 |

violet `#8b5cf6` 白字 4.23 / 黑字 4.13,两头都不合格,所以压深主色一档。

**这是一处肉眼可见的品牌改动**(主按钮由白字变近黑字)。回滚方式:把各强调色块里的
`--color-on-primary` 改回 `#ffffff`,对比度会退回不合格。

### 复测方法与已知误差

逐元素算 `color` 与最近不透明祖先背景的 WCAG 对比度。两个**测量陷阱**:

1. SVG 的 `fill` 不是 `color`,直接读 `color` 会得到假失败(首页趋势图标签曾因此误报)。
2. 给元素自身背景做判断时,若元素是「琥珀底 + 琥珀焦点环」,`outline-offset` 让焦点环画在
   父级背景上 —— 数值上看起来是 1.04:1,实际是琥珀环落在深色底上,肉眼很清楚。

首页目前仍报 4 条,经截图核对是第 2 类误差,不是真问题。

## 3. 其它已经做过、别重复做的

- 弹层焦点管理(打开收进、Tab 循环、关闭归还):`useDialogFocus`
- 行内菜单方向键(`role="menu"`):`useMenuKeyboard`
- 表单标签覆盖:13 个路由 + 两个弹层实测**全部有可访问名称**,无需修
- 异步错误/状态播报:`docs/a11y-live-regions.md`

## 4. 页面结构:跳转链接、文档标题、标题层级(2026-11 修好)

这三条都是 Level A / AA 的硬要求,而且都不能靠「看起来对」判断,只能实测。

### 4.1 跳转链接(WCAG 2.4.1,Level A)

侧边导航有几十个链接,键盘/读屏用户每换一页都得 Tab 穿过整条导航才能到正文。
`AppLayout` 首位现在有一个 `.skip-to-content`,目标是 `<main id="main-content" tabIndex={-1}>`。

两个容易做错的地方:

- **只加 `id` 不够**。焦点不会跟着锚点跑,回车后 Tab 仍然从导航继续走,所以要
  `tabIndex={-1}`(不进入 Tab 序列,但可由脚本/锚点聚焦)。
- **必须真的可见**。清单明确写「聚焦时必须可见」,所以 `.skip-to-content` 平时
  1×1 裁切,`:focus` 时恢复成正常尺寸。写成 `display:none` 或永远 `opacity:0`
  等于没有 —— 屏幕阅读器拿得到,键盘用户看不到。

实测:22 条路由 22/22 存在;未聚焦时 1×1,聚焦后 102×42、背景 `#f59e0b`。

### 4.2 文档标题(WCAG 2.4.2,Level A)

此前**所有路由共用一个 `document.title`**(只在 i18n 初始化时写一次),浏览器标签页、
历史记录、书签里完全分不出页面。

现在唯一写入方是 `src/shared/lib/documentTitle.ts` 的 `useDocumentTitle(pathname)`,
它是一张「路由 → 标题 key」的表 + 兜底。i18n 里原来的 `applyDocumentTitle` 已删除:
留着就是第二个写入方,切语言时两边会打架。

踩过的坑:`/transactions` 与 `/transactions/new` 前缀重叠,最早那版把尾斜杠归一化后
`/transactions` 命中了「编辑流水」。现在用显式 `exactKey` / `exactFallback` 区分,
并有单测钉住(`documentTitle.test.ts`,9 条)。

实测:22 条路由标题两两不同,且随语言切换跟随。

### 4.3 标题层级(WCAG 2.4.6,AA)

**根因是两个「条件性 h1」**:侧栏品牌名写成 `<h1>` 但只在侧栏折叠时渲染,而真正的
页面标题(`currentWorkspaceTitle`)渲染成了 `<div>`。结果侧栏展开时全站 `h1` 数量为 0,
折叠时又变成两个。

现在的约定是**顶栏标题就是页面唯一的 `<h1>`**,正文各区块从 `h2` 起:

- `AppLayout`:顶栏标题改成 `<h1>`;品牌名改成 `<span class="topbar-brand-name">`
  (品牌名不是标题)。样式在 `global.css` 用 `.workspace-topbar .workspace-topbar-title h1`
  拉回继承值 —— 不这么做会被原来那条给品牌名写的 17px 规则顶掉,顶栏标题会突然变大。
- 8 个页面(账户与分类 / 智能预算 / 投资理财 / 帮助 / 关于 / 数据与备份 / 还款管理 /
  工资工具)正文里原来也渲染 `<h1>`,与顶栏同名,现在降为 `<h2>`。
  **降级必须同步改 CSS**:这些页面的样式是 `.xxx-header h2` 这种「类名 + 标签」复合
  选择器,只改 JSX 会丢样式。
- 除首页外还有 3 处跳级:订阅概览的统计标题 `h4`→`h3`、智能预算分类卡 `h4`→`h3`、
  AI 助手「请先配置 API 密钥」`h3`→`h2`。

同一轮还发现 **404 页在 `AppLayout` 的 `<main>` 里又套了一个 `<main>`**(HTML 规范不允许
嵌套,地标重复):`RouteErrorView` 加了 `insideLayout`,站内 404 用 `<div>` + `<h2>`,
根级错误边界(整页接管、没有外层布局)仍是 `<main>` + `<h1>`。

### 4.4 怎么复测

`scripts/audit-ui-browser.mjs` 已把这些做成断言(`h1Count`、`headingSkip`、`skipLink`、
`mainLandmark`、`duplicateIds`、`missingAlt`、`buttonsWithoutType`、`positiveTabindex`、
`autofocus`),任一不合就致败。注意 `mainLandmark !== 1` 同时能抓到「没有 main」和
「嵌套 main」两种。

本机跑不起来时(Playwright 浏览器版本不匹配,见 `docs/HANDOVER.md`)用 MCP 浏览器按
同样口径量:逐路由读 `document.querySelectorAll('main').length`、可见标题序列、
`h1` 数量、`a[href="#main-content"]`。

当前结果:**21 条路由全部通过** —— 每条 1 个 `h1`、无跳级、恰好 1 个 `main` 且不嵌套、
有跳转链接、`#main-content` 存在、无重复 id、文档标题唯一。

## 5. 交易表格:整行详情必须能用键盘打开(WCAG 2.1.1,Level A)

### 问题

交易列表的行是「点开详情」的唯一入口,但它是 `tabIndex={-1}`,行内又没有按钮或链接。
实测:8 行交易、行内 0 个按钮,连按 40 次 Tab 都碰不到任何一行。也就是说
**纯键盘用户根本打不开交易详情**。移动端不受影响,那一侧每项都有「更多操作」按钮。

### 改法

没有把每行都设成 `tabIndex={0}` —— 几十行全进 Tab 链会让键盘用户寸步难行。
改成 **roving tabindex**:整张表只占一个 Tab 停靠点(默认第一行),`↓`/`↑` 在行之间移动,
`Enter`/空格 打开详情。

实现要点:`tabIndex` 由 `(rovingRowId ?? rows[0]?.item.id) === item.id ? 0 : -1` 决定,
`onFocus` 记住当前位置,`onKeyDown` 里用 `parentElement.querySelectorAll` 找同表行并按偏移
聚焦。注意 `rows[0]` 是行视图对象,交易 id 在 `rows[0].item.id` 上(写成 `rows[0].id`
过不了类型检查)。

### 复测

`TransactionTable.test.tsx` 末尾两条测试钉住:只有一行是 `tabindex=0`、`↓` 会换行并跟随、
`Enter` 与空格都会带着正确 id 调用 `onOpenDetail`。

**这两条做过破坏性验证**:把 `tabIndex` 改回 `-1`,第一条立刻失败
(`expected '-1' to be '0'`),恢复后全过 —— 不是那种「怎么写都绿」的测试。

## 6. 拖拽类操作必须有非拖拽入口(WCAG 2.5.7,Level AA)

### 侧栏宽度

侧栏宽度原来只能拖,键盘和只用单指的人改不了。按 **ARIA Window Splitter** 模式补了等价入口:

- 手柄 `role="separator"` + `aria-orientation="vertical"` + `aria-valuenow/min/max`;
- `tabIndex={0}`,←/→ 调宽(16px,按住 Shift 48px),Home/End 到最窄/最宽;
- 拖拽照旧可用,这只是多了一条不依赖拖拽的路。

实测:260 → 276 → 292,End→420,Home→220,侧栏实际宽度同步,焦点环 2px 可见。

### 交易页分栏 —— 顺带查出一个既存 bug

分栏分隔条本来就有 `role="separator"` 和 `aria-label`,但**没有 `tabIndex`、没有键盘处理、
没有 `aria-value*`** —— 等于「告诉读屏这是个分隔条,却动不了」。补的方式同上。

补的过程中发现更严重的问题:**这个分隔条在常见窗口宽度下连拖拽都是失效的**。
根因是判定「要不要上下堆叠」用了两把不同的尺子:

- CSS 按**视口**宽度切:`@media (max-width: 1100px)` 里改成单列并把分隔条 `display:none`;
- JS 按**容器**宽度算:`total <= 1100`。

视口 1440 时容器正好 1084,于是 CSS 照常显示分隔条和 `col-resize` 光标,
JS 却认为「已堆叠」把调整逻辑整个关掉。实测:拖之前 `mainW` 720,拖完还是 720。

修法是两边统一按视口媒体查询判断,容器宽度只用来算宽度上限(`total - 320`),
并额外监听媒体查询变化(容器没变、只有视口跨过 1100 时 `ResizeObserver` 不一定触发)。

实测三种情况:宽视口拖拽 860→817(修复前纹丝不动)、键盘 ←/→/Home 生效、
窄视口 900 时分隔条 `display:none` 且恢复宽视口后上限重算为 764。

### 还没做的

其余拖拽入口(详情抽屉拉伸、表格列宽/列序、汇率分栏、AI 浮窗)目前仍只有拖拽。
它们的取舍和上面两个不同(列宽这类精确值很难用「一次点击」替代),需要单独评估后再动,
不要为了「消掉一条检查项」塞进没想清楚的按钮。