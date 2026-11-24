/*
 * ⚠ 这个模块目前**全是空实现**,而且不会真的同步任何东西。
 *
 * 它存在的历史原因:SQL 逐条同步曾经从这里走,后来改成「整份快照 + 防抖」,
 * 这个模块留成了占位。useFinanceStore 里还有 18 处 `void syncChangeIfNeeded({...})`,
 * 看起来像「每次改动都会推到服务端」,实际上什么都没发生 —— 千万别基于这个假设写新逻辑
 * (比如「这行已经同步了,所以可以在别处只写本地」)。
 *
 * 真正保证数据落地的是另外两条路:
 *   1. zustand 的 persist 中间件 → localStorage,是本机持久化;
 *   2. SqlDataSyncGate 的**防抖整份同步**:本地数据一变,500ms 后把整份快照
 *      PUT 到 /data/import(载荷见该文件里的 getPayload)。
 *      所以「服务端有没有这笔数据」取决于那次整份同步,而不是这里的逐条调用。
 *
 * 另外 getPayload 只发它列出的那些切片:主题(theme / accentTheme)刻意只在本地,
 * 属于设备偏好;智能预算的 answers / recommendation / confirmedAt 通过
 * confirmedPlan 一起带走,不需要单独发。
 *
 * 要恢复逐条同步,应当先把这里的实现补实并补测试,而不是让调用点继续"看起来在工作"。
 */
import { SyncChangeRequest } from '../api/syncClient';

export type SyncDbType = 'redis';

export function hasEnabledSqlConnection() {
  return false;
}

export function resolveSyncTargetDbType(): SyncDbType | null {
  return null;
}

export async function syncChangeIfNeeded(payload: Omit<SyncChangeRequest, 'happenedAt'>) {
  void payload;
  return;
}
