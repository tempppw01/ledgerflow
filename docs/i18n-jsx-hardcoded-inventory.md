# JSX 文本节点里的硬编码中文(存量清单)

`check-i18n-keys.mjs` 现在有两道闸门:

- `HARDCODED` —— `-eyebrow/-kicker/-badge` 这类标签元素里写死的文案
- `HARDCODED-ATTR` —— `aria-label` / `title` / `placeholder` 里写死的中文(已清零)

剩下最大的一块是**夹在 `>` 和 `<` 之间的中文**(`<h4>今日财务雷达</h4>`):它既不是 key
引用,也不在任何属性里,只能单独扫。

```bash
node scripts/audit-jsx-hardcoded.mjs           # 汇总(小文件逐条列出)
node scripts/audit-jsx-hardcoded.mjs --all     # 逐条列出全部
node scripts/audit-jsx-hardcoded.mjs --count   # 只输出总数,用来看趋势
```

扫描规则:匹配 `>中文<`;跳过 `{...}` 表达式(里面通常是 `tf(key, '兜底')` 的兜底文案)、
跳过注释、跳过含运算符的代码片段、跳过 `*.test.tsx`。

## 当前存量:120 处 / 2 个文件(起点 226)

| 文件 | 处数 | 说明 |
| --- | --- | --- |
| `src/pages/assistant/AssistantPage.tsx` | 119 | ✅ 在用;只在配置 AI 密钥并使用信贷识别时可见 |
| `src/pages/finance/FinancePage.tsx` | 1 | 「同」是同花顺品牌字标,外层 `aria-hidden="true"` —— **装饰性文字,不该翻译** |

扫描器目前不会跳过 `aria-hidden` 子树,所以最后这一条会长期留在计数里;看计数时把它当成
1 处已知噪声即可。

## 已删除的孤儿组件(2026-11-22)

盘点发现 13 个组件零引用,其中 7 个已删除(页面自己渲染了一套,或压根没接路由):

- 「AI 工作台」展示层:`WorkbenchPreviewPanel`、`WorkbenchAdvancedPanel`、
  `WorkbenchSettingsDrawer`、`WorkbenchInputPanel`、`WorkbenchSavePanel`、`WorkbenchTopbar`
  —— 注意同目录下的 `useAssistantWorkbench.ts`、`workbenchUtils.ts`、`workbenchTypes.ts`、
  `workbenchMapping.ts` 仍在用,只删了展示层
- `TagsPage`:不在路由表里

删除后:JSX 硬编码 154 → 120,同时清掉 10 条随之失效的 i18n key(zh/en 同步,parity 保持)。

**仍保留待定的 7 个仪表盘组件**:`DashboardHistoryCompareCard`、`DashboardAnomalyInsights`、
`DashboardMonthlyTrendSummaryCard`、`NetAssetCurveCard`、`DashboardTopTransactionsCard`、
`DashboardModuleCustomizer`、`MonthlyInsightPanel` —— 它们看着是 2026-09-21
「simplify dashboard insight sections」重构时被摘掉的卡片,可能还想恢复,所以没删。

## 已经收敛的部分

- `aria-label` / `title` / `placeholder`:59 处 → **0**(v0.26.0,已有失败闸门)
- 仪表盘卡片 5 个文件:22 处(顺带发现它们无引用,见上)
- 还款页负债成本表、调试日志、标签页:15 处
- 还款模板说明(「贷款模板 · 按账单补充参数」等 4 条)收进 `repayment.presets.*`,
  这是常量表里的文案:改成存 key、渲染时 `tf(key, '兜底')`

## 怎么继续收敛

1. **先处理孤儿组件**:决定删除还是接回,再决定要不要翻译它们。
2. 剩下真正在用的主要是 `AssistantPage`(119)与 `InvestmentsPage`(20):
   建议按面板分批,一次一个面板,同一条文案只建一个 key(如「取消」「保存」放 `common.*`)。
3. 每轮跑 `node scripts/audit-jsx-hardcoded.mjs --count`,数字必须下降。
4. 归零后再把这条规则做成会失败的闸门(现在做成失败闸门会立刻卡住 CI)。

## 为什么不直接加失败闸门

`HARDCODED-ATTR` 能一次清零(59 处)是因为替换模式统一;JSX 文本节点里混着标点、
emoji、`{tf()}` 表达式与拼接,机械替换容易改坏结构,更适合按文件过一遍。
清单先落地,避免这块债无声地越滚越大。