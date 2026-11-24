import type { TransactionItem } from '../../../entities/transaction/types';
import { roundMoney } from '../../../shared/lib/money';

/**
 * 快速记账表单里**与界面无关**的那部分逻辑。
 *
 * 抽出来的原因不是"为了让代码好看",而是这两个行为一直**没有测试**:
 *   · 三个校验(没选分类 / 没选账户 / 金额不合法)—— 错一个就是一笔脏数据或一次莫名其妙的失败;
 *   · 「再记一笔」到底保留什么、清空什么 —— 这是这个按钮**唯一的承诺**,
 *     而它当时写在页面组件里,只能靠手点验证(v0.50.41 的说明里我自己就写了"没有单测")。
 */

export interface QuickAddDraft {
  type: TransactionItem['type'];
  categoryId: string;
  accountId: string;
  amount: string;
  date: string;
  note: string;
}

/**
 * 校验失败的原因。
 *
 * 这里**只返回原因码,不返回 i18n 键** —— 逻辑层不该持有界面文案。
 * 另外这也是被静态检查逼出来的正确做法:把键写在这里,i18n 检查器就看不见它了
 * (它扫的是页面里的字面量),会把这个键误判成"没人用"。
 */
export type QuickAddValidationError = 'selectCategory' | 'selectAccount' | 'invalidAmount';

export type QuickAddValidation = { ok: true } | { ok: false; reason: QuickAddValidationError };

/** 校验顺序与原实现一致:先分类、再账户、最后金额。 */
export function validateQuickAddDraft(draft: QuickAddDraft): QuickAddValidation {
  if (!draft.categoryId) return { ok: false, reason: 'selectCategory' };
  if (!draft.accountId) return { ok: false, reason: 'selectAccount' };

  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalidAmount' };

  return { ok: true };
}

/**
 * 「再记一笔」之后表单该长什么样:**保留**类型 / 分类 / 账户 / 日期,**清空**金额与备注。
 *
 * 保留这四项是关键 —— 连记几笔同类消费(比如连着记三天的早餐)时,用户不用重选一遍。
 * 返回新对象,不改传入的草稿。
 */
export function applyKeepOpen(draft: QuickAddDraft): QuickAddDraft {
  return { ...draft, amount: '', note: '' };
}

/** 把草稿变成一笔可写入的交易(金额四舍五入,备注空则用默认文案)。 */
export function buildQuickAddTransaction(
  draft: QuickAddDraft,
  defaultNote: string
): Omit<TransactionItem, 'id'> {
  return {
    type: draft.type,
    categoryId: draft.categoryId,
    accountId: draft.accountId,
    amount: roundMoney(Number(draft.amount)),
    date: draft.date,
    note: draft.note.trim() || defaultNote,
    tags: [],
    source: 'manual',
    status: 'completed'
  };
}