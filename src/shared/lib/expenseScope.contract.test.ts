import { describe, expect, it } from 'vitest';
import type { TransactionType } from '../../entities/transaction/types';
import { isActualExpenseType } from '../../features/dashboard/model/utils';
import { isExpenseLike } from './transactionMetrics';

/**
 * 「支出」在项目里有**两个有意不同**的口径,这个测试把它们钉住:
 *
 *   · `isExpenseLike`(shared/lib/transactionMetrics)      = 支出 + **预算** + 还款
 *     —— 「减少账户余额」的口径。预算型交易是把钱划进预算,余额确实变了。
 *   · `isActualExpenseType`(features/dashboard/model/utils) = 支出 + 还款
 *     —— 「实际花掉」的口径。划进预算的钱还不算花掉。
 *
 * 两者只差 `budget` 一项,而这**正是待决事项**:首页「本月结余」按后者算,
 * 「钱都去哪了」按前者算,于是同一屏里两个数字对不上(演示账本没有 budget 型交易,
 * 所以这个矛盾目前没被真实数据触发)。
 *
 * 所以这个测试的用途不是"保证它们相等",而是:**谁要改动其中任何一个,都要先过这一关**。
 * 真要统一口径,请连同 docs/verified-invariants.md 里那条待决事项一起改,别只改代码。
 */

const ALL_TYPES: TransactionType[] = ['expense', 'income', 'budget', 'repayment'];

describe('支出口径的两个谓词', () => {
  it('各自的判定(逐类型钉住)', () => {
    expect(ALL_TYPES.filter(isExpenseLike)).toEqual(['expense', 'budget', 'repayment']);
    expect(ALL_TYPES.filter(isActualExpenseType)).toEqual(['expense', 'repayment']);
  });

  it('两者**只**在 budget 上不同 —— 这是一处刻意的区分,不是漏改', () => {
    const differences = ALL_TYPES.filter((type) => isExpenseLike(type) !== isActualExpenseType(type));
    expect(differences).toEqual(['budget']);
  });

  it('收入类型两边都不算支出', () => {
    expect(isExpenseLike('income')).toBe(false);
    expect(isActualExpenseType('income')).toBe(false);
  });

  it('预算型:减少余额算支出,但不算"实际花掉"', () => {
    expect(isExpenseLike('budget')).toBe(true);
    expect(isActualExpenseType('budget')).toBe(false);
  });
});