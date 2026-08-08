import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { InvestmentChatPanel } from '../../features/assistant/investment-chat/InvestmentChatPanel';
import {
  GLOBE_ICON_URL,
  GLOBE_OFF_ICON_URL,
  INVESTMENT_HERO_ILLUSTRATION_URL
} from '../../shared/config/brandAssets';
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

vi.mock('../../features/assistant/workbench/workbenchUtils', () => ({
  buildTimeContext: vi.fn().mockResolvedValue('当前中国标准时间：2026-07-16 09:30:00（来源：测试）')
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

  it('puts the current time into the investment chat system prompt', async () => {
    sendAiChatStreamMock.mockResolvedValue({ content: '测试回复', reasoning: '' });

    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('基金分析输入框'), {
      target: { value: '请看一下这个基金' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const request = sendAiChatStreamMock.mock.calls[0]?.[0] as { systemPrompt?: string };
    expect(request.systemPrompt).toContain('当前中国标准时间：2026-07-16 09:30:00（来源：测试）');
  });

  it('shows the web status icon for the current network verification state', () => {
    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    const webButton = screen.getByRole('button', { name: '开启联网核验' });
    expect(webButton.querySelector('img')).toHaveAttribute('src', GLOBE_OFF_ICON_URL);

    fireEvent.click(webButton);
    expect(
      screen.getByRole('button', { name: '关闭联网核验' }).querySelector('img')
    ).toHaveAttribute('src', GLOBE_ICON_URL);
  });

  it('collapses reasoning and auxiliary investment details in assistant messages', () => {
    useAppPreferences.setState({
      investmentAiMessages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          text: '建议小额试。',
          reasoning: '模型思考内容',
          webTrace: '联网过程：已开启联网核验',
          auxiliaryInfo: '相关资讯数据：\n测试资讯',
          createdAt: '2026-07-16T09:31:00.000Z'
        }
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentChatPanel showHero={false} />
      </MemoryRouter>
    );

    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(screen.getByText('联网过程')).toBeInTheDocument();
    expect(screen.getByText('相关资讯数据')).toBeInTheDocument();
    expect(screen.getByText('模型推理摘要')).toBeInTheDocument();
    expect(screen.getByText('检索与核验状态')).toBeInTheDocument();
    expect(screen.getByText('新闻、政策与市场上下文')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回页面顶部' })).toBeInTheDocument();
  });

  it('hides structured JSON left in a persisted investment reply', () => {
    useAppPreferences.setState({
      investmentAiMessages: [
        {
          id: 'assistant-json',
          role: 'assistant',
          text: [
            '建议继续观察，不要一次性重仓。',
            '```json',
            JSON.stringify({
              fundName: '测试基金',
              fundCode: '161723',
              verdict: '继续观察',
              summary: '等待实时数据恢复后再判断。',
              riskLevel: 'medium',
              highlights: [],
              risks: [],
              actions: []
            })
          ].join('\n'),
          createdAt: '2026-07-16T09:31:00.000Z'
        }
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentChatPanel showHero={false} />
      </MemoryRouter>
    );

    expect(screen.getByText('建议继续观察，不要一次性重仓。')).toBeInTheDocument();
    expect(screen.queryByText(/"fundName"/)).not.toBeInTheDocument();
    expect(screen.queryByText('```json')).not.toBeInTheDocument();
  });

  it('shows an illustration before the first investment chat message', () => {
    const { container } = render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    const emptyIllustration = container.querySelector<HTMLImageElement>(
      '.investments-ai-empty img'
    );

    expect(screen.getByText('先丢一个基金问题给我')).toBeInTheDocument();
    expect(emptyIllustration?.src).toBe(INVESTMENT_HERO_ILLUSTRATION_URL);
  });

  it('centers the compact empty state and shows a prompt', () => {
    const { container } = render(
      <MemoryRouter>
        <InvestmentChatPanel showHero={false} />
      </MemoryRouter>
    );

    expect(screen.getByText('先丢一个基金问题给我')).toBeInTheDocument();
    expect(screen.getByText('例如：这只基金现在适合继续定投吗？')).toBeInTheDocument();
    expect(container.querySelector('.chat-investment-panel')).toHaveClass('is-empty');
    expect(container.querySelector('.investments-ai-empty-compact img')?.getAttribute('src')).toBe(
      INVESTMENT_HERO_ILLUSTRATION_URL
    );
  });

  it('collapses the floating investment chat into a question mark launcher', () => {
    const { container } = render(
      <MemoryRouter>
        <InvestmentChatPanel showHero={false} floating />
      </MemoryRouter>
    );

    const launcher = screen.getByRole('button', { name: '打开快捷问答' });
    expect(launcher).toBeInTheDocument();
    expect(container.querySelector('.chat-investment-panel')).toHaveClass('is-floating-hidden');

    fireEvent.click(launcher);

    expect(screen.getByText('快捷问答')).toBeInTheDocument();
    expect(screen.getByLabelText('基金分析输入框')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开快捷问答' })).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.getByRole('button', { name: '打开快捷问答' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开快捷问答' }));
    const pinButton = screen.getByRole('button', { name: '置顶快捷问答' });
    fireEvent.click(pinButton);
    expect(pinButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerDown(document.body);

    expect(screen.getByText('快捷问答')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开快捷问答' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起快捷问答' }));

    expect(screen.getByRole('button', { name: '打开快捷问答' })).toBeInTheDocument();
    expect(container.querySelector('.chat-investment-panel')).toHaveClass('is-floating-hidden');
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

  it('keeps the composer compact until the input is focused', () => {
    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('基金分析输入框');
    const composer = input.closest('form');

    expect(composer).toHaveClass('is-compact');
    fireEvent.focus(input);
    expect(composer).toHaveClass('is-expanded');
    fireEvent.blur(input);
    expect(composer).toHaveClass('is-compact');
  });

  it('scrolls the newly sent message into view and collapses the composer', async () => {
    sendAiChatStreamMock.mockReturnValue(new Promise(() => undefined));
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('基金分析输入框');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '分析当前持仓' } });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });
    expect(input.closest('form')).toHaveClass('is-compact');
    expect(input.closest('.chat-investment-panel')).toHaveClass('has-active-turn');

    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('provides direct navigation for long investment chat histories', () => {
    useAppPreferences.setState({
      investmentAiMessages: [
        { id: 'user-1', role: 'user', text: '第一轮问题', createdAt: '2026-07-16T09:00:00.000Z' },
        {
          id: 'assistant-1',
          role: 'assistant',
          text: '第一轮回复',
          createdAt: '2026-07-16T09:01:00.000Z'
        },
        { id: 'user-2', role: 'user', text: '第二轮问题', createdAt: '2026-07-16T09:02:00.000Z' },
        {
          id: 'assistant-2',
          role: 'assistant',
          text: '第二轮回复',
          createdAt: '2026-07-16T09:03:00.000Z'
        },
        { id: 'user-3', role: 'user', text: '第三轮问题', createdAt: '2026-07-16T09:04:00.000Z' },
        {
          id: 'assistant-3',
          role: 'assistant',
          text: '第三轮回复',
          createdAt: '2026-07-16T09:05:00.000Z'
        }
      ]
    });
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <MemoryRouter>
        <InvestmentChatPanel showHero={false} />
      </MemoryRouter>
    );

    const historySelect = screen.getByLabelText('跳转到历史提问');
    expect(historySelect).toHaveValue('user-3');
    fireEvent.change(historySelect, { target: { value: 'user-1' } });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'end' });

    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('clears persisted investment chat context from the message area', () => {
    useAppPreferences.setState({
      investmentAiMessages: [
        { id: 'user-1', role: 'user', text: '第一轮问题', createdAt: '2026-07-16T09:00:00.000Z' },
        {
          id: 'assistant-1',
          role: 'assistant',
          text: '第一轮回答',
          createdAt: '2026-07-16T09:01:00.000Z'
        }
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentChatPanel showHero={false} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '清空上下文' }));

    expect(screen.getByRole('dialog', { name: '清空聊天上下文' })).toBeInTheDocument();
    expect(useAppPreferences.getState().investmentAiMessages).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    expect(useAppPreferences.getState().investmentAiMessages).toEqual([]);
    expect(screen.queryByText('第一轮问题')).not.toBeInTheDocument();
  });

  it('shows a progress stage while the investment answer is being generated', async () => {
    sendAiChatStreamMock.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter>
        <InvestmentChatPanel />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('基金分析输入框'), {
      target: { value: '分析当前市场风格' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('正在思考投资结论'));
  });

  it('can stop a streaming investment analysis request', async () => {
    let abortSignal: AbortSignal | null = null;
    sendAiChatStreamMock.mockImplementation(
      async (input: { signal?: AbortSignal }, handlers: { onDelta: (delta: string) => void }) => {
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
    await waitFor(() => expect(abortSignal).not.toBeNull());

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
