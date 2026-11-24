// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseBillCsvToTransactionsAsyncDetailed } from './billImport';

/**
 * 超大账单的解析耗时。
 *
 * 解析是同步的、正则密集。文件上限是 10MB(按字节),但 10MB 的 CSV 可能有好几万行 ——
 * 如果解析要几秒,浏览器主线程会被卡住(界面冻住、点不动),这属于真实体验问题。
 *
 * 这里只**测量**,不设阈值断言(先看数)。不同机器差别大,所以打出数字人工判断。
 */
const HEADER = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';

function buildBill(rows: number): string {
  const lines = [HEADER];
  for (let i = 0; i < rows; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    lines.push(
      `2026-11-${day} 18:46:13,商户消费,稻家乐社区厨房${i},招牌菜${i},支出,${(i % 500) + 1}.70,零钱,支付成功,A${i},B${i},备注${i}`
    );
  }
  return lines.join('\n');
}

describe('超大账单解析耗时', () => {
  for (const rows of [1000, 5000, 10000]) {
    it(`${rows} 行`, async () => {
      const csv = buildBill(rows);
      const mb = (Buffer.byteLength(csv, 'utf8') / 1024 / 1024).toFixed(2);
      const start = Date.now();
      const result = await parseBillCsvToTransactionsAsyncDetailed({
        csvText: csv,
        source: 'wechat',
        defaultCategoryId: 'cat-food',
        defaultAccountId: 'acc-cash',
        categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense' }]
      } as never);
      const ms = Date.now() - start;
      console.log(`${rows} 行(${mb}MB) → 解析 ${ms}ms,条数 ${result.rows.length}`);
      expect(result.rows.length).toBe(rows);
    }, 120000);
  }
});