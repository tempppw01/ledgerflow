import { describe, expect, it } from 'vitest';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import type { TransactionItem } from '../../entities/transaction/types';
import {
  createFinanceBackupPayload,
  verifyFinanceBackupRestore,
  type FinanceBackupScope
} from './backup';

/**
 * 恢复自检:比对「备份里写了多少条」与「真正落到状态里的有多少条」。
 *
 * 这一版修的两个 bug 都是「导入显示成功、数据其实不全」——JSON 备份里没有负债、
 * 没有偏好与计划,界面上毫无异常。自检就是为了让这类问题**立刻可见**。
 */
const transaction: TransactionItem = {
  id: 'tx-1',
  type: 'expense',
  categoryId: 'cat-1',
  accountId: 'acc-1',
  amount: 10,
  date: '2026-11-01T00:00:00.000Z',
  note: '午饭',
  tags: [],
  source: 'manual',
  status: 'completed'
} as TransactionItem;

const debt = { id: 'debt-1', name: '信用卡', type: 'credit-card', balance: 100, status: 'active' } as DebtItem;
const repayment = { id: 'rep-1', debtId: 'debt-1', amount: 50, paidAt: '2026-11-01T00:00:00.000Z' } as RepaymentRecord;

const fullScope: FinanceBackupScope = {
  ledger: true,
  subscriptions: true,
  globalMemories: true,
  investments: true,
  debts: true,
  preferences: true
};

function payloadWith(data: Record<string, unknown>) {
  return createFinanceBackupPayload(
    {
      transactions: [],
      categories: [],
      accounts: [],
      subscriptions: [],
      trashedTransactions: [],
      trashedCategories: [],
      trashedAccounts: [],
      balanceChangeEntries: [],
      trashedSubscriptions: [],
      globalMemories: [],
      investmentPositions: [],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: [],
      debts: [],
      repaymentRecords: [],
      ...data
    },
    fullScope
  );
}

describe('verifyFinanceBackupRestore', () => {
  it('条数一致时没有告警', () => {
    const payload = payloadWith({ transactions: [transaction], debts: [debt], repaymentRecords: [repayment] });

    const mismatches = verifyFinanceBackupRestore(payload, {
      finance: {
        transactions: [transaction],
        categories: [],
        accounts: [],
        subscriptions: []
      },
      globalMemories: [],
      debts: [debt],
      repaymentRecords: [repayment]
    });

    expect(mismatches).toEqual([]);
  });

  it('有条目没落库时报出是哪一组、差多少', () => {
    const payload = payloadWith({ transactions: [transaction], debts: [debt], repaymentRecords: [repayment] });

    const mismatches = verifyFinanceBackupRestore(payload, {
      finance: {
        // 交易被判无效丢弃
        transactions: [],
        categories: [],
        accounts: [],
        subscriptions: []
      },
      globalMemories: [],
      debts: [debt],
      repaymentRecords: []
    });

    expect(mismatches).toEqual(
      expect.arrayContaining([
        { group: 'transactions', expected: 1, actual: 0 },
        { group: 'repaymentRecords', expected: 1, actual: 0 }
      ])
    );
    // 负债是对的,不该误报
    expect(mismatches.find((item) => item.group === 'debts')).toBeUndefined();
  });

  it('范围没勾选的组不参与比对', () => {
    const payload = createFinanceBackupPayload(
      {
        transactions: [transaction],
        categories: [],
        accounts: [],
        subscriptions: [],
        trashedTransactions: [],
        trashedCategories: [],
        trashedAccounts: [],
        balanceChangeEntries: [],
        trashedSubscriptions: [],
        globalMemories: [],
        investmentPositions: [],
        investmentPositionHistory: [],
        investmentGoals: [],
        investmentWatchlist: [],
        investmentAiMessages: [],
        debts: [debt],
        repaymentRecords: [repayment]
      },
      { ...fullScope, ledger: false, debts: false }
    );

    const mismatches = verifyFinanceBackupRestore(payload, {
      finance: { transactions: [], categories: [], accounts: [], subscriptions: [] },
      globalMemories: [],
      debts: [],
      repaymentRecords: []
    });

    expect(mismatches).toEqual([]);
  });
});
