## 卸载之后还在跑的定时器:一个让 CI「测试全过却红」的真实缺陷

这一版 2 个提交,只做一件事:**把「延迟清除状态」的定时器收进一个可测的 hook。**

### 起因:CI 红在一个说不出理由的地方

v0.49.0 的 release 提交上,CI 给出了这样一份日志:

```
Tests  1039 passed (1039)
Errors 1 error

Uncaught Exception
ReferenceError: window is not defined
 ❯ dispatchSetState node_modules/react-dom/cjs/react-dom.development.js:16648:14
 ❯ Timeout._onTimeout src/pages/repayment-management/RepaymentManagementPage.tsx:2670:31
     2669|      setExtractSuccess(true);
     2670|      window.setTimeout(() => setExtractSuccess(false), 1400);
```

**1039 项测试全部通过,但闸门是红的。** 原因是「截图识别成功」的提示在 1.4 秒后自动收起,
而这个定时器从来没被清理:测试环境拆除 window 之后它才到点,于是 `setExtractSuccess`
在已销毁的 window 上触发 setState,Vitest 记为 unhandled error。

这**不只是测试问题** —— 用户在 1.4 秒内离开还款管理页,原本一样会在卸载后 setState。

### 修完一处,才发现同类还有 10 处

第一版只改了 CI 报出来的那一处。之后全仓扫了一遍「定时器里含 setState」的调用点,发现:

- 同一个文件里还有 **3 处**同类裸定时器(只改到 1 处)
- `DatabaseSettingsPage` 里还有 **7 处**(WebDAV 3 + 对象存储 3 + 备份进度 1)

**靠 CI 日志一行行修会一直漏。**

### 做法:提成 hook,而不是逐个打补丁

新增 `src/shared/lib/useStatusTimers.ts`。这类定时器到处是同一形态 —— 操作完成后显示一条提示、
过几秒自动收起 —— 裸写有两个问题:

1. **卸载后仍在跑** → 在已卸载的组件上 setState(见上)
2. **同一个 key 会堆积** → 连续触发两次(例如连点两次导出)会留下两个回调,
   前一个把后一个刚显示的提示清掉

hook 一次解决两件:按 key 覆盖旧的、卸载时全部清掉,并返回取消函数。

配套 **6 项测试**钉住行为:到点执行 / 同 key 覆盖 / 不同 key 互不影响 /
**卸载后到点不再执行** / cancel 生效 / 任务已执行后再 cancel 不抛错。

### 收口的调用点(9 处)

| 文件 | 处数 | 原样 |
| --- | --- | --- |
| `pages/database-settings/DatabaseSettingsPage.tsx` | 7 | `setTimeout(() => setWebdavStatus(''), 2400)`、`setObjectStorageStatus('')`、`setBackupImportProgress(null)`(4000ms) |
| `pages/repayment-management/RepaymentManagementPage.tsx` | 2 | `setTimeout(() => setAddDebtSuccess(false), 800)`,以及最初那处 `setExtractSuccess(false)` |

### 确认过**不需要**改的

其余调用点所在文件都已有 `clearTimeout`。剩下两处没有清理但确实无害,是核对过代码而非凭印象:

- `AssistantPage.tsx:1627`:`setTimeout(..., 0)` 只做 `composer.focus()`,不触状态
- `RepaymentManagementPage.tsx:3212`:同上,0ms 聚焦还款金额输入框

### 验证

- 前端 **1045 项 / 139 文件**(新增 6 项)、服务端 35 项
- `tsc` 0、`eslint --max-warnings=0` 0、i18n 两闸门 0、`check:dates` 0、`check:money` 0
- CI 的 `verify` 已通过
