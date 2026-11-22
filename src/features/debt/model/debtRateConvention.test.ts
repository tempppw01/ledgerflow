import { describe, expect, it } from 'vitest';
import type { DebtItem } from './debtMetrics';
import { calculateDebtDerivedMetrics } from './debtMetrics';

/**
 * 利率口径不变量:**`annualRate` 存的是「百分数」**(18.25 表示 18.25%)。
 *
 * 这一点很容易被写错 —— 一旦有人按「小数」理解(0.1825),月供、利息、模拟全部差 100 倍。
 * 现存三处消费方都是按百分数除 100 的:
 * - 还款页月供:`annualRate / 12 / 100`
 * - 还款页利息:`balance * annualRate / 12 / 100`
 * - 资产负债模拟:`outstanding * (annualRate / 100 / 12)`
 *
 * 而 `monthlyRate` / `dailyRate` 是**展示用的百分比数值**(1.52 表示 1.52%/月),
 * 不能当小数直接乘余额。
 */
function debt(overrides: Partial<DebtItem> = {}): DebtItem {
  return {
    id: 'debt-1',
    name: '信用卡',
    type: 'credit-card',
    balance: 12000,
    annualRate: 18.25,
    repaymentDay: 10,
    minimumPaymentRate: 0.1,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as DebtItem;
}

describe('利率口径', () => {
  it('annualRate 原样保留为百分数', () => {
    const metrics = calculateDebtDerivedMetrics(debt());
    expect(metrics.annualRate).toBe(18.25);
    expect(metrics.apr).toBe(18.25);
  });

  it('monthlyRate / dailyRate 是「每月/每日的百分比数值」', () => {
    const metrics = calculateDebtDerivedMetrics(debt());
    expect(metrics.monthlyRate).toBeCloseTo(18.25 / 12, 6); // 1.5208… 表示 1.52%
    expect(metrics.dailyRate).toBeCloseTo(18.25 / 360, 6); // 0.0507… 表示 0.05%
  });

  it('按百分数换算的月利息 = 余额 × 年化 ÷ 12 ÷ 100', () => {
    const metrics = calculateDebtDerivedMetrics(debt());
    const monthlyInterest = (12000 * metrics.monthlyRate) / 100;
    expect(monthlyInterest).toBeCloseTo(182.5, 6);

    // 若误把 monthlyRate 当小数,会得到 18252 —— 差 100 倍
    expect(monthlyInterest).not.toBeCloseTo(12000 * metrics.monthlyRate, 2);
  });

  it('三处消费方算出的月利息一致', () => {
    const metrics = calculateDebtDerivedMetrics(debt());
    const fromMetrics = (12000 * metrics.monthlyRate) / 100;
    const fromAnnual = 12000 * (metrics.annualRate / 12 / 100);
    const fromSimulation = 12000 * (metrics.annualRate / 100 / 12);
    expect(fromMetrics).toBeCloseTo(fromAnnual, 8);
    expect(fromMetrics).toBeCloseTo(fromSimulation, 8);
  });

  it('没有利率时 annualRate 为 0,而不是 NaN', () => {
    const metrics = calculateDebtDerivedMetrics(debt({ annualRate: undefined }));
    expect(Number.isFinite(metrics.annualRate)).toBe(true);
    expect(metrics.annualRate).toBeGreaterThanOrEqual(0);
  });
});