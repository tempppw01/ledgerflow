import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET_ANSWERS } from './budgetPlanner';
import { buildWizardDefaultAnswers } from './wizardDefaults';

/**
 * 向导问的第一个数是「每月到手收入」,而应用早就知道这个数(设置里的登记月收入,
 * 还款管理用它算负债率、助手用它做上下文)。原先向导固定从写死的 10,000 开始,
 * 于是用户明明登记过收入,整份预算(固定/储蓄/灵活的分配、执行率、健康度)还是按
 * 10,000 算 —— 演示账本正是这个状态(方案 10,000,登记 26,000)。
 */
describe('预算向导的默认月收入', () => {
  it('有登记月收入时用它,而不是写死的默认值', () => {
    const answers = buildWizardDefaultAnswers(26000);
    expect(answers.monthlyIncome).toBe(26000);
    expect(answers.monthlyIncome).not.toBe(DEFAULT_BUDGET_ANSWERS.monthlyIncome);
  });

  it('其余字段仍取默认(这次只修收入那一项)', () => {
    const answers = buildWizardDefaultAnswers(26000);
    expect(answers.identity).toBe(DEFAULT_BUDGET_ANSWERS.identity);
    expect(answers.monthlyFixedExpense).toBe(DEFAULT_BUDGET_ANSWERS.monthlyFixedExpense);
    expect(answers.savingsRatio).toBe(DEFAULT_BUDGET_ANSWERS.savingsRatio);
  });

  it('没有登记收入(0 / undefined / NaN)时退回默认', () => {
    expect(buildWizardDefaultAnswers(0).monthlyIncome).toBe(DEFAULT_BUDGET_ANSWERS.monthlyIncome);
    expect(buildWizardDefaultAnswers(undefined).monthlyIncome).toBe(
      DEFAULT_BUDGET_ANSWERS.monthlyIncome
    );
    expect(buildWizardDefaultAnswers(Number.NaN).monthlyIncome).toBe(
      DEFAULT_BUDGET_ANSWERS.monthlyIncome
    );
    expect(buildWizardDefaultAnswers(-500).monthlyIncome).toBe(
      DEFAULT_BUDGET_ANSWERS.monthlyIncome
    );
  });

  it('不修改默认答案对象本身(避免把常量改脏)', () => {
    const before = DEFAULT_BUDGET_ANSWERS.monthlyIncome;
    buildWizardDefaultAnswers(26000);
    expect(DEFAULT_BUDGET_ANSWERS.monthlyIncome).toBe(before);
  });
});