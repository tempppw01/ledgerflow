import { describe, expect, it } from 'vitest';
import { calculateBudgetHealth } from './budgetHealth';

describe('calculateBudgetHealth', () => {
  it('gives a perfect score when nothing is overspent and pace is normal', () => {
    const health = calculateBudgetHealth({
      executionRate: 1,
      overspentCount: 0,
      monthIncome: 10000,
      monthExpense: 6000
    });

    expect(health.score).toBe(100);
    expect(health.level).toBe('excellent');
    expect(health.factors).toHaveLength(3);
  });

  it('penalises overspent categories and lists the reason', () => {
    const health = calculateBudgetHealth({
      executionRate: 1.5,
      overspentCount: 3,
      monthIncome: 10000,
      monthExpense: 8000
    });

    expect(health.score).toBeLessThan(60);
    expect(health.level).toBe('risk');
    const overspend = health.factors.find((item) => item.key === 'overspend');
    expect(overspend?.penalty).toBe(30);
    expect(overspend?.detail).toContain('3 个分类');
  });

  it('penalises when income cannot cover spending', () => {
    const health = calculateBudgetHealth({
      executionRate: 0.9,
      overspentCount: 0,
      monthIncome: 5000,
      monthExpense: 8000
    });

    const balance = health.factors.find((item) => item.key === 'balance');
    expect(balance?.penalty).toBeGreaterThan(0);
  });

  it('does not penalise spending less than planned', () => {
    // 曾经:underRate * 100 * 0.15 让「一分钱没花」也扣 15 分,而明细文案写的是
    // 「节奏可控」,界面上会出现「节奏可控 −15」这种自相矛盾的组合。
    const health = calculateBudgetHealth({
      executionRate: 0,
      overspentCount: 0,
      monthIncome: 5000,
      monthExpense: 0
    });

    const execution = health.factors.find((item) => item.key === 'execution');
    expect(execution?.penalty).toBe(0);
    expect(health.score).toBe(100);
    expect(health.level).toBe('excellent');
  });

  it('一个分类超得越狠,扣分越多 —— 不能和刚过线的一视同仁', () => {
    const base = { executionRate: 1, overspentCount: 1, monthIncome: 10000, monthExpense: 8000 };
    const barely = calculateBudgetHealth({ ...base, worstOverspendRatio: 1.01 });
    const badly = calculateBudgetHealth({ ...base, worstOverspendRatio: 2.38 });

    // 修复前两者都得 90 分 / 状态优秀,于是「固定支出超 ¥4,143」旁边
    // 写着「预算执行得很稳,可以把结余优先安排到储蓄」。
    expect(badly.score).toBeLessThan(barely.score);
    expect(badly.level).not.toBe('excellent');

    const detail = badly.factors.find((item) => item.key === 'overspend')?.detail;
    expect(detail).toContain('138%');
  });

  it('keeps penalising over-budget pace', () => {
    const health = calculateBudgetHealth({
      executionRate: 1.4,
      overspentCount: 0,
      monthIncome: 9000,
      monthExpense: 9000
    });

    const execution = health.factors.find((item) => item.key === 'execution');
    expect(execution?.penalty).toBeGreaterThan(0);
  });
});
