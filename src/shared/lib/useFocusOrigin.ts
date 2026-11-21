import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** 弹层内部的元素不算「来源」:判 aria-modal/role,而不只看自己的容器 —— 见下方注释。 */
const OPENER_IGNORE_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"]';

/**
 * 记住「是谁打开的弹层」,关闭时好把焦点还回去。
 *
 * 两个坑:
 *  1. 弹层里的输入框常在同一个提交里就 autoFocus,等打开时的 effect 跑起来,焦点已经在弹层内部。
 *     所以这里常驻监听 `focusin`,只记落在弹层之外的目标。
 *  2. 从行内菜单点「删除」时,菜单随弹层打开而卸载,来源节点没了。所以记最近若干个,
 *     取「最近的、仍然挂在文档里的」那个,于是会退回菜单的触发按钮。
 */
export function useFocusOrigin(containerRef: RefObject<HTMLElement | null>) {
  const stackRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(OPENER_IGNORE_SELECTOR)) return;
      const container = containerRef.current;
      if (container && container.contains(target)) return;
      const stack = stackRef.current;
      if (stack.at(-1) === target) return;
      stack.push(target);
      if (stack.length > 4) stack.shift();
    };

    const initial = document.activeElement;
    if (initial instanceof HTMLElement && !initial.closest(OPENER_IGNORE_SELECTOR)) {
      stackRef.current.push(initial);
    }
    document.addEventListener('focusin', onFocusIn, true);
    return () => document.removeEventListener('focusin', onFocusIn, true);
  }, [containerRef]);

  /**
   * 必须稳定:调用方把它放进 effect 依赖。如果每次渲染都是新函数,
   * effect 会在每次重渲染时重跑,菜单/弹层里的焦点会被反复拽回第一个元素
   * (表现就是「方向键按了没反应」)。
   */
  const findOrigin = useCallback(
    () => [...stackRef.current].reverse().find((el) => el.isConnected) || null,
    []
  );

  return findOrigin;
}