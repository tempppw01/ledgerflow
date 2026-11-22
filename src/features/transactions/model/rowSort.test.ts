import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../../entities/transaction/types';
import {
  buildTransactionRowComparator,
  type SortableTransactionRow
} from './rowSort';

/**
 * 交易列表排序规则。
 *
 * 这段逻辑从页面里抽出来的原因见 rowSort.ts(比较函数里不要解析日期、不要重复做中文比较),
 * 但**排序结果必须与原来完全一致**,这里把每种排序键的行为钉住。
 */
function row(overrides: Partial<TransactionItem> & { id: string }): SortableTransactionRow {
  return {
    item: {
      type: 'expense',
      categoryId: 'cat-1',
      accountId: 'acc-1',
      amount: 10,
      date: '2026-11-01T00:00:00.000Z',
      note: '',
      tags: [],
      source: 'manual',
      status: 'completed',
      ...overrides
    } as TransactionItem,
    categoryName: '餐饮',
    accountName: '现金',
    ...('categoryName' in overrides ? { categoryName: overrides.categoryName as string } : {}),
    ...('accountName' in overrides ? { accountName: overrides.accountName as string } : {})
  };
}

function sorted(
  rows: SortableTransactionRow[],
  key: Parameters<typeof buildTransactionRowComparator>[1],
  direction: 'asc' | 'desc' = 'asc'
): string[] {
  const copy = [...rows];
  copy.sort(buildTransactionRowComparator(copy, key, direction));
  return copy.map((item) => item.item.id);
}

describe('交易列表排序', () => {
  it('按日期是**时间顺序**,不是字符串顺序', () => {
    const rows = [
      row({ id: 'a', date: '2026-11-01T00:00:00.000Z' }),
      row({ id: 'b', date: '2026-09-30T12:00:00.000Z' }),
      row({ id: 'c', date: '2026-10-05T00:00:00.000Z' })
    ];
    expect(sorted(rows, 'date')).toEqual(['b', 'c', 'a']);
  });

  it('纯日期串与 ISO 串混排时仍按时间', () => {
    const rows = [
      row({ id: 'iso', date: '2026-10-15T08:00:00.000Z' }),
      row({ id: 'only', date: '2026-10-15' })
    ];
    // 'YYYY-MM-DD' 按 UTC 零点解析,应排在同一天带时间的瞬间之前
    expect(sorted(rows, 'date')).toEqual(['only', 'iso']);
  });

  it('非法的日期不会让排序抛错', () => {
    const rows = [row({ id: 'bad', date: '不是日期' }), row({ id: 'ok', date: '2026-11-01' })];
    expect(() => sorted(rows, 'date')).not.toThrow();
  });

  it('desc 恰好是 asc 的反序', () => {
    const rows = [
      row({ id: 'a', amount: 1 }),
      row({ id: 'b', amount: 3 }),
      row({ id: 'c', amount: 2 })
    ];
    expect(sorted(rows, 'amount', 'asc')).toEqual(['a', 'c', 'b']);
    expect(sorted(rows, 'amount', 'desc')).toEqual(['b', 'c', 'a']);
  });

  it('按金额排序(不是货币格式化后的字符串)', () => {
    const rows = [
      row({ id: 'nine', amount: 9 }),
      row({ id: 'ten', amount: 10 }),
      row({ id: 'hundred', amount: 100 })
    ];
    expect(sorted(rows, 'amount')).toEqual(['nine', 'ten', 'hundred']);
  });

  it('金额为非数字时按 0 处理,不抛错', () => {
    const rows = [row({ id: 'nan', amount: Number.NaN }), row({ id: 'five', amount: 5 })];
    expect(sorted(rows, 'amount')).toEqual(['nan', 'five']);
  });

  it('分类名按中文拼音排序', () => {
    const rows = [
      { ...row({ id: 'a' }), categoryName: '餐饮' }, // canyin
      { ...row({ id: 'b' }), categoryName: '交通' }, // jiaotong
      { ...row({ id: 'c' }), categoryName: '购物' } // gouwu
    ];
    // zh-CN 拼音序:餐饮 < 购物 < 交通
    expect(sorted(rows, 'category')).toEqual(['a', 'c', 'b']);
    expect(sorted(rows, 'category', 'desc')).toEqual(['b', 'c', 'a']);
  });

  it('键值相同时保持原有顺序(稳定排序)', () => {
    const rows = [
      row({ id: 'first', amount: 5 }),
      row({ id: 'second', amount: 5 }),
      row({ id: 'third', amount: 5 })
    ];
    expect(sorted(rows, 'amount')).toEqual(['first', 'second', 'third']);
  });

  it('备注/单号为空时不会抛错', () => {
    const rows = [row({ id: 'empty', note: '', orderNo: undefined }), row({ id: 'set', note: '午饭' })];
    expect(() => sorted(rows, 'note')).not.toThrow();
    expect(() => sorted(rows, 'orderNo')).not.toThrow();
  });

  it('排序不会改动传入的数组', () => {
    const rows = [row({ id: 'b', amount: 2 }), row({ id: 'a', amount: 1 })];
    const copy = [...rows];
    const comparator = buildTransactionRowComparator(copy, 'amount', 'asc');
    copy.sort(comparator);
    expect(rows.map((item) => item.item.id)).toEqual(['b', 'a']);
  });
});