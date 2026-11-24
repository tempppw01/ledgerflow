import { useEffect } from 'react';

/**
 * 有**未同步到服务端**的改动时,离开页面前让浏览器弹确认框。
 *
 * 为什么需要:账本数据**不在浏览器里持久化**(`shared/store/sqlOnlyStorage.ts` 是空实现,
 * 这是刻意的 —— 账本只存在于 SQL,也因此多用户隔离才干净)。于是任何还没推上去的改动
 * 都**只活在内存里**:离线记一笔、然后关掉/刷新页面,那笔就没了,而且事后毫无痕迹。
 * 实测过一次:断网记 666 → 恢复联网刷新 → 库里和界面上都没有 666,提示也一并消失。
 *
 * 这个 hook 不改任何数据语义、不会丢数据:它只是把「静默丢失」变成「用户明确选择离开」。
 * 真正支持离线记账需要本地队列 + 重放 + 冲突处理,属于另一个量级的改动。
 */
export function useUnsyncedChangesGuard(hasUnsyncedChanges: boolean): void {
  useEffect(() => {
    if (!hasUnsyncedChanges) return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // 现代浏览器:preventDefault 即触发原生确认框
      event.preventDefault();
      // 部分浏览器仍要求 returnValue 非空才会弹
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsyncedChanges]);
}