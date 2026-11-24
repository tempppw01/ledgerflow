import { describe, expect, it } from 'vitest';
import type { TransactionType } from '../../entities/transaction/types';
import { isActualExpenseType } from '../../features/dashboard/model/utils';
import { isExpenseLike } from './transactionMetrics';

/**
 * 「支出」的口径在 2026-11-24 之前是**两套**:`isExpenseLike` 含 `budget`,
 * `isActualExpenseType` 不含 → 首页一屏内两个数字自相矛盾。
 *
 * 定案依据不是偏好,而是**代码自己的一致行为**:全项目对「预算」型 5 处不计入
 * (首页本月结余、智能预算的已花费/洞察/分类明细、助手发给模型的合计)、1 处计入
 * (只有 isExpenseLike 那条链)→ 于是把那一处对齐到其余五处。
 *
 * 这个测试现在钉的是**统一后**的契约。谁想再让某个类型两边不同,这里会先翻红。
 *
 * 另:预算型交易**仍然**会产生余额变动(那是 useFinanceStore 里的 balance-change 逻辑,
 * 与这两个谓词无关)—— 也就是说「不算支出」不等于「不影响余额」。
 */

const ALL_TYPES: TransactionType[] = ['expense', 'income', 'budget', 'repayment'];

describe('支出口径(已统一)', () => {
  it('两个谓词的判定完全一致', () => {
    for (const type of ALL_TYPES) {
      expect(isExpenseLike(type)).toBe(isActualExpenseType(type));
    }
  });

  it('支出 + 还款算支出,收入与预算不算', () => {
    expect(ALL_TYPES.filter(isExpenseLike)).toEqual(['expense', 'repayment']);
    expect(ALL_TYPES.filter(isActualExpenseType)).toEqual(['expense', 'repayment']);
  });

  it('预算型不算支出 —— 这是 2026-11-24 定案的那一条', () => {
    expect(isExpenseLike('budget')).toBe(false);
    expect(isActualExpenseType('budget')).toBe(false);
  });

  it('收入两边都不算', () => {
    expect(isExpenseLike('income')).toBe(false);
    expect(isActualExpenseType('income')).toBe(false);
  });
});