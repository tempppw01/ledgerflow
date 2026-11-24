# 不变量清单(这些行为「已经被证明」,改坏了会红)

这份清单记录**已经用测试钉住的行为**,以及每条保护的是什么。加新功能时如果这些测试变红,
说明你动到了既有契约 —— 先看它保护的是什么,再决定是改代码还是改契约。

跑全部:

```bash
node ./node_modules/vitest/vitest.mjs run --config vitest.config.ts
```

只跑某一族(示例):

```bash
node ./node_modules/vitest/vitest.mjs run --config vitest.config.ts src/shared/store/refundInvariant.test.ts
```

## 金额

| 测试                                                       | 保护的行为                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `shared/lib/money.test.ts`                                 | 取整只有一个实现:`1.005 → 1.01`、负数 `.5` 远离零、幂等(含 `-0`)、非法值退化为 0、先求和再取整 == 先取整再求和           |
| `store/refundInvariant.test.ts`                            | 退款总额不得超过原交易金额:创建时拒绝、**编辑时也拒绝**(否则账户净额凭空多钱);导入/恢复可走 `allowRefundOverflow` 逃生门 |
| `store/refundInference.test.ts`                            | 缺 `adjustmentKind` 时的方向推断:明确写了就不推翻;**不能**因为 `status: 'refunded'` 就把原交易当成退款(会把余额算成两倍) |
| `investments/model/investmentSimulator.invariants.test.ts` | 定投模拟全程不取整:投入 = 每期 × 期数、利润/收益率自洽、**线性**(金额翻倍则结果精确翻倍)、非法输入返回 null              |
| `features/debt/model/creditDrafts.rounding.test.ts`       | 信用草稿金额解析走共享取整:`2675.675 → 2675.68`(解析器曾原样返回三位小数);口语单位(`1万5` / `1万零500`)组合后同样不留三位小数 |
| `features/investments/model/monthlyCashflow.test.ts`      | 「本月可投资现金」一份实现:按月取、退款抵减、排除不计入余额的状态;**上个月的花销不能把它压成 0**(投资助手聊天面板曾用全部历史去减月收入,恒为 0) |

## 日期

| 测试                                          | 保护的行为                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `shared/lib/localDate.test.ts`                | 「今天」用本地日期(`toISOString` 在 UTC+8 清晨会给昨天);`daysSinceLocalDate` 一天 24 小时都稳定 |
| `transactions/hooks/dateRangePresets.test.ts` | 本月/近 30 天/近 3 个月的边界(闰年、跨月、跨年),上个月最后一天不能落进本月                      |
| `shared/lib/subscriptionSchedule.test.ts`     | 续费推进按 UTC 日历运算(负时区不会跳月)、纯日期进纯日期出、时区无关                             |
| `features/assistant/model/weeklyExpenseTrend.test.ts` | 「本周 / 上周」按本地日历日分桶(0–6 / 7–13 天),**不按行号切**;乱序 + 稀疏数据(本周 2 笔、上周 5 笔)也要算对 |

## 状态与分类身份

| 测试                                                   | 保护的行为                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `shared/lib/categoryLabels.test.ts`                    | 分类显示名:同名加「父 / 子」;`buildCategoryLabelIndex` 只给**能唯一确定分类**的名字(加前缀后仍重名的排除) |
| `features/dashboard/model/categoryBreakdown.test.ts`   | 分类聚合身份是 **id 不是名字**;未知分类显示「未分类」而不是内部 id                                        |
| `financial-analysis/model/categoryAggregation.test.ts` | 同名子分类不合并、金额与占比各自独立                                                                      |
| `transactions/model/statusQuickFilter.test.ts`         | 缺省状态按「已完成」处理,与 `isBalanceAffectingStatus` 同一结论                                           |
| `store/uncategorizedCoherence.test.ts`                 | 「未分类」三处口径一致:数据用空串、筛选哨兵、助手计数                                                     |
| `subscriptions/model/subscriptionStatus.test.ts`       | 逾期判定按**本地日历日**:到期当天是「即将到期」,次日才「逾期」,与时区无关                                 |
| `store/defaultTransactionStatus.test.ts`               | 缺省状态 = 已完成:**写入侧也要落一个明确状态**(助手导入不传 status),筛选与显示共用同一个默认值             |
| `store/trashRefundPair.test.ts`                        | 回收站里的「支出 + 退款」是一对:删除把退款一起移走,**恢复也必须一起回来**;只恢复一条会让余额少掉退款那一笔   |
| `features/assistant/workbench/categoryFallback.test.ts` | 分类解析不出来时返回**空串**(走未分类),不许退回第一个分类(会静默归错类),也不许造 `cat-unknown`           |
| `features/smart-budget/model/budgetZeroBudget.test.ts`  | 预算为 0 却有支出:既是「超支」也是「执行率无上限(`>999%`)」,不能显示成 0.0% —— 同一行不能自相矛盾         |

## 数据完整性

| 测试                                           | 保护的行为                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `shared/lib/backup.roundtrip.test.ts`          | 备份**全字段**往返:导出 → JSON → 解析逐字段相等(曾丢 `parentId`、持仓代码/份额、AI 消息字段等 10 个)               |
| `store/importSnapshotInvariant.test.ts`        | 导入后:带 `trashedAt` 的行不留在主列表、同一 id 不重复(以回收站为准)、分类父子关系保留、余额按「影响余额的行」重算 |
| `store/trashSymmetry.test.ts`                  | 删除/恢复/永久删除对称:往返字段不少、余额对称、重复操作是空操作、主列表已有同 id 时恢复不会让记录消失              |
| `shared/lib/billImport.mergeInvariant.test.ts` | 重复导入不丢字段:来源里没有的字段(`status`/单号)不能把已有值覆盖成 `undefined`                                     |
| `shared/lib/transactionMetrics.test.ts`        | 汇总口径:待支付/已关闭/失败/已删除不计入;过滤结果与账户余额判据逐行相等                                            |
| `store/subscriptionRenewalRevert.test.ts`      | 删掉「生成支出」写出的流水时续费日要**精确退回**:月末 1/31 →(生成)2/28 →(删除)必须回到 1/31,不能倒推成 1/28;再生成只推进一期 |
| `server/orphanAccountReferences.test.js`        | **记录现状(待决策)**:账户被彻底删除后,其交易在整份导入时被丢弃。根因是 `account_id NOT NULL`;四个备选方案写在测试文件顶部 |

## 数据出入口的闭环验证

读代码、比字段清单都**抓不到**下面这类问题:界面上一切正常,数据其实不全。
这一节记的是「怎么真的跑一遍」,而不是某个测试文件。

### 为什么会需要

两个已修的真 bug,都是靠闭环验证(或它带出的自检)才发现的:

- **JSON 备份里没有负债与还款记录** —— 导出/导入两边字段清单都"对称",但两边都缺
- **App 自己导出的备份导不回来** —— 演示数据里账户 `type` 是 `ewallet`,而域类型里没有这个值,
  导入校验直接抛「枚举值不合法」。只有真的"导出再导回"才会撞上

### 三条可达路径与各自的验证方法

| 路径           | 怎么验(全部可本地完成)                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| 本地 JSON 备份 | 数据库页「导出备份文件」→ 再「导入备份文件」选同一个文件 → 应提示`备份导入成功`且**无自检告警**        |
| 服务器恢复点   | 「数据库」页「创建恢复点」→「恢复最近副本」→ 确认 → 提示里应列出全部范围(含`负债与还款`、`偏好与计划`) |
| SQL 导出       | 「下载 SQL 数据库」拿到 `.sqlite` → 用 `node:sqlite` 打开数行                                          |

数据库页底部还有一个**恢复后自检**(`verifyFinanceBackupRestore`):恢复完成后比对
「备份里写了多少条」与「真正落到状态里的有多少条」,少了就告警「哪一组、差几条」。

### SQL 导出的核对方法

```bash
# 下载的文件在浏览器下载目录里,用 Node 自带的 sqlite 打开即可(需要 Node >= 22)
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
  if (!/debt|transaction|account|categor|setting/.test(t.name)) continue;
  console.log(t.name, db.prepare('SELECT COUNT(*) AS c FROM ' + t.name).get().c);
}
" path/to/ledgerflow-*.sqlite
```

预期(演示数据):`ledger_transactions` 299 · `ledger_accounts` 6 · `ledger_categories` 23 ·
`ledger_debts` 3 · `ledger_debt_repayments` 4 · `ledger_subscriptions` 3 · `ledger_user_settings` 11。

### 两个容易误判的地方

- **SQL 导出里的行数比 API 多**:作用域编码在 **id 前缀**里(如 `7e522500-rep-1`),
  `ledger_debt_repayments` 这类表**没有 owner 列**。导出的 dump 含多个作用域的演示数据,
  而 `/api/data/bootstrap` 只返回当前用户那一个作用域 —— 计数对不上是正常的。
- **恢复点的状态是内联文本**(`.sync-tip`),不是 toast。想在浏览器里断言,要去读那段文本。

## 可访问性与 i18n 的闸门(命令式,不在上面那套里)

| 命令                                           | 作用                                                  |
| ---------------------------------------------- | ----------------------------------------------------- |
| `npm run i18n:check`                           | i18n key 缺失/单边/写死属性;命中即非 0 退出           |
| `npm run i18n:check-jsx`                       | JSX 文本节点里的硬编码中文;命中即非 0 退出            |
| `npm run check:dates`                          | 禁止 `date.slice(0, 10)`(按 UTC 取日);命中即非 0 退出 |
| `node scripts/audit-jsx-hardcoded.mjs --count` | 同上,只看数字(用于看趋势)                             |
| `npm run check:shared-predicates`               | 三条共享判断不许在别处手写:退款/冲正、是否计入余额的状态、金额取整;并按「文件+上一行+本行」精确豁免             |
| `npm run check:money`                           | 金额格式与取整的既有闸门                                                                                          |
| `npm run audit:ledger-math`                     | **账目口径体检**(需本地库):逐月收支、账户余额、余额变动链连续性、退款关联、分类父子、订阅→生成交易、净值恒等式 |
| `npm run audit:sums`                            | 列出所有对交易金额手工求和的地方,标出「在求和却没引用共享汇总」的高发区(不判失败,是复查清单)                 |
| `npm run check:docs`                            | 本文档自身的引用体检:提到的测试文件必须存在、表格列数要一致(文档指向空处比没有文档更糟)                     |

## 浏览器端页面体检(断言不了的那一类)

`npm run audit:ui` 会把 18 个路由 × 桌面(1440)/ 移动(390)跑一遍,量的是**只有真的渲染出来才存在**的一些事:

| 检查项                                 | 为什么单元测试抓不到                                             |
| -------------------------------------- | ---------------------------------------------------------------- |
| 整页横向溢出                           | 取决于布局,与 props 无关                                         |
| 元素越过视口右边界且不在横向滚动容器内 | 这类元素**既不滚动也点不到**,`overflow-x: hidden` 会把它静静裁掉 |
| 没有可读名称的 button / a              | 无障碍问题,只在 DOM 里                                           |
| 每个路由新产生的 console error         | 只有真跑起来才有                                                 |
| 字号 < 11px 的纯文本节点               | 只报告不计失败,看趋势                                            |

发现过的问题:`/balance-changes` 整页被内容最小宽度顶到 545px、右半侧被裁(见 v0.48.0 说明)。

已知误报(脚本里用 allowlist 排除):

- `/transactions` 移动端的 `.transaction-mobile-swipe` 里「删除 / 分享」在视口外 ——
  那是滑动手势的初始态,实际操作用卡片右上角「⋯」菜单
- SVG `<text>` 的 `className` 是 `SVGAnimatedString`,会被打印成 `[object SVGAnimatedString]`

**它不属于 CI 闸门**:需要先起后端与 dev server,还需要 playwright 与 chromium。

一条命令跑全套(起两个服务 → 等就绪 → 审计 → 收尾,端口被占用会直接报错而不是连到别人的服务上):

```bash
PLAYWRIGHT_MODULE=<path>/node_modules/playwright/index.mjs npm run audit:ui:local
```

需要单独调时再用下面这套。依赖这样装:

```bash
# 仓库依赖里没有 playwright;用 PLAYWRIGHT_MODULE 指向任意一份本地安装
PLAYWRIGHT_MODULE=<path>/node_modules/playwright/index.mjs npm run audit:ui
```

脚本会自己找仓库内、DSH profile 里的 playwright,找不到才报错并列出试过的路径。
注意**它用的那份 playwright 必须已经有对应的浏览器构建**(版本不匹配时会提示
`Executable doesn't exist ... chrome-headless-shell`),此时把 `PLAYWRIGHT_MODULE`
指向浏览器已下载的那一份即可。

## 已知但**故意不**当作 bug 的

- **纯中文数字不解析**(「欠款五千」「三千五」):属于**安全失败** —— 金额字段留空,
  由「待补字段」提示用户填写;比猜错强

- 账户名匹配微信/支付宝(`workbenchMapping`、`importAccount`):故意的启发式
- 标签按字符串统计:标签本身就是字符串,重名合并是语义正确的
- 分类占比/投资占比各自独立取整,合计可能是 99.9%:显示层通病,修需要重新分配(会改动用户看到的数字),暂不处理
- 账单识别:一边有订单号、另一边没有时会判成两笔(跨来源同一笔消费可能重复记账)—— 既有设计取舍
