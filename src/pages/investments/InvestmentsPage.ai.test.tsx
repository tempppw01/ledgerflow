import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import {
  BOT_ICON_URL,
  INVESTMENT_HERO_ILLUSTRATION_URL,
  USER_ICON_URL
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
      investmentPositionHistory: [],
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

  it('shows an illustration before the first investment chat message', () => {
    const { container } = render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    const emptyIllustration = container.querySelector<HTMLImageElement>(
      '.investments-ai-empty img'
    );

    expect(screen.getByText('先丢一个基金问题给我')).toBeInTheDocument();
    expect(emptyIllustration?.src).toBe(INVESTMENT_HERO_ILLUSTRATION_URL);
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
        performanceHistory: ['近一年波动中等', '近三年跟随沪深300走势'],
        fundAnalysis: ['被动跟踪宽基指数，适合做底仓观察'],
        fundHoldings: ['贵州茅台 5.2%', '宁德时代 3.1%'],
        assetAllocation: ['股票 94%', '现金 6%'],
        industryAllocation: ['金融 18%', '消费 15%'],
        buyFeeRate: '0.12%',
        fundCompany: '易方达基金',
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
    expect(useAppPreferences.getState().investmentWatchlist[0].investmentAdvice).toBe(
      '先观察回撤区间'
    );
    expect(useAppPreferences.getState().investmentWatchlist[0].riskNotes).toEqual(['短期波动仍在']);
    expect(useAppPreferences.getState().investmentWatchlist[0].fundCompany).toBe('易方达基金');
    expect(useAppPreferences.getState().investmentWatchlist[0].buyFeeRate).toBe('0.12%');
    expect(useAppPreferences.getState().investmentWatchlist[0].fundHoldings).toEqual([
      '贵州茅台 5.2%',
      '宁德时代 3.1%'
    ]);
    expect(screen.getByText('更新自选')).toBeInTheDocument();
    expect(screen.getAllByText('易方达沪深300ETF').length).toBeGreaterThan(0);

    const watchCard =
      screen
        .getAllByText('易方达沪深300ETF')
        .find((element) => element.closest('.investments-watch-card'))
        ?.closest('.investments-watch-card') ?? null;
    expect(watchCard).not.toBeNull();
    expect(within(watchCard as HTMLElement).queryByText('基金公司')).not.toBeInTheDocument();
    fireEvent.click(watchCard!);
    expect(within(watchCard as HTMLElement).getByText('基金公司')).toBeInTheDocument();
    expect(within(watchCard as HTMLElement).getByText('易方达基金')).toBeInTheDocument();
  });

  it('passes fund watchlist details into the AI prompt and renders OSS message icons', async () => {
    useAppPreferences.setState({
      investmentWatchlist: [
        {
          id: 'watch-1',
          name: '招商优质成长混合(LOF)',
          code: '161706',
          platform: '蚂蚁基金',
          tags: ['资源科技持仓', '高波动'],
          note: '适合高风险承受能力者继续观察',
          lastVerdict: '资料支撑仓',
          lastSummary: '基金成立超20年，经理任期回报优异，但高持股集中度会放大波动。',
          lastRiskLevel: 'high',
          investmentAdvice: '暂时观察，不主动加仓',
          adviceReasons: ['经理任期回报优异'],
          riskNotes: ['高持股集中度会放大波动'],
          nextActions: ['等待季度持仓更新后复盘'],
          performanceHistory: ['近五年回撤偏大'],
          fundAnalysis: ['成长风格明显，适合高风险用户观察'],
          fundHoldings: ['资源股占比较高'],
          assetAllocation: ['股票 88%', '现金 12%'],
          industryAllocation: ['有色金属 22%', '电子 16%'],
          buyFeeRate: '0.15%',
          fundCompany: '招商基金',
          lastAnalysisAt: '2026-05-28T01:47:00.000Z',
          createdAt: '2026-05-28T01:47:00.000Z',
          updatedAt: '2026-05-28T01:47:00.000Z'
        }
      ]
    });

    sendAiChatStreamMock.mockResolvedValue({
      content: [
        '参考自选记录后，暂时更适合继续观察。',
        '```json',
        JSON.stringify({
          fundName: '招商优质成长混合(LOF)',
          fundCode: '161706',
          verdict: '继续观察',
          summary: '结合自选里的高波动记录，本次不建议贸然加仓。',
          riskLevel: 'high',
          highlights: ['已有历史观察记录'],
          risks: ['高波动'],
          actions: ['继续跟踪'],
          watchTags: ['高波动'],
          performanceHistory: ['历史波动较高'],
          fundAnalysis: ['更适合观察，不适合追涨'],
          fundHoldings: ['资源股占比较高'],
          assetAllocation: ['股票 88%'],
          industryAllocation: ['有色金属 22%'],
          buyFeeRate: '0.15%',
          fundCompany: '招商基金',
          platform: '蚂蚁基金',
          note: '参考自选历史判断'
        }),
        '```'
      ].join('\n'),
      reasoning: ''
    });

    const { container } = render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('基金分析输入框'), {
      target: { value: '结合自选记录看看招商优质成长还值得关注吗？' }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const request = sendAiChatStreamMock.mock.calls[0]?.[0] as { systemPrompt: string };

    expect(request.systemPrompt).toContain('招商优质成长混合(LOF)');
    expect(request.systemPrompt).toContain('资料支撑仓');
    expect(request.systemPrompt).toContain('基金成立超20年');
    expect(request.systemPrompt).toContain('暂时观察，不主动加仓');
    expect(request.systemPrompt).toContain('等待季度持仓更新后复盘');
    expect(request.systemPrompt).toContain('高波动');
    expect(request.systemPrompt).toContain('招商基金');
    expect(request.systemPrompt).toContain('有色金属 22%');

    await screen.findByText('结合自选里的高波动记录，本次不建议贸然加仓。');
    const avatarSources = Array.from(
      container.querySelectorAll<HTMLImageElement>('.investments-ai-message-avatar img')
    ).map((img) => img.src);

    expect(avatarSources).toContain(BOT_ICON_URL);
    expect(avatarSources).toContain(USER_ICON_URL);
  });

  it('deduplicates persisted assistant text that repeats the structured analysis summary', () => {
    useAppPreferences.setState({
      investmentAiMessages: [
        {
          id: 'assistant-duplicate',
          role: 'assistant',
          text: ['Hold for now', 'Use staged entries instead of buying all at once.'].join('\n'),
          createdAt: '2026-05-29T01:47:00.000Z',
          analysis: {
            fundName: 'Alpha Growth Fund',
            fundCode: '161706',
            verdict: 'Hold for now',
            summary: 'Use staged entries instead of buying all at once.',
            riskLevel: 'medium',
            highlights: ['Broad exposure'],
            risks: ['Short-term volatility'],
            actions: ['Review fees first'],
            watchTags: ['watching']
          }
        }
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText('Use staged entries instead of buying all at once.')).toHaveLength(
      1
    );
  });

  it('submits suggested questions immediately instead of only filling the composer', async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoViewMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock
    });

    sendAiChatStreamMock.mockResolvedValue({
      content: '这只基金和你当前持仓有部分重合，需要控制比例。',
      reasoning: ''
    });

    try {
      render(
        <MemoryRouter>
          <InvestmentsPage />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: '和我的持仓冲突吗？' }));

      await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
      const request = sendAiChatStreamMock.mock.calls[0]?.[0] as {
        messages: Array<{ text?: string }>;
      };
      expect(request.messages[0]?.text).toBe('和我的持仓冲突吗？');
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' });
      expect(screen.getByLabelText('基金分析输入框')).toHaveValue('');
      expect(
        await screen.findByText('这只基金和你当前持仓有部分重合，需要控制比例。')
      ).toBeInTheDocument();
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
  });

  it('reviews and sorts all watchlist funds with AI', async () => {
    useAppPreferences.setState({
      investmentWatchlist: [
        {
          id: 'watch-a',
          name: '南方红利低波50ETF联接A',
          code: '008163',
          platform: '蚂蚁基金',
          tags: ['红利低波'],
          lastVerdict: '可以观察',
          lastSummary: '红利低波风格偏防守。',
          lastRiskLevel: 'medium',
          investmentAdvice: '先观察',
          createdAt: '2026-05-28T01:47:00.000Z',
          updatedAt: '2026-05-28T01:47:00.000Z'
        },
        {
          id: 'watch-b',
          name: '易方达沪深300ETF',
          code: '510310',
          platform: '支付宝',
          tags: ['宽基'],
          lastVerdict: '适合跟踪',
          lastSummary: '宽基底仓属性清晰。',
          lastRiskLevel: 'low',
          investmentAdvice: '小额定投',
          createdAt: '2026-05-28T01:47:00.000Z',
          updatedAt: '2026-05-28T01:47:00.000Z'
        }
      ]
    });

    sendAiChatStreamMock.mockResolvedValue({
      content: [
        '```json',
        JSON.stringify({
          items: [
            {
              id: 'watch-b',
              rank: 1,
              verdict: '优先跟踪',
              summary: '宽基底仓更清晰，适合放在前面复盘。',
              riskLevel: 'low',
              investmentAdvice: '小比例定投',
              adviceReasons: ['宽基分散度更高'],
              riskNotes: ['仍有市场波动'],
              nextActions: ['设置定投上限'],
              watchTags: ['宽基', '优先'],
              performanceHistory: ['近三年跟随沪深300走势'],
              fundAnalysis: ['适合作为底仓观察'],
              fundHoldings: ['沪深300成分股'],
              assetAllocation: ['股票 94%'],
              industryAllocation: ['金融 18%'],
              buyFeeRate: '0.1%',
              fundCompany: '易方达基金'
            },
            {
              id: 'watch-a',
              rank: 2,
              verdict: '继续观察',
              summary: '红利低波偏防守，但短期弹性一般。',
              riskLevel: 'medium',
              investmentAdvice: '先观察不追高',
              adviceReasons: ['防守属性明确'],
              riskNotes: ['可能跑输成长风格'],
              nextActions: ['补充费率和跟踪误差'],
              watchTags: ['红利低波'],
              fundCompany: '南方基金'
            }
          ]
        }),
        '```'
      ].join('\n'),
      reasoning: ''
    });

    const { container } = render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 分析排序' }));

    await waitFor(() => {
      expect(useAppPreferences.getState().investmentWatchlist[0].id).toBe('watch-b');
    });

    const request = sendAiChatStreamMock.mock.calls[0]?.[0] as { systemPrompt: string };
    expect(request.systemPrompt).toContain('watch-a');
    expect(request.systemPrompt).toContain('watch-b');
    expect(useAppPreferences.getState().investmentWatchlist[0].investmentAdvice).toBe('小比例定投');
    expect(useAppPreferences.getState().investmentWatchlist[0].fundCompany).toBe('易方达基金');

    const cards = Array.from(container.querySelectorAll('.investments-watch-card'));
    expect(cards[0]?.textContent).toContain('易方达沪深300ETF');
    expect(cards[0]?.textContent).toContain('基金公司');
    expect(cards[1]?.textContent).toContain('南方红利低波50ETF联接A');
  });

  it('prefills a new position from a watchlist fund context menu', async () => {
    useAppPreferences.setState({
      investmentWatchlist: [
        {
          id: 'watch-position-1',
          name: 'Alpha Growth Fund',
          code: '161706',
          platform: 'Ant Fund',
          tags: ['watching'],
          note: 'Prefer staged entry',
          lastRiskLevel: 'high',
          investmentAdvice: 'Wait for the next pullback before adding',
          nextActions: ['Confirm position size'],
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

    const watchCard = screen.getByText('Alpha Growth Fund').closest('article');
    expect(watchCard).not.toBeNull();

    fireEvent.contextMenu(watchCard!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /添加到持仓/ }));

    expect(screen.getByDisplayValue('Alpha Growth Fund')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ant Fund')).toBeInTheDocument();
    expect(screen.getByText('高级选项')).toBeInTheDocument();
  });

  it('adds pasted fund screenshots and persists them with the chat message', async () => {
    sendAiChatStreamMock.mockResolvedValue({
      content: '先保留截图，再结合基金资料继续分析。',
      reasoning: ''
    });

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

    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const request = sendAiChatStreamMock.mock.calls[0]?.[0] as {
      messages: Array<{ imageDataUrls?: string[] }>;
    };
    expect(request.messages[0]?.imageDataUrls?.[0]).toMatch(/^data:image\/png;base64,/);

    await screen.findByText('先保留截图，再结合基金资料继续分析。');
    const [message] = useAppPreferences.getState().investmentAiMessages;
    expect(message.attachmentImages?.[0]).toMatch(/^data:image\/png;base64,/);
    expect(message.attachmentCount).toBe(1);
    expect(screen.getByAltText('附带图片 1')).toBeInTheDocument();
  });
});
