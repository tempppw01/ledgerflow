import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../../entities/transaction/types';
import { calculateMonthlyCashflow } from './monthlyCashflow';

/**
 * 「本月可投资现金」原先有**两份实现**,而且两处都错、错法还不一样:
 *
 *   · 投资理财页:按月取(对),但没排除退款 —— 退款被当成又花一笔;
 *   · 投资助手聊天面板:用**全部历史交易**减月收入 —— 任何用满一个月的账本都算出 0。
 *
 * 这两条用例就是照着那两处错写的。
 */
function row(overrides: Partial<TransactionItem> & { date: string }): TransactionItem {
  return {
    id: overrides.id || 'tx',
    type: 'expense',
    categoryId: 'cat-food',
    accountId: 'acc-1',
    amount: 10,
    note: '',
    tags: [],
    ...overrides
  } as TransactionItem;
}

const NOW = new Date(2026, 10, 24, 12, 0, 0); // 2026-11-24 本地时间

describe('本月可投资现金', () => {
  it('退款抵减支出,不会被当成又花一笔', () => {
    const result = calculateMonthlyCashflow({
      now: NOW,
      monthlyIncome: 26000,
      transactions: [
        row({ id: 'spend', amount: 1000, date: '2026-11-03' }),
        row({
          id: 'refund',
          amount: 400,
          date: '2026-11-05',
          adjustmentKind: 'refund',
          refundOfTransactionId: 'spend'
        })
      ]
    });

    // 1000 − 400 = 600;若把退款当支出,这里会是 1400
    expect(result.expenseTotal).toBe(600);
    expect(result.investableCash).toBe(25400);
    expect(result.expenseTotal).not.toBe(1400);
  });

  it('只算本月:上个月的花销不该把可投资现金压成 0', () => {
    const result = calculateMonthlyCashflow({
      now: NOW,
      monthlyIncome: 26000,
      transactions: [
        row({ id: 'this-month', amount: 1000, date: '2026-11-03' }),
        row({ id: 'last-month', amount: 50000, date: '2026-10-15' }),
        row({ id: 'two-months-ago', amount: 80000, date: '2026-09-20' })
      ]
    });

    // 用全部历史去减月收入的话,这里会是 0 —— 原来聊天面板就是这个行为
    expect(result.expenseTotal).toBe(1000);
    expect(result.investableCash).toBe(25000);
    expect(result.investableCash).not.toBe(0);
  });

  it('不计入余额的状态(待处理/已关闭/失败)不算支出', () => {
    const result = calculateMonthlyCashflow({
      now: NOW,
      monthlyIncome: 1000,
      transactions: [
        row({ id: 'done', amount: 100, date: '2026-11-03' }),
        row({ id: 'pending', amount: 200, date: '2026-11-04', status: 'pending' }),
        row({ id: 'closed', amount: 300, date: '2026-11-05', status: 'closed' }),
        row({ id: 'failed', amount: 400, date: '2026-11-06', status: 'failed' })
      ]
    });

    expect(result.expenseTotal).toBe(100);
    expect(result.investableCash).toBe(900);
  });

  it('没有登记月收入时回落到本月净额,且不为负', () => {
    const result = calculateMonthlyCashflow({
      now: NOW,
      transactions: [
        row({ id: 'in', type: 'income', amount: 500, date: '2026-11-02' }),
        row({ id: 'out', amount: 300, date: '2026-11-03' })
      ]
    });

    expect(result.netTotal).toBe(200);
    expect(result.investableCash).toBe(200);
  });
});