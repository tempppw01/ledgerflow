import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
// 组件文案走 i18n,这里引入应用自己的实例,测试断言的才是真实中文文案。
import '../../../i18n';
import { PrintPreviewDialog } from './PrintPreviewDialog';

const HTML = '<!doctype html><html><body><h1>批量交易清单</h1></body></html>';

describe('PrintPreviewDialog', () => {
  it('打开时渲染预览框架与两个动作按钮', () => {
    render(<PrintPreviewDialog open html={HTML} onPrint={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // 预览用的 iframe 必须真的拿到打印文档,否则用户看到的是空白
    const frame = dialog.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('srcdoc')).toContain('批量交易清单');
  });

  it('关闭时不渲染任何内容', () => {
    const { container } = render(
      <PrintPreviewDialog open={false} html={HTML} onPrint={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('点打印/取消分别触发对应回调,Esc 等同取消', () => {
    const onPrint = vi.fn();
    const onCancel = vi.fn();
    render(<PrintPreviewDialog open html={HTML} onPrint={onPrint} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: '打印' }));
    expect(onPrint).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPrint).toHaveBeenCalledTimes(1);
  });
});
