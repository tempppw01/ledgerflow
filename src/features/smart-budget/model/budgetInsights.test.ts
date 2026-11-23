import { describe, expect, it } from 'vitest';
import { buildBudgetTrackingRows, formatMonthKey, getRecentMonthOptions } from './budgetInsights';
import { BudgetRecommendation } from './budgetPlanner';

const recommendation: BudgetRecommendation = {
  monthlyIncome: 10000,
  monthlyFixedExpense: 3000,
  disposableIncome: 7000,
  savingsAmount: 2000,
  flexibleBudget: 5000,
  categoryBudgets: [
    { category: '固定支出', amount: 3000, ratio: 0.3 },
    { category: '储蓄/投资', amount: 2000, ratio: 0.2 },
    { category: '餐饮', amount: 2000, ratio: 0.2 },
    { category: '交通', amount: 1200, ratio: 0.12 },
    { category: '娱乐社交', amount: 1800, ratio: 0.18 }
  ]
};

describe('budgetInsights', () => {
  it('returns recent month options sorted by desc', () => {
    const options = getRecentMonthOptions(
      [
        {
          id: '1',
          type: 'expense',
          categoryId: 'food',
          accountId: 'cash',
          amount: 100,
          date: '2025-01-02',
          note: '',
          tags: []
        }
      ],
      3,
      new Date('2025-02-15')
    );

    expect(options.map((item) => item.key)).toEqual(['2025-02', '2025-01', '2024-12']);
  });

  it('builds tracking rows and marks overspent categories', () => {
    const monthKey = formatMonthKey(new Date('2025-02-08'));
    const rows = buildBudgetTrackingRows({
      recommendation,
      categories: [
        { id: 'food', name: '餐饮' },
        { id: 'traffic', name: '交通' },
        { id: 'fun', name: '娱乐社交' }
      ],
      transactions: [
        {
          id: '1',
          type: 'expense',
          categoryId: 'food',
          accountId: 'cash',
          amount: 2100,
          date: '2025-02-01',
          note: '',
          tags: []
        },
        {
          id: '2',
          type: 'expense',
          categoryId: 'traffic',
          accountId: 'cash',
          amount: 300,
          date: '2025-02-03',
          note: '',
          tags: []
        }
      ],
      monthKey
    });

    expect(rows[0]).toMatchObject({
      category: '餐饮',
      budgetAmount: 2000,
      spentAmount: 2100,
      isOverspent: true
    });
    expect(rows.find((item) => item.category === '娱乐社交')).toMatchObject({
      spentAmount: 0,
      isOverspent: false
    });
  });
  /*
   * 演示账本的真实形状:住房 ¥6,500 是刚性支出,用户另外声明了「固定支出 ¥3,000」。
   * 修复前这 ¥6,500 完全不出现在表里 —— 表里只有灵活分类,合计只算灵活预算,
   * 于是「用掉 15%」被读成「整体很稳」,而实际上总支出已经超过总预算。
   */
  it('把固定支出作为一行合计,金额来自刚性分类的实际支出', () => {
    const monthKey = '2025-02';
    const rows = buildBudgetTrackingRows({
      recommendation,
      categories: [
        { id: 'rent', name: '住房' },
        { id: 'insurance', name: '保险' },
        { id: 'utility', name: '水电燃气' },
        { id: 'food', name: '餐饮' }
      ],
      transactions: [
        { id: 'r1', type: 'expense', categoryId: 'rent', amount: 6500, date: '2025-02-01', ...{"accountId":"cash","note":"","tags":[]} },
        { id: 'i1', type: 'expense', categoryId: 'insurance', amount: 320, date: '2025-02-02', ...{"accountId":"cash","note":"","tags":[]} },
        { id: 'u1', type: 'expense', categoryId: 'utility', amount: 180, date: '2025-02-03', ...{"accountId":"cash","note":"","tags":[]} },
        { id: 'f1', type: 'expense', categoryId: 'food', amount: 500, date: '2025-02-04', ...{"accountId":"cash","note":"","tags":[]} }
      ],
      monthKey
    });

    const fixed = rows.find((row) => row.category === '固定支出');
    expect(fixed).toMatchObject({ budgetAmount: 3000, spentAmount: 7000, isOverspent: true });

    // 刚性分类不再单独成行,避免和合计行重复计数。
    expect(rows.map((row) => row.category)).not.toContain('住房');

    // 合计里必须包含固定支出:总预算 = 固定 + 灵活,总支出 = 刚性 + 灵活。
    const totalBudget = rows.reduce((sum, row) => sum + row.budgetAmount, 0);
    const totalSpent = rows.reduce((sum, row) => sum + row.spentAmount, 0);
    expect(totalBudget).toBe(8000);
    // 关键:总支出里必须含那 ¥7,000 刚性支出 —— 修复前这里是 ¥500(只算灵活分类)。
    expect(totalSpent).toBe(7500);
    const flexibleOnly = rows
      .filter((row) => row.category !== '固定支出')
      .reduce((sum, row) => sum + row.spentAmount, 0);
    expect(flexibleOnly).toBe(500);
  });

  it('没有任何刚性支出分类时不硬塞一行固定支出', () => {
    const rows = buildBudgetTrackingRows({
      recommendation: {
        ...recommendation,
        categoryBudgets: recommendation.categoryBudgets.filter(
          (item) => item.category !== '固定支出'
        )
      },
      categories: [{ id: 'food', name: '餐饮' }],
      transactions: [],
      monthKey: '2025-02'
    });

    expect(rows.map((row) => row.category)).not.toContain('固定支出');
  });
});
