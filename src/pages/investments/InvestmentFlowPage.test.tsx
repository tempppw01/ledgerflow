import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { InvestmentFlowPage } from './InvestmentFlowPage';

type FinanceStoreState = {
  accounts: Account[];
  transactions: TransactionItem[];
};

const financeStoreMock = vi.hoisted(() => ({
  state: {
    accounts: [],
    transactions: []
  } as FinanceStoreState
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

describe('InvestmentFlowPage', () => {
  beforeEach(() => {
    financeStoreMock.state = {
      accounts: [],
      transactions: []
    };

    useAppPreferences.setState({
      monthlyIncome: 0,
      debts: [],
      investmentPositions: [],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: []
    });
  });

  it('渲染投资风向摘要和空状态', () => {
    render(
      <MemoryRouter>
        <InvestmentFlowPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: '基金自选与详细流水' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回投资页' })).toBeInTheDocument();
    expect(screen.getByText('还没有自选基金')).toBeInTheDocument();
    expect(screen.getByText('还没有持仓流水')).toBeInTheDocument();
    expect(screen.getByText('还没有 AI 复盘记录')).toBeInTheDocument();
  });
});
