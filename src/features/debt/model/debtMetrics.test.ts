import { describe, expect, it } from 'vitest';
import {
  calculateDebtDerivedMetrics,
  calculateDebtHealthScore,
  calculateDebtMinimumPayment,
  calculateDebtScheduledPayment,
  calculateDebtSummary,
  DebtItem
} from './debtMetrics';

describe('debtMetrics', () => {
  it('calculates minimum payment for credit card and consumer loan by rules', () => {
    const creditCard: DebtItem = {
      id: 'd1',
      name: '招商信用卡',
      type: 'credit-card',
      balance: 1200
    };
    const consumerLoan: DebtItem = {
      id: 'd2',
      name: '消费贷',
      type: 'consumer-loan',
      balance: 200
    };

    expect(calculateDebtMinimumPayment(creditCard)).toBe(120);
    expect(calculateDebtMinimumPayment(consumerLoan)).toBe(50);
  });

  it('uses amortized formula as the fixed monthly installment for loans', () => {
    const loan: DebtItem = {
      id: 'd3',
      name: '消费贷',
      type: 'loan',
      balance: 120000,
      annualRate: 4.8,
      remainingMonths: 60
    };

    const result = calculateDebtMinimumPayment(loan);
    expect(result).toBeGreaterThan(2200);
    expect(result).toBeLessThan(2300);
    expect(calculateDebtScheduledPayment(loan)).toBe(result);
  });

  it('uses the earliest manually planned installment instead of re-amortizing a loan balance', () => {
    const loan: DebtItem = {
      id: 'd3-manual-plan',
      name: '京东白条',
      type: 'loan',
      balance: 19000,
      remainingMonths: 2,
      manualRepayments: [
        { dueDate: '2026-10-29', amount: 2900 },
        { dueDate: '2026-09-29', amount: 6000 }
      ]
    };

    expect(calculateDebtMinimumPayment(loan)).toBe(6000);
    expect(calculateDebtScheduledPayment(loan)).toBe(6000);
  });

  it('infers loan annual rate from principal/total repayment/periods when annualRate missing', () => {
    const loan: DebtItem = {
      id: 'd4',
      name: '房贷',
      type: 'loan',
      balance: 100000,
      remainingMonths: 36,
      totalPeriods: 36,
      paidPeriods: 0,
      loanPrincipal: 100000,
      totalRepayment: 112000
    };

    const result = calculateDebtMinimumPayment(loan);
    expect(result).toBeGreaterThan(2900);
    expect(result).toBeLessThan(3200);
  });

  it('returns debt pressure ratio by monthly income', () => {
    const summary = calculateDebtSummary(
      [
        { id: 'd1', name: '信用卡', type: 'credit-card', balance: 6000 },
        { id: 'd2', name: '消费贷', type: 'consumer-loan', balance: 3000 }
      ],
      10000
    );

    expect(summary.totalDebt).toBe(9000);
    expect(summary.totalMinimumPayment).toBe(900);
    expect(summary.pressureRatio).toBe(0.09);
  });

  it('calculates debt health score by debt ratio and minimum payment pressure', () => {
    const summary = calculateDebtSummary(
      [
        { id: 'd1', name: '信用卡', type: 'credit-card', balance: 60000 },
        { id: 'd2', name: '消费贷', type: 'consumer-loan', balance: 20000 }
      ],
      10000
    );

    const score = calculateDebtHealthScore(summary, 10000);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(25);
  });

  it('derives unified rate and cost metrics for loans', () => {
    const loan: DebtItem = {
      id: 'd5',
      name: '经营贷',
      type: 'loan',
      balance: 80000,
      totalPeriods: 24,
      paidPeriods: 6,
      remainingMonths: 18,
      loanPrincipal: 100000,
      totalRepayment: 112000
    };

    const result = calculateDebtDerivedMetrics(loan);
    expect(result.rateSource).toBe('inferred');
    expect(result.annualRate).toBeGreaterThan(0);
    expect(result.apr).toBe(result.annualRate);
    expect(result.monthlyRate).toBeCloseTo(result.annualRate / 12, 5);
    expect(result.remainingMonths).toBe(18);
    expect(result.minimumPayment).toBeGreaterThan(0);
    expect(result.remainingTotalCost).toBeGreaterThan(result.remainingInterestCost || 0);
  });

  /**
   * 最低还款额不能超过欠款本身。
   * 以前是 Math.max(欠款 × 比例, 规则下限),下限 100 元会原样套到小额欠款上:
   * 欠 30 元的信用卡被算出「最低还款 100 元」,比欠款还多。连带把汇总里的
   * totalMinimumPayment、pressureRatio 与健康分一起算歪。
   */
  it('never asks for a minimum payment larger than the balance', () => {
    const problems: string[] = [];

    for (const type of ['credit-card', 'consumer-loan'] as const) {
      for (let balance = 0.01; balance <= 5000; balance += balance < 200 ? 0.5 : 25) {
        const safeBalance = Math.round(balance * 100) / 100;
        const minimum = calculateDebtMinimumPayment({
          id: 'debt',
          name: '测试',
          type,
          balance: safeBalance
        });
        if (minimum > safeBalance + 1e-9) {
          problems.push(`${type} 欠款 ${safeBalance} 算出最低还款 ${minimum}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('keeps the percentage rule for balances above the floor', () => {
    // 大额不受影响:1200 × 10% = 120
    expect(
      calculateDebtMinimumPayment({ id: 'a', name: '信用卡', type: 'credit-card', balance: 1200 })
    ).toBe(120);
    // 小额:下限被欠款本身压住,等于一次还清
    expect(
      calculateDebtMinimumPayment({ id: 'b', name: '信用卡', type: 'credit-card', balance: 30 })
    ).toBe(30);
  });
});
