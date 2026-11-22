import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDateRange } from './useTransactionFilters';
import type { TransactionFilterState } from './useTransactionFilters';

/**
 * 日期预设的边界不变量。
 *
 * 这类地方最容易出「差一天」:本月漏掉最后一天、近 30 天算成 29 天、跨月/闰年错位。
 * 断言全部用本地日期,配合假时钟把「今天」固定住,任何时区跑起来都一致。
 */
function state(overrides: Partial<TransactionFilterState>): TransactionFilterState {
  return {
    type: 'all',
    source: 'all',
    keyword: '',
    datePreset: 'all',
    dateFrom: '',
    dateTo: '',
    page: 1,
    ...overrides
  } as TransactionFilterState;
}

/** 两个 yyyy-mm-dd 之间相差的天数(含首尾)。 */
function inclusiveDayCount(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function setToday(year: number, month: number, day: number) {
  vi.setSystemTime(new Date(year, month - 1, day, 10, 0, 0));
}

describe('resolveDateRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('本月:从 1 号到最后一天,今天落在区间内', () => {
    setToday(2026, 11, 22);
    const { from, to } = resolveDateRange(state({ datePreset: 'thisMonth' }));
    expect(from).toBe('2026-11-01');
    expect(to).toBe('2026-11-30');
    expect('2026-11-22' >= from && '2026-11-22' <= to).toBe(true);
  });

  it('本月:上个月最后一天必须落在区间外(边界不能多一天)', () => {
    setToday(2026, 11, 1);
    const { from } = resolveDateRange(state({ datePreset: 'thisMonth' }));
    expect(from).toBe('2026-11-01');
    expect('2026-10-31' >= from).toBe(false);
  });

  it('本月:闰年 2 月的最后一天是 29 号', () => {
    setToday(2028, 2, 10);
    const { from, to } = resolveDateRange(state({ datePreset: 'thisMonth' }));
    expect(from).toBe('2028-02-01');
    expect(to).toBe('2028-02-29');
  });

  it('近 30 天:恰好 30 天且包含今天', () => {
    setToday(2026, 11, 22);
    const { from, to } = resolveDateRange(state({ datePreset: 'last30' }));
    expect(to).toBe('2026-11-22');
    expect(from).toBe('2026-10-24');
    expect(inclusiveDayCount(from, to)).toBe(30);
  });

  it('近 30 天:跨月时同样成立', () => {
    setToday(2026, 3, 5);
    const { from, to } = resolveDateRange(state({ datePreset: 'last30' }));
    expect(inclusiveDayCount(from, to)).toBe(30);
    // 3 月 5 日往前 29 天 → 2 月 4 日
    expect(from).toBe('2026-02-04');
  });

  it('近 3 个月:含最远那月 1 号,不含再往前一天', () => {
    setToday(2026, 11, 22);
    const { from, to } = resolveDateRange(state({ datePreset: 'last3Months' }));
    expect(from).toBe('2026-09-01');
    expect(to).toBe('2026-11-30');
    expect('2026-08-31' >= from).toBe(false);
    expect('2026-11-22' >= from && '2026-11-22' <= to).toBe(true);
  });

  it('近 3 个月:跨年正确', () => {
    setToday(2027, 1, 15);
    const { from, to } = resolveDateRange(state({ datePreset: 'last3Months' }));
    expect(from).toBe('2026-11-01');
    expect(to).toBe('2027-01-31');
  });

  it('自定义区间原样返回', () => {
    setToday(2026, 11, 22);
    const { from, to } = resolveDateRange(
      state({ datePreset: 'custom', dateFrom: '2026-01-05', dateTo: '2026-02-06' })
    );
    expect({ from, to }).toEqual({ from: '2026-01-05', to: '2026-02-06' });
  });

  it('「全部」不施加日期约束', () => {
    setToday(2026, 11, 22);
    const { from, to } = resolveDateRange(state({ datePreset: 'all' }));
    expect(from).toBe('');
    expect(to).toBe('');
  });
});