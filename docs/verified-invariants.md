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

| 测试 | 保护的行为 |
| --- | --- |
| `shared/lib/money.test.ts` | 取整只有一个实现:`1.005 → 1.01`、负数 `.5` 远离零、幂等(含 `-0`)、非法值退化为 0、先求和再取整 == 先取整再求和 |
| `store/refundInvariant.test.ts` | 退款总额不得超过原交易金额:创建时拒绝、**编辑时也拒绝**(否则账户净额凭空多钱);导入/恢复可走 `allowRefundOverflow` 逃生门 |
| `store/refundInference.test.ts` | 缺 `adjustmentKind` 时的方向推断:明确写了就不推翻;**不能**因为 `status: 'refunded'` 就把原交易当成退款(会把余额算成两倍) |
| `investments/model/investmentSimulator.invariants.test.ts` | 定投模拟全程不取整:投入 = 每期 × 期数、利润/收益率自洽、**线性**(金额翻倍则结果精确翻倍)、非法输入返回 null |

## 日期

| 测试 | 保护的行为 |
| --- | --- |
| `shared/lib/localDate.test.ts` | 「今天」用本地日期(`toISOString` 在 UTC+8 清晨会给昨天);`daysSinceLocalDate` 一天 24 小时都稳定 |
| `transactions/hooks/dateRangePresets.test.ts` | 本月/近 30 天/近 3 个月的边界(闰年、跨月、跨年),上个月最后一天不能落进本月 |
| `shared/lib/subscriptionSchedule.test.ts` | 续费推进按 UTC 日历运算(负时区不会跳月)、纯日期进纯日期出、时区无关 |

## 状态与分类身份

| 测试 | 保护的行为 |
| --- | --- |
| `shared/lib/categoryLabels.test.ts` | 分类显示名:同名加「父 / 子」;`buildCategoryLabelIndex` 只给**能唯一确定分类**的名字(加前缀后仍重名的排除) |
| `features/dashboard/model/categoryBreakdown.test.ts` | 分类聚合身份是 **id 不是名字**;未知分类显示「未分类」而不是内部 id |
| `financial-analysis/model/categoryAggregation.test.ts` | 同名子分类不合并、金额与占比各自独立 |
| `transactions/model/statusQuickFilter.test.ts` | 缺省状态按「已完成」处理,与 `isBalanceAffectingStatus` 同一结论 |
| `store/uncategorizedCoherence.test.ts` | 「未分类」三处口径一致:数据用空串、筛选哨兵、助手计数 |
| `subscriptions/model/subscriptionStatus.test.ts` | 逾期判定按**本地日历日**:到期当天是「即将到期」,次日才「逾期」,与时区无关 |

## 数据完整性

| 测试 | 保护的行为 |
| --- | --- |
| `shared/lib/backup.roundtrip.test.ts` | 备份**全字段**往返:导出 → JSON → 解析逐字段相等(曾丢 `parentId`、持仓代码/份额、AI 消息字段等 10 个) |
| `store/importSnapshotInvariant.test.ts` | 导入后:带 `trashedAt` 的行不留在主列表、同一 id 不重复(以回收站为准)、分类父子关系保留、余额按「影响余额的行」重算 |
| `store/trashSymmetry.test.ts` | 删除/恢复/永久删除对称:往返字段不少、余额对称、重复操作是空操作、主列表已有同 id 时恢复不会让记录消失 |
| `shared/lib/billImport.mergeInvariant.test.ts` | 重复导入不丢字段:来源里没有的字段(`status`/单号)不能把已有值覆盖成 `undefined` |
| `shared/lib/transactionMetrics.test.ts` | 汇总口径:待支付/已关闭/失败/已删除不计入;过滤结果与账户余额判据逐行相等 |

## 可访问性与 i18n 的闸门(命令式,不在上面那套里)

| 命令 | 作用 |
| --- | --- |
| `npm run i18n:check` | i18n key 缺失/单边/写死属性;命中即非 0 退出 |
| `npm run i18n:check-jsx` | JSX 文本节点里的硬编码中文;命中即非 0 退出 |
| `npm run check:dates` | 禁止 `date.slice(0, 10)`(按 UTC 取日);命中即非 0 退出 |
| `node scripts/audit-jsx-hardcoded.mjs --count` | 同上,只看数字(用于看趋势) |

## 已知但**故意不**当作 bug 的

- **纯中文数字不解析**(「欠款五千」「三千五」):属于**安全失败** —— 金额字段留空,
  由「待补字段」提示用户填写;比猜错强


- 账户名匹配微信/支付宝(`workbenchMapping`、`importAccount`):故意的启发式
- 标签按字符串统计:标签本身就是字符串,重名合并是语义正确的
- 分类占比/投资占比各自独立取整,合计可能是 99.9%:显示层通病,修需要重新分配(会改动用户看到的数字),暂不处理
- 账单识别:一边有订单号、另一边没有时会判成两笔(跨来源同一笔消费可能重复记账)—— 既有设计取舍