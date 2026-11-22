## 性能与「让防护真正生效」

这一版有一个用户能直接感觉到的修复(导入不再卡半分钟),以及一处**让此前所有测试与闸门
终于在 CI 里跑起来**的基础设施改动。

### 1. 批量导入:500 行从约 29 秒降到 70 毫秒

导入账单/恢复备份原本是**逐条**调用 `addTransaction`:

```ts
const insertedIds = result.append.map((item) => addTransaction(item));
```

而**每次写操作都会对全部流水重算账户余额**,于是导入 N 行的代价是 O(N × 总流水数)。
实测(1 万条存量):

| 操作 | 耗时 |
| --- | --- |
| 单条 `addTransaction` | 55–83ms |
| 批量 `addTransaction` × 500 | **71ms** |
| 推演:逐条导入 500 行 | **约 29 秒** |

`addTransaction` 本来就支持批量形态(一次 `set()`、一次余额重算),只是导入路径没用它。
现在交易页与数据库设置页的**新增与更新**都改成批量写:500 行 **29s → 70ms(约 430×)**。

细节:更新走批量前先过滤「目标已不存在」的行(批量路径对缺失 id 会直接抛错,不该中断整次导入);
批量路径直接 merge 行,与导入「允许历史数据」的既有意图一致。

### 2. CI 此前只打镜像 —— 968 个测试与所有闸门从未在 CI 跑过

`.github/workflows/ci.yml` 里唯一的 job 是构建并推送 Docker 镜像。Dockerfile 的
`npm run build` 会跑 `tsc`,但**测试、lint、服务端测试、以及 `scripts/` 下的三道闸门
(i18n key、JSX 硬编码、日期用法)从来没在 CI 里执行过** —— 那些闸门当时只是本地约定。

新增 `verify` job 并让镜像 job `needs: verify`:**闸门失败会拦住镜像发布**。
第一次运行就暴露出一个真实的环境问题:

```
ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite   (Node 20)
```

服务端代码用了 `node:sqlite`(**Node 22+ 才有**),而没有任何地方声明这个要求。
已补 `package.json` 的 `"engines": { "node": ">=22" }`,并把 verify 固定到 **Node 24**
(与运行镜像一致)。

### 3. 新增 1 万条数据量的耗时检查

`scale.perf.test.ts`:汇总 1.2ms · 过滤 0.3ms · 财务分析 19ms · 单条写 83ms ·
批量 500 行 71ms · 批量更新 73ms。断言用宽松上界(拦数量级退化),耗时打印便于对比历史。

> 踩坑记录:该文件最初用了 `vi.useFakeTimers()`,所有耗时都测成 `0.0ms` ——
> **假时钟会把 `performance.now()` 一起 mock**。已移除并写明。

### 4. 另外两处

- **还款周期不变量**(9 项):遍历 2026 全年 × 还款日 1/5/15/28/29/30/31,验证「到期日落在
  自己窗口内」「相邻两期不重叠」「到期日当天只算一期」「29/30/31 在小月夹到月末」,
  以及两个历史坑的形状(宽限期内迟还算本期、之后归下期)
- **README 补齐验证方式与 Node 要求**,并链到 `docs/verified-invariants.md`

### 验证

- 前端 **981 项 / 130 文件**、服务端 35 项
- `tsc` 0、`eslint` 0、i18n 缺失 0、`i18n:check-jsx` 0、`check:dates` 0
- CI 两个 job 均绿(`verify` 1m32s、`docker-latest` 8m46s)