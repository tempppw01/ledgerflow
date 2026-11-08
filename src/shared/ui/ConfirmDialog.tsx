import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const resolvedConfirmText = confirmText ?? t('confirmDialog.confirm');
  const resolvedCancelText = cancelText ?? t('confirmDialog.cancel');

  return (
    <div className="dialog-overlay" role="presentation" onClick={onCancel}>
      <section
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
