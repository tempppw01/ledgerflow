import { describe, expect, it } from 'vitest';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import { analyzeFinancialOverview, FINANCIAL_ANALYSIS_RANGE_OPTIONS } from './analysis';

/**
 * 回归:普通交易的 `adjustmentKind` 是 `'normal'`,**不是"没有调整"**。
 *
 * 财务分析里曾写成 `if (tx.adjustmentKind) return false;` —— 真值判断。
 * 而 store 在规范化时会给**每一笔**交易写上 `adjustmentKind: 'normal'`
 * (见 useFinanceStore 的 normalizeAdjustmentKind 兜底),于是这一判断把所有普通交易
 * 都当成"调整行"排除掉了。
 *
 * 后果不是算错一点,而是整块功能失效:
 * - 「过去:复盘支出变化」永远显示 日均支出 ¥0.00 / 最大分类「未分类」/「还没有足够的支出分类样本」
 * - 「行为洞察」永远显示「行为样本不足」,消费习惯、可压缩支出、消费者画像全部退化为占位文案
 *
 * 而同一页的页头总额与「支出变化」用的是另一套判断,所以看起来是正常的 ——
 * 页面一边显示「支出 ¥12,056.62」一边显示「日均支出 ¥0.00」。
 */
const categories: Category[] = [
  { id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 },
  { id: 'cat-shopping', name: '购物日用', kind: 'expense', sortOrder: 2 },
  { id: 'cat-salary', name: '工资', kind: 'income', sortOrder: 3 }
];

/** 模拟 store 规范化后的行:普通交易也带 adjustmentKind: 'normal'。 */
function normalizedRow(overrides: Partial<TransactionItem> & { id: string }): TransactionItem {
  return {
    type: 'expense',
    categoryId: 'cat-food',
    accountId: 'acc-1',
    amount: 100,
    date: new Date().toISOString(),
    note: '',
    tags: [],
    source: 'manual',
    status: 'completed',
    adjustmentKind: 'normal',
    ...overrides
  } as TransactionItem;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function buildInput() {
  const transactions: TransactionItem[] = [
    normalizedRow({ id: 'e1', amount: 120, categoryId: 'cat-food', date: daysAgo(1) }),
    normalizedRow({ id: 'e2', amount: 80, categoryId: 'cat-food', date: daysAgo(2) }),
    normalizedRow({ id: 'e3', amount: 300, categoryId: 'cat-shopping', date: daysAgo(3) }),
    normalizedRow({ id: 'e4', amount: 60, categoryId: 'cat-shopping', date: daysAgo(4) }),
    normalizedRow({
      id: 'i1',
      type: 'income',
      categoryId: 'cat-salary',
      amount: 10000,
      date: daysAgo(5)
    }),
    // 退款行:必须仍然被排除在"支出样本"之外
    normalizedRow({
      id: 'r1',
      amount: 500,
      adjustmentKind: 'refund',
      categoryId: 'cat-food',
      date: daysAgo(3)
    })
  ];

  return {
    range: FINANCIAL_ANALYSIS_RANGE_OPTIONS.find((item) => item.key === '30d')!,
    transactions,
    categories,
    accounts: [
      { id: 'acc-1', name: '现金', type: 'cash' as const, initialBalance: 1000, sortOrder: 1 }
    ],
    subscriptions: [],
    debts: [],
    repaymentRecords: [],
    monthlyIncome: 10000
  };
}

describe('财务分析:普通交易不会被当成调整行排除', () => {
  it('有支出样本时「过去」段应给出日均支出与最大分类', () => {
    const result = analyzeFinancialOverview(buildInput());

    expect(result.transactionCount).toBeGreaterThan(0);
    expect(result.hasEnoughData, '样本被全部排除,导致「行为样本不足」').toBe(true);
    expect(
      result.previous.recentAverageDailyExpense,
      '日均支出为 0:普通支出被 adjustmentKind=normal 排除了'
    ).toBeGreaterThan(0);
    expect(result.previous.topCategoryName).not.toBe('未分类');
    expect(result.previous.categoryRows.length).toBeGreaterThan(0);
  });

  it('退款行仍然不计入支出样本', () => {
    const input = buildInput();
    const withoutRefund = analyzeFinancialOverview({
      ...input,
      transactions: input.transactions.filter((item) => item.id !== 'r1')
    });
    const withRefund = analyzeFinancialOverview(input);

    // 那 500 元退款不该被算成支出(amount 相同则说明它被计入或被忽略前已排除)
    expect(withRefund.previous.recentAverageDailyExpense).toBeCloseTo(
      withoutRefund.previous.recentAverageDailyExpense,
      6
    );
  });

  it('分类 id 能对上时不应显示「未分类」', () => {
    const result = analyzeFinancialOverview(buildInput());
    const names = result.previous.categoryRows.map((row) => row.name);
    expect(names).toContain('购物日用'); // 300 + 60 = 360,最大
    expect(names).toContain('餐饮');
  });
});