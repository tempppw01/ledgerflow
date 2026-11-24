import { describe, expect, it } from 'vitest';
import { parseBillCsvToTransactionsAsyncDetailed } from './billImport';

/**
 * 三个"脏"但真实存在的 CSV 变体:
 *   1. CRLF 换行(Windows 上 Excel 另存 CSV 就是这样);
 *   2. 引号包裹且**字段内含逗号**(商家名里真的很常见);
 *   3. 引号包裹且**字段内含换行**(备注里有了换行)。
 *
 * 这些不走 xlsx 解码,直接进文本解析,所以能便宜地撞。
 */
const HEADER = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';

describe('CSV 变体', () => {
  it('CRLF 换行也能解析,且最后一列不带 \\r', async () => {
    const csv = [HEADER, '2026-11-24 18:46:13,商户消费,稻家乐,招牌菜,支出,39.70,零钱,支付成功,A1,B1,备注内容'].join('\r\n');
    const result = await parseBillCsvToTransactionsAsyncDetailed({
      csvText: csv,
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash',
      categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense' }]
    } as never);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBeCloseTo(39.7, 2);
    // 备注里不能残留 \r
    expect(result.rows[0].note).not.toContain('\r');
  });

  it('引号字段里的逗号不会把这一行拆错', async () => {
    const csv = [
      HEADER,
      '2026-11-24 18:46:13,商户消费,"稻家乐社区厨房,寮步坑口店",招牌菜,支出,39.70,零钱,支付成功,A1,B1,备注'
    ].join('\n');
    const result = await parseBillCsvToTransactionsAsyncDetailed({
      csvText: csv,
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash',
      categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense' }]
    } as never);

    expect(result.rows).toHaveLength(1);
    // 金额必须是 39.7 —— 如果逗号把字段拆错,这里会变成别的数或 0
    expect(result.rows[0].amount).toBeCloseTo(39.7, 2);
    expect(result.rows[0].note).toContain('稻家乐社区厨房');
  });

  it('引号字段里的换行不会多出一条交易', async () => {
    const csv = [
      HEADER,
      '2026-11-24 18:46:13,商户消费,稻家乐,"招牌菜', // 商品字段里有换行
      '第二行",支出,39.70,零钱,支付成功,A1,B1,备注'
    ].join('\n');
    const result = await parseBillCsvToTransactionsAsyncDetailed({
      csvText: csv,
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash',
      categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense' }]
    } as never);

    console.log('解析条数:', result.rows.length, '| 金额:', result.rows[0]?.amount, '| 备注:', result.rows[0]?.note);
    // 关键:不能因为字段内换行就多解析出一条(或者一条都没有)
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBeCloseTo(39.7, 2);
  });
});