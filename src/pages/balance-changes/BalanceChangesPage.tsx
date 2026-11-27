import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { useTFallback } from '../../shared/lib/useTFallback';
import { formatCurrencyFixed2 } from '../../shared/lib/format';
import { toLocalDateKey, todayLocalDateKey } from '../../shared/lib/localDate';
import { EmptyState } from '../../shared/ui/EmptyState';

/**
 * 余额变动明细。
 *
 * 重构前的三个硬伤(都是"看不出来但一直在误导"的类型):
 *
 * 1. **进页面几乎看不到数据**:三组默认全部收起,一屏只有三个折叠头。
 *    明细页的默认状态必须就是"看得到明细"。
 * 2. **分组统计只覆盖当前页**:它先按条分页、再把当页 50 条分成"增加/减少"两组,
 *    于是「余额增加 4 笔 · 合计 ¥32,718.55」只是这一页的数字,翻页就变 —— 看起来
 *    却像全局统计。现在按**天**分组、每组就是完整的一天,口径不再含糊;
 *    页面顶部的汇总则基于**筛选后的全部**数据。
 * 3. **一屏只有 4 条**:每张卡约 140px,时间与账户各占一行,「余额增加 +¥390.55」
 *    在右上角、左侧竖条、说明行里重复三次。现在是一张紧凑表:一行一条,
 *    需要细节时点开那一行。
 *
 * 筛选与分页写进 URL,刷新/返回都还在(与交易页一致)。
 */
const TYPE_OPTIONS = [
  'transaction-income',
  'transaction-expense',
  'transaction-budget',
  'transaction-repayment',
  'transaction-refund',
  'manual-adjustment'
] as const;

type TypeOption = (typeof TYPE_OPTIONS)[number];

const TYPE_LABEL_KEYS: Record<TypeOption, string> = {
  'transaction-income': 'transactionIncome',
  'transaction-expense': 'transactionExpense',
  'transaction-budget': 'transactionBudget',
  'transaction-repayment': 'transactionRepayment',
  'transaction-refund': 'transactionRefund',
  'manual-adjustment': 'manualAdjustment'
};

const RANGE_OPTIONS = ['all', '7d', '30d', '90d', 'month'] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];

/** 每页按「天」分页:一天就是一个完整分组,不会被切到两页。 */
const DAY_PAGE_SIZES = [10, 20, 50] as const;

interface EntryRow {
  id: string;
  type: string;
  time: number;
  /**
   * 「变动后余额」是按**交易日期**顺序一条条推出来的。列表若按 createdAt(≈更新时间)
   * 排,两者顺序就会分叉:改过日期的交易、或后补的倒填交易,会让相邻两行的余额接不上
   * —— 用户看到的是「+¥390.55 之后余额反而变少」这种自相矛盾的列。
   * 所以排序与分组都用链式计算用的同一个键。
   */
  chainTime: number;
  /** 同一天内的次序:链式算法用 updatedAt,这里取反序。 */
  chainUpdatedTime: number;
  accountName: string;
  summary: string;
  note: string;
  remark: string;
  linkedSummary: string;
  hasLink: boolean;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  delta: number;
  tone: 'is-positive' | 'is-negative' | 'is-neutral';
}

/**
 * 填充占位符。项目里的 i18n key 用 i18next 的 `{{value}}` 风格,而 `tf()` 只接收
 * key + 兜底字符串:直接 `.replace('{value}', ...)` 会把 `{{value}}` 变成 `{3}}`。
 * 这里同时匹配 `{x}` 与 `{{x}}`,无论是取到翻译还是走了兜底都能正确填充。
 */
function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) =>
      text.replace(new RegExp(`\\{\\{?${key}\\}?\\}`, 'g'), String(value)),
    template
  );
}

function getTypeLabel(type: string, tf: (key: string, fallback: string) => string) {
  const key = TYPE_LABEL_KEYS[type as TypeOption];
  return key
    ? tf(`balanceChanges.typeLabels.${key}`, type)
    : tf('balanceChanges.typeLabels.unknown', type);
}

function toneOf(delta: number): EntryRow['tone'] {
  if (delta > 0) return 'is-positive';
  if (delta < 0) return 'is-negative';
  return 'is-neutral';
}

function signOf(delta: number) {
  if (delta > 0) return '+';
  if (delta < 0) return '−';
  return '';
}

function resolveRangeStart(range: RangeOption, now: Date): number | null {
  if (range === 'all') return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'month') return start.getTime();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

/*
 * 日期与星期**分开返回**,而不是拼成一个字符串。
 *
 * 原因:窄屏的时间列只有 ~65px,「11月15日 · 周日」要 79px,塞不下。
 * 拼成一个字符串时,截断只能从末尾吃 —— 先吃「周日」,再吃「日」,最后连「15」都被吃掉,
 * 变成「11月1…」,日期就没法读了。分开之后窄屏可以直接把「星期」整块隐藏
 * (由 CSS 决定),日期永远是完整的。表头那行仍然拼回完整写法。
 */
function formatDayLabelParts(dayKey: string, tf: (key: string, fallback: string) => string) {
  const [year, month, day] = dayKey.split('-');
  const today = todayLocalDateKey();
  if (dayKey === today) return { date: tf('balanceChanges.day.today', '今天'), weekday: '' };
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (dayKey === toLocalDateKey(yesterdayDate)) {
    return { date: tf('balanceChanges.day.yesterday', '昨天'), weekday: '' };
  }
  const weekdayNames = [
    tf('balanceChanges.day.weekdaySun', '周日'),
    tf('balanceChanges.day.weekdayMon', '周一'),
    tf('balanceChanges.day.weekdayTue', '周二'),
    tf('balanceChanges.day.weekdayWed', '周三'),
    tf('balanceChanges.day.weekdayThu', '周四'),
    tf('balanceChanges.day.weekdayFri', '周五'),
    tf('balanceChanges.day.weekdaySat', '周六')
  ];
  const weekdayIndex = new Date(`${dayKey}T00:00:00`).getDay();
  const prefix = Number(year) === new Date().getFullYear() ? '' : `${year}/`;
  return {
    date: `${prefix}${Number(month)}月${Number(day)}日`,
    weekday: weekdayNames[weekdayIndex] ?? ''
  };
}

function formatClock(time: number) {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function BalanceChangesPage() {
  const tf = useTFallback();
  const [searchParams, setSearchParams] = useSearchParams();
  const entries = useFinanceStore((s) => s.balanceChangeEntries);
  const accounts = useFinanceStore((s) => s.accounts);
  const transactions = useFinanceStore((s) => s.transactions);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  const keyword = searchParams.get('q') ?? '';
  const typeFilter = (TYPE_OPTIONS as readonly string[]).includes(searchParams.get('type') ?? '')
    ? (searchParams.get('type') as TypeOption)
    : 'all';
  const accountFilter = searchParams.get('account') ?? 'all';
  const rangeFilter = (RANGE_OPTIONS as readonly string[]).includes(searchParams.get('range') ?? '')
    ? (searchParams.get('range') as RangeOption)
    : 'all';
  const daysPerPage = DAY_PAGE_SIZES.includes(Number(searchParams.get('days')) as never)
    ? Number(searchParams.get('days'))
    : 20;
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(patch).forEach(([key, value]) => {
        if (!value || value === 'all') next.delete(key);
        else next.set(key, value);
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  /**
   * 一次遍历完成:建索引、筛选、组装。原来每行都要 accounts.find + 两次
   * transactions.find(几百行 × 上万笔流水),排序还在比较函数里解析日期。
   */
  const rows = useMemo<EntryRow[]>(() => {
    const accountNameById = new Map(accounts.map((item) => [item.id, item.name]));
    const transactionById = new Map(transactions.map((item) => [item.id, item]));
    const rangeStart = resolveRangeStart(rangeFilter, new Date());
    const normalizedKeyword = keyword.trim().toLowerCase();
    const result: EntryRow[] = [];

    for (const entry of entries) {
      const time = new Date(entry.createdAt).getTime();
      if (Number.isNaN(time)) continue;
      if (rangeStart !== null && time < rangeStart) continue;
      if (typeFilter !== 'all' && entry.type !== typeFilter) continue;
      if (accountFilter !== 'all' && entry.accountId !== accountFilter) continue;

      const accountName =
        accountNameById.get(entry.accountId) ?? tf('balanceChanges.unknownAccount', '未知账户');
      const transaction = entry.transactionId ? transactionById.get(entry.transactionId) : null;
      const linked = entry.relatedTransactionId
        ? transactionById.get(entry.relatedTransactionId)
        : null;
      const summary = transaction?.note || entry.note || transaction?.id || '—';
      const linkedSummary = linked?.note || linked?.id || '';

      if (normalizedKeyword) {
        const haystack = `${accountName} ${summary} ${linkedSummary} ${entry.note ?? ''} ${
          entry.remark ?? ''
        }`.toLowerCase();
        if (!haystack.includes(normalizedKeyword)) continue;
      }

      const delta = Number(entry.afterBalance || 0) - Number(entry.beforeBalance || 0);
      // 链式余额用的是交易日期(见 buildTransactionBalanceChangeEntries),
      // 手工调整没有交易,退回 createdAt。
      const transactionDate = transaction?.date ? new Date(transaction.date).getTime() : NaN;
      const chainTime = Number.isNaN(transactionDate) ? time : transactionDate;
      const transactionUpdated = transaction?.updatedAt
        ? new Date(transaction.updatedAt).getTime()
        : NaN;
      const chainUpdatedTime = Number.isNaN(transactionUpdated) ? time : transactionUpdated;
      result.push({
        id: entry.id,
        type: entry.type,
        time,
        chainTime,
        chainUpdatedTime,
        accountName,
        summary,
        note: entry.note ?? '',
        remark: entry.remark ?? '',
        linkedSummary,
        hasLink: Boolean(entry.relatedTransactionId),
        amount: Number(entry.amount || 0),
        beforeBalance: Number(entry.beforeBalance || 0),
        afterBalance: Number(entry.afterBalance || 0),
        delta,
        tone: toneOf(delta)
      });
    }

    /*
     * 链式余额按 (date, updatedAt, id) 升序推演;这里按同样的键降序展示,
     * 才能保证从上往下读时「变动后余额」逐行接得上。
     */
    result.sort(
      (a, b) =>
        b.chainTime - a.chainTime ||
        b.chainUpdatedTime - a.chainUpdatedTime ||
        b.id.localeCompare(a.id)
    );
    return result;
  }, [
    accountFilter,
    accounts,
    entries,
    keyword,
    rangeFilter,
    tf,
    transactions,
    typeFilter
  ]);

  /** 汇总口径 = 筛选后的全部,不是当前页。 */
  const summary = useMemo(() => {
    let increase = 0;
    let decrease = 0;
    let increaseCount = 0;
    let decreaseCount = 0;
    for (const row of rows) {
      if (row.delta > 0) {
        increase += row.delta;
        increaseCount += 1;
      } else if (row.delta < 0) {
        decrease += -row.delta;
        decreaseCount += 1;
      }
    }
    return {
      increase,
      decrease,
      increaseCount,
      decreaseCount,
      net: increase - decrease,
      count: rows.length
    };
  }, [rows]);

  const dayGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      /** 表头用的完整写法:「11月15日 · 周日」 */
      label: string;
      /** 时间列用的纯日期:「11月15日」。星期交给 CSS 按宽度取舍,见 formatDayLabelParts */
      dateLabel: string;
      weekday: string;
      rows: EntryRow[];
      net: number;
      increase: number;
      decrease: number;
    }> = [];
    const indexByKey = new Map<string, number>();
    for (const row of rows) {
      const key = toLocalDateKey(new Date(row.chainTime));
      let index = indexByKey.get(key);
      if (index === undefined) {
        index = groups.length;
        indexByKey.set(key, index);
        const dayParts = formatDayLabelParts(key, tf);
        groups.push({
          key,
          label: dayParts.weekday ? `${dayParts.date} · ${dayParts.weekday}` : dayParts.date,
          dateLabel: dayParts.date,
          weekday: dayParts.weekday,
          rows: [],
          net: 0,
          increase: 0,
          decrease: 0
        });
      }
      const group = groups[index];
      group.rows.push(row);
      group.net += row.delta;
      if (row.delta > 0) group.increase += row.delta;
      if (row.delta < 0) group.decrease += -row.delta;
    }
    return groups;
  }, [rows, tf]);

  const totalPages = Math.max(1, Math.ceil(dayGroups.length / daysPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleGroups = dayGroups.slice((safePage - 1) * daysPerPage, safePage * daysPerPage);
  const hasAnyEntry = entries.length > 0;
  const isFiltered =
    Boolean(keyword.trim()) || typeFilter !== 'all' || accountFilter !== 'all' || rangeFilter !== 'all';

  useEffect(() => {
    if (page !== safePage) {
      patchParams({ page: String(safePage) });
    }
  }, [page, patchParams, safePage]);

  const toggleRow = (id: string) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const renderDetailRow = (row: EntryRow) => (
    <tr className="balance-change-detail-row" key={`${row.id}-detail`}>
      <td colSpan={6}>
        <div className="balance-change-detail">
          <div className="balance-change-flow" aria-label={tf('balanceChanges.flowAria', '余额变化路径')}>
            <div>
              <span>{tf('balanceChanges.before', '变动前')}</span>
              <strong>{formatCurrencyFixed2(row.beforeBalance)}</strong>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>{tf('balanceChanges.after', '变动后')}</span>
              <strong>{formatCurrencyFixed2(row.afterBalance)}</strong>
            </div>
          </div>
          <div className="balance-change-detail-meta">
            <span>{getTypeLabel(row.type, tf)}</span>
            {row.hasLink && row.linkedSummary ? (
              <small>
                {fill(tf('balanceChanges.linkedOriginal', '关联原单:{summary}'), {
                  summary: row.linkedSummary
                })}
              </small>
            ) : null}
            {row.remark ? <small>{row.remark}</small> : null}
          </div>
        </div>
      </td>
    </tr>
  );

  return (
    <section className="panel balance-change-page vi-page">
      <div className="balance-change-header">
        <h2>{tf('balanceChanges.title', '余额变动明细')}</h2>
        {isFiltered ? (
          <button type="button" className="balance-change-reset" onClick={resetFilters}>
            {tf('balanceChanges.filters.reset', '重置筛选')}
          </button>
        ) : null}
      </div>

      <dl className="balance-change-metrics">
        <div className="is-net">
          <dt>{tf('balanceChanges.metrics.net', '净变动')}</dt>
          <dd className={summary.net >= 0 ? 'is-positive' : 'is-negative'}>
            {signOf(summary.net)}
            {formatCurrencyFixed2(Math.abs(summary.net))}
          </dd>
        </div>
        <div>
          <dt>{tf('balanceChanges.metrics.increase', '增加')}</dt>
          <dd className="is-positive">{formatCurrencyFixed2(summary.increase)}</dd>
          <small>{fill(tf('balanceChanges.entryCount', '{{value}} 笔'), { value: summary.increaseCount })}</small>
        </div>
        <div>
          <dt>{tf('balanceChanges.metrics.decrease', '减少')}</dt>
          <dd className="is-negative">{formatCurrencyFixed2(summary.decrease)}</dd>
          <small>{fill(tf('balanceChanges.entryCount', '{{value}} 笔'), { value: summary.decreaseCount })}</small>
        </div>
        <div>
          <dt>{tf('balanceChanges.metrics.count', '笔数')}</dt>
          <dd>{summary.count}</dd>
          <small>
            {fill(tf('balanceChanges.metrics.totalEntries', '全部 {{value}} 笔'), {
              value: entries.length
            })}
          </small>
        </div>
      </dl>

      <div className="balance-change-filters">
        <label className="balance-change-field is-search">
          <span>{tf('balanceChanges.filters.search', '搜索')}</span>
          <input
            type="search"
            value={keyword}
            placeholder={tf('balanceChanges.filters.searchPlaceholder', '账户、说明、备注')}
            onChange={(event) => patchParams({ q: event.target.value, page: null })}
          />
        </label>
        <label className="balance-change-field">
          <span>{tf('balanceChanges.filters.type', '类型')}</span>
          <select
            value={typeFilter}
            onChange={(event) => patchParams({ type: event.target.value, page: null })}
          >
            <option value="all">{tf('balanceChanges.filters.typeAll', '全部类型')}</option>
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {getTypeLabel(type, tf)}
              </option>
            ))}
          </select>
        </label>
        <label className="balance-change-field">
          <span>{tf('balanceChanges.filters.account', '账户')}</span>
          <select
            value={accountFilter}
            onChange={(event) => patchParams({ account: event.target.value, page: null })}
          >
            <option value="all">{tf('balanceChanges.filters.accountAll', '全部账户')}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="balance-change-field">
          <span>{tf('balanceChanges.filters.range', '时间')}</span>
          <select
            value={rangeFilter}
            onChange={(event) => patchParams({ range: event.target.value, page: null })}
          >
            <option value="all">{tf('balanceChanges.filters.rangeAll', '全部时间')}</option>
            <option value="7d">{tf('balanceChanges.filters.range7', '近 7 天')}</option>
            <option value="30d">{tf('balanceChanges.filters.range30', '近 30 天')}</option>
            <option value="90d">{tf('balanceChanges.filters.range90', '近 90 天')}</option>
            <option value="month">{tf('balanceChanges.filters.rangeMonth', '本月')}</option>
          </select>
        </label>
      </div>

      {!hasAnyEntry ? (
        <EmptyState
          title={tf('balanceChanges.empty.title', '暂无余额变动明细')}
          description={tf(
            'balanceChanges.empty.description',
            '当你新增收入、支出、退款或手动调整账户余额后,这里会自动生成可追踪记录。'
          )}
          icon="📚"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={tf('balanceChanges.filters.noMatchTitle', '没有匹配的记录')}
          description={tf(
            'balanceChanges.filters.noMatchDescription',
            '换个关键字,或把筛选条件放宽一点。'
          )}
          icon="🔍"
        />
      ) : (
        <>
          <table className="balance-change-table">
            <caption className="visually-hidden">{tf('balanceChanges.tableCaption', '余额变动记录')}</caption>
            <thead>
              <tr>
                <th scope="col">{tf('balanceChanges.table.time', '时间')}</th>
                <th scope="col">{tf('balanceChanges.table.account', '账户')}</th>
                <th scope="col">{tf('balanceChanges.table.type', '类型')}</th>
                <th scope="col">{tf('balanceChanges.table.detail', '说明')}</th>
                <th scope="col" className="is-numeric">
                  {tf('balanceChanges.table.amount', '变动')}
                </th>
                <th scope="col" className="is-numeric">
                  {tf('balanceChanges.table.balanceAfter', '变动后余额')}
                </th>
              </tr>
            </thead>
            {visibleGroups.map((group) => (
              <tbody key={group.key} className="balance-change-day">
                {group.rows.length > 1 ? (
                <tr className="balance-change-day-head">
                  <th scope="rowgroup" colSpan={4}>
                    <span className="balance-change-day-label">{group.label}</span>
                    <span className="balance-change-day-count">
                      {fill(tf('balanceChanges.entryCount', '{{value}} 笔'), {
                        value: group.rows.length
                      })}
                    </span>
                  </th>
                  {/* 当天净额只出现一次:原来「变动」列与「小计」写的是同一个数字 */}
                  <td className="is-numeric balance-change-day-subtotal">
                    {fill(tf('balanceChanges.day.total', '小计 {{amount}}'), {
                      amount: `${signOf(group.net)}${formatCurrencyFixed2(Math.abs(group.net))}`
                    })}
                  </td>
                  <td />
                </tr>
                ) : null}
                {group.rows.map((row) => {
                  const expanded = expandedIds.includes(row.id);
                  return [
                    <tr
                      key={row.id}
                      className={`balance-change-row ${row.tone}${expanded ? ' is-expanded' : ''}`}
                    >
                      <td className="balance-change-time">
                        {group.rows.length > 1 ? (
                          formatClock(row.time)
                        ) : (
                          <span className="balance-change-time-with-day">
                            <span className="balance-change-day-inline">
                              {group.dateLabel}
                              {group.weekday ? (
                                <span className="balance-change-weekday">{` · ${group.weekday}`}</span>
                              ) : null}
                            </span>
                            {formatClock(row.time)}
                          </span>
                        )}
                      </td>
                      <td className="balance-change-account">{row.accountName}</td>
                      <td>
                        <span className="balance-change-type">{getTypeLabel(row.type, tf)}</span>
                      </td>
                      <td className="balance-change-summary">
                        <button
                          type="button"
                          className="balance-change-summary-toggle"
                          aria-expanded={expanded}
                          aria-label={`${row.summary} · ${tf('balanceChanges.row.expand', '展开详情')}`}
                          onClick={() => toggleRow(row.id)}
                        >
                          <span className="balance-change-summary-text">{row.summary}</span>
                          <span className="balance-change-caret" aria-hidden="true" />
                        </button>
                        {row.note && row.note !== row.summary ? (
                          <small className="balance-change-note" title={row.note}>
                            {row.note}
                          </small>
                        ) : null}
                      </td>
                      <td className={`is-numeric balance-change-amount ${row.tone}`}>
                        {signOf(row.delta)}
                        {formatCurrencyFixed2(Math.abs(row.amount))}
                      </td>
                      <td className="is-numeric balance-change-after">
                        {formatCurrencyFixed2(row.afterBalance)}
                      </td>
                    </tr>,
                    expanded ? renderDetailRow(row) : null
                  ];
                })}
              </tbody>
            ))}
          </table>

          <div className="balance-change-pagination">
            <label className="balance-change-field">
              <span>{tf('balanceChanges.pagination.pageSize', '每页')}</span>
              <select
                value={daysPerPage}
                onChange={(event) => patchParams({ days: event.target.value, page: null })}
              >
                {DAY_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {fill(tf('balanceChanges.pagination.daysSize', '{{value}} 天'), { value: size })}
                  </option>
                ))}
              </select>
            </label>
            <span className="balance-change-page-info">
              {fill(tf('balanceChanges.pagination.summary', '第 {{page}} / {{total}} 页 · 共 {{days}} 天'), {
                page: safePage,
                total: totalPages,
                days: dayGroups.length
              })}
            </span>
            <div className="balance-change-pagination-actions">
              <button
                type="button"
                onClick={() => patchParams({ page: '1' })}
                disabled={safePage === 1}
              >
                {tf('balanceChanges.pagination.first', '首页')}
              </button>
              <button
                type="button"
                onClick={() => patchParams({ page: String(Math.max(1, safePage - 1)) })}
                disabled={safePage === 1}
              >
                {tf('balanceChanges.pagination.previous', '上一页')}
              </button>
              <button
                type="button"
                onClick={() => patchParams({ page: String(Math.min(totalPages, safePage + 1)) })}
                disabled={safePage === totalPages}
              >
                {tf('balanceChanges.pagination.next', '下一页')}
              </button>
              <button
                type="button"
                onClick={() => patchParams({ page: String(totalPages) })}
                disabled={safePage === totalPages}
              >
                {tf('balanceChanges.pagination.last', '末页')}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
