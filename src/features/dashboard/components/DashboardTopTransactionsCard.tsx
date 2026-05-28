import { useState } from 'react';
import { formatCurrency } from '../../../shared/lib/format';

export interface DashboardTopTransactionsCardProps {
  items: Array<{
    date: string;
    category: string;
    note: string;
    amount: number;
  }>;
}

const COLLAPSED_TOP_TRANSACTION_COUNT = 2;

function formatTopTransactionDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value.slice(0, 10) || value;
  }

  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hour}:${minute}`;
}

export function DashboardTopTransactionsCard({ items }: DashboardTopTransactionsCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleItems = isExpanded ? items : items.slice(0, COLLAPSED_TOP_TRANSACTION_COUNT);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="dashboard-core-top-list">
      <div className="dashboard-section-header">
        <h4>本月大额 TOP</h4>
        <span>{items.length} 笔值得回看</span>
      </div>
      <div className="dashboard-top-list">
        {visibleItems.map((item, index) => (
          <article key={`${item.date}-${index}`} className="dashboard-top-item">
            <div>
              <p className="dashboard-top-title">
                <span>{item.category || '未分类'}</span>
                <time dateTime={item.date}>{formatTopTransactionDate(item.date)}</time>
              </p>
              <p className="dashboard-top-note">{item.note || '没写备注'}</p>
            </div>
            <strong>{formatCurrency(item.amount)}</strong>
          </article>
        ))}
      </div>
      {items.length > COLLAPSED_TOP_TRANSACTION_COUNT ? (
        <button
          type="button"
          className="dashboard-top-toggle"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? '收起' : `展开 ${hiddenCount} 笔`}
        </button>
      ) : null}
    </div>
  );
}
