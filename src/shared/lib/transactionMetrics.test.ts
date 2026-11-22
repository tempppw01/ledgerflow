import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import {
  filterCountableTransactions,
  getSignedAmount,
  getTransactionDirection,
  isCountableTransaction,
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

/**
 * `summarizeTransactions` 不做状态过滤,所以「与账户余额同口径」的聚合必须显式筛一遍。
 * 这组测试同时说明:不筛会发生什么(下面第一条)、筛了之后是什么(第二条)。
 */
describe('filterCountableTransactions', () => {
  const mixed = [
    transaction({ id: 'active', amount: 100 }),
    transaction({ id: 'pending', amount: 200, status: 'pending' }),
    transaction({ id: 'closed', amount: 400, status: 'closed' }),
    transaction({ id: 'failed', amount: 800, status: 'failed' }),
    transaction({ id: 'trashed', amount: 1600, trashedAt: '2026-04-11T00:00:00.000Z' })
  ];

  it('不做过滤时,待支付/已关闭/失败/已删除都会被算进合计(这正是要避免的)', () => {
    // 账户余额那边一直排除这些行,所以这里不筛就会和余额对不上。
    expect(summarizeTransactions(mixed).expenseTotal).toBe(3100);
  });

  it('过滤后只剩真正影响余额的行', () => {
    const countable = filterCountableTransactions(mixed);
    expect(countable.map((row) => row.id)).toEqual(['active']);
    expect(summarizeTransactions(countable).expenseTotal).toBe(100);
  });

  it('逐行判定:未删除且状态影响余额', () => {
    expect(isCountableTransaction(transaction({ id: 'ok' }))).toBe(true);
    expect(isCountableTransaction(transaction({ id: 'no-status', status: undefined }))).toBe(true);
    expect(isCountableTransaction(transaction({ id: 'pending', status: 'pending' }))).toBe(false);
    expect(isCountableTransaction(transaction({ id: 'closed', status: 'closed' }))).toBe(false);
    expect(isCountableTransaction(transaction({ id: 'failed', status: 'failed' }))).toBe(false);
    expect(
      isCountableTransaction(transaction({ id: 'trashed', trashedAt: '2026-04-11T00:00:00.000Z' }))
    ).toBe(false);
  });

  it('过滤结果与账户余额用的判据一致(同一份数据两处口径相同)', () => {
    // computeAccountBalances 里的判据就是 trashedAt + status,这里保持一致
    const countable = filterCountableTransactions(mixed);
    const balanceStyle = mixed.filter(
      (row) => !row.trashedAt && row.status !== 'pending' && row.status !== 'closed' && row.status !== 'failed'
    );
    expect(countable.map((row) => row.id)).toEqual(balanceStyle.map((row) => row.id));
  });
});
