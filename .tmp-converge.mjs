import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, edits) {
  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let out = raw.split(/\r?\n/).join('\n');
  for (const [needle, replacement, label] of edits) {
    const first = out.indexOf(needle);
    if (first === -1) throw new Error('anchor not found: ' + label + ' in ' + path);
    if (out.indexOf(needle, first + 1) !== -1) throw new Error('anchor not unique: ' + label);
    out = out.slice(0, first) + replacement + out.slice(first + needle.length);
  }
  writeFileSync(path, out.split('\n').join(eol), 'utf8');
  console.log('ok:', path);
}

const PREDICATE_NOTE = `// 「退款/冲正」统一走共享判断,避免各处自己写一遍后走形(上一轮月支出多算 2×退款就是这么来的)。`;

// ---- 1. budgetDetail.ts ----
patch('src/features/smart-budget/model/budgetDetail.ts', [
  [
    `import { roundMoney } from '../../../shared/lib/money';`,
    `import { roundMoney } from '../../../shared/lib/money';
import { isTransactionRefundLike } from '../../../shared/lib/transactionMetrics';`,
    'import'
  ],
  [
    `    const refundLike = item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal';`,
    `    const refundLike = isTransactionRefundLike(item);`,
    'predicate'
  ]
]);

// ---- 2. budgetInsights.ts ----
patch('src/features/smart-budget/model/budgetInsights.ts', [
  [
    `import { roundMoney } from '../../../shared/lib/money';`,
    `import { roundMoney } from '../../../shared/lib/money';
import { isTransactionRefundLike } from '../../../shared/lib/transactionMetrics';`,
    'import'
  ],
  [
    `    const refundLike = item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal';`,
    `    const refundLike = isTransactionRefundLike(item);`,
    'predicate'
  ]
]);

// ---- 3. quickAddSummary.ts ----
patch('src/features/transactions/model/quickAddSummary.ts', [
  [
    `import { resolveTransactionLocalDay } from '../../../shared/lib/localDate';`,
    `import { resolveTransactionLocalDay } from '../../../shared/lib/localDate';
import { isTransactionRefundLike } from '../../../shared/lib/transactionMetrics';`,
    'import'
  ],
  [
    `    return item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal'
      ? total - amount
      : total + amount;`,
    `    return isTransactionRefundLike(item) ? total - amount : total + amount;`,
    'predicate'
  ]
]);

// ---- 4. TransactionDetailDrawer.tsx ----
patch('src/features/transactions/components/TransactionDetailDrawer.tsx', [
  [
    `    const isRefundOrReversal =
      transaction.adjustmentKind === 'refund' || transaction.adjustmentKind === 'reversal';`,
    `    const isRefundOrReversal = isTransactionRefundLike(transaction);`,
    'predicate'
  ]
]);

// ---- 5. TransactionTable.tsx ----
patch('src/features/transactions/components/TransactionTable.tsx', [
  [
    `      if (item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal') {`,
    `      if (isTransactionRefundLike(item)) {`,
    'predicate-539'
  ],
  [
    `                          item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal'
                            ? 'transaction-row-refund-like'`,
    `                          isTransactionRefundLike(item)
                            ? 'transaction-row-refund-like'`,
    'predicate-1058'
  ]
]);

// ---- 6. TransactionsPage.tsx ----
patch('src/pages/transactions/TransactionsPage.tsx', [
  [
    `        item.refundOfTransactionId === selected.id &&
        (item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal')`,
    `        item.refundOfTransactionId === selected.id && isTransactionRefundLike(item)`,
    'predicate-951'
  ],
  [
    `        selected.has(item.refundOfTransactionId as string) &&
        (item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal')`,
    `        selected.has(item.refundOfTransactionId as string) && isTransactionRefundLike(item)`,
    'predicate-1593'
  ]
]);

// ---- 7. useFinanceStore.ts ----
patch('src/shared/store/useFinanceStore.ts', [
  [
    `import { getSignedAmount } from '../lib/transactionMetrics';`,
    `import { getSignedAmount, isTransactionRefundLike } from '../lib/transactionMetrics';`,
    'import'
  ],
  [
    `  if (tx.adjustmentKind === 'refund' || tx.adjustmentKind === 'reversal') {
    return 'transaction-refund';`,
    `  if (isTransactionRefundLike(tx)) {
    return 'transaction-refund';`,
    'predicate-584'
  ],
  [
    `      remark:
        tx.adjustmentKind === 'refund' || tx.adjustmentKind === 'reversal'
          ? tx.refundOfTransactionId`,
    `      remark:
        isTransactionRefundLike(tx)
          ? tx.refundOfTransactionId`,
    'predicate-654'
  ],
  [
    `              item.refundOfTransactionId === id &&
              (item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal')`,
    `              item.refundOfTransactionId === id &&
              isTransactionRefundLike(item)`,
    'predicate-979'
  ],
  [
    `          if (original.adjustmentKind === 'refund' || original.adjustmentKind === 'reversal') {`,
    `          if (isTransactionRefundLike(original)) {`,
    'predicate-1029'
  ]
]);

console.log('\n' + PREDICATE_NOTE);
