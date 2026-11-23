## 助手导入的账单,状态列显示成「-」,却能被「已完成」筛出来

这一版 1 个提交(含闸门自身的一处加固)。

### 怎么发现的

这一轮做的是「同一份数据、多条写入路径」审计。按 `source` 字段给全库交易分组:

| source | status = completed | status 为 NULL |
| --- | --- | --- |
| `manual` | **121** | **0** |
| `ai` | 1 | 3 |
| `alipay` | 145 | 3 |
| `wechat` | 30 | 2 |

**所有 8 笔缺状态的记录都来自助手导入路径,手工记的一笔都不缺。**

### 根因

`createTransactionRow` 会兜底 `adjustmentKind` 与 `updatedAt`,但**不兜底 `status`**。
手工的几条写入路径(快记、分类页、订阅生成、退款)都显式传了 `status: 'completed'`,
只有助手构造的账单 payload 没传 —— 于是落库就是 NULL。

而缺状态的行在应用里**本来就按「计入余额」对待**(`isBalanceAffectingStatus(undefined)` 为真),
`statusQuickFilter.ts` 甚至把「缺省状态 = 已完成」写成了显式规则,注释里写着「两边口径一致」。
**但它只统一了筛选,没统一显示**:

```
TransactionTable.formatStatus:  if (!status) return '-';        ← 显示成「-」
筛选器:                        (status ?? 'completed') === filter  ← 按已完成匹配
```

于是助手的行**筛「已完成」筛得出来、状态列却显示成「-」**(实测:库里 status 为 NULL 的行,
状态列是「-」;手工行是「已完成」)。

### 改法(三处共用同一个默认值)

- 默认值上移到实体层:`DEFAULT_TRANSACTION_STATUS` 放进 `entities/transaction/types.ts`,
  store / 表格 / 筛选器都从那里取(`statusQuickFilter` 保留原导出,不改调用方)
- **显示**:缺状态时按默认状态渲染 → 显示「已完成」
- **写入**:`createTransactionRow`、`mergeTransactionRow` 都补上默认状态,
  store 侧从此不再产出没有状态的行(编辑历史行时会顺带补齐)

### 验证

- 新增 2 条回归测试:①故意不传 status 调 `addTransaction`,落库必须是默认状态
  ②缺状态的行在筛选器里按已完成匹配。**删掉 `createTransactionRow` 的兜底,第一条即失败**
  (expected undefined to be 'completed')
- 浏览器实测:那笔 `source=ai`、库里 status 为 NULL 的行,状态列从「-」变为「已完成」
- 前端 **1097 项 / 143 文件**、服务端 **38 项**
- `tsc` 0、`eslint --max-warnings=0` 0、i18n 两闸门 0、`check:dates` 0、`check:money` 0、
  `check:shared-predicates` 0、`audit:ledger-math` 通过
- `npm run audit:ui`:36 个组合,0 个问题

### 说明:库里那 4 笔旧行

显示已经正确,但**它们的 `transaction_status` 在库里仍然是 NULL**,下次经界面编辑时会补上。
不做数据迁移是有意的:缺状态的行在余额与统计里本来就按已完成处理,没有算错的钱,
只是写法不统一 —— 用一次静默的全表改写去换整齐,风险大于收益。

### 顺带:闸门自己的一处脆弱点

上一版给闸门加的 `file:line` 级豁免是**按行号匹配**的 —— 这次改动只插了几行注释,
三条豁免就全部失效、闸门误报。已改成按「文件 + 上一行 + 本行」的**内容**匹配,
并用「在文件顶部插 3 行、所有行号下移」实测过:**豁免依然命中,闸门仍为 0**。
真违规依然抓得住(故意加回一份本地 `roundMoney` → 报 1 处,并给出可直接粘贴的豁免键)。

### 仍然需要你拍板(第四次提出)

`isExpenseLike`(支出 + 预算 + 还款)与首页的 `isActualExpenseType`(支出 + 还款)对
**「预算」型交易**判断相反:记一笔 ¥100 的预算型交易后,页头「本月结余」减 100,
而「钱都去哪了」各分类合计不变。这也是口径清单里**唯一**没收敛掉的一项。
