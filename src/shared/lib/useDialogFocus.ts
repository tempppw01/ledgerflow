import { useEffect, useRef, type RefObject } from 'react';

const OPENER_IGNORE_SELECTOR = '[role="dialog"], [aria-modal="true"]';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden') || el.closest('[aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  // 不用 offsetParent 判断可见性:jsdom 没有布局,offsetParent 恒为 null,
  // 那样在测试里会把所有元素都过滤掉(焦点于是退回到容器上)。
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable);
}

/**
 * 把焦点收进弹层,并在关闭时还给打开它的那个按钮。
 *
 * 只写 `role="dialog" aria-modal="true"` 是不够的:读屏器会念出弹层,
 * 但键盘焦点仍停在背后的页面上,Tab 能一路走到被遮住的按钮;关闭后焦点
 * 掉到 body,键盘用户得从页首重新 Tab 一遍。
 *
 * 这个 hook 做三件事:
 *   1. 打开时把焦点移进弹层(优先第一个可聚焦元素)
 *   2. Tab / Shift+Tab 在弹层内循环
 *   3. 关闭时把焦点还给打开前的那个元素
 *
 * 「打开前的元素」不能直接在打开时的 effect 里读 `document.activeElement`:
 * 弹层里的输入框往往在同一个提交里就 autoFocus 了,等 effect 跑起来焦点已经在
 * 弹层内部(实测交易页的快速记账会把表达式输入框 focus 掉,于是记下的「来源」
 * 是一个马上要被卸载的 textarea,关闭后焦点只能掉到 body)。所以关闭状态下
 * 持续记录最后一次落在弹层外的 focusin。
 */
export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onEscape?: () => void
) {
  /**
   * 最近几个「弹层外」的焦点目标。只记一个不够:从行内菜单里点「删除」时,
   * 菜单随弹层打开而卸载,那个来源节点已经不在了,关闭后焦点只能掉到 body。
   * 记一串就有机会退回菜单的触发按钮。
   */
  const openerStackRef = useRef<HTMLElement[]>([]);
  // 最近的、仍然挂在文档里的来源。菜单项这类会随弹层卸载,于是退回上一级触发按钮。
  const findOpener = () =>
    [...openerStackRef.current].reverse().find((el) => el.isConnected) || null;

  /**
   * onEscape 通常写成内联箭头函数,每次渲染都是新引用。放进依赖数组会让
   * 输入框里每敲一个字都触发一次「清理 + 重新聚焦」,光标被拽回第一个控件。
   * 所以用 ref 存最新值,依赖只留 open 与稳定的 ref 对象。
   */
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  // 常驻监听:记录最后一次「落在弹层外」的焦点元素。
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // 弹层内部的焦点不算来源。这里判 aria-modal/role 而不是只看自己的容器:
      // 弹层里的输入框常在同一提交里就 autoFocus,那一刻容器 ref 可能还没挂上,
      // 于是「来源」会被记成一个马上要卸载的 textarea,关闭后焦点只能掉到 body。
      if (target.closest(OPENER_IGNORE_SELECTOR)) return;
      const container = containerRef.current;
      if (container && container.contains(target)) return;
      const stack = openerStackRef.current;
      if (stack.at(-1) === target) return;
      stack.push(target);
      if (stack.length > 4) stack.shift();
    };

    const initial = document.activeElement;
    if (initial instanceof HTMLElement && !initial.closest(OPENER_IGNORE_SELECTOR)) {
      openerStackRef.current.push(initial);
    }
    document.addEventListener('focusin', onFocusIn, true);
    return () => document.removeEventListener('focusin', onFocusIn, true);
  }, [containerRef]);

  // 打开状态:收拢焦点、Tab 循环。
  useEffect(() => {
    if (!open) return;

    // 打开期间容器不变;先取出来,cleanup 里再读 ref 会拿到已经变成 null 的值。
    const container = containerRef.current;

    if (container) {
      const first = focusableWithin(container)[0];
      // 没有可聚焦元素时退回容器本身,保证 Tab 起点在弹层里。
      if (first) first.focus();
      else {
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      if (!container) return;
      const items = focusableWithin(container);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;

      // 焦点已经跑到弹层外(比如点了遮罩)时,把它拽回来。
      if (!(current instanceof HTMLElement) || !container.contains(current)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const opener = findOpener();
      // 只在焦点仍留在弹层(或已随弹层被移除)时才拉回,避免打断用户主动的跳转。
      const current = document.activeElement;
      const stillInside = container ? container.contains(current) : true;
      if (opener && opener.isConnected && (current === document.body || stillInside)) {
        opener.focus();
      }
    };
  }, [open, containerRef]);
}