# JSX 文本节点里的硬编码中文

夹在 `>` 和 `<` 之间的中文(`<h4>今日财务雷达</h4>`)既不是 key 引用,也不在任何属性里,
`check-i18n-keys.mjs` 的两道闸门(`HARDCODED`、`HARDCODED-ATTR`)都覆盖不到,所以单独扫。

## 当前存量:0

```bash
npm run i18n:audit-jsx     # 列出清单(有存量时逐条打印)
npm run i18n:check-jsx     # 有存量就以非 0 退出,给 CI 用
```

扫描规则:匹配 `>中文<`;跳过 `{...}` 表达式(里面通常是 `tf(key, '兜底')` 的兜底文案)、
注释、含运算符的代码片段、`*.test.tsx`,以及外层 `aria-hidden="true"` 的装饰性文字
(例如同花顺品牌字标「同」——它不该被翻译)。

## 收敛过程

| 版本 | 存量 | 做了什么 |
| --- | --- | --- |
| v0.26.0 | 226 | 先清 `aria-label/title/placeholder` 里的 59 处,并加失败闸门 |
| v0.27.0 | 173 | 还款页成本表、调试日志、标签页 15 处;还款模板常量 4 条 |
| v0.28.0 | 154 | 投资页定投模拟 19 处 |
| v0.30.0 | 120 | 删掉零引用的工作台展示层与 TagsPage(31 处随之消失) |
| v0.31.0 | **0** | `AssistantPage` 信贷识别流程 119 处 + 收尾 14 处;闸门改为失败模式 |

## 两个反复踩到的坑(写下来省下一次)

1. **全角标点**:`下一步:` 里的冒号是 `:`,手写成半角 `:` 就匹配不上;
   `()`、`，` 同理。可靠做法是**从文件里把原文取出来**再拼 `tf(key, '原文')`,
   不要凭记忆敲。
2. **文本跨行**:`<div>\n  文字\n</div>` 这种,`>...<` 不在同一行。按行号替换很容易
   错位(我一度把结构行覆盖掉,靠 `git show HEAD:<file>` 才恢复)。
   稳妥做法是**按提取顺序的序号**定位,替换时用原文切片,不依赖行号。

## 仍然存在的同类债(不在本闸门范围)

### 1. 对象字面量里的界面文案(部分已收编)

`label: '中文'`、`detail: '...'` 这类写法不在 JSX 文本节点上,本闸门覆盖不到。
全站扫了一遍,`label|title|text|description|hint|placeholder|ariaLabel|summary|statusLabel`
等字段里共 **290 处**含中文,但分布决定了**不适合做全局闸门**:

| 文件 | 处数 | 性质 |
| --- | --- | --- |
| `features/assistant/agent/creditAgentTools.ts` | 82 | AI 工具描述 → **prompt,不该翻译** |
| `features/assistant/agent/assistantAgentTools.ts` | 45 | 同上 |
| `features/subscriptions/model/brandMarks.ts` | 39 | 品牌名 → 数据 |
| `pages/investments/InvestmentsPage.tsx` | 29 | 混合:部分 UI 文案、部分数据表 |
| `features/assistant/agent/investmentAgentTools.ts` | 12 | AI 工具描述 |
| `features/smart-budget/ui/BudgetWizard.tsx` | 13 | UI 文案(待收编) |
| 其它 | 70 | 行情字段名、格式化标签等数据 |

已收编的:`AssistantPage` 的「今日待办」卡片(4 个标题 + 4 条带计数的说明 + 1 个状态标签),
说明用 `{{count}}` 模板 + `.replace()` 注入,保持对象结构与类型不变。

**注意**:`ASSISTANT_INTENT_PATTERNS` 里的 `label`(趋势变化/复盘拆解…)虽然也命中,
但它最终拼进 **AI prompt** 的「回答偏好」,翻译成英文会改变给模型的指令 —— 保持中文。

### 2. 更宽的统计口径

`docs/i18n-hardcoded-audit.md` 的数字更大(含模板字符串与 prompt),那是另一份更早的分类统计,
两者口径不同,不要混着看。