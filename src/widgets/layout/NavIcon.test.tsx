import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavIcon } from './NavIcon';

/*
 * 导航图标来自 CDN,失败时**不能只剩一个空框**。
 * 实测依据:2026-11-28 界面审计抓到 `500 GET /cdn/ui/calendar.svg` 等 4 个图标请求失败,
 * 而那期间侧栏的那个位置是空的(每个导航项带的字形从来没被用过)。
 */
describe('NavIcon', () => {
  it('正常情况下渲染 CDN 图标,并把它当装饰丢掉可访问名', () => {
    const { container } = render(<NavIcon src="/cdn/ui/chat.svg" fallback="🤖" />);

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', '/cdn/ui/chat.svg');
    // alt="" —— 名字由旁边的文字给,图标不该再念一遍
    expect(image).toHaveAttribute('alt', '');
    expect(screen.queryByText('🤖')).not.toBeInTheDocument();
  });

  it('图标请求失败时退回到字形,而不是留一个空框', () => {
    const { container } = render(<NavIcon src="/cdn/ui/chat.svg" fallback="🤖" />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    const fallback = screen.getByText('🤖');
    expect(fallback).toHaveClass('nav-icon-fallback');
    expect(fallback).toHaveAttribute('aria-hidden', 'true');
  });

  it('换了一个图标地址就重新试一次(回收站图标会跟着条目数切换)', () => {
    const { container, rerender } = render(<NavIcon src="/cdn/ui/trash.svg" fallback="🗑️" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByText('🗑️')).toBeInTheDocument();

    rerender(<NavIcon src="/cdn/ui/trash-2.svg" fallback="🗑️" />);

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', '/cdn/ui/trash-2.svg');
    expect(screen.queryByText('🗑️')).not.toBeInTheDocument();
  });

  it('同一个地址失败后不再反复重试(避免失败图标抖动)', () => {
    const { container, rerender } = render(<NavIcon src="/cdn/ui/chat.svg" fallback="🤖" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    rerender(<NavIcon src="/cdn/ui/chat.svg" fallback="🤖" />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('🤖')).toBeInTheDocument();
  });
});
