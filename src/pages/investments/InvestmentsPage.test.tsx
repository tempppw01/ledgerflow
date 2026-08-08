import { render, screen, waitFor, within } from '@testing-library/react';
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
  fetchEastmoneyFundSnapshot: vi.fn(),
  fetchEastmoneyIndexHistory: vi.fn(),
  fetchGlobalMarketHistory: vi.fn(),
  fetchEastmoneyMarketBoards: vi.fn(),
  fetchEastmoneyMarketOverview: vi.fn(),
  fetchEastmoneyMarketNews: vi.fn(),
  fetchEastmoneyMarketThemeBoards: vi.fn(),
  fetchGlobalMarketOverview: vi.fn()
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

vi.mock('../../features/investments/api/eastmoneyFundClient', () => ({
  fetchEastmoneyFundSnapshot: eastmoneyClientMock.fetchEastmoneyFundSnapshot
}));

vi.mock('../../features/investments/api/eastmoneyMarketClient', () => ({
  EASTMONEY_MARKET_INDEXES: [
    { secId: '1.000001', code: '000001', name: '上证指数', shortName: '上证' },
    { secId: '0.399001', code: '399001', name: '深证成指', shortName: '深证' },
    { secId: '0.399006', code: '399006', name: '创业板指', shortName: '创业板' },
    { secId: '1.000688', code: '000688', name: '科创50', shortName: '科创50' },
    { secId: '0.899050', code: '899050', name: '北证50', shortName: '北证50' },
    { secId: '1.000016', code: '000016', name: '上证50', shortName: '上证50' },
    { secId: '1.000300', code: '000300', name: '沪深300', shortName: '沪深300' },
    { secId: '1.000905', code: '000905', name: '中证500', shortName: '中证500' },
    { secId: '1.000852', code: '000852', name: '中证1000', shortName: '中证1000' },
    { secId: '0.399330', code: '399330', name: '深证100', shortName: '深证100' },
    { secId: '0.399673', code: '399673', name: '创业板50', shortName: '创业板50' }
  ],
  EASTMONEY_MARKET_NEWS_CATEGORIES: [
    { id: 'all-day', label: '7×24', column: '102' },
    { id: 'focus', label: '焦点', column: '101' },
    { id: 'listed-company', label: '上市公司', column: '103' },
    { id: 'china-market', label: '中国股市', column: '104' },
    { id: 'global-market', label: '全球股市', column: '105' },
    { id: 'commodity', label: '商品', column: '106' },
    { id: 'forex', label: '外汇', column: '107' },
    { id: 'bond', label: '债券', column: '108' },
    { id: 'fund', label: '基金', column: '109' }
  ],
  EASTMONEY_MARKET_THEMES: [
    { code: 'BK1106', name: '创新药' },
    { code: 'BK1128', name: 'CPO概念' },
    { code: 'BK0877', name: 'PCB概念' }
  ],
  GLOBAL_MARKET_INDEXES: [
    { id: 'us-dow', market: '美股', name: '道琼斯', symbol: '^DJI', flag: '🇺🇸' },
    { id: 'us-sp500', market: '美股', name: '标普 500', symbol: '^GSPC', flag: '🇺🇸' },
    { id: 'us-nasdaq', market: '美股', name: '纳斯达克', symbol: '^IXIC', flag: '🇺🇸' },
    { id: 'us-nasdaq100', market: '美股', name: '纳斯达克 100', symbol: '^NDX', flag: '🇺🇸' },
    { id: 'jp-nikkei', market: '日股', name: '日经 225', symbol: '^N225', flag: '🇯🇵' },
    { id: 'kr-kospi', market: '韩股', name: '韩国综合', symbol: '^KS11', flag: '🇰🇷' }
  ],
  fetchEastmoneyMarketBoards: eastmoneyClientMock.fetchEastmoneyMarketBoards,
  fetchEastmoneyIndexHistory: eastmoneyClientMock.fetchEastmoneyIndexHistory,
  fetchGlobalMarketHistory: eastmoneyClientMock.fetchGlobalMarketHistory,
  fetchEastmoneyMarketOverview: eastmoneyClientMock.fetchEastmoneyMarketOverview,
  fetchEastmoneyMarketNews: eastmoneyClientMock.fetchEastmoneyMarketNews,
  fetchEastmoneyMarketThemeBoards: eastmoneyClientMock.fetchEastmoneyMarketThemeBoards,
  fetchGlobalMarketOverview: eastmoneyClientMock.fetchGlobalMarketOverview
}));

describe('InvestmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eastmoneyClientMock.fetchEastmoneyMarketOverview.mockResolvedValue({
      selectedSecId: '1.000001',
      updatedAt: '2026-07-10T15:10:00.000Z',
      quotes: [
        {
          secId: '1.000001',
          code: '000001',
          name: '上证指数',
          value: 3996.16,
          change: -40.43,
          changePercent: -1,
          high: 4074.83,
          low: 3995.81,
          open: 4031.54,
          previousClose: 4036.59,
          volume: 627450065,
          amount: 1563108691542.7
        }
      ],
      trend: [
        {
          time: '2026-07-10 09:30',
          label: '09:30',
          value: 4031.54,
          volume: 4279461,
          amount: 13614469632,
          average: 4033.65
        },
        {
          time: '2026-07-10 15:00',
          label: '15:00',
          value: 3996.16,
          volume: 5279461,
          amount: 23614469632,
          average: 4010.65
        }
      ]
    });
    eastmoneyClientMock.fetchEastmoneyIndexHistory.mockResolvedValue([
      {
        date: '2026-01-02',
        value: 3900,
        open: 3890,
        high: 3920,
        low: 3880,
        changePercent: 0.2,
        volume: 100,
        amount: 1000
      },
      {
        date: '2026-02-02',
        value: 4000,
        open: 3990,
        high: 4020,
        low: 3980,
        changePercent: 2.5,
        volume: 120,
        amount: 1200
      },
      {
        date: '2026-03-02',
        value: 4100,
        open: 4090,
        high: 4120,
        low: 4080,
        changePercent: 2.5,
        volume: 140,
        amount: 1400
      }
    ]);
    eastmoneyClientMock.fetchGlobalMarketHistory.mockResolvedValue([
      {
        date: '2026-01-02',
        value: 39000,
        open: 38900,
        high: 39100,
        low: 38800,
        changePercent: 0.2,
        volume: 100,
        amount: null
      },
      {
        date: '2026-02-02',
        value: 40000,
        open: 39900,
        high: 40100,
        low: 39800,
        changePercent: 2.5,
        volume: 120,
        amount: null
      }
    ]);
    eastmoneyClientMock.fetchGlobalMarketOverview.mockResolvedValue({
      updatedAt: '2026-07-10T15:10:00.000Z',
      source: 'Yahoo Finance',
      quotes: [
        {
          id: 'us-dow',
          market: '美股',
          name: '道琼斯',
          symbol: '^DJI',
          value: 44200,
          change: 120,
          changePercent: 0.27,
          high: 44300,
          low: 44000,
          previousClose: 44080,
          updatedAt: '2026-07-10T15:10:00.000Z',
          source: 'Yahoo Finance'
        }
      ]
    });
    eastmoneyClientMock.fetchEastmoneyMarketNews.mockResolvedValue([
      {
        id: 'news-1',
        title: '多元化突破，液化天然气制甲烷首次应用于长征系列火箭',
        summary: '记者从相关单位获悉，首次规模化应用带来产业链关注。',
        time: '2026-07-10 09:36:00',
        link: 'https://finance.eastmoney.com/a/news-1.html',
        stocks: ['中国石化']
      }
    ]);
    eastmoneyClientMock.fetchEastmoneyMarketThemeBoards.mockResolvedValue([
      {
        code: 'BK1106',
        name: '创新药',
        value: 1234.56,
        change: 12.34,
        changePercent: 1.02,
        volume: 1200000,
        amount: 987654321,
        upCount: 12,
        downCount: 3,
        flatCount: 1
      }
    ]);
    eastmoneyClientMock.fetchEastmoneyMarketBoards.mockResolvedValue([
      {
        code: 'BK0001',
        name: '测试细分行业',
        value: 1234.56,
        change: 12.34,
        changePercent: 1.02,
        volume: 1200000,
        amount: 987654321,
        upCount: 12,
        downCount: 3,
        flatCount: 1
      }
    ]);
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

  function getMarketChartStage() {
    const stage = document.querySelector('.investments-market-chart-stage') as HTMLElement | null;
    expect(stage).toBeTruthy();
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () =>
        ({
          left: 0,
          top: 0,
          right: 560,
          bottom: 176,
          width: 560,
          height: 224,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }) as DOMRect
    });
    return stage as HTMLElement;
  }

  it('应展示今日持仓、通俗行情和规则提示', async () => {
    const { container } = render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('大盘概览')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('上证指数关键数据')).getByText('1.56万亿')
    ).toBeInTheDocument();
    expect(await screen.findByText('快讯')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '热门题材' })).toBeInTheDocument();
    expect(screen.getByLabelText('选择热门题材')).toHaveValue('BK1106');
    expect(screen.getByTestId('market-session-status')).toBeInTheDocument();
    expect(
      screen.getByTestId('market-session-status').querySelector('.investments-global-clock-zone')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('折叠的全球市场时间轴')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '展开时间轴' }));
    expect(screen.getByLabelText('按当前时区显示的全球市场时间轴')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('全球股市开闭市状态')).getByText('美股')
    ).toBeInTheDocument();
    expect(screen.getByText('7x24')).toBeInTheDocument();
    expect(screen.getByText(/液化天然气制甲烷/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今日持仓' })).toBeInTheDocument();
    expect(screen.getByText('今日市场估算')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今天的市场，说人话' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今天怎么做' })).toBeInTheDocument();
    expect(screen.getByText('板块健康度')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI 排序' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开投资风向' })).not.toBeInTheDocument();
    const marketPanel = screen.getByText('大盘概览').closest('section');
    expect(marketPanel).toBeInTheDocument();
    expect(
      within(marketPanel as HTMLElement).queryByRole('button', { name: '刷新' })
    ).not.toBeInTheDocument();
    expect(
      within(marketPanel as HTMLElement).queryByRole('button', { name: '问 AI 怎么看' })
    ).not.toBeInTheDocument();
    expect(within(marketPanel as HTMLElement).getByText('实时轮询')).toBeInTheDocument();
    expect(within(marketPanel as HTMLElement).getByLabelText('美日韩大盘行情')).toBeInTheDocument();
    expect(
      within(within(marketPanel as HTMLElement).getByLabelText('美日韩大盘行情')).getAllByText('🇺🇸')
    ).toHaveLength(4);
    expect(
      within(screen.getByRole('tablist', { name: '大盘指数' })).getAllByText('🇨🇳')
    ).toHaveLength(11);
    const shanghaiIndexTab = within(marketPanel as HTMLElement).getByRole('tab', {
      name: /A 股 上证指数 3996\.16 -1\.00%/
    });
    expect(shanghaiIndexTab).toHaveClass('is-negative');
    expect(screen.getAllByText('¥1.09万').length).toBeGreaterThan(0);

    expect(screen.queryByText('6 个月应急金')).not.toBeInTheDocument();
    expect(screen.getByText('基金自选')).toBeInTheDocument();
    const quickChatLauncher = screen.getByRole('button', { name: '打开快捷问答' });
    expect(quickChatLauncher).toBeInTheDocument();
    fireEvent.click(quickChatLauncher);
    expect(screen.getByLabelText('基金分析输入框')).toBeInTheDocument();
    expect(container.querySelector('.investments-management-grid')).toBeInTheDocument();
  });

  it('行情数字变化时会短暂高亮对应指数格', async () => {
    eastmoneyClientMock.fetchEastmoneyMarketOverview
      .mockResolvedValueOnce({
        selectedSecId: '1.000001',
        updatedAt: '2026-07-10T15:10:00.000Z',
        quotes: [
          {
            secId: '1.000001',
            code: '000001',
            name: '上证指数',
            value: 3996.16,
            change: -40.43,
            changePercent: -1
          }
        ],
        trend: []
      })
      .mockResolvedValueOnce({
        selectedSecId: '0.399001',
        updatedAt: '2026-07-10T15:10:10.000Z',
        quotes: [
          {
            secId: '1.000001',
            code: '000001',
            name: '上证指数',
            value: 4002.88,
            change: 6.72,
            changePercent: 0.17
          },
          {
            secId: '0.399001',
            code: '399001',
            name: '深证成指',
            value: 12701.22,
            change: 24.12,
            changePercent: 0.19
          }
        ],
        trend: []
      });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    const initialShanghaiTab = await screen.findByRole('tab', {
      name: /A 股 上证指数 3996\.16 -1\.00%/
    });
    expect(initialShanghaiTab).not.toHaveClass('is-updating');

    await userEvent.click(screen.getByRole('tab', { name: /A 股 深证成指/ }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /A 股 上证指数 4002\.88 \+0\.17%/ })).toHaveClass(
        'is-updating',
        'is-positive'
      );
    });
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

    expect(await screen.findByText('大盘概览')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('上证指数关键数据')).getByText('1.56万亿')
    ).toBeInTheDocument();
    expect(await screen.findByText(/液化天然气制甲烷/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('添加基金代码'), '161725');
    await userEvent.click(screen.getByRole('button', { name: /获取资料/ }));

    await waitFor(() => {
      expect(eastmoneyClientMock.fetchEastmoneyFundSnapshot).toHaveBeenCalledWith('161725');
    });

    expect(await screen.findByText('招商中证白酒指数(LOF)A')).toBeInTheDocument();
    await userEvent.click(screen.getByText('招商中证白酒指数(LOF)A'));
    expect(screen.getByText('单位净值 0.5162（2026-06-25）')).toBeInTheDocument();
    expect(screen.getByText(/估算涨跌 -3\.10%/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '添加关注' }));
    expect(screen.getByText('关注中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加关注' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /刷新 招商中证白酒指数.*基金资料/ })
    ).toBeInTheDocument();

    expect(screen.getByText('招商中证白酒指数(LOF)A')).toBeInTheDocument();

    const watchItem = useAppPreferences.getState().investmentWatchlist[0];
    expect(watchItem).toMatchObject({
      code: '161725',
      platform: '东方财富',
      buyFeeRate: '0.10%',
      addedReturn: '-3.10%',
      netValue: '0.5162'
    });
  });

  it('可以一键刷新全部自选基金资料', async () => {
    useAppPreferences.getState().setInvestmentWatchlist([
      {
        id: 'watch-1',
        name: '测试指数基金',
        code: '000001',
        platform: '东方财富',
        tags: ['指数'],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      {
        id: 'watch-2',
        name: '测试主动基金',
        code: '000002',
        platform: '东方财富',
        tags: ['主动'],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      }
    ]);
    eastmoneyClientMock.fetchEastmoneyFundSnapshot.mockImplementation(async (code: string) => ({
      code,
      name: code === '000001' ? '测试指数基金' : '测试主动基金',
      netValue: code === '000001' ? '1.1234' : '2.3456',
      netValueDate: '2026-07-13',
      estimatedValue: '',
      estimatedChangePercent: code === '000001' ? '1.20' : '-0.80',
      estimatedAt: '2026-07-13 15:00',
      buyFeeRate: '0.10%',
      sourceFeeRate: '1.00%',
      performanceHistory: [],
      fundAnalysis: [],
      fundHoldings: [],
      assetAllocation: []
    }));

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: '刷新全部自选基金资料' }));

    await waitFor(() => {
      expect(eastmoneyClientMock.fetchEastmoneyFundSnapshot).toHaveBeenCalledTimes(2);
    });
    expect(eastmoneyClientMock.fetchEastmoneyFundSnapshot).toHaveBeenCalledWith('000001');
    expect(eastmoneyClientMock.fetchEastmoneyFundSnapshot).toHaveBeenCalledWith('000002');
    await waitFor(() => {
      expect(useAppPreferences.getState().investmentWatchlist).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: '000001', netValue: '1.1234', addedReturn: '+1.20%' }),
          expect.objectContaining({ code: '000002', netValue: '2.3456', addedReturn: '-0.80%' })
        ])
      );
    });
  });

  it('可以在自选基金卡片内录入持有份额并持久化', async () => {
    useAppPreferences.getState().setInvestmentWatchlist([
      {
        id: 'watch-holding',
        name: '持有份额测试基金',
        code: '000004',
        platform: '东方财富',
        tags: ['指数'],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      }
    ]);

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: '待填写' }));
    const input = screen.getByLabelText('持有份额测试基金持有份额');
    await userEvent.type(input, '1234.56{Enter}');

    await waitFor(() => {
      expect(useAppPreferences.getState().investmentWatchlist[0]).toMatchObject({
        holdingShares: 1234.56
      });
    });
    expect(screen.getByRole('button', { name: '1234.56 份' })).toBeInTheDocument();
  });

  it('自选基金填写持有份额后会计入顶部今日持仓估算', async () => {
    useAppPreferences.setState({
      investmentPositions: [],
      investmentWatchlist: [
        {
          id: 'watch-estimate',
          name: '测试估值基金',
          code: '000009',
          platform: '东方财富',
          tags: ['指数'],
          holdingShares: 100,
          netValue: '2.0000',
          addedReturn: '+1.50%',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z'
        }
      ]
    });

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    const todayHoldings = screen.getByLabelText('今日持仓');
    await waitFor(() => {
      expect(within(todayHoldings).getByText('今日市场估算')).toBeInTheDocument();
    });
    expect(within(todayHoldings).getByText('1 笔')).toBeInTheDocument();
    expect(within(todayHoldings).getByText('¥200.00')).toBeInTheDocument();
    expect(within(todayHoldings).getAllByText('¥3.00')).toHaveLength(2);
    expect(within(todayHoldings).getByText('+1.50%')).toBeInTheDocument();
    expect(within(todayHoldings).getByText('成本待录入')).toBeInTheDocument();
    expect(within(todayHoldings).getByText('指数 · 自选持仓')).toBeInTheDocument();
    expect(await screen.findByText(/液化天然气制甲烷/)).toBeInTheDocument();
  });

  it('负收益历史业绩走线图显示负收益', async () => {
    useAppPreferences.getState().setInvestmentWatchlist([
      {
        id: 'watch-negative',
        name: '负收益测试基金',
        code: '000003',
        platform: '东方财富',
        tags: ['指数'],
        performanceHistory: ['近1月 -8.43%', '近3月 -17.10%', '近6月 -32.03%', '近1年 -33.52%'],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      }
    ]);

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByText('负收益测试基金'));

    const chart = await screen.findByRole('img', { name: '历史业绩走线图' });
    expect(chart.querySelector('.investments-watch-performance-line-path')).toBeInTheDocument();
    expect(screen.getByLabelText('历史业绩数值')).toHaveTextContent('-8.43%');
  });

  it('鼠标悬停大盘分时图时会显示对应坐标的数值', async () => {
    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('大盘概览')).toBeInTheDocument();
    const stage = getMarketChartStage();

    expect(
      document.querySelectorAll(
        '.investments-market-chart-stage .investments-market-chart-axis-label'
      )
    ).toHaveLength(3);
    expect(document.querySelector('.investments-market-chart-tooltip')).not.toBeInTheDocument();

    fireEvent.mouseMove(stage, { clientX: 20 });

    expect(await screen.findByText('09:30 · 4031.54')).toBeInTheDocument();
    expect(document.querySelector('.investments-market-chart-tooltip')).toBeInTheDocument();
    expect(screen.getByText(/均价 4033\.65/)).toBeInTheDocument();
  });

  it('可以从指数轨道切换到扩展的宽基指数', async () => {
    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    const indexTab = await screen.findByRole('tab', { name: /A 股 沪深300/ });
    expect(screen.getByRole('tab', { name: /A 股 上证50/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看上一组指数' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看下一组指数' })).not.toBeInTheDocument();
    expect(screen.getByText('纳斯达克 100')).toBeInTheDocument();

    await userEvent.click(indexTab);

    await waitFor(() => {
      expect(eastmoneyClientMock.fetchEastmoneyMarketOverview).toHaveBeenLastCalledWith('1.000300');
    });
    expect(indexTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('沪深300关键数据')).toBeInTheDocument();
  });

  it('可以切换热门题材并更新题材数据图', async () => {
    eastmoneyClientMock.fetchEastmoneyMarketThemeBoards.mockResolvedValue([
      {
        code: 'BK1106',
        name: '创新药',
        value: 1500,
        change: 18,
        changePercent: 1.2,
        volume: 1000,
        amount: 100000000,
        upCount: 20,
        downCount: 4,
        flatCount: 1
      },
      {
        code: 'BK1128',
        name: 'CPO概念',
        value: 8800,
        change: -120,
        changePercent: -1.3,
        volume: 2000,
        amount: 200000000,
        upCount: 10,
        downCount: 30,
        flatCount: 1
      }
    ]);

    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    const themeSelect = await screen.findByLabelText('选择热门题材');
    await userEvent.selectOptions(themeSelect, 'BK1128');

    expect(themeSelect).toHaveValue('BK1128');
    expect(screen.getByLabelText('CPO概念涨跌分布')).toBeInTheDocument();
  });

  it('可以切换大盘历史区间并运行定投模拟', async () => {
    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('img', { name: /上证指数近 1 年历史走势/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '近 3 月' }));
    await waitFor(() => {
      expect(eastmoneyClientMock.fetchEastmoneyIndexHistory).toHaveBeenCalledWith('1.000001', {
        range: '3m'
      });
    });

    const frequency = screen.getByLabelText('频率');
    expect(screen.getByLabelText('定投每月几号')).toBeInTheDocument();
    await userEvent.selectOptions(frequency, 'weekly');
    expect(screen.getByLabelText('定投每周几')).toBeInTheDocument();
    await userEvent.selectOptions(frequency, 'trading-daily');
    expect(screen.queryByLabelText('定投每周几')).not.toBeInTheDocument();
    await userEvent.selectOptions(frequency, 'monthly');

    await userEvent.selectOptions(screen.getByLabelText('历史模拟标的'), 'global:us-dow');
    await waitFor(() => {
      expect(eastmoneyClientMock.fetchGlobalMarketHistory).toHaveBeenCalledWith('us-dow', {
        range: '3m'
      });
    });
    expect(await screen.findByRole('img', { name: /道琼斯近 3 月历史走势/ })).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('定投每期金额'));
    await userEvent.type(screen.getByLabelText('定投每期金额'), '1000');
    fireEvent.change(screen.getByLabelText('定投开始日期'), {
      target: { value: '2026-01-01' }
    });
    fireEvent.change(screen.getByLabelText('定投结束日期'), {
      target: { value: '2026-03-02' }
    });
    expect(screen.getByLabelText('定投开始日期')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('定投结束日期')).toHaveValue('2026-03-02');
    fireEvent.submit(screen.getByRole('button', { name: '开始模拟' }).closest('form')!);
    expect(await screen.findByLabelText('定投模拟结果')).toBeInTheDocument();
    expect(screen.getByText('累计投入')).toBeInTheDocument();
    expect(screen.getByText('模拟盈亏')).toBeInTheDocument();
  });

  it('可以增删改自选题材并保留数据来源', async () => {
    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    await screen.findByText('大盘概览');
    const addTheme = screen.getByLabelText('添加可跟踪题材');
    await userEvent.selectOptions(addTheme, 'BK0001');
    await userEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByRole('option', { name: '测试细分行业' })).toBeInTheDocument();

    await userEvent.click(screen.getByText('管理已跟踪题材'));
    const editButtons = screen.getAllByRole('button', { name: '修改' });
    await userEvent.click(editButtons[editButtons.length - 1]);
    const editInput = screen.getByLabelText('修改 测试细分行业 的显示名称');
    await userEvent.clear(editInput);
    await userEvent.type(editInput, '测试行业');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getAllByText('测试行业').length).toBeGreaterThan(0);

    const deleteButtons = screen.getAllByRole('button', { name: '删除' });
    await userEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(screen.queryByText('测试行业')).not.toBeInTheDocument();
    expect(screen.getAllByText(/服务端同源代理/).length).toBeGreaterThan(0);
  });
});
