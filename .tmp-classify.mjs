import { readFileSync } from 'node:fs';

// 逐个打印候选点的上下文,用于区分「布尔判断」与「三目取标签」两种形态。
const sites = [
  ['src/features/smart-budget/model/budgetDetail.ts', 95],
  ['src/features/smart-budget/model/budgetInsights.ts', 87],
  ['src/features/transactions/components/TransactionDetailDrawer.tsx', 86],
  ['src/features/transactions/components/TransactionDetailDrawer.tsx', 200],
  ['src/features/transactions/components/TransactionDetailDrawer.tsx', 652],
  ['src/features/transactions/components/TransactionTable.tsx', 430],
  ['src/features/transactions/components/TransactionTable.tsx', 483],
  ['src/features/transactions/components/TransactionTable.tsx', 539],
  ['src/features/transactions/components/TransactionTable.tsx', 1058],
  ['src/features/transactions/components/TransactionTable.tsx', 1123],
  ['src/features/transactions/model/exportTransactionsPdf.ts', 49],
  ['src/features/transactions/model/quickAddSummary.ts', 32],
  ['src/features/transactions/model/shareUtils.ts', 37],
  ['src/pages/assistant/AssistantPage.tsx', 1283],
  ['src/pages/transactions/TransactionsPage.tsx', 951],
  ['src/pages/transactions/TransactionsPage.tsx', 1593],
  ['src/pages/transactions/TransactionsPage.tsx', 1714],
  ['src/shared/store/useFinanceStore.ts', 584],
  ['src/shared/store/useFinanceStore.ts', 654],
  ['src/shared/store/useFinanceStore.ts', 979],
  ['src/shared/store/useFinanceStore.ts', 1029]
];

for (const [file, line] of sites) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const from = Math.max(0, line - 2);
  const to = Math.min(lines.length, line + 1);
  console.log('--- ' + file + ':' + line);
  for (let i = from; i < to; i += 1) {
    console.log((i === line - 1 ? '> ' : '  ') + (i + 1) + ': ' + lines[i].trim());
  }
}
