// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBillFileToTransactionsDetailed } from './billImport';

/**
 * 第三批:GBK 编码 + 表头位置很靠后 + 金额为 0/负数。
 *
 * GBK 那条要用**真实字节**才能测到解码分支:Windows 上 Excel 另存「CSV(逗号分隔)」就是 GBK,
 * 编码不是 UTF-8 —— 解码错了整份文件都是乱码,一个字都认不出。
 */
function makeFile(path: string, name: string): File {
  const buffer = readFileSync(path);
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return { name, arrayBuffer: async () => ab } as unknown as File;
}

const categories = [
  { id: 'cat-food', name: '餐饮', kind: 'expense' },
  { id: 'cat-transport', name: '交通', kind: 'expense' }
] as never;

async function parse(file: File) {
  return parseBillFileToTransactionsDetailed({
    file,
    source: 'wechat',
    defaultCategoryId: 'cat-food',
    defaultAccountId: 'acc-cash',
    categories
  } as never);
}

describe('GBK 编码的账单', () => {
  it('能正确解码并解析(不是乱码)', async () => {
    const result = await parse(makeFile('src/shared/lib/__fixtures__/wechat-bill-gbk.csv', 'bill-gbk.csv'));
    console.log('GBK → 条数:', result.rows.length, '| 第一笔备注:', result.rows[0]?.note);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].amount).toBeCloseTo(39.7, 2);
    // 中文必须正确还原,而不是乱码
    expect(result.rows[0].note).toContain('稻家乐');
    expect(result.rows[1].note).toContain('智慧停车');
  });
});

describe('表头位置', () => {
  it('表头在第 40 行也能找到', async () => {
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    const preamble = Array.from({ length: 39 }, (_, i) => '第' + (i + 1) + '行说明');
    const csv = [...preamble, header, '2026-11-24 18:46:13,商户消费,稻家乐,招牌菜,支出,39.70,零钱,支付成功,A1,B1,备注'].join('\n');

    const result = await parseBillFileToTransactionsDetailed({
      file: {
        name: 'far-header.csv',
        arrayBuffer: async () => new TextEncoder().encode(csv).buffer
      } as unknown as File,
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash',
      categories
    } as never);

    expect(result.rows).toHaveLength(1);
  });
});

describe('金额为 0 或负数', () => {
  it('0 不记;负数按绝对值记入(方向由收/支列决定)', async () => {
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    const csv = [
      header,
      '2026-11-24 18:46:13,商户消费,某店,商品,支出,0,零钱,支付成功,A1,B1,零',
      '2026-11-23 18:46:13,商户消费,某店,商品,支出,-5,零钱,支付成功,A2,B2,负'
    ].join('\n');

    const result = await parseBillFileToTransactionsDetailed({
      file: {
        name: 'zero-negative.csv',
        arrayBuffer: async () => new TextEncoder().encode(csv).buffer
      } as unknown as File,
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash',
      categories
    } as never);

    console.log('0/负数 → 条数:', result.rows.length, '| 跳过:', result.summary.skippedCount, '| 金额:', result.rows.map((r) => r.amount));
    // 0 元不是一笔交易,跳过
    expect(result.rows).toHaveLength(1);
    expect(result.summary.skippedCount).toBe(1);
    // 负数**按绝对值**记入:银行流水常用负数表示流出,而方向由「收/支」列决定 ——
    // parseAmount 里的 Math.abs 是有意的,这里把它钉住,免得以后被顺手改成报错。
    expect(result.rows[0].amount).toBeCloseTo(5, 2);
    expect(result.rows[0].type).toBe('expense');
  });
});
