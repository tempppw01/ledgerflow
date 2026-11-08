import { useTranslation } from 'react-i18next';
import type { SubscriptionItem } from '../../../entities/subscription/types';
import { formatCurrency } from '../../../shared/lib/format';
import { formatDayMonth } from '../../../shared/lib/i18nDate';
import type { DebtItem } from '../../debt/model/debtMetrics';

type AgendaDetailKey =
  | 'debtReminder'
  | 'plannedRepayment'
  | 'overdueRenewal'
  | 'subscriptionRenewal';

type AgendaItem = {
  id: string;
  date: string;
  label: string;
  amount: number;
  kind: 'income' | 'expense';
  detailKey: AgendaDetailKey;
};

export interface DashboardCashflowAgendaProps {
  debts: DebtItem[];
  subscriptions: SubscriptionItem[];
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    date: string;
    categoryId?: string;
    note?: string;
  }>;
  onNavigateToRepayments: () => void;
  onNavigateToSubscriptions: () => void;
  onNavigateToTransactions: () => void;
}

function toDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextDays(days: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return { start, end };
}

export function DashboardCashflowAgenda({
  debts,
  subscriptions,
  transactions,
  onNavigateToRepayments,
  onNavigateToSubscriptions,
  onNavigateToTransactions
}: DashboardCashflowAgendaProps) {
  const { t, i18n } = useTranslation();
  const { start, end } = nextDays(30);
  const items: AgendaItem[] = [];

  debts.forEach((debt) => {
    if (debt.entryMode === 'simple' && debt.simpleDueDate) {
      const date = toDate(debt.simpleDueDate);
      if (date && date >= start && date <= end) {
        items.push({
          id: `debt:${debt.id}`,
          date: debt.simpleDueDate,
          label: debt.name,
          amount: debt.simpleAmount || 0,
          kind: 'expense',
          detailKey: 'debtReminder'
        });
      }
    }
    (debt.manualRepayments || []).forEach((repayment, index) => {
      const date = toDate(repayment.dueDate);
      if (date && date >= start && date <= end) {
        items.push({
          id: `repayment:${debt.id}:${repayment.id || index}`,
          date: repayment.dueDate || '',
          label: repayment.label || debt.name,
          amount: repayment.amount || 0,
          kind: 'expense',
          detailKey: 'plannedRepayment'
        });
      }
    });
  });

  subscriptions.forEach((subscription) => {
    const due = subscription.renewalDate || subscription.expireDate;
    const date = toDate(due);
    if (date && date <= end && subscription.status !== 'paused') {
      items.push({
        id: `subscription:${subscription.id}`,
        date: due || '',
        label: subscription.name,
        amount: subscription.amount,
        kind: 'expense',
        detailKey:
          date < start || subscription.status === 'expired'
            ? 'overdueRenewal'
            : 'subscriptionRenewal'
      });
    }
  });

  const agenda = items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const unresolved = debts.filter(
    (item) => item.entryMode === 'simple' && !item.simpleAmount
  ).length;
  const unclassified = transactions.filter(
    (item) => !item.categoryId || item.categoryId === 'uncategorized'
  ).length;

  return (
    <section
      className="panel dashboard-cashflow-agenda"
      aria-label={t('dashboard.ui.cashflow.aria')}
    >
      <div className="dashboard-section-header">
        <div>
          <h4>{t('dashboard.ui.cashflow.title')}</h4>
          <span>{t('dashboard.ui.cashflow.subtitle')}</span>
        </div>
        <strong>
          {agenda.length
            ? t(
                agenda.length === 1
                  ? 'dashboard.ui.cashflow.onePlan'
                  : 'dashboard.ui.cashflow.manyPlans',
                { count: agenda.length }
              )
            : t('dashboard.ui.cashflow.emptyCount')}
        </strong>
      </div>
      <div className="dashboard-cashflow-agenda-body">
        <div className="dashboard-cashflow-timeline">
          {agenda.length ? (
            agenda.map((item) => (
              <button
                key={item.id}
                type="button"
                className="dashboard-cashflow-event"
                onClick={
                  item.id.startsWith('subscription:')
                    ? onNavigateToSubscriptions
                    : item.id.startsWith('debt:') || item.id.startsWith('repayment:')
                      ? onNavigateToRepayments
                      : onNavigateToTransactions
                }
              >
                <span className="dashboard-cashflow-event-date">
                  {formatDayMonth(item.date, i18n.resolvedLanguage) ||
                    t('dashboard.ui.cashflow.dateUnknown')}
                </span>
                <span className="dashboard-cashflow-event-main">
                  <strong>{item.label}</strong>
                  <small>{t(`dashboard.ui.cashflow.${item.detailKey}`)}</small>
                </span>
                <b className={item.kind === 'income' ? 'is-income' : 'is-expense'}>
                  {item.amount
                    ? `${item.kind === 'income' ? '+' : '−'}${formatCurrency(item.amount)}`
                    : t('dashboard.ui.cashflow.amountMissing')}
                </b>
              </button>
            ))
          ) : (
            <p className="dashboard-cashflow-empty">{t('dashboard.ui.cashflow.empty')}</p>
          )}
        </div>
        <div
          className="dashboard-finance-todos"
          aria-label={t('dashboard.ui.cashflow.todoAria')}
        >
          <span className="dashboard-cashflow-todo-title">
            {t('dashboard.ui.cashflow.todoTitle')}
          </span>
          {unresolved > 0 ? (
            <button type="button" onClick={onNavigateToRepayments}>
              <b>{unresolved}</b>
              <span>{t('dashboard.ui.cashflow.unresolvedLabel')}</span>
            </button>
          ) : null}
          {unclassified > 0 ? (
            <button type="button" onClick={onNavigateToTransactions}>
              <b>{unclassified}</b>
              <span>{t('dashboard.ui.cashflow.unclassifiedLabel')}</span>
            </button>
          ) : null}
          {!unresolved && !unclassified ? (
            <p>{t('dashboard.ui.cashflow.noTodos')}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
