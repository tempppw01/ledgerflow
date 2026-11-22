import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import { analyzeFinancialOverview } from './analysis';

/**
 * 分类聚合不变量:**按分类 id 聚,不按名字聚**。
 *
 * 应用明确支持「同名子分类」(`餐饮 / 其他` 与 `交通 / 其他` 可以共存,见
 * `sanitizeCategoriesAndTransactions` 的 key 规则),但分析里的分类聚合此前以**名字**为 key,
 * 于是两个不同的「其他」被合并成一行,金额与占比都算错。
 */
const categories: Category[] = [
  { id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 },
  { id: 'cat-food-other', name: '其他', kind: 'expense', parentId: 'cat-food', sortOrder: 2 },
  { id: 'cat-transport', name: '交通', kind: 'expense', sortOrder: 3 },
  { id: 'cat-transport-other', name: '其他', kind: 'expense', parentId: 'cat-transport', sortOrder: 4 }
];

const accounts: Account[] = [
  { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 10000, balance: 10000, sortOrder: 1 }
];

function tx(id: string, categoryId: string, amount: number, day: number): TransactionItem {
  return {
    id,
    type: 'expense',
    categoryId,
    accountId: 'acc-cash',
    amount,
    date: `2026-04-${String(day).padStart(2, '0')}`,
    note: `记录 ${id}`,
    tags: []
  };
}

function run(transactions: TransactionItem[]) {
  return analyzeFinancialOverview({
    range: { key: '30d', label: '近 30 天', days: 30 },
    transactions,
    categories,
    accounts,
    subscriptions: [],
    debts: [],
    repaymentRecords: [],
    monthlyIncome: 8000
  });
}

describe('analyzeFinancialOverview 分类聚合', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T08:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('两个同名子分类不会被合并成一行', () => {
    const result = run([
      tx('t1', 'cat-food-other', 100, 10),
      tx('t2', 'cat-transport-other', 300, 11),
      tx('t3', 'cat-food', 60, 12)
    ]);

    const rows = result.previous.categoryRows ?? [];
    const named = rows.filter((row) => row.name.includes('其他'));

    expect(
      named.length,
      `同名子分类被合并了:${JSON.stringify(rows.map((row) => ({ name: row.name, amount: row.amount })))}`
    ).toBe(2);
    expect(named.map((row) => row.amount).sort((a, b) => a - b)).toEqual([100, 300]);
  });

  it('不同名分类仍然各自一行,金额与总额一致', () => {
    const result = run([tx('t1', 'cat-food', 100, 10), tx('t2', 'cat-transport', 300, 11)]);

    const rows = result.previous.categoryRows ?? [];
    expect(rows.map((row) => row.name).sort()).toEqual(['交通', '餐饮']);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(400);
  });
});