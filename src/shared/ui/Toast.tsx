import { useEffect } from 'react';
import { cn } from '../lib/cn';

export type ToastVariant = 'success' | 'error' | 'warning';

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  visible: boolean;
  duration?: number;
  onClose: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

export function Toast({
  message,
  variant = 'success',
  visible,
  duration = 2200,
  onClose,
  actionLabel,
  onAction
}: ToastProps) {
  useEffect(() => {
    if (!visible) {
      return;
    }

    const timer = window.setTimeout(() => {
      onClose();
    }, duration);

    return () => window.clearTimeout(timer);
  }, [visible, duration, onClose]);

  if (!visible) {
    return null;
  }

  return (
    <div className={cn('toast', `toast-${variant}`)} role="status" aria-live="polite">
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onAction();
            onClose();
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
