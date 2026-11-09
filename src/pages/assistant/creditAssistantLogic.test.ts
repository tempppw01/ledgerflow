import { describe, expect, it } from 'vitest';
import { enrichCreditItemsForConfirmation } from './creditAssistantLogic';
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
