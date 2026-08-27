import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancePage } from './FinancePage';

const i18nMock = { language: 'zh' };
const tMock = (key: string) => {
  const map: Record<string, string> = {
    'finance.ui.title': '同花顺资讯',
    'finance.ui.subtitle': '市场资讯已经接入同花顺财经，按栏目快速浏览最新动态。',
    'finance.ui.tipTitle': '聚焦市场，不再维护 RSS',
    'finance.ui.tipBody': '这里只展示同花顺财经资讯阅读；工资计算、个税测算等工具请前往左侧「工资工具」。',
    'finance.ui.sourceLabel': '内置资讯来源',
    'finance.ui.sourceBadge': '单源资讯',
    'finance.ui.sourceTitle': '同花顺财经',
    'finance.ui.sourceHint': '所有内容来自同花顺财经要闻栏目。',
    'finance.ui.openSource': '打开同花顺财经网站',
    'finance.ui.sourceSite': '同花顺',
    'finance.ui.categories': '资讯栏目',
    'finance.ui.loading': '正在同步同花顺资讯...',
    'finance.ui.noNews': '暂无同花顺资讯。',
    'finance.ui.loadFailed': '同花顺资讯暂不可用。',
    'finance.ui.readerTitle': '同花顺资讯阅读器',
    'finance.ui.noSummary': '暂无摘要。',
    'finance.ui.openOriginal': '打开原文',
    'finance.ui.dailyIdeaTitle': '今日金融小建议',
    'finance.category.yaowen': '财经要闻',
    'finance.category.macro': '宏观经济',
    'finance.category.industry': '产经新闻',
    'finance.category.global': '国际财经',
    'finance.category.market': '金融市场',
    'finance.category.commentary': '财经评论',
    'finance.ideas.1': '每周固定 10 分钟复盘。',
    'finance.ideas.2': '建一个利率观察清单。',
    'finance.ideas.3': '给大额支出打标签。',
    'finance.ideas.4': '避免追涨杀跌。',
    'finance.ideas.5': '保留 3~6 个月应急资金。'
  };
  return map[key] || key;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: i18nMock,
    t: tMock
  })
}));

const fetchMock = vi.fn();
const storageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(() => null),
  get length() {
    return 0;
  }
};

describe('FinancePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.stubGlobal('localStorage', storageMock);
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storageMock as Storage);
    (storageMock.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMock.clear as ReturnType<typeof vi.fn>).mockReset();
  });

  it('展示同花顺作为唯一内置资讯来源，并读取资讯列表', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          news: [
            {
              id: 'news-1',
              title: '财政部部署推进财政科学管理工作',
              source: '同花顺财经',
              link: 'https://news.10jqka.com.cn/20260827/c679360478.shtml',
              publishedAt: '08月27日 20:31',
              summary: '财政部发布消息称，8月26日在安徽合肥举行财政科学管理研讨交流。'
            }
          ]
        }
      })
    });

    render(
      <MemoryRouter>
        <FinancePage />
      </MemoryRouter>
    );

    expect(screen.getByText('同花顺财经')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /同花顺/ })).toHaveAttribute(
      'href',
      'https://www.10jqka.com.cn/'
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '财政部部署推进财政科学管理工作' }),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/market/tonghuashun/news?category=yaowen&pageSize=16')
    );
  });
});
