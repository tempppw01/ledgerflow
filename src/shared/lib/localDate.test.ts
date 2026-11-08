import { describe, expect, it } from 'vitest';
import { isBalanceAffectingStatus, toLocalDateKey } from './localDate';

describe('toLocalDateKey', () => {
  it('keeps the local calendar day instead of shifting to UTC', () => {
    // 本地当月 1 号 00:00,在 UTC+8 下 toISOString 会退到上个月最后一天。
    expect(toLocalDateKey(new Date(2026, 10, 1))).toBe('2026-11-01');
    expect(toLocalDateKey(new Date(2026, 10, 30))).toBe('2026-11-30');
    expect(toLocalDateKey(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('pads single digit months and days', () => {
    expect(toLocalDateKey(new Date(2026, 2, 5))).toBe('2026-03-05');
  });
});

describe('isBalanceAffectingStatus', () => {
  it('treats pending, closed and failed rows as non-balance-affecting', () => {
    expect(isBalanceAffectingStatus('pending')).toBe(false);
    expect(isBalanceAffectingStatus('closed')).toBe(false);
    expect(isBalanceAffectingStatus('failed')).toBe(false);
  });

  it('keeps completed, refunded and undefined rows in balances', () => {
    expect(isBalanceAffectingStatus('completed')).toBe(true);
    expect(isBalanceAffectingStatus('refunded')).toBe(true);
    expect(isBalanceAffectingStatus(undefined)).toBe(true);
  });
});
