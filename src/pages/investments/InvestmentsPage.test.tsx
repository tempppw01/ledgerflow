import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { InvestmentsPage } from './InvestmentsPage';

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

describe('InvestmentsPage', () => {
  beforeEach(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();

    financeStoreMock.state = {
      accounts: [
        {
          id: 'acc-savings',
          name: '招商储蓄卡',
          type: 'savings',
          balance: 25000,
          initialBalance: 12000,
          sortOrder: 1
        }
      ],
      transactions: [
        {
          id: 'tx-income-1',
          date: `${year}-${month}-08T10:00:00.000Z`,
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-savings',
          amount: 12000,
          note: '工资',
          tags: []
        },
        {
          id: 'tx-expense-1',
          date: `${year}-${month}-15T10:00:00.000Z`,
          type: 'expense',
          categoryId: 'cat-living',
          accountId: 'acc-savings',
          amount: 5200,
          note: '生活支出',
          tags: []
        }
      ]
    };

    useAppPreferences.setState({
      monthlyIncome: 12000,
      debts: [],
      investmentPositions: [
        {
          id: 'pos-1',
          name: '沪深 300 ETF',
          category: 'index-fund',
          platform: '支付宝',
          investedAmount: 10000,
          currentValue: 10880,
          monthlyContribution: 1200,
          targetAllocation: 40,
          riskLevel: 'medium',
          note: '长期底仓',
          isActive: true,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z'
        }
      ],
      investmentGoals: [
        {
          id: 'goal-1',
          name: '6 个月应急金',
          kind: 'emergency',
          targetAmount: 30000,
          currentAmount: 12000,
          monthlyContribution: 2000,
          targetDate: '2026-12-31',
          priority: 'high',
          note: '优先补足',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z'
        }
      ]
    });
  });

  it('应展示持仓汇总、目标和风险提醒', () => {
    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: '看清你的投资节奏和目标进度' })).toBeInTheDocument();
    expect(screen.getByText('先从常用资产开始')).toBeInTheDocument();
    expect(screen.getByText('沪深 300 ETF')).toBeInTheDocument();
    expect(screen.getByText('6 个月应急金')).toBeInTheDocument();
    expect(screen.getByText('单一持仓占比偏高')).toBeInTheDocument();
    expect(screen.getAllByText('¥1.09万').length).toBeGreaterThan(0);
  });
});
