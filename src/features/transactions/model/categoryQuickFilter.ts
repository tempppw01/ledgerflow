export const EMPTY_CATEGORY_FILTER_VALUE = '__empty_category__';

/**
 * 分类筛选。传入 descendantCategoryIds 后,筛选一级分类会连带其子分类,
 * 保持「父分类 = 整个分类树」的直觉。
 */
export function matchesCategoryQuickFilter(
  categoryFilter: string,
  categoryId: string,
  descendantCategoryIds: readonly string[] = []
): boolean {
  const normalizedCategoryId = categoryId.trim();

  if (!categoryFilter) {
    return true;
  }

  if (categoryFilter === EMPTY_CATEGORY_FILTER_VALUE) {
    return normalizedCategoryId.length === 0;
  }

  if (normalizedCategoryId === categoryFilter) return true;
  return descendantCategoryIds.some((id) => id.trim() === normalizedCategoryId);
}
