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

| 测试                                                       | 保护的行为                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/lib/money.test.ts`                                 | 取整只有一个实现:`1.005 → 1.01`、负数 `.5` 远离零、幂等(含 `-0`)、非法值退化为 0、先求和再取整 == 先取整再求和                                                                   |
| `store/refundInvariant.test.ts`                            | 退款总额不得超过原交易金额:创建时拒绝、**编辑时也拒绝**(否则账户净额凭空多钱);导入/恢复可走 `allowRefundOverflow` 逃生门                                                         |
| `store/refundInference.test.ts`                            | 缺 `adjustmentKind` 时的方向推断:明确写了就不推翻;**不能**因为 `status: 'refunded'` 就把原交易当成退款(会把余额算成两倍)                                                         |
| `investments/model/investmentSimulator.invariants.test.ts` | 定投模拟全程不取整:投入 = 每期 × 期数、利润/收益率自洽、**线性**(金额翻倍则结果精确翻倍)、非法输入返回 null                                                                      |
| `shared/lib/expenseScope.contract.test.ts`                 | 「支出」口径**已统一**:`isExpenseLike` 与 `isActualExpenseType` 都是 支出+还款,**预算型不算支出**(2026-11-24 定案,依据是全项目 5 处不计入对 1 处计入)。谁再让两边不同,这里先翻红 |
| `features/debt/model/creditDrafts.rounding.test.ts`        | 信用草稿金额解析走共享取整:`2675.675 → 2675.68`(解析器曾原样返回三位小数);口语单位(`1万5` / `1万零500`)组合后同样不留三位小数                                                    |
| `features/investments/model/monthlyCashflow.test.ts`       | 「本月可投资现金」一份实现:按月取、退款抵减、排除不计入余额的状态;**上个月的花销不能把它压成 0**(投资助手聊天面板曾用全部历史去减月收入,恒为 0)                                  |

## 日期

| 测试                                                              | 保护的行为                                                                                                                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/lib/localDate.test.ts`                                    | 「今天」用本地日期(`toISOString` 在 UTC+8 清晨会给昨天);`daysSinceLocalDate` 一天 24 小时都稳定                                                                                        |
| `transactions/hooks/dateRangePresets.test.ts`                     | 本月/近 30 天/近 3 个月的边界(闰年、跨月、跨年),上个月最后一天不能落进本月                                                                                                             |
| `shared/lib/subscriptionSchedule.test.ts`                         | 续费推进按 UTC 日历运算(负时区不会跳月)、纯日期进纯日期出、时区无关                                                                                                                    |
| `features/assistant/model/weeklyExpenseTrend.test.ts`             | 「本周 / 上周」按本地日历日分桶(0–6 / 7–13 天),**不按行号切**;乱序 + 稀疏数据(本周 2 笔、上周 5 笔)也要算对                                                                            |
| `features/investments/model/usExtendedSession.test.ts`            | 美股盘前/盘后倒计时:盘前 04:00–09:30、盘后 16:00–20:00(美东);**周五收盘后的「距下个盘前」是 66 小时不是 18**;09:30 整点算盘前结束、16:00 整点算盘后开始;夏令时切换日 09:00 ET 仍是盘前 |
| `features/investments/components/UsExtendedSessionStrip.test.tsx` | 盘前盘后条:状态写在文字里(进行中 / 距开始 / 距下个盘前),**不加 `aria-live` 也不加 `role="timer"`** —— 每秒播报倒计时会淹没读屏器                                                       |
| `shared/lib/i18nDate.test.ts`                                     | `formatIsoDay` 把 `YYYY-MM-DD` 当**本地日**算:在 `America/New_York` 里直接 `new Date('2026-11-27')` 会渲染成 11 月 26 日(测试里带这条阳性对照),关于页的发布日期就用它                  |

## 状态与分类身份

| 测试                                                    | 保护的行为                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `shared/lib/categoryLabels.test.ts`                     | 分类显示名:同名加「父 / 子」;`buildCategoryLabelIndex` 只给**能唯一确定分类**的名字(加前缀后仍重名的排除)  |
| `features/dashboard/model/categoryBreakdown.test.ts`    | 分类聚合身份是 **id 不是名字**;未知分类显示「未分类」而不是内部 id                                         |
| `financial-analysis/model/categoryAggregation.test.ts`  | 同名子分类不合并、金额与占比各自独立                                                                       |
| `transactions/model/statusQuickFilter.test.ts`          | 缺省状态按「已完成」处理,与 `isBalanceAffectingStatus` 同一结论                                            |
| `transactions/model/statusLabel.test.ts`                | 状态列显示同一套默认值:缺状态显示「已完成」而不是「-」(否则「筛得出来却看不出状态」)                       |
| `store/uncategorizedCoherence.test.ts`                  | 「未分类」三处口径一致:数据用空串、筛选哨兵、助手计数                                                      |
| `subscriptions/model/subscriptionStatus.test.ts`        | 逾期判定按**本地日历日**:到期当天是「即将到期」,次日才「逾期」,与时区无关                                  |
| `store/defaultTransactionStatus.test.ts`                | 缺省状态 = 已完成:**写入侧也要落一个明确状态**(助手导入不传 status),筛选与显示共用同一个默认值             |
| `store/trashRefundPair.test.ts`                         | 回收站里的「支出 + 退款」是一对:删除把退款一起移走,**恢复也必须一起回来**;只恢复一条会让余额少掉退款那一笔 |
| `features/assistant/workbench/categoryFallback.test.ts` | 分类解析不出来时返回**空串**(走未分类),不许退回第一个分类(会静默归错类),也不许造 `cat-unknown`             |
| `features/smart-budget/model/budgetZeroBudget.test.ts`  | 预算为 0 却有支出:既是「超支」也是「执行率无上限(`>999%`)」,不能显示成 0.0% —— 同一行不能自相矛盾          |

## 数据完整性

| 测试                                           | 保护的行为                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/lib/backup.roundtrip.test.ts`          | 备份**全字段**往返:导出 → JSON → 解析逐字段相等(曾丢 `parentId`、持仓代码/份额、AI 消息字段等 10 个)                                                                                                                                                             |
| `store/importSnapshotInvariant.test.ts`        | 导入后:带 `trashedAt` 的行不留在主列表、同一 id 不重复(以回收站为准)、分类父子关系保留、余额按「影响余额的行」重算                                                                                                                                               |
| `store/trashSymmetry.test.ts`                  | 删除/恢复/永久删除对称:往返字段不少、余额对称、重复操作是空操作、主列表已有同 id 时恢复不会让记录消失                                                                                                                                                            |
| `shared/lib/billImport.mergeInvariant.test.ts` | 重复导入不丢字段:来源里没有的字段(`status`/单号)不能把已有值覆盖成 `undefined`                                                                                                                                                                                   |
| `shared/lib/transactionMetrics.test.ts`        | 汇总口径:待支付/已关闭/失败/已删除不计入;过滤结果与账户余额判据逐行相等                                                                                                                                                                                          |
| `store/subscriptionRenewalRevert.test.ts`      | 删掉「生成支出」写出的流水时续费日要**精确退回**:月末 1/31 →(生成)2/28 →(删除)必须回到 1/31,不能倒推成 1/28;再生成只推进一期。**回收站可逆**:删除时保留 `prev*` 快照与关联,恢复时把日期推回生成后的状态(否则再生成会为同一周期重复记一笔),**彻底删除**才清掉它们 |
| `server/orphanAccountReferences.test.js`       | **记录现状(待决策)**:账户被彻底删除后,其交易在整份导入时被丢弃。根因是 `account_id NOT NULL`;四个备选方案写在测试文件顶部                                                                                                                                        |
| `server/subscriptionPrevDate.test.js`          | v9 的 `prev_renewal_date` / `prev_expire_date` 在服务端三层都通:建表、迁移、写入与读回                                                                                                                                                                           |

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

恢复点是**破坏性**功能,它的交互设计是可接受的(读过一遍,不是靠跑):确认框用 `danger` 样式,
正文写明「将用数据库最新快照**覆盖**当前本地数据。建议确认已经导出本地备份后再继续」,
并且**显示快照的时间与大小** —— 用户能判断「这份快照是三天前的,之后的记录会没」。
底层机制由三个已单独验证过的部件组成:快照内容用同一个 `createScopedBackupPayload` 生成、
恢复走同一个 `applyFinanceBackupPayload`(带自检)、回写走同一个替换语义的导入。

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

### 批量操作(验过,干净)

两条批量路径都走过一遍,结论是它们复用了已经验证过的单条逻辑,没有自成一套:

- **批量删除**(`pendingDeleteIds.forEach(id => removeTransaction(id))`):走的是**同一个**
  `removeTransaction` —— 所以退款级联(删原交易会把挂在它上面的退款一起移入回收站)也在。
  撤销路径就是回收站,而恢复同样会级联把退款带回来,两边对称。
  **一处显示层的少算**:提示写的是「已将 N 条交易移入回收站」,其中 N 是用户勾选的条数,
  不含被级联移走的退款 —— 不影响数据,只是数字偏小。
- **批量 AI 重分类**:AI 只返回**分类名**,再用 `buildCategoryLabelIndex` 的**唯一索引**换成 id;
  同名子分类被排除在这张索引之外(否则「餐饮/其他」和「交通/其他」会让它随机命中),
  换不到唯一 id 就退回按账单信息的规则推断、**绝不猜**。因此它不会写出不存在的分类 id ——
  也就不会触发上面那个「引用不可解析的行被服务端静默丢弃」的机制。

### 边界数据(验过,干净)

金额与日期走到极值时有两条路径要分开看:**钱算得对不对**、**界面会不会崩**。两组都实测过:

往一个临时用户推 5 笔病态数据(通过 `/api/data/import`,绕过客户端校验以便直接压服务端):

| 用例     | 值                                                            |
| -------- | ------------------------------------------------------------- |
| 最早日期 | `1970-01-01`                                                  |
| 最晚日期 | `2099-12-31`                                                  |
| 上限金额 | `999999999.99`(与 `TransactionEditPage` 的 `MAX_AMOUNT` 一致) |
| 零金额   | `0`                                                           |
| 正常对照 | 一笔普通收入                                                  |

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

- **「预算」型交易算不算支出** —— **已定案(2026-11-24,v0.50.36):不算**。
  原先 `transactionMetrics.isExpenseLike` 含 `budget` 而 `dashboard/model/utils.isActualExpenseType` 不含,
  首页一屏内两个数字自相矛盾。定案的依据不是偏好,而是**代码自己的一致行为**:

  | 面                                                       | 预算型算支出吗      |
  | -------------------------------------------------------- | ------------------- |
  | 首页「本月结余」(`isActualExpenseType`)                  | 不算                |
  | 智能预算 · 已花费(`budgetDetail.ts:87`)                  | 不算                |
  | 智能预算 · 洞察(`budgetInsights.ts:73`)                  | 不算                |
  | 分类预算明细                                             | 不算                |
  | 助手发给模型的账本合计                                   | 不算                |
  | `isExpenseLike`(经 `summarizeTransactions` 与财务分析页) | **算** ← 唯一的例外 |

  五比一,所以把那一处对齐到其余五处。注意**这不等于"预算型不影响余额"**:它照样写
  `transaction-budget` 余额变动,只是各处的「支出」统计不再把它算作花掉。

  `shared/lib/expenseScope.contract.test.ts` 现在钉的是**统一后**的契约(两边判定必须一致、
  预算型两边都不算);谁再让某个类型两边不同,那 4 条会先翻红。

### 3. PWA 安装提示:接上,还是删掉?(2026-11-25)

`shared/hooks/usePwaInstallPrompt.ts` 写好了,但**没有接到任何界面** —— 全仓没有地方调用它。
它现在是 `check:dead-exports` 里**唯一**的 `ALLOW` 项。

两条路,代价不同:

- **接上**:在设置或首页给一个「安装到桌面」的入口。需要设计入口位置与触发时机
  (浏览器只在特定条件下派发 `beforeinstallprompt`),还要处理"已安装 / 不支持"的状态;
- **删掉**:它就没用了。删掉之后 `check:dead-exports` 的 `ALLOW` 清单可以清空 ——
  那道闸门从此不需要任何豁免,更干净。

**倾向删掉**:一个写好了却没人调用的 hook,对用户是零价值,对维护者是持续的豁免项。
如果确实想要 PWA 安装入口,接上时应当连带补上"不支持时怎么办"的界面。

### 4. 账单里那 93 笔"中性"/转账行:导入成转账,还是继续跳过?(2026-11-25)

用演示账单实测:有 **93 笔**行的备注是 `/`(账单里的"不计收支"/转账标记)。现在导入时
**整行被跳过**(`isNeutralCashflowRow`),但这些行的**账户余额变动是真实的** ——
跳过意味着导进来的账本与账单的余额对不上。

- **导入成"转账"概念**:需要一个新的交易类型或一对转出/转入,还要决定它算不算支出、
  进不进分类统计、在余额变动里怎么显示;
- **继续跳过**:简单,但要接受"导入后余额与账单差一截",并最好在导入报告里**明确告诉用户**
  "有 N 笔不计收支的行被跳过"(现在只是静默跳过)。

**没有倾向**:这是纯粹的产品口径问题,两种都能自洽,取决于你想要的账本长什么样。

## 核对结论与度量记录(已查完、有结论 —— 不是待决策)

- **`npm run format:check` 全仓不过(349 个文件)—— 不要顺手跑 `npm run format`(2026-11-25 实测)**。
  `package.json` 里有 `format` / `format:check`(prettier),但这两个脚本**从来没有被任何地方引用**:
  不在 CI、不在文档、不在别的脚本里。实测 `npm run format:check` → **退出码 1,349 个文件不合格**。

  **这不是某一次改动造成的,是既有状态**:清单里包含大量与近期改动无关的文件
  (`ScrollProgressBar.tsx`、`Toast.tsx`、`src/test/quickAddUndo.test.ts` …)。
  也就是说这个仓库的自定义风格一直不是 prettier 的默认风格。

  **所以千万不要"顺手"跑 `npm run format`** —— 那会产生一个**349 个文件**的格式化 diff,
  把真正的改动埋掉、也让 `git blame` 失去意义。要么就**整体接受** prettier 风格
  (单独一个提交、单独一次 review、之后加进 CI),要么就**别动它**。

  同理,另外三个脚本也全仓零引用:`benchmark:database`、`brands:generate`、`test:watch`
  (前者是性能基线、中者是生成品牌图标、后者是开发用 watch,都属于"按需手动跑",不是坏掉)。

- **`check:shared-predicates` 曾被"注释里提到共享名"压制 —— 已修,并因此找出一个一直没被盯的例外(2026-11-25)**。
  这道闸门守的是"不许在别处重写已经共享出来的判断",其中一条判据是:

  ```js
  /adjustmentKind\\s*[!=]==?\\s*'refund'/.test(text) && !/isTransactionRefundLike/.test(text);
  ```

  后半个条件对**整份文件全文**做正则 —— 于是**注释里提一句** `isTransactionRefundLike` 就算"引用了",
  闸门直接放行。**实测**:同样两处违规(单边 refund 判断 + 本地重定义金额取整),
  注释里提到共享名 → **exit 0(放行)**;不提 → **exit 1(拦住)**。

  修法:匹配前先 `stripComments()`(把注释换成空格、**保留换行**所以行号不变)。
  注释既不能触发误报,也不能压制检查。判据的本意是"作者**用**了共享谓词",不是"作者**知道**它"。

  **修完之后立刻报出一处真实存在、却一直没被盯的重复实现**:
  `src/features/dashboard/model/utils.ts` 的 `isActualExpenseType` —— 而它自己的注释里还写着
  "改成一处要同时改另一处(`check:shared-predicates` **会盯着这两个名字**,契约测试钉着它们必须一致)"。
  那句话在修之前**不成立**(注释把检查压掉了);现在成立:代码进 `ALLOW` 并写明理由
  (与 shared 的 `isExpenseLike` 判定完全相同,「预算」型不算支出是 v0.50.36 的定案,
  `expenseScope.contract.test.ts` 钉着两者一致,该测试实测 4 条全过)。

- **发布链路的四道检查,其中"tag 与版本一致"做过真实弹测试(2026-11-25)**。
  发布出错一次就是"Release 写着 A 版本、内容却是 B 版本",而此前没有任何东西会拦。现在有四处把关:

  | 检查                                                           | 什么时候跑    | 查什么                                                                                           |
  | -------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
  | `check:version-sync`(CI)                                       | 每次推送      | `package.json` 的 version = `APP_VERSION`;当前版本有 `release-notes/RELEASE_NOTES_v<version>.md` |
  | `check:docs`(CI)                                               | 每次推送      | 文档里的 npm 脚本存在;compose 的环境变量都在 `.env.example` 里                                   |
  | **`release.yml` 的 `Verify tag matches package.json version`** | **打 tag 时** | **tag(去 v)= version,且 = `APP_VERSION`**                                                        |
  | `release.yml` 的 `Resolve release notes`                       | 打 tag 时     | 说明文件在 tag 指向的提交里(原本就有)                                                            |

  **实弹验证(2026-11-25)**:推了一个**故意错的** `v0.50.99`(当时版本是 0.50.54)—— 结果:

  | step                                        | 结果                       |
  | ------------------------------------------- | -------------------------- |
  | Checkout release tag                        | success                    |
  | **Verify tag matches package.json version** | **failure** ← 新加的那一步 |
  | Resolve release notes                       | **skipped**                |
  | **Publish GitHub Release**                  | **skipped**                |

  并且 `gh release view v0.50.99` → **release not found**:链条停在该停的地方,**一个 Release 都没发**。
  测试用的 tag 随后本地与远端都删干净了。

  **注意**:此后打任何 tag 之前,`package.json` 与 `APP_VERSION` 必须已经改成同一个版本 ——
  否则新这步会直接把发布拦下来(这是设计如此,不要为了让发布过关去删这一步)。

- **崩溃不再白屏:整个应用已包上错误边界(2026-11-25 新增,已端到端验证)**。
  此前 `main.tsx` 只有 `StrictMode`、`App.tsx` 只有 `Suspense`(管加载不管抛错),**没有错误边界** ——
  任何组件运行时抛错都会让整棵树卸载,用户看到的是一整页白屏,没有提示也没有按钮;如果错误是
  **确定的**(某条数据形状不对、每次渲染都抛),刷新后仍然白屏,连进设置修数据的入口都没有。

  现在 `src/app/ErrorBoundary.tsx` 包住 `<App />`:显示说明 + 「重新加载」按钮 + 可折叠的失败详情,
  并把错误与 `componentStack` 打到控制台。

  两个刻意的设计(改的时候别拆掉):
  · **样式全部内联** —— 崩溃时最可能的原因之一就是样式/资源没加载,崩溃页不能依赖应用的 CSS;
  · **文案不依赖 i18n 可用性** —— 先 `i18next.t(key)`,取不到(没 init / 缺键 / i18n 自己挂了)
  就用写死的兜底。**不要**改回 `defaultValue` 选项:实测在没 init 的环境里它返回**空串**,
  标题会是空的(这条是被测试逼出来的)。

  验证:新增 3 条测试(正常渲染 / 抛错显示兜底 / 记录日志);全量 **174 文件 1274 项**;
  **CI run 全绿** —— 其中 `verify` 1 分 43 秒、`docker-latest` **9 分 14 秒**(镜像里也确实打进去了)。
  也顺带印证了 `timeout-minutes: 40` 有余量(实测 9 分钟)。

- **五个钱相关领域都核对过了:交易 / 预算 / 负债 / 投资 / 助手(2026-11-25,最后一处是投资)**。
  投资层此前没查过。`src/features/investments/model/investmentSimulator.ts` 是定投推演,
  **不是只读代码,是拿手算用例跑了一遍**:

  | 输入                                       | 手算                                 | 实际   |
  | ------------------------------------------ | ------------------------------------ | ------ |
  | 每期 1000、价格点 10 与 20、区间内每天都买 | shares = 1000/10 + 1000/20 = **150** | ✓ 150  |
  |                                            | investedAmount = **2000**            | ✓ 2000 |
  |                                            | endingValue = 150 × 20 = **3000**    | ✓ 3000 |
  |                                            | profit = **1000**                    | ✓ 1000 |
  |                                            | returnRate = **0.5**                 | ✓ 0.5  |

  顺带确认实现里的几处关键取舍都对:价格 `> 0` 过滤(挡掉除零)、**股数不取整**(取整会漂移)、
  没有匹配到交易日的窗口**跳过那一期**、`endingValue` 用区间内**最后一个**价格。

  **至此五个钱相关领域都有结论**:

  | 领域                 | 结论                                                                          |
  | -------------------- | ----------------------------------------------------------------------------- |
  | 交易(创建/编辑/导入) | 创建有统一兜底(`createTransactionRow`);导入的参数传递出过 2 个真 bug(已修)    |
  | 预算                 | 智能预算核对干净(手工求和的候选点里,`budgetPlan` 的求和是"预算分配行",有理由) |
  | 负债                 | `creditDrafts` 的金额解析与取整干净,四个测试文件覆盖单位与取整                |
  | 投资                 | 定投推演**手算验证通过**(上表)                                                |
  | 助手                 | 金额路径走共享 `roundMoney`,不自己解析文本                                    |

  **所以"再去找计算 bug"的期望产出很低** —— 真 bug 集中在**输入格式**与**跨入口参数传递**。

- **创建交易有 8 处以上入口,但不会"跨入口不一致"—— store 层统一兜底(2026-11-25 核实)**。
  按"跨入口一致性"这个高产区去查:创建交易至少有这些入口 —— 快速记账、交易页表单、编辑页、
  分类/账户页、账单导入(两个页面)、AI 工具、助手工作台。看着很像会走形,但实际不会:

  `addTransaction` 内部统一走 `createTransactionRow`,由它在**一个地方**兜住字段:

  ```js
  amount: roundCurrency(payload.amount),                 // 金额取整(共用 roundMoney 的别名)
  adjustmentKind: payload.adjustmentKind || 'normal',    // 兜 normal
  status: payload.status ?? DEFAULT_TRANSACTION_STATUS,  // 兜状态
  updatedAt: payload.updatedAt || now,
  ```

  **而且这条兜底本身就是为了修一个同类 bug**:助手导入账单那条路径原来不传 `status`,
  库里就出现 `transaction_status` 为 NULL 的行(手工记账都会传 `completed`),列表显示成「-」、
  与筛选器口径不一致。现在写入侧不会再产出这种行(注释里写着来龙去脉)。

  **结论**:创建交易这条路是**结构性安全**的 —— 所以之前找到的两个"跨入口"真 bug 不在创建,
  而在 **导入时漏传参数**(设置页没传 categories)和 **AI 重分类被当成用户修正**。
  **下次查跨入口,别从"创建"入手**,从"同一功能的两条读/写路径把参数传全了吗"入手。

- **助手层(12,235 行)的金额路径抽样核对过 —— 干净(2026-11-25)**。
  这一层从没查过,而它会**创建交易**(「AI 识别账单、整理负债」),正是金额/分类类 bug 的高发区。
  抽样看了创建交易的入口 `agent/assistantAgentTools.ts` 与 `workbench/workbenchMapping.ts`:

  | 关注点                               | 结论                                                                                                      |
  | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
  | 有没有把 AI 返回的文本自己解析成数字 | **没有** —— 工具参数声明成 `type: 'number'`,不走 `parseFloat` 那套                                        |
  | 校验                                 | 有:`toNumber(item.amount)` → 判 `null`,再判 `Math.abs(amount) <= 0`                                       |
  | 取整                                 | **走共享**:`normalizeMoney` 是 `roundMoney` 的薄封装(`workbenchMapping.ts` 第 6 行 import),不是第二份实现 |
  | 本地 `toNumber` 算不算重复           | 不算:它返回 `null`(无效),而共享的 `toSafeNumber` 返回**回落值** —— 契约不同                               |

  **注意这是抽样,不是全审**(1.2 万行里只看了创建交易那条主路径)。要更彻底,可以按同样四个关注点
  扫 `agent/creditAgentTools.ts`(1507 行,写负债数据)与 `creditAssistant/parser.ts`(406 行,解析 AI 输出)。

- **负债草稿与助手解析层:抽样核对干净,且测试很齐(2026-11-25 续查)**。
  接着按"助手层抽样"那四个关注点往下走了两步,结论是**没有 bug,代码质量高于预期**:

  | 位置                                             | 结论                                                                                                                                                                                                                          |
  | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `creditAssistant/parser.ts`(406 行)              | **不做金额解析**,只做**正则字段提取**。流式预览因此天然安全:AI 输出还没写完时,正则匹配不到就是"没有该字段",不会崩。有 `parser.test.ts`                                                                                        |
  | `debt/model/creditDrafts.ts` 的 `positiveNumber` | 数值走 `isFinite && > 0`;字符串先剥 `[^0-9.-]`、再判 `parsed <= 0` 直接返回 undefined(负数被拒);**带中文单位会按「万」放大**(`1.5万 -> 15000`),注释写明。`integerPositive` 还专门处理了 `0.4 -> 0` 与 `repaymentDay=0` 的矛盾 |
  | 该模块的测试                                     | **四个**测试文件:`.test` / `.rounding` / `.units` / `.periods` —— 正好覆盖单位与取整                                                                                                                                          |

  **数据点**:这一趟连续三处抽样(助手主路径、负债解析、负债草稿)都是干净的。这说明**钱与日期这两层在本仓库整体是被认真对待的** ——
  前面找到的真 bug 集中在**输入格式**(账单文件的 xlsx/csv)与**跨入口一致性**,而不是计算本身。

- **文档层已全部核对过一遍(2026-11-25,结论与修法都在这里)**。
  这个会话把仓库里**所有**面向人的文档都读了一遍,并核对"文档说的事"与"仓库实际"是否一致:

  | 文档                           | 结论                                                                             |
  | ------------------------------ | -------------------------------------------------------------------------------- |
  | `docs/HANDOVER.md`             | 标题版本停在 v0.50.4 → 已更新;内容逐节核对过                                     |
  | `docs/release-process.md`      | 「回填」一节过时(我自己删 Release 页面造成)→ 已更正                              |
  | `docs/i18n-hardcoded-audit.md` | 引用已删的组件 → 已在顶部加注"这些文件已被删除"                                  |
  | `docs/UI动画优化总结.md`       | 引用的 `useUIAnimations.ts` 已不存在 → 已加注"历史记录,照抄会失败"               |
  | `docs/verification-recipes.md` | 闸门数写错(10 vs 实际 9)→ 已改;并新增"文档里的 npm 脚本是否存在"检查             |
  | `docs/verified-invariants.md`  | 本文档,持续补充                                                                  |
  | `docs/pruned-releases.md`      | 新写,内容与 GitHub 实际 Release 列表核对过                                       |
  | `README.md`                    | 「功能亮点」是逐版本 changelog,停在 0.8.9 → 已加指路牌(不补写,避免编造)          |
  | `.env.example`                 | 与 `docker-compose.yml` **同步**(26 个变量一个不漏)                              |
  | `CHANGELOG.md`                 | **当前**:到 v0.50.54(由 `generate-changelog.mjs` 从 release-notes 生成,不要手改) |
  | `release-notes/`               | **当前**:`0.50.x` 共 55 份(v0.50.0 – v0.50.54)                                   |

  **六处更新、五处确认干净** —— 而**每一处都是"读一遍才发现"的**,不是猜的。
  共同规律仍然是那条:**"记录"和"实际"会各自漂移,而漂移的地方没人看**。

- **文档里引用的文件路径:量过一遍,4 处失效都是"历史记录",没有接成闸门(2026-11-25)**。
  18 份文档里共 **107 处**带目录前缀的路径引用,失效 6 处 —— 但**只有 4 处是真的**(另两处是我正则的假阳性:
  `src/pages/占位符/占位符Page.test.tsx` 是占位符、`server/*.test.js` 是 glob)。

  4 处真失效里,3 处落在这个会话删掉的死文件上(`useSyncStore.ts` / `DashboardTopTransactionsCard.tsx` /
  `NetAssetCurveCard.tsx`,都在 `docs/i18n-hardcoded-audit.md` 里 —— 那份文档已加过"这些文件已被删除"的注);
  **第 4 处是新发现的**:`docs/UI动画优化总结.md` 多次提到 `src/shared/hooks/useUIAnimations.ts`,
  而全仓搜不到这个文件,hooks 目录现在只有 `usePwaInstallPrompt` / `useResolvedTheme` /
  `useUnsyncedChangesGuard`。已在该文档顶部加注:这是历史记录,照抄里面的路径会失败。

  **没有接成闸门**:要接就得给这 4 条历史引用配 ALLOW,而它们永远不会"恢复" —— 机制成本大于收益。
  **但这事量过了**:以后真有人删文件,可以用同样的办法扫一遍(正则要排除占位符与 glob,否则会有假阳性)。

- **审计脚本也要做"破坏性验证"(2026-11-25 两次都是靠它)**。
  光看代码或看退出码**不够** —— 这轮的教训具体是:
  · `audit:sums` 跑起来 exit 0,我据此推出"它永远不会失败";实测造一个违规文件后是 **exit 1**,推断错了;
  · `check-dynamic-i18n` 删掉一个**动态拼接**的键(两份语言都删)后,所有闸门与 1271 项测试**全过** ——
  确认是真缺口,补上键族后才会失败;
  · `check:shared-predicates` 的"注释压制"也是这么发现的。
  **做法**:造一个**最小的违规**放进去,跑闸门看它**是否失败**;再删掉确认它恢复通过。
  已按这个方法查过的对象(每一条都有实测结论):

  | 对象                      | 结果                                                                                                 |
  | ------------------------- | ---------------------------------------------------------------------------------------------------- |
  | `audit:sums`              | 会失败(exit 1、点名、写出两条修法)—— 我原本从"跑起来是 0"推断它不会失败,错了                         |
  | `check-dynamic-i18n`      | **真缺口**:两份语言都删掉一个**动态拼接**的键后,所有闸门与 1271 项测试全过 → 已补键族                |
  | `check:shared-predicates` | **真弱点**:注释里提一句共享名就把检查压掉 → 已改成先剥注释                                           |
  | `check:date-usage`        | **真缺口**:`tx.date.slice(0,10)` 拦住,而解构后的裸 `date.slice(0,10)` **放行**(同一个 bug)→ 已补判据 |

  两个缺口的共同形状:**判据写的是"某一种写法",而同一个错误换个写法(解构、加注释)就绕过去了**。
  所以破坏性验证时不要只试"文档里写着的那种写法" —— 试**同义的另一种写法**。

  **2026-11-25:CI 里的闸门已全部核实过一遍**(每个都有下面之一:实测会拦 / 抓到过真问题 / 发现并修掉缺口):

  | 关卡                                                             | 依据                                                                            |
  | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
  | `tsc --noEmit` / `npm run lint`                                  | 本次加规则后立刻报出 62 条(扣掉误报剩 1 条真问题)                               |
  | `npm test` / 服务端测试                                          | 本次多次因我改坏而失败(服务的 `toMysqlDate`、契约测试等)                        |
  | `i18n:check`                                                     | 实测:去掉 zh 侧一个键 -> 失败;删掉 JSX 用到的 `accentLabel` -> 失败             |
  | `i18n:check-jsx`(=`audit-jsx-hardcoded --fail`)                  | 实测:JSX 文本节点写死「今日财务雷达」-> exit 1 并点名文件:行;不带 `--fail` 则 0 |
  | `check:dates`                                                    | 实测:两种写法都 exit 1(解构那条是这轮补上的缺口)                                |
  | `check:money`                                                    | 实测:JSX 里写 `¥{value.toFixed(2)}` -> exit 1                                   |
  | `check:shared-predicates`                                        | 实测:注释可压制(已修);修后能报出真实的重复实现                                  |
  | `check:docs`                                                     | 实测:抓到我自己写坏的表格                                                       |
  | `check:audit-routes`                                             | 实测:加一条 `/probe-route` -> exit 1 并说明没被审计覆盖                         |
  | `audit:sums`                                                     | 实测:造违规文件 -> exit 1 并写出两条修法                                        |
  | `check:dynamic-i18n`                                             | 实测:动态键两份都删 -> 失败(这是这轮补的缺口)                                   |
  | `check:orphan-methods` / `check:dead-exports` / `check:r2-fetch` | 写它们时就各自证伪过一次(见本文档对应条目)                                      |

  **顺带一个反例**:`check:jsx-hardcoded` 曾被"接进"CI —— 但它和 `i18n:check-jsx` 是**同一条命令**,
  于是同一个脚本跑了两遍(已撤)。"东西在、没接上"的反面是"**接上了,又接了一遍**":
  接一个能力之前,先确认它是不是**已经**被人接过。

- **`audit:sums` 是真闸门(会失败),不是"只打印清单" —— 已证伪验证(2026-11-25)**。
  它的输出看起来像一份**清单**(列出手工求和的地方 + ⚠ 标出没引用共享汇总的),而且跑起来
  `exit 0` —— 我据此推断"它永远不会失败,新出现一个 ⚠ 文件没人会知道"。**这个推断是错的**:

  脚本里写着"从「清单」升级成「闸门」:被标 ⚠ 的文件必须在下面给出一条**显式理由**,否则非 0 退出",
  并且有 `JUSTIFIED` 清单(`budgetPlan.ts` 在里面,理由是"这里求的是预算分配行,不是交易行")。
  它这次 `exit 0` 是因为**唯一的 ⚠ 文件已经写了理由** —— 行为正确。

  **实测证伪**:临时造一个"手工求交易金额、不引用共享汇总、也不在 JUSTIFIED 里"的文件 ——

  | 状态     | 结果                                                                      |
  | -------- | ------------------------------------------------------------------------- |
  | 假文件在 | **exit 1**,点名 `src/shared/lib/__probe-handrolled-sum.ts`,并写明两条修法 |
  | 删掉后   | exit 0                                                                    |

  所以:CI 里这道闸门**会拦住**新出现的口径漂移(它就是为那次"按月汇总忘了排退款、演示账本多算 ¥781.10"
  立的)。**记这条是为了省下重复推断** —— 也提醒:退出码要**实测**过才算结论,别从"跑起来是 0"推出"它不会失败"。

- **`server/` 与 `scripts/` 现在也 lint 了 —— 之前它们完全没静态检查,并且真的藏了一个 bug(2026-11-25)**。
  查 `eslint.config.js` 时发现它的 `files` 只匹配 TS/TSX,而 `tsconfig` 也只 `include: ["src", "vite.config.ts"]` ——
  也就是说 `server/*.js`(含 12+ 个测试文件)与 `scripts/*.mjs`(约 20 个)**既不过 eslint、也不过 tsc**。

  **给它们套上 JS 规则后,no-undef 立刻报出一条真 bug**:

  > `server/relationalDatabase.js:364  'toMysqlDate' is not defined`

  那个标识符在 `authService.js` 与 `relationalDataRepository.js` 里各有一份定义,唯独这里既没定义也没 import。
  而这一行走在 **MySQL 迁移路径**上(写「已应用的迁移版本」),所以**任何 MySQL 用户的首次建库 / 升级都会
  ReferenceError,被 catch 抓住后回滚 —— 迁移直接失败**。

  **两个缺口叠在一起才让它活到今天**:CI 的 `relationalDatabase.test.js` 走的是 SQLite 默认路径,
  MySQL 迁移那一支没有覆盖;而这两个目录没有静态检查。

  修法:把 `toMysqlDate` 抽到 `server/sqlDateTime.js` 共用(顺手去掉重复实现),两处 import 它;
  `eslint.config.js` 加一段只针对 `**/*.{js,mjs}` 的配置(含"下划线开头视为刻意忽略"的约定,
  globals 同时给 node 与 browser —— `scripts/` 里既有纯 Node 脚本也有跑浏览器的审计脚本)。

  **接上时要先量**:第一次跑出来 62 个问题,其中绝大多数来自未追踪的本地草稿目录 `.audit/`
  与 `document is not defined` 这类误报(探针只给了 node globals)。加 `ignores` 与下划线约定之后
  **真问题只剩 1 个**(一处多余的 `\\[` 转义),扣掉它 `npm run lint` 就干净了。
  —— 所以"要不要把某个目录纳入 lint"这种问题,**先跑一次看数,再决定**。

- **`data/`(本机账本)的四个消费者都查过了 —— 只有 `.dockerignore` 曾漏掉(2026-11-25 已补)**。
  起因是查到 `.dockerignore` 漏了 `data/`。既然这一处漏了,就把**所有会扫仓库根目录的东西**逐个过一遍:

  | 谁                               | 会不会误吃 `data/`                        | 依据                                                     |
  | -------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
  | `.gitignore`                     | **不会**(第 12 行就是 `data/`)            | `git check-ignore -v` 实测命中;`git ls-files data/` 为空 |
  | `vite.config.ts`                 | **不会**(`watch.ignored` 含 `**/data/**`) | 注释写明"它是本机运行时目录"                             |
  | **`.dockerignore`**              | **曾经会** —— 已补上                      | `Dockerfile` 里是 `COPY . .`                             |
  | `prettier`(无 `.prettierignore`) | 不会                                      | 只格式化已知扩展名,`.log` / `.sqlite` 被跳过             |
  | `eslint`                         | 不会                                      | 只 lint `**/*.{ts,tsx,js}`                               |
  | `vitest`                         | 不会                                      | `include: ['src/**/*.test.{ts,tsx}']`                    |
  | `tsc`                            | 不会                                      | `data/` 里没有 `.ts`                                     |

  **所以"本机数据会不会被误用"这件事已经查完** —— 三处写死的忽略规则里 `.gitignore` 与 `vite.config.ts`
  都有、唯独 `.dockerignore` 缺一半,现在补齐了。**再核这类问题不用从头来**。

- **`src/test/setup.ts` 完整读过(54 行):只做环境垫片,干净 —— 但有一条覆盖局限(2026-11-25)**。
  它做三件事,都写明了原因:给 `localStorage` / `sessionStorage` 兜一个**内存实现**
  (Node 22+ 的实验性 `localStorage` 是"typeof 是 object 但一用就抛",所以先**探测可用性**再替换);
  把语言固定成 `zh`(jsdom 的 navigator 是 en-US,会让组件渲染英文、与既有中文断言冲突)。
  **它没有 mock 任何业务模块、也不吞错误** —— 只补环境,这是对的做法。

  **局限(不是 bug,但要知道)**:因为语言被钉在 `zh`,**英文渲染路径在测试里从未被走过** ——
  `i18n:check` / `check:jsx-hardcoded` 校验的是**键**存不存在,不校验**英文串会不会把布局撑破**。
  真要看英文版,只能起服务切语言实测(或单独写一条把 `i18nextLng` 设成 `en` 的用例)。

- **`.env.example` 与 `docker-compose.yml` 是同步的(2026-11-25 核对,结论是没问题)**。
  `docker-compose.yml` 描述部署配置、`.env.example` 描述同一套变量 —— 这类"同一件事写两遍"
  最容易一边漏,所以逐条对过一次:

  | 比较                               | 结果                                                                                             |
  | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
  | compose 用到的 **26 个**变量       | `.env.example` **一个不漏**                                                                      |
  | 只在 `.env.example` 里的 **12 个** | 11 个 `VITE_*`(前端**构建期**变量)+ `LEDGERFLOW_API_PROXY_TARGET`(开发期)—— 本来就不经过 compose |

  顺带核过服务端:它读的 16 个环境变量里,compose 未设的 6 个全是开发/代理用途
  (`API_HOST` / `API_PROXY_TARGET` / `CDN_PROXY_TARGET` / `DEV_HOST` / `DEV_PORT` / `NODE_ENV`)。

  **要再核对时**别用 shell 拼 `\${...}` 的正则(引号会被吃掉,我因此得到过一份全是假的 diff):
  写个小脚本读文件再比,几行就够。

- **`nginx.conf` 完整读过(57 行):`/api/` 不设 `proxy_read_timeout` 是安全的(2026-11-25 核实)**。
  看到 `location /api/` 没有 `proxy_read_timeout`(走 nginx 默认 60 秒),一度担心长耗时请求
  (AI 生成)会被切断。核实后**不成立**:

  · AI 请求走的是**流式**(`openaiCompatibleClient` 里 `stream: true` + 解码缓冲循环),
  而 nginx 的 `proxy_read_timeout` 管的是**两次读取之间**的间隔 —— 模型逐块吐字时不会触发;
  · 客户端自己还有可配置超时(`getAiRequestTimeoutMs` / `getAiGenerationTimeoutMs`)与 abort 逻辑。

  这份配置其余部分也扎实,不必再挖:`resolver` + **变量式 `proxy_pass`**(域名请求时才解析,
  避免启动阶段 DNS 未就绪就退出);`rewrite` 显式去掉 `/cdn` 前缀并保留查询串;
  `client_max_body_size 50m` 与后端的 50 MiB 上限**对得上**;`location /` 的 `try_files` 是 SPA 回退,
  而 `index.html` 不在 `/assets/` 里(不该带长缓存,这点也对)。

  ⚠ **但这份配置的「行尾」后来真的出过问题**:CRLF 让入口脚本里那段 awk 重写**静默失效**,
  见下面「Windows 上 `docker build` 会产出『起不来』的镜像」。

  **已知的加固缺口(不是 bug,改它需要能跑起容器来验证)**:没有安全响应头 ——
  `X-Content-Type-Options` / `X-Frame-Options` / CSP 一个都没有。前两个是安全的加法,
  **CSP 需要谨慎**(用错会直接白屏),而 CI 只**构建**镜像、不**运行**它,所以加之前得先起容器实测。

- **`.dockerignore` 已排除 `data/`(本地账本数据库不进构建上下文)—— 已跑通验证(2026-11-25)**。
  `Dockerfile` 里是 `COPY . .`,而 `data/` 放着 **SQLite 库与 `data/backups/` 里的备份** ——
  也就是**一个人的完整账本**。推送的镜像里没有它(最终镜像只拷 `dist` / `node_modules` / `server`),
  而且没配 `cache-to`,所以**暂时不会外泄**;但只要有人加上 registry 缓存(很自然的优化),
  它就会被打包上传。

  **这条特别能说明"东西在、没接上"这个模式**:`vite.config.ts` 里**早就**有同一条判断 ——
  `watch.ignored` 含 `**/data/**`,注释写着"它是本机运行时目录(SQLite 库与 data/backups/ 里的备份)"。
  作者清楚这个风险,只是 `.dockerignore` 漏了另一半。顺手也排除了 `docs/` 与 `release-notes/`
  (构建用不到)。

  验证:`9b28352` → run **success**、verify **success**、**docker-latest success**(镜像重建并推送)。
  也就是说 `.dockerignore` 没有误伤构建 —— 这类改动 CI 会自动替你验,改完看 docker job 即可。

- **Cookie 的 Secure 判定:显式开关优先,别被 `NODE_ENV` 那半句吓到(2026-11-25 核实,结论是没问题)**。
  `secureCookiesEnabled` 是三级判断:

  ```js
  if (LEDGERFLOW_COOKIE_SECURE === 'true') return true;
  if (LEDGERFLOW_COOKIE_SECURE === 'false') return false; // 显式设置直接返回
  return xForwardedProto === 'https' || NODE_ENV === 'production'; // 只是兜底
  ```

  我一开始看到第三行,以为"谁设了 `NODE_ENV=production` 就会让 HTTP 部署的登录坏掉" —— **错了**:
  compose 里 `LEDGERFLOW_COOKIE_SECURE` **总是被显式设置**(默认 `false`),所以前两个分支必然命中,
  第三行只在**两个都没设**时才生效。设计是谨慎的:显式开关 > `x-forwarded-proto` > `NODE_ENV`。

  **记这条是为了省下一次重复推导**;也提醒:别看到"最后兜底那半句"就当成缺陷去"修" ——
  上次(交易表 `table-layout`)也是量了才发现本来就对。

- **生产构建的验证盲区已关闭(2026-11-25,已跑通验证)**。
  查部署层时发现:CI 的 `verify` 有 tsc / lint / 测试 / 十一个闸门,但**没有 `npm run build`**;
  全仓只有 `Dockerfile` 会跑 `vite build`,而它的构建阶段是 **node:20** —— 运行时与 CI 却是 **24**。
  于是"生产构建能不能在 Node 24 上过"**从来没被验证过**,不过也只有部署时才发现。

  修的顺序是刻意的 —— **先让验证存在,再依赖它**:
  1. 往 CI 的 verify 加 `npm run build`(提交 `9101c07`);在该 run 上确认 verify = success,
     即 **vite build 在 Node 24 上确实能过**;
  2. 然后才把 Dockerfile 的 `node:20-alpine` 改成 `node:24-alpine`(提交 `4bd7dec`)——
     `docker-latest` 会重建镜像,等于把这一行也验证一遍。

  **验证结果**:run `4bd7dec` → verify **success**、docker-latest **success**(多架构构建 + 推送成功)。

  部署层其余部分(这轮读过,大部分扎实;**但下面那条说明"不必再挖"当时下得太早** ——
  仓库级行尾配置这一层没查,结果真有缺陷):
  · `docker/start-ledgerflow.sh` 同时守护 API 与 nginx、`trap TERM INT`、子进程死了就**以它的状态码退出**;
  · `nginx.conf` 用 resolver + **变量式 `proxy_pass`**,避免启动阶段 DNS 未就绪就退出;`/cdn/` 走反代(R2);
  · 服务端**不读 `package.json`**(运行时镜像没 COPY 它);`root` 只用于默认数据目录,
  而 Dockerfile 显式设了 `LEDGERFLOW_DATA_DIR` —— 不需要额外文件。

- **Windows 上 `docker build` 会产出「起不来」的镜像(2026-11-25,真 Linux 实测复现)**。
  仓库当时没有 `.gitattributes`,而本机开着仓库级 `core.autocrlf=true` —— Docker 的构建上下文取的正是
  工作区磁盘上的字节,于是镜像里的 `docker/start-ledgerflow.sh` 带 CRLF,首行成为 `#!/bin/sh\r`,
  Linux 上按 shebang exec 直接失败:`env: can't execute '/usr/local/bin/start-ledgerflow.sh':
No such file or directory`,退出码 **127**,容器根本起不来。**CI 一直是绿的**,因为它在 Linux 上检出、
  天然就是 LF —— 这个缺陷只有 Windows 本地构建会中招。

  同一根因还有第二个、更隐蔽的后果:`nginx.conf` 也带 CRLF,而入口脚本用 awk 匹配
  `$0 == "  listen 80;"`;CRLF 下 `$0` 实际是 `"  listen 80;\r"`,**永不匹配**,于是 PORT 改写
  **静默失效** —— 脚本照样退出 0,容器只在 80 上监听。

  | 检查项(真 Linux busybox,与 `node:24-alpine` 同类) | 修前                      | 修后              |
  | ------------------------------------------------- | ------------------------- | ----------------- |
  | 直接 exec 入口脚本                                | `not found`,退出码 127    | 正常执行,退出码 0 |
  | `PORT=8080` 后 `listen 8080;` 的出现次数          | **0**(而脚本退出码仍是 0) | **1**             |
  | 脚本 / `nginx.conf` 的行尾                        | CRLF                      | LF                |

  修法刻意分两层:**一层让仓库确定,一层让构建兜底**。
  1. 新增 `.gitattributes`:`* text=auto eol=lf`、二进制显式 `binary`、`*.sh text eol=lf`
     —— 所有平台的检出都统一 LF,不再取决于每台机器的 `core.autocrlf`;
  2. `Dockerfile` 的 RUN 里用 `tr -d '\r'` 规范化入口脚本与 `nginx.conf`(不用 `sed 's/\r$//'`,
     因为 busybox sed 对 `\r` 转义的支持不明确,而 `tr` 是 POSIX 且当场可测),`CMD` 也改成绝对路径。

  验证方式(**实测,不是推断**):把工作区里那些 CRLF 文件按构建上下文原样铺进 WSL 的真 Linux
  (`/bin/sh -> busybox`),先证坏、再**逐字执行从暂存区抽出的那段 RUN 正文**、最后证好 ——
  所以"测的那份"和"会发布的那份"是同一份字节。

  顺带修掉同类问题:`docker/start-ledgerflow.sh` 的 git 权限位是 **100644**,而它是个程序、镜像正靠
  shebang 执行它 —— 已 `git update-index --chmod=+x` 改成 **100755**(仓库里 650 个文件全无可执行位;
  `.husky/pre-commit` 也是 644,但 husky 的 shim 用 `.` 引入而非执行,故未动)。

- **CI 卫生:concurrency 与 timeout 已补(2026-11-25,已跑通验证)**。
  完整读了一遍 `ci.yml`(99 行)后补上两条标准配置,并在 CI 上确认生效:

  | 补了什么                                                                | 为什么                                                                                             |
  | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
  | `concurrency: {group: ci-\${{ github.ref }}, cancel-in-progress: true}` | 连推多次会同时起多个完整 run(实测页面上三个 in_progress),而且两个 docker 构建会同时往 `:latest` 推 |
  | `verify: timeout-minutes: 20` / `docker-latest: 40`                     | 没有超时的话卡住的 job 会挂到 GitHub 默认上限(6 小时);实测 verify 不到十分钟、docker 十分钟上下    |

  验证:改动本身是 CI 配置,所以最直接的验证就是**推上去看 run** —— YAML 被接受(新 run 正常启动)、
  `verify` **success**、`docker-latest` 在它之后启动(`needs:` 仍生效)。

  **看到但没动的两处**(都是优化,不是缺陷):
  · docker 构建没配 `cache-from/cache-to`,每次冷构建 —— 这是它慢的主因;
  · 文档提交也会重建镜像。**但不要**用 `paths-ignore: docs/**` 省(原因见上面那条)。

- **别用 `paths-ignore: docs/**`去省 CI —— 那会删掉管文档的那道闸门(2026-11-25)**。`docker-latest` 在**每次推送**都跑一次完整 Docker 构建(`npm ci`+`npm run build`+ 镜像),doc-only
的提交也不例外 —— 一天二十几次推送就是二十几次构建,看着很像"该用`paths-ignore` 省掉"。

  **但不要那么做**:验证一下就知道,`check:docs`(校验表格列数、代码块成对、引用的测试文件存在)
  属于 `verify` job —— 而**文档改动恰恰是最容易弄坏它的**。2026-11-25 那天 CI 红了三次,其中
  **两次是纯文档改动**(一次表格里写了转义的竖线 `\\|\\|`,一次注入了列数不一致的测试表格)。
  加了 `paths-ignore: docs/**` 就等于把这层保护关掉。

  真要想省:把 **docker job 单独拆到一个 workflow**、只给它加 `paths-ignore`,
  **`verify` 保持每次推送都跑**。这样省的是构建时间,不是保护。

- **闸门红着不许提交 —— CI 确实会拦,但别指望本地拦住你(2026-11-25 实例)**。
  那天我改了文档表格,`check:docs` 已经输出「表格列数不一致」**而我仍然提交推送了**;
  20 分钟后**又犯了一次**(为验证 pre-commit hook 注入的坏表格忘了还原就提交)。
  两次的结果都记录在 CI 里:

  | 提交                        | verify job               |
  | --------------------------- | ------------------------ |
  | `f1f4b3d`(坏表格那次)       | **failure** —— CI 拦住了 |
  | `5f37f54` / `bd29e93`(修复) | success                  |

  两条结论:
  1. **本地没有任何东西会拦住你** —— 仓库配了 husky + lint-staged,但 `.husky/pre-commit` 长期缺失;
     2026-11-25 补上后,又发现**这台 Windows 上 git 执行不了 husky 的 hook**
     (`env: failed to run command '.husky/_/pre-commit': Permission denied`,手动 `sh` 跑却正常)。
     所以 `core.hooksPath` 保持未设置,提交不受影响 —— **能跑 hook 的环境(Linux/WSL)会受益,Windows 只能靠 CI**。
  2. **"写下来提醒自己"是没用的**:这条纪律我在那个会话里写过好几轮,然后照样违反两次。
     唯一真正有效的是**机器拦截**,而它恰好在本机不可用 —— 所以**推之前自己把闸门跑一遍**,并**在 CI 里确认**。

- **「改了要搜引用」的扫查结论(2026-11-25,两轮做完)**。
  另一条判据:**改过行为的地方,要搜一遍谁在用它** —— 接口兼容、测试也过,但**调用方可能已经变了味**。
  这次把本会话改过行为的地方逐个搜完,4 个目标里 **1 个是真问题**:

  | 改了什么                                                      | 搜到什么                                       | 结论                                                                                  |
  | ------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
  | 解析器加了「按每行推断分类」                                  | 有**两个**调用方,只给其中一个传了 `categories` | **真问题**:同一份账单从交易页导入会推断分类,从数据与备份页导入全落默认分类 → 已修     |
  | `updateTransaction` 改成「分类变了就记学习规则」              | `recategorizeByAi` 也在用它改 categoryId       | **真问题**:AI 猜的/兜底猜的分类被当成"用户修正"记进规则 → 已加 `skipCategoryLearning` |
  | `balance-changes.css` 改 `table-layout: fixed`                | 无快照、无测试断言该表宽度                     | 干净                                                                                  |
  | `EmptyState` 的渲染条件加了 `secondaryActions?.length` 这一项 | 9 个调用方                                     | 干净(条件是**严格超集**,且 `secondaryActions` 是新增 prop,现有调用方不可能改变行为)   |
  | `App.tsx` 主题色改从 store 读                                 | 只有我改的那处 + 一句注释                      | 干净(没有地方假设恒为 amber)                                                          |

  **注意前两条的共同点**:都是**接口兼容**的改动(可选参数、新 prop),类型检查不会报、测试也全过 ——
  只有**去搜调用方**才发现。以后再改一个被多处调用的函数,先搜一遍。

- **`brands:generate --check` 看起来能当闸门,其实不能 —— 别接进 CI(2026-11-25 核实)**。
  它自带 `--check`("文件过期时退出码 1"),今天实测**通过**(`brandMarks.ts is up to date`)。
  但它比对的数据源是 **网络** 且是 **`@latest`**:

  ```
  https://cdn.jsdelivr.net/npm/simple-icons@latest/_data/simple-icons.json
  https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/<slug>.svg
  ```

  **上游 Simple Icons 一发新版,这个检查就会开始失败** —— 跟本仓库改没改没关系。
  接进 CI 会得到一个随机失败、没人能修的闸门。所以:**保持手动跑**(想刷新图标时跑
  `npm run brands:generate`,然后按正常流程提交)。

  同理提醒:**"脚本能跑"不等于"适合当 CI 闸门"** —— 先确认它有没有网络依赖、有没有
  `@latest` 这类会漂移的输入。这次差一点就把它接进 CI 了。

- **鉴权模型:一个部署一个 token,本地服务只绑 localhost —— 不要再当漏洞挖(2026-11-25 核实)**。
  服务端整套只认一个共享 token(`x-ledgerflow-api-token` 或 `Authorization: Bearer …`,
  用 `timingSafeEqual` 比较,这点做得对)。也就是说**没有用户级隔离**:任何持有 token 的调用方
  可以指定任意 `user_id` 读写。

  **这不是缺陷,是设计**:LedgerFlow 是单人自托管的个人账本,"一个部署 = 一个人",
  token 就是这个部署的凭证。要多人共用一台服务端,才需要额外地按用户隔离 —— 那是另一个产品形态。

  另外核实过:**本地 API 只监听 `127.0.0.1:8799`**(netstat 实测是 `TCP 127.0.0.1:8799`,
  不是 `0.0.0.0`),所以不会暴露到局域网;dev server 是 `[::1]:5333`,同样只在本机。

- **账单导入的输入变体矩阵(2026-11-25,撞了 13 种形状)**。
  导入是用户报 bug 最多的地方,所以专门造各种"真实但脏"的输入去撞。结论:**两种形状会坏(已修)**,
  其余本来就对。要改解析器时,先看这张表,别重复撞已经覆盖的。

  | 形状                                                              | 结果                                                                        | 守着它的测试                                             |
  | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
  | xlsx 里日期是序列号,**不写** `t`(微信官方导出)                    | 已修(v0.50.44)                                                              | `billImport.excelDate.test.ts`                           |
  | xlsx 里日期是序列号,**写了 `t="n"`**(openpyxl / LibreOffice 另存) | **已修(v0.50.53)** —— 整份 0 条                                             | `billImport.xlsxFixture.test.ts`(真实 xlsx fixture)      |
  | CSV 引号字段内**带换行**                                          | **已修(v0.50.54)** —— 整笔交易静默消失                                      | `billImport.csvVariants.test.ts`                         |
  | CSV 引号字段内带逗号                                              | 本来就对                                                                    | 同上                                                     |
  | CRLF(Windows 上 Excel 另存)                                       | 本来就对(备注不残留 `\r`)                                                   | 同上                                                     |
  | UTF-8 BOM                                                         | 本来就对(代码里剥了 `\uFEFF`)                                               | —                                                        |
  | 金额带 `¥` / 千分位(含逗号时必须加引号)                           | 本来就对                                                                    | `billImport.csvVariants2.test.ts`                        |
  | 日期是斜杠格式 `2026/11/24`                                       | 本来就对                                                                    | 同上                                                     |
  | 表头前后多余空行 / 行尾空格                                       | 本来就对                                                                    | 同上                                                     |
  | **GBK 编码**(Excel 另存「CSV(逗号分隔)」)                         | 本来就对(中文不乱码)                                                        | `billImport.csvVariants3.test.ts`(真实 GBK 字节 fixture) |
  | 表头在第 40 行                                                    | 本来就对(`findHeaderIndex` 扫前 80 行)                                      | 同上                                                     |
  | 金额 0                                                            | 跳过(不是交易)                                                              | 同上                                                     |
  | 金额负数                                                          | **按绝对值记入**(银行流水用负数表流出,方向由收/支列决定)`Math.abs` 是有意的 | 同上                                                     |

  **还有两个坑是"我的 fixture 写错了",别再犯**:含逗号的金额字段必须加引号(不加会把列切开);
  负数**不是**应该被跳过。

- **表格溢出排查:只有余额变动页会真的被长备注撑开,其余不用动**。
  用户报过「备注过长撑破界面」(已修:余额变动页改 `table-layout: fixed` + 各列定宽)。
  之后把全项目的 `<table>` 过了一遍,共 **6 个文件**渲染表格:

  | 表格                                 | 布局                     | 结论                              |
  | ------------------------------------ | ------------------------ | --------------------------------- |
  | `balance-change-table`               | fixed                    | 已修                              |
  | 交易流水表(`transaction-table-wrap`) | auto + `<colgroup>` 列宽 | **实测不会被撑开**(见下)          |
  | `exchange-table`                     | auto                     | 汇率名是受控短文本,不动           |
  | `sb-category-table`                  | auto                     | 分类名是受控短文本,不动           |
  | `chat-md-table`                      | auto                     | 渲染 AI 回复里的表格,外层自带滚动 |

  交易流水表是**实测**过的:临时账号导入一条 180 字符无空格的备注,测量结果
  外层可见宽 1042 / 表格宽 1048(**只差 6px,是边框**)、页面横向溢出 0 ——
  也就是说 colgroup 的列宽已经挡住了长内容,**不需要改**。
  (它外层有 `overflow-x: auto`,即便将来变宽也只是表内横向滚动,不会破页。)

- **i18n 死键:别按"完整路径没出现"整批删(会弄坏界面)**。
  删掉 8 个没人用的组件后,语言文件里留下了它们的文案。用"完整路径在 src 里没出现过"去扫,
  得到 **334 个**候选 —— 但**其中绝大多数是动态拼接的键**,删掉会直接把界面弄坏:

  · `datePicker.weekdays.*` —— 按星期拼(`t('datePicker.weekdays.' + day)`);
  · `settings.preferences.accent.*` —— 主题色选择器按选项名拼;
  · `settings.data.counts.*` —— 按表名拼。

  真正**可以证明**是死键的只有 **36 个**,全部在 `dashboard.*` 下、全部来自被删的 7 个仪表盘组件
  (用删除提交 `25b4624` 的 diff 取「被删行用过的键」,再确认全项目不再出现)。清单:
  `dashboard.historyCard.*` / `dashboard.monthlySummary.*` / `dashboard.netAssetCurve.*` /
  `dashboard.radar.*` / `dashboard.topTransactions.title` / `dashboard.financeRadarBasis` /
  `dashboard.ui.{active,anomalyAlert,anomalyAndHighlight,anomalyCardList}`。

  这 36 个**没有在这一轮删除**,原因很实际:语言文件不是 `JSON.stringify(…, 2)` 的规范格式
  (`zh` 136388 字节 vs 重写后 131968,且是 CRLF),整文件重写会产生约 **4000 行**的格式 diff;
  而按行删又碰上 `title` 这类**大量重名**的叶子键,容易删错。
  **下次谁要重整语言文件格式,顺手把这 36 个一起清掉即可。**

- **已知偶发:服务端测试出现过一次 `fetch failed / bad port`(2026-11-24)**。
  症状:一次并行跑 `node --test server/*.test.js` 时,3 条用例同时失败(两条市场数据、一条 secid 过滤),
  错误是 `bad port` / `fetch failed`。**随后连续 5 次全量重跑都干净**,无法复现。

  已经排除的两个常见原因:
  · **没有测试绑固定端口** —— 所有用例都是 `server.listen(0, '127.0.0.1', …)`(临时端口),
  不会和开发服务器撞;
  · **没有"listen 之前读端口"的写法** —— 三个用了本地服务端的用例文件都是 `await listen` 之后才读 `address().port`。

  当时的机器状态:同时开着 dev 服务(5333)、preview(5444)、API(8799)与浏览器自动化 ——
  倾向是资源紧张下的偶发,而非代码缺陷。**下次遇到先看这几条,不要从零复现**;
  若能在干净环境下稳定复现,那就是真问题。

## 实现细节与不变量(逐条核对过)

- **彻底删除账户会静默删掉其交易**:根因 `account_id NOT NULL`,四方案见
  `server/orphanAccountReferences.test.js` 顶部。

  这条的**两段文案**值得逐字记下来,因为它决定用户有没有机会知道后果:
  1. 移入回收站时的确认(`categoriesAccounts.confirm.accountUsage`):
     「该账户下存在 {count} 条交易记录,**移入回收站后仅移除账户本身,交易仍会保留**。是否继续?」
     —— 这一步**是准确的**,交易确实保留(已验)。
  2. 彻底删除时的确认(`recycleBin.clearConfirm`):
     「确认清空回收站吗?将永久删除其中的 {{count}} 项内容,且无法恢复。」
     —— 只说回收站里那 N 项(例如 1 个账户),**没有说**引用它的那 K 笔交易随后会在下一次同步时
     被丢掉的。于是用户在第 1 步被告知「交易仍会保留」,在第 2 步听不到相反的信息。

  所以无论最终选哪个方案,第 2 步的文案都要跟着改 —— 若选方案 C(拒绝彻底删除仍有交易的账户),
  这个危险操作根本不会出现;若选「重指派到某个账户」,文案要说明交易会被挪到哪。

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

## 关于页「最近更新」的数据链(v0.52.0 新增)

关于页要显示"最近哪些版本改了什么",而这件事天然有一个**没人看着就会烂**的地方:
版本记录写在 `release-notes/`,页面用的是另一份数据。两边一漂移,页面就会**一本正经地
显示上一个版本的内容** —— 界面上完全看不出错。所以这条链的每一段都有东西盯着:

| 环节                                                                            | 谁在管                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `release-notes/RELEASE_NOTES_v*.md` → 结构化记录                                | `scripts/lib/releaseHistory.mjs`(抽取规则写在它头部:标题取第一个 `## `、摘要取标题后第一段散文、日期取 tag)   |
| 结构化记录 → 提交进仓库的数据模块                                               | `node scripts/generate-release-history.mjs` → `src/pages/about/recentReleases.generated.ts`(**生成后要提交**) |
| 数据模块 == 重新生成的结果                                                      | `npm run check:release-history`(**CI 里跑**,逐字节比对,不一致非 0 退出)                                       |
| 数据讲得通(降序、非空、无残留 markdown、日期格式)                               | `src/pages/about/recentReleases.test.ts`                                                                      |
| **第一条就是当前版本**                                                          | 同上 —— `RELEASE_HISTORY[0].version === APP_VERSION`                                                          |
| 页面渲染(10 条、只打一次「当前版本」、日期不被时区推到前一天、链接指向对应 tag) | `src/pages/about/AboutPage.test.tsx`                                                                          |

**为什么是"生成 + 提交"而不是运行时读文件**:`release-notes/` 被 `.dockerignore` 排除,
镜像里根本没有那些 markdown(前端 `import` 会在 Docker 构建时失败);运行时去请求
GitHub API 又会给"打开关于页"这件事加上网络依赖与限流。生成的数据随包发布,离线可用。

**为什么闸门是"重新生成再比对"而不是抽几条核对**:这里真正的风险是**整体过期**
(新增了版本却没重新生成、改了标题没同步),抽查只能证明抽到的那几条恰好对。

破坏性验证(2026-11-28):

| 状态                            | 结果                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| 把已生成数据里一条 `title` 改掉 | `npm run check:release-history` 退出码 **1**,打印第 39 行「已提交 / 应改为」两行差异 |
| 还原                            | 退出码 0                                                                             |

**已知局限(不要当成已覆盖)**:

- **日期只在"本机能取到 tag"时被真正核对**。CI 的 checkout 默认 `fetch-depth: 1`、不取 tag,
  那里的日期一律**沿用已提交值**,所以"日期写错"只会在本地被抓到。
- 发布流程是「写说明 → 提交 → 打 tag」,**生成数据时最新那条的 tag 还不存在**,
  于是它先按当天日期写入;打完 tag 再跑一次生成器就会校准。生成器会把这种"先按当天"的
  版本列出来提醒,闸门也会在同一次比对里发现差异。

真机实测(1440 / 390 / 320,浅色 + 深色 + 英文界面,`.audit/verify-about-releases.mjs`,`problems 0`):

| 量的是什么                            | 结果                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 条数 / 「当前版本」标记 / `<time>` 数 | 10 / 1 / 10(与数据文件逐条对齐)                                                                                                        |
| 日期文本                              | 当时的首条 `v0.51.0 → 2026年11月27日`,`<time datetime="2026-11-27">`,**没有被时区推到 26 日**(v0.52.0 发布后首条变成 v0.52.0,规则不变) |
| 对比度(浅色 / 深色)                   | 标题 15.47:1 / 15.9:1;摘要 5.54:1 / 10.84:1                                                                                            |
| 字号                                  | 版本 13px(等宽数字)· 标题 14px · 摘要 13px · 日期 12px · 标签 11px                                                                     |
| 横向溢出                              | 1440 / 390 / 320 三档全 **0px**                                                                                                        |
| 英文界面                              | 区块标签与标题跟着语言变(`Release history` / `Recent Updates`),**数据保持中文原文**并在说明里写清"发布说明是中文"                      |

## 「今天的市场,说人话」:结论必须由当前数据推出来(v0.52.1)

面板上原来是一组**与数据无关的固定句子**(按涨跌幅阈值吐一句「大盘又被砸了,先稳节奏」),
最典型的一次实测结果是:**最弱板块 +4.78%(全市场都在涨),卡片却写着「今天偏弱,别急着接」**——
同一个元素里的数字与结论互相打脸,而且读代码看不出来(判定、取数、文案散在一处)。

现在读数与文案分开:读数在 `src/features/investments/model/plainBriefing.ts`(纯函数),
句子由组件按语言组装。规矩三条:数据缺了如实说缺什么、正负号不许自相矛盾、
结论要么由指数要么由板块支撑。

| 测试                                                  | 保护的行为                                                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/investments/model/plainBriefing.test.ts`    | 全涨时**不给**"最弱"(那条 +4.78% 的回归用例);样本为 0 时是 `unknown` 而不是"中性";指数跌而板块普遍涨 → `mixed`(背离);政策判定只认标题                                       |
| `pages/investments/PlainMarketBriefingPanel.test.tsx` | 全涨时页面出现「没有下跌的板块」且**不出现**「偏弱」;没有指数就不提大盘;AI 简报的 `suggestions` 真的渲染出来(AI 要点最多 3 条、建议最多 2 条);「AI 复盘」把当前行情交给助手 |

**同一份数据下的实测(1440 / 390 / 320,深浅两主题,`.audit/verify-briefing.mjs`,`problems 0`)**:

| 量的是什么                 | 重构前                              | 重构后              |
| -------------------------- | ----------------------------------- | ------------------- |
| 面板**内容**高度(桌面)     | 355.3px                             | **173.1px**         |
| 面板内容高度(390 / 320)    | 265.9px                             | **186.1px / 227px** |
| 今日看板网格右侧空列(1440) | **282.2px**                         | **0px**             |
| 资讯那一条                 | 铺整段新闻正文(实测一段 250 字)     | 只留标题,最多两行   |
| 「领跌」那条               | `油气资源 +4.78%,今天偏弱,别急着接` | `没有下跌的板块`    |

**量高度时踩到的坑(写下来免得下次误判)**:今日看板是 `align-items: stretch` 的网格,
两个面板的**盒子**永远一样高(由今天持仓面板的 482.1px 撑出来)—— 只看盒子会得出
"面板没变矮"的错误结论。要量的是"最后一个子元素的底边 − 面板顶边"这个**内容高度**。
同理,桌面这一行的行高由同行的持仓面板决定,所以**看板整体高度不变**,省下来的是
面板自身的内容与移动端的页面高度。

## 7×24 快讯的「AI 解读」：问的必须是点下去的那一条（v0.52.1)

面板上原来**只有一个**「AI 解读」按钮，而它的提示词里写死了 news[0]——
列表里想看第 5 条，或者切到「上市公司」分类，发出去的仍然是第一条的标题与摘要；
而列表本身没有任何解读入口（整行是一个 <a>，点哪儿都是跳东方财富）。
读代码看不出来：变量名叫 news，实际只用了第一个元素。

现在两件事分开：

- **每一条快讯自己有一个「AI 解读」按钮**，绑定这一条的标题/摘要/关联标的。
  按钮不能放进 <a> 里（交互元素不能嵌套），所以行结构从“一个链接”改成
  <article> = 元信息行（时间 + 按钮） + 正文链接：点按钮不会跳走，点正文照旧跳原文。
- **顶部按钮改成“批量挑重点”**：一次最多 5 条，摘要裁到 60 字（不然一条 250 字的正文
  会把“哪几条重要”淹掉），并明确要求“都不重要就直接说都不重要”——
  没有这句，模型会给每条都硬凑出一个影响。

| 测试                                              | 保护的行为                                                                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pages/investments/InvestmentsPage.newsAi.test.tsx | 列表有几条就有几个解读入口；点第 3 条时发给 AI 的是第 3 条的标题与关联标的、**且不含**第 1 条的标题；悬浮助手的聚焦标签变成「正在看：第 3 条的标题」；顶部按钮带 3/5 条与“都不重要”那句话；切到「焦点」分类后带的是当前分类的名字与条数 |
| pages/investments/investmentAi.test.ts            | 提示词本身：最多 5 条（9 条只进 5 条）、长摘要裁到 60 字 + …、空标题不占位、全空返回空串、分类名只在传入时出现                                                                                                                          |

**证伪（把 bug 放回去，闸门必须变红）** —— 四次都实测过：

| 放回去的 bug                                 | 结果                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| 单条入口重新读 news[0]（标题/摘要/聚焦标签） | InvestmentsPage.newsAi.test.tsx 5 个里红 1 个（点第三条那条） |
| 顶部批量改成 news.slice(0, 1)                | 红 2 个                                                       |
| 删掉“都不重要就直接说都不重要”这句要求       | investmentAi.test.ts 红 1 个                                  |
| 把摘要裁剪上限从 60 改成 4000                | 红 1 个                                                       |

**真机实测（.audit/verify-news-ai.mjs,1440 与 390,problems 0)**:

| 量的是什么              | 实测                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| 快讯条数 / 解读入口数   | 8 条 / **8 个**（桌面与移动一样）                                           |
| 点第 3 条之后的聚焦标签 | 正在看：中东部晴朗干燥格局持续,本月底至下月初迎大回暖（第三条，不是第一条） |
| 按钮触达尺寸            | 桌面 **24px** / 移动 **44px**，与时间药丸重叠 **0px**                       |
| 按钮是否被塞进 <a>      | 否（点按钮不跳转，正文链接仍是 target="\_blank" 的原文链接）                |

**踩到的坑**:

- getByRole('button', { name: '解读最近几条' }) 取不到顶部按钮 —— 它有 aria-label,
  可访问名字就变成了 让 AI 解读最近几条快讯，可见文字不再参与命名；
  查按钮要按 aria-label 查、再单独断言可见文字。
- 分类胶囊是 role="tab" 不是 button。
- 提示词里同样有一份**编号的要求清单**，所以用 /^\d+\. / 数新闻条数会把
  “1. 先判断…”也数进去（9 = 5 条新闻 + 4 条要求）；数条数要带上新闻标题的前缀。
- 裁剪用的是真的省略号字符 …(U+2026)，不是三个点 —— 写成 '...' 的断言永远不会命中。

## 可访问性与 i18n 的闸门(命令式,不在上面那套里)

一张完整的表(之前被两段说明**从中间切开**,后半段丢了表头、渲染成纯文本 —— 已修):

| 命令                                           | 作用                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run i18n:check`                           | i18n key 缺失/单边/写死属性;命中即非 0 退出                                                                                               |
| `npm run i18n:check-jsx`                       | JSX 文本节点里的硬编码中文;命中即非 0 退出                                                                                                |
| `npm run check:dates`                          | 禁止按 UTC 取日(`date.slice(0, 10)`、两个 `slice(0, 10)` 直接比);命中即非 0 退出                                                          |
| `npm run check:shared-predicates`              | 共享判断不许在别处手写:退款/冲正、是否计入余额的状态、金额取整、支出口径;按「文件+上一行+本行」精确豁免                                   |
| `npm run check:money`                          | 金额格式与取整的既有闸门                                                                                                                  |
| `npm run audit:ledger-math`                    | **账目口径体检**(需本地库):逐月收支、账户余额、余额变动链、退款关联、分类父子、订阅→生成交易、净值恒等式                                  |
| `npm run audit:sums`                           | 手工求和的候选点;被点名却未引用共享汇总的文件必须写明理由,否则非 0 退出                                                                   |
| `npm run check:docs`                           | 本文档自身的引用体检:测试文件必须存在、表格列数一致、**表格不能被正文从中间切断**                                                         |
| `npm run check:audit-routes`                   | 界面审计覆盖的路径必须与 `src/app/router/router.tsx` 对齐(有页面没跑过即失败)                                                             |
| `npm run check:dynamic-i18n`                   | 动态拼出来的 i18n 键必须存在(kind 从代码推导,新增 kind 不漏语言键;走到罕见状态才暴露的那类)                                               |
| `npm run check:orphan-methods`                 | store 里声明的公开方法必须在别处被用到 —— 抓「声明了、实现是空壳、全项目没人调用」这类(类型检查与测试都发现不了)                          |
| `npm run check:dead-exports`                   | 导出了却全仓没人引用(符号名与文件路径都查)—— 抓「功能删了、文件留下」这类死代码;只覆盖整个文件都没人用的情况                              |
| `npm run check:release-history`                | 关于页「最近更新」的数据模块必须与 `release-notes/` 重新生成的结果**逐字节一致**(加了新版本的说明却忘了重新生成 → 页面显示的是上一个版本) |
| `node scripts/audit-jsx-hardcoded.mjs --count` | 硬编码中文的数量,只看数字(用于看趋势)                                                                                                     |

### 三条关于闸门本身的说明

**零、中文资源的标点是全角,组件里的中文兜底必须与资源逐字一致**(2026-11-28 实测并修正)。

- 仓库里的**主流写法是全角**(实测:含全角逗号 `，` 的键 358 个、含 ASCII `,` 的 54 个;
  全角分号 19 : 7、全角括号 97 : 19、全角冒号 205 : 39)。新写中文文案时按全角写,
  别在同一屏里混出两种逗号。
- 更实际的一点:**上一轮我自己写的 `about.releases.*` 与新的 `investments.briefing.*`
  用了 ASCII 逗号,于是单测里那句 `'今天的市场,说人话'`(全角)对不上渲染出来的字符串**
  —— 两个字符串在等宽字体里长得一模一样,只有逐码点比对才看得出(`0x2c` vs `0xff0c`)。
  已经全部统一;`PlainMarketBriefingPanel.tsx` 里的中文兜底也**按 zh 资源逐字对齐**过
  (先前漂移过一次:`lead.unknown` 资源是「行情数据还没到…」、组件里写的是「行情还在加载…」)。

**一、两种 i18n 占位符并存,别混用**(自审时查证过,两种都在正常工作):

- `t('key', { count })`(react-i18next)配 **`{{count}}`** —— 自动插值,如 `recycleBin.clearConfirm`、
  `dataSync.syncFailure`、`dataSync.syncDroppedRecords`;
- `tf('key', '兜底文案')`(本项目自己的 key+兜底 helper)**不接受插值参数**,所以配 **`{count}`**
  - 代码里 `.replace('{count}', ...)` —— 如 `dataBackup.snapshot.synced`、`txPage.confirm.refundCascade`。

风险很实际:译者按错的那套写,占位符就会原样显示给用户(我在 `syncDroppedRecords` 上就踩过一次)。
改文案时先看**调用点用的是 `t` 还是 `tf`**,再决定花括号的个数。

**二、`check:shared-predicates` 的退款规则现在拦两种写法**:

- **成对写法**:同一处把 refund 与 reversal 都写了(窗口规则);
- **单边写法**:只在文件里比了 `adjustmentKind === 'refund'`、却**没有引用** `isTransactionRefundLike`(文件级规则,2026-11-24 加)。
  这条是因为助手页算「平均支出/异常大额」时漏掉冲正才补的 —— 冲正被当成一笔正常支出,把平均值和阈值一起抬高。
  判据刻意收得紧(引用了共享谓词就不查),所以当前零命中,纯粹用于防第五处;证伪过:造一个单边判断的文件会被点名并非 0 退出。

## 浏览器端页面体检(断言不了的那一类)

`npm run audit:ui` 会把**全部静态路由** × 桌面(1440)/ 移动(390)/ 窄屏(320)跑一遍
(当前 23 × 3 = **69 个组合**),量的是**只有真的渲染出来才存在**的一些事:

**覆盖清单必须与路由对齐** —— 这条以前是手工核对的,于是漏掉了三条真实页面
(`/transactions/new`、`/settings`、`/tags`),而那时「36 个组合、0 个问题」打印得完全正常:
**没跑过的页面在报告里看不出来**。现在由 `npm run check:audit-routes` 守着 ——
它比对 `src/app/router/router.tsx` 与审计脚本的 `ROUTES`,有页面没覆盖就非 0 退出
(审计里多出来的路径只提示,不失败,因为可能故意放一条不存在路径去验 404 页)。

| 检查项                                                      | 为什么单元测试抓不到                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 整页横向溢出                                                | 取决于布局,与 props 无关                                           |
| 元素越过视口右边界且不在横向滚动容器内                      | 这类元素**既不滚动也点不到**,`overflow-x: hidden` 会把它静静裁掉   |
| 没有可读名称的 button / a                                   | 无障碍问题,只在 DOM 里                                             |
| 每个路由新产生的 console error                              | 只有真跑起来才有（附失败请求的状态码 / 方法 / 路径，见下面第一条） |
| 字号 < 11px 的纯文本节点                                    | 只报告不计失败,看趋势                                              |
| `touchHoverReactive`:触屏点过之后一直亮                     | `:hover` 漏了 `@media (hover: hover)` 守卫,**只有触摸端**才复现    |
| `inertGridRules`:`@media` 里写 grid 专属属性、父级却是 flex | 声明无效**不体现在 computed style** 上,只有父级布局 + 几何能证明   |
| `focusWalk`:Tab 到看不见 / 被吸顶盖住的地方                 | 焦点可见性(2.4.7)与遮挡(2.4.11)是运行时几何,不存在于源码里         |

发现过的问题:`/balance-changes` 整页被内容最小宽度顶到 545px、右半侧被裁(见 v0.48.0 说明)。

### 两条关于审计本身的说明（2026-11-28 加，都是被现实撞出来的）

**一、console 那条 500 不带 URL，所以审计自己记一份失败请求。**

浏览器的 `Failed to load resource: the server responded with a status of 500` **没有 URL**。
看到这条只能靠猜：是哪个接口？更要紧的是分不清「页面代码的问题」还是「上游数据源当下不可达」——
发 v0.52.1 之前就为这个绕了两圈（审计报 6 个问题，最后靠另写探针 + `curl` + `git stash`
才证到是 `push2.eastmoney.com` 连不上）。

现在每个问题里都带一份失败请求（重复的合并成 `×N`，顶层还有全路由的 `failedRequestSummary`）：

```json
"failedRequests": [
  "500 GET /api/market/eastmoney/quotes?secids=1.000001%2C0.399001... ×2",
  "500 GET /api/market/eastmoney/trend?secid=1.000001",
  "500 GET /cdn/ui/calendar.svg",
  "未完成 GET /api/xxx net::ERR_CONNECTION_RESET"
]
```

**判定口径没变**：4xx/5xx 浏览器一定会在 console 里报一条，照样算问题，这里补的只是"是哪一个接口"。
`requestfailed`（`net::ERR_*`）同样记录但**不算问题** —— 切路由时浏览器会主动取消在途请求，
那 `net::ERR_ABORTED` 不是缺陷。

**二、每条路由都先等应用外壳渲染出来，再量。**

`goto` 之后应用还要过一道数据门（登录态恢复 + 同步），那段时间侧栏与 `main` 都还不存在。
之前只等「网络静默 3 秒 + 600ms」，于是**有可能量到一张空壳**：实测桌面档 `/` 被报成
`mainTextLength: 0` / `navCount: 0` / `mainLandmark: 0` —— 报出来的是「页面没有主区域」，
而页面只是还没渲染完（前几轮没报，是运气：3.6 秒窗口刚好够）。
现在先 `waitForFunction(nav && main)`（最多 15 秒），等不到就继续量：真的缺主区域仍然会被
报出来，这一步不掩盖它。

**确定性验证**（时序问题不能靠"再跑一次没报"来证明）：人为把外壳渲染推迟 4 秒
（临时改 `SqlDataSyncGate`，跑完还原并逐字节核对），让它变成必然 ——

| 跑法（桌面档 23 条路由）     | 结果                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| 去掉这道等待（`timeout: 1`） | **23/23 条路由全部被误报**，23 条都判成空壳（`nav=0` / `main=0` / 正文 0 字）        |
| 保留等待                     | 空壳误报 **0 条**；只剩上游行情源那两个 500（`/investments` 与 `/investments/flow`） |

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

- **`npm run format:check` 是红的,而且已经红了很久**:实测 `npx prettier --check .` 报
  **341 个文件**不合 prettier 格式(含 `docs/HANDOVER.md`、`src/app/styles/finance.css` 等)。
  **与 `.editorconfig` 无关** —— 做过 A/B:把 `.editorconfig` 临时挪走,报错一字不差;
  也把 `docs/HANDOVER.md` 在 HEAD~1 的旧版取出来单独查过,同样是红的。
  这个脚本**不在 CI 里**(CI 只跑 eslint),所以一直没人发现。

  记在这里是因为**别顺手跑 `prettier --write .`**:那是一次 341 个文件的重排,会与正在编辑的工作区
  冲突,而且这是"要不要统一格式"的产品/团队决定 —— 要么全量重排一次并把 `format:check` 加进 CI,
  要么把这个脚本删掉别留着误导人。在决定之前,新写的代码**保持 prettier 风格**就行
  (`.prettierrc` 仍然是 prettier 的配置来源;`.editorconfig` 只管编辑器行为,不是格式化配置)。

- **8~10px 的微型文字是有意为之,不是"字号漏改"**(2026-11-27 核对):审计里
  `tinyText`(字号 < 11px)共报出 **19 类元素 / 496 处**,逐类看下来全部落在
  **图表刻度、热力日历、徽标**这些"密集微标签"场景 —— 日历格里的「12月」月界标记 8px、
  每格金额 10px、智能预算的横轴月份 10px、投资页的行情时间 9px、
  订阅小徽标里的品牌字 8px、还款进度环下方「已还 ¥0.00」10px。

  按 2× 设备像素截图逐一目视过(例如日历格:日期 11px / 金额 10px / 月界 8px 同格并存),
  在实际显示密度下读得出,而把它们抬到 12px 会顶掉格子里的金额或让横轴月份互相压字。
  WCAG 本身**不规定最小字号**(只有 1.4.3 的对比度与 1.4.4 的缩放要求),所以这一项
  在审计里**保持"只报告": 不致败** —— 它是密度取舍,不是缺陷。
  真正要守的是:**这些字不能小于 11px 之外的另一种坏法** —— 对比度(已由 `audit:contrast` 保证)
  与缩放后可读(1.4.4 到 200%,已由 `docs/a11y-reflow-and-zoom.md` 保证)。
