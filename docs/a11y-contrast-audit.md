# 对比度审计(WCAG 1.4.3 AA)与「未定义 token」

> 2026-11-27。首次系统扫描正文对比度,并且第一次把**深色主题**纳入测量。
> 配套改动:`src/app/styles/tokens.css`、`src/app/styles/pages.css`、新增 `scripts/audit-contrast.mjs`。

## 1. 此前为什么没发现

- 只逐个核对过 `--color-border-control`(WCAG **1.4.11 非文本对比度**),没有扫过正文;
- 界面审计只跑默认主题,**深色主题的对比度从来没量过**;
- 单看浅色主题时,有一处缺陷「看起来是对的」—— 详见下面第 3 节。

## 2. 方法

两套主题(light / dark)× 21 条静态路由,共 **5526 个文字节点**。

| 项目   | 做法                                                             |
| ------ | ---------------------------------------------------------------- |
| 背景色 | 逐级向上取最近的不透明祖先背景;半透明背景按 alpha 逐层合成       |
| 阈值   | 普通文字 4.5:1;大号文字(≥24px,或 ≥18.66px 且 bold)3:1            |
| 跳过   | 渐变/图片上的文字、`opacity < 1` 的祖先、视觉隐藏文字(共 215 个) |

两个必须绕开的**测量陷阱**(第一个是 `docs/a11y-focus-and-contrast.md` §2 已经记过的):

1. **SVG 的 `<text>` 用 `fill` 而不是 `color`。** 直接读 `color` 会得到假失败。
2. **1px 视觉隐藏文字必须排除。** `.skip-to-content` 是 `position: fixed` 的 1px 隐藏链接,
   只按 `position: absolute` 过滤会漏掉它 —— 结果在**全部 21 条路由**上各报一次
   「`rgb(0, 0, 238)` on 深色底」。那是浏览器默认链接蓝,不是真实可见的文字。
   第一版扫描就是被这个坑到:误报 42 条路由,收敛后才 26 条。

## 3. 修好的第一处:`--color-text-tertiary`(最大的一处)

`#9aa0a6` 对白底只有 **2.64:1**,对 `#f3f5f9` 是 2.42:1,对侧栏底 `#eef1f6` 只有 **2.33:1**。

它是全站最大的单一对比度问题:实测 **267 处、覆盖 21 条路由**,而且大量用在 **9–11px**
的小字上 —— 小字配低对比度是最糟的组合。

改法:`#9aa0a6` → `#5b6878`。取值按**最严的那个背景**算:

| 背景            | 对比度 |
| --------------- | ------ |
| `#eef1f6`(侧栏) | 5.01   |
| 白底            | 5.68   |
| `#e1e7f1`(激活) | 4.57   |

改回 `#9aa0a6` 即可回退,代价是这 21 条路由重新不合格。

## 4. 修好的第二处:一个**从未定义过**的 token

财务分析页「近30天」这个分段控件的选中态:

```css
.financial-analysis-range-switcher button.active {
  background: var(--color-primary);
  color: var(--color-btn-primary-text); /* 这个 token 全仓库从未定义 */
}
```

`--color-btn-primary-text` 在整个仓库**只出现这一次**,没有任何定义处。自定义属性未定义时,
`var()` 在计算值阶段失效、该声明作废;而 `color` 是**继承属性**,于是这里直接继承了外层文字色:

| 主题 | 继承到的颜色    | 对琥珀底 `#f59e0b` 的对比度 |
| ---- | --------------- | --------------------------- |
| 浅色 | `#1a1d23`(近黑) | 7.87:1 —— 看起来是「对的」  |
| 深色 | `#f0eeea`(近白) | **1.85:1** —— 实测被抓出来  |

这就是为什么**只扫浅色主题永远发现不了它**。改用仓库既有的 `--color-on-primary`
(`#1c1917`,两种主题都定义),两种主题下都是 **8.14:1**。

## 5. 结果

| 阶段                                            | 不达标路由 | 不达标实例 |
| ----------------------------------------------- | ---------- | ---------- |
| 最初                                            | 25         | 510        |
| 修 `--color-text-tertiary` + 未定义 token       | 25         | 212        |
| **补上 `*-text` 变体并替换调用点(本轮)** | **0**      | **0**      |

最后一行是 `node scripts/audit-contrast.mjs` 跑 **25 条路由 × 浅色/深色两套主题**
的结果:共检查 5678 个文字节点,另有 196 个因压在渐变/透明上跳过、
3444 个因是装饰性 `aria-hidden` 文字跳过。

> ⚠️ 中间那些数字是各自时间窗内的测量值。`/investments` 带实时行情,**跨时间比总量会漂移**,
> 所以任何一次具体数字都只能和自己同一时间窗的对照比 —— 详见 §7.4 的踩坑记录。

## 6. 本轮修复:新增「文字专用」色

剩下的一批全是「语义色被当作文字颜色用」。原计划里那句「涉及约 592 条 CSS 规则」是**估错了**:
把 `background-color` / `border-color` / `outline-color` / `accent-color` 之类排除掉之后,
真正需要改的 `color:` 声明是 **518 条**(见 §6.3 是怎么精确数出来的)。

改法沿用 `--color-on-primary` 的先例,只有一条规矩:

> 凡是 `color:` 里用语义色的地方换成 `*-text` 变体;
> `background` / `border-color` / `fill` / `stroke` / `accent-color` **一律不动**。

所以按钮底色、图表色块、徽标底色仍然是原来的品牌色,只有文字变深。

### 6.1 取值(以及对哪些底色验证过)

重点是**不能只拿白底验**。实际界面里文字会落在好几种底色上,这一轮量到最严的是
`#d9dfeb`(余额变动页的浅蓝底),它比页面底 `#f3f5f9` 更挑。取值对
`#ffffff` / `#f3f5f9` / `#eef1f6` / `#e8edf5` / `#d9dfeb` / 各种暖色药丸底都算过:

| token                    | 文字用取值 | 白底 | 页面底 | 最严的 `#d9dfeb` |
| ------------------------ | ---------- | ---- | ------ | ---------------- |
| `--color-primary-text`(amber) | `#8a4a00` | 6.86 | 6.29 | 5.13 |
| `--color-success-text` / `--color-income-text` | `#12603c` | 7.60 | 6.96 | 5.68 |
| `--color-warning-text`   | `#7d4700` | 6.86 | 6.29 | 5.66 |
| `--color-danger-text` / `--color-expense-text` | `#b3261e` | 6.54 | 5.99 | 4.89 |
| `--color-primary-text`(emerald) | `#0f6b47` | 6.53 | 5.99 | 4.89 |
| `--color-primary-text`(rose) | `#be123c` | 6.29 | 5.76 | 4.70 |
| `--color-primary-text`(violet / aurora) | `#6d28d9` | 7.28 | 6.67 | 5.31 |

两处是**在测量中被推翻并改掉**的,记在这里免得以后又改回去:

- `--color-success-text` 一开始取 `#157347`,白底 5.87 看着很稳,但对 `#d9dfeb` 只有 **4.39——仍然不达标**。
- violet/aurora 原来打算不动(白底 5.70 已过线),但对 `#d9dfeb` 掉到 **4.26**。
  所以「五套主题里只有 violet 过线」这个结论**只在白底成立**,改成 `#6d28d9` 后最差 5.31。

### 6.2 顺带修掉的第二个 bug:暗色主题根本没生效

这一轮真正的坑不在配色,在**优先级**:

```
[data-theme='dark']       { --color-primary-text: var(--color-primary); }  ← 第 471 行
[data-accent-theme='amber'] { --color-primary-text: #8a4a00; }             ← 第 624 行
```

两者特异性都是 **0-1-0**,而 accent 那几块写在后面 —— 同特异性下**后者赢**。
于是暗色 + amber 主题时,`--color-primary-text` 拿到的是给浅底用的 `#8a4a00`,
压在 `#141414` 上只有 **2.68:1**。实测确认(不是推断):`data-theme=dark` 时
`getComputedStyle(html).getPropertyValue('--color-primary-text')` 返回 `#8a4a00`。

修法不是换位置(那会让另一个方向坏掉),而是把暗色 × 主题色的组合**显式写出来**,
放在文件最后并提高特异性:

```css
[data-theme='dark'][data-accent-theme='emerald'] { --color-primary: #34d399; ... }
```

顺带发现同一个优先级问题让 `violet`/`aurora` 主题在暗色下把 `--color-primary`
钉在 `#7c3aed`(`#1a1a1a` 上只有 3.05:1),所以这几块也一并给了暗色取值。

### 6.3 怎么保证替换没有误伤

改 518 处不能靠肉眼。做法是**先干跑、再机械校验**:

1. 只匹配**裸 `color:` 声明** —— 正则里 `color:` 前面只能是行首或空白,
   所以 `background-color:` / `border-color:` / `-webkit-text-fill-color:` 碰不到;
2. 干跑时逐条断言「匹配位置前面的那个字符」必须是行首/空白/`;`/`{`,不是的话报出来(结果 0 条);
3. 写回后用 `git diff --word-diff` 逐词校验:**510 + 8 = 518 个词块,增减相等,
   且删掉的每一个都是 `var(--color-X)`、新增的每一个都是 `var(--color-X-text)`,没有一个例外**。

第 3 步是有必要的:第一次只改了不带 fallback 的写法,漏掉了
`color: var(--color-warning, #d99917)` 这类带兜底值的(13 处),
以及 `var(--color-primary-strong, var(--color-primary))` —— 那个 `--color-primary-strong`
**从来没有被定义过**,所以它其实一直在走兜底值。

还有一个**不是**配色、而是「用错 token」的例子:`.chat-mode-welcome-eyebrow span`
把正文借用了 `--color-text-placeholder`。那个 token 是给输入框里会被覆盖掉的
浅灰占位文字用的(WCAG 1.4.3 的 "incidental" 例外),当正文色只有 1.89:1。
这里改的是**调用点**(换成 `--color-text-tertiary`),没有去动 placeholder 本身的取值 ——
把共享 token 调到正文标准会让所有输入框的占位文字变得几乎和正文一样黑。

### 6.4 验证与「破坏性验证」

结论不能只看「修完是 0」。因为这台机器上的审计脚本**先前出过静默失效**
(登录步骤没等 React 挂载,21 条路由其实全在量登录页),所以照旧做了破坏性验证:

**把 `*-text` 的取值改回原来的亮色,重跑审计 —— 21 条路由重新不达标;改回来又是 0。**
证明这个 0 是真的测出来的,不是脚本坏了或者没跑到。

同时人工看了浅色/深色两套主题下的首页、交易流水、智能预算截图,
确认新配色是「更沉稳」而不是「发脏」:侧栏选中项是暖棕、金额红/绿一眼能分清、
状态徽标仍然按语义着色。

## 7. 自定义属性被引用但**从未定义**(已从 29 个 / 319 处降到 13 个 / 31 处)

静态统计(去掉注释后的真实引用):`src/` 里 **192 个**自定义属性有定义,
另有 **13 个**被 `var()` 引用(且没写 fallback)却**没有任何定义处**,合计 **31 处**。

剩下的 13 个里有 18 处是**运行时逐条注入**的(`--market-color` / `--brand-color` /
`--calendar-intensity`),那是设计如此、不是缺陷。真正待定的只剩 13 处零星引用。

| token                    | 被引用 | 状态                            |
| ------------------------ | ------ | ------------------------------- |
| `--market-color`         | 12     | ⏸ 运行时逐条设置(正常)         |
| `--color-accent`         | 4      | ⏸ 目标值不唯一                  |
| `--brand-color`          | 4      | ⏸ 运行时逐条设置(品牌色,正常) |
| `--calendar-intensity`   | 2      | ⏸ 运行时逐条设置(正常)         |
| `--color-border-strong`  | 1      | ⏸ 目标值不唯一                  |
| `--color-text-warning`   | 1      | ⏸ 目标值不唯一                  |
| `--color-primary-50/500/700` | 各 1 | ⏸ 色阶未定义                    |
| `--color-bg-muted` / `--color-panel` / `--color-accent-bg` / `--color-bg-base` | 各 1 | ⏸ 目标值不唯一 |

### 7.0 「简写里的未定义 var」到底有多严重:实测结论

这一条是本轮最有价值的发现,而且**我一开始猜错了方向**,所以把实测过程记下来。

先前的说法是「简写里写了未定义 var,整条声明作废」。方向对,但**后果比我以为的更严重**:
我一直以为只是丢一个颜色,实际是**整条声明连同边框一起消失**。在真实浏览器里逐个量过:

| 写法 | `border-top-width` | 结果 |
| --- | --- | --- |
| `border: 1px solid var(--已定义)` | `1px` | 正常 |
| **`border: 1px solid var(--未定义)`** | **`0px`** | **整条声明作废,边框直接没了** |
| `border-width:1px;border-style:solid;border-color:var(--未定义)` | `1px` | 长写只丢那一条,边框还在 |
| `border: 1px solid var(--未定义, #00ff00)` | `1px` | 有兜底值就正常 |
| `outline: 2px solid var(--未定义)` | `outline-width: 0` | 同样整条作废 |

也就是说 `--color-success-border` / `--color-warning-border` 那 40 处

```css
border: 1px solid var(--color-success-border);   /* 卡片想要的柔和描边 */
```

**一处都没画出来** —— 不是颜色不对,是根本没有边框。同理 `background: var(--color-surface)`
的面板一直是无色的,`background: var(--color-text-quaternary)` 的装饰条一直是透明的。

**顺带记一个测量教训**:我先拿「改动前截图 vs 改动后截图」比对,量出首页有 1.74% 像素变化、
看着像"改坏了不少东西"。但那两张图之间混进了**两个无关变量**:
侧栏图标是 CDN 图片(`iconSrc`),前一张恰好加载失败;首页插画是动画,两张拍在不同帧。
改成**同一个会话里只切 CSS 变量**(把新 token 设成 `initial` 即等于"未定义"),
动画冻住、等图片加载完再拍,10 个页面 × 2 主题的差异全部是 **0 像素** ——
说明这几个 token 在我截的那 5 个页面上本来就不参与渲染,风险比看上去小得多。

真正的验证因此换成「在真实页面里插入用这些 token 的元素,两种状态下各量一次」:

| 探针 | 有定义 | 未定义(改动前) |
| --- | --- | --- |
| `border: 1px solid var(--color-success-border)` | `1px / solid` | `0px / none` |
| `border: 1px solid var(--color-warning-border)` | `1px / solid` | `0px / none` |
| `background: color-mix(… var(--color-primary-soft) …)` | 暖色可见 | 透明 |
| `background: var(--color-surface)` | `#ffffff` | 透明 |
| `background: var(--color-text-quaternary)` | `rgb(176,181,188)` | 透明 |

影响与 `--color-btn-primary-text` 完全同类:自定义属性未定义时,`var()` 在计算值阶段失效、
整条声明作废,属性退化成继承或初始值 —— `color` 退化成继承、`background` 退化成透明、
`border-color` 退化成 `currentColor`。多数情况下「继承到的颜色刚好也对」,所以长期没被发现。

#### 两个此前已处理的实例

同样机制,`outline` / `height` 这类简写里出现未定义的 `var()`,失效的也是整条声明,
而且都不报错、界面上没有明显痕迹,只会「悄悄不生效」:

- `--color-focus`:实际生效的一直是全局 `:focus-visible`,所以焦点**仍然可见**
  (不是 2.4.7 失败),但那条组件级规则是纯死代码 —— 改成 `--color-primary` 后与原意一致,
  可观察结果为零。
- `--mobile-nav-height`:本项目窄屏下**没有常驻底栏**,移动端导航是
  「汉堡按钮 → 抽屉/遮罩」,不占布局高度,所以这个减法本身就没有对象。
  删除前做了对照实测(390×844 与 768×900,改前改后完全一致:1486.44px / 1015.91px)。

  ⚠️ 这里纠正了我自己的一个想当然:原以为高度来自基础规则
  `.transactions-page { height: 100vh }`,**实测不是**(390 宽下是 1486.44px),
  实际高度由其它规则决定。注释里写的是实测值,不是推断值。

### 7.1 已补的别名与语义色

第一批(值写成「引用另一个自定义属性」,所以浅色/深色各自解析到正确的颜色,不必两个主题块各写一遍):

```css
:root {
  --color-text-primary: var(--color-text);
  --color-text-muted: var(--color-text-tertiary);
  --radius-pill: var(--radius-full);
  --color-surface: var(--color-bg-elevated); /* 引用方全是 background */
  --color-text-quaternary: var(--color-text-placeholder); /* 引用方是占位符与装饰把手 */
}
```

第二批是**语义族的边框 / 柔和填充色**。它们一开始被列进「待定的品牌决定」而没有补,
但量完简写下失效的后果(§7.0)之后,结论反过来了 —— 不补不是「保持现状」,
而是**这些边框和底色本来就没有渲染出来**,补上才是恢复 CSS 作者的原意:

```css
:root {
  --color-success-border: rgba(52, 168, 83, 0.2);
  --color-warning-border: rgba(245, 158, 11, 0.22);
  --color-primary-soft: rgba(245, 158, 11, 0.09);
  --color-success-soft: rgba(52, 168, 83, 0.08);
  --color-warning-soft: rgba(245, 158, 11, 0.08);
  --color-danger-soft: rgba(234, 67, 53, 0.08);
}
/* [data-theme='dark'] 里另有同族取值,透明度按暗底惯例略高 */
```

取值沿用同族已有的 `--color-danger-border` 做法(与同名的 `*-bg` 同一透明度基调、只轻微加深),
所以是「补齐缺失的定义」而不是「新造一套配色」。

### 7.2 剩下 13 个为什么还没补

补别名的风险不是「变了」,而是「变成什么」:

- **运行时变量**(`--market-color` 12 处、`--brand-color` 4 处、`--calendar-intensity` 2 处)
  的值来自数据而不是主题,本来就该由 JS 逐条注入 —— **这是正常设计,不是缺陷**;
- **目标值不唯一**(`--color-accent`、`--color-border-strong`、`--color-text-warning`、
  `--color-bg-muted`、`--color-panel`、`--color-accent-bg`、`--color-bg-base`、
  `--color-primary-50/500/700`)合计只剩 13 处零星引用,补错会造出新的可见缺陷。

剩下这 13 处要逐处看实际渲染,不能靠猜。

### 7.3 怎么证明别名没有改坏东西

`--color-text-primary` 一处就影响 143 条声明,所以用**逐元素计算颜色指纹**做对照:
改前 / 改后各跑一遍 21 条路由 × 2 套主题,记录每个「自己有文字」的元素的计算 `color`,
逐条 diff。

结果:**104 个元素的计算颜色发生变化**,全部落在 `/investments`(34)、`/repayment-management`(12)、
`/salary-tools`(6)等三处,且两个方向都对:

- `--color-text-muted` 的 18 处:文字由「继承到的近黑 `#1a1d23`」变成 `#5b6878`,
  正是这 18 处**该有的样子**(原来是靠继承碰巧拿到了标题色,层级是错的);
- `--color-text-primary` 的 86 处:`.investments-key-label`(「账面盈亏」)原本显式声明
  `color: var(--color-text-primary)`,因为 token 未定义而继承了外层语义色(浅色主题是绿 2.8:1、
  深色主题是绿 1.85:1 一类),补上别名后回到**作者本来想写的**正文色。
  这属于修好,不是改动设计。

### 7.4 一个必须记下来的测量教训

对比度扫描**不能跨时间比总量**:`/investments` 有实时行情,百分比数值会变,
失败的实例数随之浮动。我第一版就是这样误判的 ——

- 别名前 212、别名后 227,看上去「改坏了 +15」;
- 但同一份代码连跑两次都是 227(**扫描本身是确定的**,噪声不来自脚本);
- 真正的原因是两次测量相隔约 30 分钟,行情数据变了;
- 改用**同一时间窗 A/B**(临时 stash 掉别名再扫一次):无别名 **240** vs 有别名 **227**,
  别名实际是**少了 13 处**。

结论:**要比就同一时间窗比,或者比「按颜色对聚合」的结构**,不要比跨时间的绝对总数。

## 8. 怎么重跑

```bash
node server/localSqliteServer.js # 需要 API
npx vite --port 5333 --strictPort
node scripts/audit-contrast.mjs --base=http://localhost:5333
# 或
npm run audit:contrast
```

脚本和 `audit-ui-browser.mjs` 一样依赖 playwright + 演示账号,所以**不在 CI 里**,
需要手动跑。
