import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatDate } from '../../shared/lib/format';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { EmptyState } from '../../shared/ui/EmptyState';

interface TagGroup {
  key: string;
  label: string;
  rows: ReturnType<typeof useFinanceStore.getState>['transactions'];
}

function buildTransactionsLink(tag: string, highlightId?: string): string {
  const params = new URLSearchParams();
  params.set('keyword', tag);
  if (highlightId) {
    params.set('highlight', highlightId);
  }
  return `/transactions?${params.toString()}`;
}

export function TagsPage() {
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);

  const groups = useMemo(() => {
    const map = new Map<string, TagGroup>();

    transactions.forEach((tx) => {
      tx.tags.forEach((raw) => {
        const label = String(raw || '').trim();
        if (!label) {
          return;
        }

        const key = label.toLowerCase();
        const found = map.get(key);
        if (found) {
          found.rows.push(tx);
          return;
        }

        map.set(key, {
          key,
          label,
          rows: [tx]
        });
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      if (b.rows.length !== a.rows.length) {
        return b.rows.length - a.rows.length;
      }
      return a.label.localeCompare(b.label, 'zh-CN');
    });
  }, [transactions]);

  return (
    <section className="panel tags-page vi-page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🏷️ 交易标签</h2>
        <small style={{ color: 'var(--color-text-secondary)' }}>共 {groups.length} 个标签</small>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="暂无标签数据" description="先通过交易详情或 AI 助手写入标签后，这里会自动聚合展示。" icon="🏷️" />
      ) : (
        <div className="tags-grid">
          {groups.map((group) => (
            <article className="tag-panel" key={group.key}>
              <header className="tag-panel-header">
                <span className="tag">#{group.label}</span>
                <small>{group.rows.length} 条</small>
              </header>

              <div className="row" style={{ marginBottom: 10 }}>
                <Link to={buildTransactionsLink(group.label)}>
                  <button type="button">查看全部</button>
                </Link>
              </div>

              <div className="tag-panel-list">
                {group.rows.slice(0, 6).map((tx) => {
                  const categoryName = categories.find((c) => c.id === tx.categoryId)?.name ?? '-';
                  return (
                    <div key={tx.id} className="tag-panel-item">
                      <div>
                        <strong>{formatDate(tx.date)}</strong>
                        <p>
                          {categoryName} · {tx.note || '-'}
                        </p>
                      </div>
                      <div className="tag-panel-actions">
                        <strong>{formatCurrency(tx.amount)}</strong>
                        <Link to={buildTransactionsLink(group.label, tx.id)}>定位详情</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
