import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { BalanceChangeEntry, TransactionItem } from '../../entities/transaction/types';
import { BalanceChangesPage } from './BalanceChangesPage';

type FinanceStoreState = {
  balanceChangeEntries: BalanceChangeEntry[];
  accounts: Account[];
  transactions: TransactionItem[];
};

const financeStoreMock = vi.hoisted(() => ({
  state: {
    balanceChangeEntries: [],
    accounts: [],
    transactions: []
  } as FinanceStoreState
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <BalanceChangesPage />
    </MemoryRouter>
  );
}

describe('BalanceChangesPage', () => {
  beforeEach(() => {
    financeStoreMock.state = {
      balanceChangeEntries: [],
      accounts: [],
      transactions: []
    };
  });

  it('在折叠态只显示摘要，展开后展示余额变化路径', () => {
    financeStoreMock.state = {
      balanceChangeEntries: [
        {
          id: 'balchg-exp-1',
          accountId: 'acc-cash',
          transactionId: 'tx-exp-1',
          type: 'transaction-expense',
          amount: 11,
          beforeBalance: 0,
          afterBalance: -11,
          createdAt: '2026-04-25T13:12:35.000Z',
          note: '夜宵',
          remark: '测试备注'
        }
      ],
      accounts: [
        {
          id: 'acc-cash',
          name: '现金',
          type: 'cash',
          initialBalance: 0,
          balance: -11,
          sortOrder: 1
        }
      ],
      transactions: [
        {
          id: 'tx-exp-1',
          date: '2026-04-25T13:12:35.000Z',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 11,
          note: '快捷记账',
          tags: []
        }
      ]
    };

    renderPage();

    const toggle = screen.getByRole('button', { name: /余额减少/ });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('余额变化路径')).not.toBeInTheDocument();
    expect(screen.getByText('−¥11.00')).toBeInTheDocument();
    expect(screen.queryByText('阅读方式')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('余额变化路径')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('余额变化路径')).not.toBeInTheDocument();
  });
});
