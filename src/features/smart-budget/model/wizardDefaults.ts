import type { BudgetAnswers } from './budgetPlanner';
import { DEFAULT_BUDGET_ANSWERS } from './budgetPlanner';

/**
 * 向导的默认答案:月收入优先用**用户已登记**的那个。
 *
 * 向导问的第一个数是「每月到手收入」,而应用早就知道这个数(设置里的登记月收入 ——
 * 还款管理用它算负债率、助手用它做上下文)。直接用写死的默认值(10,000)意味着:
 * 用户明明登记过收入,向导还是从 10,000 开始,一路点下去整份预算(固定/储蓄/灵活的分配、
 * 执行率、健康度)都按 10,000 算。演示账本正是这个状态(方案 10,000,登记 26,000)。
 *
 * 没有登记收入、或者登记值不合法时才退回默认。
 */
export function buildWizardDefaultAnswers(registeredMonthlyIncome?: number): BudgetAnswers {
  const income = Number(registeredMonthlyIncome);
  if (!Number.isFinite(income) || income <= 0) {
    return DEFAULT_BUDGET_ANSWERS;
  }
  return { ...DEFAULT_BUDGET_ANSWERS, monthlyIncome: income };
}