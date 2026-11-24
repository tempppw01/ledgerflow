# 交接说明:v0.50.4 → v0.50.32 这一段

写这份说明是因为:这二十多个版本改动分散在金额口径、同步、回收站、预算、导入、认证几处,
**每条结论背后都有一份实测证据**,不写下来下次要重新挖一遍。

配套文档:`docs/verified-invariants.md`(每条不变量对应哪条测试/命令)、
`release-notes/RELEASE_NOTES_v0.50.*.md`(逐版说明)。

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

### 5. 「预算」型交易算不算支出 —— **唯一还没定的事**

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

## 四、演示账本的基线(2026-11-24 实测)

手工验证都靠它 —— 而它**会被改动**(我这一段为了验证反复改过)。别再靠人眼对表,跑这两条:

```bash
npm run audit:demo-baseline   # counts / 关键余额 / 退款夹具 / 外键(下面那张表就是它的期望值)
npm run audit:ledger-math -- --email=demo.mcp@ledgerflow.local   # 钱的口径:逐月收支、余额变动链、净值
```

第一条是 2026-11-24 加的可执行版基线;不一致时它会**直接告诉你清理时容易踩的两个坑**:
删交易要连 `ledger_balance_changes` 一起删、删完要把账户的 `balance` 缓存回写成审计算出的值。

| 项 | 值 |
| --- | --- |
| 交易 / 账户 / 分类 | 298 / 6 / 21 |
| 订阅 / 负债 / 还款记录 | 3 / 3 / 2 |
| 投资持仓 / 目标 / settings | 5 / 2 / 11 |
| 2026-11 收支 | 收 ¥26,328.00 / 支 ¥7,764.37 / 净 ¥18,563.63(含退款) |
| 净值构成 | 账户 ¥206,395.74 + 投资 ¥144,460.00 − 负债 ¥54,860.40 = **¥295,995.34** |
| 关键夹具 | ¥390.55 那一对(支出 + 退款),多条验证都用它 |

## 五、怎么复跑这些检查

```bash
npx tsc --noEmit && npm run lint && npm test && node --test server/*.test.js
npm run i18n:check && npm run i18n:check-jsx
npm run check:dates && npm run check:money && npm run check:shared-predicates
npm run check:docs && npm run check:audit-routes
node scripts/audit-ledger-math.mjs --email=demo.mcp@ledgerflow.local   # 需要库
PLAYWRIGHT_MODULE=<path>/playwright/index.mjs npm run audit:ui:local   # 起服务→审计→收尾
```

下面这**五个**已经在 CI 里跑(verify job 的 Static consistency gates 一步,2026-11-24 实测在 Linux CI 上通过):

| 闸门 | 查什么 |
| --- | --- |
| `check:shared-predicates` | 共享判断(退款/冲正、是否计入余额、金额取整、支出口径)不许在别处手写或重复定义 |
| `check:docs` | 本文档与不变量清单:引用的测试必须存在、表格列数一致、表格不被正文切断 |
| `check:audit-routes` | 界面审计覆盖的路径必须与 `src/app/router/router.tsx` 对齐 |
| `audit:sums` | 手工求和的候选点;被点名却未引用共享汇总的文件必须写明理由 |
| `check:dynamic-i18n` | 动态拼出来的 i18n 键必须存在(kind 从代码推导,新增 kind 不漏语言键) |

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

## 六、这段工作的方法与教训

**有效的方法**(比随机翻页面产出高得多):

1. **按形状找问题**,而不是按模块:「同一概念两处实现」「两条判断用不同归一」「写死的默认值
   无视已有数据」「可逆操作用了不可逆的实现」—— 每条形状都至少命中一次。
2. **回头审自己的 diff**:五轮里四轮命中,抓到的全是**我自己留下的**问题,
   其中两处任何现有闸门都抓不到。
3. **每个修复都要能证伪**:删掉修复 → 测试必须翻红。这一步让我抓到三次「测试其实没测到」。
4. **把一次性的验证变成守卫**:`check:docs`、`check:audit-routes`、`audit-ui:local`、
   `importReplaceSemantics.test.js` 都是这么来的。

**代价最大的四类错误**(都发生过,且都伪装成"被测对象有缺陷"):

| 错误 | 表现 |
| --- | --- |
| id 语义混淆 | 拿 ledger 用户 id 去查 `auth_sessions`(那是 auth id)→ 假泄漏警报 |
| 假 0 行 | 先按 `transaction_id` 过滤一张该列全为 NULL 的表 → 「数据不见了」 |
| `String.replace` 只换第一处 | 证伪打偏,差点得出「测试无效」 |
| 临时脚本残留 | `.tmp-*` 被 gitignore 忽略,`git status` 看不见,却能让 lint 变红 |

共同点:**验证工具本身也需要验证** —— 每次先问一句「这个结果,有没有可能是我工具的问题」。