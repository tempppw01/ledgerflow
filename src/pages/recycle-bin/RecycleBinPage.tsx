import { useEffect, useMemo, useState } from 'react';
import { AWESOME_ILLUSTRATION_URL } from '../../shared/config/brandAssets';
import { formatCurrencyFixed2, formatDateTime } from '../../shared/lib/format';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { EmptyState } from '../../shared/ui/EmptyState';

const PAGE_SIZE = 10;

type RecycleBinEntryKind = 'transaction' | 'category' | 'account' | 'subscription';

interface RecycleBinEntry {
  id: string;
  kind: RecycleBinEntryKind;
  kindLabel: string;
  title: string;
  meta: string[];
  sortTime: number;
}

export function RecycleBinPage() {
  const trashedTransactions = useFinanceStore((s) => s.trashedTransactions);
  const trashedCategories = useFinanceStore((s) => s.trashedCategories);
  const trashedAccounts = useFinanceStore((s) => s.trashedAccounts);
  const trashedSubscriptions = useFinanceStore((s) => s.trashedSubscriptions);
  const restoreTransaction = useFinanceStore((s) => s.restoreTransaction);
  const permanentlyDeleteTransaction = useFinanceStore((s) => s.permanentlyDeleteTransaction);
  const restoreCategory = useFinanceStore((s) => s.restoreCategory);
  const permanentlyDeleteCategory = useFinanceStore((s) => s.permanentlyDeleteCategory);
  const restoreAccount = useFinanceStore((s) => s.restoreAccount);
  const permanentlyDeleteAccount = useFinanceStore((s) => s.permanentlyDeleteAccount);
  const restoreSubscription = useFinanceStore((s) => s.restoreSubscription);
  const permanentlyDeleteSubscription = useFinanceStore((s) => s.permanentlyDeleteSubscription);
  const clearRecycleBin = useFinanceStore((s) => s.clearRecycleBin);
  const [page, setPage] = useState(1);

  const totalCount =
    trashedTransactions.length +
    trashedCategories.length +
    trashedAccounts.length +
    trashedSubscriptions.length;

  const allItems = useMemo<RecycleBinEntry[]>(
    () =>
      [
        ...trashedTransactions.map((item) => ({
          id: item.id,
          kind: 'transaction' as const,
          kindLabel: '交易',
          title: item.note || '未命名交易',
          meta: [
            item.type,
            formatCurrencyFixed2(item.amount),
            `删除于 ${formatDateTime(item.trashedAt || item.updatedAt || item.date)}`
          ],
          sortTime: new Date(item.trashedAt || item.updatedAt || item.date).getTime()
        })),
        ...trashedCategories.map((item) => ({
          id: item.id,
          kind: 'category' as const,
          kindLabel: '分类',
          title: `${item.icon ? `${item.icon} ` : ''}${item.name}`,
          meta: [
            item.kind || '未设置类型',
            `删除于 ${formatDateTime(item.trashedAt || new Date().toISOString())}`
          ],
          sortTime: new Date(item.trashedAt || 0).getTime()
        })),
        ...trashedAccounts.map((item) => ({
          id: item.id,
          kind: 'account' as const,
          kindLabel: '账户',
          title: item.name,
          meta: [
            formatCurrencyFixed2(Number(item.balance ?? item.initialBalance ?? 0)),
            `删除于 ${formatDateTime(item.trashedAt || new Date().toISOString())}`
          ],
          sortTime: new Date(item.trashedAt || 0).getTime()
        })),
        ...trashedSubscriptions.map((item) => ({
          id: item.id,
          kind: 'subscription' as const,
          kindLabel: '订阅',
          title: item.name,
          meta: [
            `${formatCurrencyFixed2(Number(item.amount ?? 0))} ${item.currency || 'CNY'}`,
            item.provider || '未设置服务商',
            `删除于 ${formatDateTime(item.trashedAt || item.updatedAt || new Date().toISOString())}`
          ],
          sortTime: new Date(item.trashedAt || 0).getTime()
        }))
      ].sort((a, b) => b.sortTime - a.sortTime),
    [trashedAccounts, trashedCategories, trashedSubscriptions, trashedTransactions]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pagedItems = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, totalCount);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const handleRestore = (item: RecycleBinEntry) => {
    switch (item.kind) {
      case 'transaction':
        restoreTransaction(item.id);
        return;
      case 'category':
        restoreCategory(item.id);
        return;
      case 'account':
        restoreAccount(item.id);
        return;
      case 'subscription':
        restoreSubscription(item.id);
        return;
      default:
        return;
    }
  };

  const handlePermanentDelete = (item: RecycleBinEntry) => {
    switch (item.kind) {
      case 'transaction':
        permanentlyDeleteTransaction(item.id);
        return;
      case 'category':
        permanentlyDeleteCategory(item.id);
        return;
      case 'account':
        permanentlyDeleteAccount(item.id);
        return;
      case 'subscription':
        permanentlyDeleteSubscription(item.id);
        return;
      default:
        return;
    }
  };

  const handleClearRecycleBin = () => {
    if (totalCount === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认清空回收站吗？将永久删除其中的 ${totalCount} 项内容，且无法恢复。`
    );
    if (!confirmed) {
      return;
    }

    clearRecycleBin();
    setPage(1);
  };

  return (
    <section className="panel recycle-bin-page vi-page">
      <div className="recycle-bin-header">
        <div>
          <h2>回收站</h2>
          <p className="muted">
            删除的交易、分类、账户和订阅会先进入这里。回收站每页最多显示 10 条，可翻页查看。
          </p>
        </div>
        <div className="recycle-bin-header-actions">
          <span className="metric-chip">
            共 <strong>{totalCount}</strong> 项
          </span>
          <button
            type="button"
            className="danger"
            disabled={totalCount === 0}
            onClick={handleClearRecycleBin}
          >
            清空回收站
          </button>
        </div>
      </div>

      {totalCount === 0 ? (
        <EmptyState
          className="recycle-bin-empty-state"
          title="回收站为空"
          description="删除的内容会先进入回收站，避免误删后无法找回。"
          icon={
            <img
              className="recycle-bin-empty-illustration"
              src={AWESOME_ILLUSTRATION_URL}
              alt=""
            />
          }
        />
      ) : (
        <>
          <div className="recycle-bin-summary" aria-label="回收站统计">
            <article className="recycle-bin-stat">
              <span>交易</span>
              <strong>{trashedTransactions.length}</strong>
            </article>
            <article className="recycle-bin-stat">
              <span>分类</span>
              <strong>{trashedCategories.length}</strong>
            </article>
            <article className="recycle-bin-stat">
              <span>账户</span>
              <strong>{trashedAccounts.length}</strong>
            </article>
            <article className="recycle-bin-stat">
              <span>订阅</span>
              <strong>{trashedSubscriptions.length}</strong>
            </article>
          </div>

          <div className="recycle-bin-list" aria-label="回收站列表">
            {pagedItems.map((item) => (
              <article key={`${item.kind}-${item.id}`} className="recycle-bin-item">
                <div className="recycle-bin-item-main">
                  <span className={`recycle-bin-tag is-${item.kind}`}>{item.kindLabel}</span>
                  <strong>{item.title}</strong>
                  <div className="recycle-bin-meta">
                    {item.meta.map((meta, index) => (
                      <span key={`${item.id}-meta-${index}`}>{meta}</span>
                    ))}
                  </div>
                </div>
                <div className="recycle-bin-actions">
                  <button type="button" onClick={() => handleRestore(item)}>
                    恢复
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handlePermanentDelete(item)}
                  >
                    彻底删除
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="recycle-bin-pagination">
            <small className="muted">
              显示第 {pageStart}-{pageEnd} 条，共 {totalCount} 条，每页 10 条
            </small>
            <div className="recycle-bin-pagination-controls">
              <button type="button" disabled={page === 1} onClick={() => setPage(1)}>
                第一页
              </button>
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <small className="muted">
                第 {page} / {totalPages} 页
              </small>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                下一页
              </button>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage(totalPages)}
              >
                最后一页
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
