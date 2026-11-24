import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../../entities/transaction/types';
import { calculateWeeklyExpenseTrend } from './weeklyExpenseTrend';

/**
 * 「近 7 天 vs 上周」必须按**日期**分桶。
 *
 * 原先助手页里是用行号切的:weeklyRows.filter(expense).slice(0,7) 当本周、
 * slice(7,14) 当上周,而 weeklyRows 来自 store 的原始顺序(没按日期排)——
 * 于是「本周」其实是「列表里前 7 笔」。下面的乱序 + 稀疏用例就是照这个错写的。
 */
const NOW = new Date(2026, 10, 24, 12, 0, 0); // 2026-11-24 本地

function row(daysAgo: number, amount: number, overrides: Partial<TransactionItem> = {}): TransactionItem {
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, 12, 0, 0);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
  return {
    id: `tx-${daysAgo}-${amount}`,
    type: 'expense',
    categoryId: 'cat-food',
    accountId: 'acc-1',
    amount,
    date: iso,
    note: '',
    tags: [],
    ...overrides
  } as TransactionItem;
}

describe('近两周支出对比', () => {
  it('按日期分桶,不按行号切:本周 2 笔、上周 5 笔也要算对', () => {
    // 故意把上周的行放在数组**前面**,本周的放后面 —— 行号切法在这里会算反
    const transactions = [
      row(8, 10),
      row(9, 10),
      row(10, 10),
      row(11, 10),
      row(12, 10),
      row(2, 100),
      row(3, 100)
    ];

    const trend = calculateWeeklyExpenseTrend({ transactions, now: NOW });
    expect(trend.thisWeekExpense).toBe(200);
    expect(trend.lastWeekExpense).toBe(50);
    expect(trend.thisWeekCount).toBe(2);
    expect(trend.lastWeekCount).toBe(5);
    // 200 vs 50 → +300%
    expect(Math.round(trend.deltaPct ?? NaN)).toBe(300);
  });

  it('两周以前的记录不参与', () => {
    const trend = calculateWeeklyExpenseTrend({
      transactions: [row(2, 50), row(20, 999), row(40, 999)],
      now: NOW
    });
    expect(trend.thisWeekExpense).toBe(50);
    expect(trend.lastWeekExpense).toBe(0);
    expect(trend.deltaPct).toBeNull();
  });

  it('退款抵减本周支出', () => {
    const trend = calculateWeeklyExpenseTrend({
      transactions: [
        row(2, 100),
        row(1, 40, { adjustmentKind: 'refund', refundOfTransactionId: 'x' } as never)
      ],
      now: NOW
    });
    expect(trend.thisWeekExpense).toBe(60);
  });

  it('不计入余额的状态不算支出', () => {
    const trend = calculateWeeklyExpenseTrend({
      transactions: [row(2, 100), row(2, 300, { status: 'pending' } as never)],
      now: NOW
    });
    expect(trend.thisWeekExpense).toBe(100);
  });

  it('上周为 0 时没有可比基线,返回 null 而不是 0 或无穷', () => {
    const trend = calculateWeeklyExpenseTrend({ transactions: [row(3, 80)], now: NOW });
    expect(trend.lastWeekExpense).toBe(0);
    expect(trend.deltaPct).toBeNull();
  });
});