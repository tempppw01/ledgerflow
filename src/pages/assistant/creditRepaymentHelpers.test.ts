import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import {
  buildCreditRepaymentGapSummary,
  buildCreditRepaymentLookupSummary,
  resolveCreditRepaymentDueDisplay,
  type CreditRepaymentSummaryItem
} from './creditRepaymentHelpers';

const ITEM: CreditRepaymentSummaryItem = {
  title: '招商银行信用卡',
  productType: 'credit-card',
  dueAmount: '¥1000',
  repaymentDate: '每月25日'
};

function buildDebt(overrides: Partial<DebtItem> = {}): DebtItem {
  return {
    id: 'debt-1',
    name: '招商银行信用卡',
    type: 'credit-card',
    balance: 12000,
    repaymentDay: 25,
    customMinPayment: 1000,
    ...overrides
  };
}

function buildRecord(overrides: Partial<RepaymentRecord> = {}): RepaymentRecord {
  return {
    id: 'record-1',
    debtId: 'debt-1',
    amount: 1000,
    paidAt: '2026-11-05',
    recordMode: 'manual',
    createdAt: '2026-11-05T00:00:00.000Z',
    ...overrides
  };
}

describe('creditRepaymentHelpers cycle scoping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts only payments inside the current repayment cycle', () => {
    const gap = buildCreditRepaymentGapSummary(
      ITEM,
      [buildDebt()],
      [
        buildRecord({ id: 'current', amount: 1000, paidAt: '2026-11-05' }),
        buildRecord({ id: 'last-cycle', amount: 900, paidAt: '2026-10-10' }),
        buildRecord({ id: 'old', amount: 800, paidAt: '2026-08-01' })
      ]
    );

    expect(gap?.recentActualPaidAmount).toBe('¥1000');
    expect(gap?.statusText).toBe('基本对齐');
    expect(gap?.gapAmount).toBe('0');
  });

  it('does not treat an old settled payment as this cycle being paid', () => {
    const gap = buildCreditRepaymentGapSummary(
      ITEM,
      [buildDebt()],
      [buildRecord({ id: 'old', amount: 1000, paidAt: '2026-08-20' })]
    );

    expect(gap?.recentActualPaidAmount).toBeUndefined();
    expect(gap?.statusText).toBe('本期未还');
    expect(gap?.gapAmount).toBe('¥1000');
  });

  it('keeps the just-passed cycle visible during the grace window', () => {
    vi.setSystemTime(new Date('2026-11-27T12:00:00'));

    const gap = buildCreditRepaymentGapSummary(
      ITEM,
      [buildDebt()],
      [buildRecord({ id: 'paid-before-due', amount: 1000, paidAt: '2026-11-20' })]
    );

    expect(gap?.recentActualPaidAmount).toBe('¥1000');
    expect(gap?.statusText).toBe('基本对齐');
  });

  it('rolls to the next cycle after the grace window', () => {
    vi.setSystemTime(new Date('2026-12-10T12:00:00'));

    const gap = buildCreditRepaymentGapSummary(
      ITEM,
      [buildDebt()],
      [buildRecord({ id: 'paid-before-due', amount: 1000, paidAt: '2026-11-20' })]
    );

    expect(gap?.recentActualPaidAmount).toBeUndefined();
    expect(gap?.statusText).toBe('本期未还');
  });

  it('reports pending instead of aligned when the planned amount is unknown', () => {
    const gap = buildCreditRepaymentGapSummary(
      { ...ITEM, dueAmount: '待补充' },
      [buildDebt({ customMinPayment: 0 })],
      [buildRecord({ id: 'paid', amount: 1000, paidAt: '2026-11-05' })]
    );

    expect(gap?.statusText).toBe('待确认');
    expect(gap?.plannedDueAmount).toBeUndefined();
    expect(gap?.explanationItems?.join(' / ')).toContain('暂时不能判断是否对齐');
  });

  it('flags a real shortfall as partially paid', () => {
    const gap = buildCreditRepaymentGapSummary(
      ITEM,
      [buildDebt()],
      [buildRecord({ id: 'partial', amount: 400, paidAt: '2026-11-05' })]
    );

    expect(gap?.statusText).toBe('部分已还');
    expect(gap?.gapAmount).toBe('¥600');
  });

  it('flags a mismatched payment account within the cycle', () => {
    const gap = buildCreditRepaymentGapSummary(
      ITEM,
      [buildDebt({ paymentAccount: '招商银行储蓄卡' })],
      [
        buildRecord({
          id: 'mismatch',
          amount: 1000,
          paidAt: '2026-11-05',
          paymentAccount: '工商银行储蓄卡'
        })
      ]
    );

    expect(gap?.statusText).toBe('账户不一致');
  });

  it('exposes the matched debt and cycle payment in the lookup summary', () => {
    const lookup = buildCreditRepaymentLookupSummary(
      ITEM,
      [buildDebt()],
      [buildRecord({ id: 'current', amount: 1000, paidAt: '2026-11-05' })]
    );

    expect(lookup?.matchedDebtName).toBe('招商银行信用卡');
    expect(lookup?.actualRepaymentText).toBe('¥1000 · 2026-11-05');
    expect(lookup?.recordStatusText).toBe('基本对齐');
  });

  it('moves a fully paid upcoming due reminder to the next cycle', () => {
    const due = resolveCreditRepaymentDueDisplay(
      { debtId: 'debt-1', repaymentDay: 25, minimumPayment: 1000 },
      [buildRecord({ id: 'paid-early', amount: 1000, paidAt: '2026-11-05' })]
    );

    expect(due?.isPaid).toBe(true);
    expect(due?.dueDate.getFullYear()).toBe(2026);
    expect(due?.dueDate.getMonth()).toBe(11);
    expect(due?.dueDate.getDate()).toBe(25);
    expect(due?.gapAmount).toBe(0);
  });

  it('keeps the current due date and marks it overdue when unpaid', () => {
    vi.setSystemTime(new Date('2026-11-09T12:00:00'));
    const due = resolveCreditRepaymentDueDisplay(
      { debtId: 'debt-1', repaymentDay: 5, minimumPayment: 1000 },
      []
    );

    expect(due?.isPaid).toBe(false);
    expect(due?.isOverdue).toBe(true);
    expect(due?.daysUntil).toBe(-4);
    expect(due?.gapAmount).toBe(1000);
  });
});
