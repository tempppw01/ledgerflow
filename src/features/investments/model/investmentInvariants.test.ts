import { describe, expect, it } from 'vitest';
import {
  simulateInvestmentPlan,
  type InvestmentSimulationFrequency,
  type InvestmentSimulationPoint
} from './investmentSimulator';

/**
 * 定投模拟的不变量扫描。
 *
 * 同 budgetInvariants:与其「一个输入一个断言」,不如写下必须无条件成立的性质,
 * 再用大量输入去扫。覆盖三类性质:
 *  - 自洽性:期末市值 = 投入 + 盈亏;收益率 = 盈亏 / 投入
 *  - 平价:价格恒定时盈亏必须为 0、收益率必须为 0(口径一致,没有多算少算)
 *  - 排期:定投次数与手算的日历期望一致
 *
 * 说明:当前实现在这批扫描下没有暴露问题;这个文件的作用是把它锁住,以后改动
 * 定投逻辑(份额、排期、边界)如果破坏了这些性质,会立刻失败。
 */

function dailySeries(startISO: string, days: number, valueAt: (index: number) => number) {
  const points: InvestmentSimulationPoint[] = [];
  const base = new Date(`${startISO}T00:00:00.000Z`);
  for (let index = 0; index < days; index += 1) {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() + index);
    points.push({ date: date.toISOString().slice(0, 10), value: valueAt(index) });
  }
  return points;
}

describe('定投模拟不变量', () => {
  it('平价行情盈亏为 0,且各项金额自洽', () => {
    const problems: string[] = [];
    let checked = 0;
    const frequencies: InvestmentSimulationFrequency[] = ['trading-daily', 'weekly', 'monthly'];

    for (const frequency of frequencies) {
      for (const amount of [0.01, 0.1, 1, 99.99, 100, 1234.56]) {
        for (const days of [10, 100, 400]) {
          const points = dailySeries('2025-01-01', days, () => 1);
          const result = simulateInvestmentPlan({
            points,
            startDate: '2025-01-01',
            endDate: points[points.length - 1].date,
            amount,
            frequency,
            weekday: 3,
            dayOfMonth: 15
          });
          if (!result) continue;
          checked += 1;
          const tag = `${frequency} 金额${amount} 天数${days}`;

          if (Math.abs(result.endingValue - (result.profit + result.investedAmount)) > 1e-6) {
            problems.push(`${tag}: 期末市值不等于投入+盈亏`);
          }
          if (Math.abs(result.profit) > 1e-6) {
            problems.push(`${tag}: 平价行情却出现盈亏 ${result.profit}`);
          }
          if (Math.abs(result.returnRate) > 1e-9) {
            problems.push(`${tag}: 平价行情收益率非 0 (${result.returnRate})`);
          }
          if (Math.abs(result.investedAmount - result.contributionCount * amount) > 1e-6) {
            problems.push(
              `${tag}: 投入 ${result.investedAmount} ≠ 次数×金额 ${result.contributionCount * amount}`
            );
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  it('定投次数与日历期望一致', () => {
    const points = dailySeries('2025-01-01', 400, () => 1);
    const run = (over: Partial<Parameters<typeof simulateInvestmentPlan>[0]>) =>
      simulateInvestmentPlan({
        points,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        amount: 100,
        frequency: 'monthly',
        ...over
      });

    // 2025-01-01 是周三;周投目标周三,到 12-31 共 53 次
    const weekly = run({ frequency: 'weekly', weekday: 3 });
    expect(weekly?.contributionCount).toBe(53);
    expect(weekly?.firstBuyDate).toBe('2025-01-01');
    expect(weekly?.lastBuyDate).toBe('2025-12-31');

    // 每月 1 号 → 1 月到 12 月各一次
    const monthlyFirst = run({ dayOfMonth: 1 });
    expect(monthlyFirst?.contributionCount).toBe(12);
    expect(monthlyFirst?.firstBuyDate).toBe('2025-01-01');

    // 每月 31 号:2 月要夹到 28,之后要能回到 31 号,12 个月一次都不能少
    const monthlyLast = run({ dayOfMonth: 31 });
    expect(monthlyLast?.contributionCount).toBe(12);
    expect(monthlyLast?.firstBuyDate).toBe('2025-01-31');
    expect(monthlyLast?.lastBuyDate).toBe('2025-12-31');

    // 月中起投且目标日已过:第一次顺延到下月 15 号,共 11 次
    const midMonth = simulateInvestmentPlan({
      points,
      startDate: '2025-01-20',
      endDate: '2025-12-31',
      amount: 100,
      frequency: 'monthly',
      dayOfMonth: 15
    });
    expect(midMonth?.contributionCount).toBe(11);
    expect(midMonth?.firstBuyDate).toBe('2025-02-15');
  });

  it('随机行情下结果始终有限、自洽,涨势行情盈利', () => {
    // 固定种子的伪随机,保证可复现
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const problems: string[] = [];
    let checked = 0;
    const frequencies: InvestmentSimulationFrequency[] = ['trading-daily', 'weekly', 'monthly'];

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const days = 30 + Math.floor(random() * 500);
      const drift = (random() - 0.45) * 0.004;
      const volatility = random() * 0.05;
      let price = 1 + random() * 50;
      const points = dailySeries('2024-01-01', days, () => {
        price = Math.max(0.01, price * (1 + drift + (random() - 0.5) * volatility));
        return Math.round(price * 1000) / 1000;
      });

      const result = simulateInvestmentPlan({
        points,
        startDate: points[0].date,
        endDate: points[points.length - 1].date,
        amount: [0.01, 1, 50, 999.99][Math.floor(random() * 4)],
        frequency: frequencies[Math.floor(random() * 3)],
        weekday: 1 + Math.floor(random() * 7),
        dayOfMonth: 1 + Math.floor(random() * 31)
      });
      if (!result) continue;
      checked += 1;
      const tag = `第${iteration}轮 ${days}天`;

      for (const [name, value] of [
        ['投入', result.investedAmount],
        ['份额', result.shares],
        ['期末市值', result.endingValue],
        ['盈亏', result.profit],
        ['收益率', result.returnRate]
      ] as Array<[string, number]>) {
        if (!Number.isFinite(value)) {
          problems.push(`${tag}: ${name} 不是有限数`);
        }
      }
      if (result.investedAmount < 0 || result.shares < 0 || result.endingValue < 0) {
        problems.push(`${tag}: 出现负的投入/份额/市值`);
      }
      if (Math.abs(result.endingValue - (result.profit + result.investedAmount)) > 1e-6) {
        problems.push(`${tag}: 期末市值不等于投入+盈亏`);
      }
      if (result.contributionCount <= 0) {
        problems.push(`${tag}: 有结果却没有期数`);
      }
      if (!result.firstBuyDate || !result.lastBuyDate || result.firstBuyDate > result.lastBuyDate) {
        problems.push(`${tag}: 首末买入日异常`);
      }
    }

    expect(checked).toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });
});
