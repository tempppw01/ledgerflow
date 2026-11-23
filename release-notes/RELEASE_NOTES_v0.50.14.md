## 助手把账单记到了一个不存在的账户上 + 口径统一(5 个提交)

### 一、本轮的真修复:助手记账落到不存在的账户

帮助里导入账单时(useAssistantWorkbench),账户是按两条分支取的:

```
草稿给了账户名 → ensureAccountId(...)     // 缺账户会新建 ✓
草稿没给账户名 → resolveAccountId(...)    // ← 这里会凭空返回 'acc-unknown'
```

而 `resolveAccountId` 在账本里**一个账户都没有**时是 `accounts[0]?.id || 'acc-unknown'`。
这个 id 在库里根本不存在,却直接被写进交易 payload。后果是那笔钱:

- **不在任何账户的余额里**(`computeAccountBalances` 没有这个账户)
- 却按支出**计入各种统计**

也就是「余额里看不到它、支出统计里却有它」—— 同一屏两套数。
另一条路径 `generateSubscriptionTransaction` 专门为这件事**拒绝写入**(注释里写着
「余额里看不到它、支出统计里却有它(同一屏两套数)」),这里却反着来。

**改法**

- 助手的写入分支两条都走 `ensureAccountId`:名字缺失时它会用
  `inferDefaultAccountName(source/type)` 兜出「微信钱包 / 支付宝 / 现金 / 银行卡 / 信用卡」,
  账本里没有账户时也会**先把账户建出来**
- `resolveAccountId` 不再造 id:没有账户就返回空串
  (它另一个调用方只拿它取显示名,空串本来就落到空标签,行为不变)

### 二、口径统一:把「同一个判断写了很多遍」收敛掉并装闸门

起因是上一轮的口径清单审计。已出过一次真事故:「资金动态看板」按月汇总时忘了排除退款,
同一页上页头是净额、卡片是「净额 + 2×退款」,演示账本 11 月因此多算 ¥781.10。

- **退款/冲正判断**:仓库里被手写了 24 遍 → 收敛 17 处到 `isTransactionRefundLike`
- **是否计入余额的状态**:1 处内联 → 收敛到 `isBalanceAffectingStatus`
- 按月分桶:清点后确认健康(全走 `resolveTransactionLocalDay` / `formatMonthKey`),未动
- 新增闸门 `npm run check:shared-predicates`([脚本](scripts/check-shared-predicates.mjs)),
  与既有的 `check:dates` / `check:money` 同一套路:再长回来就非 0 退出。
  刻意不查的地方都写了理由:谓词自身实现、**测试文件**(测试必须自己写一遍条件,
  否则谓词错了测试会跟着一起错)、脚本自身;`file:line` 级只豁免 2 处
  (`normalizeAdjustmentKind` 判的是「三种已知 kind 之一」;助手待办统计的是
  「待处理/失败的还款笔数」,两者都不是退款/余额判断)

### 三、记录在案、**没有改**的一条产品决策

`transactionMetrics.isExpenseLike`(支出 + 预算 + 还款)与首页的
`isActualExpenseType`(支出 + 还款)对**「预算」型交易**判断相反,后果在首页内部就能看到:
记一笔 ¥100 的预算型交易后,页头「本月结余」减 100,而「钱都去哪了」各分类合计不变。
「预算」型交易除下拉里一个选项外没有任何功能、没有测试、文档也没定义口径,两种读法
对应相反的修法 —— 因此只在两处谓词旁写清了冲突与实测数据,等决策。**这需要你拍板。**

### 验证

- 新增 2 条回归测试(一个账户都没有时 `resolveAccountId` 返回空串;
  草稿没名称也没账户时 `ensureAccountId` 先建出「微信钱包(virtual)」);
  **把 `resolveAccountId` 改回 `'acc-unknown'` 即失败**
- 闸门自证:把两处判断分别改回手写 → 各报 1 处、行号与提示正确;还原后回到 0
- 前端 **1095 项 / 142 文件**、服务端 **38 项**
- `tsc` 0、`eslint --max-warnings=0` 0、i18n 两闸门 0、`check:dates` 0、`check:money` 0、
  `check:shared-predicates` 0、`audit:ledger-math` 通过
- `npm run audit:ui`:36 个组合,0 个问题

### 顺带

清理了我自己误入库的两个临时脚本,并给 `.gitignore` 加了 `.tmp-*`(这类失误这轮出现过两次,
加规则比每次提醒自己可靠)。
