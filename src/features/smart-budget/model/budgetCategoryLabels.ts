import type { TfFallback } from '../../../shared/lib/useTFallback';
import { CORE_BUDGET_CATEGORIES } from './budgetPlan';

type CoreBudgetCategory = (typeof CORE_BUDGET_CATEGORIES)[number];

/**
 * 核心预算分类的展示映射。
 *
 * CORE_BUDGET_CATEGORIES 里的中文串是预算模型内部的语义标识:
 * isCoreBudgetCategory 过滤、分摊排序和多处单测都按字面量直接比较,
 * 因此内部值一个字符都不能动。这里只在渲染层补一层 i18n key,
 * 让这两个内置标签跟随界面语言。
 */
export const CORE_BUDGET_CATEGORY_LABEL_KEYS: Record<CoreBudgetCategory, string> = {
  固定支出: 'smartBudget.coreCategory.fixed',
  '储蓄/投资': 'smartBudget.coreCategory.savings'
};

/** 取核心分类对应的 i18n key;不是核心分类(即用户自己的分类名)时返回 undefined。 */
export function coreBudgetCategoryLabelKey(category: string): string | undefined {
  return (CORE_BUDGET_CATEGORY_LABEL_KEYS as Record<string, string>)[category];
}

/**
 * 渲染预算分类名:核心分类走 i18n(翻译缺失时回落到中文原值),
 * 其余分类名是用户数据,原样输出,不做任何包装。
 */
export function resolveBudgetCategoryLabel(category: string, tf: TfFallback): string {
  const labelKey = coreBudgetCategoryLabelKey(category);
  return labelKey ? tf(labelKey, category) : category;
}
