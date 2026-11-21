# 异步状态与错误播报(live region)

读屏器不会自动播报"后来才出现"的文案。表单校验失败、接口报错、AI 识别中这类内容出现时,
焦点不移动、DOM 也没重建整页,用户听不到任何反馈。靠 `role="alert"`(立即播报)、
`role="status"` / `aria-live="polite"`(等当前朗读结束再播)或 `aria-busy` 才能让它们被念出来。

## 规则

| 场景 | 做法 |
| --- | --- |
| 异步错误 / 校验失败(用户操作后才出现) | `role="alert"` |
| 状态文案原地切换(加载中 → 空结果) | 容器加 `role="status"` |
| 按钮文案原地变「识别中…」、按钮被禁用 | 按钮加 `aria-busy={loading}` |
| **进页面就存在的静态警告横幅** | **不加** —— 它随正常阅读顺序就能读到,加 `alert` 反而每次渲染都播报 |
| 整页错误(路由错误页) | 不加 —— 页面整体重渲染,读屏器会从标题开始读 |

## 当前覆盖

`className` 含 `error/warning` 的容器共 **44** 个,其中 **22** 个已带播报:

| 文件 | 说明 |
| --- | --- |
| `Toast.tsx` | 全局 toast:`role="status" aria-live="polite"` ✓ |
| `ConfirmDialog` / `chat-error-strip` / `auth-error` / `chat-inline-error` / `settings-data-error` | 原本就有 `role="alert"` ✓ |
| `InvestmentsPage` | 行情错误、新闻错误、基金查询错误 ×6(本轮补) |
| `RepaymentManagementPage` | 负债表单错误、还款登记错误 ×4(本轮补) |
| `FinancialAnalysisPage` | AI 分析错误(本轮补) |
| `SalaryToolCard` | 工资 / 加班校验错误 ×2(本轮补) |
| `TransactionEditPage` · `RepaymentManagementPage` | 「识别中…」按钮加 `aria-busy`(本轮补) |
| `InvestmentsPage` 行情空态 | 加载中 ↔ 暂无数据,加 `role="status"`(本轮补) |

剩余 22 个里,大多数是**静态**横幅(路由错误页 8、备份范围提示、仪表盘提示等),
按上表规则不需要加。要复核时按这份清单逐个看「它是不是用户操作后才出现的」。

## 验证方式(以及这轮的局限)

- 源码级:上面这张表的每一处都已确认属性落在正确的元素上;`tsc` / `eslint` / 全量测试通过
- 运行级:本轮**没有**在浏览器里实际触发这些错误路径 —— 基金查询、行情错误、AI 分析
  都藏在需要特定选中态/接口失败的界面后面,试了几次没走到。要真验,最省事的办法是
  在 DevTools 里把接口置为失败,或用读屏器实际操作一次。

## 怎么继续

`node -e` 一行即可复核总数(见本文件末尾脚本),新增异步错误提示时按上表选择
`role="alert"` 还是 `role="status"`。若将来把所有动态错误都收进统一组件
(`${'<' }InlineError>` 之类),这条规则就只需要在组件内部实现一次。

```bash
# 统计 error/warning 容器的播报覆盖
node -e "$(sed -n '/^# 统计/,$p' docs/a11y-live-regions.md | tail -n +2)"
```