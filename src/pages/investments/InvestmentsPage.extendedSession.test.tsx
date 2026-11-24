import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { InvestmentsPage } from './InvestmentsPage';

/**
 * 盘前/盘后显示(美股指数用对应 ETF 的价格代替)。
 *
 * 两条不变量:
 *   1. 有 `extended` 时,卡片上必须出现「盘前/盘后」**和 ETF 代码** —— 不写 ETF 代码,
 *      用户会以为是指数本身在动;
 *   2. `extended` 为 null 时(不在盘前/盘后时段),这条**不显示** —— 不能展示过时数据。
 */

const financeStoreMock = vi.hoisted(() => ({
  state: { accounts: [], transactions: [] }
}));

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
  sendAiChatStream: vi.fn()
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
  GLOBAL_MARKET_INDEXES: [{ id: 'us-sp500', market: '美股', name: '标普 500', symbol: '^GSPC', flag: 'US' }],
  ...marketClientMock
}));

const usQuote = (extended: unknown) => ({
  id: 'us-sp500',
  market: '美股',
  name: '标普 500',
  symbol: '^GSPC',
  value: 6100,
  change: 12,
  changePercent: 0.2,
  high: 6120,
  low: 6080,
  previousClose: 6088,
  updatedAt: '2026-11-10T02:00:00.000Z',
  source: 'Yahoo Finance',
  extended
});

function seed() {
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
  marketClientMock.fetchEastmoneyMarketOverview.mockResolvedValue({
    selectedSecId: '1.000001',
    updatedAt: '2026-11-10T02:00:00.000Z',
    quotes: [],
    trend: []
  });

  useAppPreferences.setState({
    investmentPositions: [],
    investmentPositionHistory: [],
    investmentGoals: [],
    investmentWatchlist: [],
    investmentAiMessages: [],
    debts: [],
    monthlyIncome: 0
  });
  useAiSettings.setState({
    baseUrl: 'https://api.example.com/v1',
    apiKey: '',
    model: '',
    webSearch: {
      provider: 'tavily',
      credentials: {
        tavily: { apiKey: '', baseUrl: '', engineId: '' },
        brave: { apiKey: '', baseUrl: '', engineId: '' },
        serper: { apiKey: '', baseUrl: '', engineId: '' },
        exa: { apiKey: '', baseUrl: '', engineId: '' },
        google: { apiKey: '', baseUrl: '', engineId: '' }
      },
      maxResults: 5,
      localEndpoint: ''
    }
  });
}

describe('美股盘前/盘后显示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    financeStoreMock.state = { accounts: [], transactions: [] };
    seed();
  });

  it('盘前:显示「盘前」+ ETF 代码 + 价格', async () => {
    marketClientMock.fetchGlobalMarketOverview.mockResolvedValue({
      updatedAt: '2026-11-10T02:00:00.000Z',
      source: 'Yahoo Finance',
      quotes: [
        usQuote({
          session: 'pre',
          symbol: 'SPY',
          price: 6110.5,
          change: 22.5,
          changePercent: 0.37,
          previousClose: 6088,
          updatedAt: '2026-11-10T02:00:00.000Z'
        })
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('盘前')).toBeInTheDocument();
    });
    // ETF 代码必须出现 —— 否则会被误认为指数本身在涨跌
    expect(screen.getByText('SPY')).toBeInTheDocument();
  });

  it('盘后:显示「盘后」', async () => {
    marketClientMock.fetchGlobalMarketOverview.mockResolvedValue({
      updatedAt: '2026-11-10T10:00:00.000Z',
      source: 'Yahoo Finance',
      quotes: [
        usQuote({
          session: 'post',
          symbol: 'SPY',
          price: 6095,
          change: 7,
          changePercent: 0.11,
          previousClose: 6088,
          updatedAt: '2026-11-10T10:00:00.000Z'
        })
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('盘后')).toBeInTheDocument();
    });
  });

  it('不在盘前/盘后时(extended 为 null)不显示这条', async () => {
    marketClientMock.fetchGlobalMarketOverview.mockResolvedValue({
      updatedAt: '2026-11-10T02:00:00.000Z',
      source: 'Yahoo Finance',
      quotes: [usQuote(null)]
    });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/标普 500/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('盘前')).not.toBeInTheDocument();
    expect(screen.queryByText('盘后')).not.toBeInTheDocument();
  });
});