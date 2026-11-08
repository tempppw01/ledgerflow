import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toLocalDateKey } from '../../../shared/lib/localDate';

export type TransactionTypeFilter = 'all' | 'income' | 'expense' | 'budget' | 'repayment';
export type TransactionSourceFilter = 'all' | 'manual' | 'wechat' | 'alipay' | 'ai';
export type TransactionDatePreset = 'all' | 'thisMonth' | 'last30' | 'last3Months' | 'custom';

export interface TransactionFilterState {
  keyword: string;
  type: TransactionTypeFilter;
  source: TransactionSourceFilter;
  datePreset: TransactionDatePreset;
  dateFrom: string;
  dateTo: string;
  page: number;
}

const DEFAULT_FILTERS: TransactionFilterState = {
  keyword: '',
  type: 'all',
  source: 'all',
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
  page: 1
};

function clampPage(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '1', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function normalizeDate(raw: string | null): string {
  if (!raw) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  return '';
}

export function parseTransactionFilterParams(params: URLSearchParams): TransactionFilterState {
  const type = params.get('type');
  const source = params.get('source');
  const datePreset = params.get('datePreset');

  const parsed: TransactionFilterState = {
    keyword: params.get('keyword')?.trim() ?? '',
    type:
      type === 'income' || type === 'expense' || type === 'budget' || type === 'repayment'
        ? type
        : 'all',
    source:
      source === 'manual' || source === 'wechat' || source === 'alipay' || source === 'ai'
        ? source
        : 'all',
    datePreset:
      datePreset === 'thisMonth' ||
      datePreset === 'last30' ||
      datePreset === 'last3Months' ||
      datePreset === 'custom'
        ? datePreset
        : 'all',
    dateFrom: normalizeDate(params.get('dateFrom')),
    dateTo: normalizeDate(params.get('dateTo')),
    page: clampPage(params.get('page'))
  };

  if (parsed.datePreset !== 'custom') {
    parsed.dateFrom = '';
    parsed.dateTo = '';
  }

  return parsed;
}

export function buildTransactionFilterParams(filters: TransactionFilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.keyword) {
    params.set('keyword', filters.keyword);
  }

  if (filters.type !== DEFAULT_FILTERS.type) {
    params.set('type', filters.type);
  }

  if (filters.source !== DEFAULT_FILTERS.source) {
    params.set('source', filters.source);
  }

  if (filters.datePreset !== DEFAULT_FILTERS.datePreset) {
    params.set('datePreset', filters.datePreset);
  }

  if (filters.datePreset === 'custom') {
    if (filters.dateFrom) {
      params.set('dateFrom', filters.dateFrom);
    }
    if (filters.dateTo) {
      params.set('dateTo', filters.dateTo);
    }
  }

  if (filters.page > 1) {
    params.set('page', String(filters.page));
  }

  return params;
}

export function resolveDateRange(filters: TransactionFilterState): { from: string; to: string } {
  if (filters.datePreset === 'custom') {
    return { from: filters.dateFrom, to: filters.dateTo };
  }

  if (filters.datePreset === 'thisMonth') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      from: toLocalDateKey(from),
      to: toLocalDateKey(to)
    };
  }

  if (filters.datePreset === 'last30') {
    const now = new Date();
    const to = new Date(now);
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return {
      from: toLocalDateKey(from),
      to: toLocalDateKey(to)
    };
  }

  if (filters.datePreset === 'last3Months') {
    const now = new Date();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return {
      from: toLocalDateKey(from),
      to: toLocalDateKey(to)
    };
  }

  return { from: '', to: '' };
}

export function useTransactionFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => parseTransactionFilterParams(searchParams), [searchParams]);

  const setFilters = (patch: Partial<TransactionFilterState>) => {
    const next: TransactionFilterState = {
      ...filters,
      ...patch
    };

    if (patch.datePreset && patch.datePreset !== 'custom') {
      next.dateFrom = '';
      next.dateTo = '';
    }

    const hasNonPagePatch = Object.keys(patch).some((key) => key !== 'page');
    if (hasNonPagePatch) {
      next.page = 1;
    }

    setSearchParams(buildTransactionFilterParams(next), { replace: true });
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const isFiltered =
    Boolean(filters.keyword) ||
    filters.type !== 'all' ||
    filters.source !== 'all' ||
    filters.datePreset !== 'all' ||
    filters.page > 1;

  return {
    filters,
    isFiltered,
    setKeyword: (keyword: string) => setFilters({ keyword }),
    setType: (type: TransactionTypeFilter) => setFilters({ type }),
    setSource: (source: TransactionSourceFilter) => setFilters({ source }),
    setDatePreset: (datePreset: TransactionDatePreset) => setFilters({ datePreset }),
    setDateFrom: (dateFrom: string) => setFilters({ dateFrom, datePreset: 'custom' }),
    setDateTo: (dateTo: string) => setFilters({ dateTo, datePreset: 'custom' }),
    setPage: (page: number) => setFilters({ page }),
    clearFilters
  };
}
