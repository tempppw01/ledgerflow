import { describe, expect, it, vi } from 'vitest';
import type { Category } from '../../../entities/category/types';
import { ensureCategoryId, resolveCategoryId } from './workbenchMapping';

/**
 * 助手导入账单时,分类解析不出来该怎么办?
 *
 * 原先会退回 `categories[0]`(碰巧排第一的分类),或者在没有分类时造一个 `'cat-unknown'`。
 * 前者更隐蔽:账单上会显示一个**真分类**,但那不是它该归的类,分类统计与预算执行数
 * 就此悄悄偏掉,用户完全看不出来。应用本来就为「没有分类」准备了「未分类」
 * (列表这么显示,服务端也有每用户的哨兵分类兜底),所以正确答案是空串。
 *
 * 这与 accounts 那边同一条原则 —— `resolveAccountId` 也不再造 'acc-unknown'。
 */
const categories: Category[] = [
  { id: 'cat-food', name: '餐饮' } as Category,
  { id: 'cat-rent', name: '住房' } as Category
];

describe('分类解析的兜底', () => {
  it('能匹配上就用匹配到的分类', () => {
    expect(resolveCategoryId('餐饮', categories)).toBe('cat-food');
  });

  it('匹配不上时返回空串,而不是悄悄归到第一个分类', () => {
    const resolved = resolveCategoryId('宠物粮', categories);
    expect(resolved).toBe('');
    // 退回第一个分类会让分类统计失真 —— 钉住这个不再发生
    expect(resolved).not.toBe('cat-food');
    expect(resolved).not.toBe('cat-unknown');
  });

  it('没有给分类名时同样是空串', () => {
    expect(resolveCategoryId(undefined, categories)).toBe('');
    expect(resolveCategoryId('   ', categories)).toBe('');
  });

  it('连一个分类都没有时也不造 cat-unknown', () => {
    expect(resolveCategoryId('餐饮', [])).toBe('');
    expect(ensureCategoryId('餐饮', [], () => '')).toBe('');
  });

  it('新建分类失败(例如重名被拒)时返回空串', () => {
    // 注意别选餐饮外卖这类名字 —— 它会被松散匹配到餐饮,根本走不到新建失败这一步。
    const addCategory = vi.fn(() => '');
    expect(ensureCategoryId('宠物粮', categories, addCategory)).toBe('');
    expect(addCategory).toHaveBeenCalledWith('宠物粮');
  });

  it('新建成功时用新建的分类', () => {
    const addCategory = vi.fn(() => 'cat-new');
    expect(ensureCategoryId('宠物粮', categories, addCategory)).toBe('cat-new');
  });
});