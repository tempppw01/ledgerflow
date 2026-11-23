## 恢复一份备份,会把用户教给 App 的分类纠正整批清空

这一版 1 个提交。按上一轮说的进到**数据与备份**的导入导出往返。

### 先确认了这块大部分是好的

- **服务器快照自身的往返完全无损**:真实演示数据 7166 个键,0 缺失 / 0 变化 / 0 新增
- 客户端「导出 → 文件 → 导入」的**字段差分**:7410 个键里 **0 处值变化**,
  只有 2 个字段蒸发 —— 就是下面这个

### 症状

恢复一份备份之后,**用户纠正过的分类学习规则与事件会全部消失**,而导入返回 **HTTP 200**。

真实数据实测:

```
BEFORE rules:  2 条规则        AFTER: []
BEFORE events: 1 条事件        AFTER: []
import status: 200
```

### 为什么

三个事实叠在一起:

1. **备份格式里没有这两个字段**:`backup.ts` 从头到尾没有 `categoryLearningRules`,
   它们是服务端 `finance` 侧的状态(存在 `ledger_user_settings` 里)
2. **服务端导入是照单写入的**:
   `setSetting(..., SETTING_KEYS.categoryLearningRules, list(finance.categoryLearningRules))`
   —— `list()` 取不到就是 `[]`
3. **客户端把它们放在服务端不读的地方**:恢复时拆成 `finance` / `preferences` 两段,
   这两个键只在 `preferences` 里,而服务端只从 `finance` 读

于是「恢复备份」= 用自己的当前状态覆盖,而这两个键在 `finance` 段里缺席 → 被写成空数组。

有意思的是,内存那一侧本来就是对的:`replaceAllData` 对缺席字段的处理是
**保留当前值**(`Array.isArray(incoming.x) ? incoming.x : currentState.x`),
所以问题只出在发给服务端的那份载荷上。

### 改法

- 新增 `withCurrentCategoryLearning(finance, current)`:把当前(或备份里明确带来的)
  学习状态补进准备发给服务端的 `finance` 段。语义与其它旧字段一致 ——
  **备份里带了就用备份的,没带就保留当前值**(空数组也算「明确带了」)
- `DatabaseSettingsPage` 的导入路径改用它

### 验证

- **真实服务端端到端**:写入 2 条规则 + 1 条事件 → 按修复后的形状导入 →
  两者原样保留(修复前同样的导入是 200 + 全空)
- 新增 **4 条**回归测试:缺键保留当前值 / 备份明确带了就用备份的(含空数组) /
  脏数据(非数组)退回当前值 / 两边都没有时给空数组
- 前端 **1092 项 / 142 文件**、服务端 **38 项**
- `tsc` 0、`eslint --max-warnings=0` 0、i18n 两闸门 0、`check:dates` 0、`check:money` 0
- `npm run audit:ui`:36 个组合,0 个问题

### 数据

- 验证用的学习规则与事件已还原为演示数据原本的空数组
- 交易 298 笔、`PRAGMA foreign_key_check` 干净
- 动手前先把库文件备份到 `data/backups/ledgerflow.before-roundtrip-*.sqlite`

### 仍然记录在案、没有动的

- **这两个键仍然不进备份文件**:修的是「恢复不要清空」,不是「把学习状态写进备份」。
  严格说,换台机器恢复时学习规则不会跟着走 —— 但它们是随账号走的服务端状态,
  用户换机时本来就在;把它们塞进备份格式需要升 version 并处理旧文件,
  属于功能级改动,不在这一版
- 之前记录过的投资持仓历史的几个字段(服务端不存、也没有组件渲染)保持原样