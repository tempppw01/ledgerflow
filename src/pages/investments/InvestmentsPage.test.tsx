import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
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

const eastmoneyClientMock = vi.hoisted(() => ({
  fetchEastmoneyFundSnapshot: vi.fn()
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

vi.mock('../../features/investments/api/eastmoneyFundClient', () => ({
  fetchEastmoneyFundSnapshot: eastmoneyClientMock.fetchEastmoneyFundSnapshot
}));

describe('InvestmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      investmentWatchlist: [],
      investmentPositionHistory: [],
      investmentGoals: []
    });
  });

  it('应展示持仓汇总和风险提醒', () => {
    const { container } = render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('button', { name: '投资风向' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('沪深 300 ETF').length).toBeGreaterThan(0);
    expect(screen.getByText('持仓流水')).toBeInTheDocument();
    expect(screen.getByText(/历史快照/)).toBeInTheDocument();
    expect(screen.getByText('单一持仓占比偏高')).toBeInTheDocument();
    expect(screen.getAllByText('¥1.09万').length).toBeGreaterThan(0);

    expect(screen.queryByText('6 个月应急金')).not.toBeInTheDocument();
    expect(screen.getByText('基金自选')).toBeInTheDocument();
    expect(screen.queryByLabelText('基金分析输入框')).not.toBeInTheDocument();
    expect(container.querySelector('.investments-management-grid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '顺手下一步' })).toBeInTheDocument();
    expect(container.querySelector('.investments-actions-card')).not.toBeInTheDocument();

  });

  it('可以通过东方财富基金代码添加自选基金资料', async () => {
    eastmoneyClientMock.fetchEastmoneyFundSnapshot.mockResolvedValue({
      code: '161725',
      name: '招商中证白酒指数(LOF)A',
      netValue: '0.5162',
      netValueDate: '2026-06-25',
      estimatedValue: '0.5002',
      estimatedChangePercent: '-3.10',
      estimatedAt: '2026-06-26 15:00',
      buyFeeRate: '0.10%',
      sourceFeeRate: '1.00%',
      performanceHistory: ['近 1 月 -5.21%'],
      fundAnalysis: ['单位净值 0.5162（2026-06-25）'],
      fundHoldings: ['贵州茅台 8.4%', '五粮液 6.2%'],
      assetAllocation: ['股票 94%', '现金 6%']
    });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText('添加基金代码'), '161725');
    await userEvent.click(screen.getByRole('button', { name: /获取资料/ }));

    await waitFor(() => {
      expect(eastmoneyClientMock.fetchEastmoneyFundSnapshot).toHaveBeenCalledWith('161725');
    });

    expect(await screen.findByText('招商中证白酒指数(LOF)A')).toBeInTheDocument();
    expect(screen.getByText(/单位净值 0\.5162/)).toBeInTheDocument();
    expect(screen.getByText(/估算涨跌 -3\.10%/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加关注' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '获取更新' })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText('招商中证白酒指数(LOF)A'));
    await userEvent.click(screen.getByRole('menuitem', { name: /添加到持仓/ }));

    expect(screen.getByText('招商中证白酒指数(LOF)A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('招商中证白酒指数(LOF)A')).toBeInTheDocument();

    const watchItem = useAppPreferences.getState().investmentWatchlist[0];
    expect(watchItem).toMatchObject({
      code: '161725',
      platform: '东方财富',
      buyFeeRate: '0.10%',
      addedReturn: '-3.10%',
      netValue: '0.5162'
    });
  });
});
