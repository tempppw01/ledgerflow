# LedgerFlow 样式分层约定

> 目标：降低 `src/app/styles/global.css` 持续膨胀风险，明确后续新增样式的落点与迁移方式。

## 当前分层

- `src/app/styles/index.css`
  - 样式总入口
  - 负责聚合导入顺序：`tokens.css -> global.css -> pages.css`
- `src/app/styles/tokens.css`
  - 设计令牌：颜色、字号、间距、圆角、阴影、动效变量
- `src/app/styles/global.css`
  - 全局基础层
  - 仅放：reset、layout shell、通用表单、按钮、共享 primitive、遗留共享规则
- `src/app/styles/pages.css`
  - 页面/业务域样式聚合层
  - 当前已承接一批 `transaction-*`、`dashboard-*` 相关规则

## 新增样式落点规则

### 应放到 `global.css` 的内容

只允许放以下内容：
- reset / base 元素规则
- 应用壳层布局（如 shell、sidebar、topbar）
- 全局通用组件基类（如 `.btn`、`.panel`、`.card`、`.badge`）
- 明确跨多个页面复用的工具型规则

### 不应继续放到 `global.css` 的内容

以下内容默认不要再直接追加到 `global.css`：
- `transaction-*`
- `dashboard-*`
- `finance-*`
- 某单独页面专用样式
- 某业务模块的局部状态样式

这些样式应优先写入 `pages.css`，或后续继续拆成独立页面文件后再由 `pages.css` 统一导入。

## 命名建议

- 页面域前缀保持稳定：
  - `transaction-*`
  - `dashboard-*`
  - `finance-*`
  - 其他页面按功能域新增前缀
- 避免无前缀、语义过泛的选择器直接落到业务层
- 对共享能力，优先沉淀为通用 primitive，再被页面域组合使用

## 迁移建议

后续继续拆分时，建议按以下顺序：
1. 先迁移整段连续的页面域规则
2. 再迁移只被单页面使用的状态样式
3. 最后再处理与共享规则交织的样式块

## 注意事项

- 每次迁移后必须跑构建验收
- 如果样式块和共享规则强耦合，优先保守处理，不要为拆分而拆分
- 当单个页面域样式继续增长时，可进一步拆为：
  - `pages.transaction.css`
  - `pages.dashboard.css`
  - `pages.finance.css`
  再由 `pages.css` 聚合导入

## LedgerFlow VI 快速启动层

新增页面优先使用 `vi-system.css` 中的共享类，减少每个页面重新发明卡片、标题、工具栏和空状态：

- 页面根节点：`.vi-page`，需要紧凑密度时叠加 `.vi-page--dense`
- 页面标题区：`.vi-page-head` + `.vi-page-title` + `.vi-page-actions`
- 重点首屏块：`.vi-hero`、`.vi-hero-copy`、`.vi-hero-media`
- 内容区域：`.vi-section`、`.vi-card`、`.vi-card--muted`、`.vi-card--active`
- 布局：`.vi-grid`、`.vi-grid--wide`、`.vi-grid--two`、`.vi-split`、`.vi-stack`
- 操作区：`.vi-toolbar`、`.vi-toolbar-main`、`.vi-action-row`
- 小组件：`.vi-chip`、`.vi-status--success|warning|danger|info`、`.vi-kpi-grid`、`.vi-empty`
- 工具类：`.vi-number`、`.vi-truncate`、`.vi-wrap-anywhere`、`.vi-scroll-panel`

推荐的新页面骨架：

```tsx
<div className="vi-page">
  <header className="vi-page-head">
    <div className="vi-page-title">
      <span className="vi-page-kicker">模块分组</span>
      <h2>页面标题</h2>
      <p>一句话说明当前页面能完成什么。</p>
    </div>
    <div className="vi-page-actions">
      <button type="button">次要操作</button>
      <button type="button" className="primary">主要操作</button>
    </div>
  </header>

  <section className="vi-section">
    <div className="vi-section-head">
      <div className="vi-section-title">
        <h3>区域标题</h3>
        <p>区域说明。</p>
      </div>
      <span className="vi-chip vi-chip--primary">状态</span>
    </div>
    <div className="vi-grid">
      <article className="vi-card">...</article>
    </div>
  </section>
</div>
```

落地规则：

- `vi-*` 类只放通用结构和视觉语义，不写业务含义。
- 页面专属状态继续放在 `pages.css` 或对应领域 CSS 文件里。
- 新增页面先用 `vi-*` 组合完成 80% 结构，再补少量页面前缀样式。
- 不要在页面里复制卡片阴影、标题字号、KPI 数字、chip 状态色等基础规则。
