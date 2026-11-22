import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';

/**
 * 分类聚合的「身份」与「显示名」。
 *
 * 两个教训:
 * 1. **身份必须是 id,不能是名字** —— 应用允许同名子分类共存(「餐饮 / 其他」与
 *    「交通 / 其他」),用名字做 Map key 会把两笔不同分类的钱合并,金额与占比都算错。
 * 2. 名字只是显示用:同名的分类要用「父 / 子」区分,否则图上出现两行一模一样的标题。
 */

/** 聚合用的 key。空/缺失的分类统一落到空串(代表未分类)。 */
export function resolveCategoryGroupKey(transaction: Pick<TransactionItem, 'categoryId'>): string {
  return String(transaction.categoryId || '').trim();
}

/** 某一组 key 的显示名。 */
export function resolveCategoryGroupLabel(
  key: string,
  categories: Category[],
  uncategorizedLabel: string
): string {
  const category = categories.find((item) => item.id === key);
  if (!category) {
    return uncategorizedLabel;
  }
  return category.name;
}

/**
 * 把同名分类的显示名补成「父 / 子」,避免图上出现重复标题。
 * 返回 key → 最终显示名。
 */
export function buildCategoryGroupLabels(
  keys: Iterable<string>,
  categories: Category[],
  uncategorizedLabel: string
): Map<string, string> {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const rawLabels = new Map<string, string>();
  const usage = new Map<string, number>();

  for (const key of keys) {
    const label = resolveCategoryGroupLabel(key, categories, uncategorizedLabel);
    rawLabels.set(key, label);
    usage.set(label, (usage.get(label) || 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const [key, label] of rawLabels) {
    if ((usage.get(label) || 0) <= 1) {
      labels.set(key, label);
      continue;
    }
    const parentId = byId.get(key)?.parentId;
    const parentName = parentId ? byId.get(parentId)?.name : undefined;
    labels.set(key, parentName ? `${parentName} / ${label}` : label);
  }
  return labels;
}