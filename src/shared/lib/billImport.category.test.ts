import { describe, expect, it } from 'vitest';
import type { Category } from '../../entities/category/types';
import { parseBillCsvToTransactionsAsyncDetailed } from './billImport';

/**
 * 账单导入的分类推断。
 *
 * 原来**每一行都用同一个 defaultCategoryId** —— 用户导微信账单时那个默认值常是「餐饮」,
 * 于是 445 笔交易(停车、医院、超市、话费……)全归到餐饮,分类统计与预算执行数直接失真。
 *
 * 现在按每行的「交易对方 + 商品 + 备注 + 交易类型」推断分类;推不出来才退回默认值。
 */

const categories: Category[] = [
  { id: 'cat-food', name: '餐饮', kind: 'expense' },
  { id: 'cat-transport', name: '交通', kind: 'expense' },
  { id: 'cat-medical', name: '医疗', kind: 'expense' },
  { id: 'cat-shopping', name: '购物', kind: 'expense' },
  { id: 'cat-income', name: '收入', kind: 'income' }
] as Category[];

const header =
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';

const csv = [
  header,
  '2026-11-22 23:21:06,商户消费,智慧停车,(寮步医院停车场)粤SA86256直付停车费,支出,0.90,中国银行储蓄卡,支付成功,A1,B1,/',
  '2026-11-22 22:45:58,商户消费,东莞市寮步医院,诊查费,支出,303.00,中国银行储蓄卡,支付成功,A2,B2,/',
  '2026-11-21 10:00:00,商户消费,永辉超市,日用品,支出,120.00,零钱,支付成功,A3,B3,/',
  '2026-11-20 09:00:00,转账,某人,转账备注:微信转账,收入,40.00,/,已存入零钱,A4,B4,/',
  '2026-11-19 08:00:00,商户消费,某不知名小店,说不清是什么,支出,5.00,零钱,支付成功,A5,B5,/'
].join('\n');

describe('账单导入按行推断分类', () => {
  it('不同消费落到不同分类,而不是全部用默认值', async () => {
    const result = await parseBillCsvToTransactionsAsyncDetailed({
      csvText: csv,
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash',
      categories
    } as never);

    const byNote = new Map(result.rows.map((row) => [row.note, row.categoryId]));

    expect(result.rows).toHaveLength(5);
    // 停车 → 交通;医院 → 医疗;超市 → 购物
    expect(byNote.get('智慧停车 · (寮步医院停车场)粤SA86256直付停车费 · /')).toBe('cat-transport');
    expect(byNote.get('东莞市寮步医院 · 诊查费 · /')).toBe('cat-medical');
    expect(byNote.get('永辉超市 · 日用品 · /')).toBe('cat-shopping');
    // 收入行 → 收入分类
    expect(byNote.get('某人 · 转账备注:微信转账 · /')).toBe('cat-income');
    // 推不出来的那笔才用默认分类
    expect(byNote.get('某不知名小店 · 说不清是什么 · /')).toBe('cat-food');

    // 关键:不能所有行都是同一个分类
    const distinct = new Set(result.rows.map((row) => row.categoryId));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('不传 categories 时保持旧行为:全部用默认分类', async () => {
    const result = await parseBillCsvToTransactionsAsyncDetailed({
      csvText: csv,
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash'
    } as never);

    expect(new Set(result.rows.map((row) => row.categoryId))).toEqual(new Set(['cat-food']));
  });
});