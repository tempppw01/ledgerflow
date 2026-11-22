import type { Category } from '../../entities/category/types';

/**
 * 分类显示名的唯一实现。
 *
 * 背景:应用允许同名子分类共存(「餐饮 / 其他」与「交通 / 其他」)。凡是**拿名字当身份**
 * 的地方都会出错:聚合会合并、按名字查找会随机命中、把名字列表交给 AI 让它选也会歧义。
 * 所以显示名在这里统一算:同名的一律加「父 / 子」前缀,唯一名的保持原名。
 */

/** id → 显示名。同名分类用「父 / 子」区分;父分类缺失时退化为原名。 */
export function buildCategoryLabels(
  categories: Category[],
  uncategorizedLabel: string
): Map<string, string> {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const usage = new Map<string, number>();
  for (const item of categories) {
    usage.set(item.name, (usage.get(item.name) || 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const item of categories) {
    const duplicated = (usage.get(item.name) || 0) > 1;
    const parentName = item.parentId ? byId.get(item.parentId)?.name : undefined;
    labels.set(
      item.id,
      duplicated && parentName ? `${parentName} / ${item.name}` : item.name || uncategorizedLabel
    );
  }
  return labels;
}

/**
 * 给「按名字选分类」这类流程用的索引:展示用的名字列表 + 名字 → id 映射。
 *
 * **只有能唯一确定的名字才进映射** —— 同名的(且加前缀后仍然重名的)不进,
 * 这样调用方拿到的名字不会指向一个随机分类。
 */
export function buildCategoryLabelIndex(
  categories: Category[],
  uncategorizedLabel: string
): { labels: string[]; labelToId: Map<string, string> } {
  const labelsById = buildCategoryLabels(categories, uncategorizedLabel);
  const idsByLabel = new Map<string, string[]>();
  for (const [id, label] of labelsById) {
    if (!idsByLabel.has(label)) idsByLabel.set(label, []);
    (idsByLabel.get(label) as string[]).push(id);
  }

  const labelToId = new Map<string, string>();
  for (const [label, ids] of idsByLabel) {
    if (ids.length === 1) labelToId.set(label, ids[0]);
  }

  return { labels: [...idsByLabel.keys()], labelToId };
}