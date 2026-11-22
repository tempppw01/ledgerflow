## 数据正确性一批:日期、统计口径、备份、退款、导入

这一版把 5 类**会悄悄算错钱或丢数据**的问题一起修完。它们都来自同一个坏习惯:
**只用字符串存的日期被当成瞬间去比、来源里没提供的字段被当成「清空」**。

### 1. 日期:纯日期被当成 UTC 瞬间

`new Date().toISOString().slice(0, 10)` 在 UTC+8 / UTC+9 的本地 00:00–07:59 返回**昨天** ——
每天有 8–9 小时是错的。受影响:还款「登记已还」的日期默认值、投资模拟的起止日期、
助手登记还款的 `paidAt`、AI 工具新建交易的日期、`creditAgentTools` 的月份键
(月初几小时会指向上个月)、导出 PDF 的文件名。

助手的「最近两周」窗口更严重:在 UTC+8 的 00:00–07:59,今天记录算出的 gap 是 −1,
被 `gap >= 0` 直接剔除 —— **早上记的账不进统计**。

统一改用 `todayLocalDateKey()` / `daysSinceLocalDate()`,语义集中在新的
`localDate.ts` 原语上。新增 14 项测试,反向验证(换回旧写法)在 Asia/Shanghai 下立刻 2 项失败。

### 2. 统计口径:待支付/已关闭/失败/已删除的行被算进收支

账户余额一直排除这些行,而月度/年度汇总却把它们算进去了 —— **同一屏两套数**。
统一 6 个聚合点(仪表盘本月与趋势、助手概览、智能预算、财务分析、顶栏本月)。

交易列表页的合计**特意不动**:它是对「你看到的这批行」求和,套过滤反而对不上可见金额。

新增 `isCountableTransaction` / `filterCountableTransactions`,判据与 `computeAccountBalances`
完全一致,并有测试锁住两者不许漂移。

### 3. 备份恢复静默丢字段(10 个)

加了一条**全字段往返不变量**(导出 → JSON → 解析必须逐字段相等),立刻找出 5 类丢失:

| 实体 | 丢掉的字段 | 影响 |
| --- | --- | --- |
| `categories` | `parentId` | 子分类恢复后**被拍平成一级** |
| `investmentPositions` | `fundCode`、`holdingShares` | 代码与份额丢失 |
| `investmentPositionHistory` | `fundCode`、`holdingShares` | 历史快照数字对不上 |
| `investmentWatchlist` | `lastDataAt` | 无法判断行情是否过期 |
| `investmentAiMessages` | `webTrace`、`auxiliaryInfo`、`followUpPrompts` | 检索轨迹与追问建议丢失 |

### 4. 退款:编辑绕过不变量,账户净额凭空多钱

创建退款守得很严,但 `updateTransaction` 能绕过:把原交易金额改到低于已退总额、
或把退款单金额改大 —— 支出变小、退款照旧流入,**这一对交易净额凭空多出钱**。
现在写入前校验并拒绝(错误显示在编辑表单里);导入/恢复走显式逃生门
`{ allowRefundOverflow: true }`,避免历史数据把整批恢复顶失败。

### 5. 重复导入账单会抹掉已有状态

账单解析器始终产出 `orderNo` / `merchantOrderNo` / `status` 键(没这列时是 `undefined`),
合并时的 `{ ...existing, ...incoming }` 就把已有值覆盖成 `undefined`。
**状态被清空会改变余额语义**:`isBalanceAffectingStatus(undefined)` 为真,
一条「已关闭」的记录在导入无关账单后重新计入余额。现在改为「来源确实带了值才覆盖」。

### 验证

- 前端 **835 项 / 108 文件**(本批新增 36 项)、服务端 35 项
- `tsc` 0、`eslint` 0、i18n 缺失 0、`i18n:check-jsx` 0
- 每个修复都做了**反向验证**:把实现换回旧写法,对应测试立刻变红
  (日期 2 项、备份丢字段 4 项、退款 2 项、导入 2 项)
