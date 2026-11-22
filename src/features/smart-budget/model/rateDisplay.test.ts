import { describe, expect, it } from 'vitest';
import { formatExecutionRatePercent } from './rateDisplay';

/**
 * 执行率显示。
 *
 * 预算 206、花掉 6,500 时执行率是 **3155.3%** —— 数学没错,但四位数的百分比对读者没有信息量
 * (真正有用的是「超支 ¥6,294」)。所以超过 999% 就封顶显示,其余保留一位小数。
 */
describe('formatExecutionRatePercent', () => {
  it('常规范围内保留一位小数', () => {
    expect(formatExecutionRatePercent(0)).toBe('0.0%');
    expect(formatExecutionRatePercent(0.5)).toBe('50.0%');
    expect(formatExecutionRatePercent(1)).toBe('100.0%');
    expect(formatExecutionRatePercent(1.611)).toBe('161.1%');
  });

  it('999% 以内不封顶', () => {
    expect(formatExecutionRatePercent(9.99)).toBe('999.0%');
  });

  it('超过 999% 显示为 >999%', () => {
    expect(formatExecutionRatePercent(10)).toBe('>999%');
    expect(formatExecutionRatePercent(31.553)).toBe('>999%');
  });

  it('非法值按 0 处理,不抛错', () => {
    expect(formatExecutionRatePercent(Number.NaN)).toBe('0.0%');
    expect(formatExecutionRatePercent(Number.POSITIVE_INFINITY)).toBe('>999%');
    expect(formatExecutionRatePercent(-1)).toBe('-100.0%');
  });
});