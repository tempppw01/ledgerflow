import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../lib/useDialogFocus';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLElement | null>(null);
  // Escape 关闭 + 焦点收进弹层 / 关闭后还给触发按钮。
  useDialogFocus(open, dialogRef, onCancel);

  if (!open) {
    return null;
  }

  const resolvedConfirmText = confirmText ?? t('confirmDialog.confirm');
  const resolvedCancelText = cancelText ?? t('confirmDialog.cancel');

  return (
    <div className="dialog-overlay" role="presentation" onClick={onCancel}>
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">{title}</header>
        <div className="dialog-body">{description}</div>
        <footer className="dialog-footer">
          <button type="button" onClick={onCancel}>
            {resolvedCancelText}
          </button>
          <button
            type="button"
            className={danger ? 'danger' : 'primary'}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {resolvedConfirmText}
          </button>
        </footer>
      </section>
    </div>
  );
}
