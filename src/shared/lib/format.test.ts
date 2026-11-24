import { afterEach, describe, expect, it } from 'vitest';
import { baseCurrencySymbol, formatCurrency, formatCurrencyAuto, getBaseCurrency, setBaseCurrency, setFormattingLocale } from './format';

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

describe('本位币(账本计价单位)', () => {
  afterEach(() => {
    setBaseCurrency('CNY');
  });

  it('默认是 CNY,¥ 符号与以前一致', () => {
    expect(getBaseCurrency()).toBe('CNY');
    expect(baseCurrencySymbol()).toBe('¥');
    expect(formatCurrency(1234.56)).toContain('¥');
  });

  it('切成 USD 后,符号与数字格式都跟着变,但**数值不变**', () => {
    setBaseCurrency('USD');
    expect(getBaseCurrency()).toBe('USD');
    expect(baseCurrencySymbol()).toBe('$');
    const text = formatCurrency(1234.56);
    expect(text).toContain('$');
    expect(text).toContain('1,234.56');
    // 不做换算:1234.56 还是 1234.56
    expect(text).not.toContain('¥');
  });

  it('简写格式也用本位币符号(不是写死的 ¥)', () => {
    setBaseCurrency('USD');
    expect(formatCurrencyAuto(12345)).toContain('$');
    expect(formatCurrencyAuto(12345)).not.toContain('¥');
  });

  it('英文界面下简写仍是短符号,不会变成 CN¥', () => {
    setBaseCurrency('CNY');
    setFormattingLocale('en');
    const text = formatCurrencyAuto(12345);
    expect(text).toContain('¥');
    expect(text).not.toContain('CN¥');
    setFormattingLocale('zh');
  });

  it('非法币种被忽略,保持原值', () => {
    setBaseCurrency('USD');
    setBaseCurrency('NOT-A-CURRENCY');
    expect(getBaseCurrency()).toBe('USD');
  });

  it('eur / JPY 的短符号正确', () => {
    setBaseCurrency('EUR');
    expect(baseCurrencySymbol()).toBe('€');
    setBaseCurrency('JPY');
    expect(baseCurrencySymbol()).toBe('¥');
  });
});
