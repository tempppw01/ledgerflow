import type { ExchangeCache } from './types';

const STORAGE_KEY = 'ledgerflow-exchange-cache';
/** 缓存有效期：6 小时 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** 读取本地缓存，若过期或不存在返回 null */
export function readCache(base: string): ExchangeCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map: Record<string, ExchangeCache> = JSON.parse(raw);
    const entry = map[base];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

/** 写入缓存 */
export function writeCache(base: string, date: string, rates: Record<string, number>): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const map: Record<string, ExchangeCache> = raw ? JSON.parse(raw) : {};
    map[base] = { base, date, rates, cachedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 静默失败，不影响主流程
  }
}

/** 清除所有汇率缓存 */
export function clearCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 静默
  }
}

/** 导出 TTL 常量供测试使用 */
export { CACHE_TTL_MS };
