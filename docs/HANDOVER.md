# 交接说明:v0.50.4 → v0.50.32 这一段

写这份说明是因为:这二十多个版本改动分散在金额口径、同步、回收站、预算、导入、认证几处,
**每条结论背后都有一份实测证据**,不写下来下次要重新挖一遍。

配套文档:`docs/verified-invariants.md`(每条不变量对应哪条测试/命令)、
`release-notes/RELEASE_NOTES_v0.50.*.md`(逐版说明)。

---

## 一、这段修掉的真问题(按危险程度排序)

### 1. 静默丢数据:整份快照同步会删掉另一个客户端的写入 —— **仍待决策**

- **机制**:客户端防抖 500ms 把**整份快照** `PUT /api/data/import`;服务端
  `replaceRelationalData` 先 `clearUserData`(删光该用户全部行)再按快照重插;
  推之前**不重新拉取、也不比版本**。
- **已严格复现**:两个标签页(同一会话)都加载完成 → A 记 333 → 查库确认 333 在 → B(状态里没有 333)
  记 444 → 查库:**333 消失**。
- **可达性**:两个标签页,或同一账号手机+电脑。日常就能撞上。
- **机制已钉成测试**:`server/importReplaceSemantics.test.js`(3 条)—— 哪天改成合并或加版本校验,
  这三条会翻红,提醒同步更新文档。
- **待你决策**:A 服务端合并(需删除墓碑)/ B 乐观并发(revision + 409)/ **C 推前检测 → 不推 →
  提示刷新**(我倾向先做 C:不丢数据、不改删除语义)。

### 2. 离线记的账,关页面就没了 —— **已修(v0.50.29)**

- 账本**不在浏览器持久化**(`shared/store/sqlOnlyStorage.ts` 是刻意的空实现,多用户隔离因此才干净),
  所以没推上去的改动只活在内存里。
- 实测:断网记 666 → 恢复联网刷新 → 界面和库里都没有 666,提示也一并消失。
- 修法:`useUnsyncedChangesGuard` —— 有未同步改动时,离开页面前让浏览器弹确认框。
- **未修复的部分**(属另一个量级):真正支持离线记账需要本地队列 + 重放 + 冲突处理,
  与上面第 1 条共用同一套设计。

### 3. 服务端丢行是静默的 —— **已修(v0.50.30)**

- 导入器会丢掉**引用无法解析**的行(最典型:交易引用的账户已被彻底删除),接口照样回 200,
  而客户端**从来不读返回的 `counts`**。
- 修法:比对「发出多少行 vs 服务端存下多少行」,有缺口就提示「同步完成,但以下记录没能写入服务端:
  交易 1 条…」;并且**不解除**上面的离开保护(那些行确实还在内存里)。
- `counts` 缺失/不可信时**倾向不报警**(宁可漏报,不要误报)。

### 4. 彻底删除账户会连带丢交易 —— **静默与文案已修,语义待决策**

- 机制:账户彻底删除后,引用它的交易在下一次同步时被服务端丢弃(即第 3 条的机制)。
- 已修:v0.50.30 让丢失可见;v0.50.31 给单条「彻底删除」补了确认框,并对账户如实写明
  「该账户下的 N 笔交易也会随之消失」。
- **待你决策**:拒绝删除仍有交易的账户(方案 C,我倾向)/ 重指派到某个账户 / 允许但明确告知。
  三者文案与行为不同;若选 C,v0.50.31 那个分支根本不会出现。

### 5. 「预算」型交易算不算支出 —— **待决策**

`transactionMetrics.isExpenseLike` 含 `budget`,`dashboard/model/utils.isActualExpenseType` 不含
→ 首页一屏内两个数字自相矛盾。需要一句「算」或「不算」来收敛类型集合。

---

## 二、这段修掉的其它问题(都已发版,有测试守着)

| 版本 | 问题 | 测试 |
| --- | --- | --- |
| v0.50.5 | 删除原交易时,挂在它上面的退款留在账上 → 余额凭空多一笔 | `store/trashRefundPair.test.ts` |
| v0.50.5 | 恢复已退款的支出时,退款留在回收站 → 账上少一笔 | 同上 |
| v0.50.16 | 缺省交易状态口径只统一了一半(筛选按已完成、显示「-」) | `store/defaultTransactionStatus.test.ts`、`transactions/model/statusLabel.test.ts` |
| v0.50.17 | 17 处金额取整各自为政 + 解析器漏取整(三位小数) | `shared/lib/money.test.ts`、`debt/model/creditDrafts.rounding.test.ts` |
| v0.50.18 / v0.50.32 | 删除生成流水不退续费日(再生成跳过一期);**恢复时不推回**(我引入的不对称) | `store/subscriptionRenewalRevert.test.ts`(6 条) |
| v0.50.20 | 助手汇总把退款又算成一笔支出、并把待支付计入 | `features/assistant/agent/assistantAgentTools.test.ts` |
| v0.50.21 | 「本月可投资现金」两份实现、两处都错、错法不同 | `investments/model/monthlyCashflow.test.ts` |
| v0.50.23 | 零预算分类显示「超支」却写「执行率 0.0%」 | `smart-budget/model/budgetZeroBudget.test.ts` |
| v0.50.24 | 「本周 vs 上周」按行号切,数据稀疏时结论会反 | `features/assistant/model/weeklyExpenseTrend.test.ts` |
| v0.50.25 / v0.50.26 | 导入变更检测与去重键归一不一致(日期格式/金额/备注/单号) | `shared/lib/billImport.mergeInvariant.test.ts` |
| v0.50.27 | 预算向导无视已登记的月收入,固定从 ¥10,000 起 | `smart-budget/model/wizardDefaults.test.ts` |
| v0.50.28 | 直接访问 `/login` 登录后落到 404 死胡同 | 手动回归 `AuthGate.test.tsx` |

---

## 三、验过、**没有问题**的部分(别重复挖)

- **数据出入口**:本地 JSON 备份往返(真实数据逐字段对比)、服务器恢复点、SQL 导出(全表兜底
  0 行越界)、多用户隔离、导入事务性 —— 全部实测过。
- **边界数据**:1970/2099 日期、金额上限、零金额 —— 钱与界面两层都干净。
- **批量操作**:批量删除复用单条逻辑(含退款级联);批量 AI 改分类经唯一索引换 id、绝不猜。
- **PWA**:`/api/` 不走 SW 回退、`skipWaiting` 立即接管、只缓存 CDN 静态资源且不含 API。
- **全局记忆 / 行情缓存 / 信用解析 / 摊还表 / 授信计算**:抽查均自洽,有测试覆盖。
- **发布链**:33 个 tag = 33 个 GitHub Release = 33 份 release notes,无缺口。

---

## 四、怎么复跑这些检查

```bash
npx tsc --noEmit && npm run lint && npm test && node --test server/*.test.js
npm run i18n:check && npm run i18n:check-jsx
npm run check:dates && npm run check:money && npm run check:shared-predicates
npm run check:docs && npm run check:audit-routes
node scripts/audit-ledger-math.mjs --email=demo.mcp@ledgerflow.local   # 需要库
PLAYWRIGHT_MODULE=<path>/playwright/index.mjs npm run audit:ui:local   # 起服务→审计→收尾
```

其中 `check:docs`(文档引用的测试必须存在、表格列数一致)、`check:shared-predicates`、
`check:audit-routes`(界面审计覆盖必须与路由对齐)三个**已经在 CI 里跑**。

---

## 五、这段工作的方法与教训

**有效的方法**(比随机翻页面产出高得多):

1. **按形状找问题**,而不是按模块:「同一概念两处实现」「两条判断用不同归一」「写死的默认值
   无视已有数据」「可逆操作用了不可逆的实现」—— 每条形状都至少命中一次。
2. **回头审自己的 diff**:五轮里四轮命中,抓到的全是**我自己留下的**问题,
   其中两处任何现有闸门都抓不到。
3. **每个修复都要能证伪**:删掉修复 → 测试必须翻红。这一步让我抓到三次「测试其实没测到」。
4. **把一次性的验证变成守卫**:`check:docs`、`check:audit-routes`、`audit-ui:local`、
   `importReplaceSemantics.test.js` 都是这么来的。

**代价最大的四类错误**(都发生过,且都伪装成"被测对象有缺陷"):

| 错误 | 表现 |
| --- | --- |
| id 语义混淆 | 拿 ledger 用户 id 去查 `auth_sessions`(那是 auth id)→ 假泄漏警报 |
| 假 0 行 | 先按 `transaction_id` 过滤一张该列全为 NULL 的表 → 「数据不见了」 |
| `String.replace` 只换第一处 | 证伪打偏,差点得出「测试无效」 |
| 临时脚本残留 | `.tmp-*` 被 gitignore 忽略,`git status` 看不见,却能让 lint 变红 |

共同点:**验证工具本身也需要验证** —— 每次先问一句「这个结果,有没有可能是我工具的问题」。