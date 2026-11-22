import { useCallback, useEffect, useRef } from 'react';

/**
 * 受管理的「延迟清除状态」定时器。
 *
 * 这类定时器到处都是同一个形态:操作完成后显示一条提示,过几秒自动收起 ——
 * `setTimeout(() => setStatus(''), 2400)`。裸写有两个问题:
 *
 * 1. **卸载后仍在跑**。用户(或测试)在这几秒内离开页面,回调会在已卸载的组件上
 *    触发 setState。测试环境里表现为 `ReferenceError: window is not defined` 的
 *    unhandled error —— **测试全过、CI 却红**,还款管理页已经因此红过一次(56adde2)。
 * 2. **同一个 key 会堆积**。连续触发两次(例如连点两次导出)会留下两个回调,
 *    前一个把后一个刚显示的提示清掉。
 *
 * 这个 hook 把两件事一起解决:按 key 覆盖旧的,卸载时全部清掉。
 *
 * ```ts
 * const { schedule } = useStatusTimers();
 * // 3 秒后自动收起提示;期间再次调用会先撤掉上一次
 * schedule('saved', () => setSavedVisible(false), 3000);
 * ```
 *
 * 注意:被调度的回调只在**组件仍然挂载**时执行。卸载后即使定时器已到点也不会执行,
 * 因为清理发生在卸载那一刻。
 */
export function useStatusTimers() {
  const timersRef = useRef<Map<string, number>>(new Map());

  // 卸载标记:清空 Map 后,已经进入队列、但尚未执行的回调不再执行。
  const unmountedRef = useRef(false);

  useEffect(
    () => () => {
      unmountedRef.current = true;
      timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      timersRef.current.clear();
    },
    []
  );

  /**
   * 延迟执行 `task`。同一个 key 再次调度会先撤掉上一次。
   * 返回一个取消函数,便于调用方提前撤销(例如提示被用户手动关掉)。
   */
  const schedule = useCallback((key: string, task: () => void, delayMs: number) => {
    const previous = timersRef.current.get(key);
    if (previous !== undefined) {
      window.clearTimeout(previous);
    }

    const timerId = window.setTimeout(() => {
      timersRef.current.delete(key);
      if (unmountedRef.current) return;
      task();
    }, delayMs);
    timersRef.current.set(key, timerId);

    return () => {
      const pending = timersRef.current.get(key);
      if (pending !== undefined) {
        window.clearTimeout(pending);
        timersRef.current.delete(key);
      }
    };
  }, []);

  /** 立即撤销某个 key 上尚未执行的调度。 */
  const cancel = useCallback((key: string) => {
    const pending = timersRef.current.get(key);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      timersRef.current.delete(key);
    }
  }, []);

  return { schedule, cancel };
}
