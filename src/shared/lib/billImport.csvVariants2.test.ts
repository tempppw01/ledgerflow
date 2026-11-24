import { describe, expect, it } from 'vitest';
import { parseBillCsvToTransactionsAsyncDetailed } from './billImport';

/**
 * 第二批"真实但没覆盖"的账单形状:
 *   1. 金额带人民币符号或千分位(`¥1,234.50`)—— 有些导出的「金额(元)」列带 `¥`;
 *   2. 日期是斜杠格式(`2026/11/24 18:46:13`)—— Excel 常见的显示格式;
 *   3. 表头之前/之后有多余空行;
 *   4. 行尾有空格。
 *
 * 这些都不走 xlsx,直接进文本解析,能便宜地撞。
 */
const HEADER = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';

async function parse(csvText: string) {
  return parseBillCsvToTransactionsAsyncDetailed({
    csvText,
    source: 'wechat',
    defaultCategoryId: 'cat-food',
    defaultAccountId: 'acc-cash',
    categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense' }]
  } as never);
}

describe('第二批 CSV 形状', () => {
  it('金额带 ¥ 或千分位(含逗号时按规范加了引号)', async () => {
    const csv = [
      HEADER,
      '2026-11-24 18:46:13,商户消费,稻家乐,招牌菜,支出,"¥1,234.50",零钱,支付成功,A1,B1,备注'
    ].join('\n');
    const result = await parse(csv);
    console.log('带 ¥ 与千分位 → 条数:', result.rows.length, '金额:', result.rows[0]?.amount);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBeCloseTo(1234.5, 2);
  });

  it('日期是斜杠格式', async () => {
    const csv = [HEADER, '2026/11/24 18:46:13,商户消费,稻家乐,招牌菜,支出,39.70,零钱,支付成功,A1,B1,备注'].join('\n');
    const result = await parse(csv);
    console.log('斜杠日期 → 条数:', result.rows.length, '日期:', result.rows[0]?.date);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].date.startsWith('2026-11-24')).toBe(true);
  });

  it('表头前后有多余空行', async () => {
    const csv = ['', '', HEADER, '', '2026-11-24 18:46:13,商户消费,稻家乐,招牌菜,支出,39.70,零钱,支付成功,A1,B1,备注', ''].join('\n');
    const result = await parse(csv);
    expect(result.rows).toHaveLength(1);
  });

  it('行尾有空格', async () => {
    const csv = [HEADER, '2026-11-24 18:46:13,商户消费,稻家乐,招牌菜,支出,39.70,零钱,支付成功,A1,B1,备注   '].join('\n');
    const result = await parse(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBeCloseTo(39.7, 2);
  });
});