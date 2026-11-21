# 写死中文文案审计(自动生成)

统计口径:模板字符串 + label/text/explanation 等字段值中含中文的数量。
排除:测试文件、locale 文件。

## 总览

| 分类 | 文件数 | 出现次数 |
| --- | --- | --- |
| 建议保留中文 | 12 | 476 |
| 建议翻译 | 70 | 778 |

## A. 建议保留中文(有意的,不算缺陷)

- `src/pages/assistant/AssistantPage.tsx` — 122 处 — 含 AI prompt 拼接,需逐条区分
- `src/features/assistant/agent/creditAgentTools.ts` — 103 处 — AI 工具描述/prompt,模型指令,中文是有意的
- `src/features/assistant/agent/assistantAgentTools.ts` — 70 处 — AI 工具描述/prompt,模型指令,中文是有意的
- `src/features/subscriptions/model/brandMarks.ts` — 39 处 — 品牌名映射表
- `src/shared/lib/backup.ts` — 28 处 — 备份/导入错误信息(服务端日志向)
- `src/pages/assistant/creditAssistantLogic.ts` — 25 处 — AI 对话 prompt 片段(喂给模型)
- `src/features/assistant/workbench/workbenchUtils.ts` — 19 处 — AI 工作台的工具输出/提示片段
- `src/features/debt/model/creditDrafts.ts` — 19 处 — 负债模板与示例数据(产品名、示例文案)
- `src/features/investments/api/eastmoneyMarketClient.ts` — 19 处 — 行情/资讯接口的解析标记与字段,非界面文案
- `src/features/assistant/agent/investmentAgentTools.ts` — 18 处 — AI 工具描述/prompt,模型指令,中文是有意的
- `src/features/investments/api/eastmoneyFundClient.ts` — 10 处 — 行情/资讯接口的解析标记与字段,非界面文案
- `src/features/assistant/agent/creditAgentRunner.ts` — 4 处 — AI 工具描述/prompt,模型指令,中文是有意的

## B. 建议翻译(用户可见 UI 文案)

按数量排序,可逐文件处理:

| 文件 | 处数 | 样例 |
| --- | --- | --- |
| `src/pages/transactions/TransactionsPage.tsx` | 169 | `;
  if (/微信\|wechat/i.test(combined)) {
    ret |
| `src/pages/investments/InvestmentsPage.tsx` | 121 | `;
}

function parseWatchPerformancePoints(items |
| `src/pages/repayment-management/RepaymentManagementPage.tsx` | 91 | `,
    dueDate: toISODate(nextDueDate),
    // T |
| `src/pages/investments/investmentAi.ts` | 45 | `json\s*/gi)];
  if (openFences.length > 0) {
   |
| `src/features/assistant/workbench/useAssistantWorkbench.ts` | 39 | `与第 ${previousIndex + 1} 笔内容相同，疑似同批次重复，请删除或修改后再保 |
| `src/features/transactions/components/TransactionTable.tsx` | 23 | `;
}

function getRepeatLabel(type: TransactionI |
| `src/features/assistant/api/webSearchClient.ts` | 22 | `未配置 ${WEB_SEARCH_PROVIDER_LABELS[provider]} API |
| `src/features/financial-analysis/model/analysis.ts` | 20 | `,
  confidenceEmpty: '当前没有可用于分析的交易数据，请先记录几笔流水。' |
| `src/features/transactions/model/exportTransactionsPdf.ts` | 18 | `
    : '—';
  const generatedAtText = new Date( |
| `src/features/smart-budget/ui/BudgetWizard.tsx` | 17 | `, getIdentityLabel(answers.identity))
    },
   |
| `src/features/assistant/investment-chat/InvestmentChatPanel.tsx` | 16 | `, {
        type: file.type \|\| item.type \|\| |
| `src/pages/assistant/creditRepaymentHelpers.ts` | 14 | `, 'zh-CN'));

  const anchorDay = resolveRepaym |
| `src/features/debt/components/RepaymentDashboard.tsx` | 13 | `}
          className="repayment-ring-progress" |
| `src/features/assistant/ui/BillPreviewCard.tsx` | 10 | `.trim()
  })),
  { value: 'UNKNOWN', key: 'bill |
| `src/pages/categories-accounts/CategoriesAccountsPage.tsx` | 9 | `);
  return {
    icon: CATEGORY_ICONS[seed % |
| `src/shared/lib/format.ts` | 9 | `;
  }

  const units = [
    { threshold: 1e24, |
| `src/features/assistant/workbench/semanticRecall.ts` | 8 | `;
}

export function getSemanticRecallCacheMeta |
| `src/features/transactions/components/TransactionDetailDrawer.tsx` | 8 | `;
}

function escapeHtml(value: string): string |
| `src/pages/subscriptions/SubscriptionsPage.tsx` | 8 | `;
}

function shiftDate(base: Date, days: numbe |
| `src/shared/store/useFinanceStore.ts` | 8 | `;
    const found = canonicalByKey.get(key);
   |
| `src/features/assistant/shared/assistantIntentVocabulary.ts` | 6 | label: '趋势变化' |
| `src/features/dashboard/model/assetLiabilitySimulation.ts` | 5 | `;
}

function isLiabilityAccount(account: Accou |
| `src/pages/dashboard/DashboardPage.tsx` | 5 | `,
          dateTo: toLocalDateKey(new Date(yea |
| `src/pages/financial-analysis/FinancialAnalysisPage.tsx` | 5 | `;
}

function metricValue(label: string, value: |
| `src/pages/smart-budget/SmartBudgetPage.tsx` | 5 | `/i);
  if (fenced?.[1]) {
    return fenced[1]. |
| `src/widgets/layout/AppLayout.tsx` | 5 | `} aria-hidden="true">
        <img className=" |
| `src/features/assistant/memory/extractGlobalMemories.ts` | 4 | `${item.role === 'user' ? '用户' : '助手'}：${item.te |
| `src/features/assistant/workbench/workbenchTypes.ts` | 4 | label: '最近1个月消费分析' |
| `src/features/smart-budget/ui/BudgetCategoryList.tsx` | 4 | `, status.label)}
        </span>
      </header |
| `src/features/transactions/components/TransactionFilters.tsx` | 4 | `}
          onClick={onToggleSidePanel}
        |
| `src/features/assistant/api/openaiCompatibleClient.ts` | 3 | `${message}(错误码:${code})` |
| `src/features/assistant/memory/globalMemoryRecall.ts` | 3 | `
    )
    .join('\n\n');

  const reply = awai |
| `src/features/debt/model/repaymentOverview.ts` | 3 | `;
}

function daysBetween(from: Date, to: Date) |
| `src/pages/finance/SalaryToolCard.tsx` | 3 | `}>
            <input
              className=" |
| `src/shared/api/syncClient.ts` | 3 | `;
}

function normalizeBase(base: string) {
  i |
| `src/features/assistant/creditAssistant/parser.ts` | 2 | `识别中项目 ${index + 1}` |
| `src/features/assistant/workbench/WorkbenchInputPanel.tsx` | 2 | `待发送图片 ${idx + 1}` |
| `src/features/dashboard/components/DashboardTopTransactionsCard.tsx` | 2 | `${date.getMonth() + 1}月${date.getDate()}日 ${hou |
| `src/features/dashboard/components/NetAssetCurveCard.tsx` | 2 | `较上月${delta > 0 ? '+' : ''}${formatCurrencyAuto( |
| `src/features/dashboard/model/netWorth.ts` | 2 | `;
}

function monthEnd(year: number, month: num |
| `src/features/exchange/ui/ExchangeConverter.tsx` | 2 | `;
    });
  }, []);

  const applyEqual = useCa |
| `src/features/smart-budget/ui/BudgetOverview.tsx` | 2 | `}
          >
            {formatCurrency(overv |
| `src/pages/database-settings/DatabaseSettingsPage.tsx` | 2 | `;
}

function loadStoredBackupScope(): FinanceB |
| `src/pages/finance/FinancePage.tsx` | 2 | `;
}

function readCachedNews(category: Tonghuas |
| `src/pages/transaction-edit/TransactionEditPage.tsx` | 2 | `.toLowerCase();
  const rules: Array<{ keyword: |
| `src/shared/lib/apiErrorTranslator.ts` | 2 | `
 * —— 那会把 i18n 的初始化时机提前到模块求值时,进而影响 key 解析顺序(测试 |
| `src/shared/lib/billImport.ts` | 2 | `;
  }
}

function parseAmount(raw: string): num |
| `src/shared/store/useAppPreferences.ts` | 2 | `;
}

function normalizeFeedUrl(rawUrl: string): |
| `src/features/assistant/api/openaiEmbeddingClient.ts` | 1 | `嵌入请求失败（HTTP ${response.status}）${detail ? ` |
| `src/features/assistant/workbench/WorkbenchPreviewPanel.tsx` | 1 | `需人工确认：${item.message}` |
| `src/features/assistant/workbench/workbenchMapping.ts` | 1 | `.toLowerCase();
  const tags = currentTags
     |
| `src/features/dashboard/components/DashboardCashflowAgenda.tsx` | 1 | `,
        date: due \|\| '',
        label: sub |
| `src/features/dashboard/components/DashboardMonthlyTrendSummaryCard.tsx` | 1 | `}
          >
            <span>{monthOverMonth |
| `src/features/dashboard/model/utils.ts` | 1 | `${date.getMonth() + 1}月` |
| `src/features/database-provider/ui/SqlDataSyncGate.tsx` | 1 | `, 'detail' in notice ? { detail: notice.detail  |
| `src/features/debt/components/RepaymentAgentBar.tsx` | 1 | `已按你的要求处理:${result.actions.map((action) => actio |
| `src/features/debt/model/debtPressureSchedule.ts` | 1 | `第 ${manualScheduleStartPeriod + index} 期` |
| `src/features/debug-log/ui/DebugLogPanel.tsx` | 1 | ` : ''}
      </button>

      {open ? (
        |
| `src/features/exchange/api/exchangeClient.ts` | 1 | `;
    const response = await fetch(url, { signa |
| `src/features/exchange/ui/ExchangeRateTable.tsx` | 1 | `}
                    onClick={() => toggleFavo |
| `src/features/finance/api/tonghuashunNewsClient.ts` | 1 | `);
  if (!response.ok) throw new Error('同花顺资讯加载 |
| `src/features/language-switcher/LanguageSwitcher.tsx` | 1 | label: '简体中文' |
| `src/features/mysql-snapshot/ui/MysqlSnapshotPanel.tsx` | 1 | `;
}

function formatTime(value: string \| null  |
| `src/features/smart-budget/ui/BudgetDetailDrawer.tsx` | 1 | ` }}
            />
          </div>
          < |
| `src/features/transactions/model/shareUtils.ts` | 1 | `;
}

/**
 * 构建交易分享文本
 */
export function buildT |
| `src/shared/api/connectionClient.ts` | 1 | `连接测试接口不可用（HTTP 404/405）。已尝试：${attempts.join(' \ |
| `src/shared/config/aiModels.ts` | 1 | `${value}(推荐)` |
| `src/shared/lib/localDate.ts` | 1 | ` 会先换算到 UTC,在 UTC+8 等东时区里,
 * 本地 00:00 常常会退到前一天, |
| `src/shared/store/globalMemory.ts` | 1 | `记忆 ${index + 1}` |
| `src/shared/store/useSyncStore.ts` | 1 | message: '在线数据库同步已移除' |
