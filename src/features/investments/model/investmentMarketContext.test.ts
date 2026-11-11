import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCachedMarketContext,
  formatMarketContextTime,
  readCachedMarketContext,
  writeCachedMarketContext
} from './investmentMarketContext';

const STORAGE_KEY = 'ledgerflow.investments.marketContext';

describe('investmentMarketContext', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('写入后可以读回同一份行情快照', () => {
    writeCachedMarketContext('{"marketIndexes":[]}');
    const cached = readCachedMarketContext();
    expect(cached?.summary).toBe('{"marketIndexes":[]}');
    expect(typeof cached?.updatedAt).toBe('number');
  });

  it('空内容不写入,避免用空快照覆盖已有数据', () => {
    writeCachedMarketContext('   ');
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('超过最大时效的快照视为不可用', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ summary: '{"old":true}', updatedAt: Date.now() - 60 * 60 * 1000 })
    );
    expect(readCachedMarketContext(15 * 60 * 1000)).toBeNull();
    expect(readCachedMarketContext(2 * 60 * 60 * 1000)?.summary).toBe('{"old":true}');
  });

  it('损坏的数据不会抛错', () => {
    window.sessionStorage.setItem(STORAGE_KEY, 'not-json');
    expect(readCachedMarketContext()).toBeNull();
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ summary: '' }));
    expect(readCachedMarketContext()).toBeNull();
  });

  it('可以清理缓存并格式化快照时间', () => {
    writeCachedMarketContext('{}');
    clearCachedMarketContext();
    expect(readCachedMarketContext()).toBeNull();

    const time = new Date();
    time.setHours(9, 5, 0, 0);
    expect(formatMarketContextTime(time.getTime())).toBe('09:05');
  });
});
