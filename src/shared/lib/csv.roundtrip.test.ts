import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../entities/transaction/types';
import { parseBillCsvToTransactions } from './billImport';
import { CSV_EXPORT_HEADERS } from './csv';

/**
 * 交易 CSV 的**导出 → 再导入**闭环。
 *
 * 这里抓到过与「账户类型 ewallet 让备份导不回来」同一类的问题:
 * 导出用的是英文列名(`date` / `amount` / `type` / `note`),而导入只认中文表头,
 * 于是 App 自己导出的 CSV 导回来是 **0 条**,界面还报"导入成功"。
 */
function buildExportCsv(rows: TransactionItem[]): string {
  // 与 csv.ts 的 exportTransactionsCsv 完全同构(表头来自同一个常量)
  const headers = [...CSV_EXPORT_HEADERS];
  const body = rows.map((row) =>
    [
      row.id,
      row.type,
      row.categoryId,
      row.accountId,
      row.amount.toFixed(2),
      row.date,
      row.note.replaceAll('"', '""'),
      row.tags.join('|')
    ]
      .map((item) => `"${item}"`)
      .join(',')
  );
  return [headers.join(','), ...body].join('\n');
}

function transaction(overrides: Partial<TransactionItem> & { id: string }): TransactionItem {
  return {
    type: 'expense',
    categoryId: 'cat-food',
    accountId: 'acc-cash',
    amount: 58,
    date: '2026-11-20T04:30:00.000Z',
    note: '午饭',
    tags: ['日常'],
    source: 'manual',
    status: 'completed',
    ...overrides
  } as TransactionItem;
}

function parse(csvText: string) {
  return parseBillCsvToTransactions({
    csvText,
    source: 'alipay',
    defaultCategoryId: 'cat-default',
    defaultAccountId: 'acc-default'
  });
}

describe('交易 CSV 导出后能再导入', () => {
  it('导出的表头全部被导入侧认可', () => {
    const rows = [transaction({ id: 'tx-1' })];
    const parsed = parse(buildExportCsv(rows));

    // 曾经这里返回 0 条:date / amount 都不在导入的列名清单里
    expect(parsed).toHaveLength(1);
  });

  it('金额、日期、方向、备注逐项对上', () => {
    const rows = [
      transaction({ id: 'tx-1', amount: 58, note: '午饭' }),
      transaction({
        id: 'tx-2',
        type: 'income',
        amount: 1200.5,
        date: '2026-11-21T02:00:00.000Z',
        note: '退款,含"引号"'
      })
    ];
    const parsed = parse(buildExportCsv(rows));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].amount).toBe(58);
    expect(parsed[0].type).toBe('expense');
    expect(parsed[0].note).toBe('午饭');
    expect(parsed[1].amount).toBe(1200.5);
    expect(parsed[1].type).toBe('income');
    // 引号被转义过,解析回来应该还原
    expect(parsed[1].note).toContain('引号');
    // 日期原样保留(导出写的是 ISO,导入应解析成同一天)
    expect(String(parsed[1].date).slice(0, 10)).toBe('2026-11-21');
  });

  it('空备注与多标签不会让整行失效', () => {
    const parsed = parse(buildExportCsv([transaction({ id: 'tx-3', note: '', tags: ['a', 'b'] })]));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].amount).toBe(58);
  });
});
