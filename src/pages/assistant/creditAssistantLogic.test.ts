import { describe, expect, it } from 'vitest';
import {
  annualizeCreditInterest,
  enrichCreditItemsForConfirmation,
  formatCreditAccountReference,
  parseCreditRepaymentDay
} from './creditAssistantLogic';
import type { CreditExtractedItem } from '../../features/assistant/creditAssistant/types';

function buildItem(overrides: Partial<CreditExtractedItem>): CreditExtractedItem {
  return {
    id: 'draft-1',
    title: '招商银行信用卡',
    productType: '信用卡',
    dueAmount: '待补充',
    totalDebt: '¥12860.40',
    repaymentDate: '每月 25 日',
    interest: '18.25%',
    rateType: 'APR',
    rateSource: 'explicit',
    pendingFields: ['当前应还'],
    confidence: 'high',
    ...overrides
  };
}

function summaryLine(item: CreditExtractedItem, label: string): string | undefined {
  const [enriched] = enrichCreditItemsForConfirmation([item], [], [], []);
  return enriched.confirmationSummary?.find((line) => line.startsWith(`${label}：`));
}

describe('creditAssistantLogic rate summary', () => {
  it('prefers the real rate value over the rate type label', () => {
    expect(summaryLine(buildItem({}), 'APR/年化')).toBe('APR/年化：18.25%（APR）');
  });

  it('does not duplicate the rate type when the value already contains it', () => {
    expect(
      summaryLine(buildItem({ interest: '18.25%（APR）', rateType: 'APR' }), 'APR/年化')
    ).toBe('APR/年化：18.25%（APR）');
  });

  it('falls back to the rate type when no numeric rate was recognized', () => {
    expect(summaryLine(buildItem({ interest: undefined, rateType: 'APR' }), 'APR/年化')).toBe(
      'APR/年化：APR'
    );
  });

  it('keeps the numeric rate when the rate type is missing', () => {
    expect(summaryLine(buildItem({ interest: '4.35%', rateType: undefined }), 'APR/年化')).toBe(
      'APR/年化：4.35%'
    );
  });
});

describe('creditAssistantLogic account labels', () => {
  const accounts = [
    { id: 'acc-cmb', name: '招商银行储蓄卡' },
    { id: 'acc-cmb-credit', name: '招商银行信用卡' }
  ];

  it('replaces account ids with their display names', () => {
    expect(
      formatCreditAccountReference(
        'acc-cmb(计划) / acc-cmb-credit(实际)',
        accounts
      )
    ).toBe('招商银行储蓄卡(计划) / 招商银行信用卡(实际)');
  });

  it('keeps unmatched account ids and empty values unchanged', () => {
    expect(formatCreditAccountReference('acc-unknown', accounts)).toBe('acc-unknown');
    expect(formatCreditAccountReference(undefined, accounts)).toBeUndefined();
    expect(formatCreditAccountReference('acc-cmb', [])).toBe('acc-cmb');
  });
});

describe('annualizeCreditInterest', () => {
  it('converts a daily rate to an annual rate', () => {
    expect(annualizeCreditInterest('0.05%', '日利率')).toBe(18.25);
  });

  it('converts a monthly rate to an annual rate', () => {
    expect(annualizeCreditInterest('1.5%', '月利率')).toBe(18);
  });

  it('keeps annual rates and APR unchanged', () => {
    expect(annualizeCreditInterest('4.35%', 'APR')).toBe(4.35);
    expect(annualizeCreditInterest('3.6%', '年利率')).toBe(3.6);
    expect(annualizeCreditInterest('12%')).toBe(12);
  });

  it('parses grouped numbers and returns undefined for missing or invalid input', () => {
    expect(annualizeCreditInterest('1,825', 'APR')).toBe(1825);
    expect(annualizeCreditInterest(undefined, 'APR')).toBeUndefined();
    expect(annualizeCreditInterest('待补充', 'APR')).toBeUndefined();
  });

  it('does not treat a fixed fee as an annual interest rate', () => {
    expect(annualizeCreditInterest('服务费 300 元', 'APR')).toBeUndefined();
    expect(annualizeCreditInterest('¥300', '年利率')).toBeUndefined();
    expect(annualizeCreditInterest('15.2')).toBeUndefined();
  });
});

describe('parseCreditRepaymentDay', () => {
  it('prefers the day digit over the month digit', () => {
    expect(parseCreditRepaymentDay('11月20日')).toBe('20');
    expect(parseCreditRepaymentDay('11月20号还款')).toBe('20');
  });

  it('parses plain day expressions', () => {
    expect(parseCreditRepaymentDay('每月 25 日')).toBe('25');
    expect(parseCreditRepaymentDay('每月25号')).toBe('25');
    expect(parseCreditRepaymentDay('15')).toBe('15');
  });

  it('returns an empty string for missing or out-of-range values', () => {
    expect(parseCreditRepaymentDay(undefined)).toBe('');
    expect(parseCreditRepaymentDay('待补充')).toBe('');
    expect(parseCreditRepaymentDay('40日')).toBe('');
  });
});
