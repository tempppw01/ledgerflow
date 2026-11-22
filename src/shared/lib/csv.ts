import { TransactionItem } from '../../entities/transaction/types';

/**
 * 导出用的列名。**不要随便改**:导入侧(billImport)会认这些别名,
 * 两头对上才能「导出 → 再导入」。改这里要同时跑 `csv.roundtrip.test.ts`。
 */
export const CSV_EXPORT_HEADERS = [
  'id',
  'type',
  'categoryId',
  'accountId',
  'amount',
  'date',
  'note',
  'tags'
] as const;

export function exportTransactionsCsv(rows: TransactionItem[]) {
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

  const csv = [headers.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `transactions-${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
