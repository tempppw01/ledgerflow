import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../../entities/transaction/types';
import { buildTransactionShareText, maskShareText } from './shareUtils';

/**
 * 分享文本是**给别人看的**,`masked` 模板是隐私开关 —— 一旦它漏出金额或名称,
 * 是把用户的钱直接发给别人。这条路径此前**没有任何测试**,所以这里把不变量钉住:
 *
 *   · masked:金额必须完全消失(只剩 ¥••••)、分类/账户/备注要脱敏、标签只报数量;
 *   · full:金额带方向符号、名称原样;
 *   · summary:不含账户/状态/来源。
 */

function tx(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    amount: 1234.56,
    date: '2026-11-24',
    note: '周末聚餐账单',
    tags: ['聚餐', '朋友'],
    status: 'completed',
    ...overrides
  };
}

const base = {
  categoryName: '餐饮美食',
  accountName: '招商银行储蓄卡',
  source: 'manual' as const,
  includeNote: true,
  includeAttachments: true,
  includeAccount: true
};

describe('分享文本的隐私开关', () => {
  it('masked:金额完全消失,只剩占位', () => {
    const text = buildTransactionShareText({ ...base, transaction: tx(), template: 'masked' });
    expect(text).toContain('¥••••');
    // 关键:任何一种写法都不该把金额带出去
    expect(text).not.toContain('1234');
    expect(text).not.toContain('1,234');
    expect(text).not.toContain('1234.56');
  });

  it('masked:分类、账户、备注都要脱敏', () => {
    const text = buildTransactionShareText({ ...base, transaction: tx(), template: 'masked' });
    expect(text).not.toContain('餐饮美食');
    expect(text).not.toContain('招商银行储蓄卡');
    expect(text).not.toContain('周末聚餐账单');
    // 首尾各留一字 + 中间打码
    expect(text).toContain(maskShareText('餐饮美食'));
  });

  it('masked:标签只报数量,不报内容', () => {
    const text = buildTransactionShareText({ ...base, transaction: tx(), template: 'masked' });
    expect(text).not.toContain('聚餐');
    expect(text).not.toContain('朋友');
    expect(text).toContain('2 个标签');
  });

  it('full:金额带方向符号,名称原样', () => {
    /*
     * 注意:full 模板用的是 formatCurrencyAuto —— 金额 ≥1000 时是**紧凑写法**(1.23千),
     * 与交易列表里的显示一致。这不是本模块自己决定的口径,所以测试按实际行为钉住它,
     * 而不是按"精确到分"去断言。真要让分享文本永远精确,那是另一处产品决定。
     */
    const text = buildTransactionShareText({ ...base, transaction: tx(), template: 'full' });
    expect(text).toMatch(/¥1\.23千/);
    expect(text).toContain('餐饮美食');
    expect(text).toContain('招商银行储蓄卡');
    expect(text).not.toContain('¥••••');
  });

  it('full:小额金额精确到分', () => {
    const text = buildTransactionShareText({
      ...base,
      transaction: tx({ amount: 88.5 }),
      template: 'full'
    });
    expect(text).toMatch(/88\.50/);
  });

  it('full:收入带 + 号,支出带 - 号', () => {
    const expense = buildTransactionShareText({ ...base, transaction: tx(), template: 'full' });
    const income = buildTransactionShareText({
      ...base,
      transaction: tx({ type: 'income' }),
      template: 'full'
    });
    expect(expense).toMatch(/-¥1\.23千/);
    expect(income).toMatch(/\+¥1\.23千/);
  });

  it('summary:不含账户、状态、来源', () => {
    const text = buildTransactionShareText({ ...base, transaction: tx(), template: 'summary' });
    expect(text).not.toContain('招商银行储蓄卡');
    expect(text).not.toContain('状态');
    expect(text).not.toContain('来源');
  });
});

describe('maskShareText', () => {
  it('空值给占位符,不返回空串', () => {
    expect(maskShareText('   ')).toBe('—');
  });

  it('短文本全遮', () => {
    expect(maskShareText('餐')).toBe('••');
    expect(maskShareText('餐饮')).toBe('••');
  });

  it('中等长度留首尾各一字', () => {
    expect(maskShareText('餐饮美食')).toBe('餐•••食');
  });

  it('长文本留首尾各两字', () => {
    expect(maskShareText('招商银行储蓄卡')).toBe('招商***蓄卡');
  });

  it('脱敏后不得包含原文中的连续三位数字', () => {
    // 备注里常见的卡号/电话片段,脱敏后不应还能读出片段
    const masked = maskShareText('尾号6225 请核对');
    expect(masked).not.toContain('622');
    expect(masked).not.toContain('225');
  });
});