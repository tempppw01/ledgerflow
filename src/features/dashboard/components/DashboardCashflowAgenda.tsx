import { formatCurrency } from '../../../shared/lib/format';
import type { DebtItem } from '../../debt/model/debtMetrics';
import type { SubscriptionItem } from '../../../entities/subscription/types';

type AgendaItem = {
  id: string;
  date: string;
  label: string;
  amount: number;
  kind: 'income' | 'expense';
  detail: string;
};

export interface DashboardCashflowAgendaProps {
  debts: DebtItem[];
  subscriptions: SubscriptionItem[];
  transactions: Array<{ id: string; type: string; amount: number; date: string; categoryId?: string; note?: string }>;
  onNavigateToRepayments: () => void;
  onNavigateToSubscriptions: () => void;
  onNavigateToTransactions: () => void;
}

function toDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(value: string) {
  const date = toDate(value);
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : '待确认';
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
  const { start, end } = nextDays(30);
  const items: AgendaItem[] = [];

  debts.forEach((debt) => {
    if (debt.entryMode === 'simple' && debt.simpleDueDate) {
      const date = toDate(debt.simpleDueDate);
      if (date && date >= start && date <= end) {
        items.push({ id: `debt:${debt.id}`, date: debt.simpleDueDate, label: debt.name, amount: debt.simpleAmount || 0, kind: 'expense', detail: '还款提醒' });
      }
    }
    (debt.manualRepayments || []).forEach((repayment, index) => {
      const date = toDate(repayment.dueDate);
      if (date && date >= start && date <= end) {
        items.push({ id: `repayment:${debt.id}:${repayment.id || index}`, date: repayment.dueDate || '', label: repayment.label || debt.name, amount: repayment.amount || 0, kind: 'expense', detail: '计划还款' });
      }
    });
  });

  subscriptions.forEach((subscription) => {
    const due = subscription.renewalDate || subscription.expireDate;
    const date = toDate(due);
    if (date && date >= start && date <= end && subscription.status !== 'paused') {
      items.push({ id: `subscription:${subscription.id}`, date: due || '', label: subscription.name, amount: subscription.amount, kind: 'expense', detail: '订阅续费' });
    }
  });

  const agenda = items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const unresolved = debts.filter((item) => item.entryMode === 'simple' && !item.simpleAmount).length;
  const unclassified = transactions.filter((item) => !item.categoryId || item.categoryId === 'uncategorized').length;

  return (
    <section className="panel dashboard-cashflow-agenda" aria-label="未来三十天现金流与财务待办">
      <div className="dashboard-section-header">
        <div>
          <h4>接下来 30 天</h4>
          <span>把确定会发生的钱，提前放到一条线上</span>
        </div>
        <strong>{agenda.length ? `${agenda.length} 项安排` : '暂无安排'}</strong>
      </div>
      <div className="dashboard-cashflow-agenda-body">
        <div className="dashboard-cashflow-timeline">
          {agenda.length ? agenda.map((item) => (
            <button key={item.id} type="button" className="dashboard-cashflow-event" onClick={item.id.startsWith('subscription:') ? onNavigateToSubscriptions : item.id.startsWith('debt:') || item.id.startsWith('repayment:') ? onNavigateToRepayments : onNavigateToTransactions}>
              <span className="dashboard-cashflow-event-date">{dateLabel(item.date)}</span>
              <span className="dashboard-cashflow-event-main"><strong>{item.label}</strong><small>{item.detail}</small></span>
              <b className={item.kind === 'income' ? 'is-income' : 'is-expense'}>{item.amount ? `${item.kind === 'income' ? '+' : '−'}${formatCurrency(item.amount)}` : '金额待补充'}</b>
            </button>
          )) : <p className="dashboard-cashflow-empty">未来 30 天暂时没有已登记的还款或续费安排。</p>}
        </div>
        <div className="dashboard-finance-todos" aria-label="财务待办">
          <span className="dashboard-cashflow-todo-title">需要处理</span>
          {unresolved > 0 ? <button type="button" onClick={onNavigateToRepayments}><b>{unresolved}</b><span>笔还款金额待补充</span></button> : null}
          {unclassified > 0 ? <button type="button" onClick={onNavigateToTransactions}><b>{unclassified}</b><span>笔流水待分类</span></button> : null}
          {!unresolved && !unclassified ? <p>目前没有高优先级待办。</p> : null}
        </div>
      </div>
    </section>
  );
}
