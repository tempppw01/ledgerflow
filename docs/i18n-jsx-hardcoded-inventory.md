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

## 当前存量:173 处 / 9 个文件(起点 226)

| 文件 | 处数 | 是否挂载 |
| --- | --- | --- |
| `src/pages/assistant/AssistantPage.tsx` | 119 | ✅ 在用 |
| `src/pages/investments/InvestmentsPage.tsx` | 20 | ✅ 在用 |
| `src/features/assistant/workbench/WorkbenchPreviewPanel.tsx` | 15 | ❌ 无引用 |
| `src/features/assistant/workbench/WorkbenchAdvancedPanel.tsx` | 6 | ❌ 无引用 |
| `src/features/assistant/workbench/WorkbenchSettingsDrawer.tsx` | 6 | ❌ 无引用 |
| `src/features/assistant/workbench/WorkbenchInputPanel.tsx` | 3 | ❌ 无引用 |
| `src/features/assistant/workbench/WorkbenchSavePanel.tsx` | 1 | ❌ 无引用 |
| 其余零散 | ≤3 | 多数在用 |

## 先决问题:一批组件其实没有被渲染

盘点时发现 **13 个组件在 `src` 里零引用**(`grep -rn "<Name>"` 与 `git log` 都确认过,
不是懒加载、也没有 barrel 转出):

| 组件 | 备注 |
| --- | --- |
| `DashboardHistoryCompareCard` | 2026-09-21「simplify dashboard insight sections」之后失去引用 |
| `DashboardAnomalyInsights` | 同上 |
| `DashboardMonthlyTrendSummaryCard` | 同上 |
| `NetAssetCurveCard` | 2026-09-20 之后失去引用 |
| `DashboardTopTransactionsCard` | 无引用 |
| `DashboardModuleCustomizer` | 自 SQL 基础改造起就没有被挂载 |
| `MonthlyInsightPanel` | 自 v0.5.3 组件拆分起无引用 |
| `WorkbenchPreviewPanel` / `WorkbenchAdvancedPanel` / `WorkbenchSettingsDrawer` / `WorkbenchInputPanel` / `WorkbenchSavePanel` | 整个「AI 工作台」展示层无引用(页面自己在渲染) |
| `TagsPage` | 不在路由表里 |

**这直接影响下一步怎么做**:剩下的 173 处里,有 51 处属于这些没人渲染的文件。
在做 i18n 之前应先决定它们 **删除还是重新接上** —— 否则可能白翻译一批马上被删的代码。

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