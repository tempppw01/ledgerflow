import { beforeEach, describe, expect, it } from 'vitest';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import { useAppPreferences } from './useAppPreferences';

const debt = (overrides: Partial<DebtItem>): DebtItem => ({
  id: 'd1',
  name: '招商银行信用卡',
  type: 'credit-card',
  balance: 11360.4,
  repaymentDay: 25,
  customMinPayment: 1286.04,
  totalPeriods: 24,
  paidPeriods: 1,
  remainingMonths: 23,
  ...overrides
});

const record = (overrides: Partial<RepaymentRecord>): RepaymentRecord => ({
  id: 'r1',
  debtId: 'd1',
  amount: 1500,
  paidAt: '2026-11-21',
  recordMode: 'manual',
  createdAt: '2026-11-21T00:00:00.000Z',
  ...overrides
});

function seed(debts: DebtItem[], repaymentRecords: RepaymentRecord[]) {
  useAppPreferences.setState({ debts, repaymentRecords });
}

describe('useAppPreferences removeRepaymentRecord reverses the debt mutation', () => {
  beforeEach(() => {
    localStorage.removeItem('ledgerflow-preferences');
    seed([], []);
  });

  it('restores the principal and period counters consumed when recording', () => {
    // State as it looks right after recording a 1500 payment against 12860.40.
    seed([debt({})], [record({})]);

    useAppPreferences.getState().removeRepaymentRecord('r1');

    const next = useAppPreferences.getState();
    expect(next.repaymentRecords).toHaveLength(0);
    const target = next.debts[0];
    expect(target.balance).toBe(12860.4);
    expect(target.paidPeriods).toBe(0);
    expect(target.remainingMonths).toBe(24);
  });

  it('restores only the principal when the payment never advanced a period', () => {
    // 100 is below 98% of the 1000 minimum, so recording did not advance a period.
    seed(
      [debt({ balance: 900, customMinPayment: 1000, paidPeriods: 5, remainingMonths: 7 })],
      [record({ amount: 100 })]
    );

    useAppPreferences.getState().removeRepaymentRecord('r1');

    const target = useAppPreferences.getState().debts[0];
    expect(target.balance).toBe(1000);
    expect(target.paidPeriods).toBe(5);
    expect(target.remainingMonths).toBe(7);
  });

  it('leaves unrelated debts untouched', () => {
    seed(
      [debt({}), debt({ id: 'd2', name: '消费分期贷', balance: 42000 })],
      [record({})]
    );

    useAppPreferences.getState().removeRepaymentRecord('r1');

    const other = useAppPreferences.getState().debts[1];
    expect(other.balance).toBe(42000);
    expect(other.paidPeriods).toBe(1);
    expect(other.remainingMonths).toBe(23);
  });

  it('is a no-op for an unknown record id', () => {
    seed([debt({})], []);

    useAppPreferences.getState().removeRepaymentRecord('missing');

    const next = useAppPreferences.getState();
    expect(next.repaymentRecords).toHaveLength(0);
    expect(next.debts[0].balance).toBe(11360.4);
  });

  it('restores a fully-paid debt exactly from the recorded snapshot', () => {
    // Recorded 1500 against a 500 balance: recording clamped the balance to 0 and
    // discarded the 1000 surplus, so "balance + amount" would wrongly restore 1500.
    seed(
      [debt({ balance: 0, paidPeriods: 1, remainingMonths: 23 })],
      [
        record({
          amount: 1500,
          balanceBefore: 500,
          paidPeriodsBefore: 0,
          remainingMonthsBefore: 24
        })
      ]
    );

    useAppPreferences.getState().removeRepaymentRecord('r1');

    const target = useAppPreferences.getState().debts[0];
    expect(target.balance).toBe(500);
    expect(target.paidPeriods).toBe(0);
    expect(target.remainingMonths).toBe(24);
  });
});

describe('useAppPreferences removeDebt drops the debt repayment history', () => {
  beforeEach(() => {
    localStorage.removeItem('ledgerflow-preferences');
    seed([], []);
  });

  it('removes only the deleted debt records and keeps the other debt history', () => {
    seed(
      [debt({}), debt({ id: 'd2', name: '消费分期贷' })],
      [record({}), record({ id: 'r2', debtId: 'd2', amount: 400 })]
    );

    useAppPreferences.getState().removeDebt('d1');

    const next = useAppPreferences.getState();
    expect(next.debts.map((item) => item.id)).toEqual(['d2']);
    expect(next.repaymentRecords.map((item) => item.id)).toEqual(['r2']);
  });
});
