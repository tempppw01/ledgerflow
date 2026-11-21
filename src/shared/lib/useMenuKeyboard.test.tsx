import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useMenuKeyboard } from './useMenuKeyboard';

/**
 * `role="menu"` 必须配方向键,否则读屏器念成菜单、方向键却没反应。
 * 这里用一个最小菜单把行为钉住。
 */
function MenuHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  useMenuKeyboard(open, menuRef, close);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        更多操作
      </button>
      {open ? (
        <div ref={menuRef} role="menu" aria-label="行操作">
          <button type="button" role="menuitem">
            查看详情
          </button>
          <button type="button" role="menuitem">
            编辑
          </button>
          <button type="button" role="menuitem">
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

describe('useMenuKeyboard', () => {
  it('打开后焦点落在第一项,方向键上下移动并循环', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    fireEvent.click(trigger);

    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('Home / End 跳到首尾', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');

    fireEvent.keyDown(window, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.keyDown(window, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('Escape 关闭菜单并把焦点还给触发按钮', () => {
    let closed = 0;
    render(<MenuHarness onClose={() => (closed += 1)} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(closed).toBe(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});