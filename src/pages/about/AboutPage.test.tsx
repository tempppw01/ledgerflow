import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { APP_GITHUB_URL, APP_VERSION } from '../../shared/config/app';
import { RELEASE_HISTORY } from './recentReleases.generated';
import { AboutPage } from './AboutPage';

/**
 * 这里**故意用真的 i18n 实例**(`src/test/setup.ts` 把语言固定成 zh),
 * 而不是把 `useTranslation` mock 掉:
 *   · 断言的是"用户真的会看到什么",包括文案本身;
 *   · key 写错或漏了 zh 时这里会直接露出 key(它的名字是代码里的字面量)。
 *
 * 版本号在页面上出现两次(页头统计块 + 最近更新列表),所以列表内的断言一律先
 * 拿区块元素再 `within()` —— 否则 `getByText('v0.51.0')` 会因为多个匹配直接失败。
 */
function releaseSection() {
  const section = document.getElementById('about-releases-heading')?.closest('section');
  if (!section) throw new Error('没有找到「最近更新」区块');
  return section as HTMLElement;
}

describe('AboutPage 最近更新', () => {
  it('把每个版本都渲染出来,并只给当前版本打标', () => {
    render(<AboutPage />);

    const items = screen
      .getAllByRole('listitem')
      .filter((item) => item.classList.contains('about-release-item'));
    expect(items).toHaveLength(RELEASE_HISTORY.length);

    const list = within(releaseSection());
    for (const release of RELEASE_HISTORY) {
      expect(list.getByText(`v${release.version}`)).toBeInTheDocument();
    }

    const badges = list.getAllByText('当前版本');
    expect(badges).toHaveLength(1);
    const current = badges[0].closest('li') as HTMLElement;
    expect(within(current).getByText(`v${APP_VERSION}`)).toBeInTheDocument();
  });

  it('标题与摘要来自数据', () => {
    render(<AboutPage />);
    const first = RELEASE_HISTORY[0];
    const list = within(releaseSection());
    expect(list.getByText(first.title)).toBeInTheDocument();
    expect(list.getByText(first.summary)).toBeInTheDocument();
  });

  it('每条都有通往对应 tag 的、可区分的链接', () => {
    render(<AboutPage />);
    const list = within(releaseSection());

    for (const release of RELEASE_HISTORY) {
      const link = list.getByRole('link', {
        name: `查看 v${release.version} 的完整说明`
      });
      expect(link).toHaveAttribute('href', `${APP_GITHUB_URL}/releases/tag/v${release.version}`);
    }
  });

  it('发布日期渲染成 <time datetime>,文本按本地日算(不走 UTC)', () => {
    render(<AboutPage />);

    const dated = RELEASE_HISTORY.filter((entry) => entry.publishedOn);
    expect(dated.length).toBeGreaterThan(0);

    for (const release of dated) {
      const node = releaseSection().querySelector(`time[datetime="${release.publishedOn}"]`);
      expect(node).not.toBeNull();
      const [year, month, day] = String(release.publishedOn).split('-').map(Number);
      const expected = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(new Date(year, month - 1, day));
      expect(node?.textContent).toBe(expected);
    }
  });

  it('是静态内容:没有 aria-live / role=status,不该被读屏反复播报', () => {
    render(<AboutPage />);
    const section = releaseSection();
    expect(section.querySelector('[aria-live]')).toBeNull();
    expect(section.querySelector('[role="status"]')).toBeNull();
  });

  it('保留既有的版本信息与检查更新入口', () => {
    render(<AboutPage />);
    expect(screen.getAllByText(`v${APP_VERSION}`).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '检查更新' }).length).toBeGreaterThan(0);
  });
});
