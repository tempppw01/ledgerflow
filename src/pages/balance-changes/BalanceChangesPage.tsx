import { CSSProperties, useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { formatCurrencyFixed2, formatDateTime } from '../../shared/lib/format';
import { EmptyState } from '../../shared/ui/EmptyState';

const TYPE_LABEL_KEYS: Record<string, string> = {
  'transaction-income': 'transactionIncome',
  'transaction-expense': 'transactionExpense',
  'transaction-budget': 'transactionBudget',
  'transaction-repayment': 'transactionRepayment',
  'transaction-refund': 'transactionRefund',
  'manual-adjustment': 'manualAdjustment'
};

type BalanceChangeGroupKey = 'income' | 'expense' | 'neutral';

const GROUP_META: Record<
  BalanceChangeGroupKey,
  { icon: string }
> = {
  income: { icon: '↗' },
  expense: { icon: '↘' },
  neutral: { icon: '•' }
};

function getTypeLabel(type: string, t: TFunction) {
  const key = TYPE_LABEL_KEYS[type];
  return key ? t(`balanceChanges.typeLabels.${key}`) : type;
}

function getDirectionText(beforeBalance: number, afterBalance: number, t: TFunction) {
  if (afterBalance > beforeBalance) {
    return t('balanceChanges.direction.increase');
  }
  if (afterBalance < beforeBalance) {
    return t('balanceChanges.direction.decrease');
  }
  return t('balanceChanges.direction.same');
}

function getChangeTone(beforeBalance: number, afterBalance: number) {
  if (afterBalance > beforeBalance) {
    return 'is-positive';
  }
  if (afterBalance < beforeBalance) {
    return 'is-negative';
  }
  return 'is-neutral';
}

function getChangeSign(beforeBalance: number, afterBalance: number) {
  if (afterBalance > beforeBalance) return '+';
  if (afterBalance < beforeBalance) return '−';
  return '';
}

function getGroupKey(beforeBalance: number, afterBalance: number): BalanceChangeGroupKey {
  if (afterBalance > beforeBalance) {
    return 'income';
  }
  if (afterBalance < beforeBalance) {
    return 'expense';
  }
  return 'neutral';
}

function getChangeIcon(type: string, beforeBalance: number, afterBalance: number) {
  if (type === 'manual-adjustment') return '✍️';
  if (type === 'transaction-refund') return '↩️';
  if (type === 'transaction-repayment') return '💳';
  if (afterBalance > beforeBalance) return '↗';
  if (afterBalance < beforeBalance) return '↘';
  return '•';
}

function getRelatedDescription(entry: {
  type: string;
  transactionSummary: string;
  relatedTransactionId?: string;
  relatedSummary: string;
}, t: TFunction) {
  if (entry.type === 'transaction-refund' && entry.relatedTransactionId) {
    return t('balanceChanges.related.refund', { summary: entry.relatedSummary });
  }
  if (entry.type === 'transaction-expense') {
    return t('balanceChanges.related.expense', { summary: entry.transactionSummary });
  }
  if (entry.type === 'transaction-income') {
    return t('balanceChanges.related.income', { summary: entry.transactionSummary });
  }
  if (entry.type === 'manual-adjustment') {
    return t('balanceChanges.related.manual', { summary: entry.transactionSummary });
  }
  return entry.transactionSummary;
}

export function BalanceChangesPage() {
  const { t } = useTranslation();
  const entries = useFinanceStore((s) => s.balanceChangeEntries);
  const accounts = useFinanceStore((s) => s.accounts);
  const transactions = useFinanceStore((s) => s.transactions);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedGroups, setExpandedGroups] = useState<Record<BalanceChangeGroupKey, boolean>>({
    income: false,
    expense: false,
    neutral: false
  });

  const rows = useMemo(
    () =>
      [...entries]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((entry) => {
          const account = accounts.find((item) => item.id === entry.accountId);
          const transaction = entry.transactionId
            ? transactions.find((item) => item.id === entry.transactionId)
            : null;
          const relatedTransaction = entry.relatedTransactionId
            ? transactions.find((item) => item.id === entry.relatedTransactionId)
            : null;

          return {
            ...entry,
            accountName: account?.name || t('balanceChanges.unknownAccount'),
            transactionSummary: transaction?.note || transaction?.id || '—',
            relatedSummary: relatedTransaction?.note || relatedTransaction?.id || '—'
          };
        }),
    [accounts, entries, t, transactions]
  );

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const groupedRows = useMemo(() => {
    const next: Record<BalanceChangeGroupKey, typeof pagedRows> = {
      income: [],
      expense: [],
      neutral: []
    };

    pagedRows.forEach((entry) => {
      next[getGroupKey(entry.beforeBalance, entry.afterBalance)].push(entry);
    });

    return next;
  }, [pagedRows]);

  useEffect(() => {
    setPage((current) => Math.min(current, pages));
  }, [pages]);

  return (
    <section className="panel balance-change-page vi-page">
      <div className="balance-change-header">
        <div>
          <h2>{t('balanceChanges.title')}</h2>
          <p className="muted">{t('balanceChanges.description')}</p>
        </div>
        <div className="balance-change-summary">
          <span className="metric-chip">
            {t('balanceChanges.metrics.entries')} <strong>{rows.length}</strong>
          </span>
          <span className="metric-chip">
            {t('balanceChanges.metrics.currentPage')} <strong>{pagedRows.length}</strong>
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t('balanceChanges.empty.title')}
          description={t('balanceChanges.empty.description')}
          icon="📚"
        />
      ) : (
        <div className="balance-change-domino-board" aria-label={t('balanceChanges.boardAria')}>
          {(['income', 'expense', 'neutral'] as BalanceChangeGroupKey[]).map((groupKey) => {
            const groupRows = groupedRows[groupKey];
            if (groupRows.length === 0) return null;

            const meta = GROUP_META[groupKey];
            const groupTitle = t(`balanceChanges.groups.${groupKey}.title`);
            const expanded = expandedGroups[groupKey];
            const groupTotal = groupRows.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
            const listId = `balance-change-group-${groupKey}`;

            return (
              <section
                key={groupKey}
                className={`balance-change-domino-group is-${groupKey} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
              >
                <button
                  type="button"
                  className="balance-change-group-toggle"
                  aria-controls={listId}
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }))
                  }
                >
                  <span className="balance-change-group-icon" aria-hidden="true">
                    {meta.icon}
                  </span>
                  <span className="balance-change-group-copy">
                    <strong>{groupTitle}</strong>
                    <small>{t(`balanceChanges.groups.${groupKey}.subtitle`)}</small>
                  </span>
                  <span className="balance-change-group-stat">
                    <strong>
                      {t('balanceChanges.entryCount', { value: groupRows.length })}
                    </strong>
                    <small>
                      {t('balanceChanges.total', {
                        amount: formatCurrencyFixed2(groupTotal)
                      })}
                    </small>
                  </span>
                  <span className="balance-change-group-action">
                    {expanded ? t('balanceChanges.collapse') : t('balanceChanges.expand')}
                  </span>
                </button>

                <div
                  id={listId}
                  className="balance-change-card-list"
                  aria-label={t('balanceChanges.groupListAria', { title: groupTitle })}
                >
                  {groupRows.map((entry, index) => {
                    const tone = getChangeTone(entry.beforeBalance, entry.afterBalance);
                    const direction = getDirectionText(entry.beforeBalance, entry.afterBalance, t);
                    const relatedDescription = getRelatedDescription(entry, t);
                    const style = { '--domino-index': index } as CSSProperties;
                    const showExpandedDetails = expanded;

                    return (
                      <article
                        key={entry.id}
                        className={`balance-change-card ${tone}`}
                        style={style}
                      >
                        <div className="balance-change-card-icon" aria-hidden="true">
                          {getChangeIcon(entry.type, entry.beforeBalance, entry.afterBalance)}
                        </div>

                        <div className="balance-change-card-main">
                          <header className="balance-change-card-head">
                            <div>
                              <p className="balance-change-card-kicker">
                                {formatDateTime(entry.createdAt)}
                              </p>
                              <h3>{entry.accountName}</h3>
                            </div>
                            <div className={`balance-change-card-amount ${tone}`}>
                              <span>{direction}</span>
                              <strong>
                                {getChangeSign(entry.beforeBalance, entry.afterBalance)}
                                {formatCurrencyFixed2(Math.abs(entry.amount))}
                              </strong>
                            </div>
                          </header>

                          {showExpandedDetails ? (
                            <div className="balance-change-card-body">
                              <div className="balance-change-reason">
                                <span>{getTypeLabel(entry.type, t)}</span>
                                <strong>{relatedDescription}</strong>
                                {entry.relatedTransactionId ? (
                                  <small>
                                    {t('balanceChanges.linkedOriginal', {
                                      summary: entry.relatedSummary
                                    })}
                                  </small>
                                ) : null}
                              </div>

                              <div
                                className="balance-change-flow"
                                aria-label={t('balanceChanges.flowAria')}
                              >
                                <div>
                                  <span>{t('balanceChanges.before')}</span>
                                  <strong>{formatCurrencyFixed2(entry.beforeBalance)}</strong>
                                </div>
                                <i aria-hidden="true">→</i>
                                <div>
                                  <span>{t('balanceChanges.after')}</span>
                                  <strong>{formatCurrencyFixed2(entry.afterBalance)}</strong>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {showExpandedDetails && (entry.note || entry.remark) && (
                            <footer className="balance-change-card-note">
                              {entry.note ? <span>{entry.note}</span> : null}
                              {entry.remark ? <small>{entry.remark}</small> : null}
                            </footer>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="balance-change-pagination">
          <label className="balance-change-page-size">
            {t('balanceChanges.pagination.pageSize')}
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[20, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {t('balanceChanges.pagination.size', { value: size })}
                </option>
              ))}
            </select>
          </label>

          <div className="balance-change-pagination-actions">
            <span className="muted">
              {t('balanceChanges.pagination.page', { page, total: pages })}
            </span>
            <button type="button" onClick={() => setPage(1)} disabled={page === 1}>
              {t('balanceChanges.pagination.first')}
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
            >
              {t('balanceChanges.pagination.previous')}
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(pages, page + 1))}
              disabled={page === pages}
            >
              {t('balanceChanges.pagination.next')}
            </button>
            <button type="button" onClick={() => setPage(pages)} disabled={page === pages}>
              {t('balanceChanges.pagination.last')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
