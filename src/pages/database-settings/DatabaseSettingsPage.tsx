import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../../shared/lib/useDialogFocus';
import { useTranslation } from 'react-i18next';
import { useTFallback, type TfFallback } from '../../shared/lib/useTFallback';
import { MysqlSnapshotPanel } from '../../features/mysql-snapshot/ui/MysqlSnapshotPanel';
import { DatabaseProviderSetupPanel } from '../../features/database-provider/ui/DatabaseProviderSetupPanel';
import { BackupScopeSelector } from '../../features/backup/ui/BackupScopeSelector';
import {
  applyBillImportMode,
  BillImportMode,
  parseBillFileToTransactions
} from '../../shared/lib/billImport';
import { resolveImportDefaultAccountId } from '../../shared/lib/importAccount';
import {
  applyFinanceBackupPayload,
  type BackupObjectStorageConfig,
  type BackupObjectStorageProvider,
  type BackupWebdavConfig,
  createDefaultFinanceBackupScope,
  createFinanceBackupPayload,
  countFinanceBackupRecords,
  downloadBackupJson,
  type FinanceBackupPayload,
  type FinanceBackupScope,
  listObjectStorageBackupVersions,
  listWebdavBackupVersions,
  loadObjectStorageConfig,
  loadWebdavConfig,
  normalizeFinanceBackupScope,
  objectStorageDownloadBackup,
  type ObjectStorageBackupVersionItem,
  objectStorageUploadBackup,
  parseFinanceBackupPayload,
  saveObjectStorageConfig,
  saveWebdavConfig,
  sanitizeObjectStorageConfig,
  type WebdavBackupVersionItem,
  webdavDownloadBackup,
  webdavUploadBackup,
  sanitizeWebdavConfig
} from '../../shared/lib/backup';
import { BACKUP_ICON_URL, RESTORE_ICON_URL } from '../../shared/config/brandAssets';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useGlobalMemoryStore } from '../../shared/store/useGlobalMemoryStore';
import { useSmartBudgetStore } from '../../shared/store/useSmartBudgetStore';
import {
  downloadSqlDatabaseExport,
  importRelationalData
} from '../../shared/api/relationalDataClient';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { Toast, ToastVariant } from '../../shared/ui/Toast';
import {
  readStoredLedgerflowApiToken,
  writeStoredLedgerflowApiToken
} from '../../shared/lib/ledgerflowApiToken';

type BillSource = 'wechat' | 'alipay';
type BackupImportPhase = 'importing' | 'complete' | 'error';

const MAX_BACKUP_FILE_SIZE_MB = 50;
const MAX_BACKUP_FILE_SIZE_BYTES = MAX_BACKUP_FILE_SIZE_MB * 1024 * 1024;
const MAX_BILL_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const LAST_WEBDAV_BACKUP_KEY = 'ledgerflow-webdav-last-backup-v1';
const LAST_OBJECT_STORAGE_BACKUP_KEY = 'ledgerflow-object-storage-last-backup-v1';
const BACKUP_SCOPE_STORAGE_KEY = 'ledgerflow-backup-scope-v1';
const UNCATEGORIZED_CATEGORY_ID = '';
const CLEAR_BILLS_CONFIRM_WORD_KEY = 'dataBackup.reset.confirmWord';

const BACKUP_ACCEPTED_MIME_TYPES = new Set(['application/json', 'text/json']);
const BILL_ACCEPTED_EXTENSIONS = new Set(['.csv', '.txt', '.xlsx']);
const OBJECT_STORAGE_OPTIONS: Array<{
  value: BackupObjectStorageProvider;
  label: (tf: TfFallback) => string;
}> = [
  {
    value: 'aliyun-oss',
    label: (tf) => tf('dataBackup.objectStorage.oss', '阿里云 OSS')
  },
  {
    value: 's3-compatible',
    label: (tf) => tf('dataBackup.objectStorage.s3', 'S3 兼容')
  }
];
function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index < 0) return '';
  return fileName.slice(index).toLowerCase();
}

function validateBackupFile(file: File, tf: TfFallback): void {
  const ext = getFileExtension(file.name);
  const hasValidMime = !file.type || BACKUP_ACCEPTED_MIME_TYPES.has(file.type);
  const hasValidExt = ext === '.json';

  if (!hasValidMime && !hasValidExt) {
    throw new Error(tf('dataBackup.import.error.notJson', '备份导入失败：仅支持 JSON 文件（.json）'));
  }

  if (file.size > MAX_BACKUP_FILE_SIZE_BYTES) {
    throw new Error(
      tf('dataBackup.import.error.tooLarge', "备份导入失败：文件过大，请上传不超过 {max}MB 的 JSON 备份").replace("{max}", String(MAX_BACKUP_FILE_SIZE_MB))
    );
  }
}

function validateBillFile(file: File, tf: TfFallback): void {
  const ext = getFileExtension(file.name);
  if (!BILL_ACCEPTED_EXTENSIONS.has(ext)) {
    throw new Error(tf('dataBackup.bill.error.unsupportedType', '账单导入失败：仅支持 CSV/TXT/XLSX 文件'));
  }

  if (file.size > MAX_BILL_FILE_SIZE_BYTES) {
    throw new Error(tf('dataBackup.bill.error.tooLarge', '账单导入失败：文件过大，请上传不超过 10MB 的账单文件'));
  }
}

function getWebdavBackupSignature(config: BackupWebdavConfig): string {
  return [config.endpoint.trim(), config.username.trim(), config.remoteFilePath.trim()].join('|');
}

function isValidBackupTime(value: string): boolean {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}

function readStoredLastWebdavBackupAt(config: BackupWebdavConfig): string {
  try {
    const raw = window.localStorage.getItem(LAST_WEBDAV_BACKUP_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { signature?: unknown; backupAt?: unknown };
    const backupAt = typeof parsed.backupAt === 'string' ? parsed.backupAt : '';
    if (parsed.signature !== getWebdavBackupSignature(config) || !isValidBackupTime(backupAt)) {
      return '';
    }
    return backupAt;
  } catch {
    return '';
  }
}

function writeStoredLastWebdavBackupAt(config: BackupWebdavConfig, backupAt: string): void {
  if (!isValidBackupTime(backupAt)) return;

  try {
    window.localStorage.setItem(
      LAST_WEBDAV_BACKUP_KEY,
      JSON.stringify({
        signature: getWebdavBackupSignature(config),
        backupAt
      })
    );
  } catch {
    // ignore storage errors
  }
}

function getLatestWebdavBackupAt(versions: WebdavBackupVersionItem[]): string {
  return (
    versions.find((item) => item.isLatest && item.backupAt)?.backupAt ||
    versions.find((item) => item.backupAt)?.backupAt ||
    ''
  );
}

function getObjectStorageLabel(provider: BackupObjectStorageProvider, tf: TfFallback): string {
  const option = OBJECT_STORAGE_OPTIONS.find((item) => item.value === provider);
  return option
    ? option.label(tf)
    : tf('dataBackup.tabs.objectStorage', '对象存储');
}

function getObjectStorageBackupSignature(config: BackupObjectStorageConfig): string {
  return [
    config.provider,
    config.endpoint.trim(),
    config.bucket.trim(),
    config.remoteFilePath.trim()
  ].join('|');
}

function getStoredObjectStorageBackupKey(provider: BackupObjectStorageProvider): string {
  return `${LAST_OBJECT_STORAGE_BACKUP_KEY}:${provider}`;
}

function readStoredLastObjectStorageBackupAt(config: BackupObjectStorageConfig): string {
  try {
    const raw = window.localStorage.getItem(getStoredObjectStorageBackupKey(config.provider));
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { signature?: unknown; backupAt?: unknown };
    const backupAt = typeof parsed.backupAt === 'string' ? parsed.backupAt : '';
    if (
      parsed.signature !== getObjectStorageBackupSignature(config) ||
      !isValidBackupTime(backupAt)
    ) {
      return '';
    }
    return backupAt;
  } catch {
    return '';
  }
}

function writeStoredLastObjectStorageBackupAt(
  config: BackupObjectStorageConfig,
  backupAt: string
): void {
  if (!isValidBackupTime(backupAt)) return;

  try {
    window.localStorage.setItem(
      getStoredObjectStorageBackupKey(config.provider),
      JSON.stringify({
        signature: getObjectStorageBackupSignature(config),
        backupAt
      })
    );
  } catch {
    // ignore storage errors
  }
}

function getLatestObjectStorageBackupAt(versions: ObjectStorageBackupVersionItem[]): string {
  return (
    versions.find((item) => item.isLatest && item.backupAt)?.backupAt ||
    versions.find((item) => item.backupAt)?.backupAt ||
    ''
  );
}

function formatWebdavBackupTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function loadStoredBackupScope(): FinanceBackupScope {
  const defaults = createDefaultFinanceBackupScope();
  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(BACKUP_SCOPE_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    return normalizeFinanceBackupScope(JSON.parse(raw) as Partial<FinanceBackupScope>);
  } catch {
    return defaults;
  }
}

function writeStoredBackupScope(scope: FinanceBackupScope): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(BACKUP_SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // ignore storage errors
  }
}

function hasSelectedBackupScope(scope: FinanceBackupScope): boolean {
  return (
    scope.ledger ||
    scope.subscriptions ||
    scope.globalMemories ||
    scope.investments ||
    scope.debts ||
    scope.preferences
  );
}

const BACKUP_SCOPE_ENTRIES: Record<keyof FinanceBackupScope, (tf: TfFallback) => string> = {
  ledger: (tf) => tf('dataBackup.scope.ledger', '账本数据'),
  subscriptions: (tf) => tf('dataBackup.scope.subscriptions', '订阅数据'),
  globalMemories: (tf) => tf('dataBackup.scope.memories', 'AI 记忆'),
  investments: (tf) => tf('dataBackup.scope.investments', '投资理财'),
  debts: (tf) => tf('dataBackup.scope.debts', '负债与还款'),
  preferences: (tf) => tf('dataBackup.scope.preferences', '偏好与计划')
};

function getBackupScopeSummary(scope: FinanceBackupScope, tf: TfFallback): string {
  const labels = (Object.keys(scope) as Array<keyof FinanceBackupScope>)
    .filter((key) => scope[key])
    .map((key) => BACKUP_SCOPE_ENTRIES[key](tf));
  if (!labels.length) {
    return tf('dataBackup.scope.noneSelected', '未选择');
  }
  return labels.join(tf('dataBackup.scope.separator', '、'));
}

function buildBackupRestoreSuccessMessage(
  action: 'import' | 'restore',
  payload: FinanceBackupPayload,
  tf: TfFallback
) {
  const sections: string[] = [];

  if (payload.scope.ledger) {
    sections.push(
      tf(
        'dataBackup.message.ledgerSection',
        '账本 {transactions} 条交易 / {categories} 个分类 / {accounts} 个账户'
      )
        .replace('{transactions}', String(payload.data.transactions.length))
        .replace('{categories}', String(payload.data.categories.length))
        .replace('{accounts}', String(payload.data.accounts.length))
    );
  }

  if (payload.scope.subscriptions) {
    sections.push(
      tf('dataBackup.message.subscriptionsSection', '订阅 {count} 条').replace(
        '{count}',
        String(payload.data.subscriptions.length)
      )
    );
  }

  if (payload.scope.globalMemories) {
    sections.push(
      tf('dataBackup.message.memoriesSection', 'AI 记忆 {count} 条').replace(
        '{count}',
        String(payload.data.globalMemories.length)
      )
    );
  }

  if (payload.scope.investments) {
    sections.push(
      tf(
        'dataBackup.message.investmentsSection',
        '投资理财 {positions} 笔持仓 / {history} 条持仓流水 / {goals} 个目标 / {watchlist} 只自选'
      )
        .replace('{positions}', String(payload.data.investmentPositions.length))
        .replace('{history}', String(payload.data.investmentPositionHistory.length))
        .replace('{goals}', String(payload.data.investmentGoals.length))
        .replace('{watchlist}', String(payload.data.investmentWatchlist.length))
    );
  }

  const actionLabel = tf(
    action === 'import' ? 'dataBackup.message.actionImport' : 'dataBackup.message.actionRestore',
    action
  );
  return sections.length
    ? tf('dataBackup.message.successDetail', '备份{action}成功:已更新{scope}({sections})')
        .replace('{action}', actionLabel)
        .replace('{scope}', getBackupScopeSummary(payload.scope, tf))
        .replace('{sections}', sections.join(';'))
    : tf('dataBackup.message.success', '备份{action}成功').replace('{action}', actionLabel);
}

export function DatabaseSettingsPage() {
  const { t } = useTranslation();
  const tf = useTFallback();
  // Destructive confirm word follows the UI language; the literal fallback only applies when i18n is not ready.
  const clearBillsConfirmWord = tf(CLEAR_BILLS_CONFIRM_WORD_KEY, '清空账单');
  // Accept the confirm word of either language, so an English user can never be locked out by wording.
  const isClearBillsConfirmMatched = (value: string) =>
    (['zh', 'en'] as const).some(
      (lng) =>
        t(CLEAR_BILLS_CONFIRM_WORD_KEY, { lng }).trim().toLowerCase() === value.trim().toLowerCase()
    );
  const hasHydrated = useFinanceStore((s) => s.hasHydrated);
  const transactions = useFinanceStore((s) => s.transactions);
  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const subscriptions = useFinanceStore((s) => s.subscriptions);
  const trashedTransactions = useFinanceStore((s) => s.trashedTransactions);
  const trashedCategories = useFinanceStore((s) => s.trashedCategories);
  const trashedAccounts = useFinanceStore((s) => s.trashedAccounts);
  const balanceChangeEntries = useFinanceStore((s) => s.balanceChangeEntries);
  const trashedSubscriptions = useFinanceStore((s) => s.trashedSubscriptions);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const addAccount = useFinanceStore((s) => s.addAccount);
  const replaceAllData = useFinanceStore((s) => s.replaceAllData);
  const clearAllAccountBills = useFinanceStore((s) => s.clearAllAccountBills);
  const globalMemories = useGlobalMemoryStore((s) => s.memories);
  const replaceAllGlobalMemories = useGlobalMemoryStore((s) => s.replaceAllData);
  const investmentPositions = useAppPreferences((s) => s.investmentPositions);
  const investmentPositionHistory = useAppPreferences((s) => s.investmentPositionHistory);
  const investmentGoals = useAppPreferences((s) => s.investmentGoals);
  const investmentWatchlist = useAppPreferences((s) => s.investmentWatchlist);
  const investmentAiMessages = useAppPreferences((s) => s.investmentAiMessages);
  const replaceInvestmentData = useAppPreferences((s) => s.replaceInvestmentData);
  // 负债与还款记录此前不在备份范围内,导出文件里没有它们 —— 换设备后负债与还款历史会静默消失。
  const debts = useAppPreferences((s) => s.debts);
  const repaymentRecords = useAppPreferences((s) => s.repaymentRecords);
  const monthlyIncome = useAppPreferences((s) => s.monthlyIncome);
  const setRepaymentState = useAppPreferences((s) => s.setRepaymentState);
  const replaceRepaymentRecords = useAppPreferences((s) => s.replaceRepaymentRecords);
  // 偏好与计划:云端快照一直带着这些,JSON 文件此前没有。
  const creditDrafts = useAppPreferences((s) => s.creditDrafts);
  const forecastBills = useAppPreferences((s) => s.forecastBills);
  const rssSubscriptions = useAppPreferences((s) => s.rssSubscriptions);
  const confirmedSmartBudgetPlan = useSmartBudgetStore((s) => s.confirmedPlan);
  const smartBudgetHistory = useSmartBudgetStore((s) => s.history);
  const categoryLearningRules = useFinanceStore((s) => s.categoryLearningRules);
  const categoryLearningEvents = useFinanceStore((s) => s.categoryLearningEvents);

  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const billInputRef = useRef<HTMLInputElement | null>(null);
  const webdavRestoreDialogRef = useRef<HTMLElement | null>(null);
  const objectStorageRestoreDialogRef = useRef<HTMLElement | null>(null);

  const [importSource, setImportSource] = useState<BillSource | null>(null);
  const [importMode, setImportMode] = useState<BillImportMode>('incremental');
  const [busy, setBusy] = useState(false);
  const [backupImportProgress, setBackupImportProgress] = useState<{
    phase: BackupImportPhase;
    completed: number;
    total: number;
  } | null>(null);
  const [webdavStatus, setWebdavStatus] = useState('');
  const [toast, setToast] = useState<{ visible: boolean; variant: ToastVariant; message: string }>({
    visible: false,
    variant: 'success',
    message: ''
  });

  const [webdav, setWebdav] = useState<BackupWebdavConfig>(() => loadWebdavConfig());
  const [serverApiToken, setServerApiToken] = useState(() => readStoredLedgerflowApiToken());
  const [objectStorageProvider, setObjectStorageProvider] =
    useState<BackupObjectStorageProvider>('aliyun-oss');
  const [objectStorageConfigs, setObjectStorageConfigs] = useState<
    Record<BackupObjectStorageProvider, BackupObjectStorageConfig>
  >(() => ({
    'aliyun-oss': loadObjectStorageConfig('aliyun-oss'),
    's3-compatible': loadObjectStorageConfig('s3-compatible')
  }));
  const objectStorageConfigsRef = useRef(objectStorageConfigs);
  objectStorageConfigsRef.current = objectStorageConfigs;
  const [lastWebdavBackupAt, setLastWebdavBackupAt] = useState(() =>
    readStoredLastWebdavBackupAt(loadWebdavConfig())
  );
  const [lastObjectStorageBackupAt, setLastObjectStorageBackupAt] = useState<
    Record<BackupObjectStorageProvider, string>
  >(() => {
    const aliyunConfig = loadObjectStorageConfig('aliyun-oss');
    const s3Config = loadObjectStorageConfig('s3-compatible');
    return {
      'aliyun-oss': readStoredLastObjectStorageBackupAt(aliyunConfig),
      's3-compatible': readStoredLastObjectStorageBackupAt(s3Config)
    };
  });
  const [lastWebdavBackupLoading, setLastWebdavBackupLoading] = useState(false);
  const [lastObjectStorageBackupLoading, setLastObjectStorageBackupLoading] = useState(false);
  const [clearBillsOpen, setClearBillsOpen] = useState(false);
  const [clearBillsConfirmText, setClearBillsConfirmText] = useState('');
  const [webdavRestoreDialogOpen, setWebdavRestoreDialogOpen] = useState(false);
  const [webdavRestoreVersions, setWebdavRestoreVersions] = useState<WebdavBackupVersionItem[]>([]);
  const [objectStorageRestoreDialogOpen, setObjectStorageRestoreDialogOpen] = useState(false);
  // 两个版本选择弹层都是 aria-modal:焦点收进来、关闭后还给触发按钮。
  useDialogFocus(webdavRestoreDialogOpen, webdavRestoreDialogRef, () =>
    setWebdavRestoreDialogOpen(false)
  );
  useDialogFocus(objectStorageRestoreDialogOpen, objectStorageRestoreDialogRef, () =>
    setObjectStorageRestoreDialogOpen(false)
  );
  const [objectStorageRestoreVersions, setObjectStorageRestoreVersions] = useState<
    ObjectStorageBackupVersionItem[]
  >([]);
  const [selectedRestorePath, setSelectedRestorePath] = useState('');
  const [selectedObjectStorageRestorePath, setSelectedObjectStorageRestorePath] = useState('');
  const [backupWorkspace, setBackupWorkspace] = useState<
    'local' | 'import' | 'database' | 'webdav' | 'object-storage'
  >('local');
  const [webdavBackupOpen, setWebdavBackupOpen] = useState(false);
  const [objectStorageBackupOpen, setObjectStorageBackupOpen] = useState(false);
  const [webdavAdvancedOpen, setWebdavAdvancedOpen] = useState(false);
  const [objectStorageAdvancedOpen, setObjectStorageAdvancedOpen] = useState(false);
  const [objectStorageStatus, setObjectStorageStatus] = useState('');
  const [sqlExporting, setSqlExporting] = useState(false);
  const [sqlExportStatus, setSqlExportStatus] = useState('');
  const [backupScope, setBackupScope] = useState<FinanceBackupScope>(() => loadStoredBackupScope());

  const totalRows = useMemo(
    () =>
      transactions.length +
      categories.length +
      accounts.length +
      subscriptions.length +
      globalMemories.length +
      investmentPositions.length +
      investmentPositionHistory.length +
      investmentGoals.length +
      investmentWatchlist.length +
      investmentAiMessages.length,
    [
      transactions.length,
      categories.length,
      accounts.length,
      subscriptions.length,
      globalMemories.length,
      investmentPositions.length,
      investmentPositionHistory.length,
      investmentGoals.length,
      investmentWatchlist.length,
      investmentAiMessages.length
    ]
  );

  const showToast = (message: string, variant: ToastVariant) => {
    setToast({ visible: true, message, variant });
  };

  const canCreateBackup = useMemo(() => hasSelectedBackupScope(backupScope), [backupScope]);
  const backupScopeSummary = useMemo(
    () => getBackupScopeSummary(backupScope, tf),
    [backupScope, tf]
  );
  const objectStorage = objectStorageConfigs[objectStorageProvider];
  const objectStorageLabel = useMemo(
    () => getObjectStorageLabel(objectStorageProvider, tf),
    [objectStorageProvider, tf]
  );

  const updateObjectStorage = (patch: Partial<BackupObjectStorageConfig>) => {
    setObjectStorageConfigs((prev) => ({
      ...prev,
      [objectStorageProvider]: {
        ...prev[objectStorageProvider],
        ...patch
      }
    }));
  };

  const handleServerApiTokenChange = (value: string) => {
    setServerApiToken(value);
    writeStoredLedgerflowApiToken(value);
  };

  const handleSqlDatabaseExport = async () => {
    try {
      setSqlExporting(true);
      setSqlExportStatus(tf('dataBackup.status.generatingSqlExport', '正在生成数据库文件...'));
      const result = await downloadSqlDatabaseExport();
      setSqlExportStatus(tf('dataBackup.status.sqlExported', "已下载 {filename}").replace("{filename}", String(result.filename)));
    } catch (error) {
      setSqlExportStatus(error instanceof Error ? error.message : tf('dataBackup.status.sqlExportFailed', 'SQL 数据库导出失败'));
    } finally {
      setSqlExporting(false);
    }
  };

  const getCurrentBackupSnapshot = () => ({
    transactions,
    categories,
    accounts,
    subscriptions,
    trashedTransactions,
    trashedCategories,
    trashedAccounts,
    balanceChangeEntries,
    trashedSubscriptions,
    globalMemories,
    investmentPositions,
    investmentPositionHistory,
    investmentGoals,
    investmentWatchlist,
    investmentAiMessages,
    debts,
    repaymentRecords,
    preferences: {
      monthlyIncome,
      creditDrafts,
      forecastBills,
      rssSubscriptions,
      smartBudgetPlan: confirmedSmartBudgetPlan,
      smartBudgetHistory,
      categoryLearningRules,
      categoryLearningEvents
    }
  });

  const createScopedBackupPayload = () =>
    createFinanceBackupPayload(getCurrentBackupSnapshot(), backupScope);

  const applyParsedBackup = async (payload: FinanceBackupPayload, action: 'import' | 'restore') => {
    const restored = applyFinanceBackupPayload(getCurrentBackupSnapshot(), payload);
    const {
      globalMemories: nextGlobalMemories,
      investmentPositions: nextInvestmentPositions,
      investmentPositionHistory: nextInvestmentPositionHistory,
      investmentGoals: nextInvestmentGoals,
      investmentWatchlist: nextInvestmentWatchlist,
      investmentAiMessages: nextInvestmentAiMessages,
      debts: nextDebts,
      repaymentRecords: nextRepaymentRecords,
      preferences: restoredPreferences,
      ...nextFinanceData
    } = restored;
    await importRelationalData({
      finance: nextFinanceData,
      globalMemories: nextGlobalMemories,
      preferences: {
        ...useAppPreferences.getState(),
        debts: nextDebts,
        repaymentRecords: nextRepaymentRecords,
        ...(restoredPreferences ?? {}),
        investmentPositions: nextInvestmentPositions,
        investmentPositionHistory: nextInvestmentPositionHistory,
        investmentGoals: nextInvestmentGoals,
        investmentWatchlist: nextInvestmentWatchlist,
        investmentAiMessages: nextInvestmentAiMessages
      }
    });
    replaceAllData(nextFinanceData);
    replaceAllGlobalMemories(nextGlobalMemories);
    setRepaymentState({ debts: nextDebts, monthlyIncome });
    replaceRepaymentRecords(nextRepaymentRecords);
    if (restoredPreferences) {
      // 偏好与计划:只覆盖备份里明确带来的字段,其余保持当前值。
      useAppPreferences.setState((current) => ({
        ...current,
        monthlyIncome:
          typeof restoredPreferences.monthlyIncome === 'number'
            ? restoredPreferences.monthlyIncome
            : current.monthlyIncome,
        creditDrafts: Array.isArray(restoredPreferences.creditDrafts)
          ? (restoredPreferences.creditDrafts as never)
          : current.creditDrafts,
        forecastBills: Array.isArray(restoredPreferences.forecastBills)
          ? (restoredPreferences.forecastBills as never)
          : current.forecastBills,
        rssSubscriptions: Array.isArray(restoredPreferences.rssSubscriptions)
          ? (restoredPreferences.rssSubscriptions as never)
          : current.rssSubscriptions
      }));
      useSmartBudgetStore.getState().replaceAllData({
        confirmedPlan:
          restoredPreferences.smartBudgetPlan &&
          typeof restoredPreferences.smartBudgetPlan === 'object'
            ? (restoredPreferences.smartBudgetPlan as never)
            : confirmedSmartBudgetPlan,
        history: Array.isArray(restoredPreferences.smartBudgetHistory)
          ? (restoredPreferences.smartBudgetHistory as never)
          : smartBudgetHistory
      });
      useFinanceStore.setState({
        categoryLearningRules: Array.isArray(restoredPreferences.categoryLearningRules)
          ? (restoredPreferences.categoryLearningRules as never)
          : categoryLearningRules,
        categoryLearningEvents: Array.isArray(restoredPreferences.categoryLearningEvents)
          ? (restoredPreferences.categoryLearningEvents as never)
          : categoryLearningEvents
      });
    }
    replaceInvestmentData({
      investmentPositions: nextInvestmentPositions,
      investmentPositionHistory: nextInvestmentPositionHistory,
      investmentGoals: nextInvestmentGoals,
      investmentWatchlist: nextInvestmentWatchlist,
      investmentAiMessages: nextInvestmentAiMessages
    });
    showToast(buildBackupRestoreSuccessMessage(action, payload, tf), 'success');
  };

  useEffect(() => {
    const config = loadWebdavConfig();
    const storedBackupAt = readStoredLastWebdavBackupAt(config);
    if (storedBackupAt) {
      setLastWebdavBackupAt(storedBackupAt);
    }

    if (
      !config.endpoint.trim() ||
      !config.username.trim() ||
      !config.password.trim() ||
      !config.remoteFilePath.trim()
    ) {
      return undefined;
    }

    let cancelled = false;
    setLastWebdavBackupLoading(true);
    listWebdavBackupVersions(config)
      .then((versions) => {
        if (cancelled) return;
        const backupAt = getLatestWebdavBackupAt(versions);
        if (backupAt) {
          setLastWebdavBackupAt(backupAt);
          writeStoredLastWebdavBackupAt(config, backupAt);
        }
      })
      .catch(() => {
        // 只用于展示最近备份时间，读取失败不打断设置页使用。
      })
      .finally(() => {
        if (!cancelled) {
          setLastWebdavBackupLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const config = objectStorageConfigsRef.current[objectStorageProvider];
    const storedBackupAt = readStoredLastObjectStorageBackupAt(config);
    if (storedBackupAt) {
      setLastObjectStorageBackupAt((prev) => ({
        ...prev,
        [objectStorageProvider]: storedBackupAt
      }));
    }

    if (
      !config.endpoint.trim() ||
      !config.bucket.trim() ||
      !config.accessKeyId.trim() ||
      !config.accessKeySecret.trim() ||
      !config.remoteFilePath.trim()
    ) {
      return undefined;
    }

    let cancelled = false;
    setLastObjectStorageBackupLoading(true);
    listObjectStorageBackupVersions(config)
      .then((versions) => {
        if (cancelled) return;
        const backupAt = getLatestObjectStorageBackupAt(versions);
        if (backupAt) {
          setLastObjectStorageBackupAt((prev) => ({
            ...prev,
            [objectStorageProvider]: backupAt
          }));
          writeStoredLastObjectStorageBackupAt(config, backupAt);
        }
      })
      .catch(() => {
        // 只用于展示最近备份时间，读取失败不打断设置页使用。
      })
      .finally(() => {
        if (!cancelled) {
          setLastObjectStorageBackupLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [objectStorageProvider]);

  useEffect(() => {
    writeStoredBackupScope(backupScope);
  }, [backupScope]);

  const showWebdavStatus = (message: string) => {
    setWebdavStatus(message);
  };

  const showObjectStorageStatus = (message: string) => {
    setObjectStorageStatus(message);
  };

  const ensureDefaultRefs = (source?: BillSource) => {
    const fallbackAccountId = accounts[0]?.id || addAccount(tf('dataBackup.defaultAccountName', '默认账户'), undefined, 0);
    const accountId = source
      ? resolveImportDefaultAccountId(accounts, source, fallbackAccountId)
      : fallbackAccountId;
    return { categoryId: UNCATEGORIZED_CATEGORY_ID, accountId };
  };

  const handleExportJson = () => {
    if (!canCreateBackup) {
      showToast(tf('dataBackup.toast.scopeRequired', '请至少勾选一个备份范围'), 'warning');
      return;
    }

    const payload = createScopedBackupPayload();
    downloadBackupJson(payload);
    showToast(tf('dataBackup.toast.exported', "备份导出成功：{scope}").replace("{scope}", String(backupScopeSummary)), 'success');
  };

  const handleBackupFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    let total = 0;
    try {
      setBusy(true);
      validateBackupFile(file, tf);
      ensureHydrated();
      const text = await file.text();
      const payload = parseFinanceBackupPayload(text);
      total = countFinanceBackupRecords(payload);
      setBackupImportProgress({ phase: 'importing', completed: 0, total });
      await applyParsedBackup(payload, 'import');
      setBackupImportProgress({ phase: 'complete', completed: total, total });
    } catch (error) {
      setBackupImportProgress((current) => ({
        phase: 'error',
        completed: current?.completed || 0,
        total: current?.total || total
      }));
      showToast(error instanceof Error ? error.message : tf('dataBackup.toast.importFailed', '备份导入失败'), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setBackupImportProgress(null), 4000);
    }
  };

  const handleImportBillFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const source = importSource;
    event.target.value = '';
    setImportSource(null);

    if (!file || !source) {
      return;
    }

    try {
      validateBillFile(file, tf);
      ensureHydrated();
      const refs = ensureDefaultRefs(source);
      const rows = await parseBillFileToTransactions({
        file,
        source,
        defaultCategoryId: refs.categoryId,
        defaultAccountId: refs.accountId
      });

      if (rows.length === 0) {
        showToast(tf('dataBackup.bill.noRows', '未识别到可导入账单记录'), 'warning');
        return;
      }

      const result = applyBillImportMode({
        mode: importMode,
        existing: transactions,
        incoming: rows
      });

      if (result.shouldClearBeforeImport) {
        clearAllAccountBills();
      }

      // 恢复备份属于既有数据:同样跳过退款总额校验,避免历史数据把整批恢复顶失败。
      // 批量写,并把「目标不存在」的行先过滤掉(批量路径会直接抛错)。
      const pendingUpdates = result.update.filter((row) =>
        transactions.some((item) => item.id === row.id)
      );
      if (pendingUpdates.length > 0) {
        addTransaction(
          pendingUpdates.map((row) => ({ operation: 'update' as const, id: row.id, payload: row.payload }))
        );
      }
      // 同交易页:批量写一次,避免逐条触发全量余额重算(1 万条存量下每条约 80ms)。
      if (result.append.length > 0) {
        addTransaction(result.append.map((payload) => ({ operation: 'add' as const, payload })));
      }

      const changedCount = result.append.length + result.update.length;
      if (changedCount === 0) {
        showToast(tf('dataBackup.bill.noChange', '导入完成：增量模式下未发现可新增或更新的账单'), 'warning');
        return;
      }

      showToast(
        tf('dataBackup.bill.imported', "{source}账单导入成功：新增 {added} 条，更新 {updated} 条{skipped}")
          .replace('{source}', source === 'wechat' ? tf('dataBackup.bill.wechat', '微信') : tf('dataBackup.bill.alipay', '支付宝'))
          .replace('{added}', String(result.append.length))
          .replace('{updated}', String(result.update.length))
          .replace('{skipped}', result.skipped ? tf('dataBackup.bill.importedSkipped', "，跳过 {skipped} 条").replace('{skipped}', String(result.skipped)) : ''),
        'success'
      );
    } catch {
      showToast(tf('dataBackup.bill.parseFailed', '账单导入失败：文件解析异常'), 'error');
    }
  };

  const handleSaveWebdavConfig = () => {
    saveWebdavConfig(webdav);
    setLastWebdavBackupAt(readStoredLastWebdavBackupAt(webdav));
    showToast(tf('dataBackup.webdav.configSaved', 'WebDAV 配置已保存'), 'success');
  };

  const validateWebdav = () => {
    if (!webdav.endpoint.trim()) {
      throw new Error(
        webdav.proxyEnabled ? tf('dataBackup.webdav.error.realUrlRequired', '请填写真实 WebDAV 地址（用于代理转发）') : tf('dataBackup.webdav.error.urlRequired', '请填写 WebDAV 地址')
      );
    }
    if (!webdav.username.trim()) {
      throw new Error(tf('dataBackup.webdav.error.usernameRequired', '请填写 WebDAV 用户名'));
    }
    if (!webdav.password.trim()) {
      throw new Error(tf('dataBackup.webdav.error.passwordRequired', '请填写 WebDAV 密码'));
    }
    if (!webdav.remoteFilePath.trim()) {
      throw new Error(tf('dataBackup.webdav.error.remotePathRequired', '请填写远程文件路径'));
    }

    try {
      sanitizeWebdavConfig(webdav);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : tf('dataBackup.webdav.error.invalidConfig', 'WebDAV 配置不合法'));
    }
  };

  const handleSaveObjectStorageConfig = () => {
    try {
      saveObjectStorageConfig(objectStorage);
      setLastObjectStorageBackupAt((prev) => ({
        ...prev,
        [objectStorageProvider]: readStoredLastObjectStorageBackupAt(objectStorage)
      }));
      showToast(tf('dataBackup.objectStorage.configSaved', "{provider} 配置已保存").replace("{provider}", String(objectStorageLabel)), 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : tf('dataBackup.objectStorage.invalidConfig', "{provider} 配置不合法").replace("{provider}", String(objectStorageLabel)),
        'error'
      );
    }
  };

  const validateObjectStorage = () => {
    if (!objectStorage.endpoint.trim()) {
      throw new Error(
        objectStorageProvider === 'aliyun-oss' ? tf('dataBackup.objectStorage.error.ossEndpointRequired', '请填写 OSS Endpoint') : tf('dataBackup.objectStorage.error.s3EndpointRequired', '请填写 S3 Endpoint')
      );
    }
    if (!objectStorage.bucket.trim()) {
      throw new Error(tf('dataBackup.objectStorage.error.bucketRequired', '请填写 Bucket 名称'));
    }
    if (!objectStorage.accessKeyId.trim()) {
      throw new Error(tf('dataBackup.objectStorage.error.accessKeyIdRequired', '请填写 AccessKey ID'));
    }
    if (!objectStorage.accessKeySecret.trim()) {
      throw new Error(tf('dataBackup.objectStorage.error.accessKeySecretRequired', '请填写 AccessKey Secret'));
    }
    if (!objectStorage.remoteFilePath.trim()) {
      throw new Error(tf('dataBackup.webdav.error.remotePathRequired', '请填写远程文件路径'));
    }

    try {
      sanitizeObjectStorageConfig(objectStorage);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : tf('dataBackup.objectStorage.invalidConfig', "{provider} 配置不合法").replace("{provider}", String(objectStorageLabel)));
    }
  };

  const ensureHydrated = () => {
    if (!hasHydrated) {
      throw new Error(tf('dataBackup.error.stillLoading', '本地数据仍在加载中，请稍后重试'));
    }
  };

  const handleWebdavUpload = async () => {
    try {
      ensureHydrated();
      validateWebdav();
      if (!canCreateBackup) {
        throw new Error(tf('dataBackup.toast.scopeRequired', '请至少勾选一个备份范围'));
      }
      setBusy(true);
      showWebdavStatus(tf('dataBackup.status.packing', '正在打包备份...'));
      const payload = createScopedBackupPayload();
      await webdavUploadBackup(webdav, payload, (stage) => {
        showWebdavStatus(stage);
      });
      saveWebdavConfig(webdav);
      setLastWebdavBackupAt(payload.exportedAt);
      writeStoredLastWebdavBackupAt(webdav, payload.exportedAt);
      showWebdavStatus(tf('dataBackup.status.backupDone', '备份完成'));
      showToast(tf('dataBackup.webdav.backupSucceeded', "WebDAV 备份成功：{scope}").replace("{scope}", String(backupScopeSummary)), 'success');
    } catch (error) {
      showWebdavStatus(tf('dataBackup.status.backupFailed', '备份失败'));
      showToast(error instanceof Error ? error.message : tf('dataBackup.webdav.backupFailed', 'WebDAV 备份失败'), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setWebdavStatus(''), 2400);
    }
  };

  const handleWebdavDownload = async () => {
    try {
      ensureHydrated();
      validateWebdav();
      setBusy(true);
      showWebdavStatus(tf('dataBackup.status.fetchingVersions', '拉取备份列表...'));
      const versions = await listWebdavBackupVersions(webdav);
      const backupAt = getLatestWebdavBackupAt(versions);
      if (backupAt) {
        setLastWebdavBackupAt(backupAt);
        writeStoredLastWebdavBackupAt(webdav, backupAt);
      }
      setWebdavRestoreVersions(versions);
      setSelectedRestorePath(versions[0]?.remotePath || '');
      setWebdavRestoreDialogOpen(true);
      showWebdavStatus(tf('dataBackup.status.versionsLoaded', '已获取备份列表'));
    } catch (error) {
      showWebdavStatus(tf('dataBackup.status.fetchFailed', '获取失败'));
      showToast(error instanceof Error ? error.message : tf('dataBackup.webdav.downloadFailed', 'WebDAV 下载失败'), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setWebdavStatus(''), 2400);
    }
  };

  const handleConfirmWebdavRestore = async () => {
    try {
      ensureHydrated();
      validateWebdav();
      if (!selectedRestorePath) {
        throw new Error(tf('dataBackup.restore.error.versionRequired', '请选择一个可恢复版本'));
      }
      setBusy(true);
      showWebdavStatus(tf('dataBackup.status.downloadingRestore', '正在下载并恢复...'));
      const payload = await webdavDownloadBackup(webdav, selectedRestorePath);
      await applyParsedBackup(payload, 'restore');
      saveWebdavConfig(webdav);
      setWebdavRestoreDialogOpen(false);
      showWebdavStatus(tf('dataBackup.status.restoreDone', '恢复完成'));
    } catch (error) {
      showWebdavStatus(tf('dataBackup.status.restoreFailed', '恢复失败'));
      showToast(error instanceof Error ? error.message : tf('dataBackup.webdav.downloadFailed', 'WebDAV 下载失败'), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setWebdavStatus(''), 2400);
    }
  };

  const handleObjectStorageUpload = async () => {
    try {
      ensureHydrated();
      validateObjectStorage();
      if (!canCreateBackup) {
        throw new Error(tf('dataBackup.toast.scopeRequired', '请至少勾选一个备份范围'));
      }
      setBusy(true);
      showObjectStorageStatus(tf('dataBackup.status.packing', '正在打包备份...'));
      const payload = createScopedBackupPayload();
      await objectStorageUploadBackup(objectStorage, payload, (stage) => {
        showObjectStorageStatus(stage);
      });
      saveObjectStorageConfig(objectStorage);
      setLastObjectStorageBackupAt((prev) => ({
        ...prev,
        [objectStorageProvider]: payload.exportedAt
      }));
      writeStoredLastObjectStorageBackupAt(objectStorage, payload.exportedAt);
      showObjectStorageStatus(tf('dataBackup.status.backupDone', '备份完成'));
      showToast(tf('dataBackup.objectStorage.backupSucceeded', "{provider} 备份成功：{scope}").replace("{provider}", String(objectStorageLabel)).replace("{scope}", String(backupScopeSummary)), 'success');
    } catch (error) {
      showObjectStorageStatus(tf('dataBackup.status.backupFailed', '备份失败'));
      showToast(error instanceof Error ? error.message : tf('dataBackup.objectStorage.backupFailed', "{provider} 备份失败").replace("{provider}", String(objectStorageLabel)), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setObjectStorageStatus(''), 2400);
    }
  };

  const handleObjectStorageDownload = async () => {
    try {
      ensureHydrated();
      validateObjectStorage();
      setBusy(true);
      showObjectStorageStatus(tf('dataBackup.status.fetchingVersions', '拉取备份列表...'));
      const versions = await listObjectStorageBackupVersions(objectStorage);
      const backupAt = getLatestObjectStorageBackupAt(versions);
      if (backupAt) {
        setLastObjectStorageBackupAt((prev) => ({
          ...prev,
          [objectStorageProvider]: backupAt
        }));
        writeStoredLastObjectStorageBackupAt(objectStorage, backupAt);
      }
      setObjectStorageRestoreVersions(versions);
      setSelectedObjectStorageRestorePath(versions[0]?.remotePath || '');
      setObjectStorageRestoreDialogOpen(true);
      showObjectStorageStatus(tf('dataBackup.status.versionsLoaded', '已获取备份列表'));
    } catch (error) {
      showObjectStorageStatus(tf('dataBackup.status.fetchFailed', '获取失败'));
      showToast(error instanceof Error ? error.message : tf('dataBackup.objectStorage.downloadFailed', "{provider} 下载失败").replace("{provider}", String(objectStorageLabel)), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setObjectStorageStatus(''), 2400);
    }
  };

  const handleConfirmObjectStorageRestore = async () => {
    try {
      ensureHydrated();
      validateObjectStorage();
      if (!selectedObjectStorageRestorePath) {
        throw new Error(tf('dataBackup.restore.error.versionRequired', '请选择一个可恢复版本'));
      }
      setBusy(true);
      showObjectStorageStatus(tf('dataBackup.status.downloadingRestore', '正在下载并恢复...'));
      const payload = await objectStorageDownloadBackup(
        objectStorage,
        selectedObjectStorageRestorePath
      );
      await applyParsedBackup(payload, 'restore');
      saveObjectStorageConfig(objectStorage);
      setObjectStorageRestoreDialogOpen(false);
      showObjectStorageStatus(tf('dataBackup.status.restoreDone', '恢复完成'));
    } catch (error) {
      showObjectStorageStatus(tf('dataBackup.status.restoreFailed', '恢复失败'));
      showToast(error instanceof Error ? error.message : tf('dataBackup.objectStorage.downloadFailed', "{provider} 下载失败").replace("{provider}", String(objectStorageLabel)), 'error');
    } finally {
      setBusy(false);
      window.setTimeout(() => setObjectStorageStatus(''), 2400);
    }
  };

  const lastWebdavBackupText = lastWebdavBackupAt
    ? formatWebdavBackupTime(lastWebdavBackupAt)
    : lastWebdavBackupLoading
      ? tf('dataBackup.status.loading', '读取中...')
      : tf('dataBackup.status.noRecord', '暂无记录');
  const lastObjectStorageBackupText = lastObjectStorageBackupAt[objectStorageProvider]
    ? formatWebdavBackupTime(lastObjectStorageBackupAt[objectStorageProvider])
    : lastObjectStorageBackupLoading
      ? tf('dataBackup.status.loading', '读取中...')
      : tf('dataBackup.status.noRecord', '暂无记录');

  return (
    <div className="database-settings-page vi-page">
      <header className="database-console-header">
        <div>
          <p className="database-console-eyebrow">
            {tf('dataBackup.eyebrow', '数据管理')}
          </p>
          <h1>{tf('dataBackup.title', '数据与备份')}</h1>
        </div>
        <div
          className="database-console-stat"
          aria-label={tf('dataBackup.currentVolume', '当前数据量')}
        >
          <strong>{totalRows}</strong>
          <span>{tf('dataBackup.managedRowsSuffix', '条已纳管数据')}</span>
        </div>
      </header>

      <nav className="database-console-tabs" aria-label={tf('dataBackup.backupMethod', '备份方式')}>
        {[
          ['local', tf('dataBackup.tabs.local', '本地备份')],
          ['import', tf('dataBackup.tabs.billImport', '账单导入')],
          ['database', tf('dataBackup.tabs.database', '数据库')],
          ['webdav', 'WebDAV'],
          ['object-storage', tf('dataBackup.tabs.objectStorage', '对象存储')]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={backupWorkspace === key ? 'is-active' : undefined}
            aria-current={backupWorkspace === key ? 'page' : undefined}
            onClick={() => setBackupWorkspace(key as typeof backupWorkspace)}
          >
            {label}
          </button>
        ))}
      </nav>

      {backupWorkspace === 'local' ? (
        <section className="database-console-workspace">
          <div className="database-console-workspace-head">
            <div>
              <span className="database-console-kicker">
                {tf('dataBackup.jsonKicker', 'JSON 归档')}
              </span>
              <h2>{tf('dataBackup.tabs.local', '本地备份')}</h2>
            </div>
            <span className="database-data-section-meta">
              {tf('dataBackup.currentRows', '当前 {count} 条数据').replace(
                '{count}',
                String(totalRows)
              )}
            </span>
          </div>
          <BackupScopeSelector scope={backupScope} onChange={setBackupScope} />
          <div className="database-data-hub-actions">
            <button
              type="button"
              className="primary button-with-icon"
              onClick={handleExportJson}
              disabled={!hasHydrated || !canCreateBackup}
            >
              <img src={BACKUP_ICON_URL} alt="" aria-hidden="true" />
              {tf('dataBackup.local.export', '导出备份文件')}
            </button>
            <button
              type="button"
              className="button-with-icon"
              onClick={() => backupInputRef.current?.click()}
              disabled={busy}
            >
              <img src={RESTORE_ICON_URL} alt="" aria-hidden="true" />
              {tf('dataBackup.local.import', '导入备份文件')}
            </button>
            {backupImportProgress ? (
              <div
                className={`database-backup-import-progress is-${backupImportProgress.phase}`}
                role="status"
                aria-live="polite"
              >
                <div className="database-backup-import-progress-copy">
                  <strong>
                    {backupImportProgress.phase === 'complete'
                      ? tf('dataBackup.status.importDone', '导入完成')
                      : backupImportProgress.phase === 'error'
                        ? tf('dataBackup.status.importFailed', '导入失败')
                        : tf('dataBackup.status.writing', '正在写入数据库')}
                  </strong>
                  <span>
                    {backupImportProgress.completed} / {backupImportProgress.total}{tf('dataBackup.progress.rowsSuffix', " 条 ")}{backupImportProgress.phase === 'importing'
                      ? tf('dataBackup.progress.remaining', " · 剩余 {remaining} 条").replace("{remaining}", String(Math.max(backupImportProgress.total - backupImportProgress.completed, 0)))
                      : ''}
                  </span>
                </div>
                <div
                  className="database-backup-import-progress-track"
                  role="progressbar"
                  aria-label={tf('dataBackup.aria.importProgress', '备份导入进度')}
                  aria-valuemin={0}
                  aria-valuemax={backupImportProgress.total}
                  aria-valuenow={backupImportProgress.completed}
                >
                  <span
                    style={{
                      width: `${
                        backupImportProgress.phase === 'complete'
                          ? 100
                          : backupImportProgress.total > 0
                            ? (backupImportProgress.completed / backupImportProgress.total) * 100
                            : 0
                      }%`
                    }}
                  />
                </div>
              </div>
            ) : null}
            <input
              ref={backupInputRef}
              type="file"
              title={tf('dataBackup.aria.importJson', '导入 JSON 备份')}
              aria-label={tf('dataBackup.aria.importJson', '导入 JSON 备份')}
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleBackupFileImport}
            />
          </div>
        </section>
      ) : null}

      {backupWorkspace === 'import' ? (
        <section className="database-console-workspace">
          <div className="database-console-workspace-head">
            <div>
              <span className="database-console-kicker">
                {tf('dataBackup.billKicker', '账单导入')}
              </span>
              <h2>{tf('dataBackup.tabs.billImport', '账单导入')}</h2>
            </div>
          </div>
          <div className="database-import-actions">
            <label className="field database-import-mode-field" style={{ marginBottom: 0 }}>
              {tf('dataBackup.billImport.duplicateStrategy', '遇到重复账单时')}
              <select
                aria-label={tf('dataBackup.billImport.modeAria', '账单导入模式')}
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as BillImportMode)}
              >
                <option value="incremental">
                  {tf('dataBackup.billImport.strategyKeep', '保留旧账单，重复但有变更时更新为最新')}
                </option>
                <option value="merge">
                  {tf('dataBackup.billImport.strategyOverwrite', '用新账单覆盖重复账单的导入字段')}
                </option>
                <option value="overwrite">
                  {tf('dataBackup.billImport.strategyReset', '清空现有交易后重新导入')}
                </option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setImportSource('wechat');
                billInputRef.current?.click();
              }}
              disabled={!hasHydrated}
            >
              {tf('dataBackup.billImport.wechat', '导入微信账单')}
            </button>
            <button
              type="button"
              onClick={() => {
                setImportSource('alipay');
                billInputRef.current?.click();
              }}
              disabled={!hasHydrated}
            >
              {tf('dataBackup.billImport.alipay', '导入支付宝账单')}
            </button>
            <input
              ref={billInputRef}
              type="file"
              title={tf('dataBackup.billImport.fileAria', '导入账单文件')}
              aria-label={tf('dataBackup.billImport.fileAria', '导入账单文件')}
              accept=".csv,text/csv,.txt,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={handleImportBillFile}
            />
          </div>
        </section>
      ) : null}

      {backupWorkspace === 'database' ? (
        <div className="database-console-channel">
          <DatabaseProviderSetupPanel />
          <section className="panel database-remote-backup-card database-sql-export-card">
            <div className="database-remote-backup-head">
              <div>
                <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0 }}>
                    {tf('dataBackup.database.exportTitle', '导出 SQL 数据库')}
                  </h3>
                  <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
                    {tf(
                      'dataBackup.database.exportFormat',
                      'SQLite 导出 .sqlite · MySQL 导出 .sql'
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="database-remote-backup-body">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="primary button-with-icon"
                  onClick={() => void handleSqlDatabaseExport()}
                  disabled={!hasHydrated || sqlExporting}
                >
                  <img src={BACKUP_ICON_URL} alt="" aria-hidden="true" />
                  {sqlExporting
                    ? tf('dataBackup.status.exporting', '正在导出...')
                    : tf('dataBackup.database.download', '下载 SQL 数据库')}
                </button>
                {sqlExportStatus ? (
                  <span className="sync-tip" role="status">
                    {sqlExportStatus}
                  </span>
                ) : null}
              </div>
            </div>
          </section>
          <MysqlSnapshotPanel
            disabled={!hasHydrated}
            canCreateBackup={canCreateBackup}
            backupScopeSummary={backupScopeSummary}
            backupScope={backupScope}
            onBackupScopeChange={setBackupScope}
            apiToken={serverApiToken}
            onApiTokenChange={handleServerApiTokenChange}
            createPayload={createScopedBackupPayload}
            onRestore={(payload) => applyParsedBackup(payload, 'restore')}
          />
        </div>
      ) : null}

      {backupWorkspace === 'webdav' ? (
        <section className="database-console-workspace database-remote-backup-card">
          <div className="database-remote-backup-head">
            <div>
              <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>{tf('dataBackup.webdav.section', 'WebDAV 备份')}</h3>
                <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
                  {tf('dataBackup.webdav.lastBackupPrefix', '上次备份:')}
                  {lastWebdavBackupText}
                </span>
              </div>
            </div>
            <div className="database-remote-backup-summary">
              <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
                {webdav.proxyEnabled
                  ? tf('dataBackup.webdav.proxyOn', '代理已启用')
                  : tf('dataBackup.webdav.direct', '浏览器直连')}
              </span>
              <button
                type="button"
                className="database-remote-backup-toggle"
                aria-expanded={webdavBackupOpen}
                onClick={() => setWebdavBackupOpen((prev) => !prev)}
              >
                {webdavBackupOpen
                  ? tf('dataBackup.toggle.collapse', '收起配置')
                  : tf('dataBackup.toggle.expand', '展开配置')}
              </button>
            </div>
          </div>

          {webdavBackupOpen ? (
            <div className="database-remote-backup-body">
              <div className="grid grid-2" style={{ gap: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>
                    {webdav.proxyEnabled
                      ? tf('dataBackup.webdav.realUrl', '真实 WebDAV 地址')
                      : tf('dataBackup.webdav.url', 'WebDAV 地址')}
                  </label>
                  <input
                    title={
                      webdav.proxyEnabled
                        ? tf('dataBackup.webdav.realUrl', '真实 WebDAV 地址')
                        : tf('dataBackup.webdav.url', 'WebDAV 地址')
                    }
                    placeholder="https://dav.example.com/remote.php/dav/files/user"
                    value={webdav.endpoint}
                    onChange={(e) => setWebdav((prev) => ({ ...prev, endpoint: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{tf('dataBackup.webdav.remotePath', '远程文件路径')}</label>
                  <input
                    title={tf('dataBackup.webdav.remotePath', '远程文件路径')}
                    placeholder="ledgerflow/backup.json"
                    value={webdav.remoteFilePath}
                    onChange={(e) =>
                      setWebdav((prev) => ({ ...prev, remoteFilePath: e.target.value }))
                    }
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{tf('dataBackup.webdav.username', '用户名')}</label>
                  <input
                    title={tf('dataBackup.aria.webdavUsername', 'WebDAV 用户名')}
                    placeholder={tf('dataBackup.placeholder.username', '请输入用户名')}
                    value={webdav.username}
                    onChange={(e) => setWebdav((prev) => ({ ...prev, username: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{tf('dataBackup.webdav.password', '密码')}</label>
                  <PasswordInput
                    title={tf('dataBackup.aria.webdavPassword', 'WebDAV 密码')}
                    placeholder={tf('dataBackup.placeholder.password', '请输入密码')}
                    value={webdav.password}
                    onChange={(e) => setWebdav((prev) => ({ ...prev, password: e.target.value }))}
                    showLabel={tf('dataBackup.password.show', "显示密码")}
                    hideLabel={tf('dataBackup.password.hide', "隐藏密码")}
                  />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={() => setWebdavAdvancedOpen((prev) => !prev)}>
                  {webdavAdvancedOpen
                    ? tf('dataBackup.toggle.collapseAdvanced', '收起高级选项')
                    : tf('dataBackup.toggle.expandAdvanced', '展开高级选项')}
                </button>
              </div>

              {webdavAdvancedOpen ? (
                <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={webdav.proxyEnabled}
                        onChange={(e) =>
                          setWebdav((prev) => ({ ...prev, proxyEnabled: e.target.checked }))
                        }
                      />
                      {tf('dataBackup.webdav.proxyEnable', '启用同源代理')}
                    </label>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{tf('dataBackup.webdav.keepVersions', '保留版本数')}</label>
                    <input
                      title={tf('dataBackup.webdav.keepVersions', '保留版本数')}
                      type="number"
                      min={1}
                      max={50}
                      value={webdav.retainedVersions}
                      onChange={(e) =>
                        setWebdav((prev) => ({
                          ...prev,
                          retainedVersions: Number(e.target.value) || 1
                        }))
                      }
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{tf('dataBackup.webdav.proxyPath', '代理入口路径')}</label>
                    <input
                      title={tf('dataBackup.webdav.proxyPath', '代理入口路径')}
                      placeholder="/api/webdav"
                      value={webdav.proxyBasePath}
                      onChange={(e) =>
                        setWebdav((prev) => ({ ...prev, proxyBasePath: e.target.value }))
                      }
                      disabled={!webdav.proxyEnabled}
                    />
                  </div>
                  {webdav.proxyEnabled ? (
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>{tf('dataBackup.webdav.proxyToken', '代理令牌')}</label>
                      <PasswordInput
                        title={tf('dataBackup.aria.apiToken', 'LedgerFlow API 令牌')}
                        placeholder={tf(
                          'dataBackup.placeholder.tokenHint',
                          '与服务端 LEDGERFLOW_API_TOKEN 保持一致'
                        )}
                        value={serverApiToken}
                        onChange={(e) => handleServerApiTokenChange(e.target.value)}
                        showLabel={tf('dataBackup.secret.show', "显示")}
                        hideLabel={tf('dataBackup.secret.hide', "隐藏")}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <p className="sync-tip" style={{ margin: '10px 0 0' }}>
                {webdav.proxyEnabled
                  ? tf('dataBackup.webdav.modeProxy', '当前:同源代理已启用。')
                  : tf('dataBackup.webdav.modeDirect', '当前:浏览器直连\uFF0C可能受跨域限制。')}
              </p>
              <div style={{ marginTop: 10 }}>
                <BackupScopeSelector scope={backupScope} onChange={setBackupScope} />
              </div>

              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={handleSaveWebdavConfig} disabled={busy}>
                  {tf('dataBackup.common.save', '保存')}
                </button>
                <button
                  type="button"
                  className="primary button-with-icon"
                  onClick={() => void handleWebdavUpload()}
                  disabled={busy || !canCreateBackup}
                >
                  <img src={BACKUP_ICON_URL} alt="" aria-hidden="true" />
                  {tf('dataBackup.webdav.backupNow', '立即备份')}
                </button>
                <button
                  type="button"
                  className="button-with-icon"
                  onClick={() => void handleWebdavDownload()}
                  disabled={busy}
                >
                  <img src={RESTORE_ICON_URL} alt="" aria-hidden="true" />
                  {tf('dataBackup.webdav.restore', '恢复备份')}
                </button>
                {webdavStatus ? <span className="sync-tip">{webdavStatus}</span> : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {backupWorkspace === 'object-storage' ? (
        <section className="database-console-workspace database-remote-backup-card">
          <div className="database-remote-backup-head">
            <div>
              <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>
                  {tf('dataBackup.objectStorage.section', '对象存储备份')}
                </h3>
                <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
                  {tf('dataBackup.objectStorage.lastBackupPrefix', '上次备份:')}
                  {lastObjectStorageBackupText}
                </span>
              </div>
            </div>
            <div className="database-remote-backup-summary">
              <span className="sync-tip" style={{ whiteSpace: 'nowrap' }}>
                {tf('dataBackup.objectStorage.currentPrefix', '当前:')}
                {objectStorageLabel}
              </span>
              <button
                type="button"
                className="database-remote-backup-toggle"
                aria-expanded={objectStorageBackupOpen}
                onClick={() => setObjectStorageBackupOpen((prev) => !prev)}
              >
                {objectStorageBackupOpen
                  ? tf('dataBackup.toggle.collapse', '收起配置')
                  : tf('dataBackup.toggle.expand', '展开配置')}
              </button>
            </div>
          </div>

          {objectStorageBackupOpen ? (
            <div className="database-remote-backup-body">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {OBJECT_STORAGE_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={objectStorageProvider === item.value ? 'primary' : undefined}
                    onClick={() => setObjectStorageProvider(item.value)}
                  >
                    {item.label(tf)}
                  </button>
                ))}
              </div>
              <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>
                    {objectStorageProvider === 'aliyun-oss' ? 'OSS Endpoint' : 'S3 Endpoint'}
                  </label>
                  <input
                    title={objectStorageProvider === 'aliyun-oss' ? 'OSS Endpoint' : 'S3 Endpoint'}
                    placeholder={
                      objectStorageProvider === 'aliyun-oss'
                        ? 'https://oss-cn-guangzhou.aliyuncs.com'
                        : 'https://s3.example.com'
                    }
                    value={objectStorage.endpoint}
                    onChange={(e) => updateObjectStorage({ endpoint: e.target.value })}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Bucket</label>
                  <input
                    title="Bucket"
                    placeholder="ledgerflow-backup"
                    value={objectStorage.bucket}
                    onChange={(e) => updateObjectStorage({ bucket: e.target.value })}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{tf('dataBackup.webdav.remotePath', '远程文件路径')}</label>
                  <input
                    title={tf('dataBackup.webdav.remotePath', '远程文件路径')}
                    placeholder="ledgerflow/backup.json"
                    value={objectStorage.remoteFilePath}
                    onChange={(e) => updateObjectStorage({ remoteFilePath: e.target.value })}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>AccessKey ID</label>
                  <input
                    title="AccessKey ID"
                    placeholder={tf(
                      'dataBackup.placeholder.accessKeyId',
                      tf('dataBackup.placeholder.accessKeyId', '请输入 AccessKey ID')
                    )}
                    value={objectStorage.accessKeyId}
                    onChange={(e) => updateObjectStorage({ accessKeyId: e.target.value })}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>AccessKey Secret</label>
                  <PasswordInput
                    title="AccessKey Secret"
                    placeholder={tf(
                      'dataBackup.placeholder.sessionOnly',
                      tf('dataBackup.placeholder.sessionOnly', '仅保存在本次会话')
                    )}
                    value={objectStorage.accessKeySecret}
                    onChange={(e) => updateObjectStorage({ accessKeySecret: e.target.value })}
                    showLabel={tf('dataBackup.secret.showValue', "显示密钥")}
                    hideLabel={tf('dataBackup.secret.hideValue', "隐藏密钥")}
                  />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={() => setObjectStorageAdvancedOpen((prev) => !prev)}>
                  {objectStorageAdvancedOpen
                    ? tf('dataBackup.toggle.collapseAdvanced', '收起高级选项')
                    : tf('dataBackup.toggle.expandAdvanced', '展开高级选项')}
                </button>
              </div>

              {objectStorageAdvancedOpen ? (
                <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{tf('dataBackup.objectStorage.region', '地域')}</label>
                    <input
                      title={tf('dataBackup.objectStorage.region', '地域')}
                      placeholder={
                        objectStorageProvider === 'aliyun-oss' ? 'cn-guangzhou' : 'us-east-1'
                      }
                      value={objectStorage.region}
                      onChange={(e) => updateObjectStorage({ region: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{tf('dataBackup.webdav.keepVersions', '保留版本数')}</label>
                    <input
                      title={tf('dataBackup.webdav.keepVersions', '保留版本数')}
                      type="number"
                      min={1}
                      max={50}
                      value={objectStorage.retainedVersions}
                      onChange={(e) =>
                        updateObjectStorage({ retainedVersions: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                  {objectStorageProvider === 's3-compatible' ? (
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={objectStorage.forcePathStyle}
                          onChange={(e) =>
                            updateObjectStorage({ forcePathStyle: e.target.checked })
                          }
                        />
                        {tf('dataBackup.webdav.pathStyle', '使用路径风格地址')}
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ marginTop: 10 }}>
                <BackupScopeSelector scope={backupScope} onChange={setBackupScope} />
              </div>

              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={handleSaveObjectStorageConfig} disabled={busy}>
                  {tf('dataBackup.common.save', '保存')}
                </button>
                <button
                  type="button"
                  className="primary button-with-icon"
                  onClick={() => void handleObjectStorageUpload()}
                  disabled={busy || !canCreateBackup}
                >
                  <img src={BACKUP_ICON_URL} alt="" aria-hidden="true" />
                  {tf('dataBackup.webdav.backupNow', '立即备份')}
                </button>
                <button
                  type="button"
                  className="button-with-icon"
                  onClick={() => void handleObjectStorageDownload()}
                  disabled={busy}
                >
                  <img src={RESTORE_ICON_URL} alt="" aria-hidden="true" />
                  {tf('dataBackup.webdav.restore', '恢复备份')}
                </button>
                {objectStorageStatus ? (
                  <span className="sync-tip">{objectStorageStatus}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {backupWorkspace === 'local' ? (
        <section className="database-console-danger-zone">
          <h3 style={{ marginTop: 0 }}>{tf('dataBackup.reset.section', '数据重制')}</h3>
          <p className="sync-tip">
            {tf('dataBackup.reset.desc', '清空所有账户账单（交易记录），保留账户与分类。')}
          </p>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setClearBillsConfirmText('');
              setClearBillsOpen(true);
            }}
          >
            {tf('dataBackup.reset.title', '一键清空所有账户账单')}
          </button>
        </section>
      ) : null}

      {webdavRestoreDialogOpen ? (
        <div
          className="dialog-overlay"
          role="presentation"
          onClick={() => setWebdavRestoreDialogOpen(false)}
        >
          <section
            ref={webdavRestoreDialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={tf('dataBackup.aria.webdavVersion', '选择 WebDAV 恢复版本')}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dialog-header">
              {tf('dataBackup.webdav.restoreSelect', '选择要恢复的 WebDAV 备份版本')}
            </header>
            <div className="dialog-body">
              <div className="webdav-restore-list">
                {webdavRestoreVersions.map((item) => (
                  <label className="webdav-restore-item" key={item.remotePath}>
                    <input
                      type="radio"
                      name="webdav-restore-version"
                      checked={selectedRestorePath === item.remotePath}
                      onChange={() => setSelectedRestorePath(item.remotePath)}
                    />
                    <span className="webdav-restore-item-copy">
                      <strong>
                        {item.label}
                        {item.isLatest ? tf('dataBackup.webdav.latest', '（最新）') : ''}
                      </strong>
                      <small>{item.fileName}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="dialog-footer">
              <button type="button" onClick={() => setWebdavRestoreDialogOpen(false)}>
                {tf('dataBackup.common.cancel', '取消')}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleConfirmWebdavRestore()}
                disabled={busy || !selectedRestorePath}
              >
                {tf('dataBackup.webdav.restoreSelected', '恢复所选版本')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {objectStorageRestoreDialogOpen ? (
        <div
          className="dialog-overlay"
          role="presentation"
          onClick={() => setObjectStorageRestoreDialogOpen(false)}
        >
          <section
            ref={objectStorageRestoreDialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={tf('dataBackup.restore.objectStorageAria', "选择 {provider} 恢复版本").replace("{provider}", String(objectStorageLabel))}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dialog-header">{tf('dataBackup.restore.objectStorageTitlePrefix', "选择要恢复的 ")}{objectStorageLabel}{tf('dataBackup.restore.objectStorageTitleSuffix', " 备份版本")}</header>
            <div className="dialog-body">
              <div className="webdav-restore-list">
                {objectStorageRestoreVersions.map((item) => (
                  <label className="webdav-restore-item" key={item.remotePath}>
                    <input
                      type="radio"
                      name="object-storage-restore-version"
                      checked={selectedObjectStorageRestorePath === item.remotePath}
                      onChange={() => setSelectedObjectStorageRestorePath(item.remotePath)}
                    />
                    <span className="webdav-restore-item-copy">
                      <strong>
                        {item.label}
                        {item.isLatest ? tf('dataBackup.webdav.latest', '（最新）') : ''}
                      </strong>
                      <small>{item.fileName}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="dialog-footer">
              <button type="button" onClick={() => setObjectStorageRestoreDialogOpen(false)}>
                {tf('dataBackup.common.cancel', '取消')}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleConfirmObjectStorageRestore()}
                disabled={busy || !selectedObjectStorageRestorePath}
              >
                {tf('dataBackup.webdav.restoreSelected', '恢复所选版本')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <Toast
        visible={toast.visible}
        variant={toast.variant}
        message={toast.message}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <ConfirmDialog
        open={clearBillsOpen}
        title={tf('dataBackup.aria.confirmClear', '确认清空账单')}
        description={
          <div className="danger-confirm-copy">
            <p>{tf('dataBackup.reset.confirmBody', "将清空全部 " + '{count}' + " 条交易，账户余额会按初始值重算。此操作不可恢复。").replace('{count}', String(transactions.length))}</p>
            <label className="danger-confirm-field">
              <span>{tf('dataBackup.reset.confirmInputPrefix', " 输入 ")}<strong>{clearBillsConfirmWord}</strong>{' '}
                {tf('dataBackup.confirmSuffix', '后才能确认')}
              </span>
              <input
                value={clearBillsConfirmText}
                onChange={(event) => setClearBillsConfirmText(event.target.value)}
                placeholder={clearBillsConfirmWord}
                autoFocus
              />
            </label>
          </div>
        }
        confirmText={tf('dataBackup.reset.confirmOk', "确认清空")}
        cancelText={tf('dataBackup.common.cancel', "取消")}
        danger
        confirmDisabled={!isClearBillsConfirmMatched(clearBillsConfirmText)}
        onCancel={() => {
          setClearBillsOpen(false);
          setClearBillsConfirmText('');
        }}
        onConfirm={() => {
          if (!isClearBillsConfirmMatched(clearBillsConfirmText)) return;
          clearAllAccountBills();
          setClearBillsOpen(false);
          setClearBillsConfirmText('');
          showToast(tf('dataBackup.status.cleared', '已清空所有账户账单'), 'success');
        }}
      />
    </div>
  );
}
