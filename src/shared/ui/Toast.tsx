import { useEffect, useRef } from 'react';
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
  // Keep the latest handler without letting re-renders restart the countdown.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, duration);

    return () => window.clearTimeout(timer);
  }, [visible, duration]);

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
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
