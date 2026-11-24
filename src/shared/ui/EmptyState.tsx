import { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /**
   * 需要更多次级入口时用这个(例如空交易列表里要同时给出「导入微信账单」「导入支付宝账单」)。
   * 与 secondaryAction 并存:先渲染 secondaryAction,再渲染这一组。
   */
  secondaryActions?: EmptyStateAction[];
}

function renderAction(action: EmptyStateAction, key: string) {
  const className = action.variant === 'primary' ? 'primary' : action.variant === 'danger' ? 'danger' : undefined;
  return (
    <button key={key} type="button" className={className} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  icon = '📭',
  className,
  primaryAction,
  secondaryAction,
  secondaryActions
}: EmptyStateProps) {
  return (
    <div className={cn('empty-state', className)}>
      <div className="empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {primaryAction || secondaryAction || (secondaryActions && secondaryActions.length > 0) ? (
        <div className="row empty-state-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
          {secondaryAction ? renderAction(secondaryAction, 'secondary') : null}
          {(secondaryActions ?? []).map((action, index) => renderAction(action, 'secondary-' + index))}
          {primaryAction ? renderAction(primaryAction, 'primary') : null}
        </div>
      ) : null}
    </div>
  );
}
