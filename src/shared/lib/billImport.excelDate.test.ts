import { describe, expect, it } from 'vitest';
import {
  excelSerialToLocalDateTime,
  parseBillCsvToTransactionsAsyncDetailed
} from './billImport';

/**
 * 两个真实的导入缺陷(来自用户上传的微信账单):
 *
 * 1. **xlsx 里的日期是 Excel 序列号**,不是文本。原来的解码器忽略单元格样式,
 *    于是「交易时间」列全是 46350.782… 这样的数字,下游按日期解析全部失败 ——
 *    整份文件解析出 **0 条**,界面上就是「上传失败」。
 * 2. **中性交易(收/支 = "/")被算进了收支**。转账、零钱提现、理财通转入转出既不是收入
 *    也不是支出;以前它们落到关键词兜底,把收入从 29402.99 算成 55088.29。
 *
 * 这份账单的权威数字:共 445 笔,支出 275 笔 14522.08,收入 77 笔 29402.99,中性 93 笔。
 */

describe('Excel 日期序列号还原', () => {
  it('账单里的真实序列号还原成本地时间', () => {
    // 微信账单第一笔:2026-11-24 18:46:13
    expect(excelSerialToLocalDateTime(46350.78209490741)).toBe('2026-11-24 18:46:13');
    // 2026-08-24 00:00:00(账单起始时间)
    expect(excelSerialToLocalDateTime(46258)).toBe('2026-08-24 00:00:00');
  });

  it('整数序列号按当天 0 点处理', () => {
    expect(excelSerialToLocalDateTime(45000)).toBe('2023-03-15 00:00:00');
  });

  it('非法值返回 null,不返回 Invalid Date', () => {
    expect(excelSerialToLocalDateTime(Number.NaN)).toBeNull();
    expect(excelSerialToLocalDateTime(0)).toBeNull();
    expect(excelSerialToLocalDateTime(-1)).toBeNull();
  });
});

describe('中性交易(收/支 = "/")', () => {
  const csv = [
    '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
    '2026-11-24 18:46:13,商户消费,某商店,某商品,支出,39.70,零钱,支付成功,A1,B1,/',
    '2026-11-23 18:02:51,转账,某人,转账备注,收入,40.00,/,已存入零钱,A2,B2,/',
    '2026-11-22 10:00:00,零钱提现,零钱提现,/,/,29163.47,/,提现已到账,A3,B3,/' 
  ].join('\n');

  it('跳过中性交易,只保留真正的收支', async () => {
    const result = await parseBillCsvToTransactionsAsyncDetailed({
      csvText: csv,
      source: 'wechat'
    } as never);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.type)).toEqual(['expense', 'income']);

    const expense = result.rows.filter((row) => row.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const income = result.rows.filter((row) => row.type === 'income').reduce((s, r) => s + r.amount, 0);
    // 中性那笔 29163.47 既不该进支出也不该进收入
    expect(expense).toBeCloseTo(39.7, 2);
    expect(income).toBeCloseTo(40, 2);
  });
});