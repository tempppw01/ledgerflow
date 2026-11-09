import { describe, expect, it } from 'vitest';
import {
  findMatchingCreditDebt,
  inferCreditDebtType,
  inferCreditProductTypeLabel
} from './debtClassification';
import type { DebtItem } from '../../debt/model/debtMetrics';

function buildDebt(overrides: Partial<DebtItem> = {}): DebtItem {
  return {
    id: 'debt-1',
    name: '招商银行信用卡',
    type: 'credit-card',
    balance: 5000,
    ...overrides
  };
}

describe('credit debt classification', () => {
  it('treats an explicit credit card as a card even when the label mentions installments', () => {
    expect(inferCreditDebtType('消费贷/信用卡分期', '招商银行信用卡')).toBe('credit-card');
    expect(inferCreditProductTypeLabel('消费贷/信用卡分期', '招商银行信用卡')).toBe('信用卡');
  });

  it('still classifies genuine consumer installments and loans correctly', () => {
    expect(inferCreditDebtType('花呗分期', '花呗')).toBe('consumer-loan');
    expect(inferCreditDebtType('住房贷款', '公积金贷款')).toBe('loan');
  });

  it('matches by debt name so the card status and repayment lookup stay consistent', () => {
    const matched = findMatchingCreditDebt(
      { title: '招商银行信用卡', productType: '信用卡' },
      [buildDebt()]
    );

    expect(matched?.id).toBe('debt-1');
  });
});
