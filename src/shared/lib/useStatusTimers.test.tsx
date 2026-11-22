import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStatusTimers } from './useStatusTimers';

/**
 * 这一组测试盯的是「卸载后仍在跑的定时器」——
 * 它是 CI 上「测试全过但闸门红」的成因(还款管理页 56adde2 已中过一次)。
 */
describe('useStatusTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('到点后执行任务', () => {
    const { result } = renderHook(() => useStatusTimers());
    const task = vi.fn();

    act(() => {
      result.current.schedule('saved', task, 2400);
    });

    expect(task).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2399);
    });
    expect(task).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('同一个 key 再次调度会撤掉上一次,不会留下两个回调', () => {
    const { result } = renderHook(() => useStatusTimers());
    const first = vi.fn();
    const second = vi.fn();

    act(() => {
      result.current.schedule('webdav', first, 2400);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 1000ms 时又触发了一次(例如连点两次导出)
    act(() => {
      result.current.schedule('webdav', second, 2400);
    });
    act(() => {
      vi.advanceTimersByTime(2400);
    });

    // 只有后一次生效:否则第一个回调会把第二个刚显示的提示清掉
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('不同 key 互不影响', () => {
    const { result } = renderHook(() => useStatusTimers());
    const a = vi.fn();
    const b = vi.fn();

    act(() => {
      result.current.schedule('a', a, 1000);
      result.current.schedule('b', b, 2000);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('卸载后到点的回调不再执行 —— 否则会在已销毁的环境上 setState', () => {
    const { result, unmount } = renderHook(() => useStatusTimers());
    const task = vi.fn();

    act(() => {
      result.current.schedule('saved', task, 2400);
    });
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    }).not.toThrow();
    expect(task).not.toHaveBeenCalled();
  });

  it('cancel 可提前撤销,且撤销后到点也不会执行', () => {
    const { result } = renderHook(() => useStatusTimers());
    const task = vi.fn();

    act(() => {
      const cancel = result.current.schedule('saved', task, 1000);
      cancel();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(task).not.toHaveBeenCalled();
  });

  it('取消函数在任务已执行后调用是安全的', () => {
    const { result } = renderHook(() => useStatusTimers());
    const task = vi.fn();
    let cancel: (() => void) | null = null;

    act(() => {
      cancel = result.current.schedule('saved', task, 100);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(task).toHaveBeenCalledTimes(1);

    expect(() => {
      act(() => {
        cancel?.();
      });
    }).not.toThrow();
  });
});
