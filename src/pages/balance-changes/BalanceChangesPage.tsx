import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { formatCurrencyFixed2, formatDateTime } from '../../shared/lib/format';
import { EmptyState } from '../../shared/ui/EmptyState';

const TYPE_LABELS: Record<string, string> = {
  'transaction-income': '收入入账',
  'transaction-expense': '支出扣减',
  'transaction-budget': '预算变动',
  'transaction-repayment': '还款扣减',
  'transaction-refund': '退款回补',
  'manual-adjustment': '手动调整'
};

type BalanceChangeGroupKey = 'income' | 'expense' | 'neutral';

const GROUP_META: Record<
  BalanceChangeGroupKey,
  {
    title: string;
    subtitle: string;
    icon: string;
  }
> = {
  income: {
    title: '收入 / 回补',
    subtitle: '余额增加的记录，优先看入账、退款与调增',
    icon: '↗'
  },
  expense: {
    title: '支出 / 扣减',
    subtitle: '余额减少的记录，优先看消费、还款与调减',
    icon: '↘'
  },
  neutral: {
    title: '其他变动',
    subtitle: '余额无明显变化或无法归类的记录',
    icon: '•'
  }
};

function getTypeLabel(type: string) {
  return TYPE_LABELS[type] || type;
}

function getDirectionText(beforeBalance: number, afterBalance: number) {
  if (afterBalance > beforeBalance) {
    return '余额增加';
  }
  if (afterBalance < beforeBalance) {
    return '余额减少';
  }
  return '余额无变化';
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
}) {
  if (entry.type === 'transaction-refund' && entry.relatedTransactionId) {
    return `退款回补，原单：${entry.relatedSummary}`;
  }
  if (entry.type === 'transaction-expense') {
    return `支出记录：${entry.transactionSummary}`;
  }
  if (entry.type === 'transaction-income') {
    return `收入记录：${entry.transactionSummary}`;
  }
  if (entry.type === 'manual-adjustment') {
    return `手动调整：${entry.transactionSummary}`;
  }
  return entry.transactionSummary;
}

export function BalanceChangesPage() {
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
            accountName: account?.name || '未知账户',
            transactionSummary: transaction?.note || transaction?.id || '—',
            relatedSummary: relatedTransaction?.note || relatedTransaction?.id || '—'
          };
        }),
    [accounts, entries, transactions]
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
          <h2>余额变动明细</h2>
          <p className="muted">
            按收入、支出和其他变动分组展示。先看每组摘要，需要时再展开查看具体流水。
          </p>
        </div>
        <div className="balance-change-summary">
          <span className="metric-chip">
            明细 <strong>{rows.length}</strong>
          </span>
          <span className="metric-chip">
            当前页 <strong>{pagedRows.length}</strong>
          </span>
        </div>
      </div>

      <div className="balance-change-tip">
        <strong>阅读方式</strong>
        <p>
          默认只露出每组最近几条记录，像一叠多米诺卡片；点击收入或支出分组后，会展开更多流水和余额变化路径。
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="暂无余额变动明细"
          description="当你新增收入、支出、退款或手动调整账户余额后，这里会自动生成可追踪记录。"
          icon="📚"
        />
      ) : (
        <div className="balance-change-domino-board" aria-label="按类型分组的余额变动记录">
          {(['income', 'expense', 'neutral'] as BalanceChangeGroupKey[]).map((groupKey) => {
            const groupRows = groupedRows[groupKey];
            if (groupRows.length === 0) return null;

            const meta = GROUP_META[groupKey];
            const expanded = expandedGroups[groupKey];
            const groupTotal = groupRows.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
            const listId = `balance-change-group-${groupKey}`;

            return (
              <section key={groupKey} className={`balance-change-domino-group is-${groupKey} ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
                <button
                  type="button"
                  className="balance-change-group-toggle"
                  aria-controls={listId}
                  aria-expanded={expanded}
                  onClick={() => setExpandedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }))}
                >
                  <span className="balance-change-group-icon">{meta.icon}</span>
                  <span className="balance-change-group-copy">
                    <strong>{meta.title}</strong>
                    <small>{meta.subtitle}</small>
                  </span>
                  <span className="balance-change-group-stat">
                    <strong>{groupRows.length} 笔</strong>
                    <small>{formatCurrencyFixed2(groupTotal)}</small>
                  </span>
                  <span className="balance-change-group-action">{expanded ? '收起' : '展开'}</span>
                </button>

                <div id={listId} className="balance-change-card-list" aria-label={`${meta.title}列表`}>
                  {groupRows.map((entry, index) => {
                    const tone = getChangeTone(entry.beforeBalance, entry.afterBalance);
                    const direction = getDirectionText(entry.beforeBalance, entry.afterBalance);
                    const relatedDescription = getRelatedDescription(entry);
                    const style = { '--domino-index': index } as CSSProperties;
                    const showExpandedDetails = expanded;

                    return (
                      <article key={entry.id} className={`balance-change-card ${tone}`} style={style}>
                        <div className="balance-change-card-icon" aria-hidden="true">
                          {getChangeIcon(entry.type, entry.beforeBalance, entry.afterBalance)}
                        </div>

                        <div className="balance-change-card-main">
                          <header className="balance-change-card-head">
                            <div>
                              <p className="balance-change-card-kicker">{formatDateTime(entry.createdAt)}</p>
                              <h3>{entry.accountName}</h3>
                            </div>
                            <div className={`balance-change-card-amount ${tone}`}>
                              <span>{direction}</span>
                              <strong>{formatCurrencyFixed2(entry.amount)}</strong>
                            </div>
                          </header>

                          {showExpandedDetails ? (
                            <div className="balance-change-card-body">
                              <div className="balance-change-reason">
                                <span>{getTypeLabel(entry.type)}</span>
                                <strong>{relatedDescription}</strong>
                                {entry.relatedTransactionId ? <small>关联原单：{entry.relatedSummary}</small> : null}
                              </div>

                              <div className="balance-change-flow" aria-label="余额变化路径">
                                <div>
                                  <span>变动前</span>
                                  <strong>{formatCurrencyFixed2(entry.beforeBalance)}</strong>
                                </div>
                                <i aria-hidden="true">→</i>
                                <div>
                                  <span>变动后</span>
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
            每页
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[20, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </label>

          <div className="balance-change-pagination-actions">
            <span className="muted">
              第 {page} / {pages} 页
            </span>
            <button type="button" onClick={() => setPage(1)} disabled={page === 1}>
              首页
            </button>
            <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
              上一页
            </button>
            <button type="button" onClick={() => setPage(Math.min(pages, page + 1))} disabled={page === pages}>
              下一页
            </button>
            <button type="button" onClick={() => setPage(pages)} disabled={page === pages}>
              末页
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
