import { describe, expect, it } from 'vitest';
import type { Category } from '../../entities/category/types';
import { buildCategoryLabels, buildCategoryLabelIndex } from './categoryLabels';

const categories: Category[] = [
  { id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 },
  { id: 'cat-food-other', name: '其他', kind: 'expense', parentId: 'cat-food', sortOrder: 2 },
  { id: 'cat-transport', name: '交通', kind: 'expense', sortOrder: 3 },
  { id: 'cat-transport-other', name: '其他', kind: 'expense', parentId: 'cat-transport', sortOrder: 4 },
  { id: 'cat-salary', name: '工资', kind: 'income', sortOrder: 5 }
];

describe('buildCategoryLabels', () => {
  it('唯一名保持原名', () => {
    const labels = buildCategoryLabels(categories, '未分类');
    expect(labels.get('cat-food')).toBe('餐饮');
    expect(labels.get('cat-salary')).toBe('工资');
  });

  it('同名分类加父前缀区分', () => {
    const labels = buildCategoryLabels(categories, '未分类');
    expect(labels.get('cat-food-other')).toBe('餐饮 / 其他');
    expect(labels.get('cat-transport-other')).toBe('交通 / 其他');
  });

  it('同名但没有父分类时退化为原名(不编造前缀)', () => {
    const labels = buildCategoryLabels(
      [
        { id: 'a', name: '其他', kind: 'expense' },
        { id: 'b', name: '其他', kind: 'expense' }
      ],
      '未分类'
    );
    expect(labels.get('a')).toBe('其他');
    expect(labels.get('b')).toBe('其他');
  });
});

describe('buildCategoryLabelIndex', () => {
  it('同名分类在名字列表里是两条不同的名字', () => {
    const { labels } = buildCategoryLabelIndex(categories, '未分类');
    expect(labels).toContain('餐饮 / 其他');
    expect(labels).toContain('交通 / 其他');
    // 「其他」原样出现会出现歧义,不应在列表里
    expect(labels.filter((label) => label === '其他')).toHaveLength(0);
  });

  it('唯一名字能映射回唯一的 id', () => {
    const { labelToId } = buildCategoryLabelIndex(categories, '未分类');
    expect(labelToId.get('餐饮')).toBe('cat-food');
    expect(labelToId.get('餐饮 / 其他')).toBe('cat-food-other');
    expect(labelToId.get('交通 / 其他')).toBe('cat-transport-other');
  });

  it('加前缀后仍然重名的,不会进映射(避免指向随机分类)', () => {
    const { labels, labelToId } = buildCategoryLabelIndex(
      [
        { id: 'p1', name: '餐饮', kind: 'expense' },
        { id: 'p2', name: '餐饮', kind: 'expense' },
        { id: 'c1', name: '其他', kind: 'expense', parentId: 'p1' },
        { id: 'c2', name: '其他', kind: 'expense', parentId: 'p2' }
      ],
      '未分类'
    );

    expect(labels).toContain('餐饮 / 其他');
    expect(labelToId.has('餐饮 / 其他')).toBe(false);
  });
});