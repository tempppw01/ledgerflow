import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { extractJsonString } from '../../features/assistant/workbench/workbenchUtils';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { exportTransactionsCsv } from '../../shared/lib/csv';
import {
  applyBillImportMode,
  ApplyBillImportModeResult,
  BillImportMode,
  BillImportParseSummary,
  parseBillFileToTransactionsDetailed
} from '../../shared/lib/billImport';
import { formatCurrency, formatCurrencyAuto, formatDate } from '../../shared/lib/format';
import { resolveImportDefaultAccountId } from '../../shared/lib/importAccount';
import { Toast, ToastVariant } from '../../shared/ui/Toast';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import {
  TransactionDetailDrawer,
  TransactionDetailSectionKey
} from '../../features/transactions/components/TransactionDetailDrawer';
import { TransactionFilters } from '../../features/transactions/components/TransactionFilters';
import { AmountKeypad } from '../../features/transactions/components/AmountKeypad';
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
  exportTransactionsPdf,
  type BulkPrintTemplate
} from '../../features/transactions/model/exportTransactionsPdf';
import { evaluateCalculatorExpression } from '../../features/transactions/model/calculator';
import { buildPieGradient } from '../../features/transactions/model/chartUtils';
import {
  getDailyFlexibleBudget,
  getQuickAddDailySpending
} from '../../features/transactions/model/quickAddSummary';
import {
  buildBulkPrintStyles,
  printHtmlWithIframe
} from '../../features/transactions/model/printUtils';
import {
  txTypeLabel,
  txStatusLabel,
  maskShareText,
  buildTransactionShareText,
  type BillShareTemplate
} from '../../features/transactions/model/shareUtils';
import {
  resolveDateRange,
  useTransactionFilters
} from '../../features/transactions/hooks/useTransactionFilters';
import { Category } from '../../entities/category/types';
import {
  TransactionAttachmentItem,
  TransactionItem,
  TransactionSource,
  TransactionType
} from '../../entities/transaction/types';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useSmartBudgetStore } from '../../shared/store/useSmartBudgetStore';
import { useAuth } from '../../features/auth/ui/authContext';
import {
  clearQuickTransactionDraft,
  readQuickTransactionDraft,
  writeQuickTransactionDraft,
  type QuickTransactionDraft
} from '../transaction-edit/transactionDraft';

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
  location: '',
  orderNo: '',
  merchantOrderNo: '',
  note: ''
};

const TX_SEARCH_HISTORY_KEY = 'ledgerflow.transactions.searchHistory';
const TX_SIDE_PANEL_VISIBLE_KEY = 'ledgerflow.transactions.sidePanelVisible';

function easeOutCubic(t: number) {
  const p = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - p) ** 3;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractLocation(note: string): string {
  const match = note.match(/(?:@|在|于|地点[:：])\s*([\u4e00-\u9fa5A-Za-z0-9·\-\s]{2,20})/);
  return match?.[1]?.trim() || '';
}

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

const COLUMN_MIN_WIDTHS: Record<TransactionColumnKey, number> = {
  date: 90,
  type: 90,
  status: 90,
  category: 90,
  account: 90,
  amount: 72,
  orderNo: 90,
  merchantOrderNo: 90,
  note: 90
};
const COLUMN_MAX_WIDTH = 640;

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

function restoreSidePanelVisible(): boolean {
  try {
    const raw = window.localStorage.getItem(TX_SIDE_PANEL_VISIBLE_KEY);
    if (raw === null) {
      return false;
    }
    return raw !== '0';
  } catch {
    return false;
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
      if (Number.isFinite(value) && value >= COLUMN_MIN_WIDTHS[key] && value <= COLUMN_MAX_WIDTH) {
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
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const removeTransaction = useFinanceStore((s) => s.removeTransaction);
  const refundTransaction = useFinanceStore((s) => s.refundTransaction);
  const clearAllAccountBills = useFinanceStore((s) => s.clearAllAccountBills);
  const confirmedSmartBudgetPlan = useSmartBudgetStore((s) => s.confirmedPlan);

  const aiBaseUrl = useAiSettings((s) => s.baseUrl);
  const aiApiKey = useAiSettings((s) => s.apiKey);
  const aiModel = useAiSettings((s) => s.model);
  const bulkRecategorizeConcurrency = useAiSettings((s) => s.bulkRecategorizeConcurrency);

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
  const [pendingRefundTransactionId, setPendingRefundTransactionId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiRecategorizingId, setAiRecategorizingId] = useState<string | null>(null);
  const [bulkAiRecategorizing, setBulkAiRecategorizing] = useState(false);
  const [bulkAiProgress, setBulkAiProgress] = useState<{
    visible: boolean;
    processed: number;
    total: number;
    changed: number;
    fallbackChanged: number;
    aborted: number;
  }>({
    visible: false,
    processed: 0,
    total: 0,
    changed: 0,
    fallbackChanged: 0,
    aborted: 0
  });
  const [bulkSelectionEnabled, setBulkSelectionEnabled] = useState(false);
  const [highlightId, setHighlightId] = useState<string>('');
  const [privacyMode, setPrivacyMode] = useState(false);
  const [bulkPrintTemplate, setBulkPrintTemplate] = useState<BulkPrintTemplate>('full');
  const [bulkExportingPdf, setBulkExportingPdf] = useState(false);
  const [bulkPrintFields, setBulkPrintFields] = useState({
    includeAccount: true,
    includeNote: true,
    includeOrderNo: false,
    includeTags: false
  });
  const [importNotice, setImportNotice] = useState<{
    visible: boolean;
    message: string;
    variant: ToastVariant;
  }>({
    visible: false,
    message: '',
    variant: 'success'
  });
  const [importReportText, setImportReportText] = useState('');
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: ToastVariant }>({
    visible: false,
    message: '',
    variant: 'success'
  });
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    source: BillSource;
    mode: BillImportMode;
    normalizedParsed: Omit<TransactionItem, 'id'>[];
    result: ApplyBillImportModeResult;
    parseSummary: BillImportParseSummary;
  } | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTemplate, setShareTemplate] = useState<BillShareTemplate>('full');
  const [shareIncludeNote, setShareIncludeNote] = useState(true);
  const [shareIncludeAttachments, setShareIncludeAttachments] = useState(true);
  const [shareIncludeAccount, setShareIncludeAccount] = useState(true);

  const [quickFilters, setQuickFilters] = useState<TransactionQuickFilters>(DEFAULT_QUICK_FILTERS);

  useEffect(() => {
    const note = searchParams.get('note') ?? '';
    const tags = searchParams.get('tags') ?? '';
    if (!note && !tags) {
      return;
    }

    setQuickFilters((prev) => {
      const nextNote = note || prev.note;
      const nextTags = tags || prev.tags;
      if (prev.note === nextNote && prev.tags === nextTags) {
        return prev;
      }
      return {
        ...prev,
        note: nextNote,
        tags: nextTags
      };
    });
    setPage(1);
  }, [searchParams, setPage]);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(TX_SEARCH_HISTORY_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : [];
    } catch {
      return [];
    }
  });
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
  const initialQuickDraft = useMemo(
    () => readQuickTransactionDraft(user.ledgerUserId),
    [user.ledgerUserId]
  );
  const quickAddDefaultDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddType, setQuickAddType] = useState<TransactionType>(
    initialQuickDraft?.type ?? 'expense'
  );
  const [quickAddCategoryId, setQuickAddCategoryId] = useState(initialQuickDraft?.categoryId ?? '');
  const [quickAddAccountId, setQuickAddAccountId] = useState(initialQuickDraft?.accountId ?? '');
  const [quickAddAmount, setQuickAddAmount] = useState('');
  const [quickAddExpression, setQuickAddExpression] = useState(initialQuickDraft?.expression ?? '');
  const [quickAddCalculatedAmount, setQuickAddCalculatedAmount] = useState<number | null>(null);
  const [quickAddDate, setQuickAddDate] = useState(initialQuickDraft?.date ?? quickAddDefaultDate);
  const [quickAddNote, setQuickAddNote] = useState(initialQuickDraft?.note ?? '');
  const [quickAddError, setQuickAddError] = useState('');
  const [quickAddDraftStatus, setQuickAddDraftStatus] = useState(
    initialQuickDraft ? '已恢复未完成草稿' : ''
  );
  const [tablePanelWidth, setTablePanelWidth] = useState(860);
  const [sidePanelVisible, setSidePanelVisible] = useState(() => restoreSidePanelVisible());
  const [pieAnimationProgress, setPieAnimationProgress] = useState(1);
  const [splitLayoutStacked, setSplitLayoutStacked] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1100px)').matches : false
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
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
    window.localStorage.setItem(TX_SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
  }, [searchHistory]);

  useEffect(() => {
    window.localStorage.setItem(TX_SIDE_PANEL_VISIBLE_KEY, sidePanelVisible ? '1' : '0');
  }, [sidePanelVisible]);

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

  useEffect(() => {
    if (quickAddOpen) {
      return;
    }

    const quickAddFlag = searchParams.get('quickAdd');
    if (quickAddFlag !== '1') {
      return;
    }

    setSelectedId(null);
    setQuickAddError('');
    setQuickAddOpen(true);

    const next = new URLSearchParams(searchParams);
    next.delete('quickAdd');
    setSearchParams(next, { replace: true });
  }, [quickAddOpen, searchParams, setSearchParams]);

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
    const amountMin = Number(amountMinRaw);
    /**
     * 根因说明：
     * Number('') === 0，之前在“金额筛选框留空”时被误判为有效条件，
     * 导致列表隐式追加“金额必须等于 0”，于是出现“交易记录为空”。
     */
    const hasAmountMin = amountMinRaw.length > 0 && Number.isFinite(amountMin);
    const amountMaxRaw = quickFilters.amountMax.trim();
    const amountMax = Number(amountMaxRaw);
    const hasAmountMax = amountMaxRaw.length > 0 && Number.isFinite(amountMax);
    const tagsFilter = quickFilters.tags.trim().toLowerCase();
    const merchantFilter = quickFilters.merchant.trim().toLowerCase();
    const locationFilter = quickFilters.location.trim().toLowerCase();
    const orderNoFilter = quickFilters.orderNo.trim().toLowerCase();
    const merchantOrderNoFilter = quickFilters.merchantOrderNo.trim().toLowerCase();
    const noteFilter = quickFilters.note.trim().toLowerCase();

    return mappedRows.filter((row) => {
      const rowDay = String(row.item.date || '').slice(0, 10);
      const typePass = quickFilters.type === 'all' ? true : row.item.type === quickFilters.type;
      const statusPass = statusFilter === 'all' ? true : row.item.status === statusFilter;
      const categoryPass = matchesCategoryQuickFilter(categoryFilter, row.item.categoryId);
      const accountPass = !accountFilter || row.item.accountId === accountFilter;
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
      const locationText = extractLocation(row.item.note).toLowerCase();
      const locationPass =
        !locationFilter ||
        locationText.includes(locationFilter) ||
        (row.item.note || '').toLowerCase().includes(`在${locationFilter}`);
      const notePass = !noteFilter || (row.item.note || '').toLowerCase().includes(noteFilter);
      const amountPass =
        (!hasAmountMin || row.item.amount >= amountMin) &&
        (!hasAmountMax || row.item.amount <= amountMax);

      return (
        (!dateFilter || rowDay === dateFilter) &&
        typePass &&
        statusPass &&
        categoryPass &&
        accountPass &&
        amountPass &&
        tagsPass &&
        merchantPass &&
        locationPass &&
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

  const currentBillSummary = useMemo<{
    income: number;
    expense: number;
    net: number;
    count: number;
    maxExpense: TransactionRowView | null;
  }>(() => {
    let income = 0;
    let expense = 0;
    let maxExpense: TransactionRowView | null = null;

    sortedRows.forEach((row) => {
      const amount = Number(row.item.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return;
      }
      if (row.item.type === 'income') {
        income += amount;
        return;
      }
      if (
        row.item.type === 'expense' ||
        row.item.type === 'repayment' ||
        row.item.type === 'budget'
      ) {
        expense += amount;
        if (!maxExpense || amount > maxExpense.item.amount) {
          maxExpense = row;
        }
      }
    });

    return {
      income,
      expense,
      net: income - expense,
      count: sortedRows.length,
      maxExpense
    };
  }, [sortedRows]);

  const currentPeriodLabel = useMemo(() => {
    if (filters.datePreset === 'custom' && (filters.dateFrom || filters.dateTo)) {
      return `${filters.dateFrom || '起始'} ~ ${filters.dateTo || '至今'}`;
    }
    if (filters.datePreset === 'thisMonth') return '本月';
    if (filters.datePreset === 'last3Months') return '最近三月';
    if (filters.datePreset === 'last30') return '最近 30 天';
    return '全部时间';
  }, [filters.dateFrom, filters.datePreset, filters.dateTo]);

  const selected = useMemo(
    () => transactions.find((item) => item.id === selectedId) ?? null,
    [transactions, selectedId]
  );

  const selectedRelatedOrigin = useMemo(() => {
    if (!selected?.refundOfTransactionId) {
      return null;
    }
    return transactions.find((item) => item.id === selected.refundOfTransactionId) ?? null;
  }, [selected, transactions]);

  const pendingRefundTransaction = useMemo(() => {
    if (!pendingRefundTransactionId) {
      return null;
    }
    return transactions.find((item) => item.id === pendingRefundTransactionId) ?? null;
  }, [pendingRefundTransactionId, transactions]);

  const pendingRefundedAmount = useMemo(() => {
    if (!pendingRefundTransaction) {
      return 0;
    }
    return transactions.reduce((sum, item) => {
      if (
        item.refundOfTransactionId !== pendingRefundTransaction.id ||
        (item.adjustmentKind !== 'refund' && item.adjustmentKind !== 'reversal')
      ) {
        return sum;
      }
      return sum + (Number(item.amount) || 0);
    }, 0);
  }, [pendingRefundTransaction, transactions]);

  const pendingRefundRemainingAmount = useMemo(() => {
    if (!pendingRefundTransaction) {
      return 0;
    }
    return Math.max(
      0,
      Number((Number(pendingRefundTransaction.amount || 0) - pendingRefundedAmount).toFixed(2))
    );
  }, [pendingRefundTransaction, pendingRefundedAmount]);

  const selectedRefundChildren = useMemo(() => {
    if (!selected) {
      return [];
    }
    return transactions.filter(
      (item) =>
        item.refundOfTransactionId === selected.id &&
        (item.adjustmentKind === 'refund' || item.adjustmentKind === 'reversal')
    );
  }, [selected, transactions]);

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

  const handleAttachmentUploaded = useCallback(
    (attachment: TransactionAttachmentItem) => {
      if (!selected) {
        return;
      }
      updateTransaction(selected.id, {
        ...selected,
        attachments: [attachment, ...(selected.attachments || [])]
      });
    },
    [selected, updateTransaction]
  );

  const handleAttachmentUploadStatus = useCallback(
    (message: string, tone: 'success' | 'error' | 'warning') => {
      showToast(message, tone);
    },
    []
  );

  const quickAddCategoryOptions = useMemo(() => {
    const matched = categories.filter(
      (item) => !item.kind || item.kind === (quickAddType === 'income' ? 'income' : 'expense')
    );
    return matched.length > 0 ? matched : categories;
  }, [categories, quickAddType]);

  useEffect(() => {
    if (quickAddCategoryOptions.length === 0) {
      setQuickAddCategoryId('');
      return;
    }
    if (!quickAddCategoryOptions.some((item) => item.id === quickAddCategoryId)) {
      setQuickAddCategoryId(quickAddCategoryOptions[0].id);
    }
  }, [quickAddCategoryId, quickAddCategoryOptions]);

  useEffect(() => {
    if (!accounts.length) {
      setQuickAddAccountId('');
      return;
    }
    if (!accounts.some((item) => item.id === quickAddAccountId)) {
      setQuickAddAccountId(accounts[0].id);
    }
  }, [accounts, quickAddAccountId]);

  const quickAddDraftHasContent = Boolean(
    quickAddExpression.trim() ||
    quickAddNote.trim() ||
    quickAddType !== 'expense' ||
    quickAddCategoryId !== (quickAddCategoryOptions[0]?.id ?? '') ||
    quickAddAccountId !== (accounts[0]?.id ?? '') ||
    quickAddDate !== quickAddDefaultDate
  );

  useEffect(() => {
    if (!quickAddDraftHasContent) {
      clearQuickTransactionDraft(user.ledgerUserId);
      return;
    }
    const draft: QuickTransactionDraft = {
      type: quickAddType === 'income' ? 'income' : 'expense',
      categoryId: quickAddCategoryId,
      accountId: quickAddAccountId,
      expression: quickAddExpression,
      date: quickAddDate,
      note: quickAddNote
    };
    writeQuickTransactionDraft(user.ledgerUserId, draft);
    setQuickAddDraftStatus('草稿已自动保存');
  }, [
    accounts,
    quickAddAccountId,
    quickAddCategoryId,
    quickAddDate,
    quickAddDefaultDate,
    quickAddDraftHasContent,
    quickAddExpression,
    quickAddNote,
    quickAddType,
    quickAddCategoryOptions,
    user.ledgerUserId
  ]);

  const resetQuickAddForm = () => {
    setQuickAddType('expense');
    setQuickAddAmount('');
    setQuickAddExpression('');
    setQuickAddCalculatedAmount(null);
    setQuickAddDate(quickAddDefaultDate);
    setQuickAddNote('');
    setQuickAddError('');
    setQuickAddDraftStatus('');
    clearQuickTransactionDraft(user.ledgerUserId);
  };

  const openQuickAddDrawer = () => {
    setSelectedId(null);
    setQuickAddError('');
    setQuickAddOpen(true);
  };

  const closeQuickAddDrawer = useCallback(() => {
    setQuickAddOpen(false);
    setQuickAddError('');
  }, []);

  const handleQuickAddKeypadInput = useCallback((key: string) => {
    setQuickAddExpression((prev) => {
      if (key === 'clear') return '';
      if (key === 'backspace') return prev.slice(0, -1);
      if (key === '=') {
        const evaluated = evaluateCalculatorExpression(prev);
        return evaluated === null ? prev : String(evaluated);
      }
      if (key === '00') {
        if (!prev || prev === '0') return prev;
        return `${prev}00`;
      }
      return `${prev}${key}`;
    });
    setQuickAddError('');
  }, []);

  useEffect(() => {
    const evaluated = evaluateCalculatorExpression(quickAddExpression);
    setQuickAddCalculatedAmount(evaluated);
    if (evaluated === null) {
      setQuickAddAmount(quickAddExpression.trim());
      return;
    }
    setQuickAddAmount(String(evaluated));
  }, [quickAddExpression]);

  const quickAddBudgetSummary = useMemo(() => {
    const proposedExpense = quickAddType === 'expense' ? Number(quickAddAmount) : 0;
    const spending = getQuickAddDailySpending({
      transactions,
      date: quickAddDate,
      proposedExpense
    });
    const dailyBudget = getDailyFlexibleBudget(
      confirmedSmartBudgetPlan?.recommendation.flexibleBudget ?? null,
      quickAddDate
    );

    return {
      ...spending,
      dailyBudget,
      remaining:
        dailyBudget === null ? null : Math.round((dailyBudget - spending.projected) * 100) / 100
    };
  }, [confirmedSmartBudgetPlan, quickAddAmount, quickAddDate, quickAddType, transactions]);

  useEffect(() => {
    if (!quickAddOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (
        active?.tagName === 'INPUT' ||
        active?.tagName === 'TEXTAREA' ||
        active?.tagName === 'SELECT'
      ) {
        const id = active.getAttribute('id') || '';
        if (id && id !== 'quick-add-expression') {
          return;
        }
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        handleQuickAddKeypadInput('=');
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        handleQuickAddKeypadInput('backspace');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeQuickAddDrawer();
        return;
      }
      if (event.key === '=') {
        event.preventDefault();
        handleQuickAddKeypadInput('=');
        return;
      }

      if (/^[0-9.+\-*/()]$/.test(event.key)) {
        event.preventDefault();
        handleQuickAddKeypadInput(event.key);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickAddOpen, closeQuickAddDrawer, handleQuickAddKeypadInput]);

  const handleSaveQuickAdd = () => {
    if (!quickAddCategoryId) {
      setQuickAddError(t('transactions.quickAdd.error.selectCategory'));
      return;
    }
    if (!quickAddAccountId) {
      setQuickAddError(t('transactions.quickAdd.error.selectAccount'));
      return;
    }
    const amount = Number(quickAddAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setQuickAddError(t('transactions.quickAdd.error.invalidAmount'));
      return;
    }

    addTransaction({
      type: quickAddType,
      categoryId: quickAddCategoryId,
      accountId: quickAddAccountId,
      amount: Math.round(amount * 100) / 100,
      date: quickAddDate,
      note: quickAddNote.trim() || t('transactions.quickAdd.defaultNote'),
      tags: [],
      source: 'manual',
      status: 'completed'
    });

    closeQuickAddDrawer();
    resetQuickAddForm();
    setPage(1);
    showToast(t('transactions.quickAdd.saved'), 'success');
  };

  const showImportNotice = (message: string, variant: ToastVariant) => {
    setImportNotice({ visible: true, message, variant });
  };

  const copyImportReport = async () => {
    if (!importReportText) {
      showToast('暂无可复制的导入报告。', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(importReportText);
      showToast('导入报告已复制。', 'success');
    } catch {
      showToast('复制失败，请检查浏览器权限。', 'error');
    }
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

      const parsedResult = await parseBillFileToTransactionsDetailed({
        file,
        source: activeSource,
        defaultCategoryId,
        defaultAccountId
      });
      const parsed = parsedResult.rows;

      if (parsed.length === 0) {
        const summary = parsedResult.summary;
        const message = summary.headerDetected
          ? `未识别到可导入账单（数据行 ${summary.dataLines}，跳过 ${summary.skippedCount}）。`
          : '未识别到可导入账单：未找到有效表头，请检查账单格式。';
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

      setPendingImport({
        fileName: file.name,
        source: activeSource,
        mode: importMode,
        normalizedParsed,
        result,
        parseSummary: parsedResult.summary
      });

      const previewMessage = `第 2 步（预检完成）：识别 ${normalizedParsed.length} 条（数据行 ${parsedResult.summary.dataLines}，跳过 ${parsedResult.summary.skippedCount}）。请确认后写入。`;
      showToast(previewMessage, 'success');
      showImportNotice(previewMessage, 'success');
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知异常';
      const message = `导入失败：${detail}`;
      showToast(message, 'error');
      showImportNotice(message, 'error');
    } finally {
      event.target.value = '';
      setImportSource(null);
      importSourceRef.current = null;
    }
  };

  const handleConfirmPendingImport = () => {
    if (!pendingImport) {
      return;
    }

    const { result, mode } = pendingImport;

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
      const report = [
        `导入报告`,
        `文件：${pendingImport.fileName}`,
        `模式：${mode === 'overwrite' ? '覆盖' : mode === 'merge' ? '合并' : '增量'}`,
        `结果：无新增或更新`,
        `跳过重复：${result.skipped} 条`
      ].join('\n');
      setImportReportText(report);
      showToast(message, 'warning');
      showImportNotice(message, 'warning');
      setPendingImport(null);
      return;
    }

    const actionLabel = mode === 'overwrite' ? '覆盖' : mode === 'merge' ? '合并' : '增量导入';
    const message = `第 3 步（导入完成）：新增 ${result.append.length} 条，更新 ${result.update.length} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ''}（${actionLabel}）。`;
    const report = [
      `导入报告`,
      `文件：${pendingImport.fileName}`,
      `来源：${pendingImport.source === 'wechat' ? '微信' : '支付宝'}`,
      `模式：${mode === 'overwrite' ? '覆盖（清空后导入）' : mode === 'merge' ? '合并（覆盖重复）' : '增量（跳过重复）'}`,
      `识别：${pendingImport.parseSummary.parsedCount} 条（数据行 ${pendingImport.parseSummary.dataLines}，跳过 ${pendingImport.parseSummary.skippedCount}）`,
      `结果：新增 ${result.append.length} 条，更新 ${result.update.length} 条，跳过重复 ${result.skipped} 条`,
      `时间：${new Date().toLocaleString()}`
    ].join('\n');
    setImportReportText(report);
    showToast(message, 'success');
    showImportNotice(`${message} 已自动定位到最新一条。`, 'success');

    if (newestId) {
      const next = new URLSearchParams(searchParams);
      next.set('highlight', newestId);
      setSearchParams(next, { replace: true });
    }

    setPendingImport(null);
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
      pendingDeleteIds.length > 1
        ? `已将 ${pendingDeleteIds.length} 条交易移入回收站。`
        : '交易已移入回收站。',
      'success'
    );
    setPendingDeleteIds([]);
  };

  const handleRefundConfirm = () => {
    if (!pendingRefundTransaction) {
      return;
    }

    try {
      const refundResult = refundTransaction({
        transactionId: pendingRefundTransaction.id,
        amount: pendingRefundRemainingAmount,
        note: `退款：${pendingRefundTransaction.note || '原始交易'}`
      });

      showToast(
        refundResult.fullyRefunded
          ? `退款已成功创建，${pendingRefundRemainingAmount.toFixed(2)} 元已回补到原账户，原单已标记为已退款。`
          : `退款已成功创建，${pendingRefundRemainingAmount.toFixed(2)} 元已回补到原账户，剩余可退 ¥${refundResult.remainingRefundableAmount.toFixed(2)}。`,
        'success'
      );
      setSelectedId(refundResult.refundTransactionId);
      setPendingRefundTransactionId(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '退款失败，请稍后重试。', 'error');
    }
  };

  const fallbackCopyText = (text: string) => {
    if (typeof document === 'undefined') {
      throw new Error('document unavailable');
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const succeeded = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!succeeded) {
      throw new Error('execCommand copy failed');
    }
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopyText(text);
      }
      showToast(successMessage, 'success');
    } catch {
      try {
        fallbackCopyText(text);
        showToast(successMessage, 'success');
      } catch {
        showToast('复制失败，请检查浏览器权限。', 'error');
      }
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

  const handleBulkExportPdf = async () => {
    if (bulkExportingPdf) {
      showToast('PDF 正在导出中，请稍候。', 'warning');
      return;
    }

    const selectedRows = viewRows.filter((row) => selectedIds.includes(row.item.id));
    if (selectedRows.length === 0) {
      showToast('请先勾选要导出 PDF 的交易。', 'warning');
      return;
    }

    setBulkExportingPdf(true);
    showToast('正在生成 PDF，请稍候…', 'warning');

    try {
      await exportTransactionsPdf({
        rows: selectedRows,
        privacyMode,
        bulkPrintTemplate,
        bulkPrintFields,
        maskShareText
      });
      showToast('PDF 已开始下载。', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出 PDF 失败。', 'error');
    } finally {
      setBulkExportingPdf(false);
    }
  };

  const handleBulkPrintA4 = (options?: { preferPdf?: boolean }) => {
    const selectedRows = viewRows.filter((row) => selectedIds.includes(row.item.id));
    if (selectedRows.length === 0) {
      showToast('请先勾选要打印的交易。', 'warning');
      return;
    }

    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1120,height=860');
    const popupBlocked = !printWindow;

    const totalAmount = selectedRows.reduce((sum, row) => sum + Number(row.item.amount || 0), 0);
    const incomeTotal = selectedRows.reduce(
      (sum, row) => sum + (row.item.type === 'income' ? Number(row.item.amount || 0) : 0),
      0
    );
    const expenseTotal = selectedRows.reduce(
      (sum, row) => sum + (row.item.type !== 'income' ? Number(row.item.amount || 0) : 0),
      0
    );
    const maskAmountText = (value: number) => (privacyMode ? '¥••••' : formatCurrency(value));
    const maskPrintText = (value?: string) => {
      if (!value?.trim()) return '—';
      return privacyMode ? maskShareText(value) : value;
    };
    const dateTimestamps = selectedRows
      .map((row) => new Date(row.item.date).getTime())
      .filter((value) => Number.isFinite(value));
    const dateRangeText = dateTimestamps.length
      ? `${formatDate(new Date(Math.min(...dateTimestamps)).toISOString())} ～ ${formatDate(
          new Date(Math.max(...dateTimestamps)).toISOString()
        )}`
      : '—';
    const generatedAtText = new Date().toLocaleString('zh-CN', { hour12: false });

    const tableRows = selectedRows
      .map(({ item, categoryName, accountName }) => {
        const amountText = `${item.type === 'income' ? '+' : '-'}${maskAmountText(item.amount)}`;
        const safeCategory = maskPrintText(categoryName || '未分类');
        const safeAccount = maskPrintText(accountName || '未指定账户');
        const safeNote = maskPrintText(item.note || '—');
        const safeOrderNo = maskPrintText(item.orderNo || '—');
        const safeMerchantOrderNo = maskPrintText(item.merchantOrderNo || '—');
        const safeTags = maskPrintText((item.tags || []).join(' / ') || '—');
        return bulkPrintTemplate === 'summary'
          ? `
          <tr>
            <td class="col-date">${escapeHtml(formatDate(item.date))}</td>
            <td class="col-type">${escapeHtml(txTypeLabel(item.type))}</td>
            <td class="col-category">${escapeHtml(safeCategory)}</td>
            <td class="col-amount ${item.type === 'income' ? 'amount-income' : 'amount-expense'}">${escapeHtml(amountText)}</td>
            <td class="col-status">${escapeHtml(txStatusLabel(item.status))}</td>
          </tr>
        `
          : `
          <tr>
            <td class="col-date">${escapeHtml(formatDate(item.date))}</td>
            <td class="col-type">${escapeHtml(txTypeLabel(item.type))}</td>
            <td class="col-category">${escapeHtml(safeCategory)}</td>
            ${bulkPrintFields.includeAccount ? `<td class="col-account">${escapeHtml(safeAccount)}</td>` : ''}
            <td class="col-amount ${item.type === 'income' ? 'amount-income' : 'amount-expense'}">${escapeHtml(amountText)}</td>
            <td class="col-status">${escapeHtml(txStatusLabel(item.status))}</td>
            ${bulkPrintFields.includeNote ? `<td class="col-note">${escapeHtml(safeNote)}</td>` : ''}
            ${bulkPrintFields.includeOrderNo ? `<td class="col-order">${escapeHtml(safeOrderNo)} / ${escapeHtml(safeMerchantOrderNo)}</td>` : ''}
            ${bulkPrintFields.includeTags ? `<td class="col-tags">${escapeHtml(safeTags)}</td>` : ''}
          </tr>
        `;
      })
      .join('');

    const html = `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          <title>批量交易打印（A4）</title>
          <style>${buildBulkPrintStyles()}</style>
        </head>
        <body>
          <main class="sheet">
            <h1 class="title">批量交易清单</h1>
            <p class="meta">
              时间范围 ${escapeHtml(dateRangeText)} ｜ 生成时间 ${escapeHtml(generatedAtText)}
            </p>
            <section class="summary-grid" aria-label="打印统计摘要">
              <div class="summary-card">
                <div class="summary-label">交易条数</div>
                <div class="summary-value">${selectedRows.length} 条</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">金额合计</div>
                <div class="summary-value">${escapeHtml(maskAmountText(totalAmount))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">收入合计</div>
                <div class="summary-value">${escapeHtml(maskAmountText(incomeTotal))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">支出合计</div>
                <div class="summary-value">${escapeHtml(maskAmountText(expenseTotal))}</div>
              </div>
            </section>
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>类型</th>
                  <th>分类</th>
                  ${bulkPrintTemplate === 'summary' ? '' : bulkPrintFields.includeAccount ? '<th>账户</th>' : ''}
                  <th>金额</th>
                  <th>状态</th>
                  ${bulkPrintTemplate === 'summary' ? '' : bulkPrintFields.includeNote ? '<th>备注</th>' : ''}
                  ${bulkPrintTemplate === 'summary' ? '' : bulkPrintFields.includeOrderNo ? '<th>订单号</th>' : ''}
                  ${bulkPrintTemplate === 'summary' ? '' : bulkPrintFields.includeTags ? '<th>标签</th>' : ''}
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
            <footer class="footer">
              <span>${privacyMode ? '当前为隐私模式打印，金额/账户/备注等内容已脱敏。' : '提示：若未弹出系统打印框，请检查浏览器是否拦截弹窗或静默打印策略。'}</span>
              <span>LedgerFlow · 批量打印${privacyMode ? '（隐私模式）' : ''}</span>
            </footer>
          </main>
        </body>
      </html>
    `;

    if (popupBlocked) {
      showToast(
        options?.preferPdf
          ? '浏览器拦截了弹窗，将使用内嵌打印模式。请在系统打印框里选择“保存为 PDF”。'
          : '浏览器拦截了弹窗，将使用内嵌打印模式。',
        'warning'
      );
      try {
        printHtmlWithIframe(html);
      } catch (error) {
        showToast(error instanceof Error ? error.message : '打印失败，请检查浏览器权限。', 'error');
      }
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    if (options?.preferPdf) {
      showToast('请在系统打印框里选择“保存为 PDF”完成导出。', 'success');
    }
    window.setTimeout(() => {
      printWindow.print();
    }, 120);
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
      setBulkAiProgress((prev) => ({ ...prev, visible: false }));
      return;
    }

    setBulkAiProgress({
      visible: true,
      processed: 0,
      total: selectedTransactions.length,
      changed: 0,
      fallbackChanged: 0,
      aborted: 0
    });

    let processed = 0;
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
          processed += 1;
          setBulkAiProgress({
            visible: true,
            processed,
            total: selectedTransactions.length,
            changed,
            fallbackChanged,
            aborted
          });
        } finally {
          bulkAiAbortControllersRef.current.delete(controller);
        }
      }
    };

    try {
      const workers = Array.from({
        length: Math.min(bulkRecategorizeConcurrency, selectedTransactions.length)
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
      setBulkAiProgress((prev) => ({ ...prev, visible: false }));
    }
  };

  useEffect(() => {
    if (!sidePanelVisible) {
      document.body.classList.remove('transactions-split-resizing');
    }
  }, [sidePanelVisible]);

  useEffect(() => {
    if (!splitLayoutRef.current) {
      return;
    }
    const container = splitLayoutRef.current;

    const resizeObserver = new ResizeObserver(() => {
      const total = container.getBoundingClientRect().width;
      const shouldStack = total <= 1100;
      setSplitLayoutStacked(shouldStack);
      if (shouldStack) {
        return;
      }
      const maxLeft = Math.max(560, total - 320);
      setTablePanelWidth((prev) => Math.min(Math.max(prev, 560), maxLeft));
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const handleSplitDividerMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (splitLayoutStacked) {
      return;
    }
    event.preventDefault();
    const container = splitLayoutRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const minLeft = 560;
    const minRight = 320;
    const maxLeft = Math.max(minLeft, rect.width - minRight);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(Math.max(moveEvent.clientX - rect.left, minLeft), maxLeft);
      setTablePanelWidth(nextWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('transactions-split-resizing');
    };

    document.body.classList.add('transactions-split-resizing');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleQuickFilterChange = <K extends keyof TransactionQuickFilters>(
    key: K,
    value: TransactionQuickFilters[K]
  ) => {
    setQuickFilters((prev) => ({ ...prev, [key]: value }));
    if (key === 'merchant') {
      const keyword = String(value || '').trim();
      if (keyword) {
        setSearchHistory((prev) =>
          [keyword, ...prev.filter((item) => item !== keyword)].slice(0, 8)
        );
      }
    }
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
    setColumnWidths((prev) => ({
      ...prev,
      [key]: Math.max(COLUMN_MIN_WIDTHS[key], Math.min(COLUMN_MAX_WIDTH, Math.round(width)))
    }));
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
    quickFilters.location.trim().length > 0 ||
    quickFilters.orderNo.trim().length > 0 ||
    quickFilters.merchantOrderNo.trim().length > 0 ||
    quickFilters.note.trim().length > 0;

  const selectedSource = selected
    ? detectSource(selected.source, selected.note, selected.tags)
    : 'manual';

  const shareText = useMemo(() => {
    if (!selected) {
      return '';
    }
    return buildTransactionShareText({
      transaction: selected,
      categoryName: selectedCategoryName,
      accountName: selectedAccountName,
      source: selectedSource,
      template: shareTemplate,
      includeNote: shareIncludeNote,
      includeAttachments: shareIncludeAttachments,
      includeAccount: shareIncludeAccount
    });
  }, [
    selected,
    selectedCategoryName,
    selectedAccountName,
    selectedSource,
    shareTemplate,
    shareIncludeNote,
    shareIncludeAttachments,
    shareIncludeAccount
  ]);

  const handleCopyShareText = useCallback(async () => {
    if (!shareText) {
      return;
    }
    await copyText(shareText, '分享文案已复制。');
  }, [copyText, shareText]);

  const handleOpenShareDialog = useCallback(() => {
    if (!selected) {
      return;
    }
    setShareDialogOpen(true);
  }, [selected]);

  const handleOpenShareDialogForId = useCallback((id: string) => {
    setSelectedId(id);
    setShareDialogOpen(true);
  }, []);

  const handleCloseShareDialog = useCallback(() => {
    setShareDialogOpen(false);
  }, []);

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

  const categoryPieData = useMemo(() => {
    const map = new Map<string, number>();
    viewRows.forEach((row) => {
      const amount = Math.abs(Number(row.item.amount) || 0);
      map.set(row.categoryName || '未分类', (map.get(row.categoryName || '未分类') || 0) + amount);
    });
    const colors = ['#4f8cff', '#6ad7b9', '#f6a623', '#ff6b6b', '#9b6bff', '#14b8a6', '#64748b'];
    const ranked = Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 7)
      .map((item, index) => ({
        ...item,
        color: colors[index % colors.length]
      }));
    const total = ranked.reduce((sum, value) => sum + value.amount, 0);
    return ranked.map((item) => ({
      ...item,
      percent: total > 0 ? (item.amount / total) * 100 : 0
    }));
  }, [viewRows]);

  useEffect(() => {
    let raf = 0;
    let start = 0;
    const duration = 420;
    setPieAnimationProgress(0);

    const tick = (now: number) => {
      if (!start) {
        start = now;
      }
      const progress = Math.min(1, (now - start) / duration);
      setPieAnimationProgress(easeOutCubic(progress));
      if (progress < 1) {
        raf = window.requestAnimationFrame(tick);
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [categoryPieData]);

  const curveData = useMemo(() => {
    let running = 0;
    return [...viewRows]
      .map((row) => row.item)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((item) => {
        const signed = item.type === 'income' ? item.amount : -item.amount;
        running += Number.isFinite(signed) ? signed : 0;
        return {
          label: formatDate(item.date),
          value: running
        };
      });
  }, [viewRows]);

  const curveMaxAbs = useMemo(() => {
    const values = curveData.map((item) => Math.abs(item.value));
    return Math.max(1, ...values);
  }, [curveData]);

  const pieGradient = useMemo(
    () =>
      buildPieGradient(
        categoryPieData.map((item) => ({
          color: item.color,
          percent: item.percent
        }))
      ),
    [categoryPieData]
  );

  const pieFallbackColor = categoryPieData[0]?.color || 'var(--color-bg-subtle)';
  const pieOpacity = Number.isFinite(pieAnimationProgress)
    ? 0.7 + Math.min(1, Math.max(0, pieAnimationProgress)) * 0.3
    : 1;

  const pendingImportPreview = useMemo(() => {
    if (!pendingImport) {
      return null;
    }

    const modeLabel =
      pendingImport.mode === 'overwrite'
        ? '覆盖（清空后导入）'
        : pendingImport.mode === 'merge'
          ? '合并（覆盖重复）'
          : '增量（跳过重复）';

    const modeHint =
      pendingImport.mode === 'overwrite'
        ? `⚠️ 覆盖模式将先清空当前账本的 ${transactions.length} 条交易，再导入新记录。`
        : pendingImport.mode === 'merge'
          ? '合并模式会覆盖已存在的重复账单。'
          : '增量模式会跳过已存在的重复账单。';

    const previewLines = pendingImport.normalizedParsed.slice(0, 5);
    const appendLines = pendingImport.result.append.slice(0, 3);
    const updateLines = pendingImport.result.update.slice(0, 3);

    return {
      fileName: pendingImport.fileName,
      sourceLabel: pendingImport.source === 'wechat' ? '微信' : '支付宝',
      modeLabel,
      modeHint,
      parsedCount: pendingImport.parseSummary.parsedCount,
      dataLines: pendingImport.parseSummary.dataLines,
      skippedCount: pendingImport.parseSummary.skippedCount,
      appendCount: pendingImport.result.append.length,
      updateCount: pendingImport.result.update.length,
      skippedDuplicateCount: pendingImport.result.skipped,
      previewLines,
      appendLines,
      updateLines
    };
  }, [pendingImport, transactions.length]);

  const pendingImportDescription = useMemo(() => {
    if (!pendingImportPreview) {
      return '';
    }

    const renderLine = (
      item: { date: string; type: TransactionType; amount: number; note?: string | null },
      index: number,
      marker?: string
    ) => {
      const sign = item.type === 'income' ? '+' : '-';
      return `${marker || `${index + 1}.`} ${item.date.slice(0, 10)} ${sign}${formatCurrencyAuto(item.amount)} ${item.note || '无备注'}`;
    };

    return [
      `文件：${pendingImportPreview.fileName}`,
      `来源：${pendingImportPreview.sourceLabel}`,
      `模式：${pendingImportPreview.modeLabel}`,
      pendingImportPreview.modeHint,
      '',
      `识别结果：${pendingImportPreview.parsedCount} 条（数据行 ${pendingImportPreview.dataLines}，跳过 ${pendingImportPreview.skippedCount}）`,
      `执行影响：新增 ${pendingImportPreview.appendCount} 条，更新 ${pendingImportPreview.updateCount} 条，跳过重复 ${pendingImportPreview.skippedDuplicateCount} 条`,
      '',
      pendingImportPreview.previewLines.length
        ? `预检样例（前 5 条）：\n${pendingImportPreview.previewLines.map((item, index) => renderLine(item, index)).join('\n')}`
        : '',
      pendingImportPreview.appendLines.length
        ? `\n将新增（前 3 条）：\n${pendingImportPreview.appendLines.map((item, index) => renderLine(item, index, `+${index + 1}.`)).join('\n')}`
        : '',
      pendingImportPreview.updateLines.length
        ? `\n将更新（前 3 条）：\n${pendingImportPreview.updateLines
            .map(({ payload }, index) => renderLine(payload, index, `~${index + 1}.`))
            .join('\n')}`
        : ''
    ]
      .filter(Boolean)
      .join('\n');
  }, [pendingImportPreview]);

  const pendingImportDialogDescription = pendingImportPreview ? (
    <div className="import-confirm-dialog">
      <section className="import-confirm-hero">
        <div>
          <div className="import-confirm-eyebrow">导入预检</div>
          <strong>{pendingImportPreview.fileName}</strong>
          <p>{pendingImportPreview.modeHint}</p>
        </div>
        <span
          className={`import-confirm-mode-badge ${pendingImport?.mode === 'overwrite' ? 'danger' : pendingImport?.mode === 'merge' ? 'warning' : 'safe'}`}
        >
          {pendingImportPreview.modeLabel}
        </span>
      </section>

      <section className="import-confirm-meta-grid">
        <div className="import-confirm-meta-card">
          <span>来源</span>
          <strong>{pendingImportPreview.sourceLabel}</strong>
        </div>
        <div className="import-confirm-meta-card">
          <span>识别</span>
          <strong>{pendingImportPreview.parsedCount} 条</strong>
          <small>
            数据行 {pendingImportPreview.dataLines} · 跳过 {pendingImportPreview.skippedCount}
          </small>
        </div>
        <div className="import-confirm-meta-card import-confirm-meta-card-accent">
          <span>新增</span>
          <strong>{pendingImportPreview.appendCount} 条</strong>
        </div>
        <div className="import-confirm-meta-card">
          <span>更新</span>
          <strong>{pendingImportPreview.updateCount} 条</strong>
        </div>
        <div className="import-confirm-meta-card">
          <span>跳过重复</span>
          <strong>{pendingImportPreview.skippedDuplicateCount} 条</strong>
        </div>
      </section>

      <section className="import-confirm-section">
        <div className="import-confirm-section-head">
          <strong>预检样例</strong>
          <span>前 {pendingImportPreview.previewLines.length} 条</span>
        </div>
        <div className="import-confirm-list">
          {pendingImportPreview.previewLines.length ? (
            pendingImportPreview.previewLines.map((item, index) => {
              const sign = item.type === 'income' ? '+' : '-';
              return (
                <div
                  key={`preview-${index}-${item.date}-${item.amount}`}
                  className="import-confirm-row"
                >
                  <span className="import-confirm-row-index">{index + 1}</span>
                  <div className="import-confirm-row-main">
                    <strong>{item.note || '无备注'}</strong>
                    <small>{item.date.slice(0, 10)}</small>
                  </div>
                  <span
                    className={`import-confirm-row-amount ${item.type === 'income' ? 'income' : 'expense'}`}
                  >
                    {sign}
                    {formatCurrencyAuto(item.amount)}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="import-confirm-empty">暂无可展示样例</div>
          )}
        </div>
      </section>

      {pendingImportPreview.appendLines.length || pendingImportPreview.updateLines.length ? (
        <section className="import-confirm-impact-grid">
          <div className="import-confirm-section">
            <div className="import-confirm-section-head">
              <strong>将新增</strong>
              <span>{pendingImportPreview.appendLines.length} 条样例</span>
            </div>
            <div className="import-confirm-list compact">
              {pendingImportPreview.appendLines.length ? (
                pendingImportPreview.appendLines.map((item, index) => (
                  <div
                    key={`append-${index}-${item.date}-${item.amount}`}
                    className="import-confirm-row compact"
                  >
                    <span className="import-confirm-row-index positive">+{index + 1}</span>
                    <div className="import-confirm-row-main">
                      <strong>{item.note || '无备注'}</strong>
                      <small>{item.date.slice(0, 10)}</small>
                    </div>
                    <span
                      className={`import-confirm-row-amount ${item.type === 'income' ? 'income' : 'expense'}`}
                    >
                      {item.type === 'income' ? '+' : '-'}
                      {formatCurrencyAuto(item.amount)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="import-confirm-empty">无新增样例</div>
              )}
            </div>
          </div>

          <div className="import-confirm-section">
            <div className="import-confirm-section-head">
              <strong>将更新</strong>
              <span>{pendingImportPreview.updateLines.length} 条样例</span>
            </div>
            <div className="import-confirm-list compact">
              {pendingImportPreview.updateLines.length ? (
                pendingImportPreview.updateLines.map(({ payload }, index) => (
                  <div
                    key={`update-${index}-${payload.date}-${payload.amount}`}
                    className="import-confirm-row compact"
                  >
                    <span className="import-confirm-row-index neutral">~{index + 1}</span>
                    <div className="import-confirm-row-main">
                      <strong>{payload.note || '无备注'}</strong>
                      <small>{payload.date.slice(0, 10)}</small>
                    </div>
                    <span
                      className={`import-confirm-row-amount ${payload.type === 'income' ? 'income' : 'expense'}`}
                    >
                      {payload.type === 'income' ? '+' : '-'}
                      {formatCurrencyAuto(payload.amount)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="import-confirm-empty">无更新样例</div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  ) : (
    pendingImportDescription
  );

  return (
    <div className="transactions-page vi-page">
      <div className="transactions-filter-sticky-wrap">
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
          onQuickAdd={openQuickAddDrawer}
          privacyMode={privacyMode}
          onTogglePrivacy={() => setPrivacyMode((prev) => !prev)}
          sidePanelVisible={sidePanelVisible}
          onToggleSidePanel={() => setSidePanelVisible((prev) => !prev)}
        />
        {sidePanelVisible ? (
          <p className="transactions-flow-focus-hint surface-caption">
            当前默认聚焦流水列表；图表与洞察改为按需展开，避免首屏注意力被分散。
          </p>
        ) : null}
        {sidePanelVisible ? (
          <div
            className="transactions-current-bill-strip"
            aria-label={t('transactions.ui.billFilterState')}
          >
            <span>
              {t('transactions.ui.billPeriod')}: {currentPeriodLabel}
            </span>
            <span>
              {t('transactions.ui.filteredCount')}: {sortedRows.length} {t('transactions.ui.items')}
            </span>
            <span>
              {t('transactions.ui.totalCount')}: {transactions.length} {t('transactions.ui.items')}
            </span>
          </div>
        ) : null}
      </div>

      {bulkAiProgress.visible ? (
        <section
          className="import-result-banner ai-progress-banner"
          role="status"
          aria-live="polite"
        >
          <strong>{t('transactions.ui.aiRecategorize')}：</strong>
          <div className="ai-progress-main">
            <div className="ai-progress-text">
              <span>
                {t('transactions.ui.processed')} {bulkAiProgress.processed} / {bulkAiProgress.total}
              </span>
              <span>
                {t('transactions.ui.modelCount')} {bulkAiProgress.changed} ·{' '}
                {t('transactions.ui.fallbackCount')} {bulkAiProgress.fallbackChanged}
                {bulkAiProgress.aborted > 0
                  ? ` · ${t('transactions.ui.cancelled')} ${bulkAiProgress.aborted}`
                  : ''}
              </span>
            </div>
            <div className="ai-progress-track" aria-label={t('transactions.ui.aiProgress')}>
              <span
                className="ai-progress-fill"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((bulkAiProgress.processed / Math.max(1, bulkAiProgress.total)) * 100)
                  )}%`
                }}
              />
            </div>
          </div>
        </section>
      ) : null}

      {importNotice.visible ? (
        <section
          className={`import-result-banner import-result-${importNotice.variant}`}
          role="status"
          aria-live="polite"
        >
          <strong>{t('transactions.ui.importResult')}：</strong>
          <span>{importNotice.message}</span>
          {importReportText ? (
            <button type="button" onClick={() => void copyImportReport()}>
              {t('transactions.ui.copyReport')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setImportNotice((prev) => ({ ...prev, visible: false }))}
          >
            {t('transactions.ui.gotIt')}
          </button>
        </section>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        aria-label={t('transactions.ui.importBillFile')}
        accept=".csv,text/csv,.txt,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={(event) => void handleImportFile(event)}
      />

      <div
        className={`transactions-split-layout ${sidePanelVisible ? '' : 'transactions-split-layout-no-side'}`.trim()}
        ref={splitLayoutRef}
        style={sidePanelVisible ? { scrollbarGutter: 'stable' } : undefined}
      >
        <section
          className="transactions-split-main"
          style={
            splitLayoutStacked || !sidePanelVisible
              ? { width: '100%', maxWidth: '100%', minWidth: 0 }
              : { width: tablePanelWidth, maxWidth: '100%', minWidth: 560 }
          }
        >
          <TransactionTable
            showTaskSummary={false}
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
            privacyMode={privacyMode}
            onClearFilters={clearAllFilters}
            sortKey={sortKey}
            sortDirection={sortDirection}
            quickFilters={quickFilters}
            onSortChange={handleSortChange}
            onQuickFilterChange={handleQuickFilterChange}
            onFirstPage={() => setPage(1)}
            onPrevPage={() => setPage(Math.max(1, page - 1))}
            onNextPage={() => setPage(Math.min(pages, page + 1))}
            onLastPage={() => setPage(pages)}
            onPageSizeChange={(size) => {
              // 切换页大小后重置到第一页，避免超页码导致用户误解“数据丢失”。
              setPageSize(size);
              setPage(1);
            }}
            onCreate={() => navigate('/transactions/new')}
            onOpenDetail={setSelectedId}
            onShare={handleOpenShareDialogForId}
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
            onBulkPrintA4={handleBulkPrintA4}
            onBulkExportPdf={handleBulkExportPdf}
            bulkExportingPdf={bulkExportingPdf}
            bulkPrintTemplate={bulkPrintTemplate}
            onBulkPrintTemplateChange={setBulkPrintTemplate}
            bulkPrintFields={bulkPrintFields}
            onBulkPrintFieldsChange={setBulkPrintFields}
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
        </section>

        {sidePanelVisible ? (
          <>
            <div
              className="transactions-split-divider"
              role="separator"
              aria-label={t('transactions.ui.resizePanels')}
              aria-orientation="vertical"
              onMouseDown={handleSplitDividerMouseDown}
            />

            <aside
              className="transactions-split-side panel"
              aria-label={t('transactions.ui.currentBillChartView')}
            >
              <h3 style={{ marginTop: 0 }}>{t('transactions.ui.currentBillView')}</h3>
              <div className="transactions-side-chart-card transactions-current-bill-panel">
                <h4>{t('transactions.ui.currentBillOverview')}</h4>
                <div className="transactions-current-bill-grid">
                  <div>
                    <small>{t('transactions.ui.periodIncome')}</small>
                    <strong>{formatCurrencyAuto(currentBillSummary.income)}</strong>
                  </div>
                  <div>
                    <small>{t('transactions.ui.periodExpense')}</small>
                    <strong>{formatCurrencyAuto(currentBillSummary.expense)}</strong>
                  </div>
                  <div>
                    <small>{t('transactions.ui.periodNet')}</small>
                    <strong>{formatCurrencyAuto(currentBillSummary.net)}</strong>
                  </div>
                  <div>
                    <small>{t('transactions.ui.transactionCount')}</small>
                    <strong>{currentBillSummary.count}</strong>
                  </div>
                </div>

                <div className="transactions-current-bill-actions">
                  <button type="button" className="primary" onClick={openQuickAddDrawer}>
                    {t('transactions.ui.addTransaction')}
                  </button>
                  <button type="button" onClick={() => openImport('alipay')}>
                    {t('transactions.ui.importBill')}
                  </button>
                  <button type="button" onClick={clearAllFilters}>
                    {t('transactions.ui.clearFilters')}
                  </button>
                </div>

                <div className="transactions-side-quick-filters" aria-label="洞察侧栏快速筛选">
                  <div className="transactions-side-quick-filter-row">
                    <small className="muted">快速日期</small>
                    <div className="transactions-side-quick-filter-buttons">
                      <button
                        type="button"
                        className={filters.datePreset === 'all' ? 'active' : ''}
                        onClick={() => setDatePreset('all')}
                      >
                        全部
                      </button>
                      <button
                        type="button"
                        className={filters.datePreset === 'thisMonth' ? 'active' : ''}
                        onClick={() => setDatePreset('thisMonth')}
                      >
                        本月
                      </button>
                      <button
                        type="button"
                        className={filters.datePreset === 'last30' ? 'active' : ''}
                        onClick={() => setDatePreset('last30')}
                      >
                        近30天
                      </button>
                    </div>
                  </div>

                  <div className="transactions-side-quick-filter-row">
                    <small className="muted">快速类型</small>
                    <div className="transactions-side-quick-filter-buttons">
                      <button
                        type="button"
                        className={filters.type === 'all' ? 'active' : ''}
                        onClick={() => setType('all')}
                      >
                        全部
                      </button>
                      <button
                        type="button"
                        className={filters.type === 'expense' ? 'active' : ''}
                        onClick={() => setType('expense')}
                      >
                        支出
                      </button>
                      <button
                        type="button"
                        className={filters.type === 'income' ? 'active' : ''}
                        onClick={() => setType('income')}
                      >
                        收入
                      </button>
                    </div>
                  </div>
                </div>

                {currentBillSummary.maxExpense ? (
                  <button
                    type="button"
                    className="transactions-current-bill-max"
                    onClick={() => setSelectedId(currentBillSummary.maxExpense?.item.id || null)}
                  >
                    {t('transactions.ui.maxExpense')}: {currentBillSummary.maxExpense.categoryName}{' '}
                    · {formatCurrencyAuto(currentBillSummary.maxExpense.item.amount)}
                  </button>
                ) : (
                  <small className="muted">{t('transactions.ui.noExpenseData')}</small>
                )}
              </div>

              <div className="transactions-side-chart-card">
                <h4>分类占比饼图（当前列表）</h4>
                <div className="transactions-pie-wrap">
                  <div
                    className="transactions-pie"
                    style={{
                      background: pieGradient !== 'none' ? pieGradient : pieFallbackColor,
                      opacity: pieOpacity
                    }}
                  />
                  <div className="transactions-pie-legend">
                    {categoryPieData.length === 0 ? <p className="muted">暂无数据</p> : null}
                    {categoryPieData.map((item) => (
                      <p key={item.name}>
                        <span style={{ color: item.color }}>●</span> {item.name} ·{' '}
                        {item.percent.toFixed(1)}% · {formatCurrencyAuto(item.amount)}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              <div className="transactions-side-chart-card">
                <h4>累计净额曲线（当前列表）</h4>
                <div className="transactions-curve-list">
                  {curveData.length === 0 ? <p className="muted">暂无数据</p> : null}
                  {curveData.map((point, index) => (
                    <div key={`${point.label}-${index}`} className="transactions-curve-row">
                      <span>{point.label}</span>
                      <div>
                        <i
                          style={{
                            width: `${(Math.abs(point.value) / curveMaxAbs) * 100}%`
                          }}
                        />
                      </div>
                      <strong>{formatCurrencyAuto(point.value)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </>
        ) : null}
      </div>

      <TransactionDetailDrawer
        open={Boolean(selected)}
        transaction={selected}
        categoryName={selectedCategoryName}
        accountName={selectedAccountName}
        source={selectedSource}
        relatedOrigin={selectedRelatedOrigin}
        relatedRefunds={selectedRefundChildren}
        onClose={() => setSelectedId(null)}
        onCopyNote={() => void copyText(selected?.note ?? '', '备注已复制')}
        onCopyJson={() => void copyText(JSON.stringify(selected, null, 2), 'JSON 已复制')}
        onShareBill={handleOpenShareDialog}
        onDelete={() => {
          if (!selected) {
            return;
          }
          setPendingDeleteIds([selected.id]);
        }}
        onRefund={() => {
          if (!selected) {
            return;
          }
          setPendingRefundTransactionId(selected.id);
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
        onAttachmentUploaded={handleAttachmentUploaded}
        onAttachmentUploadStatus={handleAttachmentUploadStatus}
        aiRecategorizing={selected ? aiRecategorizingId === selected.id : false}
        privacyMode={privacyMode}
        visibleSections={visibleDetailSections}
        onToggleSection={handleToggleDetailSection}
        onQuickAdd={openQuickAddDrawer}
      />

      {quickAddOpen ? (
        <div className="quick-add-overlay" role="presentation" onClick={closeQuickAddDrawer}>
          <aside
            className="quick-add-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="快速新增账目"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="quick-add-header">
              <button
                type="button"
                className="quick-add-header-action"
                onClick={closeQuickAddDrawer}
                aria-label="取消快速记账"
              >
                取消
              </button>
              <h3>记一笔</h3>
              <button
                type="button"
                className="quick-add-header-action is-primary"
                onClick={handleSaveQuickAdd}
              >
                完成
              </button>
            </header>

            <div className="quick-add-body">
              <section className="quick-add-main">
                <div className="quick-add-amount-stage">
                  <div className="quick-add-type-tabs" role="group" aria-label="账目类型">
                    <button
                      type="button"
                      className={quickAddType === 'expense' ? 'is-active' : ''}
                      aria-pressed={quickAddType === 'expense'}
                      onClick={() => setQuickAddType('expense')}
                    >
                      支出
                    </button>
                    <button
                      type="button"
                      className={quickAddType === 'income' ? 'is-active' : ''}
                      aria-pressed={quickAddType === 'income'}
                      onClick={() => setQuickAddType('income')}
                    >
                      收入
                    </button>
                  </div>
                  <label htmlFor="quick-add-expression">金额</label>
                  <div className="quick-add-amount-input">
                    <span aria-hidden="true">¥</span>
                    <input
                      id="quick-add-expression"
                      autoFocus
                      inputMode="decimal"
                      placeholder="0"
                      value={quickAddExpression}
                      onChange={(event) => setQuickAddExpression(event.target.value)}
                      aria-describedby="quick-add-budget-hint"
                    />
                  </div>
                  {quickAddExpression &&
                  quickAddCalculatedAmount !== null &&
                  quickAddExpression !== String(quickAddCalculatedAmount) ? (
                    <small>合计 ¥{quickAddCalculatedAmount}</small>
                  ) : null}
                </div>

                <div className="quick-add-budget-hint" id="quick-add-budget-hint">
                  {quickAddBudgetSummary.dailyBudget === null ? (
                    <span>
                      当日已支出 <strong>{formatCurrency(quickAddBudgetSummary.spent)}</strong>
                      {quickAddType === 'expense' &&
                      quickAddBudgetSummary.projected !== quickAddBudgetSummary.spent
                        ? `，记入后 ${formatCurrency(quickAddBudgetSummary.projected)}`
                        : ''}
                    </span>
                  ) : (
                    <>
                      <span>
                        当日参考预算{' '}
                        <strong>{formatCurrency(quickAddBudgetSummary.dailyBudget)}</strong>
                      </span>
                      <span>
                        已支出 {formatCurrency(quickAddBudgetSummary.spent)}，记入后剩余{' '}
                        <strong
                          className={
                            quickAddBudgetSummary.remaining !== null &&
                            quickAddBudgetSummary.remaining < 0
                              ? 'is-over'
                              : ''
                          }
                        >
                          {formatCurrency(quickAddBudgetSummary.remaining ?? 0)}
                        </strong>
                      </span>
                    </>
                  )}
                  <i
                    className="quick-add-budget-progress"
                    style={{
                      width: `${Math.min(
                        100,
                        quickAddBudgetSummary.dailyBudget
                          ? (quickAddBudgetSummary.projected / quickAddBudgetSummary.dailyBudget) *
                              100
                          : 0
                      )}%`
                    }}
                  />
                </div>

                <div className="quick-add-meta-grid">
                  <div className="quick-add-meta-field">
                    <label htmlFor="quick-add-category">分类</label>
                    <select
                      id="quick-add-category"
                      value={quickAddCategoryId}
                      onChange={(event) => setQuickAddCategoryId(event.target.value)}
                    >
                      {quickAddCategoryOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="quick-add-meta-field">
                    <label htmlFor="quick-add-account">账户</label>
                    <select
                      id="quick-add-account"
                      value={quickAddAccountId}
                      onChange={(event) => setQuickAddAccountId(event.target.value)}
                    >
                      {accounts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="quick-add-meta-field">
                    <label htmlFor="quick-add-date">日期</label>
                    <input
                      id="quick-add-date"
                      type="date"
                      value={quickAddDate}
                      onChange={(event) => setQuickAddDate(event.target.value)}
                    />
                  </div>
                  <div className="quick-add-meta-field is-note">
                    <label htmlFor="quick-add-note">备注</label>
                    <input
                      id="quick-add-note"
                      placeholder="可选"
                      value={quickAddNote}
                      onChange={(event) => setQuickAddNote(event.target.value)}
                    />
                  </div>
                </div>

                {quickAddError ? <small className="error">{quickAddError}</small> : null}
              </section>

              <section className="quick-add-keypad-panel" role="group" aria-label="金额键盘">
                <AmountKeypad onKey={handleQuickAddKeypadInput} />
                <p className="quick-add-keypad-tip">支持加减乘除；按 Enter 计算</p>
              </section>
            </div>

            <footer className="quick-add-footer">
              <button type="button" className="primary" onClick={handleSaveQuickAdd}>
                完成记账
              </button>
              <small role="status">{quickAddDraftStatus || '输入内容会自动保存为草稿'}</small>
            </footer>
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="第 2 步：导入预检确认"
        description={pendingImportDialogDescription}
        confirmText={
          pendingImport?.mode === 'overwrite'
            ? '确认进入第 3 步（覆盖写入）'
            : '确认进入第 3 步（写入账本）'
        }
        cancelText="取消"
        danger={pendingImport?.mode === 'overwrite'}
        onConfirm={handleConfirmPendingImport}
        onCancel={() => setPendingImport(null)}
      />

      {shareDialogOpen && selected ? (
        <div className="dialog-overlay" role="presentation" onClick={handleCloseShareDialog}>
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="分享账单"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dialog-header">分享账单</header>
            <div className="dialog-body" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gap: 8 }}>
                <strong>分享模板</strong>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={shareTemplate === 'full' ? 'primary' : ''}
                    onClick={() => setShareTemplate('full')}
                  >
                    完整
                  </button>
                  <button
                    type="button"
                    className={shareTemplate === 'masked' ? 'primary' : ''}
                    onClick={() => setShareTemplate('masked')}
                  >
                    脱敏
                  </button>
                  <button
                    type="button"
                    className={shareTemplate === 'summary' ? 'primary' : ''}
                    onClick={() => setShareTemplate('summary')}
                  >
                    摘要
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <strong>包含字段</strong>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={shareIncludeAccount}
                    onChange={(event) => setShareIncludeAccount(event.target.checked)}
                    disabled={shareTemplate === 'summary'}
                  />
                  <span>账户</span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={shareIncludeNote}
                    onChange={(event) => setShareIncludeNote(event.target.checked)}
                  />
                  <span>备注</span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={shareIncludeAttachments}
                    onChange={(event) => setShareIncludeAttachments(event.target.checked)}
                    disabled={shareTemplate === 'summary'}
                  />
                  <span>附件提示</span>
                </label>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <strong>预览</strong>
                <textarea
                  readOnly
                  value={shareText}
                  rows={12}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
            </div>
            <footer className="dialog-footer">
              <button type="button" onClick={handleCloseShareDialog}>
                关闭
              </button>
              <button type="button" className="primary" onClick={() => void handleCopyShareText()}>
                复制文案
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingRefundTransaction)}
        title="确认发起退款"
        description={
          pendingRefundTransaction
            ? `将为“${pendingRefundTransaction.note || '该交易'}”创建一笔退款记录，退款金额为剩余可退 ¥${pendingRefundRemainingAmount.toFixed(2)}。退款后账户余额会自动回补，并写入余额变动明细。`
            : ''
        }
        confirmText="确认退款"
        cancelText="取消"
        danger
        onConfirm={handleRefundConfirm}
        onCancel={() => setPendingRefundTransactionId(null)}
      />

      <ConfirmDialog
        open={pendingDeleteIds.length > 0}
        title={pendingDeleteIds.length > 1 ? '确认批量移入回收站' : '确认移入回收站'}
        description={
          pendingDeleteIds.length > 1
            ? `即将把 ${pendingDeleteIds.length} 条交易移入回收站。你之后仍可在回收站恢复或彻底删除。是否继续？`
            : '该交易将先移入回收站。你之后仍可在回收站恢复或彻底删除。是否继续？'
        }
        confirmText={pendingDeleteIds.length > 1 ? '确认移入回收站' : '移入回收站'}
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
