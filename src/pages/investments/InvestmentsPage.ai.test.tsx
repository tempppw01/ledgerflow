import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useAiSettings } from '../../shared/store/useAiSettings';
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

const sendAiChatStreamMock = vi.hoisted(() => vi.fn());

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  sendAiChatStream: (...args: unknown[]) => sendAiChatStreamMock(...args)
}));

describe('InvestmentsPage AI assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    financeStoreMock.state = {
      accounts: [
        {
          id: 'acc-1',
          name: '招商储蓄卡',
          type: 'savings',
          balance: 28000,
          initialBalance: 12000,
          sortOrder: 1
        }
      ],
      transactions: [
        {
          id: 'tx-income-1',
          date: '2026-05-08T10:00:00.000Z',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-1',
          amount: 12000,
          note: '工资',
          tags: []
        },
        {
          id: 'tx-expense-1',
          date: '2026-05-10T10:00:00.000Z',
          type: 'expense',
          categoryId: 'cat-living',
          accountId: 'acc-1',
          amount: 5000,
          note: '生活支出',
          tags: []
        }
      ]
    };

    useAppPreferences.setState({
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
      ],
      investmentWatchlist: [],
      investmentAiMessages: [],
      debts: [],
      monthlyIncome: 12000
    });

    useAiSettings.setState({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.4'
    });
  });

  it('supports streaming fund analysis and adding result to watchlist', async () => {
    const streamedContent = [
      '先给结论：可以继续跟踪，但别急着一把加仓。\n\n',
      '- 规模和宽基属性相对稳定\n',
      '- 更适合作为长期观察名单的一部分\n\n',
      '```json\n',
      JSON.stringify({
        fundName: '易方达沪深300ETF',
        fundCode: '510310',
        verdict: '可以继续跟踪，但先按节奏观察',
        summary: '适合作为宽基观察标的，短期更适合分批跟踪。',
        riskLevel: 'medium',
        highlights: ['宽基属性清晰', '适合长期关注'],
        risks: ['短期波动仍在'],
        actions: ['先观察回撤区间', '如果要加仓，分批进行'],
        watchTags: ['宽基', '指数'],
        platform: '支付宝',
        note: '适合作为观察清单里的长期标的'
      }),
      '\n```'
    ].join('');

    sendAiChatStreamMock.mockImplementation(
      async (
        _input: unknown,
        handlers: {
          onDelta: (delta: string) => void;
          onReasoningDelta?: (delta: string) => void;
          onDone?: (content: string, reasoning?: string) => void;
        }
      ) => {
        handlers.onReasoningDelta?.('先看规模、风格和用户现有仓位。');
        handlers.onDelta('先给结论：可以继续跟踪，但别急着一把加仓。');
        handlers.onDelta(streamedContent.replace('先给结论：可以继续跟踪，但别急着一把加仓。', ''));
        handlers.onDone?.(streamedContent, '先看规模、风格和用户现有仓位。');
        return {
          content: streamedContent,
          reasoning: '先看规模、风格和用户现有仓位。'
        };
      }
    );

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('基金分析输入框'), {
      target: { value: '这只基金现在适合继续定投吗？' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    const matchedFunds = await screen.findAllByText('易方达沪深300ETF');
    expect(matchedFunds.length).toBeGreaterThan(0);
    expect(screen.getByText('可以继续跟踪，但先按节奏观察')).toBeInTheDocument();
    expect(screen.getByText('短期波动仍在')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '加入自选' })[0]!);

    await waitFor(() => {
      expect(useAppPreferences.getState().investmentWatchlist).toHaveLength(1);
    });
    expect(useAppPreferences.getState().investmentWatchlist[0].code).toBe('510310');
    expect(screen.getByText('更新自选')).toBeInTheDocument();
    expect(screen.getAllByText('易方达沪深300ETF').length).toBeGreaterThan(0);
  });

  it('adds pasted fund screenshots to the pending analysis images', async () => {
    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    const image = new File(['fake-image'], 'fund-screenshot.png', { type: 'image/png' });
    fireEvent.paste(screen.getByLabelText('基金分析输入框'), {
      clipboardData: {
        files: [],
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => image
          }
        ]
      }
    });

    expect(await screen.findByAltText('待分析图片 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled();
  });
});
