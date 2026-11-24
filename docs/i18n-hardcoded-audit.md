# 写死中文文案审计(按出现位置分类)

> **⚠ 这份审计做于更早的时候,表里有些文件**后来被删掉了**。**
> 2026-11-25 清死代码时删了 8 个没人引用的文件(7 个仪表盘组件 +
> `src/shared/store/useSyncStore.ts`),它们在这张表里仍有行 —— 那些行**当时是对的**,
> 现在指向的文件已不存在(读者不必去找)。清单见 `docs/pruned-releases.md` 同期的提交记录。
> 之所以按条注说明、而不是重排整张表:这是一份**历史审计**,当时的数字有意义,改它反而是篡改记录。

统计口径:模板字符串 + `label/text/explanation/...` 字段值中含中文者;排除测试与 locale 文件。

> 注意:`tf(key, '中文')` 的第二个参数是**兜底文案**,与资源里的值重复是这条写法的本意,
> 不是「漏译」。下面的统计会把这类 fallback 也算进来,看数量时先扣掉它们。

**按出现次数分类**,不按文件 —— 同一个文件里往往既有 prompt 也有 UI 文案。

| 分类 | 出现次数 | 说明 |
| --- | --- | --- |
| ① 疑似 AI prompt / 模型指令 | 526 | AI 相关目录,或文案含「你是/请生成/必须…」等指令特征,或中文超过 60 字 |
| ② 数据/映射表 | 115 | 品牌名映射、行情接口解析标记、负债示例模板、备份日志 |
| ③ 疑似用户可见 UI 文案 | 613 | 其余:短标签、报错、空状态等 |

## ③ 疑似 UI 文案 —— 按文件排序

| 文件 | 处数 | 样例 |
| --- | --- | --- |
| `src/pages/transactions/TransactionsPage.tsx` | 165 | 支付宝 |
| `src/pages/investments/InvestmentsPage.tsx` | 107 | 月周日年 |
| `src/pages/repayment-management/RepaymentManagementPage.tsx` | 82 | 同额 |
| `src/features/assistant/api/webSearchClient.ts` | 22 | 未配置  |
| `src/features/transactions/components/TransactionTable.tsx` | 20 | 收入 |
| `src/features/financial-analysis/model/analysis.ts` | 19 | 当前分析周期内真实消费记录较少，先连续补齐几笔支出后再判断习惯。 |
| `src/features/transactions/model/exportTransactionsPdf.ts` | 18 | 批量交易导出 |
| `src/features/smart-budget/ui/BudgetWizard.tsx` | 17 | 收入 |
| `src/features/debt/components/RepaymentDashboard.tsx` | 12 | 暂无活跃负债 |
| `src/pages/assistant/creditRepaymentHelpers.ts` | 12 | 计划应还暂未稳定识别 |
| `src/features/assistant/ui/BillPreviewCard.tsx` | 10 | 需人工确认： |
| `src/features/assistant/investment-chat/InvestmentChatPanel.tsx` | 9 | 页面实时上下文 |
| `src/shared/lib/format.ts` | 9 | 秭 |
| `src/features/transactions/components/TransactionDetailDrawer.tsx` | 7 | 显著偏高，建议检查是否重复记账，或确认是否为一次性大额消费。 |
| `src/shared/store/useFinanceStore.ts` | 7 | 子分类要跟到规范化后的父  |
| `src/features/assistant/shared/assistantIntentVocabulary.ts` | 6 | 趋势变化 |
| `src/pages/categories-accounts/CategoriesAccountsPage.tsx` | 6 | 子分类 |
| `src/features/dashboard/model/assetLiabilitySimulation.ts` | 5 | 计划收入 |
| `src/pages/dashboard/DashboardPage.tsx` | 5 | 用方向化金额避免把退款又算成一笔消费。 |
| `src/pages/subscriptions/SubscriptionsPage.tsx` | 5 | 中国移动  |
| `src/features/smart-budget/ui/BudgetCategoryList.tsx` | 4 | 预算金额 |
| `src/features/assistant/memory/extractGlobalMemories.ts` | 3 | 请从下面对话中提炼最多  |
| `src/features/debt/model/repaymentOverview.ts` | 3 | 只展示尚未到期的账单；若本月还款日已过去，下一笔应落到下个月。 |
| `src/features/transactions/components/TransactionFilters.tsx` | 3 | 收起洞察 |
| `src/pages/finance/SalaryToolCard.tsx` | 3 | 计薪天数 |
| `src/pages/smart-budget/SmartBudgetPage.tsx` | 3 | 预算执行总体平稳，可持续跟踪超支项。 |
| `src/shared/api/syncClient.ts` | 3 | 避免  |
| `src/widgets/layout/AppLayout.tsx` | 3 | 展开侧边栏 |
| `src/features/assistant/api/openaiCompatibleClient.ts` | 2 | 错误码 |
| `src/features/assistant/creditAssistant/parser.ts` | 2 | 识别中项目  |
| `src/features/assistant/memory/globalMemoryRecall.ts` | 2 | 重排序  |
| `src/features/dashboard/components/DashboardTopTransactionsCard.tsx` | 2 | 日  |
| `src/features/dashboard/components/NetAssetCurveCard.tsx` | 2 | 较上月 |
| `src/features/dashboard/model/netWorth.ts` | 2 | 冲正按原始类型反向记账 |
| `src/features/exchange/ui/ExchangeConverter.tsx` | 2 | 表达式无效 |
| `src/features/smart-budget/ui/BudgetOverview.tsx` | 2 | 个分类在预算内 |
| `src/pages/finance/FinancePage.tsx` | 2 | 今天 |
| `src/pages/financial-analysis/FinancialAnalysisPage.tsx` | 2 | 仍需与你的真实消费背景一起判断。 |
| `src/shared/lib/apiErrorTranslator.ts` | 2 | 的初始化时机提前到模块求值时 |
| `src/shared/lib/billImport.ts` | 2 | 统一两位小数，避免浮点误差导致金额展示异常。 |
| `src/shared/store/useAppPreferences.ts` | 2 | 从已有持仓生成历史快照 |
| `src/features/assistant/api/openaiEmbeddingClient.ts` | 1 | 嵌入请求失败（ |
| `src/features/dashboard/components/DashboardCashflowAgenda.tsx` | 1 | 只有出现订阅条目时才多留一列放  |
| `src/features/dashboard/model/utils.ts` | 1 | 月 |
| `src/features/debt/components/RepaymentAgentBar.tsx` | 1 | 已按你的要求处理 |
| `src/features/debt/model/debtPressureSchedule.ts` | 1 | 第  |
| `src/features/debug-log/ui/DebugLogPanel.tsx` | 1 | 调试日志滚动容器 |
| `src/features/exchange/api/exchangeClient.ts` | 1 | 所以单测等未合并  |
| `src/features/exchange/ui/ExchangeRateTable.tsx` | 1 | 否则读屏软件只会念到一个没有名字的按钮 |
| `src/features/finance/api/tonghuashunNewsClient.ts` | 1 | 同花顺资讯加载失败，请稍后重试。 |
| `src/features/language-switcher/LanguageSwitcher.tsx` | 1 | 简体中文 |
| `src/features/mysql-snapshot/ui/MysqlSnapshotPanel.tsx` | 1 | 尚未读取数据库快照 |
| `src/features/smart-budget/ui/BudgetDetailDrawer.tsx` | 1 | 执行率 |
| `src/features/transactions/model/shareUtils.ts` | 1 | 构建交易分享文本 |
| `src/pages/database-settings/DatabaseSettingsPage.tsx` | 1 | 正在写入数据库 |
| `src/shared/api/connectionClient.ts` | 1 | 连接测试接口不可用（ |
| `src/shared/config/aiModels.ts` | 1 | 推荐 |
| `src/shared/lib/localDate.ts` | 1 | 天」这类区间整体前移一天。 |
| `src/shared/store/globalMemory.ts` | 1 | 记忆  |
| `src/shared/store/useSyncStore.ts` | 1 | 在线数据库同步已移除 |

## ① 疑似 prompt 样例(供复核,不应翻译)

- `src/features/assistant/agent/assistantAgentTools.ts` — 返回条数
- `src/features/assistant/agent/assistantAgentTools.ts` — 未分类
- `src/features/assistant/agent/assistantAgentTools.ts` — 需要提供账户 
- `src/features/assistant/agent/assistantAgentTools.ts` — 请先确认要操作哪一个
- `src/features/assistant/agent/assistantAgentTools.ts` — 得到可直接回写 
- `src/features/assistant/agent/assistantAgentTools.ts` — 账户类型必须是现金、借记卡、储蓄卡或虚拟账户。
- `src/features/assistant/agent/assistantAgentTools.ts` — 初始余额必须是有效数字。
- `src/features/assistant/agent/assistantAgentTools.ts` — 账户类型必须是现金、借记卡、储蓄卡或虚拟账户。
- `src/features/assistant/agent/assistantAgentTools.ts` — 账户名称和类型没有变化
- `src/features/assistant/agent/assistantAgentTools.ts` — 校准余额必须是有效数字。
- `src/features/assistant/agent/assistantAgentTools.ts` — 已校准账户余额
- `src/features/assistant/agent/assistantAgentTools.ts` — 笔关联流水。请先向用户说明影响并取得明确确认。

## 死 key(UNUSED)清理流程

`scripts/check-i18n-keys.mjs --unused` 会列出「资源里有、代码里搜不到」的 key。
但**它曾经把用到的 key 误报成死 key**,照着删就会删掉还在用的文案。已经被修掉的三个盲点:

| 盲点 | 例子 | 影响 |
| --- | --- | --- |
| 别名表漏登记 | `tFallback('dashboard.ui.densityTitle', ...)`(79 处) | 一开始报 319 条 UNUSED,其中 49 条其实在用 |
| key 先存进 state | `setErrorKey('finance.ui.loadFailed')`,渲染时 `t(errorKey)` | 4 条在用 key 被误报 |
| helper 拼 key | `getCurrencyNameKey(code)` 返回 `` `exchange.currency.${code}` `` | 30 条币种 key 被误报 |

现在除了别名表,脚本还会收集:`*Key(...)` setter、源码里任何 `xxx.yyy.${...}` / `'xxx.yyy.' + ...`
形式的 key 前缀;并且会把「函数名不在别名表、但第一个参数像 key」的调用单列成
`UNKNOWN-CALLEE`,提示可能又多了个没登记的包装函数。

`--unused` 只是提示,不会让 CI 失败。真要去删,用:

```bash
node scripts/check-i18n-keys.mjs --json --unused > .i18n-report.json
node scripts/audit-unused-i18n.mjs          # 输出「可以安全删除」与「需要人工确认」两堆
```

`audit-unused-i18n.mjs` 的五道门(任一不过就退回人工)见脚本头部注释;其中
「中文值出现在生产代码里」经常因为 `tf(key, '中文')` 的 fallback 命中,属于误报,不必当回事;
真正要小心的是「key 字面量 / 末段 / 父路径出现在代码里」。

删除后必须做一次冒烟:`t('key')` 取不到会把原始 key 渲染到界面上,所以逐个路由扫一遍
页面文本与 DOM 里有没有出现被删的 key 字符串(实测 18 个路由共 0 泄漏)。
