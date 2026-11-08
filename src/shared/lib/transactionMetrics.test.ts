import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import {
  getSignedAmount,
  getTransactionDirection,
  summarizeTransactions
} from './transactionMetrics';

function transaction(overrides: Partial<TransactionItem>): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    amount: 100,
    date: '2026-04-10',
    note: '测试交易',
    tags: [],
    ...overrides
  };
}

describe('transactionMetrics', () => {
  it('turns refunds in the opposite direction of their original transaction', () => {
    const expenseRefund = transaction({
      type: 'expense',
      adjustmentKind: 'refund'
    });
    const incomeRefund = transaction({
      type: 'income',
      adjustmentKind: 'refund'
    });

    expect(getTransactionDirection(expenseRefund)).toBe('inflow');
    expect(getSignedAmount(expenseRefund)).toBe(100);
    expect(getTransactionDirection(incomeRefund)).toBe('outflow');
    expect(getSignedAmount(incomeRefund)).toBe(-100);
  });

  it('nets both expense refunds and income reversals without crossing categories', () => {
    const rows = [
      transaction({ id: 'income', type: 'income', amount: 1000 }),
      transaction({ id: 'expense', type: 'expense', amount: 100 }),
      transaction({
        id: 'expense-refund',
        type: 'expense',
        amount: 20,
        adjustmentKind: 'refund',
        refundOfTransactionId: 'expense'
      }),
      transaction({
        id: 'income-refund',
        type: 'income',
        amount: 200,
        adjustmentKind: 'refund',
        refundOfTransactionId: 'income'
      })
    ];

    expect(summarizeTransactions(rows)).toEqual({
      incomeTotal: 1000,
      incomeReversalTotal: 200,
      expenseTotal: 80,
      refundTotal: 220,
      netTotal: 720,
      overallTotal: 1320
    });
  });

  it('keeps the extra refund inflow when a refund exceeds the current-period expense', () => {
    const rows = [
      transaction({ id: 'income', type: 'income', amount: 1000 }),
      transaction({ id: 'expense', type: 'expense', amount: 100 }),
      transaction({
        id: 'expense-refund',
        type: 'expense',
        amount: 150,
        adjustmentKind: 'refund',
        refundOfTransactionId: 'expense'
      })
    ];

    const summary = summarizeTransactions(rows);
    expect(summary.expenseTotal).toBe(0);
    expect(summary.netTotal).toBe(1050);
    expect(summary.netTotal).toBe(rows.reduce((sum, row) => sum + getSignedAmount(row), 0));
  });
});
