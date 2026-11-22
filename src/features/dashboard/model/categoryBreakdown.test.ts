import { describe, expect, it } from 'vitest';
import type { Category } from '../../../entities/category/types';
import {
  buildCategoryGroupLabels,
  resolveCategoryGroupKey,
  resolveCategoryGroupLabel
} from './categoryBreakdown';

const categories: Category[] = [
  { id: 'cat-food', name: '餐饮', kind: 'expense', sortOrder: 1 },
  { id: 'cat-food-other', name: '其他', kind: 'expense', parentId: 'cat-food', sortOrder: 2 },
  { id: 'cat-transport', name: '交通', kind: 'expense', sortOrder: 3 },
  { id: 'cat-transport-other', name: '其他', kind: 'expense', parentId: 'cat-transport', sortOrder: 4 }
];

describe('分类聚合身份', () => {
  it('身份用分类 id:同名子分类得到不同的 key', () => {
    const a = resolveCategoryGroupKey({ categoryId: 'cat-food-other' });
    const b = resolveCategoryGroupKey({ categoryId: 'cat-transport-other' });
    expect(a).not.toBe(b);
    expect([a, b]).toEqual(['cat-food-other', 'cat-transport-other']);
  });

  it('空分类统一落到空串(未分类)', () => {
    expect(resolveCategoryGroupKey({ categoryId: '' })).toBe('');
    expect(resolveCategoryGroupKey({ categoryId: undefined as unknown as string })).toBe('');
  });

  it('找不到分类时返回「未分类」文案,而不是把原始 id 抛给用户', () => {
    expect(resolveCategoryGroupLabel('cat-gone', categories, '未分类')).toBe('未分类');
    expect(resolveCategoryGroupLabel('', categories, '未分类')).toBe('未分类');
  });

  it('同名分类的显示名加上父分类区分', () => {
    const labels = buildCategoryGroupLabels(
      ['cat-food-other', 'cat-transport-other'],
      categories,
      '未分类'
    );
    expect(labels.get('cat-food-other')).toBe('餐饮 / 其他');
    expect(labels.get('cat-transport-other')).toBe('交通 / 其他');
  });

  it('不同名分类保持原名,不加前缀', () => {
    const labels = buildCategoryGroupLabels(['cat-food', 'cat-transport'], categories, '未分类');
    expect(labels.get('cat-food')).toBe('餐饮');
    expect(labels.get('cat-transport')).toBe('交通');
  });

  it('未分类与真实分类同名时也不会互相干扰', () => {
    const labels = buildCategoryGroupLabels(['', 'cat-food'], categories, '未分类');
    expect(labels.get('')).toBe('未分类');
    expect(labels.get('cat-food')).toBe('餐饮');
  });
});