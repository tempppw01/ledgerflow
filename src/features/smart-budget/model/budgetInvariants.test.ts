import { describe, expect, it } from 'vitest';
import { generateBudgetRecommendation, type UserIdentity } from './budgetPlanner';
import { syncRecommendationWithExpenseCategories } from './budgetPlan';

/**
 * 预算生成的不变量扫描。
 *
 * 原来的预算测试是「一个输入 → 一个断言」,例如只断言 income=12000 时分类合计
 * 等于收入。那种写法通过,不代表不变量成立 —— 换个输入就破了。这里改成:把必须
 * 无条件成立的性质写下来,然后用大量输入去扫。
 *
 * 这组扫描真的抓到过三个问题(修好后才有本文件):
 *  1. 小额收入下出现负的分类额度(roundToTen 各份进位之和超过灵活预算,负数被
 *     整笔压在第一个分类上)
 *  2. 储蓄额被四舍五入顶到超过可支配收入,把 flexibleBudget 变成负数
 *  3. 分摊残差修正用 Math.max(0, …) 丢掉差额,分类合计超过月收入
 *
 * 输入规模刻意收敛到一千多组,保证它跑得够快、能常驻测试套件;要更大范围的
 * 一次性排查再写临时脚本。
 */
describe('预算生成不变量', () => {
  const identities: UserIdentity[] = ['student', 'employee', 'freelancer', 'other'];
  const ratios = [0.1, 0.3, 0.6];
  const incomes = [100, 137, 248, 1000, 2509, 2619, 2620, 3000, 8000, 12000, 30000];

  function fixedExpensesFor(income: number): number[] {
    return [0, 1, 12, 99, 500, 1000, 2500, Math.floor(income * 0.5), Math.floor(income * 0.8)].filter(
      (fixed) => fixed < income
    );
  }

  it('分类额度非负、合计等于月收入、储蓄不超过可支配收入', () => {
    const problems: string[] = [];
    let checked = 0;

    for (const identity of identities) {
      for (const savingsRatio of ratios) {
        for (const income of incomes) {
          for (const fixed of fixedExpensesFor(income)) {
            let result;
            try {
              result = generateBudgetRecommendation({
                identity,
                monthlyIncome: income,
                monthlyFixedExpense: fixed,
                savingsRatio
              });
            } catch {
              continue;
            }
            checked += 1;
            const tag = `${identity} 收入${income} 固定${fixed} 比例${savingsRatio}`;

            const total = result.categoryBudgets.reduce((sum, item) => sum + item.amount, 0);
            if (total !== result.monthlyIncome) {
              problems.push(`${tag}: 分类合计 ${total} ≠ 月收入 ${result.monthlyIncome}`);
            }

            const negative = result.categoryBudgets.filter((item) => item.amount < 0);
            if (negative.length > 0) {
              problems.push(
                `${tag}: 出现负额度 ${negative.map((item) => `${item.category}=${item.amount}`).join(',')}`
              );
            }

            if (result.savingsAmount > result.disposableIncome) {
              problems.push(
                `${tag}: 储蓄 ${result.savingsAmount} > 可支配 ${result.disposableIncome}`
              );
            }

            if (result.flexibleBudget < 0) {
              problems.push(`${tag}: 灵活预算为负 ${result.flexibleBudget}`);
            }
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(500);
    expect(problems).toEqual([]);
  });

  it('同步到账本分类后合计仍然等于月收入', () => {
    const ledgerSets: Array<Array<{ name: string }>> = [
      [{ name: '餐饮' }, { name: '交通' }],
      [{ name: '餐饮外卖' }, { name: '通勤打车' }, { name: '水电燃气' }, { name: '健身' }],
      // 多个分类命中同一身份分类:权重会被命中数除小,容易踩到残差修正的边界
      ['餐饮', '早餐', '午餐', '晚餐', '咖啡', '奶茶', '零食', '水果', '买菜'].map((name) => ({
        name
      })),
      ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name }))
    ];

    const problems: string[] = [];
    let checked = 0;

    for (const identity of identities) {
      for (const categories of ledgerSets) {
        for (const income of [1200, 2509, 3000, 12000]) {
          for (const fixed of [0, 500].filter((value) => value < income)) {
            for (const savingsRatio of [0.1, 0.3, 0.6]) {
              let recommendation;
              try {
                recommendation = generateBudgetRecommendation({
                  identity,
                  monthlyIncome: income,
                  monthlyFixedExpense: fixed,
                  savingsRatio
                });
              } catch {
                continue;
              }
              const synced = syncRecommendationWithExpenseCategories(recommendation, categories);
              checked += 1;
              const total = synced.categoryBudgets.reduce((sum, item) => sum + item.amount, 0);
              if (total !== synced.monthlyIncome) {
                problems.push(
                  `${identity} 收入${income} 分类数${categories.length}: 合计 ${total} ≠ ${synced.monthlyIncome}`
                );
              }
              if (synced.categoryBudgets.some((item) => item.amount < 0)) {
                problems.push(`${identity} 收入${income} 分类数${categories.length}: 出现负额度`);
              }
            }
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });
});
