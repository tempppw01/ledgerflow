import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { FinancePage } from './FinancePage';

const i18nMock = { language: 'zh' };
const tMock = (key: string, options?: Record<string, string | number>) => {
  const map: Record<string, string> = {
    'finance.ui.title': '金融资讯',
    'finance.ui.subtitle': '支持 RSS 订阅与阅读，便于按自己的信息源持续跟踪财经动态。',
    'finance.ui.rssManage': 'RSS 订阅管理',
    'finance.ui.feedTitlePlaceholder': '订阅名称（可选）',
    'finance.ui.add': '新增',
    'finance.ui.disable': '停用',
    'finance.ui.enable': '启用',
    'finance.ui.delete': '删除',
    'finance.ui.loading': '正在加载 RSS 资讯...',
    'finance.ui.noCachedNews': '暂无可展示的 RSS 缓存资讯，请检查订阅源后重试。',
    'finance.ui.noReadableContent': '订阅源暂无可读内容，已展示上次缓存资讯。',
    'finance.ui.rssUnavailable': 'RSS 订阅源暂不可用，已展示上次缓存资讯。',
    'finance.ui.rssStatusIdle': '待检测',
    'finance.ui.rssStatusLoading': '检测中',
    'finance.ui.rssStatusSuccess': '已连接',
    'finance.ui.rssStatusEmpty': '暂无内容',
    'finance.ui.rssStatusEmptyDetail': '这个源可访问，但暂时没有读到文章。',
    'finance.ui.rssStatusError': '读取失败',
    'finance.ui.rssStatusErrorDetail': '这次没有成功拉取这个源。',
    'finance.ui.rssStatusDisabled': '已停用',
    'finance.ui.readerTitle': 'RSS 阅读器',
    'finance.ui.noSummary': '该订阅源未提供摘要，请点击下方链接阅读原文。',
    'finance.ui.openOriginal': '打开原文',
    'finance.ui.dailyIdeaTitle': '今日金融小建议'
  };

  if (key === 'finance.ui.rssStatusSuccessDetail') {
    return `已读取 ${options?.count ?? 0} 条内容。`;
  }

  return map[key] || key;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: i18nMock,
    t: tMock
  })
}));

const fetchMock = vi.fn();

describe('FinancePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    window.localStorage.clear();
    useAppPreferences.setState({ rssSubscriptions: [] });
  });

  it('新增 RSS 后应展示该订阅源的状态', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Example Feed</title></channel></rss>`
    });

    render(
      <MemoryRouter>
        <FinancePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('RSS 订阅管理（0）'));
    fireEvent.change(screen.getByPlaceholderText('订阅名称（可选）'), {
      target: { value: 'Example Feed' }
    });
    fireEvent.change(screen.getByPlaceholderText('https://example.com/feed.xml'), {
      target: { value: 'https://example.com/rss.xml' }
    });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    const feedGroup = await screen.findByRole('group', { name: 'RSS 订阅 Example Feed' });
    expect(await within(feedGroup).findByText('暂无内容')).toBeInTheDocument();
    expect(within(feedGroup).getByText('这个源可访问，但暂时没有读到文章。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('https://example.com/rss.xml')),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
