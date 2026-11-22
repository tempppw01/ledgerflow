## 全局焦点环:键盘用户终于能看见焦点在哪

- 绝大多数可聚焦元素回退到浏览器默认 `outline: auto` 1px 深色描边,
  深色主题上对比度仅 1.0–1.3:1
- 按 Tab 走查 22 个焦点位置:交易流水 18 / 首页 16 / 还款管理 17 处仍在用默认环
- 加入全局 `:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`,
  改后三处计数全部为 **0**;组件自带的更具体规则仍然优先
- 记录两个测量陷阱:SVG 的填充是 `fill` 不是 `color`;`outline-offset` 的环画在父级背景上
- 现状与复测方法见 `docs/a11y-focus-and-contrast.md`
