import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { joinDocumentTitle, useDocumentTitle } from './documentTitle';
import zh from '../../i18n/locales/zh/translation.json';

/*
 * 文档标题的写入这一层。
 *
 * 为什么单独有用例:助手工作区的名字是**动态的**(跟着当前工作区变,而工作区按标签页存在
 * sessionStorage 里),所以它不能只由路由表决定 —— useDocumentTitle 允许调用方把页面名
 * 传进来。标签标题不跟着走的话,两个停在不同工作区的标签会同名(「AI 助手」),
 * 而 WCAG 2.4.2 要的正是"能靠标题分清页面"。
 */
const appName = zh.app.title;

afterEach(() => {
  document.title = '';
});

describe('useDocumentTitle', () => {
  it('不传页面名时,用路由表解析出来的标题', () => {
    renderHook(() => useDocumentTitle('/investments'));
    expect(document.title).toBe(`${zh.nav.investments} · ${appName}`);
  });

  it('传了页面名时,以它为准(助手工作区用这条)', () => {
    renderHook(() => useDocumentTitle('/assistant', 'AI 投资助手'));
    expect(document.title).toBe(`AI 投资助手 · ${appName}`);
    expect(document.title).not.toContain(zh.nav.assistant + ' ·');
  });

  it('页面名变了,标题跟着变(切换工作区)', () => {
    const { rerender } = renderHook(
      ({ name }: { name: string }) => useDocumentTitle('/assistant', name),
      { initialProps: { name: 'AI 投资助手' } }
    );
    expect(document.title).toBe(`AI 投资助手 · ${appName}`);

    rerender({ name: 'AI 信贷管家' });
    expect(document.title).toBe(`AI 信贷管家 · ${appName}`);
  });

  it('joinDocumentTitle 只做拼接,不重复应用名', () => {
    const t = (key: string, fallback: string) => (key === 'app.title' ? appName : fallback);
    expect(joinDocumentTitle('记一笔', t)).toBe(`记一笔 · ${appName}`);
  });
});
