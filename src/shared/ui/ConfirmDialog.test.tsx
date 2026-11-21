import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * 弹层的键盘可达性。
 *
 * 只写 `role="dialog" aria-modal="true"` 时,读屏器会念出弹层,但焦点仍停在
 * 背后的页面上、Tab 能走到被遮住的按钮、关闭后焦点掉到 body。这三条都在这里钉住。
 */
function Harness() {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        删除交易
      </button>
      <span>{closed ? 'closed' : 'open'}</span>
      <ConfirmDialog
        open={open}
        title="确认删除"
        description="该交易会被移入回收站。"
        onConfirm={() => {
          setOpen(false);
          setClosed(true);
        }}
        onCancel={() => {
          setOpen(false);
          setClosed(true);
        }}
      />
    </div>
  );
}

describe('ConfirmDialog focus management', () => {
  it('打开时把焦点移进弹层,关闭后还给触发按钮', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '删除交易' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape 关闭弹层并把焦点还给触发按钮', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '删除交易' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab 在弹层内循环,不会跑到背后的按钮上', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '删除交易' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认' });

    // 焦点当前在第一个可聚焦元素(取消)上。
    expect(document.activeElement).toBe(cancel);

    // 从末尾继续 Tab 应该回到第一个,而不是走到弹层外的触发按钮。
    confirm.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab 从第一个回到最后一个。
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});