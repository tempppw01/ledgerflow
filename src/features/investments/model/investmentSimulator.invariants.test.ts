import { describe, expect, it } from 'vitest';
import {
  simulateInvestmentPlan,
  type InvestmentSimulationFrequency,
  type InvestmentSimulationPoint
} from './investmentSimulator';

/**
 * 定投模拟的数值不变量。
 *
 * 这个模块**内部不做任何取整**(份额、期末价值、收益率都保持全精度),这是对的:
 * 一旦在中间步骤取整,误差会随期数累积,「投入 1000 元、份额 12.3456」这类数字也会对不上。
 * 下面把这件事钉住 —— 尤其是**线性**:投入翻倍,期末价值必须精确翻倍;
 * 只要谁在中间加了一次 `roundMoney`,这条就会红。
 */
function dailyPoints(count: number): InvestmentSimulationPoint[] {
  const points: InvestmentSimulationPoint[] = [];
  let value = 1.2345;
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    // 价格有涨有跌,避免线性恰好成立
    value = Number((value * (i % 3 === 0 ? 1.0137 : 0.9923)).toFixed(4));
    points.push({ date, value });
  }
  return points;
}

const points = dailyPoints(40);

function run(overrides: Partial<Parameters<typeof simulateInvestmentPlan>[0]> = {}) {
  return simulateInvestmentPlan({
    points,
    startDate: points[0].date,
    endDate: points[25].date,
    amount: 100,
    frequency: 'trading-daily' as InvestmentSimulationFrequency,
    ...overrides
  });
}

describe('simulateInvestmentPlan 数值不变量', () => {
  it('投入总额恰好等于「每期金额 × 期数」', () => {
    const result = run();
    expect(result).toBeTruthy();
    expect(result!.investedAmount).toBe(100 * result!.contributionCount);
  });

  it('利润恰好等于「期末价值 − 投入总额」,收益率等于利润 ÷ 投入', () => {
    const result = run()!;
    expect(result.profit).toBeCloseTo(result.endingValue - result.investedAmount, 10);
    expect(result.returnRate).toBeCloseTo(result.profit / result.investedAmount, 12);
  });

  it('线性:每期金额翻倍,投入与期末价值精确翻倍(中间没有取整)', () => {
    const single = run({ amount: 100 })!;
    const doubled = run({ amount: 200 })!;

    expect(doubled.contributionCount).toBe(single.contributionCount);
    expect(doubled.investedAmount).toBe(single.investedAmount * 2);
    expect(doubled.endingValue).toBeCloseTo(single.endingValue * 2, 10);
    expect(doubled.shares).toBeCloseTo(single.shares * 2, 10);
  });

  it('份额与价值保持正数,且买入日期落在区间内', () => {
    const result = run()!;
    expect(result.shares).toBeGreaterThan(0);
    expect(result.endingValue).toBeGreaterThan(0);
    expect(result.firstBuyDate >= points[0].date).toBe(true);
    expect(result.lastBuyDate <= points[25].date).toBe(true);
    expect(result.firstBuyDate <= result.lastBuyDate).toBe(true);
  });

  it('非法输入返回 null,而不是算出 NaN', () => {
    expect(run({ amount: 0 })).toBeNull();
    expect(run({ amount: Number.NaN })).toBeNull();
    expect(run({ endDate: points[0].date, startDate: points[25].date })).toBeNull();
    expect(run({ points: [] })).toBeNull();
  });

  it('周投 / 月投的期数不超过按天数算出的上限', () => {
    for (const frequency of ['weekly', 'monthly'] as InvestmentSimulationFrequency[]) {
      const result = run({ frequency });
      expect(result).toBeTruthy();
      const days = 26;
      const maxCount = frequency === 'weekly' ? Math.ceil(days / 7) : 2;
      expect(result!.contributionCount).toBeLessThanOrEqual(maxCount);
      expect(result!.investedAmount).toBe(100 * result!.contributionCount);
    }
  });
});