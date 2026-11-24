// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
/**
 * 用一份**真实的 xlsx fixture** 跑完整解析链路。
 *
 * 为什么必须用 xlsx 而不是 CSV:这条链路的关键在 xlsx 解码那一段 ——
 * 日期在 sheet XML 里是**序列号**,要靠单元格样式才能还原;而 CSV 里日期本来就是文本,
 * 根本测不到这里。
 *
 * fixture 是 openpyxl 生成的微信账单(前置 17 行 + 表头 + 6 条数据),它有一个特点:
 * 数字单元格显式写成 t="n" —— 而微信自己导出的文件不写 t。只处理"没有 t"的代码
 * 在这个 fixture 上就会退回 0 条(这个 bug 就是被它抓到的)。
 */
import { describe, expect, it } from 'vitest';

const dom = new JSDOM('');
(globalThis as unknown as { DOMParser: unknown }).DOMParser = dom.window.DOMParser;

const BILL = 'src/shared/lib/__fixtures__/wechat-bill-openpyxl.xlsx';

function makeFile(path: string, name: string): File {
  const buffer = readFileSync(path);
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return { name, arrayBuffer: async () => ab } as unknown as File;
}

const categories = [
  { id: 'cat-food', name: '餐饮', kind: 'expense' },
  { id: 'cat-transport', name: '交通', kind: 'expense' },
  { id: 'cat-medical', name: '医疗', kind: 'expense' },
  { id: 'cat-shopping', name: '购物', kind: 'expense' },
  { id: 'cat-income', name: '收入', kind: 'income' }
] as never;

describe('导出工具带 t="n" 的账单', () => {
  it('日期还原 + 中性跳过 + 分类推断', async () => {
    const { parseBillFileToTransactionsDetailed } = await import('./billImport');
    const result = await parseBillFileToTransactionsDetailed({
      file: makeFile(BILL, 'wechat-bill-openpyxl.xlsx'),
      source: 'wechat',
      defaultCategoryId: 'cat-food',
      defaultAccountId: 'acc-cash',
      categories
    } as never);

    console.log('解析条数:', result.rows.length, '| 跳过:', result.summary.skippedCount);
    result.rows.forEach((r: { type: string; amount: number; categoryId: string; date: string; note: string }) => console.log('  ', r.type, r.amount, r.categoryId, r.date.slice(0, 19), '|', r.note.slice(0, 20)));

    expect(result.rows).toHaveLength(5);
    const byAmount = new Map(result.rows.map((r: { amount: number; categoryId: string }) => [r.amount, r.categoryId]));
    expect(byAmount.get(39.7)).toBe('cat-food');
    expect(byAmount.get(3.5)).toBe('cat-transport');
    expect(byAmount.get(53)).toBe('cat-medical');
    expect(byAmount.get(50)).toBe('cat-shopping');
    expect(byAmount.get(100)).toBe('cat-income');
    expect(result.rows.every((r: { date: string }) => r.date.startsWith('2026-11-'))).toBe(true);
  });
});
