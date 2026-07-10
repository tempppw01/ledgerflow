import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { InvestmentChatPanel } from '../../features/assistant/investment-chat/InvestmentChatPanel';
import { INVESTMENT_HERO_ILLUSTRATION_URL } from '../../shared/config/brandAssets';
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

const navigateMock = vi.hoisted(() => vi.fn());
const sendAiChatStreamMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  sendAiChatStream: (...args: unknown[]) => sendAiChatStreamMock(...args)
}));

describe('Investment assistant chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockReset();
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
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: [],
      debts: [],
      monthlyIncome: 12000
    });

    useAiSettings.setState({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.4',
      webSearch: {
        tavilyApiKey: '',
        tavilyBaseUrl: '',
        localEndpoint: '',
        provider: 'tavily',
        maxResults: 5
      }
    });
  });

  it('shows an illustration before the first investment chat message', () => {
    const { container } = render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    const emptyIllustration = container.querySelector<HTMLImageElement>('.investments-ai-empty img');

    expect(screen.getByText('先丢一个基金问题给我')).toBeInTheDocument();
    expect(emptyIllustration?.src).toBe(INVESTMENT_HERO_ILLUSTRATION_URL);
  });

  it('clears the composer immediately after sending a typed question', async () => {
    sendAiChatStreamMock.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('基金分析输入框');
    fireEvent.change(input, { target: { value: '美国' } });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    expect(input).toHaveValue('');
    expect(screen.getByText('美国')).toBeInTheDocument();
  });

  it('can stop a streaming investment analysis request', async () => {
    let abortSignal: AbortSignal | null = null;
    sendAiChatStreamMock.mockImplementation(
      async (
        input: { signal?: AbortSignal },
        handlers: { onDelta: (delta: string) => void }
      ) => {
        abortSignal = input.signal ?? null;
        return new Promise((_, reject) => {
          input.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
          handlers.onDelta('模型思考中');
        });
      }
    );

    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('基金分析输入框'), {
      target: { value: '美国' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    expect(await screen.findByRole('button', { name: '停止生成' })).toBeInTheDocument();
    expect(abortSignal).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '开始分析' })).toBeInTheDocument();
    });
  });

  it('sends attached screenshots with the investment prompt', async () => {
    sendAiChatStreamMock.mockResolvedValue({ content: '先观察。', reasoning: '' });
    const imageFile = new File(['fund-image'], 'fund.png', { type: 'image/png' });
    const originalFileReader = window.FileReader;

    class MockFileReader {
      result: string | ArrayBuffer | null = 'data:image/png;base64,ZmFrZQ==';
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      readAsDataURL() {
        this.onload?.();
      }
    }

    Object.defineProperty(window, 'FileReader', {
      writable: true,
      value: MockFileReader
    });

    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    fireEvent.change(screen.getAllByLabelText('上传基金截图')[0]!, {
      target: { files: [imageFile] }
    });
    await screen.findByLabelText('待分析图片');
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const request = sendAiChatStreamMock.mock.calls[0]?.[0] as {
      messages: Array<{ text: string; imageDataUrls?: string[] }>;
    };
    expect(request.messages.at(-1)?.text).toBe('请基于这些基金或持仓截图做投资分析。');
    expect(request.messages.at(-1)?.imageDataUrls).toEqual(['data:image/png;base64,ZmFrZQ==']);

    Object.defineProperty(window, 'FileReader', {
      writable: true,
      value: originalFileReader
    });
  });

  it('adds a watchlist card to focus follow status', () => {
    useAppPreferences.setState({
      investmentWatchlist: [
        {
          id: 'watch-1',
          name: '招商优质成长混合(LOF)',
          code: '161706',
          platform: '蚂蚁基金',
          tags: ['高波动'],
          fundHoldings: ['紫金矿业 6.2%', '宁德时代 4.8%'],
          assetAllocation: ['股票 93%', '现金 5%'],
          netValue: '4.1708',
          addedReturn: '+1.25%',
          createdAt: '2026-05-28T01:47:00.000Z',
          updatedAt: '2026-05-28T01:47:00.000Z'
        }
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '添加关注' }));

    expect(useAppPreferences.getState().investmentWatchlist[0]?.tags).toContain('关注中');
    expect(useAppPreferences.getState().investmentWatchlist[0]?.investmentAdvice).toContain(
      '先加入关注列表'
    );
  });

  it('shows a settings hint when the AI key is missing', async () => {
    useAiSettings.setState({ apiKey: '' });

    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('基金分析输入框'), {
      target: { value: '看看这个基金' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    expect(await screen.findByText('请先在设置中配置可用的 AI Key。')).toBeInTheDocument();
    expect(sendAiChatStreamMock).not.toHaveBeenCalled();
  });
});
