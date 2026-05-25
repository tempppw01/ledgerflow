import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoriesAccountsPage } from './CategoriesAccountsPage';
import { ALIPAY_LOGO_URL } from '../../shared/config/brandAssets';

const financeStoreMock = {
  state: {
    categories: [],
    accounts: [
      {
        id: 'acc-alipay',
        name: '支付宝',
        type: 'virtual',
        initialBalance: 630.73,
        balance: 630.73,
        sortOrder: 1
      },
      {
        id: 'acc-bank',
        name: '邮政银行卡',
        type: 'debit',
        initialBalance: 3756.59,
        balance: 3756.59,
        sortOrder: 2
      }
    ],
    transactions: [],
    addCategory: vi.fn(),
    reorderCategories: vi.fn(),
    removeCategory: vi.fn(),
    addAccount: vi.fn(),
    addTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    updateAccountBalance: vi.fn(),
    reorderAccounts: vi.fn(),
    removeAccount: vi.fn()
  }
};

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

describe('CategoriesAccountsPage', () => {
  beforeEach(() => {
    financeStoreMock.state.updateAccountBalance.mockClear();
  });

  it('uses the top-right balance as the only balance edit entry', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    await screen.findByRole(
      'button',
      { name: 'account-balance-display-acc-alipay' },
      { timeout: 10000 }
    );

    expect(screen.getAllByText('¥630.73')).toHaveLength(1);
    expect(document.querySelector('.account-card-brand-icon')).toHaveAttribute('src', ALIPAY_LOGO_URL);

    await user.dblClick(screen.getByRole('button', { name: 'account-balance-display-acc-alipay' }));

    expect(
      screen.getByRole('spinbutton', { name: 'account-balance-editor-acc-alipay' })
    ).toHaveValue(630.73);
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });
});
