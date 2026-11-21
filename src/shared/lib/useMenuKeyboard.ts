import { useEffect, useRef, type RefObject } from 'react';
import { useFocusOrigin } from './useFocusOrigin';

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

function itemsWithin(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && !el.closest('[aria-hidden="true"]')
  );
}

/**
 * 让 `role="menu"` 真的能键盘操作。
 *
 * 现状是只标了 `role="menu"` + `role="menuitem"`:读屏器会念成菜单并期待方向键,
 * 但打开后焦点还停在触发按钮上,方向键毫无反应(实测交易页的「⋯」菜单)。
 * 这属于「语义许了诺、行为没兑现」,比不写 role 更容易误导。
 *
 * 这里补齐 WAI-ARIA 菜单按钮模式里最常用的部分:
 *   - 打开时焦点落在第一项
 *   - ↑ / ↓ 上下移动并循环,Home / End 到首尾
 *   - Escape 关闭(交给调用方),关闭后焦点回到触发按钮
 * Tab 不拦截:菜单不囚禁焦点,用户想走出去就走出去。
 */
export function useMenuKeyboard(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  onClose?: () => void
) {
  const findOrigin = useFocusOrigin(menuRef);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const menu = menuRef.current;
    if (!menu) return;

    const focusAt = (index: number) => {
      const items = itemsWithin(menu);
      if (items.length === 0) return;
      const wrapped = ((index % items.length) + items.length) % items.length;
      items[wrapped].focus();
    };

    focusAt(0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      const items = itemsWithin(menu);
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusAt(current < 0 ? 0 : current + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusAt(current < 0 ? items.length - 1 : current - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusAt(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusAt(items.length - 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const origin = findOrigin();
      const active = document.activeElement;
      const inside = menu.contains(active);
      if (origin && (active === document.body || inside)) origin.focus();
    };
  }, [open, menuRef, findOrigin]);
}