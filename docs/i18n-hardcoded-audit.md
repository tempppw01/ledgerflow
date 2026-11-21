# 写死中文文案审计(按出现位置分类)

统计口径:模板字符串 + `label/text/explanation/...` 字段值中含中文者;排除测试与 locale 文件。

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
