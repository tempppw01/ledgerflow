import { afterEach, describe, expect, it } from 'vitest';
import { formatCurrencyAuto, setFormattingLocale } from './format';

afterEach(() => {
  // 其他用例默认中文数量级,避免这里的英文断言影响后续测试。
  setFormattingLocale('zh');
});

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

  it('switches to K/M/B units when the interface language is English', () => {
    setFormattingLocale('en');
    expect(formatCurrencyAuto(999)).toBe('¥999.00');
    expect(formatCurrencyAuto(1250)).toBe('¥1.25K');
    expect(formatCurrencyAuto(42547.67)).toBe('¥42.5K');
    expect(formatCurrencyAuto(-42547.67)).toBe('-¥42.5K');
    expect(formatCurrencyAuto(1234567)).toBe('¥1.23M');
    expect(formatCurrencyAuto(1234567890123)).toBe('¥1.23T');
  });

  it('falls back to Chinese units for non-English locales', () => {
    setFormattingLocale('en');
    setFormattingLocale('zh-CN');
    expect(formatCurrencyAuto(42547.67)).toBe('¥4.25万');
  });
});
