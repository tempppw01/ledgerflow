import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * 错误边界的行为:
 *  · 子组件正常时原样渲染,不插任何东西;
 *  · 子组件抛错时渲染兜底界面,并给出「重新加载」;
 *  · 抛出的错误**不会**冒到外面(否则整棵树还是会卸载,那这个边界就白写了)。
 */
function Boom(): never {
  throw new Error('渲染炸了');
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('正常时原样渲染子组件', () => {
    render(
      <ErrorBoundary>
        <div>账本内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('账本内容')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('子组件抛错时显示兜底界面(而不是白屏)', () => {
    // React 会把捕获的错误也打一份到 console.error,这里静音掉,免得测试输出被刷屏
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('页面出错了');
    expect(alert.textContent).toContain('重新加载');
    // 失败详情里能看到具体信息,方便排查
    expect(alert.textContent).toContain('渲染炸了');
  });

  it('组件自己记日志(不静默吞掉)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    const logged = spy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('渲染出错');
  });
});