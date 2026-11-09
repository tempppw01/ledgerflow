import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import type { AddTransactionAction } from '../../../shared/store/useFinanceStore';
import type { DraftBillEntry } from './workbenchTypes';
import { useAssistantWorkbench } from './useAssistantWorkbench';

const categories: Category[] = [{ id: 'cat-food', name: '餐饮', kind: 'expense' }];
const accounts: Account[] = [
  {
    id: 'acc-cash',
    name: '现金',
    type: 'cash',
    initialBalance: 1000,
    balance: 1000
  }
];
const existingTransaction: TransactionItem = {
  id: 'tx-existing',
  type: 'expense',
  categoryId: 'cat-food',
  accountId: 'acc-cash',
  amount: 100,
  date: '2026-11-01T12:00:00.000Z',
  note: '原账单',
  tags: [],
  source: 'ai',
  status: 'completed',
  updatedAt: '2026-11-01T12:00:00.000Z'
};

function createEntry(overrides: Partial<DraftBillEntry> = {}): DraftBillEntry {
  return {
    id: 'entry-1',
    selected: true,
    type: 'expense',
    amount: 120,
    date: '2026-11-01T12:00:00.000Z',
    note: '午餐',
    category: '餐饮',
    account: '现金',
    tags: ['AI识别'],
    issues: [],
    ...overrides
  };
}

describe('useAssistantWorkbench 批量保存', () => {
  it('将覆盖和新增合并为一次批量写入,成功后移除已保存条目', () => {
    const addTransaction = vi.fn(() => ({
      addedIds: ['tx-new'],
      updatedIds: ['tx-existing']
    }));
    const updateTransaction = vi.fn();
    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: '',
        apiKey: '',
        model: 'test-model',
        categories,
        accounts,
        transactions: [existingTransaction],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: addTransaction as unknown as AddTransactionAction,
        updateTransaction
      })
    );

    act(() => {
      result.current.setEntries([
        createEntry({
          id: 'entry-update',
          amount: 150,
          note: '覆盖原账单',
          duplicateTxId: 'tx-existing',
          duplicateReason: 'content'
        }),
        createEntry({
          id: 'entry-add',
          amount: 25,
          note: '新增账单'
        })
      ]);
    });

    let saved = false;
    act(() => {
      saved = result.current.saveSelected({
        overwriteDuplicateEntryIds: ['entry-update']
      });
    });

    expect(saved).toBe(true);
    expect(addTransaction).toHaveBeenCalledTimes(1);
    expect(addTransaction).toHaveBeenCalledWith([
      {
        operation: 'update',
        id: 'tx-existing',
        payload: expect.objectContaining({
          amount: 150,
          note: '覆盖原账单',
          categoryId: 'cat-food',
          accountId: 'acc-cash'
        })
      },
      {
        operation: 'add',
        payload: expect.objectContaining({
          amount: 25,
          note: '新增账单',
          categoryId: 'cat-food',
          accountId: 'acc-cash'
        })
      }
    ]);
    expect(updateTransaction).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(0);
  });

  it('批量写入失败时不清除任何待确认条目,也不报告部分成功', () => {
    const addTransaction = vi.fn(() => {
      throw new Error('模拟批量写入失败');
    });
    const updateTransaction = vi.fn();
    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: '',
        apiKey: '',
        model: 'test-model',
        categories,
        accounts,
        transactions: [existingTransaction],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: addTransaction as unknown as AddTransactionAction,
        updateTransaction
      })
    );

    act(() => {
      result.current.setEntries([
        createEntry({
          id: 'entry-update',
          duplicateTxId: 'tx-existing',
          duplicateReason: 'content'
        }),
        createEntry({
          id: 'entry-add',
          amount: 25,
          note: '新增账单'
        })
      ]);
    });

    let saved = true;
    act(() => {
      saved = result.current.saveSelected({
        overwriteDuplicateEntryIds: ['entry-update']
      });
    });

    expect(saved).toBe(false);
    expect(addTransaction).toHaveBeenCalledTimes(1);
    expect(updateTransaction).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.toast).toMatchObject({
      visible: true,
      variant: 'error',
      message: '模拟批量写入失败'
    });
    expect(result.current.toast.message).not.toContain('已保存');
  });
});
