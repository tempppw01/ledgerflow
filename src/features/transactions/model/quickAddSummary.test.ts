import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../../entities/transaction/types';
import { getDailyFlexibleBudget, getQuickAddDailySpending } from './quickAddSummary';

const row = (overrides: Partial<TransactionItem>): TransactionItem => ({
  id: 'tx',
  type: 'expense',
  categoryId: 'food',
  accountId: 'cash',
  amount: 10,
  date: '2026-08-02',
  note: '',
  tags: [],
  ...overrides
});

describe('quick add budget summary', () => {
  it('uses net completed spending for the selected date and includes the draft expense', () => {
    const result = getQuickAddDailySpending({
      date: '2026-08-02',
      proposedExpense: 8.5,
      transactions: [
        row({ id: 'spent', amount: 20 }),
        row({ id: 'refund', amount: 5, adjustmentKind: 'refund' }),
        row({ id: 'pending', amount: 30, status: 'pending' }),
        row({ id: 'other-day', amount: 40, date: '2026-08-01' }),
        row({ id: 'income', amount: 90, type: 'income' })
      ]
    });

    expect(result).toEqual({ spent: 15, projected: 23.5 });
  });

  it('derives a calendar-day reference from the confirmed flexible budget', () => {
    expect(getDailyFlexibleBudget(2800, '2024-02-10')).toBe(96.55);
    expect(getDailyFlexibleBudget(null, '2026-08-02')).toBeNull();
  });
});
