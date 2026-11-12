import { createJSONStorage } from 'zustand/middleware';

/**
 * SQL 模式下业务状态只存在内存里。
 * 页面启动必须先从 /data/bootstrap 或 /data/import 得到服务端状态;
 * 浏览器刷新不能成为绕过 SQL 的事实来源。
 */
export const sqlOnlyStorage = createJSONStorage(() => ({
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
}));
