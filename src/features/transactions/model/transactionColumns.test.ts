import { describe, expect, it } from 'vitest';
import {
  clampColumnWidth,
  getMinColumnWidth,
  isColumnWidthAtBounds,
  MAX_COLUMN_WIDTH
} from './transactionColumns';

/*
 * 这些数字原来散在两个文件里,而且**已经不一致了**:
 * TransactionTable 写 amount 最小 64,TransactionsPage 钳到 72。
 * 于是按 Home 把金额列调到最窄时,手柄报 aria-valuenow=64 而实际列宽 72 ——
 * 一个正在发生的假读数。
 *
 * 所以这里不只是测函数,更是**钉住"只能有一份真源"**这件事:
 * 哪天有人又在别处手写一组宽度,这些断言不会直接失败,但
 * `clampColumnWidth` 与 `getMinColumnWidth` 的一致性断言会提醒他先看这里。
 */
describe('交易表格列宽真源', () => {
  it('金额列可以比其它列更窄', () => {
    expect(getMinColumnWidth('amount')).toBe(72);
    ['date', 'type', 'status', 'category', 'account', 'orderNo', 'merchantOrderNo', 'note'].forEach(
      (key) => {
        expect(getMinColumnWidth(key as Parameters<typeof getMinColumnWidth>[0])).toBe(90);
      }
    );
  });

  it('钳位用同一份最小/最大值,不会报出做不到的数', () => {
    // 金额列:报 64 曾经是假读数,钳位必须把它抬到 72
    expect(clampColumnWidth('amount', 64)).toBe(72);
    expect(clampColumnWidth('amount', 100)).toBe(100);
    expect(clampColumnWidth('note', 10)).toBe(90);
    expect(clampColumnWidth('note', 99999)).toBe(MAX_COLUMN_WIDTH);
  });

  it('小数宽度取整,避免持久化出 120.5 这类值', () => {
    expect(clampColumnWidth('note', 120.5)).toBe(121);
    expect(clampColumnWidth('note', 120.4)).toBe(120);
  });

  it('钳位结果永远落在 [min, max] 内', () => {
    const keys = ['amount', 'note', 'date'] as const;
    for (const key of keys) {
      for (const raw of [-1e9, -1, 0, 1, 90, 640, 641, 1e9, NaN]) {
        const clamped = clampColumnWidth(key, raw);
        if (Number.isNaN(raw)) {
          // NaN 由调用方拦(TransactionsPage 读 localStorage 时会先 Number.isFinite)
          expect(Number.isNaN(clamped)).toBe(true);
          continue;
        }
        expect(clamped).toBeGreaterThanOrEqual(getMinColumnWidth(key));
        expect(clamped).toBeLessThanOrEqual(MAX_COLUMN_WIDTH);
      }
    }
  });

  it('边界判定与钳位同源', () => {
    expect(isColumnWidthAtBounds('amount', 72)).toEqual({ atMin: true, atMax: false });
    expect(isColumnWidthAtBounds('amount', 73)).toEqual({ atMin: false, atMax: false });
    expect(isColumnWidthAtBounds('note', MAX_COLUMN_WIDTH)).toEqual({ atMin: false, atMax: true });
    expect(isColumnWidthAtBounds('note', 70)).toEqual({ atMin: true, atMax: false });
  });
});
