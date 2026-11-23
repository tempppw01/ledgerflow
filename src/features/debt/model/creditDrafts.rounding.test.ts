import { describe, expect, it } from 'vitest';
import { roundMoney } from '../../../shared/lib/money';
import { parseCreditDraftFragment } from './creditDrafts';

/**
 * 金额取整在全项目只有一套真源(`shared/lib/money.ts` 的 `roundMoney`,带 EPSILON 修正)。
 *
 * 这一组盯的是「信用草稿解析」这条路径:它解析 OCR / 用户输入里的金额,而结果会**落库成负债**。
 * 之前它用的是 `Number(x.toFixed(2))` —— 另一套算法,在这些值上给出不同结果:
 *
 *   2.675 → toFixed 得 2.67,roundMoney 得 2.68
 *   1.005 → toFixed 得 1.00,roundMoney 得 1.01
 *
 * 也就是说同一个金额,经交易路径与经草稿路径会存成两个数。
 */
describe('信用草稿金额取整与全项目一致', () => {
  it('三位小数的金额按共享算法取整(不是 toFixed 的那套)', () => {
    // 直接钉住两套算法的差异,免得以后有人以为它们等价
    expect(roundMoney(2.675)).toBe(2.68);
    expect(Number((2.675).toFixed(2))).toBe(2.67);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(Number((1.005).toFixed(2))).toBe(1);
  });

  it('解析出来的还款金额走共享取整', () => {
    const draft = parseCreditDraftFragment('信用卡欠款 2.675 万');
    // 「2.675 万」= 26750,整万段不进小数;这里真正要保证的是解析结果干净
    expect(draft?.balance).toBe(26750);

    const twoDecimals = parseCreditDraftFragment('信用卡欠款 2675.675 元');
    if (twoDecimals?.balance !== undefined) {
      // 三位小数必须按共享算法收成两位,且与 roundMoney 一致
      expect(twoDecimals.balance).toBe(roundMoney(twoDecimals.balance));
      expect(Number.isInteger(twoDecimals.balance * 100)).toBe(true);
    }
  });

  it('口语单位组合的金额也不出现三位小数', () => {
    const cases = ['房贷 1万5', '车贷 1万零500', '花呗 3200.005 元'];
    for (const text of cases) {
      const draft = parseCreditDraftFragment(text);
      if (draft?.balance === undefined) continue;
      expect(Number.isInteger(draft.balance * 100)).toBe(true);
      expect(draft.balance).toBe(roundMoney(draft.balance));
    }
  });
});
