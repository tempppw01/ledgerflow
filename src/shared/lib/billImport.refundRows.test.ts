import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBillImportMode, parseBillCsvToTransactions } from './billImport';

/**
 * 退款行的记账语义 —— 用真实支付宝导出的形状。
 *
 * 支付宝把「全额退款」记在**同一行**:金额 24.59、成功退款 24.59。
 * 这一行的经济含义是「净额 0」,既不是一笔 24.59 的收入,也不该算成 24.59 的支出。
 * 旧逻辑只要「成功退款 > 0」就把整行判成收入 → 凭空多出一笔收入。
 */
function parse(csvText: string) {
  return parseBillCsvToTransactions({
    csvText,
    source: 'alipay',
    defaultCategoryId: 'cat-other',
    defaultAccountId: 'acc-1'
  });
}

const header = '交易时间,交易分类,交易对方,商品说明,收/支,金额,交易状态,成功退款(元),交易号';

describe('退款行的记账语义', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('全额退款(支出 24.59 / 退款 24.59):不产生记录,更不能记成收入', () => {
    const rows = parse(
      [header, '2026-11-18 09:30,餐饮,高德,打车,支出,24.59,退款成功,24.59,A1'].join('\n')
    );
    expect(rows, '全额退款净额为 0,不应产生收入记录').toHaveLength(0);
  });

  it('部分退款(支出 100 / 退款 30):按净额 70 记为支出', () => {
    const rows = parse(
      [header, '2026-11-18 09:30,餐饮,某店,午餐,支出,100.00,交易成功,30.00,A2'].join('\n')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('expense');
    expect(rows[0].amount).toBe(70);
  });

  it('没有退款列的普通支出不受影响', () => {
    const shortHeader = '交易时间,交易分类,交易对方,商品说明,收/支,金额,交易状态,交易号';
    const rows = parse(
      [shortHeader, '2026-11-18 09:30,餐饮,某店,午餐,支出,58.00,交易成功,A3'].join('\n')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('expense');
    expect(rows[0].amount).toBe(58);
  });

  it('同一份账单导入两次不会产生重复记录', () => {
    const csv = [
      header,
      '2026-11-18 09:30,餐饮,某店,午餐,支出,58.00,交易成功,0,A4',
      '2026-11-19 12:30,餐饮,另一家,晚餐,支出,32.00,交易成功,0,A5'
    ].join('\n');

    const first = parse(csv);
    expect(first).toHaveLength(2);

    // 第二次:把第一次的结果当作已有数据再导一遍
    const second = applyBillImportMode({
      mode: 'incremental',
      existing: first.map((row, index) => ({ ...row, id: `tx-${index}` })),
      incoming: parse(csv)
    });

    expect(second.append, '同一份账单不应新增记录').toHaveLength(0);
    expect(second.update, '内容没变也不应产生更新').toHaveLength(0);
    expect(second.skipped).toBe(2);
  });
});