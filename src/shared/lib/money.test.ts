import { describe, expect, it } from 'vitest';
import { roundMoney } from './money';

/**
 * 金额取整的不变量。重点是**同一个数值在任何模块里都必须得到同一个结果** ——
 * 之前 store 与信贷还款辅助各用一套算法,1.005 会分别得到 1.00 与 1.01。
 */
describe('roundMoney', () => {
  it('二进制浮点坑:1.005 必须进位到 1.01', () => {
    // 1.005 * 100 === 100.49999999999999,朴素的 Math.round 会给 1.00
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
  });

  it('负数的 .5 远离零(四舍五入,而不是向 +∞)', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-2.675)).toBe(-2.68);
    expect(roundMoney(-0.5)).toBe(-0.5);
  });

  it('幂等:取整两次结果不变', () => {
    for (const value of [0, 0.01, 1.005, 2.675, 1234.565, -1.005, -0.004]) {
      const once = roundMoney(value);
      expect(roundMoney(once)).toBe(once);
    }
  });

  it('普通值不动', () => {
    expect(roundMoney(100)).toBe(100);
    expect(roundMoney(88.8)).toBe(88.8);
    expect(roundMoney(0)).toBe(0);
  });

  it('非法值退化为 0,不产生 NaN', () => {
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
    expect(roundMoney(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('先求和再取整 == 先取整再求和(两位小数输入下)', () => {
    // 两位小数的输入不会因为取整而漂移,这是对账的前提
    const values = [0.1, 0.2, 0.3, 1.05, 2.35, 10.99];
    const sumThenRound = roundMoney(values.reduce((sum, value) => sum + value, 0));
    const roundThenSum = roundMoney(
      values.reduce((sum, value) => sum + roundMoney(value), 0)
    );
    expect(sumThenRound).toBe(roundThenSum);
  });

  it('大量小额累加不漂移', () => {
    const total = Array.from({ length: 100 }, () => 0.01).reduce((sum, value) => sum + value, 0);
    expect(roundMoney(total)).toBe(1);
  });
});