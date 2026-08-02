import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTransactionDraft,
  clearQuickTransactionDraft,
  readTransactionDraft,
  readQuickTransactionDraft,
  quickTransactionDraftStorageKey,
  transactionDraftStorageKey,
  writeQuickTransactionDraft,
  writeTransactionDraft,
  type QuickTransactionDraft,
  type TransactionDraft
} from './transactionDraft';

const draft: TransactionDraft = {
  type: 'expense',
  categoryId: 'food',
  accountId: 'cash',
  amount: '88.5',
  date: '2026-08-02T12:30',
  note: '午餐',
  tags: '餐饮',
  orderNo: '',
  merchantOrderNo: '',
  status: 'completed',
  calculatorExpression: '88.5'
};

const quickDraft: QuickTransactionDraft = {
  type: 'expense',
  categoryId: 'food',
  accountId: 'cash',
  expression: '88+8',
  date: '2026-08-02',
  note: '午餐'
};

describe('transaction draft persistence', () => {
  beforeEach(() => localStorage.clear());

  it('stores and restores drafts per ledger account', () => {
    writeTransactionDraft('ledger-a', draft);

    expect(localStorage.getItem(transactionDraftStorageKey('ledger-a'))).toBeTruthy();
    expect(readTransactionDraft('ledger-a')).toEqual(draft);
    expect(readTransactionDraft('ledger-b')).toBeNull();
  });

  it('ignores malformed drafts and clears saved content', () => {
    localStorage.setItem(transactionDraftStorageKey('ledger-a'), '{bad json');
    expect(readTransactionDraft('ledger-a')).toBeNull();

    writeTransactionDraft('ledger-a', draft);
    clearTransactionDraft('ledger-a');
    expect(readTransactionDraft('ledger-a')).toBeNull();
  });

  it('keeps quick-entry drafts separate from complete transaction drafts', () => {
    writeQuickTransactionDraft('ledger-a', quickDraft);

    expect(readQuickTransactionDraft('ledger-a')).toEqual(quickDraft);
    expect(readTransactionDraft('ledger-a')).toBeNull();

    clearQuickTransactionDraft('ledger-a');
    expect(localStorage.getItem(quickTransactionDraftStorageKey('ledger-a'))).toBeNull();
  });
});
