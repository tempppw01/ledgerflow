import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { InvestmentsPage } from './InvestmentsPage';

const financeStoreMock = vi.hoisted(() => ({
  state: {
    accounts: [],
    transactions: []
  }
}));

const sendAiChatStreamMock = vi.hoisted(() => vi.fn());
const marketClientMock = vi.hoisted(() => ({
  fetchEastmoneyMarketBoardsSnapshot: vi.fn(),
  fetchEastmoneyMarketThemeBoardsSnapshot: vi.fn(),
  fetchGlobalMarketSectorBoards: vi.fn(),
  fetchEastmoneyMarketBoardConstituents: vi.fn(),
  fetchEastmoneyMarketBoardTrend: vi.fn(),
  fetchEastmoneyIndexHistory: vi.fn(),
  fetchEastmoneyMarketOverview: vi.fn(),
  fetchEastmoneyMarketNews: vi.fn(),
  fetchEastmoneyStockSearch: vi.fn(),
  fetchGlobalMarketHistory: vi.fn(),
  fetchGlobalMarketOverview: vi.fn(),
  fetchGlobalMarketTrend: vi.fn()
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  fetchAiModels: vi.fn().mockResolvedValue([]),
  sendAiChatStream: (...args: unknown[]) => sendAiChatStreamMock(...args)
}));

vi.mock('../../features/assistant/workbench/workbenchUtils', () => ({
  buildTimeContext: vi.fn().mockResolvedValue('当前中国标准时间:2026-11-10 10:00:00(来源:测试)')
}));

vi.mock('../../features/investments/api/eastmoneyFundClient', () => ({
  fetchEastmoneyFundSnapshot: vi.fn().mockResolvedValue(null),
  fetchEastmoneyHoldingStockQuotes: vi.fn().mockResolvedValue([])
}));

vi.mock('../../features/investments/api/eastmoneyMarketClient', () => ({
  EASTMONEY_MARKET_INDEXES: [
    { secId: '1.000001', code: '000001', name: '上证指数', shortName: '上证' }
  ],
  EASTMONEY_MARKET_NEWS_CATEGORIES: [{ id: 'all-day', label: '7×24', column: '102' }],
  EASTMONEY_MARKET_THEMES: [{ code: 'BK1106', name: '创新药' }],
  GLOBAL_MARKET_INDEXES: [
    { id: 'us-dow', market: '美股', name: '道琼斯', symbol: '^DJI', flag: 'US' }
  ],
  ...marketClientMock
}));

describe('InvestmentsPage market insight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

    financeStoreMock.state = {
      accounts: [],
      transactions: []
    };

    marketClientMock.fetchEastmoneyMarketBoardsSnapshot.mockResolvedValue({
      boards: [],
      meta: { source: '测试板块', updatedAt: '2026-11-10T02:00:00.000Z', freshness: 'live' }
    });
    marketClientMock.fetchEastmoneyMarketThemeBoardsSnapshot.mockResolvedValue({
      boards: [],
      meta: { source: '测试题材', updatedAt: '2026-11-10T02:00:00.000Z', freshness: 'live' }
    });
    marketClientMock.fetchGlobalMarketSectorBoards.mockResolvedValue({
      boards: [],
      meta: { source: '测试全球板块', updatedAt: '2026-11-10T02:00:00.000Z', freshness: 'live' }
    });
    marketClientMock.fetchEastmoneyMarketBoardConstituents.mockResolvedValue([]);
    marketClientMock.fetchEastmoneyMarketBoardTrend.mockResolvedValue([]);
    marketClientMock.fetchEastmoneyIndexHistory.mockResolvedValue([]);
    marketClientMock.fetchEastmoneyMarketNews.mockResolvedValue([]);
    marketClientMock.fetchEastmoneyStockSearch.mockResolvedValue([]);
    marketClientMock.fetchGlobalMarketHistory.mockResolvedValue([]);
    marketClientMock.fetchGlobalMarketTrend.mockResolvedValue([]);
    marketClientMock.fetchGlobalMarketOverview.mockResolvedValue({
      quotes: [],
      updatedAt: '2026-11-10T02:00:00.000Z',
      source: '测试全球行情'
    });
    marketClientMock.fetchEastmoneyMarketOverview.mockResolvedValue({
      selectedSecId: '1.000001',
      updatedAt: '2026-11-10T02:00:00.000Z',
      quotes: [],
      trend: []
    });

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
          note: '',
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
      model: 'gpt-test',
      webSearch: {
        provider: 'tavily',
        credentials: {
          tavily: { apiKey: '', baseUrl: '', engineId: '' },
          brave: { apiKey: '', baseUrl: '', engineId: '' },
          serper: { apiKey: '', baseUrl: '', engineId: '' },
          exa: { apiKey: '', baseUrl: '', engineId: '' },
          google: { apiKey: '', baseUrl: '', engineId: '' }
        },
        localEndpoint: '',
        maxResults: 5
      }
    });
  });

  it('shows a model-specific hint when no AI model is configured', () => {
    useAiSettings.setState({ model: '' });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/请先选择 AI 模型再生成简报/)).toBeInTheDocument();
    expect(sendAiChatStreamMock).not.toHaveBeenCalled();
  });

  it('ignores a cached insight when the market fingerprint has changed', async () => {
    sendAiChatStreamMock.mockReturnValue(new Promise(() => undefined));
    sessionStorage.setItem(
      'ledgerflow-investment-market-insight-v1',
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        profileKey: JSON.stringify({ positions: ['pos-1'], watchlist: [] }),
        marketInsightFingerprint: 'stale-market-fingerprint',
        insight: {
          headline: '旧市场简报',
          summary: '不应继续展示',
          points: [],
          suggestions: [],
          confidence: 'low'
        }
      })
    );

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalledTimes(1), {
      timeout: 3000
    });
  });

  it('offers a manual retry after insight generation fails', async () => {
    sendAiChatStreamMock.mockRejectedValue(new Error('upstream unavailable'));

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    const retryButton = await screen.findByRole(
      'button',
      { name: '重新生成' },
      { timeout: 3000 }
    );
    expect(sendAiChatStreamMock).toHaveBeenCalledTimes(1);

    fireEvent.click(retryButton);

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalledTimes(2), {
      timeout: 3000
    });
  });
});
