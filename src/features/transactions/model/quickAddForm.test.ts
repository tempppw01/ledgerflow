import { describe, expect, it } from 'vitest';
import { applyKeepOpen, buildQuickAddTransaction, validateQuickAddDraft } from './quickAddForm';

/**
 * 快速记账的校验与「再记一笔」语义。
 *
 * 这两个行为在 v0.50.41 上线时**只有手点验证、没有单测**(当时的说明里我自己写了这一点)。
 * 这里补上:「再记一笔」的唯一承诺就是**保留类型/分类/账户/日期、只清金额与备注**。
 */

const draft = {
  type: 'expense' as const,
  categoryId: 'cat-food',
  accountId: 'acc-cash',
  amount: '12.5',
  date: '2026-11-25',
  note: '早餐'
};

describe('validateQuickAddDraft', () => {
  it('三个必填项齐全、金额合法 → 通过', () => {
    expect(validateQuickAddDraft(draft)).toEqual({ ok: true });
  });

  it('没选分类 → 提示选分类', () => {
    expect(validateQuickAddDraft({ ...draft, categoryId: '' })).toEqual({
      ok: false,
      reason: 'selectCategory'
    });
  });

  it('没选账户 → 提示选账户', () => {
    expect(validateQuickAddDraft({ ...draft, accountId: '' })).toEqual({
      ok: false,
      reason: 'selectAccount'
    });
  });

  it('金额为 0 / 负数 / 非数字 → 提示金额不合法', () => {
    for (const amount of ['0', '-1', 'abc', '']) {
      expect(validateQuickAddDraft({ ...draft, amount })).toEqual({
        ok: false,
        reason: 'invalidAmount'
      });
    }
  });

  it('先报分类,再报账户(顺序与原实现一致)', () => {
    expect(validateQuickAddDraft({ ...draft, categoryId: '', accountId: '' })).toMatchObject({
      reason: 'selectCategory'
    });
  });
});

describe('「再记一笔」保留什么、清空什么', () => {
  it('保留类型 / 分类 / 账户 / 日期,清空金额与备注', () => {
    const next = applyKeepOpen(draft);
    expect(next.type).toBe('expense');
    expect(next.categoryId).toBe('cat-food');
    expect(next.accountId).toBe('acc-cash');
    expect(next.date).toBe('2026-11-25');
    expect(next.amount).toBe('');
    expect(next.note).toBe('');
  });

  it('不修改传入的草稿', () => {
    const input = { ...draft };
    applyKeepOpen(input);
    expect(input).toEqual(draft);
  });
});

describe('buildQuickAddTransaction', () => {
  it('金额四舍五入,备注为空时用默认文案', () => {
    const row = buildQuickAddTransaction({ ...draft, amount: '12.345', note: '   ' }, '记一笔');
    expect(row.amount).toBe(12.35);
    expect(row.note).toBe('记一笔');
    expect(row.source).toBe('manual');
    expect(row.status).toBe('completed');
  });

  it('备注两端空白会被去掉', () => {
    expect(buildQuickAddTransaction({ ...draft, note: '  早餐  ' }, '记一笔').note).toBe('早餐');
  });
});