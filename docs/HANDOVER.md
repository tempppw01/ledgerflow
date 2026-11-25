# 交接说明:v0.50.4 → v0.50.54 这一段

写这份说明是因为:这二十多个版本改动分散在金额口径、同步、回收站、预算、导入、认证几处,
**每条结论背后都有一份实测证据**,不写下来下次要重新挖一遍。

配套文档:`docs/verified-invariants.md`(每条不变量对应哪条测试/命令)、
`release-notes/RELEASE_NOTES_v0.50.*.md`(逐版说明)。

> ## ⚠ 有 **3 件事卡在用户决策**,别当成"还没做"
>
> 详细说明在 `docs/verified-invariants.md` 的「已复现、但**待决策**的问题」一节(现在只有 52 行)。
> 三件都**不是**技术难题,而是**改法会动到产品语义 / 用户数据**,不该由改代码的人单方面定:
>
> 1. **整份快照同步会静默删掉另一个客户端的写入** —— 两个标签页或两台设备就能撞上(已严格复现)。
>    三个修法各有代价,倾向 **C:推送前先比服务端状态,发现别人写过就不推、提示刷新**
>    (把"静默丢失"变成"可见且可恢复")。**这条改动会碰用户的账目数据,决定前不要动。**
> 2. **PWA 安装提示**:`usePwaInstallPrompt` 写好了但没接到界面 —— 接上,还是删掉?
>    留着不动它就会一直是 `check-dead-exports` 里唯一的豁免项。
> 3. **账单里 93 笔"中性"/转账行**:现在被**跳过**,但这些行的账户余额变动是真实的。
>    导入成"转账"概念,还是继续跳过?
>
> **这三件我没有动。** 拿到用户的选择之前,改它们属于替用户做产品决定。

---

## 一、这段修掉的真问题(按危险程度排序)

### 1. 静默丢数据:整份快照同步会删掉另一个客户端的写入 —— **已修(v0.50.35)**

- **机制**:客户端防抖 500ms 把**整份快照** `PUT /api/data/import`;服务端
  `replaceRelationalData` 先 `clearUserData`(删光该用户全部行)再按快照重插;
  推之前**不重新拉取、也不比版本**。
- **已严格复现**:两个标签页(同一会话)都加载完成 → A 记 333 → 查库确认 333 在 → B(状态里没有 333)
  记 444 → 查库:**333 消失**。
- **可达性**:两个标签页,或同一账号手机+电脑。日常就能撞上。
- **机制已钉成测试**:`server/importReplaceSemantics.test.js`(3 条)—— 哪天改成合并或加版本校验,
  这三条会翻红,提醒同步更新文档。
- **已按方案 C 落地(v0.50.35)**:客户端带 `X-Ledger-Base-Revision`,服务端发现版本已变就 409;
  不带头部的调用方保持原行为(旧客户端、脚本、测试不受影响)。
- **浏览器端到端验证过**:两个标签页 —— A 记 ¥111 保存成功;B(旧版本)记 ¥222 **被拒绝**;
  B 刷新后记 ¥333 **保存成功**(不卡死);服务端最终 `[111, 333]`(A 那笔完好)。
  自动化层面另有 2 条服务端 HTTP 测试,并**证伪过**(去掉校验后第一条失败,期望 409 实得 200)。
- **代价(已接受)**:被挡下时本窗口那一笔要刷新后重填;刷新时「有未保存改动」确认框会弹出
  (v0.50.29 的离开保护),用户不会在不知情下丢掉它。

### 2. 离线记的账,关页面就没了 —— **已修(v0.50.29)**

- 账本**不在浏览器持久化**(`shared/store/sqlOnlyStorage.ts` 是刻意的空实现,多用户隔离因此才干净),
  所以没推上去的改动只活在内存里。
- 实测:断网记 666 → 恢复联网刷新 → 界面和库里都没有 666,提示也一并消失。
- 修法:`useUnsyncedChangesGuard` —— 有未同步改动时,离开页面前让浏览器弹确认框。
- **未修复的部分**(属另一个量级):真正支持离线记账需要本地队列 + 重放 + 冲突处理,
  与上面第 1 条共用同一套设计。

### 3. 服务端丢行是静默的 —— **已修(v0.50.30)**

- 导入器会丢掉**引用无法解析**的行(最典型:交易引用的账户已被彻底删除),接口照样回 200,
  而客户端**从来不读返回的 `counts`**。
- 修法:比对「发出多少行 vs 服务端存下多少行」,有缺口就提示「同步完成,但以下记录没能写入服务端:
  交易 1 条…」;并且**不解除**上面的离开保护(那些行确实还在内存里)。
- `counts` 缺失/不可信时**倾向不报警**(宁可漏报,不要误报)。

### 4. 彻底删除账户会连带丢交易 —— **已修(v0.50.30 / v0.50.31 / v0.50.34)**

- 机制:账户彻底删除后,引用它的交易在下一次同步时被服务端丢弃(即第 3 条的机制)。
- 已修:v0.50.30 让丢失可见;v0.50.31 给单条「彻底删除」补了确认框,并对账户如实写明
  「该账户下的 N 笔交易也会随之消失」。
- **已按方案 C 落地(v0.50.34)**:还有交易引用该账户就**拒绝彻底删除**,并说明有几笔挡着
  (「该账户下还有 N 笔交易,无法彻底删除 —— 那些交易会找不到账户。请先处理这几笔交易
   (改归属或删除),再回来删除账户。」)。
- **验证**:4 条测试(含「回收站里的交易也算数」)+ **证伪**(去掉拒绝逻辑 → 3 条失败)。
- **尚未做的备选**:把交易重指派到另一个账户 —— 那要用户选目标账户,是更大的设计。

### 5. 「预算」型交易算不算支出 —— **已定案:v0.50.36(不算)**

`transactionMetrics.isExpenseLike` 含 `budget`,`dashboard/model/utils.isActualExpenseType` 不含
→ 首页一屏内两个数字自相矛盾。

**它是可达的,不是纸面问题**:交易表单的类型下拉里就有「预算」这一项
(`TransactionEditPage` 的 `<option value="budget">预算</option>`),用户可以自己建出这类交易,
而且界面上**没有任何文字解释它意味着什么**(整个 zh 语言文件里,「预算」只作为类型名和
智能预算功能名出现,没有一句定义)。所以这确实需要一个产品决定,不是我能从代码里读出来的。

**这一件我做不出提案**:前两件有实现层面的取舍(代价大小、失败方向、可逆性),这一件只有一句定义。

- 答「算」→ `isActualExpenseType` 纳入 `budget`(首页向「减少余额」看齐);
- 答「不算」→ `isExpenseLike` 去掉 `budget`(各报表向「实际花掉」看齐)。

两个方向都是:改一行谓词 + 改 `shared/lib/expenseScope.contract.test.ts`(它现在就钉着两者的差异,
统一后 4 条里会有 3 条翻红)+ 更新本文档 + 发版。

另外两件(`### 1` 与 `### 4`)已经按同样的判据落地并验证:**代价严格小于收益、失败方向更安全、
一行可 revert**。这一件没有"更安全的一边",所以留给你。

---

## 二、这段修掉的其它问题(都已发版,有测试守着)

| 版本 | 问题 | 测试 |
| --- | --- | --- |
| v0.50.5 | 删除原交易时,挂在它上面的退款留在账上 → 余额凭空多一笔 | `store/trashRefundPair.test.ts` |
| v0.50.5 | 恢复已退款的支出时,退款留在回收站 → 账上少一笔 | 同上 |
| v0.50.16 | 缺省交易状态口径只统一了一半(筛选按已完成、显示「-」) | `store/defaultTransactionStatus.test.ts`、`transactions/model/statusLabel.test.ts` |
| v0.50.17 | 17 处金额取整各自为政 + 解析器漏取整(三位小数) | `shared/lib/money.test.ts`、`debt/model/creditDrafts.rounding.test.ts` |
| v0.50.18 / v0.50.32 | 删除生成流水不退续费日(再生成跳过一期);**恢复时不推回**(我引入的不对称) | `store/subscriptionRenewalRevert.test.ts`(6 条) |
| v0.50.20 | 助手汇总把退款又算成一笔支出、并把待支付计入 | `features/assistant/agent/assistantAgentTools.test.ts` |
| v0.50.21 | 「本月可投资现金」两份实现、两处都错、错法不同 | `investments/model/monthlyCashflow.test.ts` |
| v0.50.23 | 零预算分类显示「超支」却写「执行率 0.0%」 | `smart-budget/model/budgetZeroBudget.test.ts` |
| v0.50.24 | 「本周 vs 上周」按行号切,数据稀疏时结论会反 | `features/assistant/model/weeklyExpenseTrend.test.ts` |
| v0.50.25 / v0.50.26 | 导入变更检测与去重键归一不一致(日期格式/金额/备注/单号) | `shared/lib/billImport.mergeInvariant.test.ts` |
| v0.50.27 | 预算向导无视已登记的月收入,固定从 ¥10,000 起 | `smart-budget/model/wizardDefaults.test.ts` |
| v0.50.28 | 直接访问 `/login` 登录后落到 404 死胡同 | 手动回归 `AuthGate.test.tsx` |

---

## 分支现状

两件提案**都已经合并进 main 并发版**,分支本身留着只是为了能随时 revert:

| 分支 | 状态 |
| --- | --- |
| `proposal/refuse-account-deletion-with-transactions` | 已合并 → **v0.50.34** |
| `proposal/reject-stale-snapshot-push` | 已合并 → **v0.50.35** |
| `proposal/integration-both` | 已完成使命(单独验证过二者零冲突),可以删 |

三个分支都仍在远端。确认新行为没问题后,删掉它们即可 —— 合并后的历史里已经含有这些改动。

## 三、验过、**没有问题**的部分(别重复挖)

- **数据出入口**:本地 JSON 备份往返(真实数据逐字段对比)、服务器恢复点、SQL 导出(全表兜底
  0 行越界)、多用户隔离、导入事务性 —— 全部实测过。
- **边界数据**:1970/2099 日期、金额上限、零金额 —— 钱与界面两层都干净。
- **批量操作**:批量删除复用单条逻辑(含退款级联);批量 AI 改分类经唯一索引换 id、绝不猜。
- **PWA**:`/api/` 不走 SW 回退、`skipWaiting` 立即接管、只缓存 CDN 静态资源且不含 API。
- **全局记忆 / 行情缓存 / 信用解析 / 摊还表 / 授信计算**:抽查均自洽,有测试覆盖。
- **发布链**:33 个 tag = 33 个 GitHub Release = 33 份 release notes,无缺口。

---

- **智能预算向导(2026-11-25 实测,全新账号首次进入)**:5 步向导渲染正常、**零 console 错误**、
  页面无横向溢出;第 1 步的「上一步」是**禁用态**(合理);第 2 步把收入填成 `0` 再点下一步,
  **停在原步**并提示「每月收入必须大于 0。」—— 校验生效。**这一页不必再从头验一遍**。

**余额变动:记一笔 -> 明细(2026-11-25 实测,全新账号)**:走完整链路验证过一次 ——
记一笔 88.5 之后,明细页正确出现「支出扣减 · 快速记账 · −¥88.50」,净变动统计 −¥88.50 / 1 笔,
页面无横向溢出、零 console 错误。

顺带确认了 v0.50.45 那个修复仍然生效:**表格宽 1041,容器可见宽 1082** —— 说明「备注撑破表格」
那次的固定列宽还在起作用(这正是那次修复要的效果)。**这一页不必再从头验**。

(「变动后余额 −¥88.50」是对的:新账号初始余额为 0,支出一笔就是负的。)

**全站复扫(2026-11-25,22 条路由):0 问题**。
项目自带的 `npm run audit:ui:local` 这次跑不起来 —— 它依赖的 Playwright 要 `chromium_headless_shell-1255`,
而这台机器上装的是 1169 / 1248,**版本对不上**。于是我用一直能用的那套 MCP 浏览器,
按审计脚本里的 **ROUTES 清单**逐条走了一遍(每条:控制台错误 + 横向溢出 + 4xx/5xx 请求):

| 批次 | 路由 | 控制台错误 | 横向溢出 | 失败请求 |
| --- | --- | --- | --- | --- |
| 第一批 | / · /transactions · /transactions/new · /tags · /settings · /smart-budget · /assistant · /global-memory · /financial-analysis · /categories-accounts · /balance-changes | 0 | 0 | 0 |
| 第二批 | /investments · /subscriptions · /repayment-management · /database-settings · /recycle-bin · /exchange · /salary-tools · /finance · /help · /about · /investments/flow | 0 | 0 | 0 |

(清单里的第 23 条是一条**故意不存在**的路径,用来验 404 页,没算进上面两批。)

**要复跑**:先用上面那套 MCP 浏览器按 ROUTES 走一遍(能跑);
想让 `audit:ui:local` 自己跑起来,得先 `npx playwright install` 补上它要的那个版本。

> **算术审计也跑过**(2026-11-25):`node scripts/audit-ledger-math.mjs --email=demo.mcp@ledgerflow.local` ——
> 退款关联、余额变动一一对应、逐月收支、**净值恒等式**(账户 206,395.74 + 投资 144,460.00 − 负债 54,860.40 = 295,995.34)
> 全部自洽。这个脚本不在 CI(要本地库),改完账目相关的代码值得手动跑一次。

## 四、演示账本的基线(2026-11-24 实测)

手工验证都靠它 —— 而它**会被改动**(我这一段为了验证反复改过)。别再靠人眼对表,跑这两条:

```bash
npm run audit:demo-baseline   # counts / 关键余额 / 退款夹具 / 外键(下面那张表就是它的期望值)
npm run audit:ledger-math -- --email=demo.mcp@ledgerflow.local   # 钱的口径:逐月收支、余额变动链、净值
```

第一条是 2026-11-24 加的可执行版基线;不一致时它会**直接告诉你清理时容易踩的两个坑**:
删交易要连 `ledger_balance_changes` 一起删、删完要把账户的 `balance` 缓存回写成审计算出的值。

| 项 | 值 | 谁在核对 |
| --- | --- | --- |
| 交易 / 账户 / 分类 | 298 / 6 / 21 | `audit:demo-baseline` |
| 订阅 / 负债 | 3 / 3 | `audit:demo-baseline` |
| 投资持仓 / 目标 / settings | 5 / 2 / 11 | `audit:demo-baseline` |
| 现金账户余额 | **−595.2** | `audit:demo-baseline` |
| 关键夹具 | **¥390.55** 那一对(支出 + 退款),多条验证都用它 | `audit:demo-baseline` |
| 外键悬垂行 | 0 | `audit:demo-baseline` |
| 2026-11 收支 | 收 ¥26,328.00 / 支 ¥7,764.37 / 净 ¥18,563.63(含退款) | `audit:ledger-math` |
| 净值构成 | 账户 ¥206,395.74 + 投资 ¥144,460.00 − 负债 ¥54,860.40 = **¥295,995.34** | `audit:ledger-math` |
| 还款记录 | 2 条,合计 ¥6,000.00 | `audit:demo-baseline`(2026-11-25 补上:此前只有「2」这个手点出来的数,**没有任何脚本核**;补的时候顺带加了金额合计,只核条数的话 3000 变 3001 也能蒙过去) |

## 五、怎么复跑这些检查

> **⚠ 发布之前先读 [docs/release-process.md](release-process.md)。**
> 那份文档的第一条是**发布节奏:攒一批再发** —— 日常修复**只 commit + push 到 main**,
> **不动 `package.json` / `APP_VERSION`、不打 tag、不建 Release**;
> 等这批改动成规模了,才统一改版本号 → 写 `release-notes/RELEASE_NOTES_<tag>.md` → 打 tag → 工作流发布。
>
> **这个文档原来只被 README / release.yml 引用,没有从这里链过** —— 结果是接手的人
> (2026-11-25 那次)完全没读到它,把「一个修复发一个版本」做了十几遍(v0.50.43 ~ v0.54),
> 正好是那份文档第一条明令禁止的。所以现在把**规则本身**也抄在这里,不只是链接。
>
> 另外两条也来自那份文档:每个 tag **必须**有 `release-notes/RELEASE_NOTES_<tag>.md`,
> 且该文件要在 tag 指向的提交里;**不要手工 `gh release create`**(会绕开工作流)。

```bash
npx tsc --noEmit && npm run lint && npm test && node --test server/*.test.js
npm run i18n:check && npm run i18n:check-jsx
npm run check:dates && npm run check:money && npm run check:shared-predicates
npm run check:docs && npm run check:audit-routes
node scripts/audit-ledger-math.mjs --email=demo.mcp@ledgerflow.local   # 需要库
PLAYWRIGHT_MODULE=<path>/playwright/index.mjs npm run audit:ui:local   # 起服务→审计→收尾
```

### 浏览器端到端验证:用临时账号,不要用演示账号

手工验证(比如"两个标签页并发写")要一个干净账号。**必须用临时账号** —— 用演示账号会往
基线库里写测试数据(我这一段就犯过一次:写了 ¥999,清理时又漏了回写账户余额缓存,
两次都是靠人肉对表才发现的)。

```bash
npm run dev:test-user -- --create  <ledgerUserId> <email>   # 密码与演示账号相同
npm run dev:test-user -- --cleanup <ledgerUserId> <email>   # 按依赖顺序删干净
npm run audit:demo-baseline                                 # 收工前确认基线没被动过
```

脚本里有一条**结构性保护**:目标指向演示账号时直接拒绝(id 与 email 双重比对)——
让"误写演示库"这件事无法再发生。清理顺序也是写死的,不用每次重新推导。

下面这**九个**已经在 CI 里跑(verify job 的 Static consistency gates 一步,2026-11-24 实测在 Linux CI 上通过):

| 闸门 | 查什么 |
| --- | --- |
| `check:shared-predicates` | 共享判断(退款/冲正、是否计入余额、金额取整、支出口径)不许在别处手写或重复定义 |
| `check:docs` | 本文档与不变量清单:引用的测试必须存在、表格列数一致、表格不被正文切断 |
| `check:audit-routes` | 界面审计覆盖的路径必须与 `src/app/router/router.tsx` 对齐 |
| `audit:sums` | 手工求和的候选点;被点名却未引用共享汇总的文件必须写明理由 |
| `check:dynamic-i18n` | 动态拼出来的 i18n 键必须存在(kind 从代码推导,新增 kind 不漏语言键) |
| `check:orphan-methods` | store 里声明的公开方法必须在别处被用到 —— 抓「声明了、实现是空壳、全项目没人调用」这类(类型检查与测试都发现不了) |
| `check:dead-exports` | 导出了却全仓没人引用(符号名与文件路径都查)—— 抓「功能删了、文件留下」这类死代码 |
| `check:jsx-hardcoded` | JSX 文本节点里的硬编码中文(脚本本来就带 `--fail`,只是从没接进 CI)—— 抓「该走 i18n 却写死」 |
| `check:r2-fetch` | 禁止 `fetch()` 直连 R2 公共域名(该域名不返回 CORS 头,曾把 PDF 导出整个搞挂;脚本里写着"给 CI 用"却从没接上) |

`audit:ledger-math` 与 `audit:ui` 不在 CI 里:前者要本地库,后者要 playwright 与 chromium。

**生产构建已验过(2026-11-24)**:构建成功(dist 4.0MB / 43 个 asset / 48 个预缓存条目),
并且用 `vite preview` 起构建产物跑了一遍完整界面审计 —— **46 个组合(23 路由 × 2 视口)、0 个问题**(含登录与数据加载,Service Worker 已注册)。

**生产构建**(`npm run build` = `tsc --noEmit && vite build`)在 CI 里由 docker 那条线覆盖(Dockerfile 里有 `RUN npm run build`)。
本地在 Windows/MSYS 下直接跑会失败于 `[vite:esbuild-transpile] remove ...: Access is denied` —— 那是 MSYS 的临时目录路径问题,不是代码问题。
逃生方法(实测可用):

```bash
cmd.exe /c "set TEMP=C:\\Users\\<你>\<仓库>\.tmp-build&& set TMP=%TEMP%&& npm run build"
```

---

> **怎么把功能跑起来**:起环境、驱动那个快速记账抽屉、把账单文件递进去、跑全站回归扫描 ——
> 都写在 [docs/verification-recipes.md](verification-recipes.md) 里(实际跑通过的做法 + 踩过的坑)。

## 六、这段工作的方法与教训

**有效的方法**(比随机翻页面产出高得多):

1. **按形状找问题**,而不是按模块:「同一概念两处实现」「两条判断用不同归一」「写死的默认值
   无视已有数据」「可逆操作用了不可逆的实现」—— 每条形状都至少命中一次。
2. **回头审自己的 diff**:五轮里四轮命中,抓到的全是**我自己留下的**问题,
   其中两处任何现有闸门都抓不到。
3. **每个修复都要能证伪**:删掉修复 → 测试必须翻红。这一步让我抓到三次「测试其实没测到」。
4. **把一次性的验证变成守卫**:`check:docs`、`check:audit-routes`、`audit-ui:local`、
   `importReplaceSemantics.test.js` 都是这么来的。
5. **同一个数,用两种互不相同的数法对一次**:行尾规范化那轮,我自己的 awk 条件写错了,报
   「待刷新 0 个」,而独立的 `grep -c` 报「还剩 48 个」—— 正是两个数对不上才暴露了工具的错误。
   凡是"报 0 / 报空"的结论,都该用第二种数法再验一遍。
6. **改了行尾属性之后,别指望 `git checkout-index -a -f` 刷新工作区**:它按 stat 判定"没变化"就跳过。
   要 `rm` 掉文件再 `git checkout -- <文件>` 才会按新属性重新物化 —— 先拿**单个文件**试,
   确认属性真的生效(`file` 看行尾),再批量做。

**代价最大的四类错误**(都发生过,且都伪装成"被测对象有缺陷"):

| 错误 | 表现 |
| --- | --- |
| id 语义混淆 | 拿 ledger 用户 id 去查 `auth_sessions`(那是 auth id)→ 假泄漏警报 |
| 假 0 行 | 先按 `transaction_id` 过滤一张该列全为 NULL 的表 → 「数据不见了」 |
| `String.replace` 只换第一处 | 证伪打偏,差点得出「测试无效」 |
| 临时脚本残留 | `.tmp-*` 被 gitignore 忽略,`git status` 看不见,却能让 lint 变红 |

共同点:**验证工具本身也需要验证** —— 每次先问一句「这个结果,有没有可能是我工具的问题」。

---

## 七、v0.50.33 → v0.50.54:这一段又修了什么

前十来版集中在"用户报的问题 + 我顺着线索挖出来的同类问题"。按危险程度排列:

| 问题 | 根因 | 版本 |
| --- | --- | --- |
| 加了个股但看不到净值 | 取个股行情的接口把 secid 过滤成 `/^[01]\.\d{6}$/`(A 股形状),美股 `105.AAPL`、港股 `116.00700` 直接 500 | v0.50.43 |
| 上传微信账单失败(解析出 0 条) | 账单 xlsx 的「交易时间」是 **Excel 日期序列号**,而手写的 xlsx 解码器忽略单元格样式,日期列变成 `46350.78…` | v0.50.44 |
| 导入后收入/支出合计对不上 | 「收/支」为 `/` 的**中性交易**(转账/提现)被摊进收支;修后收入 29402.99、支出+还款 14522.08 与账单自报逐项吻合 | v0.50.44 |
| 导入的交易全变成「餐饮」 | 每一行都用同一个 `defaultCategoryId` | v0.50.46 |
| 真实商户名归错类 | 关键词表缺「厨房/面馆/小吃/烘焙/药房」 | v0.50.47 |
| 「分类学习」是空壳 | store 里三个方法分别是 `() => null` / noop / `() => false`,数据模型与设置页文案却都建好了 | v0.50.48 |
| 主题色永远只有琥珀 | `App.tsx` 把 `data-accent-theme` **写死成 'amber'**,`tokens.css` 里另外五套配色从没生效 | v0.50.49 |
| 备注过长撑破余额变动页 | 表格是 `table-layout: auto`,一条 182 字符备注把「说明」列顶到 1284px | v0.50.45 |
| 新用户想导入账单却**找不到入口** | 空状态文案写着「或导入账单数据」,而导入按钮只在「当期账单」那一排 —— 没有任何交易时不渲染 | v0.50.52 |
| 账单日期序列号**只认没写 `t` 的单元格** | 微信官方导出不写 `t`,而 openpyxl / LibreOffice 会写 `t="n"` —— 用别的工具另存过的账单仍然解析 0 条 | v0.50.53 |
| CSV 引号字段里**带换行** → 整笔交易静默消失 | 取行用的是 `split('\n')`,而引号内的换行是合法内容,一条记录被劈成两半 | v0.50.54 |
| 订阅生成支出:账户全没了时提示误导 | 提示「订阅绑定的账户已不存在」,但用户其实是**一个账户都没有** | v0.50.51 |

另外两版是纯加固:

- **v0.50.51**:给订阅生成支出补 4 条不变量测试(账户被删 / 同日重复 / 日期推进 + 记下推进前的值 / 非人民币标签)。
- **v0.50.50**:把「再记一笔」的校验/清空逻辑抽成纯函数并补 9 条单测(v0.50.41 上线时只有手点验证)。
  抽的时候被 i18n 检查器拦了一次:键搬进 model 层后它以为那些键没人用 —— 修法是**改分层**(model 只返回原因码),
  不是改测试。
- **死代码清理**:删掉 8 个没人引用的文件(7 个仪表盘组件 + 一个已废弃的 sync store),`syncClient.ts` 193 → 17 行;
  并加了「声明了却没人用」与「导出了却没人引用」两个闸门。
- **部署卫生(2026-11-25,未发版、按"攒一批再发"只提交)**:Windows 上 `docker build` 出来的镜像
  **起不来** —— 构建上下文里的入口脚本带 CRLF,镜像里首行是 `#!/bin/sh\r`,exec 报
  `No such file or directory` / 退出码 127;同一根因还让 `nginx.conf` 的 CRLF 使 PORT 改写**静默失效**
  (脚本仍退出 0)。CI 在 Linux 上检出所以一直是绿的,**只有 Windows 本地构建会中招**。
  修法:新增 `.gitattributes`(`* text=auto eol=lf`)+ Dockerfile 里 `tr -d '\r'` 兜底;
  顺带把 `docker/start-ledgerflow.sh` 的权限位从 100644 改成 100755。
  完整复现、逐项前后对比与验证方式见 `docs/verified-invariants.md` 的「Windows 上 `docker build`
  会产出『起不来』的镜像」那一节。
- **`.editorconfig`(2026-11-25,同上)**:`.gitattributes` 管的是 git 检出的字节,而这次的坑出在
  **工作区磁盘上的字节**(Docker 构建上下文读的就是它)—— 有人用编辑器把 `nginx.conf` 存成 CRLF
  就又踩回去了。于是补一份 `.editorconfig` 把行尾/编码钉死。值都是**量出来**的,不是编的:
  `.prettierrc` 是 2 空格、仓库无 Tab 缩进、而 `README.md` 里确实有 1 处用「行尾双空格 = 硬换行」,
  所以 `[*.md]` 单独关掉 `trim_trailing_whitespace`。
  (顺带量到一个更早的问题:`npm run format:check` 是红的,341 个文件 —— 详见
  `docs/verified-invariants.md` 的「已知但故意不当作 bug 的」一节,不要顺手全量重排。)
- **切一下主题就会把整份账本重新上传(2026-11-25,未发版、按"攒一批再发"只提交)**:
  `useAppPreferences` 里既有账本数据(`debts` / `monthlyIncome` / `baseCurrency` ...),
  也有三个**只存浏览器**的纯 UI 偏好(`theme` / `accentTheme` / `defaultLandingPath`,
  见该 store 的 `persist.partialize`)。而 `SqlDataSyncGate` 是
  `useAppPreferences.subscribe(handleStoreChange)` —— **任何**字段变化都会把整份快照
  `PUT /api/data/import`,于是点一下主题切换就重传演示库那 298 笔交易。
  两个后果:服务端写进用户从没改过的设置行;以及"没改动也要抢先上传"放大第 1 条的风险。
  **发现方式是它撞红了自己的闸门**:`npm run audit:demo-baseline` 报 `settings` 由 11 变 12,
  而库里其它数字全对 —— 切主题→查库→复现,再切主题→查库→归零,两次都稳定复现。
  修法写在 `SqlDataSyncGate` 的订阅处,判据刻意是「**只有**本地字段变了才跳过」而不是
  「快照相关字段变了才上传」:后者一旦有谁就地改了数组(引用不变)就会**漏传**;
  反过来认不出来就照旧上传,只砍掉能证明是纯本地的那一次。
  `SqlDataSyncGate.test.tsx` 加了两条成对的测试(主题不传 / 月收入照传),**证伪过**:
  把跳过逻辑关掉,第一条立刻翻红(期望 1 次实得 2 次)。浏览器里也验过:切主题两次,
  上传请求 0 次,基线回到 11。
- **文档修复(2026-11-25,同上)**:`docs/verified-invariants.md` 里有 **404 处**反引号被写成了 `\`code\``
  (某个写入工具的转义残留 —— 其余 16 份文档都是 0 处),Markdown 会把它们渲染成**字面反引号**而不是
  代码样式;`verification-recipes.md` 另有 1 处。已全部反转义(共 405 处)。
  复核方式是「把 HEAD 版施加同一变换后与工作区比对,差额必须**恰好只有我手写的编辑**」——
  这样能排除"顺手改坏了别的行"。

**页面测试覆盖地图(2026-11-25,已更正一次)**:

⚠ **先说这个图表的局限**:它只统计 `src/pages/<页面>/<页面>Page.test.tsx`。
第一版因此把「页面文件很长、但逻辑抽在 `features/` 里且有整套测试」的页面误标成了"零测试" ——
**AI 助手**就是典型(页面 4183 行、比例 0.07,而 `features/assistant/` 下有
aiBillRobustness / semanticRecall / categoryKeywords / workbenchUtils / useAssistantWorkbench 一整套测试)。

补上 `features/**` 那一层之后的真实情况:

| 页面 | 页面代码 | 页面测试 | **对应 features/ 里的测试文件** |
| --- | --- | --- | --- |
| `transactions` | 3541 | 0 | **14 个**(`features/transactions/`) |
| `database-settings` | 1995 | 0 | **6 个**(database-provider 5 + backup 1) |
| `transaction-edit` | 967 | 3(2026-11-25 补) | 0,逻辑在页面的 `transactionDraft.ts`(有测试) |
| `global-memory` | 382 | 0 | 0 |
| `recycle-bin` / `about` / `help` | 330 / 197 / 118 | 0 | 0(都是小页面) |

**所以真正的结论是**:大页面的**逻辑**基本都有测试,缺的是**页面这一层的接线测试**;
而接线测试在大页面上**很贵**(见下面 `transactions` 的 25 个 effect)。**不要因为"页面测试 0"就去补逻辑测试** ——
先去 `features/` 看看有没有。

| 页面 | 代码行 | 页面测试 | 备注 |
| --- | --- | --- | --- |
| `transactions` | 3541 | **0** | 主页面;记一笔的纯逻辑已单测(`features/transactions/model/quickAddForm.ts`),但**页面本身没有测试** |
| `database-settings` | 1995 | **0** | 写数据的地方(设置/同步/备份);之前那个"多传两个参数被静默忽略"的 bug 就在这一带 |
| `transaction-edit` | 967 | **0** | 编辑流水 |
| `investments` | 6405 | 1066 | 比例 0.17 |
| `repayment-management` | 5004 | 1010 | 比例 0.20,数学部分有 `debtMetrics` / `creditDrafts` 一整套测试 |
| `assistant` | 4183 | 279 | 比例 0.07 |
| `settings` | 1705 | 110 | 比例 0.06 |

**「再记一笔」已端到端验过(2026-11-25,浏览器 + 数据库)**:
v0.50.50 的说明里我写过"这个流程没有在浏览器里重新验过"。之后验完了,结论是**功能正常**:

| 步骤 | 结果 |
| --- | --- |
| 点「记一笔」(快速记账入口,注意页面上有两个同名按钮,**抽屉那个在末尾**) | 抽屉打开 |
| 填 12.5 → 点「保存」 | 落库 `expense 12.5 快速记账` |
| 填 7.25 → 点「再记一笔」 | 落库 `expense 7.25`;**抽屉不关**、**金额清空**、**类型(支出)保留** |

两个给后来者的坑:
· 金额输入框是 `<textarea id="quick-add-expression">`(**不是 input**),用 `input[placeholder="0"]` 永远找不到;
  它自带 `<label>`,用 `getByLabelText('金额')` 或 `#quick-add-expression` 都可以;
· footer 里 **「再记一笔」和「保存」并排**,点 `.quick-add-footer button.primary` 点的是「保存」(会关抽屉),
  想验"保留表单"必须点文本为「再记一笔」的那个。

**`transactions` 页面为什么还没测(2026-11-25 实测,不是"懒得测")**:

| 指标 | `transactions` | `transaction-edit`(已能测) |
| --- | --- | --- |
| store 选择器 | 9 | 6 |
| `useEffect` | **25** | 3 |
| `useState` | **53** | ~15 |

渲染它一次会触发 **25 个副作用**(URL 同步、草稿自动保存、焦点管理、表达式求值……),mock 必须
**同时满足**这些副作用才不会炸,写出来的测试也会很脆。也就是说:**它是"结构性不可测",不是覆盖率问题。**

**抽 `QuickAddDrawer` 这个建议,我实测后自己否掉了(2026-11-25)**:

我原本写的是"把抽屉抽成独立组件就能单测"。数了一下抽屉 JSX 区块(3060–3295 行)依赖的标识符:
**22 个** —— 14 个状态/派生值(`quickAddAmountInputRef` / `quickAddBudgetSummary` / `quickAddCategoryOptions` /
`quickAddDraftStatus` …)+ 6 个 setter + `handleQuickAddKeypadInput` + 2 个 ref。

于是两条路都不好:
· **只搬 JSX、状态留在页面** → 组件要接 **22 个 props**,比现在内联更难读;
· **连状态一起搬** → 会牵动草稿持久化、表达式求值、金额键盘、AI 分类建议,是一次真正的重构,不是"抽个组件"。

**所以不要为了测试去抽它。** 抽屉现在的保障是:
· 纯逻辑有 9 条单测(`features/transactions/model/quickAddForm.ts` 的校验/再记一笔/建交易);
· 端到端在浏览器 + 数据库验过(见上一节的表格)。

也就是说:**页面级单测在这里的投入产出比确实很差**,这是量出来的结论,不是偷懒。

**要挑下一个体检目标**:优先看「页面接线」,而不是「逻辑」—— 逻辑测试先去 `features/` 找(见上表),页面接线测试在大页面上很贵。

**顺带排除过的两处**(不必重复查):
· `repayment-management`:5003 行页面 + 1010 行测试,数学层另有 `debtMetrics` / `creditDrafts`(4 个测试文件)
  / `debtPressureSchedule` / `debtRateConvention` 覆盖 —— 在这上面硬找是低产出;
· 服务端 `.js`:扫过"实参比形参多的调用"(那个 `setSetting` 的坑就属于这一类,纯 JS 没有类型检查兜底),
  **0 处**。

**已知、未解决**(写在这里避免重复挖):

- 服务端测试偶发过一次 `fetch failed / bad port`,连跑 5 次无法复现;固定端口与提前读端口都已排除。
- 语言文件里有 36 个可证明的死键(来自被删的仪表盘组件),但语言文件不是规范化 JSON,整文件重写会产生约 4000 行 diff —— 留到下次整顿格式时一起清。
- `usePwaInstallPrompt`(「添加到主屏幕」引导)写好了但**从没接上**,留着等决定是否启用。
- 微信账单里的 **93 笔中性交易**不导入;要让它们进账本,需要账本先有「转账」这个概念。
