import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { InvestmentsPage } from './InvestmentsPage';

/*
 * 7×24 快讯面板的「AI 解读」入口。
 *
 * 原来的 bug:面板顶上那一个按钮,提示词是**写死的 `news[0]`** ——
 * 无论列表里是第几条、切到哪个分类,点下去都只解读第一条。
 * 下面两条测试把「点哪一条就解读哪一条」和「顶部按钮批量挑重点」钉死:
 * 提示词里必须出现被点那一条的标题,而且**不能**出现第一条的标题。
 */

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
  fetchEastmoneyMarketNews: vi.fn(),
  fetchEastmoneyMarketOverview: vi.fn(),
  fetchEastmoneyMarketBoards: vi.fn(),
  fetchEastmoneyMarketBoardsSnapshot: vi.fn(),
  fetchEastmoneyMarketBoardConstituents: vi.fn(),
  fetchEastmoneyMarketBoardTrend: vi.fn(),
  fetchEastmoneyMarketThemeBoards: vi.fn(),
  fetchEastmoneyMarketThemeBoardsSnapshot: vi.fn(),
  fetchEastmoneyIndexHistory: vi.fn(),
  fetchGlobalMarketHistory: vi.fn(),
  fetchGlobalMarketTrend: vi.fn(),
  fetchGlobalMarketSectorBoards: vi.fn(),
  fetchGlobalMarketOverview: vi.fn(),
  fetchEastmoneyFundSnapshot: vi.fn()
}));

const sendAiChatStreamMock = vi.hoisted(() => vi.fn());
const sendAiChatMock = vi.hoisted(() => vi.fn());
const fetchAiModelsMock = vi.hoisted(() => vi.fn());

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

vi.mock('../../features/investments/api/eastmoneyFundClient', () => ({
  fetchEastmoneyFundSnapshot: eastmoneyClientMock.fetchEastmoneyFundSnapshot
}));

vi.mock('../../features/investments/api/eastmoneyMarketClient', () => ({
  EASTMONEY_MARKET_INDEXES: [
    { secId: '1.000001', code: '000001', name: '上证指数', shortName: '上证' }
  ],
  EASTMONEY_MARKET_NEWS_CATEGORIES: [
    { id: 'all-day', label: '7×24', column: '102' },
    { id: 'focus', label: '焦点', column: '101' }
  ],
  EASTMONEY_MARKET_THEMES: [],
  GLOBAL_MARKET_INDEXES: [],
  fetchEastmoneyMarketBoards: eastmoneyClientMock.fetchEastmoneyMarketBoards,
  fetchEastmoneyMarketBoardsSnapshot: eastmoneyClientMock.fetchEastmoneyMarketBoardsSnapshot,
  fetchEastmoneyMarketBoardConstituents: eastmoneyClientMock.fetchEastmoneyMarketBoardConstituents,
  fetchEastmoneyMarketBoardTrend: eastmoneyClientMock.fetchEastmoneyMarketBoardTrend,
  fetchEastmoneyIndexHistory: eastmoneyClientMock.fetchEastmoneyIndexHistory,
  fetchGlobalMarketHistory: eastmoneyClientMock.fetchGlobalMarketHistory,
  fetchGlobalMarketTrend: eastmoneyClientMock.fetchGlobalMarketTrend,
  fetchEastmoneyMarketOverview: eastmoneyClientMock.fetchEastmoneyMarketOverview,
  fetchEastmoneyMarketNews: eastmoneyClientMock.fetchEastmoneyMarketNews,
  fetchEastmoneyMarketThemeBoards: eastmoneyClientMock.fetchEastmoneyMarketThemeBoards,
  fetchEastmoneyMarketThemeBoardsSnapshot:
    eastmoneyClientMock.fetchEastmoneyMarketThemeBoardsSnapshot,
  fetchGlobalMarketSectorBoards: eastmoneyClientMock.fetchGlobalMarketSectorBoards,
  fetchGlobalMarketOverview: eastmoneyClientMock.fetchGlobalMarketOverview
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  fetchAiModels: (...args: unknown[]) => fetchAiModelsMock(...args),
  sendAiChat: (...args: unknown[]) => sendAiChatMock(...args),
  sendAiChatStream: (...args: unknown[]) => sendAiChatStreamMock(...args)
}));

vi.mock('../../features/assistant/workbench/workbenchUtils', () => ({
  buildTimeContext: vi.fn().mockResolvedValue('当前中国标准时间:2026-07-16 09:30:00(来源:测试)')
}));

const NEWS = [
  {
    id: 'news-1',
    title: '第一条：央行公开市场净投放 2000 亿元',
    summary: '资金面维持宽松,短端利率小幅下行。',
    time: '2026-07-10 09:30:00',
    link: 'https://finance.eastmoney.com/a/news-1.html',
    stocks: ['银行ETF']
  },
  {
    id: 'news-2',
    title: '第二条：新能源车 6 月销量同比增长 28%',
    summary: '产业链上游材料价格企稳。',
    time: '2026-07-10 10:05:00',
    link: 'https://finance.eastmoney.com/a/news-2.html',
    stocks: ['宁德时代']
  },
  {
    id: 'news-3',
    title: '第三条：半导体设备招标金额创年内新高',
    summary: '国产替代订单继续释放,设备环节景气度上行。',
    time: '2026-07-10 11:20:00',
    link: 'https://finance.eastmoney.com/a/news-3.html',
    stocks: ['北方华创']
  }
];

/** The prompt text of the (single) stream request the chat panel has made. */
function sentText() {
  const calls = sendAiChatStreamMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const request = calls.at(-1)?.[0] as { messages: Array<{ role: string; text: string }> };
  return request.messages.filter((message) => message.role === 'user').at(-1)?.text ?? '';
}

describe('InvestmentsPage 快讯 AI 解读入口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sendAiChatStreamMock.mockResolvedValue({ content: '已收到,正在挑重点。', reasoning: '' });

    eastmoneyClientMock.fetchEastmoneyMarketNews.mockResolvedValue(NEWS);
    eastmoneyClientMock.fetchEastmoneyMarketOverview.mockResolvedValue(null);
    eastmoneyClientMock.fetchEastmoneyMarketBoards.mockResolvedValue([]);
    eastmoneyClientMock.fetchEastmoneyMarketThemeBoards.mockResolvedValue([]);
    eastmoneyClientMock.fetchEastmoneyMarketBoardConstituents.mockResolvedValue([]);
    eastmoneyClientMock.fetchEastmoneyMarketBoardTrend.mockResolvedValue([]);
    eastmoneyClientMock.fetchEastmoneyIndexHistory.mockResolvedValue([]);
    eastmoneyClientMock.fetchGlobalMarketHistory.mockResolvedValue([]);
    eastmoneyClientMock.fetchGlobalMarketTrend.mockResolvedValue([]);
    eastmoneyClientMock.fetchGlobalMarketOverview.mockResolvedValue({ quotes: [] });
    eastmoneyClientMock.fetchEastmoneyMarketBoardsSnapshot.mockResolvedValue({
      boards: [],
      meta: { source: '测试', updatedAt: '2026-07-10T15:10:00.000Z', freshness: 'live' }
    });
    eastmoneyClientMock.fetchEastmoneyMarketThemeBoardsSnapshot.mockResolvedValue({
      boards: [],
      meta: { source: '测试', updatedAt: '2026-07-10T15:10:00.000Z', freshness: 'live' }
    });
    eastmoneyClientMock.fetchGlobalMarketSectorBoards.mockResolvedValue({
      boards: [],
      meta: { source: '测试', updatedAt: '2026-07-10T15:10:00.000Z', freshness: 'live' }
    });

    financeStoreMock.state = { accounts: [], transactions: [] };

    useAppPreferences.setState({
      investmentPositions: [],
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
      model: 'gpt-5.4'
    });
  });

  async function renderNewsWorkspace() {
    render(
      <MemoryRouter>
        <InvestmentsPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: '市场快讯' }));
    // 顶部的批量解读入口只在真的拿到快讯之后才渲染,拿它当"列表已就绪"的信号
    return screen.findByRole('button', { name: '让 AI 解读最近几条快讯' });
  }

  it('每一行都有自己的解读入口,不再只有顶部那一个按钮', async () => {
    await renderNewsWorkspace();

    const rowButtons = screen.getAllByRole('button', { name: /^AI 解读：/ });
    expect(rowButtons).toHaveLength(3);
    expect(rowButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      `AI 解读：${NEWS[0].title}`,
      `AI 解读：${NEWS[1].title}`,
      `AI 解读：${NEWS[2].title}`
    ]);
    const digestButton = screen.getByRole('button', { name: '让 AI 解读最近几条快讯' });
    expect(digestButton).toBeInTheDocument();
    expect(digestButton).toHaveTextContent('解读最近几条');
  });

  it('点第三条的「AI 解读」,发给 AI 的是第三条而不是第一条', async () => {
    await renderNewsWorkspace();

    fireEvent.click(screen.getByRole('button', { name: `AI 解读：${NEWS[2].title}` }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const text = sentText();
    expect(text).toContain(NEWS[2].title);
    expect(text).toContain(NEWS[2].stocks[0]);
    expect(text).not.toContain(NEWS[0].title);
    expect(text).not.toContain(NEWS[1].title);

    // 悬浮助手会显示"正在看的是哪一条",标签必须跟着被点的那一条走
    expect(await screen.findByTitle(NEWS[2].title)).toHaveTextContent(`正在看：${NEWS[2].title}`);
  });

  it('顶部按钮一次解读最近几条,并把"都不重要就说都不重要"写进提示词', async () => {
    await renderNewsWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '让 AI 解读最近几条快讯' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const text = sentText();
    expect(text).toContain('我刚看到 3 条「7×24」市场快讯');
    NEWS.forEach((item, index) => {
      expect(text).toContain(`${index + 1}. ${item.title}`);
    });
    expect(text).toContain('如果都不重要就直接说都不重要');

    expect(await screen.findByTitle('最近 3 条快讯')).toHaveTextContent('正在看：最近 3 条快讯');
  });

  it('切到「焦点」分类后,顶部按钮发的是当前分类的条数', async () => {
    eastmoneyClientMock.fetchEastmoneyMarketNews.mockResolvedValue([NEWS[1]]);
    await renderNewsWorkspace();

    fireEvent.click(screen.getByRole('tab', { name: '焦点' }));
    await waitFor(() =>
      expect(eastmoneyClientMock.fetchEastmoneyMarketNews).toHaveBeenCalledWith('101')
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '让 AI 解读最近几条快讯' })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: '让 AI 解读最近几条快讯' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const text = sentText();
    expect(text).toContain('我刚看到 1 条「焦点」市场快讯');
    expect(text).toContain(NEWS[1].title);
    expect(text).not.toContain(NEWS[0].title);
  });

  it('一次最多带 5 条,不会把整个列表塞给模型', async () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      id: `news-many-${index}`,
      title: `批量第 ${index + 1} 条：测试用快讯`,
      summary: '摘要',
      time: '2026-07-10 12:00:00',
      link: `https://finance.eastmoney.com/a/many-${index}.html`,
      stocks: []
    }));
    eastmoneyClientMock.fetchEastmoneyMarketNews.mockResolvedValue(many);
    await renderNewsWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '让 AI 解读最近几条快讯' }));

    await waitFor(() => expect(sendAiChatStreamMock).toHaveBeenCalled());
    const text = sentText();
    expect(text).toContain('我刚看到 5 条「7×24」市场快讯');
    expect(text).toContain('5. 批量第 5 条：测试用快讯');
    expect(text).not.toContain('批量第 6 条');
    expect(text).not.toContain('批量第 7 条');
    expect(await screen.findByTitle('最近 5 条快讯')).toBeInTheDocument();
  });
});
