import { describe, expect, it } from 'vitest';
import { formatCurrencyAuto } from './format';

describe('formatCurrencyAuto', () => {
  it('keeps short amounts precise and abbreviates long amounts with Chinese units', () => {
    expect(formatCurrencyAuto(999)).toBe('¥999.00');
    expect(formatCurrencyAuto(1250)).toBe('¥1.25千');
    expect(formatCurrencyAuto(42547.67)).toBe('¥4.25万');
    expect(formatCurrencyAuto(-42547.67)).toBe('-¥4.25万');
    expect(formatCurrencyAuto(1234567)).toBe('¥123万');
  });
});
