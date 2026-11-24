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
| `transactions/model/statusLabel.test.ts`               | 状态列显示同一套默认值:缺状态显示「已完成」而不是「-」(否则「筛得出来却看不出状态」)                       |
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
| `server/subscriptionPrevDate.test.js`           | v9 的 `prev_renewal_date` / `prev_expire_date` 在服务端三层都通:建表、迁移、写入与读回 |

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

### 更强的一层:导出 → 恢复之后逐字段对比数据库

「无自检告警」只证明**条数**对得上。要证明**每个字段**都对得上,得在往返前后各 dump 一次
再 diff(演示账本做过一次,结论是没有任何数据差异):

1. 停掉服务,备份 `data/ledgerflow.sqlite`;
2. dump 一份「该用户全部账本数据」当基线;
3. 起服务,在数据库页「导出备份文件」→ 再「导入备份文件」选同一个文件;
4. 再 dump 一次,diff 两份。

对比时**必须处理三件事**,否则会把正常现象误读成数据丢失(实测会报出 67 处,其中 65 处是噪声):

- **时间戳列会被重写**(`*_at` / `*_time`):恢复按「现在」写,不算数据差异;
- **`ledger_debt_repayments` 这类表没有 owner 列**:dump 时要按外键(`debt_id`)过滤,
  而且**过滤顺序要紧** —— 它同样有 `transaction_id`,但那些值可能全是 NULL,
  先按 `transaction_id` 过滤会得到**假 0 行**,对比时看起来「两边都没有」;
- **`entry_mode` 会从 NULL 归一成 `'standard'`**:这是归一化器有意的映射
  (`item.entryMode === 'simple' ? 'simple' : 'standard'`),而且全部 18 处判断都只比
  `'simple'`,所以 NULL 与 `'standard'` 行为完全一致 —— 不是差异。

### 两个容易误判的地方

- **SQL 导出里的行数比 API 多**:作用域编码在 **id 前缀**里(如 `7e522500-rep-1`),
  `ledger_debt_repayments` 这类表**没有 owner 列**。导出的 dump 含多个作用域的演示数据,
  而 `/api/data/bootstrap` 只返回当前用户那一个作用域 —— 计数对不上是正常的。
- **恢复点的状态是内联文本**(`.sync-tip`),不是 toast。想在浏览器里断言,要去读那段文本。
- **`auth_*` 表的 `user_id` 是 `auth_users.id`,不是 ledger 用户 id**。按后者去查
  `auth_sessions` / `auth_password_reset_tokens` / `auth_audit_log` 会得到「全是别人的行」这种
  假警报 —— 我自己就这么误判过一次(见下)。导出侧对这三张表是按 `auth_users.id` 剪的
  (`pruneSqliteDatabase`),是对的。

### 「下载 SQL 数据库」的作用域(验过)

实测过一次(先造一个第二用户并写入一笔特征金额 `31415.92`,再以演示账号导出):

- 导出 33 张表(线上 34 张,差的是 `sqlite_sequence`,被 `NOT LIKE 'sqlite_%'` 排除)✓;
- 演示账号的数据完整:交易 298、账户 6、分类 21、settings 11 ✓;
- **全表兜底:不属于演示账号的行合计 = 0**(含 `auth_sessions` / `auth_password_reset_tokens` /
  `auth_audit_log`)✓;第二用户那笔特征交易与特征金额都不在文件里 ✓。

也就是说这个出口按 `user_id`(认证表按 `auth_users.id`)把多租户库剪成了单账号快照,
不会把别人的数据交到用户手里。

### 多用户隔离(验过,方法与结论如下)

「另一个账号看不到我的数据」这件事不该靠假设。整套机制是三层的:

1. **服务端 id 作用域**(`server/ledgerIdScope.js`):每个 id 加 8 位用户哈希前缀
   (`7e522500-acc-cash`),涉及 14 个 id 字段(`accountId` / `categoryId` / `parentId` /
   `refundOfTransactionId` / `lastGeneratedTransactionId` …)。写入时按会话用户加前缀,
   读取时剥掉 —— 所以拿别人的 id 写入只会变成自己名下的一条新记录,不是串数据。
2. **浏览器不缓存账本**:localStorage 里只有 `i18nextLng`、`ledgerflow-preferences`
   (仅 `theme` / `accentTheme`)、部署标识与看板密度,**没有任何交易/账户/负债数据**。
   所以「同一浏览器切换账号」不会把上一个账号的数据带过来。
3. **页面按会话取数**:数据来自 `/api/data/bootstrap`,按会话用户过滤。

复验方法(本地可完成,自助注册关闭时直接建库行、复用演示账号的密码哈希):

- 建两个临时用户 → 以 A 登录(让数据进浏览器)→ **用界面正常登出**(顶栏账号菜单 →
  退出登录)→ 直接以 B 登录(**故意不清 localStorage**)→ B 应显示自己的空账本
  (`当前账号 · 使用空白账本`、`¥0.00`、`还没有任何账目记录`),看不到 A 的净资产;
- 库里核对:`SELECT COUNT(*) FROM ledger_transactions WHERE user_id != <A> AND id LIKE '<A 前缀>%'`
  应为 **0**(A 的行没有跑到别人名下)。

实测(2026-11-24):A 的 ¥29.6 万净资产在 B 的会话里完全不出现,B 名下只有自己的默认账户/分类,
带 A 前缀的行出现在其他用户名下的条数为 **0**。

**一个已知但当前不可达的边界**:`scopeLedgerId` 会把 id 截断到 64 字符(留给原 id 55)。
两个前 55 字符相同的超长 id 会撞成同一条 —— 但客户端 id 最长 48 字符
(`investment-position-history-<时间戳>-<6 位随机>`),够不到阈值;而且写入全是普通 `INSERT`
(没有 `OR REPLACE`),真撞上会报主键错误而不是静默覆盖。若将来引入外部超长 id,这里要重新评估。

### 边界数据(验过,干净)

金额与日期走到极值时有两条路径要分开看:**钱算得对不对**、**界面会不会崩**。两组都实测过:

往一个临时用户推 5 笔病态数据(通过 `/api/data/import`,绕过客户端校验以便直接压服务端):

| 用例 | 值 |
| --- | --- |
| 最早日期 | `1970-01-01` |
| 最晚日期 | `2099-12-31` |
| 上限金额 | `999999999.99`(与 `TransactionEditPage` 的 `MAX_AMOUNT` 一致) |
| 零金额 | `0` |
| 正常对照 | 一笔普通收入 |

结果:

- **钱这一层**:`npm run audit:ledger-math --email=<该用户>` 通过 —— 1970-01 / 2026-11 / 2099-12
  三个分桶正常,净值恒等式自洽(账户 + 投资 − 负债 == 净值),余额链连续;
- **界面这一层**:交易流水 / 财务分析 / 余额变动 / 首页四个页面**没有 `NaN`、`undefined`、
  `Infinity`,0 个控制台错误**,1970 与 2099 的日期正常渲染;
- 客户端本来就有上限:金额 `MAX_AMOUNT = 999999999.99`(编辑页校验)、分类/账户名 `maxLength`、
  快捷记账拒绝 `amount <= 0`。

一个**测试自身的产物**值得记下,否则会误判成 bug:绕过客户端直接写库时,账户的
`balance` 缓存与「按流水重算」的值会不一致,`balance_changes` 也不会生成 —— 脚本会把这两条
报成**提示(不算失败)**,并写明「通常是绕过客户端直接写库留下的」。这是对的:那张表由客户端
写入,应用每次载入会按流水重建,不参与读数。

## 已复现、但**待决策**的问题
这一节记的是**真问题**,不是「刻意设计」。它们卡在同一个地方:修法涉及产品语义,不该由改代码的人单方面定。

### 1. 整份快照同步会**静默删掉**另一个客户端的写入(2026-11-24 复现)

**机制**:`SqlDataSyncGate` 在本地数据变化后防抖 500ms,把**整份本地快照** `PUT /api/data/import`;
服务端 `replaceRelationalData` 先 `clearUserData`(**删掉该用户全部行**)再按快照重插。
而客户端**推之前不重新拉取**、也没有版本/时间戳比对 —— 于是「拿着旧快照的客户端一推,
就把另一个客户端在这个窗口里写的行删掉了」,不报错、不提示。

**严格复现(两步,中间查库排除「A 根本没写进去」这种解释)**:

1. 同一浏览器开两个标签页(同一会话),**都加载完成**;
2. 标签 A 快速记一笔 333 → 等 8 秒 → 查库:**333 已在库里**;
3. 标签 B(其状态里确实没有 333,已核实)记一笔 444 → 等 6 秒;
4. 查库:只剩 444,**333 消失**。

**可达性**:两个标签页、或同一账号在两台设备上(手机记一笔、电脑再记一笔)。窗口是
「另一个客户端从加载到这次写入之间」——日常使用就能撞上。

**为什么没有直接修**:三种修法各有语义后果,需要产品决定:

- **A. 服务端做合并**(upsert + 只删客户端显式标为删除的行):需要客户端带删除墓碑,否则
  「A 删掉的一行」会被 B 的旧快照**复活**;
- **B. 乐观并发**:快照带 revision,服务端发现自己的更新则 409;客户端已有 409 的处理路径
  (暂停同步 + 「同步冲突」提示),但**用户那一笔就存不下去**了,得再设计「拉取最新 + 重放本地改动」;
- **C. 最小且不改语义**:推送前先比一次服务端状态,发现别的客户端写过就**不推**、
  提示用户刷新 —— 把**静默丢失**变成**可见且可恢复**,代价是并发时同步会停。

倾向 C 作为第一步(不丢数据、不改删除语义),后续再考虑 B 的「拉取 + 重放」。
**在你定之前不改** —— 这条路径的任何改动都会影响用户的账目数据。

### 2. 同类待决事项(细节见各自章节)

- **「预算」型交易算不算支出**:`transactionMetrics.isExpenseLike`(含 `budget`)与
  `dashboard/model/utils.isActualExpenseType`(不含)结论相反,首页一屏内两个数字自相矛盾;
- **彻底删除账户会静默删掉其交易**:根因 `account_id NOT NULL`,四方案见
  `server/orphanAccountReferences.test.js` 顶部。

### 3. `/api/data/import` 返回 200 **不等于**「全都写进去了」

导入按 id 校验引用:引用的账户/分类不在本次 payload 里时,那一行会被**静默丢弃**,
接口仍然回 `200 { ok: true, counts: {...} }`。实测:推一份含 1 个账户 + 1 笔交易、
但交易引用的账户不在同一次 payload 里的快照 → 返回 200,而 `counts.transactions` 是 **0**。

这不是 bug(避免写入悬垂引用是对的),但**任何调用方都必须读 `counts`**,别把 200 当成功。
客户端侧的保护:

- 「数据与备份」的**文件恢复**有 `verifyFinanceBackupRestore` 自检,会比对「备份里写了几条」
  与「真正落到状态里几条」,少了就告警;
- 自动同步那条路径由客户端自身状态一致来保证引用可解析 —— 触发不了这个丢弃。
  唯一的例外就是上面第 2 条那个「彻底删除账户」的待决问题:**它就是靠这个机制丢交易的**。

顺带记两个已经验过、**没问题**的点(免得以后重复怀疑):

- **导入是事务**:`replaceRelationalData` 用 `begin` / `commit`,失败 `rollback` ——
  中途失败不会留下半写账本;
- **读失败不会推空状态**:初始读取失败时 `ready` 不置真,而自动推送的 effect 开头就是
  `if (!ready) return`,所以「客户端拿空状态覆盖服务端账本」这条最可怕的路径是断的;
- **把分类移入回收站时会清掉引用**:同用户的交易 `categoryId` 被置空、子分类提升为一级,
  所以不会产生「交易引用已删除分类」的悬垂引用。

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

以下几条是 v0.50.5 之后逐条核对过的。它们**看起来**像同类 bug,但都是刻意的 —— 记在这里,
免得以后有人为了「统一」把它们互相对齐而改坏:

- **订阅有两个日期,各管一件事**:状态徽标(正常/即将到期/已到期)看 **expireDate**,
  而卡片上的「续费/提醒 + 日期」、首页「续费已逾期」、财务分析的 due-soon 计数看 **renewalDate**。
  「expireDate 优先」有专门测试钉着(`subscriptions/model/subscriptionStatus.test.ts`)。
  两个日期相差很远时,同一订阅会在两屏得到不同结论 —— 那是两个不同的问题,不是两套口径。

- **分类名有三套判定键,用途不同**:store 的 `findDuplicateCategory`(归一空白 + 小写)是
  **身份判定**;助手的 `toLooseCategoryKey`(再去标点)是**模糊匹配**,把严格键换成它会让
  助手匹配率下降、账单大量落到「未分类」;预算模块的键更宽松(只 trim + 小写),目前等价,
  因为分类名在创建时就已归一 —— 这条前提由 `npm run audit:ledger-math` 的分类名归一检查守着。

- **`shared/lib/dataSync.ts` 整个是空壳**:`syncChangeIfNeeded` 什么都不做,而 store 里有
  18 处调用它。数据真正靠 zustand persist(本机)与 SqlDataSyncGate 的**防抖整份同步**落地。
  不要基于「这行已经同步了」写新逻辑。

- **`row.ratio` 在预算模块有五种渲染**:整数 %(AI 面板)、一位小数 %(列表/抽屉)、
  `>999%`、以及两处进度条上限 160 与 100。这是显示精度取舍,不是算错。

- **账户被彻底删除后,其交易会在整份导入时被丢弃**:根因是 `account_id NOT NULL`
  (「不属于任何账户的交易」在库里表示不了),而删除账户的确认框写的是「交易仍会保留」。
  **这是待决策的冲突**,不是可以顺手改的地方 —— 四个备选方案见
  `server/orphanAccountReferences.test.js` 顶部。

- **「月收入」有两个来源,可能不一致**:登记月收入(`preferences.monthlyIncome`,还款管理用它算
  负债率、助手用它做上下文、投资页用它算可投资现金)与**预算方案里的那个数**
  (`recommendation.monthlyIncome`,是生成方案时的快照)。v0.50.27 之后向导会用登记值**预填**,
  但方案一旦生成就固定了 —— 用户之后改了收入,两页会显示不同的「月收入」
  (演示账本正是如此:方案 10,000 / 登记 26,000)。方案是快照,这是取舍不是 bug;
  要不要在方案页提示「与当前登记收入不一致,建议重新生成」属于产品决定。
