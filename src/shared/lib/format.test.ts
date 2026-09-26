import { describe, expect, it } from 'vitest';
import { formatCurrencyAuto } from './format';

describe('formatCurrencyAuto', () => {
  it('keeps short amounts precise and abbreviates long amounts with Chinese units', () => {
    expect(formatCurrencyAuto(999)).toBe('¥999.00');
    expect(formatCurrencyAuto(1250)).toBe('¥1.25千');
    expect(formatCurrencyAuto(42547.67)).toBe('¥4.25万');
    expect(formatCurrencyAuto(-42547.67)).toBe('-¥4.25万');
    expect(formatCurrencyAuto(1234567)).toBe('¥123万');
    expect(formatCurrencyAuto(165935693235659840)).toBe('¥16.6京');
    expect(formatCurrencyAuto(1234567890123)).toBe('¥1.23兆');
    expect(formatCurrencyAuto(-9876543210)).toBe('-¥98.8亿');
  });
});
