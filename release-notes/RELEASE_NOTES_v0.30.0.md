## 删除零引用的工作台展示层与 TagsPage

「AI 工作台」6 个展示组件与 `TagsPage` 外部引用均为 0(页面自己渲染了一套,或不在路由表)。

- 只删展示层;同目录 `useAssistantWorkbench.ts` / `workbenchUtils.ts` / `workbenchTypes.ts` /
  `workbenchMapping.ts` 仍被 7/11/11/5 处引用,原样保留
- 连带清掉 10 条随之失效的 i18n key
- JSX 硬编码计数 **154 → 120** —— 不是靠翻译,而是删掉了没人渲染的代码
- 7 张零引用仪表盘卡片保留待定
