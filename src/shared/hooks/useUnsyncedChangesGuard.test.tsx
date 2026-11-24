import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUnsyncedChangesGuard } from './useUnsyncedChangesGuard';

/**
 * 账本不在浏览器里持久化(见 useUnsyncedChangesGuard 的说明),所以「还没推上去的改动」
 * 只活在内存里。这个 guard 要在这种状态下拦住离开页面,而在同步完成时**不要**多事。
 */
function Probe({ hasUnsyncedChanges }: { hasUnsyncedChanges: boolean }) {
  useUnsyncedChangesGuard(hasUnsyncedChanges);
  return <div>内容</div>;
}

/** 派发一次 beforeunload,返回它是否被拦截(等价于浏览器会不会弹确认框)。 */
function fireBeforeUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('未同步改动的离开保护', () => {
  it('有未同步改动时,离开页面会被拦下', () => {
    render(<Probe hasUnsyncedChanges />);
    expect(fireBeforeUnload()).toBe(true);
  });

  it('没有未同步改动时不拦(不能平白无故弹确认框)', () => {
    render(<Probe hasUnsyncedChanges={false} />);
    expect(fireBeforeUnload()).toBe(false);
  });

  it('同步完成后就撤掉监听', () => {
    const { rerender, unmount } = render(<Probe hasUnsyncedChanges />);
    expect(fireBeforeUnload()).toBe(true);

    rerender(<Probe hasUnsyncedChanges={false} />);
    expect(fireBeforeUnload()).toBe(false);

    unmount();
    expect(fireBeforeUnload()).toBe(false);
  });
});