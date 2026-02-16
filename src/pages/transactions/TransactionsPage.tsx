import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { extractJsonString } from '../../features/assistant/workbench/workbenchUtils';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { exportTransactionsCsv } from '../../shared/lib/csv';
import {
  applyBillImportMode,
  BillImportMode,
  parseBillFileToTransactions
} from '../../shared/lib/billImport';
import { formatDate } from '../../shared/lib/format';
import { resolveImportDefaultAccountId } from '../../shared/lib/importAccount';
import { Toast, ToastVariant } from '../../shared/ui/Toast';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import {
  TransactionDetailDrawer,
  TransactionDetailSectionKey
} from '../../features/transactions/components/TransactionDetailDrawer';
import { TransactionFilters } from '../../features/transactions/components/TransactionFilters';
import {
  TransactionColumnKey,
  TransactionQuickFilters,
  TransactionRowView,
  TransactionSortDirection,
  TransactionSortKey,
  TransactionTable
} from '../../features/transactions/components/TransactionTable';
import { matchesCategoryQuickFilter } from '../../features/transactions/model/categoryQuickFilter';
import {
  resolveDateRange,
  useTransactionFilters
} from '../../features/transactions/hooks/useTransactionFilters';
import { Category } from '../../entities/category/types';
import { TransactionItem, TransactionSource } from '../../entities/transaction/types';
import { useAiSettings } from '../../shared/store/useAiSettings';

const DEFAULT_PAGE_SIZE = 8;
const PAGE_SIZE_OPTIONS = [8, 20, 50, 100] as const;
const TX_PAGE_SIZE_KEY = 'ledgerflow.transactions.pageSize';
type BillSource = 'wechat' | 'alipay';

const DEFAULT_QUICK_FILTERS: TransactionQuickFilters = {
  date: '',
  type: 'all',
  status: 'all',
  category: '',
  account: '',
  amountMin: '',
  amountMax: '',
  tags: '',
  merchant: '',
  orderNo: '',
  merchantOrderNo: '',
  note: ''
};

const DEFAULT_VISIBLE_COLUMNS: Record<TransactionColumnKey, boolean> = {
  date: true,
  type: true,
  status: true,
  category: true,
  account: true,
  amount: true,
  orderNo: true,
  merchantOrderNo: true,
  note: true
};

const DEFAULT_COLUMN_ORDER: TransactionColumnKey[] = [
  'date',
  'type',
  'status',
  'category',
  'account',
  'amount',
  'orderNo',
  'merchantOrderNo',
  'note'
];

const COLUMN_OPTIONS: Array<{ key: TransactionColumnKey; label: string }> = [
  { key: 'date', label: '日期' },
  { key: 'type', label: '类型' },
  { key: 'status', label: '交易状态' },
  { key: 'category', label: '分类' },
  { key: 'account', label: '账户' },
  { key: 'amount', label: '金额' },
  { key: 'orderNo', label: '交易订单号' },
  { key: 'merchantOrderNo', label: '商家订单号' },
  { key: 'note', label: '备注' }
];

const DEFAULT_DETAIL_SECTIONS: Record<TransactionDetailSectionKey, boolean> = {
  base: true,
  source: true,
  note: true,
  tags: true,
  json: false
};

const TX_VISIBLE_COLUMNS_KEY = 'ledgerflow.transactions.visibleColumns';
const TX_COLUMN_ORDER_KEY = 'ledgerflow.transactions.columnOrder';
const TX_COLUMN_WIDTHS_KEY = 'ledgerflow.transactions.columnWidths';
const TX_DETAIL_SECTIONS_KEY = 'ledgerflow.transactions.detailSections';
const BULK_AI_RECATEGORIZE_CONCURRENCY = 4;

const IMPORT_CATEGORY_RULES: Array<{ pattern: RegExp; names: string[] }> = [
  { pattern: /工资|薪资|salary|payroll|奖金/i, names: ['工资', '收入'] },
  {
    pattern: /打车|出租|滴滴|顺风车|地铁|公交|高德|出行|交通|taxi|metro|bus/i,
    names: ['交通', '出行', '打车']
  },
  { pattern: /餐|外卖|奶茶|咖啡|food|meal|restaurant/i, names: ['餐饮', '美食'] }
];

function restoreRecordState<K extends string>(
  storageKey: string,
  defaults: Record<K, boolean>
): Record<K, boolean> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<K, boolean>>;
    const next = { ...defaults };
    (Object.keys(defaults) as K[]).forEach((key) => {
      if (typeof parsed[key] === 'boolean') {
        next[key] = Boolean(parsed[key]);
      }
    });
    return next;
  } catch {
    return defaults;
  }
}

function restorePageSize(): number {
  try {
    const raw = window.localStorage.getItem(TX_PAGE_SIZE_KEY);
    if (!raw) return DEFAULT_PAGE_SIZE;
    const parsed = Number(raw);
    return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
      ? parsed
      : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function restoreColumnOrder(storageKey: string): TransactionColumnKey[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_COLUMN_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COLUMN_ORDER;
    const valid = parsed.filter((item): item is TransactionColumnKey =>
      DEFAULT_COLUMN_ORDER.includes(item as TransactionColumnKey)
    );
    if (valid.length !== DEFAULT_COLUMN_ORDER.length) return DEFAULT_COLUMN_ORDER;
    return valid;
  } catch {
    return DEFAULT_COLUMN_ORDER;
  }
}

function restoreColumnWidths(storageKey: string): Partial<Record<TransactionColumnKey, number>> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Partial<Record<TransactionColumnKey, number>> = {};
    DEFAULT_COLUMN_ORDER.forEach((key) => {
      const value = Number(parsed[key]);
      if (Number.isFinite(value) && value >= 90 && value <= 640) {
        next[key] = Math.round(value);
      }
    });
    return next;
  } catch {
    return {};
  }
}

/**
 * 导入账单分类匹配：优先按关键字命中“交通/工资/餐饮”等，失败时回落到默认分类。
 * 规则顺序很关键：交通在餐饮前，避免“高德打车”被误命中到餐饮。
 */
function resolveImportedCategoryId(
  item: { type: string; note: string; tags?: string[] },
  categories: Category[],
  fallbackCategoryId: string
): string {
  const text = `${item.note || ''} ${(item.tags || []).join(' ')}`;
  const typePrefixedText = `${item.type} ${text}`;

  for (const rule of IMPORT_CATEGORY_RULES) {
    if (!rule.pattern.test(typePrefixedText)) continue;
    const hit = categories.find((category) =>
      rule.names.some((name) => category.name.includes(name))
    );
    if (hit) return hit.id;
  }

  return fallbackCategoryId;
}

function detectSource(
  source: TransactionSource | undefined,
  note: string,
  tags: string[] | undefined
): TransactionSource {
  if (source) {
    return source;
  }
  const combined = `${note} ${(tags || []).join(' ')}`;
  if (/微信|wechat/i.test(combined)) {
    return 'wechat';
  }
  if (/支付宝|alipay/i.test(combined)) {
    return 'alipay';
  }
  if (/AI|识别/i.test(combined)) {
    return 'ai';
  }
  return 'manual';
}

function buildDuplicateSignature(item: {
  date: string;
  amount: number;
  type: string;
  note: string;
}) {
  return `${item.date.slice(0, 10)}|${Math.round(Number(item.amount || 0) * 100) / 100}|${item.type}|${String(item.note || '').trim()}`;
}

function inferCategoryIdByTransaction(
  transaction: { note: string; tags: string[]; type: string },
  categories: Category[],
  fallbackCategoryId?: string
) {
  const text = `${transaction.note || ''} ${(transaction.tags || []).join(' ')}`.toLowerCase();
  const rules: Array<{ pattern: RegExp; names: string[] }> = [
    { pattern: /餐|外卖|奶茶|咖啡|food|meal|restaurant/, names: ['餐饮', '美食'] },
    { pattern: /地铁|公交|打车|滴滴|交通|taxi|metro|bus/, names: ['交通', '出行', '打车'] },
    { pattern: /电影|影院|演出|娱乐|movie|cinema/, names: ['电影', '娱乐'] }
  ];

  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    const matched = categories.find((item) =>
      rule.names.some((name) => item.name.toLowerCase().includes(name.toLowerCase()))
    );
    if (matched) return matched.id;
  }

  if (transaction.type === 'income') {
    const income = categories.find((item) => /收入|工资/.test(item.name));
    if (income) return income.id;
  }

  return fallbackCategoryId || categories[0]?.id || '';
}

function parseAiCategoryName(raw: string): string {
  try {
    const parsed = JSON.parse(extractJsonString(raw)) as { category?: unknown };
    if (typeof parsed?.category === 'string') {
      return parsed.category.trim();
    }
  } catch {
    // ignore
  }
  return '';
}

/** 将交易按“可判重 key”分组：订单号 > 商家订单号 > 内容指纹。 */
function buildDuplicateGroups(rows: TransactionRowView[]): string[][] {
  const groups = new Map<string, string[]>();
  rows.forEach(({ item }) => {
    const key = item.orderNo
      ? `order:${item.orderNo}`
      : item.merchantOrderNo
        ? `merchant:${item.merchantOrderNo}`
        : `content:${buildDuplicateSignature(item)}`;
    groups.set(key, [...(groups.get(key) || []), item.id]);
  });
  return Array.from(groups.values()).filter((ids) => ids.length > 1);
}

export function TransactionsPage() {
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const removeTransaction = useFinanceStore((s) => s.removeTransaction);
  const clearAllAccountBills = useFinanceStore((s) => s.clearAllAccountBills);

  const aiBaseUrl = useAiSettings((s) => s.baseUrl);
  const aiApiKey = useAiSettings((s) => s.apiKey);
  const aiModel = useAiSettings((s) => s.model);

  const {
    filters,
    isFiltered,
    setKeyword,
    setType,
    setSource,
    setDatePreset,
    setDateFrom,
    setDateTo,
    setPage,
    clearFilters
  } = useTransactionFilters();

  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [importSource, setImportSource] = useState<BillSource | null>(null);
  const [importMode, setImportMode] = useState<BillImportMode>('incremental');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiRecategorizingId, setAiRecategorizingId] = useState<string | null>(null);
  const [bulkAiRecategorizing, setBulkAiRecategorizing] = useState(false);
  const [bulkSelectionEnabled, setBulkSelectionEnabled] = useState(false);
  const [highlightId, setHighlightId] = useState<string>('');
  const [importNotice, setImportNotice] = useState<{
    visible: boolean;
    message: string;
    variant: ToastVariant;
  }>({
    visible: false,
    message: '',
    variant: 'success'
  });
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: ToastVariant }>({
    visible: false,
    message: '',
    variant: 'success'
  });

  const [quickFilters, setQuickFilters] = useState<TransactionQuickFilters>(DEFAULT_QUICK_FILTERS);
  const [sortKey, setSortKey] = useState<TransactionSortKey>('date');
  const [sortDirection, setSortDirection] = useState<TransactionSortDirection>('desc');
  const [visibleColumns, setVisibleColumns] = useState<Record<TransactionColumnKey, boolean>>(() =>
    restoreRecordState<TransactionColumnKey>(TX_VISIBLE_COLUMNS_KEY, DEFAULT_VISIBLE_COLUMNS)
  );
  const [columnOrder, setColumnOrder] = useState<TransactionColumnKey[]>(() =>
    restoreColumnOrder(TX_COLUMN_ORDER_KEY)
  );
  const [visibleDetailSections, setVisibleDetailSections] = useState<
    Record<TransactionDetailSectionKey, boolean>
  >(() =>
    restoreRecordState<TransactionDetailSectionKey>(TX_DETAIL_SECTIONS_KEY, DEFAULT_DETAIL_SECTIONS)
  );
  const [columnWidths, setColumnWidths] = useState<Partial<Record<TransactionColumnKey, number>>>(
    () => restoreColumnWidths(TX_COLUMN_WIDTHS_KEY)
  );
  // 页大小允许用户按账单密度自由切换，长列表下减少翻页成本。
  const [pageSize, setPageSize] = useState<number>(() => restorePageSize());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importSourceRef = useRef<BillSource | null>(null);
  const bulkAiRecategorizingRef = useRef(false);
  const bulkAiCancelRequestedRef = useRef(false);
  const bulkAiAbortControllersRef = useRef<Set<AbortController>>(new Set());

  const dateRange = useMemo(() => resolveDateRange(filters), [filters]);

  useEffect(() => {
    if (
      filters.datePreset === 'custom' &&
      dateRange.from &&
      dateRange.to &&
      dateRange.from > dateRange.to
    ) {
      setErrorMessage('自定义日期范围无效：开始日期不能晚于结束日期。');
      return;
    }
    setErrorMessage('');
  }, [filters.datePreset, dateRange.from, dateRange.to]);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 180);
    return () => window.clearTimeout(timer);
  }, [
    filters.keyword,
    filters.type,
    filters.source,
    filters.datePreset,
    filters.dateFrom,
    filters.dateTo,
    filters.page
  ]);

  useEffect(() => {
    if (!importNotice.visible) {
      return;
    }
    const timer = window.setTimeout(() => {
      setImportNotice((prev) => ({ ...prev, visible: false }));
    }, 5200);
    return () => window.clearTimeout(timer);
  }, [importNotice.visible]);

  useEffect(() => {
    window.localStorage.setItem(TX_VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    window.localStorage.setItem(TX_COLUMN_ORDER_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    window.localStorage.setItem(TX_DETAIL_SECTIONS_KEY, JSON.stringify(visibleDetailSections));
  }, [visibleDetailSections]);

  useEffect(() => {
    window.localStorage.setItem(TX_PAGE_SIZE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    window.localStorage.setItem(TX_COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    const categoryId = searchParams.get('categoryId') ?? '';
    if (!categoryId) {
      return;
    }

    const hasCategory = categories.some((item) => item.id === categoryId);
    if (!hasCategory) {
      return;
    }

    setQuickFilters((prev) =>
      prev.category === categoryId ? prev : { ...prev, category: categoryId }
    );
    setPage(1);
  }, [categories, searchParams, setPage]);

  useEffect(() => {
    const highlight = searchParams.get('highlight') ?? '';
    if (!highlight) {
      return;
    }

    setHighlightId(highlight);
    const rowTimer = window.setTimeout(() => {
      const row = document.getElementById(`transaction-row-${highlight}`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 180);

    const clearTimer = window.setTimeout(() => {
      setHighlightId('');
      const next = new URLSearchParams(searchParams);
      next.delete('highlight');
      setSearchParams(next, { replace: true });
    }, 1200);

    return () => {
      window.clearTimeout(rowTimer);
      window.clearTimeout(clearTimer);
    };
  }, [searchParams, setSearchParams]);

  const filteredRows = useMemo(() => {
    return transactions.filter((item) => {
      const byType = filters.type === 'all' ? true : item.type === filters.type;
      const source = detectSource(item.source, item.note, item.tags);
      const bySource = filters.source === 'all' ? true : source === filters.source;
      const byKeyword =
        filters.keyword.trim().length === 0 ||
        item.note.toLowerCase().includes(filters.keyword.toLowerCase()) ||
        (item.tags || []).join(',').toLowerCase().includes(filters.keyword.toLowerCase());

      let byDate = true;
      if (dateRange.from && dateRange.to) {
        const day = item.date.slice(0, 10);
        byDate = day >= dateRange.from && day <= dateRange.to;
      }

      return byType && bySource && byKeyword && byDate;
    });
  }, [transactions, filters.type, filters.source, filters.keyword, dateRange.from, dateRange.to]);

  const mappedRows: TransactionRowView[] = useMemo(() => {
    return filteredRows.map((item) => ({
      item,
      categoryName: categories.find((c) => c.id === item.categoryId)?.name ?? '-',
      accountName: accounts.find((a) => a.id === item.accountId)?.name ?? '-'
    }));
  }, [accounts, categories, filteredRows]);

  const quickFilteredRows = useMemo(() => {
    const dateFilter = quickFilters.date.trim().toLowerCase();
    const categoryFilter = quickFilters.category.trim();
    const statusFilter = quickFilters.status;
    const accountFilter = quickFilters.account.trim().toLowerCase();
    const amountMinRaw = quickFilters.amountMin.trim();
    const amountMaxRaw = quickFilters.amountMax.trim();
    const amountMin = Number(amountMinRaw);
    const amountMax = Number(amountMaxRaw);
    /**
     * 根因说明：
     * Number('') === 0，之前在“金额筛选框留空”时被误判为有效条件，
     * 导致列表隐式追加“金额必须等于 0”，于是出现“交易记录为空”。
     */
    const hasAmountMin = amountMinRaw.length > 0 && Number.isFinite(amountMin);
    const hasAmountMax = amountMaxRaw.length > 0 && Number.isFinite(amountMax);
    const tagsFilter = quickFilters.tags.trim().toLowerCase();
    const merchantFilter = quickFilters.merchant.trim().toLowerCase();
    const orderNoFilter = quickFilters.orderNo.trim().toLowerCase();
    const merchantOrderNoFilter = quickFilters.merchantOrderNo.trim().toLowerCase();
    const noteFilter = quickFilters.note.trim().toLowerCase();

    return mappedRows.filter((row) => {
      const dateText = formatDate(row.item.date).toLowerCase();
      const typePass = quickFilters.type === 'all' ? true : row.item.type === quickFilters.type;
      const statusPass = statusFilter === 'all' ? true : row.item.status === statusFilter;
      const categoryPass = matchesCategoryQuickFilter(categoryFilter, row.item.categoryId);
      const accountPass = !accountFilter || row.accountName.toLowerCase().includes(accountFilter);
      const orderNoPass =
        !orderNoFilter || (row.item.orderNo || '').toLowerCase().includes(orderNoFilter);
      const merchantOrderNoPass =
        !merchantOrderNoFilter ||
        (row.item.merchantOrderNo || '').toLowerCase().includes(merchantOrderNoFilter);
      const tagsPass =
        !tagsFilter || (row.item.tags || []).join(',').toLowerCase().includes(tagsFilter);
      const merchantPass =
        !merchantFilter ||
        (row.item.note || '').toLowerCase().includes(merchantFilter) ||
        (row.item.merchantOrderNo || '').toLowerCase().includes(merchantFilter);
      const notePass = !noteFilter || (row.item.note || '').toLowerCase().includes(noteFilter);
      const amountPass =
        (!hasAmountMin || row.item.amount >= amountMin) &&
        (!hasAmountMax || row.item.amount <= amountMax);

      return (
        (!dateFilter || dateText.includes(dateFilter)) &&
        typePass &&
        statusPass &&
        categoryPass &&
        accountPass &&
        amountPass &&
        tagsPass &&
        merchantPass &&
        orderNoPass &&
        merchantOrderNoPass &&
        notePass
      );
    });
  }, [mappedRows, quickFilters]);

  const sortedRows = useMemo(() => {
    const rows = [...quickFilteredRows];

    rows.sort((a, b) => {
      let compare = 0;
      switch (sortKey) {
        case 'date':
          compare = new Date(a.item.date).getTime() - new Date(b.item.date).getTime();
          break;
        case 'type':
          compare = a.item.type.localeCompare(b.item.type);
          break;
        case 'status':
          compare = (a.item.status || '').localeCompare(b.item.status || '', 'zh-CN');
          break;
        case 'category':
          compare = a.categoryName.localeCompare(b.categoryName, 'zh-CN');
          break;
        case 'account':
          compare = a.accountName.localeCompare(b.accountName, 'zh-CN');
          break;
        case 'amount':
          compare = a.item.amount - b.item.amount;
          break;
        case 'orderNo':
          compare = (a.item.orderNo || '').localeCompare(b.item.orderNo || '', 'zh-CN');
          break;
        case 'merchantOrderNo':
          compare = (a.item.merchantOrderNo || '').localeCompare(
            b.item.merchantOrderNo || '',
            'zh-CN'
          );
          break;
        case 'note':
          compare = (a.item.note || '').localeCompare(b.item.note || '', 'zh-CN');
          break;
      }

      return sortDirection === 'asc' ? compare : -compare;
    });

    return rows;
  }, [quickFilteredRows, sortDirection, sortKey]);

  const pages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const page = Math.min(filters.page, pages);

  useEffect(() => {
    if (filters.page > pages) {
      setPage(pages);
    }
  }, [filters.page, pages, setPage]);

  const viewRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  const selected = useMemo(
    () => transactions.find((item) => item.id === selectedId) ?? null,
    [transactions, selectedId]
  );

  const selectedCategoryName = selected
    ? (categories.find((item) => item.id === selected.categoryId)?.name ?? '-')
    : '-';
  const selectedAccountName = selected
    ? (accounts.find((item) => item.id === selected.accountId)?.name ?? '-')
    : '-';

  /**
   * 这里同时写 state + ref：
   * state 用于 UI，ref 用于规避“点击后立即选文件”时的异步时序竞态。
   */
  const openImport = (source: BillSource) => {
    importSourceRef.current = source;
    setImportSource(source);
    fileInputRef.current?.click();
  };

  const showToast = (message: string, variant: ToastVariant) => {
    setToast({ visible: true, message, variant });
  };

  const showImportNotice = (message: string, variant: ToastVariant) => {
    setImportNotice({ visible: true, message, variant });
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const activeSource = importSourceRef.current || importSource;
    if (!file || !activeSource) {
      return;
    }

    try {
      const defaultCategoryId = categories[0]?.id;
      const fallbackAccountId = accounts[0]?.id;
      const defaultAccountId = resolveImportDefaultAccountId(
        accounts,
        activeSource,
        fallbackAccountId
      );

      if (!defaultCategoryId || !defaultAccountId) {
        const message = '导入失败：请先创建分类和账户。';
        showToast(message, 'warning');
        showImportNotice(message, 'warning');
        return;
      }

      const parsed = await parseBillFileToTransactions({
        file,
        source: activeSource,
        defaultCategoryId,
        defaultAccountId
      });

      if (parsed.length === 0) {
        const message = '未识别到可导入账单。';
        showToast(message, 'warning');
        showImportNotice(message, 'warning');
        return;
      }

      const normalizedParsed = parsed.map((item) => ({
        ...item,
        categoryId: resolveImportedCategoryId(item, categories, defaultCategoryId)
      }));

      const result = applyBillImportMode({
        mode: importMode,
        existing: transactions,
        incoming: normalizedParsed
      });

      if (result.shouldClearBeforeImport) {
        clearAllAccountBills();
      }

      result.update.forEach((row) => updateTransaction(row.id, row.payload));
      const insertedIds = result.append.map((item) => addTransaction(item));
      const newestId = insertedIds[insertedIds.length - 1];
      const changedCount = result.append.length + result.update.length;
      const expectedIndex = Math.max(0, filteredRows.length + result.append.length - 1);
      const expectedPage = Math.floor(expectedIndex / pageSize) + 1;
      setPage(expectedPage);

      if (changedCount === 0) {
        const message = `导入完成：${result.skipped} 条重复记录已跳过（增量模式）。`;
        showToast(message, 'warning');
        showImportNotice(message, 'warning');
        return;
      }

      const actionLabel =
        importMode === 'overwrite' ? '覆盖' : importMode === 'merge' ? '合并' : '增量导入';
      const message = `导入成功（${actionLabel}）：新增 ${result.append.length} 条，更新 ${result.update.length} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ''}。`;
      showToast(message, 'success');
      showImportNotice(`${message} 已自动定位到最新一条。`, 'success');

      if (newestId) {
        const next = new URLSearchParams(searchParams);
        next.set('highlight', newestId);
        setSearchParams(next, { replace: true });
      }
    } catch {
      const message = '导入失败：文件解析异常。';
      showToast(message, 'error');
      showImportNotice(message, 'error');
    } finally {
      event.target.value = '';
      setImportSource(null);
      importSourceRef.current = null;
    }
  };

  const handleDeleteConfirm = () => {
    if (pendingDeleteIds.length === 0) {
      return;
    }

    pendingDeleteIds.forEach((id) => removeTransaction(id));

    if (selectedId && pendingDeleteIds.includes(selectedId)) {
      setSelectedId(null);
    }

    setSelectedIds((prev) => prev.filter((id) => !pendingDeleteIds.includes(id)));
    showToast(
      pendingDeleteIds.length > 1 ? `已删除 ${pendingDeleteIds.length} 条交易。` : '交易已删除。',
      'success'
    );
    setPendingDeleteIds([]);
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage, 'success');
    } catch {
      showToast('复制失败，请检查浏览器权限。', 'error');
    }
  };

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => transactions.some((item) => item.id === id)));
  }, [transactions]);

  useEffect(() => {
    if (!bulkSelectionEnabled) {
      setSelectedIds([]);
    }
  }, [bulkSelectionEnabled]);

  const pageRowIds = viewRows.map((row) => row.item.id);
  const canSelectAllOnPage = bulkSelectionEnabled && pageRowIds.length > 0;
  const allPageSelected = canSelectAllOnPage && pageRowIds.every((id) => selectedIds.includes(id));

  const handleToggleSelect = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      if (selected) {
        return Array.from(new Set([...prev, id]));
      }
      return prev.filter((itemId) => itemId !== id);
    });
  };

  const handleToggleSelectPage = (selected: boolean) => {
    setSelectedIds((prev) => {
      if (!selected) {
        return prev.filter((itemId) => !pageRowIds.includes(itemId));
      }
      return Array.from(new Set([...prev, ...pageRowIds]));
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) {
      return;
    }
    setPendingDeleteIds(selectedIds);
  };

  const applyBulkUpdate = (payload: { categoryId?: string; accountId?: string }) => {
    if (selectedIds.length === 0) {
      return;
    }

    let changed = 0;
    selectedIds.forEach((id) => {
      const tx = transactions.find((item) => item.id === id);
      if (!tx) return;

      const nextCategoryId = payload.categoryId ?? tx.categoryId;
      const nextAccountId = payload.accountId ?? tx.accountId;
      if (nextCategoryId === tx.categoryId && nextAccountId === tx.accountId) {
        return;
      }

      updateTransaction(id, {
        ...tx,
        categoryId: nextCategoryId,
        accountId: nextAccountId
      });
      changed += 1;
    });

    if (changed > 0) {
      const changedLabel = [payload.categoryId ? '分类' : '', payload.accountId ? '账户' : '']
        .filter(Boolean)
        .join('和');
      showToast(`已批量更新 ${changed} 条交易的${changedLabel}。`, 'success');
    }
  };

  const handleBulkEditCategory = (categoryId: string) => {
    applyBulkUpdate({ categoryId });
  };

  const handleBulkEditAccount = (accountId: string) => {
    applyBulkUpdate({ accountId });
  };

  const recategorizeByAi = async (
    tx: TransactionItem,
    signal?: AbortSignal
  ): Promise<'changed' | 'unchanged' | 'fallback-changed' | 'aborted'> => {
    const fallbackRecategorize = () => {
      const nextCategoryId = inferCategoryIdByTransaction(tx, categories, tx.categoryId);
      if (!nextCategoryId || nextCategoryId === tx.categoryId) {
        return false;
      }
      updateTransaction(tx.id, { ...tx, categoryId: nextCategoryId });
      return true;
    };

    const hasAiConfig =
      Boolean(aiApiKey.trim()) && Boolean(aiModel.trim()) && Boolean(aiBaseUrl.trim());
    if (!hasAiConfig) {
      return fallbackRecategorize() ? 'fallback-changed' : 'unchanged';
    }

    if (signal?.aborted) {
      return 'aborted';
    }

    const txTypeLabel =
      tx.type === 'income'
        ? '收入'
        : tx.type === 'budget'
          ? '预算'
          : tx.type === 'repayment'
            ? '还款'
            : '支出';
    const availableCategories = categories.map((item) => item.name);
    const currentCategoryName =
      categories.find((item) => item.id === tx.categoryId)?.name || '未分类';

    try {
      const reply = await sendAiChat({
        baseUrl: aiBaseUrl,
        apiKey: aiApiKey,
        model: aiModel,
        signal,
        systemPrompt:
          '你是交易重分类助手。请根据交易信息，从给定分类列表中选择最匹配的一项。仅返回 JSON：{"category":"分类名"}。禁止输出解释。若不确定，返回当前分类。',
        messages: [
          {
            role: 'user',
            text: `交易信息：\n- 类型: ${txTypeLabel}\n- 金额: ${tx.amount}\n- 备注: ${tx.note || '无'}\n- 标签: ${(tx.tags || []).join(',') || '无'}\n- 当前分类: ${currentCategoryName}\n可选分类：${JSON.stringify(availableCategories)}`
          }
        ]
      });

      const suggestedName = parseAiCategoryName(reply.content);
      const matched = categories.find((item) => item.name.trim() === suggestedName);
      if (!suggestedName || !matched || matched.id === tx.categoryId) {
        return fallbackRecategorize() ? 'fallback-changed' : 'unchanged';
      }

      updateTransaction(tx.id, { ...tx, categoryId: matched.id });
      return 'changed';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'aborted';
      }
      return fallbackRecategorize() ? 'fallback-changed' : 'unchanged';
    }
  };

  const handleBulkAiRecategorize = async () => {
    if (selectedIds.length === 0) {
      return;
    }

    if (bulkAiRecategorizingRef.current) {
      bulkAiCancelRequestedRef.current = true;
      bulkAiAbortControllersRef.current.forEach((controller) => controller.abort());
      showToast('正在停止批量 AI 重分类…', 'warning');
      return;
    }

    bulkAiRecategorizingRef.current = true;
    bulkAiCancelRequestedRef.current = false;
    setBulkAiRecategorizing(true);

    const txMap = new Map(transactions.map((item) => [item.id, item]));
    const selectedTransactions = selectedIds
      .map((id) => txMap.get(id))
      .filter((item): item is TransactionItem => Boolean(item));

    if (selectedTransactions.length === 0) {
      bulkAiRecategorizingRef.current = false;
      setBulkAiRecategorizing(false);
      return;
    }

    let changed = 0;
    let fallbackChanged = 0;
    let aborted = 0;
    let cursor = 0;

    const runWorker = async () => {
      while (!bulkAiCancelRequestedRef.current) {
        const tx = selectedTransactions[cursor];
        cursor += 1;
        if (!tx) {
          return;
        }

        const controller = new AbortController();
        bulkAiAbortControllersRef.current.add(controller);
        try {
          const result = await recategorizeByAi(tx, controller.signal);
          if (result === 'changed') {
            changed += 1;
          }
          if (result === 'fallback-changed') {
            fallbackChanged += 1;
          }
          if (result === 'aborted') {
            aborted += 1;
          }
        } finally {
          bulkAiAbortControllersRef.current.delete(controller);
        }
      }
    };

    try {
      const workers = Array.from({
        length: Math.min(BULK_AI_RECATEGORIZE_CONCURRENCY, selectedTransactions.length)
      }).map(() => runWorker());
      await Promise.all(workers);

      if (bulkAiCancelRequestedRef.current) {
        showToast(
          `批量 AI 重分类已停止（大模型 ${changed} 条，规则回退 ${fallbackChanged} 条，已取消 ${aborted} 条）。`,
          'warning'
        );
      } else if (changed > 0) {
        showToast(`已按大模型建议完成 ${changed} 条交易重分类。`, 'success');
      } else if (fallbackChanged > 0) {
        showToast(`已按账单信息完成 ${fallbackChanged} 条交易重分类。`, 'success');
      } else {
        showToast('AI 分类建议未变化，无需替换。', 'warning');
      }
    } finally {
      bulkAiAbortControllersRef.current.clear();
      bulkAiCancelRequestedRef.current = false;
      bulkAiRecategorizingRef.current = false;
      setBulkAiRecategorizing(false);
    }
  };

  const hasQuickFilters =
    quickFilters.date.trim().length > 0 ||
    quickFilters.type !== 'all' ||
    quickFilters.status !== 'all' ||
    quickFilters.category.trim().length > 0 ||
    quickFilters.account.trim().length > 0 ||
    quickFilters.amountMin.trim().length > 0 ||
    quickFilters.amountMax.trim().length > 0 ||
    quickFilters.tags.trim().length > 0 ||
    quickFilters.merchant.trim().length > 0 ||
    quickFilters.orderNo.trim().length > 0 ||
    quickFilters.merchantOrderNo.trim().length > 0 ||
    quickFilters.note.trim().length > 0;

  const handleQuickFilterChange = <K extends keyof TransactionQuickFilters>(
    key: K,
    value: TransactionQuickFilters[K]
  ) => {
    setQuickFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleSortChange = (nextKey: TransactionSortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection('desc');
  };

  const clearAllFilters = () => {
    clearFilters();
    setQuickFilters(DEFAULT_QUICK_FILTERS);
  };

  const handleCheckDuplicates = () => {
    // 仅针对当前筛选结果做判重，避免对全量历史做破坏性处理。
    const duplicateGroups = buildDuplicateGroups(sortedRows);
    const duplicateCount = duplicateGroups.reduce((sum, group) => sum + group.length, 0);

    if (duplicateCount === 0) {
      showToast('检测完成：未发现重复账单。', 'success');
      return;
    }

    const shouldOverwrite = window.confirm(
      `检测完成：发现 ${duplicateCount} 条疑似重复账单。\n点击“确定”覆盖重复账单（每组保留最新一条）；点击“取消”继续选择删除重复。`
    );

    if (shouldOverwrite) {
      // 覆盖策略：每组保留最新一条，并把其他重复条目的补充信息并入后删除。
      duplicateGroups.forEach((group) => {
        const txs = group
          .map((id) => transactions.find((item) => item.id === id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .sort((a, b) => +new Date(b.date) - +new Date(a.date));
        const keeper = txs[0];
        const duplicates = txs.slice(1);
        if (!keeper || duplicates.length === 0) return;

        const merged = duplicates.reduce(
          (acc, item) => ({
            ...acc,
            note: acc.note || item.note,
            orderNo: acc.orderNo || item.orderNo,
            merchantOrderNo: acc.merchantOrderNo || item.merchantOrderNo,
            tags: Array.from(new Set([...(acc.tags || []), ...(item.tags || [])]))
          }),
          keeper
        );

        updateTransaction(keeper.id, {
          ...merged,
          amount: Math.round(Number(merged.amount || 0) * 100) / 100
        });
        duplicates.forEach((item) => removeTransaction(item.id));
      });

      showToast('已完成覆盖去重（每组保留最新一条）。', 'success');
      return;
    }

    const shouldDelete = window.confirm(
      '是否删除重复账单？\n点击“确定”删除重复账单（每组保留最早一条）；点击“取消”不处理。'
    );

    if (shouldDelete) {
      // 删除策略：每组保留最早一条，删除其余重复条目。
      duplicateGroups.forEach((group) => {
        const txs = group
          .map((id) => transactions.find((item) => item.id === id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .sort((a, b) => +new Date(a.date) - +new Date(b.date));
        txs.slice(1).forEach((item) => removeTransaction(item.id));
      });
      showToast('已删除重复账单（每组保留最早一条）。', 'success');
      return;
    }

    showToast('已取消重复账单处理。', 'warning');
  };

  const handleToggleColumn = (key: TransactionColumnKey) => {
    setVisibleColumns((prev) => {
      const next = !prev[key];
      if (!next) {
        const enabledCount = Object.values(prev).filter(Boolean).length;
        if (enabledCount <= 1) {
          return prev;
        }
      }
      return { ...prev, [key]: next };
    });
  };

  const handleColumnReorder = (fromKey: TransactionColumnKey, toKey: TransactionColumnKey) => {
    setColumnOrder((prev) => {
      const fromIndex = prev.indexOf(fromKey);
      const toIndex = prev.indexOf(toKey);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, fromKey);
      return next;
    });
  };

  const handleColumnResize = (key: TransactionColumnKey, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [key]: Math.max(90, Math.round(width)) }));
  };

  const handleToggleDetailSection = (key: TransactionDetailSectionKey) => {
    setVisibleDetailSections((prev) => {
      const next = !prev[key];
      if (!next) {
        const enabledCount = Object.values(prev).filter(Boolean).length;
        if (enabledCount <= 1) {
          return prev;
        }
      }
      return { ...prev, [key]: next };
    });
  };

  const selectedSource = selected
    ? detectSource(selected.source, selected.note, selected.tags)
    : 'manual';

  const availableDateBounds = useMemo(() => {
    let min = '';
    let max = '';
    transactions.forEach((item) => {
      const day = String(item.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return;
      }
      if (!min || day < min) {
        min = day;
      }
      if (!max || day > max) {
        max = day;
      }
    });
    return { min, max };
  }, [transactions]);

  return (
    <div className="transactions-page">
      <TransactionFilters
        filters={filters}
        onKeywordChange={setKeyword}
        onTypeChange={setType}
        onSourceChange={setSource}
        onDatePresetChange={setDatePreset}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClear={clearAllFilters}
        onExport={() => exportTransactionsCsv(filteredRows)}
        onImportWechat={() => openImport('wechat')}
        onImportAlipay={() => openImport('alipay')}
        importMode={importMode}
        onImportModeChange={setImportMode}
        onCheckDuplicates={handleCheckDuplicates}
        columnOptions={COLUMN_OPTIONS}
        visibleColumns={visibleColumns}
        onToggleColumn={handleToggleColumn}
        bulkSelectionEnabled={bulkSelectionEnabled}
        onToggleBulkSelection={() => setBulkSelectionEnabled((prev) => !prev)}
        minAvailableDate={availableDateBounds.min}
        maxAvailableDate={availableDateBounds.max}
      />

      {importNotice.visible ? (
        <section
          className={`import-result-banner import-result-${importNotice.variant}`}
          role="status"
          aria-live="polite"
        >
          <strong>导入结果：</strong>
          <span>{importNotice.message}</span>
          <button
            type="button"
            onClick={() => setImportNotice((prev) => ({ ...prev, visible: false }))}
          >
            知道了
          </button>
        </section>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,.txt,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={(event) => void handleImportFile(event)}
      />

      <TransactionTable
        pageSize={pageSize}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
        rows={viewRows}
        total={transactions.length}
        filteredTotal={sortedRows.length}
        page={page}
        pages={pages}
        loading={loading}
        errorMessage={errorMessage}
        hasFilters={isFiltered || hasQuickFilters}
        highlightId={highlightId}
        onRetry={() => setErrorMessage('')}
        onClearFilters={clearAllFilters}
        sortKey={sortKey}
        sortDirection={sortDirection}
        quickFilters={quickFilters}
        onSortChange={handleSortChange}
        onQuickFilterChange={handleQuickFilterChange}
        onPrevPage={() => setPage(Math.max(1, page - 1))}
        onNextPage={() => setPage(Math.min(pages, page + 1))}
        onPageSizeChange={(size) => {
          // 切换页大小后重置到第一页，避免超页码导致用户误解“数据丢失”。
          setPageSize(size);
          setPage(1);
        }}
        onOpenDetail={setSelectedId}
        selectedIds={selectedIds}
        bulkSelectionEnabled={bulkSelectionEnabled}
        canSelectAllOnPage={canSelectAllOnPage}
        allPageSelected={allPageSelected}
        onDelete={(id) => setPendingDeleteIds([id])}
        onDeleteSelected={handleDeleteSelected}
        onBulkEditCategory={handleBulkEditCategory}
        onBulkAiRecategorize={() => void handleBulkAiRecategorize()}
        bulkAiRecategorizing={bulkAiRecategorizing}
        onBulkEditAccount={handleBulkEditAccount}
        categoryOptions={categories.map((item) => ({ id: item.id, name: item.name }))}
        accountOptions={accounts.map((item) => ({ id: item.id, name: item.name }))}
        onClearSelection={() => setSelectedIds([])}
        onToggleSelect={handleToggleSelect}
        onToggleSelectPage={handleToggleSelectPage}
        visibleColumns={visibleColumns}
        columnOrder={columnOrder}
        onColumnReorder={handleColumnReorder}
        columnWidths={columnWidths}
        onColumnResize={handleColumnResize}
        minAvailableDate={availableDateBounds.min}
        maxAvailableDate={availableDateBounds.max}
      />

      <TransactionDetailDrawer
        open={Boolean(selected)}
        transaction={selected}
        categoryName={selectedCategoryName}
        accountName={selectedAccountName}
        source={selectedSource}
        onClose={() => setSelectedId(null)}
        onCopyNote={() => void copyText(selected?.note ?? '', '备注已复制')}
        onCopyJson={() => void copyText(JSON.stringify(selected, null, 2), 'JSON 已复制')}
        onDelete={() => {
          if (!selected) {
            return;
          }
          setPendingDeleteIds([selected.id]);
        }}
        onAiRecategorize={() => {
          if (!selected) return;

          setAiRecategorizingId(selected.id);

          void recategorizeByAi(selected)
            .then((result) => {
              if (result === 'changed') {
                showToast('已按大模型建议完成重分类。', 'success');
                return;
              }
              if (result === 'fallback-changed') {
                showToast('已按账单信息完成 AI 重分类。', 'success');
                return;
              }
              showToast('AI 分类建议未变化，无需替换。', 'warning');
            })
            .finally(() => {
              setAiRecategorizingId(null);
            });
        }}
        aiRecategorizing={selected ? aiRecategorizingId === selected.id : false}
        visibleSections={visibleDetailSections}
        onToggleSection={handleToggleDetailSection}
      />

      <ConfirmDialog
        open={pendingDeleteIds.length > 0}
        title={pendingDeleteIds.length > 1 ? '确认批量删除交易' : '确认删除交易'}
        description={
          pendingDeleteIds.length > 1
            ? `即将删除 ${pendingDeleteIds.length} 条交易，删除后将无法恢复。是否继续？`
            : '删除后将无法恢复。是否继续？'
        }
        confirmText={pendingDeleteIds.length > 1 ? '确认批量删除' : '确认删除'}
        cancelText="取消"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteIds([])}
      />

      <Toast
        visible={toast.visible}
        message={toast.message}
        variant={toast.variant}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
}
