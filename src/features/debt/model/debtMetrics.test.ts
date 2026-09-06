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
});
