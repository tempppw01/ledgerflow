import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  SubscriptionBillingCycle,
  SubscriptionItem,
  SubscriptionKind,
  SubscriptionStatus
} from '../../entities/subscription/types';
import { formatDate, formatMoneyByCurrency } from '../../shared/lib/format';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

const KIND_LABELS: Record<SubscriptionKind, string> = {
  digital: '数字订阅',
  mobile: '话费/通信',
  membership: '会员卡',
  other: '其他'
};

const CYCLE_LABELS: Record<SubscriptionBillingCycle, string> = {
  monthly: '每月',
  quarterly: '每季度',
  semiannual: '每半年',
  yearly: '每年',
  custom: '自定义'
};

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: '正常',
  'due-soon': '即将到期',
  expired: '已到期',
  paused: '已暂停'
};

const STATUS_CLASS: Record<SubscriptionStatus, string> = {
  active: 'badge',
  'due-soon': 'badge badge-warning',
  expired: 'badge badge-danger',
  paused: 'badge'
};

function toMonthlyAmount(
  item: Pick<SubscriptionItem, 'amount' | 'billingCycle' | 'customCycleDays'>
) {
  const amount = Number(item.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (item.billingCycle === 'monthly') return amount;
  if (item.billingCycle === 'quarterly') return amount / 3;
  if (item.billingCycle === 'semiannual') return amount / 6;
  if (item.billingCycle === 'yearly') return amount / 12;
  if (item.billingCycle === 'custom' && item.customCycleDays && item.customCycleDays > 0) {
    return (amount / item.customCycleDays) * 30;
  }
  return amount;
}

const DEFAULT_FORM = {
  name: '',
  kind: 'digital' as SubscriptionKind,
  amount: '0',
  currency: 'CNY',
  billingCycle: 'monthly' as SubscriptionBillingCycle,
  customCycleDays: '',
  accountId: '',
  provider: '',
  note: '',
  renewalDate: '',
  expireDate: '',
  autoRenew: true,
  status: 'active' as SubscriptionStatus
};

type SubscriptionTemplate = {
  id: string;
  name: string;
  provider: string;
  kind: SubscriptionKind;
  amount: number;
  currency: string;
  billingCycle: SubscriptionBillingCycle;
  autoRenew: boolean;
  logoKind: 'apple' | 'music' | 'cloud' | 'netflix' | 'mobile' | 'member';
};

const SUBSCRIPTION_TEMPLATES: SubscriptionTemplate[] = [
  {
    id: 'apple-one',
    name: 'Apple One',
    provider: 'Apple',
    kind: 'digital',
    amount: 128,
    currency: 'CNY',
    billingCycle: 'monthly',
    autoRenew: true,
    logoKind: 'apple'
  },
  {
    id: 'apple-music',
    name: 'Apple Music',
    provider: 'Apple',
    kind: 'digital',
    amount: 11,
    currency: 'CNY',
    billingCycle: 'monthly',
    autoRenew: true,
    logoKind: 'music'
  },
  {
    id: 'icloud-plus',
    name: 'iCloud+ 200GB',
    provider: 'Apple',
    kind: 'digital',
    amount: 21,
    currency: 'CNY',
    billingCycle: 'monthly',
    autoRenew: true,
    logoKind: 'cloud'
  },
  {
    id: 'netflix-standard',
    name: 'Netflix 标准版',
    provider: 'Netflix',
    kind: 'digital',
    amount: 78,
    currency: 'CNY',
    billingCycle: 'monthly',
    autoRenew: true,
    logoKind: 'netflix'
  },
  {
    id: 'mobile-combo',
    name: '手机话费套餐',
    provider: '运营商',
    kind: 'mobile',
    amount: 59,
    currency: 'CNY',
    billingCycle: 'monthly',
    autoRenew: true,
    logoKind: 'mobile'
  },
  {
    id: 'streaming-member',
    name: '视频平台会员',
    provider: '视频平台',
    kind: 'membership',
    amount: 25,
    currency: 'CNY',
    billingCycle: 'monthly',
    autoRenew: true,
    logoKind: 'member'
  }
];

const SUBSCRIPTIONS_DEMO_SEEDED_KEY = 'ledgerflow-subscriptions-demo-seeded';

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function createDemoSubscriptions(defaultAccountId?: string) {
  const seedTime = new Date();

  return [
    {
      name: 'Spotify Premium',
      kind: 'digital' as const,
      amount: 15,
      currency: 'CNY',
      billingCycle: 'monthly' as const,
      accountId: defaultAccountId,
      provider: 'Spotify',
      renewalDate: formatDateInputValue(shiftDate(seedTime, 4)),
      expireDate: formatDateInputValue(shiftDate(seedTime, 4)),
      autoRenew: true
    },
    {
      name: '中国移动 5G 套餐',
      kind: 'mobile' as const,
      amount: 59,
      currency: 'CNY',
      billingCycle: 'monthly' as const,
      accountId: defaultAccountId,
      provider: '中国移动',
      renewalDate: formatDateInputValue(shiftDate(seedTime, 12)),
      expireDate: formatDateInputValue(shiftDate(seedTime, 12)),
      autoRenew: true
    },
    {
      name: 'iCloud+ 200GB',
      kind: 'digital' as const,
      amount: 21,
      currency: 'CNY',
      billingCycle: 'monthly' as const,
      accountId: defaultAccountId,
      provider: 'Apple',
      renewalDate: formatDateInputValue(shiftDate(seedTime, 19)),
      expireDate: formatDateInputValue(shiftDate(seedTime, 19)),
      autoRenew: true
    }
  ];
}

function normalizeShortcutDateInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return trimmed;

  const [, rawYear, rawMonth, rawDay] = match;
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return trimmed;
  }

  let year = Number(rawYear);
  if (!Number.isInteger(year)) {
    return trimmed;
  }

  if (rawYear.length <= 2 || year < 100) {
    year += 2000;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function SubscriptionTemplateLogo({ kind }: { kind: SubscriptionTemplate['logoKind'] }) {
  if (kind === 'apple') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.05 20.28c-.98.95-2.05.86-3.08.36-1.09-.5-2.08-.52-3.21 0-1.41.65-2.16.47-3-.36C3.78 16.61 4.25 9.58 8.42 9.31c1.03.06 1.72.6 2.55.65.84.05 1.86-.38 2.88-.5 1.21-.03 1.87.26 2.56.68-.49.65-.9 1.28-1.05 2.12.58-.14 1.11-.37 1.69-.68Z" />
        <path d="M14.96 5.6c.53-.66.79-1.56.67-2.6-.6.03-1.28.4-1.68.9-.41.51-.64 1.21-.54 1.95.66.05 1.3-.07 1.55.75Z" />
      </svg>
    );
  }

  if (kind === 'music') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 3.5c.2-1.7 1.5-3.06 3.25-3 1.2.04 2.05 1.02 2 2.2-.05 1.48-1.24 2.72-3.35 2.6V13H8.04v6.7c0 1.84-1.32 3.04-3.09 2.96-1.72-.08-2.95-1.32-2.95-3.03 0-1.72 1.25-2.96 2.97-2.88V7.45C5.08 4.83 7.05 3.63 10 5.72V3.5Zm3.7 9.73v5.78c0 1.68 1.05 2.88 2.68 2.8 1.64-.08 2.72-1.18 2.72-2.82 0-1.63-1.19-2.77-2.82-2.7-.31.02-.63.07-.92.15v-6.36c-.01-2.03 1.2-3.32 3.35-3.27.14.02.28.04.41.07-.34 1.37-1.24 2.4-2.5 3.2-.82.52-1.56 1.05-2.42 1.57Z" />
      </svg>
    );
  }

  if (kind === 'cloud') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.8 15.02c1.02-.87 1.68-2.17 1.68-3.71 0-2.66-2.01-4.73-4.53-4.79C15.24 4.13 13.17 2.8 10.86 2.8c-2.88 0-5.18 1.89-5.88 4.52C2.73 7.7 1 9.73 1 12.09c0 2.7 2.13 4.83 4.83 4.83h11.25c1.13 0 2.04-.41 2.72-1.9Z" />
      </svg>
    );
  }

  if (kind === 'netflix') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 4.7h4.05l4.45 9.04h.05L16 4.7h4.2v14.6h-3.45V9.84h-.05l-4.6 9.46H9.9L5.3 9.84h-.05v9.46H3V4.7Z" />
      </svg>
    );
  }

  if (kind === 'mobile') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.06 2h9.88A1.97 1.97 0 0 1 19 3.98v16.04a1.97 1.97 0 0 1-2.06 1.98H7.06A1.97 1.97 0 0 1 5 20.02V3.98A1.97 1.97 0 0 1 7.06 2Zm3.08 17.2h3.72v-1.14h-3.72v1.14Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.6 3h12.8A1.65 1.65 0 0 1 20 4.62v9.36c0 1.83-1.28 3.04-3.18 3.04H8.03l-3.36 3.06c-.54.5-1.07.37-1.07-.43V6.04A1.86 1.86 0 0 1 5.6 3Z" />
      <path d="m8.87 10.04 2.14-1.35a.48.48 0 0 1 .5 0l2.13 1.35-1.9 2.52V15.3h-1.46v-2.74l-1.9-2.52h.49Z" />
    </svg>
  );
}

export function SubscriptionsPage() {
  const navigate = useNavigate();
  const hasHydrated = useFinanceStore((s) => s.hasHydrated);
  const subscriptions = useFinanceStore((s) => s.subscriptions);
  const trashedSubscriptions = useFinanceStore((s) => s.trashedSubscriptions);
  const accounts = useFinanceStore((s) => s.accounts);
  const addSubscription = useFinanceStore((s) => s.addSubscription);
  const updateSubscription = useFinanceStore((s) => s.updateSubscription);
  const removeSubscription = useFinanceStore((s) => s.removeSubscription);
  const generateSubscriptionTransaction = useFinanceStore((s) => s.generateSubscriptionTransaction);

  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!hasHydrated || subscriptions.length > 0 || trashedSubscriptions.length > 0) {
      return;
    }

    try {
      if (window.localStorage.getItem(SUBSCRIPTIONS_DEMO_SEEDED_KEY) === '1') {
        return;
      }

      const defaultAccountId =
        accounts.find((item) => item.id === 'acc-card')?.id || accounts[0]?.id;
      window.localStorage.setItem(SUBSCRIPTIONS_DEMO_SEEDED_KEY, '1');
      createDemoSubscriptions(defaultAccountId).forEach((item) => {
        addSubscription(item);
      });
    } catch {
      // ignore localStorage failures and keep the page usable
    }
  }, [accounts, addSubscription, hasHydrated, subscriptions.length, trashedSubscriptions.length]);

  const pendingDeleteItem = useMemo(
    () => subscriptions.find((item) => item.id === pendingDeleteId) ?? null,
    [subscriptions, pendingDeleteId]
  );

  const summary = useMemo(() => {
    return {
      total: subscriptions.length,
      active: subscriptions.filter((item) => item.status === 'active').length,
      dueSoon: subscriptions.filter((item) => item.status === 'due-soon').length,
      expired: subscriptions.filter((item) => item.status === 'expired').length
    };
  }, [subscriptions]);

  const monthlySummaryByCurrency = useMemo(() => {
    const grouped = new Map<string, number>();
    subscriptions
      .filter((item) => item.status !== 'paused')
      .forEach((item) => {
        const currency = item.currency || 'CNY';
        grouped.set(currency, (grouped.get(currency) || 0) + toMonthlyAmount(item));
      });

    return Array.from(grouped.entries())
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }, [subscriptions]);

  const rows = useMemo(
    () =>
      [...subscriptions].sort((a, b) => {
        const aDate = new Date(a.expireDate || a.renewalDate || a.updatedAt).getTime();
        const bDate = new Date(b.expireDate || b.renewalDate || b.updatedAt).getTime();
        return aDate - bDate;
      }),
    [subscriptions]
  );

  const attentionItems = useMemo(
    () =>
      rows.filter((item) => item.status === 'due-soon' || item.status === 'expired').slice(0, 6),
    [rows]
  );

  const formMonthlyPreview = useMemo(
    () =>
      toMonthlyAmount({
        amount: Number(form.amount || '0'),
        billingCycle: form.billingCycle,
        customCycleDays: Number(form.customCycleDays || 0)
      }),
    [form.amount, form.billingCycle, form.customCycleDays]
  );

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setError('');
  };

  const applySubscriptionTemplate = (template: SubscriptionTemplate) => {
    const today = new Date();
    const renewalDate = formatDateInputValue(shiftDate(today, 30));
    setEditingId(null);
    setForm({
      ...DEFAULT_FORM,
      name: template.name,
      kind: template.kind,
      amount: String(template.amount),
      currency: template.currency,
      billingCycle: template.billingCycle,
      provider: template.provider,
      autoRenew: template.autoRenew,
      renewalDate,
      expireDate: renewalDate
    });
    setError('');
  };

  const handleDateFieldChange = (field: 'renewalDate' | 'expireDate', value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: normalizeShortcutDateInput(value)
    }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const amount = Number(form.amount || '0');
    if (!name) {
      setError('请输入订阅名称。');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('订阅金额必须大于 0。');
      return;
    }

    const payload = {
      name,
      kind: form.kind,
      amount,
      currency: form.currency.trim().toUpperCase() || 'CNY',
      billingCycle: form.billingCycle,
      customCycleDays:
        form.billingCycle === 'custom' && Number(form.customCycleDays) > 0
          ? Number(form.customCycleDays)
          : undefined,
      accountId: form.accountId || undefined,
      provider: form.provider.trim() || undefined,
      note: form.note.trim() || undefined,
      renewalDate: form.renewalDate || undefined,
      expireDate: form.expireDate || undefined,
      autoRenew: form.autoRenew,
      status: form.status
    };

    if (editingId) {
      updateSubscription(editingId, payload);
    } else {
      addSubscription(payload);
    }

    resetForm();
  };

  const startEdit = (item: SubscriptionItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      kind: item.kind,
      amount: String(item.amount),
      currency: item.currency,
      billingCycle: item.billingCycle,
      customCycleDays: item.customCycleDays ? String(item.customCycleDays) : '',
      accountId: item.accountId || '',
      provider: item.provider || '',
      note: item.note || '',
      renewalDate: item.renewalDate || '',
      expireDate: item.expireDate || '',
      autoRenew: item.autoRenew ?? true,
      status: item.status
    });
    setError('');
  };

  const handleGenerateTransaction = (item: SubscriptionItem) => {
    try {
      const result = generateSubscriptionTransaction(item.id);
      navigate(`/transactions/${result.transactionId}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '生成订阅支出失败，请稍后重试。');
    }
  };

  return (
    <div className="subscriptions-page vi-page">
      <section className="panel subscriptions-hero">
        <div className="subscriptions-header">
          <div className="subscriptions-hero-copy">
            <span className="subscriptions-kicker">周期支出总览</span>
            <h2>订阅管理</h2>
            <p className="muted">
              统一管理数字订阅、话费、会员卡等周期性项目，支持多币种、续费日和到期状态追踪。
            </p>
            <div className="subscriptions-summary-strip" aria-label="订阅概览">
              <article className="subscriptions-summary-pill">
                <span>总数</span>
                <strong>{summary.total}</strong>
              </article>
              <article className="subscriptions-summary-pill">
                <span>活跃中</span>
                <strong>{summary.active}</strong>
              </article>
              <article className="subscriptions-summary-pill is-warning">
                <span>即将到期</span>
                <strong>{summary.dueSoon}</strong>
              </article>
              {summary.expired > 0 ? (
                <article className="subscriptions-summary-pill is-danger">
                  <span>已到期</span>
                  <strong>{summary.expired}</strong>
                </article>
              ) : null}
            </div>
          </div>

          {monthlySummaryByCurrency.length > 0 || attentionItems.length > 0 ? (
            <div className="subscriptions-overview-stack" aria-label="订阅快速概览">
              {monthlySummaryByCurrency.length > 0 ? (
                <div className="subscriptions-compact-group">
                  <div className="dashboard-section-header">
                    <h4>预计月度固定成本</h4>
                    <span>按币种分组</span>
                  </div>
                  <div className="subscriptions-monthly-summary-list">
                    {monthlySummaryByCurrency.map((item) => (
                      <article key={item.currency} className="subscriptions-monthly-summary-card">
                        <span className="subscriptions-monthly-summary-currency">
                          {item.currency}
                        </span>
                        <strong>{formatMoneyByCurrency(item.amount, item.currency)}</strong>
                        <em>折算到每月</em>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}

              {attentionItems.length > 0 ? (
                <div className="subscriptions-compact-group subscriptions-attention-compact">
                  <div className="dashboard-section-header">
                    <h4>待处理提醒</h4>
                    <span>优先处理到期项</span>
                  </div>
                  <div className="subscriptions-alert-list">
                    {attentionItems.map((item) => (
                      <article key={`alert-${item.id}`} className="subscriptions-alert-card">
                        <strong>{item.name}</strong>
                        <span>
                          {item.expireDate
                            ? `到期：${formatDate(item.expireDate)}`
                            : item.renewalDate
                              ? `续费：${formatDate(item.renewalDate)}`
                              : '日期未设置'}
                        </span>
                        <em>
                          {STATUS_LABELS[item.status]} ·{' '}
                          {formatMoneyByCurrency(item.amount, item.currency)}
                        </em>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="subscriptions-main-grid">
        <section className="panel subscriptions-form-panel">
          <div className="subscriptions-panel-head">
            <div>
              <h3>{editingId ? '编辑订阅' : '新增订阅'}</h3>
              <p className="muted">
                先录入基础信息，再补充账户、续费和备注，后续生成支出会更顺手。
              </p>
            </div>
            <div className="subscriptions-form-preview">
              <span>折算月均</span>
              <strong>{formatMoneyByCurrency(formMonthlyPreview, form.currency || 'CNY')}</strong>
              <em>
                {form.billingCycle === 'custom'
                  ? '按自定义周期折算'
                  : CYCLE_LABELS[form.billingCycle]}
              </em>
            </div>
          </div>

          <div className="subscriptions-template-panel" aria-label="订阅预设模板">
            <div className="subscriptions-template-copy">
              <h4>从常用模板开始</h4>
              <p>点一下能把常见服务自动填好，金额和日期还可继续调整。</p>
            </div>
            <div className="subscriptions-template-list">
              {SUBSCRIPTION_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="subscriptions-template-item"
                  onClick={() => applySubscriptionTemplate(template)}
                >
                  <span className={`subscriptions-template-logo is-${template.logoKind}`}>
                    <SubscriptionTemplateLogo kind={template.logoKind} />
                  </span>
                  <span className="subscriptions-template-main">
                    <strong>{template.name}</strong>
                    <small>{template.provider}</small>
                  </span>
                  <span className="subscriptions-template-price">
                    {formatMoneyByCurrency(template.amount, template.currency)}
                    <small>/月</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <form className="subscriptions-form" onSubmit={handleSubmit}>
            <div className="subscriptions-form-section subscriptions-form-full">
              <div className="subscriptions-form-section-head">
                <h4>基础信息</h4>
                <span>先定义是什么、多少钱、多久扣一次</span>
              </div>
              <div className="subscriptions-form-grid subscriptions-form-grid-primary">
                <label className="subscriptions-field subscriptions-field-wide">
                  <span>名称</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="例如：Spotify / 中国移动 / 健身月卡"
                  />
                </label>
                <label className="subscriptions-field">
                  <span>类型</span>
                  <select
                    value={form.kind}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, kind: e.target.value as SubscriptionKind }))
                    }
                  >
                    <option value="digital">数字订阅</option>
                    <option value="mobile">话费/通信</option>
                    <option value="membership">会员卡</option>
                    <option value="other">其他</option>
                  </select>
                </label>
                <label className="subscriptions-field">
                  <span>金额</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  />
                </label>
                <label className="subscriptions-field">
                  <span>币种</span>
                  <input
                    value={form.currency}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))
                    }
                    placeholder="CNY / USD / HKD"
                  />
                </label>
                <label className="subscriptions-field">
                  <span>计费周期</span>
                  <select
                    value={form.billingCycle}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        billingCycle: e.target.value as SubscriptionBillingCycle
                      }))
                    }
                  >
                    <option value="monthly">每月</option>
                    <option value="quarterly">每季度</option>
                    <option value="semiannual">每半年</option>
                    <option value="yearly">每年</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
                {form.billingCycle === 'custom' ? (
                  <label className="subscriptions-field">
                    <span>自定义天数</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={form.customCycleDays}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, customCycleDays: e.target.value }))
                      }
                    />
                  </label>
                ) : null}
              </div>
            </div>

            <div className="subscriptions-form-section subscriptions-form-full">
              <div className="subscriptions-form-section-head">
                <h4>扣费与日期</h4>
                <span>把账户、平台和续费时间补完整，后面更好追踪</span>
              </div>
              <div className="subscriptions-form-grid">
                <label className="subscriptions-field">
                  <span>扣费账户</span>
                  <select
                    value={form.accountId}
                    onChange={(e) => setForm((prev) => ({ ...prev, accountId: e.target.value }))}
                  >
                    <option value="">未指定</option>
                    {accounts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="subscriptions-field subscriptions-field-wide">
                  <span>所属平台 / 商户</span>
                  <input
                    value={form.provider}
                    onChange={(e) => setForm((prev) => ({ ...prev, provider: e.target.value }))}
                    placeholder="例如 Apple、腾讯视频、中国移动"
                  />
                </label>
                <label className="subscriptions-field">
                  <span>续费日</span>
                  <input
                    type="date"
                    value={form.renewalDate}
                    onChange={(e) => handleDateFieldChange('renewalDate', e.target.value)}
                  />
                </label>
                <label className="subscriptions-field">
                  <span>到期日</span>
                  <input
                    type="date"
                    value={form.expireDate}
                    onChange={(e) => handleDateFieldChange('expireDate', e.target.value)}
                  />
                </label>
                <label className="subscriptions-field">
                  <span>状态</span>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, status: e.target.value as SubscriptionStatus }))
                    }
                  >
                    <option value="active">正常</option>
                    <option value="paused">已暂停</option>
                  </select>
                </label>
                <label className="subscriptions-checkbox subscriptions-field">
                  <input
                    type="checkbox"
                    checked={form.autoRenew}
                    onChange={(e) => setForm((prev) => ({ ...prev, autoRenew: e.target.checked }))}
                  />
                  <span>自动续费</span>
                </label>
              </div>
            </div>

            <label className="subscriptions-field subscriptions-form-full">
              <span>备注</span>
              <textarea
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                rows={4}
                placeholder="可记录套餐说明、会员权益、卡号尾号等"
              />
            </label>
            {error ? (
              <p className="assistant-wb-issue error subscriptions-form-full">{error}</p>
            ) : null}
            <div className="subscriptions-actions subscriptions-form-full">
              <button type="submit" className="primary">
                {editingId ? '保存修改' : '新增订阅'}
              </button>
              {editingId ? (
                <button type="button" onClick={resetForm}>
                  取消编辑
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="panel subscriptions-list-panel">
          <div className="subscriptions-panel-head">
            <div>
              <h3>订阅清单</h3>
              <p className="muted">按到期时间排序，优先把需要处理的项目放到前面。</p>
            </div>
            {summary.total > 0 ? (
              <span className="metric-chip metric-chip-highlight">
                已录入
                <strong>{summary.total}</strong>
              </span>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="还没有订阅项目"
              description="先添加第一个数字订阅、话费套餐或会员卡，后面就能统一看费用和到期情况。"
              icon="🧾"
            />
          ) : (
            <div className="subscriptions-card-list">
              {rows.map((item) => {
                const account = item.accountId
                  ? accounts.find((row) => row.id === item.accountId)
                  : null;
                const billingCycleText =
                  item.billingCycle === 'custom'
                    ? `每 ${item.customCycleDays || '—'} 天`
                    : CYCLE_LABELS[item.billingCycle];
                const nextDateText = item.renewalDate
                  ? `${item.autoRenew ? '续费' : '提醒'} ${formatDate(item.renewalDate)}`
                  : item.expireDate
                    ? `到期 ${formatDate(item.expireDate)}`
                    : '';

                return (
                  <article key={item.id} className="subscriptions-card">
                    <div className="subscriptions-card-head">
                      <div className="subscriptions-card-title">
                        <h4>{item.name}</h4>
                        <p>
                          {item.provider
                            ? `${item.provider} · ${KIND_LABELS[item.kind]}`
                            : KIND_LABELS[item.kind]}
                        </p>
                      </div>
                      <div className="subscriptions-card-badges">
                        <span className={STATUS_CLASS[item.status]}>
                          {STATUS_LABELS[item.status]}
                        </span>
                        {item.autoRenew ? <span className="badge">自动</span> : null}
                      </div>
                    </div>

                    <div className="subscriptions-card-summary" aria-label="订阅摘要">
                      <span className="subscriptions-card-amount">
                        {formatMoneyByCurrency(item.amount, item.currency)}
                        <small>/ {billingCycleText}</small>
                      </span>
                      {nextDateText ? <span>{nextDateText}</span> : null}
                      {account ? <span>{account.name}</span> : null}
                    </div>

                    <div className="subscriptions-actions-inline">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => handleGenerateTransaction(item)}
                      >
                        生成支出
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/transactions?tags=${encodeURIComponent('订阅')}&note=${encodeURIComponent(item.name)}`
                          )
                        }
                      >
                        查看支出
                      </button>
                      <button type="button" onClick={() => startEdit(item)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setPendingDeleteId(item.id)}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteItem)}
        title="移入回收站"
        description={
          pendingDeleteItem
            ? `确认将“${pendingDeleteItem.name}”移入回收站吗？后续仍可在回收站恢复或彻底删除。`
            : ''
        }
        confirmText="移入回收站"
        cancelText="取消"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) removeSubscription(pendingDeleteId);
          setPendingDeleteId(null);
          if (editingId === pendingDeleteId) resetForm();
        }}
      />
    </div>
  );
}
