# 验证配方:怎么把这些功能跑起来

这些都是**实际跑通过**的,不是猜的。踩过的坑写在一起,省得下一个人重踩。

## 起环境

```bash
npm run dev:test-user -- --create  <userId> <email>   # 临时账号,密码与演示账号相同
LEDGERFLOW_API_PORT=8799 npm run server:local        # API
LEDGERFLOW_API_PROXY_TARGET=http://127.0.0.1:8799 npx vite --port 5333 --strictPort
```

```bash
npm run dev:test-user -- --cleanup <userId> <email>   # 收工必须清
npm run audit:demo-baseline                           # 清完核对演示库基线
```

**不要用演示账号做手工验证** —— 会往基线库里写数据。脚本里有结构性保护,但习惯要养住。

## 驱动界面(Playwright / MCP 浏览器)

### 记一笔(快速记账抽屉)—— 这个抽屉的坑最多

| 想做的事 | 怎么做 |
| --- | --- |
| 打开抽屉 | 页面上有**两个「记一笔」**,要的是**最后那个**:`getByRole('button', { name: '记一笔' }).last()` |
| 填金额 | 金额框是 `<textarea id="quick-add-expression">` —— **不是 input**。用 `input[placeholder="0"]` 永远找不到 |
| 保存(会关抽屉) | `.quick-add-footer button.primary` |
| **再记一笔**(保留表单) | footer 里**文本为「再记一笔」**的那个按钮 —— 它**不是** `.primary` |

### 导入账单

| 想做的事 | 怎么做 |
| --- | --- |
| 打开导入 | 空交易列表里的「导入微信账单」/「导入支付宝账单」(v0.50.52 起);有交易时在「当期账单」那一排 |
| 递文件 | 它会点一个**隐藏的 file input**;Playwright 侧监听 filechooser 事件再 `setFiles` |
| **文件必须放哪** | MCP 浏览器的上传**只允许** `C:\Users\<你>\.dsh\profiles\desktop\` 下的文件 —— 放别处会报 “outside allowed roots”,先拷进去 |

### 改设置类的东西(比点 UI 稳)

偏好存在 localStorage 的 `ledgerflow-preferences` 里。直接改它再刷新即可,例如把 `accentTheme`
改成 `emerald`,然后看 `document.documentElement.dataset.accentTheme` 与 `--color-primary`。

## 全站回归扫描

项目自带的 `npm run audit:ui:local` **在这台机器上跑不起来**:它要 `chromium_headless_shell-1255`,
而机器上装的是 1169 / 1248。两条路:

1. `npx playwright install` 补上它要的版本,再 `PLAYWRIGHT_MODULE=… npm run audit:ui:local`;
2. **用 MCP 浏览器按 `scripts/audit-ui-browser.mjs` 里的 ROUTES 清单逐条走**(实测可用):
   每条查**控制台错误 + 横向溢出 + 4xx/5xx 请求**。清单里最后一条是故意不存在的路径(验 404 页)。

## 只跑某一类测试

```bash
npx vitest run src/shared/lib/billImport.xlsxFixture.test.ts    # 单文件
node --test server/stockSecIdFilter.test.js                      # 服务端单文件
```

**注意**:服务端测试偶发过一次 `bad port`(并行跑时),连跑 5 次无法复现;固定端口与"提前读端口"
两种常见原因都已排除 —— 详见 `docs/verified-invariants.md` 里的记录。

## 解析类测试怎么写

- **要测 xlsx 那一段,就必须用真实 xlsx**:xlsx 里日期是**序列号**,靠单元格样式才能还原;
  CSV 里日期本来就是文本,测不到。仓库里已有 fixture 目录:`src/shared/lib/__fixtures__/`。
- 那条测试需要 **Node 的 `Blob`(有 `.stream()`,解 zip 用)** + **jsdom 的 `DOMParser`(读 XML 用)**,
  两者缺一不可 —— 所以文件头是 `// @vitest-environment node`,并且 `import { JSDOM } from 'jsdom'`
  (为此加了最小的 `src/types/jsdom.d.ts`)。
- **造的输入要合法**:含逗号的金额字段**必须加引号**,否则会把 CSV 列切开 ——
  你会以为发现了 bug,其实是自己的 fixture 错(我在这上面栽过一次)。
- **断言"条数/金额/日期",不要断言耗时** —— 耗时断言会变成 flaky。
  想看性能就跑一遍打日志(实测 1 万行约 478ms,线性)。

## 两个容易漏掉的审计

这两个脚本一直**没注册进 package.json**,所以没人会发现它们(2026-11-25 补上):

```bash
npm run audit:jsx-hardcoded   # JSX 文本节点里的硬编码中文(当前 0 处)
npm run audit:unused-i18n     # i18n 死键:分成可安全删除与需人工确认两堆
```

`audit:unused-i18n` **是两步的**:它需要 `check-i18n-keys.mjs --json --unused` 先产出
`.i18n-report.json` —— npm 脚本里已经链好了,但你要是单独跑它,会看到
`ENOENT: .i18n-report.json`。**这不是脚本坏了,是少了前一步**(我在这上面绕过一次)。

它当前的结论:可安全删除的几十条(基本来自被删掉的仪表盘组件),另有 271 条需人工确认。
删除它们卡在**同一个障碍**上:语言文件不是规范化 JSON,整文件重写会产生约 4000 行格式 diff —— 见不变量清单。

## CI 里到底跑什么(2026-11-25 逐条核对)

**别再靠印象判断"这个闸门在不在 CI"** —— 我因为只读了 `ci.yml` 的一段,误判过两次。
下面是完整清单(共 12 类):

| 步骤 | 跑什么 |
| --- | --- |
| 类型 | `npx tsc --noEmit` |
| 代码风格 | `npm run lint`(`--max-warnings=0`) |
| 前端测试 | `npm test` |
| 服务端测试 | `npm run test:server`(`node --test server/*.test.js`)|
| 全部测试 | `npm run test:all` = 上面两条 |
| i18n | `npm run i18n:check` + `npm run i18n:check-jsx` |
| 日期用法 | `npm run check:dates`(独立一步) |
| 金额格式 | `npm run check:money`(独立一步) |
| 静态一致性(10 个) | `check:shared-predicates` · `check:docs` · `check:audit-routes` · `audit:sums` · `check:dynamic-i18n` · `check:orphan-methods` · `check:dead-exports` · `check:r2-fetch` · `check:gate-exceptions` · `check:version-sync` |

> **⚠ 坑:`npm test` 只跑前端。** 服务端有 12+ 个测试文件在 `src/` 之外(`server/*.test.js`),
> 而 vitest 的 `include` 只管 `src/**` —— 所以跑 `npm test` 看到"全绿"时,**服务端一条都没跑**。
> (2026-11-25 之前 `package.json` 里甚至没有服务端那条脚本,只有 CI 与文档在跑裸命令;
> 现在补成 `test:server` / `test:all`,`npm run` 里就能看到。)
>
> 这段原先是夹在表格中间的 —— 那会把表格从中间切断,后面几行会渲染成纯文本。
> 是 2026-11-25 把文档体检扩到全部 docs 之后才发现的。

**不在 CI 的**(要本地资源,只能手动跑):`audit:ledger-math`(要库)· `audit:ui` / `audit:ui:local`
(要 playwright + chromium)· `audit:demo-baseline`(要库)· `format:check`(全仓 349 文件不过,
**别跑** —— 见不变量清单)。

## 改完必须跑的

```bash
npx tsc --noEmit && npm run lint && npm test && node --test server/*.test.js
npm run i18n:check && npm run i18n:check-jsx
npm run check:dates && npm run check:money && npm run check:shared-predicates
npm run check:docs && npm run check:audit-routes && npm run audit:sums
npm run check:dynamic-i18n && npm run check:orphan-methods && npm run check:dead-exports
npm run audit:demo-baseline
```

其中前 **7 个**已经在 CI 里跑(verify job 的 Static consistency gates 一步)。
`audit:ledger-math` 与 `audit:ui` 不在 CI:前者要本地库,后者要 playwright 与 chromium。
