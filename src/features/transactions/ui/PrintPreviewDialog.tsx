import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../../../shared/lib/useDialogFocus';

export interface PrintPreviewDialogProps {
  open: boolean;
  /** 完整打印文档(含 <style>),与真正送去打印的 HTML 完全一致。 */
  html: string;
  /** 覆盖默认标题。 */
  title?: string;
  /** 标题下方的补充说明。 */
  hint?: string;
  onPrint: () => void;
  onCancel: () => void;
}

/**
 * 打印前先看再打。
 *
 * 之前「批量打印」直接 window.open + print(),结果是用户还没看清内容系统打印框就弹出来了;
 * 而且 window.open 带了 noopener,返回值恒为 null,于是每次都被判成「弹窗被拦截」,
 * 界面永远显示一句并不成立的拦截提示。现在改成:先把同一份 HTML 放进应用内预览,
 * 用户确认后再走隐藏 iframe 打印,既不会误报拦截,也不会在没有预览的情况下弹系统框。
 */
export function PrintPreviewDialog({
  open,
  html,
  title,
  hint,
  onPrint,
  onCancel
}: PrintPreviewDialogProps) {
  const { t } = useTranslation();
  const frameTitle = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  // Escape 关闭 + 焦点收进弹层 / 关闭后还给触发按钮(原来只处理了 Escape)。
  useDialogFocus(open, dialogRef, onCancel);

  if (!open) {
    return null;
  }

  const resolvedTitle = title ?? t('txPage.print.previewTitle');
  const resolvedHint = hint ?? t('txPage.print.previewHint');

  return (
    <div className="dialog-overlay" role="presentation" onClick={onCancel}>
      <section
        ref={dialogRef}
        className="dialog dialog-print-preview"
        role="dialog"
        aria-modal="true"
        aria-label={resolvedTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">{resolvedTitle}</header>
        <div className="dialog-body dialog-print-preview-body">
          {resolvedHint ? <p className="dialog-print-preview-hint">{resolvedHint}</p> : null}
          <iframe className="dialog-print-preview-frame" title={frameTitle} srcDoc={html} />
        </div>
        <footer className="dialog-footer">
          <button type="button" onClick={onCancel}>
            {t('txPage.print.previewCancel')}
          </button>
          <button type="button" className="primary" onClick={onPrint}>
            {t('txPage.print.previewPrint')}
          </button>
        </footer>
      </section>
    </div>
  );
}
