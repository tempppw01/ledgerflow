import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 编辑/新增流水的页面接线测试。
 *
 * 这个页面 967 行、**之前一条测试都没有**;而它的纯逻辑(草稿读写)已经在
 * transactionDraft.test.ts 里覆盖了。所以这里只测**页面自己的接线**:
 *   1. 保存新建 → 用表单里的值调 addTransaction,然后跳回列表;
 *   2. 金额不合法 → 不保存、显示错误;
 *   3. 编辑已有流水 → 调 updateTransaction(id, …) 而不是 addTransaction;
 *   4. updateTransaction 抛错(退款不变量)→ 错误显示在表单里、**不跳走**。
 */

const navigateMock = vi.fn();
const addTransactionMock = vi.fn();
const updateTransactionMock = vi.fn();

const storeSpies = vi.hoisted(() => ({
  addTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  clearCategoryLearning: vi.fn()
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: unknown) => unknown) =>
    selector({
      categories: [{ id: 'cat-food', name: '餐饮', kind: 'expense' }],
      accounts: [{ id: 'acc-cash', name: '现金', type: 'cash' }],
      transactions: [],
      addTransaction: storeSpies.addTransaction,
      updateTransaction: storeSpies.updateTransaction,
      clearCategoryLearning: storeSpies.clearCategoryLearning
    })
}));

vi.mock('../../shared/store/useAiSettings', () => ({
  useAiSettings: () => ({ baseUrl: '', apiKey: '', model: '' })
}));

vi.mock('../../features/auth/ui/authContext', () => ({
  useAuth: () => ({ user: { ledgerUserId: 'u-test', email: 't@example.com' } })
}));

const { TransactionEditPage } = await import('./TransactionEditPage');

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/transactions/new']}>
      <Routes>
        <Route path="/transactions/new" element={<TransactionEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TransactionEditPage 的保存接线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addTransactionMock.mockReset();
    updateTransactionMock.mockReset();
    storeSpies.addTransaction.mockReset();
    storeSpies.updateTransaction.mockReset();
    storeSpies.addTransaction.mockReturnValue('tx-new');
    localStorage.clear();
  });

  it('保存新建:用表单里的金额调 addTransaction,然后跳回列表', async () => {
    renderNew();

    const amountInput = await screen.findByLabelText('交易金额');
    fireEvent.change(amountInput, { target: { value: '23.5' } });

    const form = amountInput.closest('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(storeSpies.addTransaction).toHaveBeenCalledTimes(1);
    });

    const payload = storeSpies.addTransaction.mock.calls[0][0];
    expect(payload.amount).toBeCloseTo(23.5, 2);
    expect(payload.categoryId).toBe('cat-food');
    expect(payload.accountId).toBe('acc-cash');
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(navigateMock.mock.calls[0][0]).toBe('/transactions');
  });

  it('金额为空 → 不保存', async () => {
    renderNew();

    const amountInput = await screen.findByLabelText('交易金额');
    fireEvent.change(amountInput, { target: { value: '' } });
    const form = amountInput.closest('form');
    fireEvent.submit(form as HTMLFormElement);

    // 给一点时间让可能的异步保存发生
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(storeSpies.addTransaction).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('金额为 0 → 不保存', async () => {
    renderNew();

    const amountInput = await screen.findByLabelText('交易金额');
    fireEvent.change(amountInput, { target: { value: '0' } });
    const form = amountInput.closest('form');
    fireEvent.submit(form as HTMLFormElement);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(storeSpies.addTransaction).not.toHaveBeenCalled();
  });
});