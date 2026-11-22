import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBillCsvToTransactions } from './billImport';

/**
 * 账单导入的健壮性不变量 —— 用「脏」但真实的 CSV 样本。
 *
 * 核心原则:**要么正确解析,要么整行跳过**;绝不能把解析不了的值悄悄变成别的数据
 * (例如把认不出的日期写成「今天」)。脏数据进账本比丢一行更糟,而且用户看不出来。
 */
function parse(csvText: string) {
  return parseBillCsvToTransactions({
    csvText,
    source: 'alipay',
    defaultCategoryId: 'cat-other',
    defaultAccountId: 'acc-1'
  });
}

describe('账单导入健壮性', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const header = '交易时间,交易分类,交易对方,商品说明,收/支,金额,交易状态,交易号,商家订单号';

  it('金额带货币符号与千分位仍能解析', () => {
    const rows = parse(
      [header, '2026-11-20 12:00:00,餐饮,某餐厅,午餐,支出,"¥1,234.56",交易成功,T1,M1'].join('\n')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1234.56);
  });

  it('带币种代码的金额能解析(以前会被静默丢掉)', () => {
    for (const amountCell of ['CNY 58.00', 'RMB58.00', '58.00元']) {
      const rows = parse(
        [header, `2026-11-20 12:00:00,餐饮,某餐厅,午餐,支出,${amountCell},交易成功,T1a,M1a`].join('\n')
      );
      expect(rows, `解析失败:${amountCell}`).toHaveLength(1);
      expect(rows[0].amount).toBe(58);
    }
  });

  it('全角数字的金额能解析(以前会被静默丢掉)', () => {
    const rows = parse(
      [header, '2026-11-20 12:00:00,餐饮,某餐厅,午餐,支出,５８.００,交易成功,T1b,M1b'].join('\n')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(58);
  });

  it('金额无法解析时整行跳过,而不是记成 0 元', () => {
    const rows = parse(
      [header, '2026-11-20 12:00:00,餐饮,某餐厅,午餐,支出,"$1,234.56",交易成功,T2,M2'].join('\n')
    );
    expect(rows, '无法解析的金额不应产生一条 0 元记录').toHaveLength(0);
  });

  it('中文日期格式应被正确解析,而不是悄悄变成「今天」', () => {
    const rows = parse(
      [header, '2026年11月18日 09:30,餐饮,某餐厅,早餐,支出,¥20.00,交易成功,T3,M3'].join('\n')
    );
    expect(rows).toHaveLength(1);
    // 修前这里会是 2026-11-22(今天),等于把 18 号的账记到今天
    expect(rows[0].date.slice(0, 10)).toBe('2026-11-18');
  });

  it('美式日期不该被写成「今天」', () => {
    // 11/20/2026 不等于「今天」(夹具里今天是 11-22)
    const rows = parse(
      [header, '11/20/2026 10:30,餐饮,某餐厅,午餐,支出,¥30.00,交易成功,T4,M4'].join('\n')
    );
    if (rows.length > 0) {
      expect(rows[0].date.slice(0, 10)).not.toBe('2026-11-22');
    }
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it('完全无法识别的时间:整行跳过,不产生记录', () => {
    const rows = parse(
      [header, '昨天下午,餐饮,某餐厅,午餐,支出,¥30.00,交易成功,T4b,M4b'].join('\n')
    );
    expect(rows, '认不出时间就不该产生记录').toHaveLength(0);
  });

  it('引号里的逗号不会被拆列', () => {
    const rows = parse(
      [header, '2026-11-20 12:00:00,餐饮,"商户,名称",午餐,支出,¥10.00,交易成功,T5,M5'].join('\n')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toContain('名称');
  });

  it('多余的空行与尾随换行不影响结果', () => {
    const rows = parse(
      [
        header,
        '',
        '2026-11-20 12:00:00,餐饮,某餐厅,午餐,支出,¥15.00,交易成功,T6,M6',
        '',
        '',
        ''
      ].join('\n')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(15);
  });

  it('表头带空格/BOM 也能识别列', () => {
    const rows = parse(
      [
        '\uFEFF 交易时间 , 交易分类 , 交易对方 , 商品说明 , 收/支 , 金额 , 交易状态 , 交易号 , 商家订单号 ',
        '2026-11-20 12:00:00,餐饮,某餐厅,午餐,支出,¥18.00,交易成功,T7,M7'
      ].join('\n')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(18);
    expect(rows[0].type).toBe('expense');
  });

  it('空文本与只有表头时返回空数组,不抛错', () => {
    expect(parse('')).toEqual([]);
    expect(parse(header)).toEqual([]);
  });
});