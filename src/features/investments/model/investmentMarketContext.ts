/**
 * 投资理财页与 AI 投资助手之间的行情上下文桥。
 *
 * 页面每次刷新行情快照后写入 sessionStorage,独立打开的 AI 投资助手
 * (例如 /assistant 的投资模式)可以直接复用同一份快照,避免同一份数据
 * 在两个入口表现不一致。
 */
const STORAGE_KEY = 'ledgerflow.investments.marketContext';

/** 超过这个时长的快照不再当作“实时行情”使用。 */
export const MARKET_CONTEXT_MAX_AGE_MS = 15 * 60 * 1000;

export interface CachedMarketContext {
  summary: string;
  updatedAt: number;
}

export function writeCachedMarketContext(summary: string): void {
  if (typeof window === 'undefined') return;
  const value = summary.trim();
  if (!value) return;
  try {
    const payload: CachedMarketContext = { summary: value, updatedAt: Date.now() };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 存储不可用时静默降级:AI 仍然能基于持仓与自选回答。
  }
}

export function readCachedMarketContext(
  maxAgeMs: number = MARKET_CONTEXT_MAX_AGE_MS
): CachedMarketContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedMarketContext>;
    if (!parsed || typeof parsed.summary !== 'string' || !parsed.summary.trim()) return null;
    const updatedAt = Number(parsed.updatedAt);
    if (!Number.isFinite(updatedAt)) return null;
    if (maxAgeMs > 0 && Date.now() - updatedAt > maxAgeMs) return null;
    return { summary: parsed.summary, updatedAt };
  } catch {
    return null;
  }
}

export function clearCachedMarketContext(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 给用户看的快照时间,例如「12:22」。 */
export function formatMarketContextTime(updatedAt: number): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
