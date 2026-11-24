/**
 * 逐条同步的请求类型。
 *
 * 这个文件原来 193 行:五个接口 + 一套 requestWithFallback / requestJson / 路径拼接,
 * 都是「在线 SQL 逐条同步」时代的产物。那套同步停用后,除了下面这一个类型,
 * 其余全是死代码(已由 scripts/check-dead-exports.mjs 扫出并删除)。
 *
 * 唯一还在用它的地方是 shared/lib/dataSync.ts 的 syncChangeIfNeeded —— 而那个函数
 * 自己也是**有意保留的空实现**(它上面有说明)。所以这里只留下类型定义。
 */
export interface SyncChangeRequest {
  entity: 'transactions' | 'accounts' | 'categories';
  action: 'insert' | 'update' | 'delete';
  row?: unknown;
  id?: string;
  happenedAt: string;
}