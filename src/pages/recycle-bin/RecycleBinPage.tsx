import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
  /*
   * 只用来算「彻底删除某个账户会连带影响多少笔交易」。
   * 之所以要算:账户被彻底删除后,引用它的交易在**下一次同步**时会被服务端静默丢弃
   * (导入器会丢掉引用无法解析的行),这是用户在回收站里看不到的后果。
   */
  const transactions = useFinanceStore((s) => s.transactions);
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
          kindLabel: t('recycleBin.kinds.transaction'),
          title: item.note || t('recycleBin.transaction.unnamed'),
          meta: [
            t(`recycleBin.transactionTypes.${item.type}`, { defaultValue: item.type }),
            formatCurrencyFixed2(item.amount),
            t('recycleBin.transaction.deletedAt', {
              date: formatDateTime(item.trashedAt || item.updatedAt || item.date)
            })
          ],
          sortTime: new Date(item.trashedAt || item.updatedAt || item.date).getTime()
        })),
        ...trashedCategories.map((item) => ({
          id: item.id,
          kind: 'category' as const,
          kindLabel: t('recycleBin.kinds.category'),
          title: `${item.icon ? `${item.icon} ` : ''}${item.name}`,
          meta: [
            item.kind || t('recycleBin.category.unsetKind'),
            t('recycleBin.category.deletedAt', {
              date: formatDateTime(item.trashedAt || new Date().toISOString())
            })
          ],
          sortTime: new Date(item.trashedAt || 0).getTime()
        })),
        ...trashedAccounts.map((item) => ({
          id: item.id,
          kind: 'account' as const,
          kindLabel: t('recycleBin.kinds.account'),
          title: item.name,
          meta: [
            formatCurrencyFixed2(Number(item.balance ?? item.initialBalance ?? 0)),
            t('recycleBin.account.deletedAt', {
              date: formatDateTime(item.trashedAt || new Date().toISOString())
            })
          ],
          sortTime: new Date(item.trashedAt || 0).getTime()
        })),
        ...trashedSubscriptions.map((item) => ({
          id: item.id,
          kind: 'subscription' as const,
          kindLabel: t('recycleBin.kinds.subscription'),
          title: item.name,
          meta: [
            `${formatCurrencyFixed2(Number(item.amount ?? 0))} ${item.currency || 'CNY'}`,
            item.provider || t('recycleBin.subscription.unsetProvider'),
            t('recycleBin.subscription.deletedAt', {
              date: formatDateTime(item.trashedAt || item.updatedAt || new Date().toISOString())
            })
          ],
          sortTime: new Date(item.trashedAt || 0).getTime()
        }))
      ].sort((a, b) => b.sortTime - a.sortTime),
    [t, trashedAccounts, trashedCategories, trashedSubscriptions, trashedTransactions]
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
    /*
     * 彻底删除**不可逆**,所以要先确认 —— 移入回收站、清空回收站本来都确认,
     * 只有这一条路径原先点一下就直接删掉了。
     *
     * 账户要单独处理:只要它还被交易引用就**拒绝删除**,并说清有几笔挡着。
     * 原因是账户一旦真的消失,那些交易会在下一次同步时被服务端静默丢弃
     * (导入器丢掉引用无法解析的行),而 `account_id` 是 NOT NULL、外键也不允许悬垂引用 ——
     * 「保留交易」在当前数据模型里表达不出来。回收站里那句「交易仍会保留」说的是**移入回收站**
     * 那一步(那一步确实是准的),但用户接着点彻底删除时并不知道交易也要跟着没。
     */
    const affectedTransactions =
      item.kind === 'account'
        ? transactions.filter((transaction) => transaction.accountId === item.id).length
        : 0;
    if (affectedTransactions > 0) {
      window.alert(t('recycleBin.accountDeleteBlocked', { count: affectedTransactions }));
      return;
    }

    const confirmed = window.confirm(
      t('recycleBin.deletePermanentlyConfirm', { title: item.title })
    );
    if (!confirmed) {
      return;
    }

    switch (item.kind) {
      case 'transaction':
        permanentlyDeleteTransaction(item.id);
        return;
      case 'category':
        permanentlyDeleteCategory(item.id);
        return;
      case 'account': {
        const result = permanentlyDeleteAccount(item.id);
        // 兜底:上面的预检查已经挡过,但store 也可能因为别的原因拒绝
        if (!result.ok) {
          window.alert(t('recycleBin.accountDeleteBlocked', { count: result.count }));
        }
        return;
      }
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

    const confirmed = window.confirm(t('recycleBin.clearConfirm', { count: totalCount }));
    if (!confirmed) {
      return;
    }

    /*
     * 清空回收站也会跳过「名下还有交易的账户」(与逐个彻底删除同一条规则)——
     * 跳过了就必须说出来,否则用户以为全清了,实际那几个账户还在,
     * 而且它们引用着的交易也没了着落。
     */
    const result = clearRecycleBin();
    setPage(1);
    if (result.blockedAccountCount > 0) {
      window.alert(
        t('recycleBin.clearBlocked', {
          accounts: result.blockedAccountCount,
          transactions: result.blockedTransactionCount
        })
      );
    }
  };

  return (
    <section className="panel recycle-bin-page vi-page">
      <div className="recycle-bin-header">
        <div>
          <h2>{t('recycleBin.title')}</h2>
        </div>
        <div className="recycle-bin-header-actions">
          <span className="metric-chip">{t('recycleBin.count', { count: totalCount })}</span>
          <button
            type="button"
            className="danger"
            disabled={totalCount === 0}
            onClick={handleClearRecycleBin}
          >
            {t('recycleBin.clear')}
          </button>
        </div>
      </div>

      {totalCount === 0 ? (
        <EmptyState
          className="recycle-bin-empty-state"
          title={t('recycleBin.emptyTitle')}
          description={t('recycleBin.emptyDescription')}
          icon={
            <img className="recycle-bin-empty-illustration" src={AWESOME_ILLUSTRATION_URL} alt="" />
          }
        />
      ) : (
        <>
          <div className="recycle-bin-summary" aria-label={t('recycleBin.summaryAria')}>
            <article className="recycle-bin-stat">
              <span>{t('recycleBin.kinds.transaction')}</span>
              <strong>{trashedTransactions.length}</strong>
            </article>
            <article className="recycle-bin-stat">
              <span>{t('recycleBin.kinds.category')}</span>
              <strong>{trashedCategories.length}</strong>
            </article>
            <article className="recycle-bin-stat">
              <span>{t('recycleBin.kinds.account')}</span>
              <strong>{trashedAccounts.length}</strong>
            </article>
            <article className="recycle-bin-stat">
              <span>{t('recycleBin.kinds.subscription')}</span>
              <strong>{trashedSubscriptions.length}</strong>
            </article>
          </div>

          <div className="recycle-bin-list" aria-label={t('recycleBin.listAria')}>
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
                    {t('recycleBin.restore')}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handlePermanentDelete(item)}
                  >
                    {t('recycleBin.deletePermanently')}
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="recycle-bin-pagination">
            <small className="muted">
              {t('recycleBin.paginationSummary', {
                start: pageStart,
                end: pageEnd,
                total: totalCount,
                pageSize: PAGE_SIZE
              })}
            </small>
            <div className="recycle-bin-pagination-controls">
              <button type="button" disabled={page === 1} onClick={() => setPage(1)}>
                {t('recycleBin.firstPage')}
              </button>
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('recycleBin.previousPage')}
              </button>
              <small className="muted">{t('recycleBin.page', { page, total: totalPages })}</small>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                {t('recycleBin.nextPage')}
              </button>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage(totalPages)}
              >
                {t('recycleBin.lastPage')}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
