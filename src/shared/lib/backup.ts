import { Account } from '../../entities/account/types';
import { Category } from '../../entities/category/types';
import {
  SubscriptionBillingCycle,
  SubscriptionItem,
  SubscriptionKind,
  SubscriptionStatus
} from '../../entities/subscription/types';
import {
  BalanceChangeEntry,
  TransactionAttachmentItem,
  TransactionItem
} from '../../entities/transaction/types';
import { GlobalMemoryItem, sanitizePersistedGlobalMemoryItem } from '../store/globalMemory';
import type { FinanceDataSnapshot } from '../store/useFinanceStore';

const BACKUP_KEY = 'ledgerflow-backup-webdav-v1';
const BACKUP_PASSWORD_SESSION_KEY = 'ledgerflow-backup-webdav-password';
const OBJECT_STORAGE_KEY_PREFIX = 'ledgerflow-backup-object-storage-v1';
const OBJECT_STORAGE_SECRET_SESSION_KEY_PREFIX = 'ledgerflow-backup-object-storage-secret-v1';

export interface BackupWebdavConfig {
  /** 真实 WebDAV 服务地址，例如：https://dav.example.com/remote.php/dav/files/user */
  endpoint: string;
  username: string;
  password: string;
  remoteFilePath: string;
  /** 最多保留多少个版本化备份 */
  retainedVersions: number;
  /** 是否通过同源代理请求（用于规避浏览器跨域限制） */
  proxyEnabled: boolean;
  /** 同源代理入口路径，例如：/api/webdav */
  proxyBasePath: string;
}

export type BackupObjectStorageProvider = 'aliyun-oss' | 's3-compatible';

export interface BackupObjectStorageConfig {
  provider: BackupObjectStorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  remoteFilePath: string;
  retainedVersions: number;
  forcePathStyle: boolean;
}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
  [0x00000000, 0x00ffffff] // 0.0.0.0/8
];

function ipv4ToInt(hostname: string): number | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((item) => Number(item));
  if (nums.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return null;
  }
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }

  const ipv4 = ipv4ToInt(lower);
  if (ipv4 === null) return false;
  return PRIVATE_IPV4_RANGES.some(([start, end]) => ipv4 >= start && ipv4 <= end);
}

function normalizeProxyBasePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('已启用同源代理，请填写代理入口路径');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('代理入口路径必须以 / 开头，例如 /api/webdav');
  }
  if (trimmed.startsWith('//') || trimmed.includes('://')) {
    throw new Error('代理入口路径仅允许同源相对路径，例如 /api/webdav');
  }
  return trimmed.replace(/\/+$/, '') || '/api/webdav';
}

function normalizeWebdavEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error('请填写 WebDAV 地址');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('WebDAV 地址格式无效，请使用完整 HTTPS URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('WebDAV 地址仅支持 HTTPS 协议');
  }

  if (parsed.username || parsed.password) {
    throw new Error('WebDAV 地址中不应包含用户名或密码');
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error('WebDAV 地址不允许使用本地或内网地址');
  }

  return parsed.toString().replace(/\/$/, '');
}

function normalizeRemoteFilePath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('请填写远程文件路径');
  }

  const segments = trimmed.split('/').map((item) => item.trim());
  if (segments.some((item) => !item || item === '.' || item === '..')) {
    throw new Error('远程文件路径不合法，请避免使用空段或 . / ..');
  }

  return segments.join('/');
}

function normalizeRetainedVersions(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.min(50, Math.max(1, Math.round(numeric)));
}

export function sanitizeWebdavConfig(config: BackupWebdavConfig): BackupWebdavConfig {
  const endpoint = normalizeWebdavEndpoint(config.endpoint);
  const remoteFilePath = normalizeRemoteFilePath(config.remoteFilePath);

  return {
    ...config,
    endpoint,
    username: config.username.trim(),
    password: config.password,
    remoteFilePath,
    retainedVersions: normalizeRetainedVersions(config.retainedVersions),
    proxyEnabled: Boolean(config.proxyEnabled),
    proxyBasePath: config.proxyEnabled
      ? normalizeProxyBasePath(config.proxyBasePath)
      : '/api/webdav'
  };
}

function getObjectStorageConfigKey(provider: BackupObjectStorageProvider): string {
  return `${OBJECT_STORAGE_KEY_PREFIX}:${provider}`;
}

function getObjectStorageSecretSessionKey(provider: BackupObjectStorageProvider): string {
  return `${OBJECT_STORAGE_SECRET_SESSION_KEY_PREFIX}:${provider}`;
}

function getDefaultObjectStorageConfig(
  provider: BackupObjectStorageProvider
): BackupObjectStorageConfig {
  return {
    provider,
    endpoint: provider === 'aliyun-oss' ? 'https://oss-cn-guangzhou.aliyuncs.com' : '',
    region: provider === 'aliyun-oss' ? 'cn-guangzhou' : 'us-east-1',
    bucket: '',
    accessKeyId: '',
    accessKeySecret: '',
    remoteFilePath: 'ledgerflow/backup.json',
    retainedVersions: 5,
    forcePathStyle: provider === 's3-compatible'
  };
}

function normalizeObjectStorageEndpoint(
  endpoint: string,
  provider: BackupObjectStorageProvider
): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error(provider === 'aliyun-oss' ? '请填写 OSS Endpoint' : '请填写 S3 Endpoint');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('对象存储 Endpoint 格式无效，请使用完整 HTTPS URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('对象存储 Endpoint 仅支持 HTTPS 协议');
  }

  if (parsed.username || parsed.password) {
    throw new Error('对象存储 Endpoint 中不应包含 AccessKey');
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error('对象存储 Endpoint 不允许使用本地或内网地址');
  }

  if (parsed.pathname !== '/' && parsed.pathname.replace(/\/+$/, '') !== '') {
    throw new Error('对象存储 Endpoint 请填写服务根地址，不要带路径');
  }

  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeObjectStorageBucket(bucket: string): string {
  const trimmed = bucket.trim();
  if (!trimmed) {
    throw new Error('请填写 Bucket 名称');
  }
  if (/[\\/\s]/.test(trimmed)) {
    throw new Error('Bucket 名称不应包含空格或斜杠');
  }
  return trimmed;
}

function normalizeObjectStorageRegion(
  provider: BackupObjectStorageProvider,
  region: string,
  endpoint: string
): string {
  const trimmed = region.trim();
  if (trimmed) {
    return trimmed;
  }

  if (provider === 'aliyun-oss') {
    const host = new URL(endpoint).hostname;
    const matched = host.match(/^(oss-[a-z0-9-]+)\./i);
    return matched?.[1]?.replace(/^oss-/, '') || 'cn-guangzhou';
  }

  return 'us-east-1';
}

export function sanitizeObjectStorageConfig(
  config: BackupObjectStorageConfig
): BackupObjectStorageConfig {
  const provider: BackupObjectStorageProvider =
    config.provider === 's3-compatible' ? 's3-compatible' : 'aliyun-oss';
  const endpoint = normalizeObjectStorageEndpoint(config.endpoint, provider);
  const remoteFilePath = normalizeRemoteFilePath(config.remoteFilePath);

  return {
    ...config,
    provider,
    endpoint,
    region: normalizeObjectStorageRegion(provider, config.region, endpoint),
    bucket: normalizeObjectStorageBucket(config.bucket),
    accessKeyId: config.accessKeyId.trim(),
    accessKeySecret: config.accessKeySecret,
    remoteFilePath,
    retainedVersions: normalizeRetainedVersions(config.retainedVersions),
    forcePathStyle: provider === 's3-compatible' ? Boolean(config.forcePathStyle) : false
  };
}

function readObjectStorageSecretFromSession(provider: BackupObjectStorageProvider): string {
  try {
    return window.sessionStorage.getItem(getObjectStorageSecretSessionKey(provider)) || '';
  } catch {
    return '';
  }
}

function writeObjectStorageSecretToSession(
  provider: BackupObjectStorageProvider,
  secret: string
): void {
  try {
    const key = getObjectStorageSecretSessionKey(provider);
    if (secret) {
      window.sessionStorage.setItem(key, secret);
      return;
    }
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

export function saveObjectStorageConfig(config: BackupObjectStorageConfig): void {
  const sanitized = sanitizeObjectStorageConfig(config);
  writeObjectStorageSecretToSession(sanitized.provider, sanitized.accessKeySecret);
  window.localStorage.setItem(
    getObjectStorageConfigKey(sanitized.provider),
    JSON.stringify({
      ...sanitized,
      accessKeySecret: ''
    })
  );
}

export function loadObjectStorageConfig(
  provider: BackupObjectStorageProvider
): BackupObjectStorageConfig {
  const defaults = getDefaultObjectStorageConfig(provider);
  try {
    const raw = window.localStorage.getItem(getObjectStorageConfigKey(provider));
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<BackupObjectStorageConfig>;
    return sanitizeObjectStorageConfig({
      ...defaults,
      provider,
      endpoint: String(parsed.endpoint || defaults.endpoint),
      region: String(parsed.region || defaults.region),
      bucket: String(parsed.bucket || defaults.bucket),
      accessKeyId: String(parsed.accessKeyId || defaults.accessKeyId),
      accessKeySecret:
        readObjectStorageSecretFromSession(provider) ||
        String(parsed.accessKeySecret || defaults.accessKeySecret),
      remoteFilePath: String(parsed.remoteFilePath || defaults.remoteFilePath),
      retainedVersions: Number(parsed.retainedVersions || defaults.retainedVersions),
      forcePathStyle:
        typeof parsed.forcePathStyle === 'boolean' ? parsed.forcePathStyle : defaults.forcePathStyle
    });
  } catch {
    return defaults;
  }
}

export type FinanceBackupData = Required<FinanceDataSnapshot> & {
  globalMemories: GlobalMemoryItem[];
};

export interface FinanceBackupScope {
  ledger: boolean;
  subscriptions: boolean;
  globalMemories: boolean;
}

export interface FinanceBackupPayload {
  version: number;
  exportedAt: string;
  scope: FinanceBackupScope;
  data: FinanceBackupData;
}

type FinanceBackupSnapshotWithMemories = Required<FinanceDataSnapshot> & {
  globalMemories: GlobalMemoryItem[];
};

export function createDefaultFinanceBackupScope(): FinanceBackupScope {
  return {
    ledger: true,
    subscriptions: true,
    globalMemories: true
  };
}

export function normalizeFinanceBackupScope(
  scope?: Partial<FinanceBackupScope> | null
): FinanceBackupScope {
  const defaults = createDefaultFinanceBackupScope();
  const safeScope =
    scope && typeof scope === 'object' ? (scope as Partial<FinanceBackupScope>) : undefined;

  return {
    ledger: safeScope?.ledger ?? defaults.ledger,
    subscriptions: safeScope?.subscriptions ?? defaults.subscriptions,
    globalMemories: safeScope?.globalMemories ?? defaults.globalMemories
  };
}

const TRANSACTION_TYPES = new Set<TransactionItem['type']>([
  'expense',
  'income',
  'budget',
  'repayment'
]);
const TRANSACTION_SOURCES = new Set<NonNullable<TransactionItem['source']>>([
  'manual',
  'wechat',
  'alipay',
  'ai'
]);
const TRANSACTION_STATUS = new Set<NonNullable<TransactionItem['status']>>([
  'pending',
  'completed',
  'refunded',
  'closed',
  'failed'
]);
const TRANSACTION_ADJUSTMENT_KINDS = new Set<NonNullable<TransactionItem['adjustmentKind']>>([
  'normal',
  'refund',
  'reversal'
]);
const CATEGORY_KINDS = new Set<NonNullable<Category['kind']>>(['income', 'expense']);
const ACCOUNT_TYPES = new Set<NonNullable<Account['type']>>([
  'cash',
  'debit',
  'savings',
  'credit',
  'virtual',
  'liability',
  'receivable'
]);

const SUBSCRIPTION_KINDS = new Set<SubscriptionKind>(['digital', 'mobile', 'membership', 'other']);
const SUBSCRIPTION_BILLING_CYCLES = new Set<SubscriptionBillingCycle>([
  'monthly',
  'quarterly',
  'semiannual',
  'yearly',
  'custom'
]);
const SUBSCRIPTION_STATUS = new Set<SubscriptionStatus>([
  'active',
  'due-soon',
  'expired',
  'paused'
]);
const BALANCE_CHANGE_TYPES = new Set<BalanceChangeEntry['type']>([
  'transaction-income',
  'transaction-expense',
  'transaction-budget',
  'transaction-repayment',
  'transaction-refund',
  'manual-adjustment'
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSafeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertString(
  value: unknown,
  path: string,
  { required = true }: { required?: boolean } = {}
) {
  if (typeof value === 'string') {
    return;
  }
  if (!required && (value === undefined || value === null)) {
    return;
  }
  throw new Error(`备份文件字段无效：${path} 应为字符串`);
}

function assertNumber(value: unknown, path: string): asserts value is number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return;
  }
  throw new Error(`备份文件字段无效：${path} 应为有限数字`);
}

function assertDateString(
  value: unknown,
  path: string,
  { required = true }: { required?: boolean } = {}
) {
  if (!required && (value === undefined || value === null)) {
    return;
  }
  assertString(value, path, { required });
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) {
    throw new Error(`备份文件字段无效：${path} 应为日期字符串（YYYY-MM-DD）`);
  }
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`备份文件字段无效：${path} 应为字符串数组`);
  }
}

function validateTransactionAttachmentItem(
  item: unknown,
  transactionIndex: number,
  attachmentIndex: number
): TransactionAttachmentItem {
  if (!isObjectRecord(item)) {
    throw new Error(
      `澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.transactions[${transactionIndex}].attachments[${attachmentIndex}] 搴斾负瀵硅薄`
    );
  }

  assertString(
    item.id,
    `data.transactions[${transactionIndex}].attachments[${attachmentIndex}].id`
  );
  assertString(
    item.name,
    `data.transactions[${transactionIndex}].attachments[${attachmentIndex}].name`
  );
  assertString(
    item.remotePath,
    `data.transactions[${transactionIndex}].attachments[${attachmentIndex}].remotePath`
  );
  assertDateString(
    item.uploadedAt,
    `data.transactions[${transactionIndex}].attachments[${attachmentIndex}].uploadedAt`
  );
  assertString(
    item.mimeType,
    `data.transactions[${transactionIndex}].attachments[${attachmentIndex}].mimeType`,
    { required: false }
  );
  if (item.size !== undefined) {
    assertNumber(
      item.size,
      `data.transactions[${transactionIndex}].attachments[${attachmentIndex}].size`
    );
  }

  return {
    id: asSafeString(item.id),
    name: asSafeString(item.name),
    remotePath: asSafeString(item.remotePath),
    uploadedAt: asSafeString(item.uploadedAt),
    mimeType: asSafeString(item.mimeType) || undefined,
    size: typeof item.size === 'number' ? Number(item.size) : undefined
  };
}

function validateTransactionItem(item: unknown, index: number): TransactionItem {
  if (!isObjectRecord(item)) {
    throw new Error(`备份文件字段无效：data.transactions[${index}] 应为对象`);
  }

  assertString(item.id, `data.transactions[${index}].id`);
  assertString(item.categoryId, `data.transactions[${index}].categoryId`);
  assertString(item.accountId, `data.transactions[${index}].accountId`);
  assertString(item.note, `data.transactions[${index}].note`);
  assertDateString(item.date, `data.transactions[${index}].date`);
  assertNumber(item.amount, `data.transactions[${index}].amount`);
  assertStringArray(item.tags, `data.transactions[${index}].tags`);

  if (
    typeof item.type !== 'string' ||
    !TRANSACTION_TYPES.has(item.type as TransactionItem['type'])
  ) {
    throw new Error(`备份文件字段无效：data.transactions[${index}].type 枚举值不合法`);
  }

  if (
    item.source !== undefined &&
    (typeof item.source !== 'string' ||
      !TRANSACTION_SOURCES.has(item.source as NonNullable<TransactionItem['source']>))
  ) {
    throw new Error(`备份文件字段无效：data.transactions[${index}].source 枚举值不合法`);
  }

  if (
    item.status !== undefined &&
    (typeof item.status !== 'string' ||
      !TRANSACTION_STATUS.has(item.status as NonNullable<TransactionItem['status']>))
  ) {
    throw new Error(`备份文件字段无效：data.transactions[${index}].status 枚举值不合法`);
  }

  assertString(item.orderNo, `data.transactions[${index}].orderNo`, { required: false });
  assertString(item.merchantOrderNo, `data.transactions[${index}].merchantOrderNo`, {
    required: false
  });
  assertString(item.refundOfTransactionId, `data.transactions[${index}].refundOfTransactionId`, {
    required: false
  });
  assertDateString(item.updatedAt, `data.transactions[${index}].updatedAt`, { required: false });
  assertDateString(item.trashedAt, `data.transactions[${index}].trashedAt`, { required: false });

  if (
    item.adjustmentKind !== undefined &&
    (typeof item.adjustmentKind !== 'string' ||
      !TRANSACTION_ADJUSTMENT_KINDS.has(
        item.adjustmentKind as NonNullable<TransactionItem['adjustmentKind']>
      ))
  ) {
    throw new Error(
      `澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.transactions[${index}].adjustmentKind 鏋氫妇鍊间笉鍚堟硶`
    );
  }

  const attachments = item.attachments;
  if (attachments !== undefined && !Array.isArray(attachments)) {
    throw new Error(
      `澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.transactions[${index}].attachments 搴斾负鏁扮粍`
    );
  }

  return {
    id: asSafeString(item.id),
    type: item.type as TransactionItem['type'],
    categoryId: asSafeString(item.categoryId),
    accountId: asSafeString(item.accountId),
    amount: Number(item.amount),
    date: asSafeString(item.date),
    note: asSafeString(item.note),
    tags: (item.tags as string[]).map((tag) => tag.trim()).filter(Boolean),
    source: item.source as TransactionItem['source'] | undefined,
    orderNo: asSafeString(item.orderNo) || undefined,
    merchantOrderNo: asSafeString(item.merchantOrderNo) || undefined,
    status: item.status as TransactionItem['status'] | undefined,
    adjustmentKind: item.adjustmentKind as TransactionItem['adjustmentKind'] | undefined,
    refundOfTransactionId: asSafeString(item.refundOfTransactionId) || undefined,
    attachments: Array.isArray(attachments)
      ? attachments.map((entry, attachmentIndex) =>
          validateTransactionAttachmentItem(entry, index, attachmentIndex)
        )
      : undefined,
    updatedAt: asSafeString(item.updatedAt) || undefined,
    trashedAt: asSafeString(item.trashedAt) || undefined
  };
}

function validateCategoryItem(item: unknown, index: number): Category {
  if (!isObjectRecord(item)) {
    throw new Error(`备份文件字段无效：data.categories[${index}] 应为对象`);
  }

  assertString(item.id, `data.categories[${index}].id`);
  assertString(item.name, `data.categories[${index}].name`);
  assertString(item.color, `data.categories[${index}].color`, { required: false });
  assertString(item.icon, `data.categories[${index}].icon`, { required: false });

  if (item.sortOrder !== undefined) {
    assertNumber(item.sortOrder, `data.categories[${index}].sortOrder`);
  }
  assertDateString(item.trashedAt, `data.categories[${index}].trashedAt`, { required: false });

  if (
    item.kind !== undefined &&
    (typeof item.kind !== 'string' ||
      !CATEGORY_KINDS.has(item.kind as NonNullable<Category['kind']>))
  ) {
    throw new Error(`备份文件字段无效：data.categories[${index}].kind 枚举值不合法`);
  }

  return {
    id: asSafeString(item.id),
    name: asSafeString(item.name),
    kind: item.kind as Category['kind'] | undefined,
    color: asSafeString(item.color) || undefined,
    icon: asSafeString(item.icon) || undefined,
    sortOrder: typeof item.sortOrder === 'number' ? Number(item.sortOrder) : undefined,
    trashedAt: asSafeString(item.trashedAt) || undefined
  };
}

function validateAccountItem(item: unknown, index: number): Account {
  if (!isObjectRecord(item)) {
    throw new Error(`备份文件字段无效：data.accounts[${index}] 应为对象`);
  }

  assertString(item.id, `data.accounts[${index}].id`);
  assertString(item.name, `data.accounts[${index}].name`);

  if (item.initialBalance !== undefined) {
    assertNumber(item.initialBalance, `data.accounts[${index}].initialBalance`);
  }
  if (item.balance !== undefined) {
    assertNumber(item.balance, `data.accounts[${index}].balance`);
  }
  if (item.sortOrder !== undefined) {
    assertNumber(item.sortOrder, `data.accounts[${index}].sortOrder`);
  }
  assertDateString(item.trashedAt, `data.accounts[${index}].trashedAt`, { required: false });

  if (
    item.type !== undefined &&
    (typeof item.type !== 'string' || !ACCOUNT_TYPES.has(item.type as NonNullable<Account['type']>))
  ) {
    throw new Error(`备份文件字段无效：data.accounts[${index}].type 枚举值不合法`);
  }

  return {
    id: asSafeString(item.id),
    name: asSafeString(item.name),
    type: item.type as Account['type'] | undefined,
    initialBalance:
      typeof item.initialBalance === 'number' ? Number(item.initialBalance) : undefined,
    balance: typeof item.balance === 'number' ? Number(item.balance) : undefined,
    sortOrder: typeof item.sortOrder === 'number' ? Number(item.sortOrder) : undefined,
    trashedAt: asSafeString(item.trashedAt) || undefined
  };
}

function validateBalanceChangeEntry(item: unknown, index: number): BalanceChangeEntry {
  if (!isObjectRecord(item)) {
    throw new Error(`澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.balanceChangeEntries[${index}] 搴斾负瀵硅薄`);
  }

  assertString(item.id, `data.balanceChangeEntries[${index}].id`);
  assertString(item.accountId, `data.balanceChangeEntries[${index}].accountId`);
  assertNumber(item.amount, `data.balanceChangeEntries[${index}].amount`);
  assertNumber(item.beforeBalance, `data.balanceChangeEntries[${index}].beforeBalance`);
  assertNumber(item.afterBalance, `data.balanceChangeEntries[${index}].afterBalance`);
  assertDateString(item.createdAt, `data.balanceChangeEntries[${index}].createdAt`);
  assertString(item.transactionId, `data.balanceChangeEntries[${index}].transactionId`, {
    required: false
  });
  assertString(
    item.relatedTransactionId,
    `data.balanceChangeEntries[${index}].relatedTransactionId`,
    { required: false }
  );
  assertString(item.note, `data.balanceChangeEntries[${index}].note`, { required: false });
  assertString(item.remark, `data.balanceChangeEntries[${index}].remark`, { required: false });

  if (
    typeof item.type !== 'string' ||
    !BALANCE_CHANGE_TYPES.has(item.type as BalanceChangeEntry['type'])
  ) {
    throw new Error(
      `澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.balanceChangeEntries[${index}].type 鏋氫妇鍊间笉鍚堟硶`
    );
  }

  return {
    id: asSafeString(item.id),
    accountId: asSafeString(item.accountId),
    transactionId: asSafeString(item.transactionId) || undefined,
    relatedTransactionId: asSafeString(item.relatedTransactionId) || undefined,
    type: item.type as BalanceChangeEntry['type'],
    amount: Number(item.amount),
    beforeBalance: Number(item.beforeBalance),
    afterBalance: Number(item.afterBalance),
    createdAt: asSafeString(item.createdAt),
    note: asSafeString(item.note) || undefined,
    remark: asSafeString(item.remark) || undefined
  };
}

function validateSubscriptionItem(item: unknown, index: number): SubscriptionItem {
  if (!isObjectRecord(item)) {
    throw new Error(`备份文件字段无效：data.subscriptions[${index}] 应为对象`);
  }

  assertString(item.id, `data.subscriptions[${index}].id`);
  assertString(item.name, `data.subscriptions[${index}].name`);
  assertNumber(item.amount, `data.subscriptions[${index}].amount`);
  assertString(item.currency, `data.subscriptions[${index}].currency`);
  assertString(item.createdAt, `data.subscriptions[${index}].createdAt`);
  assertString(item.updatedAt, `data.subscriptions[${index}].updatedAt`);
  assertString(item.accountId, `data.subscriptions[${index}].accountId`, { required: false });
  assertString(item.provider, `data.subscriptions[${index}].provider`, { required: false });
  assertString(item.note, `data.subscriptions[${index}].note`, { required: false });
  assertDateString(item.renewalDate, `data.subscriptions[${index}].renewalDate`, {
    required: false
  });
  assertDateString(item.expireDate, `data.subscriptions[${index}].expireDate`, { required: false });
  assertDateString(item.lastGeneratedAt, `data.subscriptions[${index}].lastGeneratedAt`, {
    required: false
  });
  assertString(
    item.lastGeneratedTransactionId,
    `data.subscriptions[${index}].lastGeneratedTransactionId`,
    {
      required: false
    }
  );
  assertDateString(item.trashedAt, `data.subscriptions[${index}].trashedAt`, { required: false });

  if (typeof item.kind !== 'string' || !SUBSCRIPTION_KINDS.has(item.kind as SubscriptionKind)) {
    throw new Error(`备份文件字段无效：data.subscriptions[${index}].kind 枚举值不合法`);
  }

  if (
    typeof item.billingCycle !== 'string' ||
    !SUBSCRIPTION_BILLING_CYCLES.has(item.billingCycle as SubscriptionBillingCycle)
  ) {
    throw new Error(`备份文件字段无效：data.subscriptions[${index}].billingCycle 枚举值不合法`);
  }

  if (
    typeof item.status !== 'string' ||
    !SUBSCRIPTION_STATUS.has(item.status as SubscriptionStatus)
  ) {
    throw new Error(`备份文件字段无效：data.subscriptions[${index}].status 枚举值不合法`);
  }

  if (item.customCycleDays !== undefined) {
    assertNumber(item.customCycleDays, `data.subscriptions[${index}].customCycleDays`);
  }

  if (item.autoRenew !== undefined && typeof item.autoRenew !== 'boolean') {
    throw new Error(`备份文件字段无效：data.subscriptions[${index}].autoRenew 应为布尔值`);
  }

  return {
    id: asSafeString(item.id),
    name: asSafeString(item.name),
    kind: item.kind as SubscriptionKind,
    amount: Number(item.amount),
    currency: asSafeString(item.currency),
    billingCycle: item.billingCycle as SubscriptionBillingCycle,
    customCycleDays:
      typeof item.customCycleDays === 'number' ? Number(item.customCycleDays) : undefined,
    accountId: asSafeString(item.accountId) || undefined,
    provider: asSafeString(item.provider) || undefined,
    note: asSafeString(item.note) || undefined,
    renewalDate: asSafeString(item.renewalDate) || undefined,
    expireDate: asSafeString(item.expireDate) || undefined,
    autoRenew: typeof item.autoRenew === 'boolean' ? item.autoRenew : undefined,
    status: item.status as SubscriptionStatus,
    lastGeneratedAt: asSafeString(item.lastGeneratedAt) || undefined,
    lastGeneratedTransactionId: asSafeString(item.lastGeneratedTransactionId) || undefined,
    trashedAt: asSafeString(item.trashedAt) || undefined,
    createdAt: asSafeString(item.createdAt),
    updatedAt: asSafeString(item.updatedAt)
  };
}

export function createFinanceBackupPayload(
  input: FinanceDataSnapshot & {
    globalMemories?: GlobalMemoryItem[];
  },
  scope?: Partial<FinanceBackupScope> | null
): FinanceBackupPayload {
  const normalizedScope = normalizeFinanceBackupScope(scope);

  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    scope: normalizedScope,
    data: {
      transactions: normalizedScope.ledger ? input.transactions : [],
      categories: normalizedScope.ledger ? input.categories : [],
      accounts: normalizedScope.ledger ? input.accounts : [],
      subscriptions:
        normalizedScope.subscriptions && Array.isArray(input.subscriptions)
          ? input.subscriptions
          : [],
      trashedTransactions:
        normalizedScope.ledger && Array.isArray(input.trashedTransactions)
          ? input.trashedTransactions
          : [],
      trashedCategories:
        normalizedScope.ledger && Array.isArray(input.trashedCategories)
          ? input.trashedCategories
          : [],
      trashedAccounts:
        normalizedScope.ledger && Array.isArray(input.trashedAccounts) ? input.trashedAccounts : [],
      balanceChangeEntries:
        normalizedScope.ledger && Array.isArray(input.balanceChangeEntries)
          ? input.balanceChangeEntries
          : [],
      trashedSubscriptions:
        normalizedScope.subscriptions && Array.isArray(input.trashedSubscriptions)
          ? input.trashedSubscriptions
          : [],
      globalMemories:
        normalizedScope.globalMemories && Array.isArray(input.globalMemories)
          ? input.globalMemories
          : []
    }
  };
}

export function parseFinanceBackupPayload(raw: string): FinanceBackupPayload {
  const normalizedRaw = raw.replace(/^\uFEFF/, '').trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(normalizedRaw);
  } catch {
    throw new Error('备份文件格式无效：JSON 解析失败');
  }

  if (!isObjectRecord(parsed)) {
    throw new Error('备份文件格式无效');
  }

  const data = parsed.data;
  if (!isObjectRecord(data)) {
    throw new Error('备份文件缺少 data 字段');
  }

  if (
    !Array.isArray(data.transactions) ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.accounts)
  ) {
    throw new Error('备份文件缺少必要数据（transactions/categories/accounts）');
  }

  if (data.subscriptions !== undefined && !Array.isArray(data.subscriptions)) {
    throw new Error('备份文件字段无效：data.subscriptions 应为数组');
  }

  if (data.trashedTransactions !== undefined && !Array.isArray(data.trashedTransactions)) {
    throw new Error('澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.trashedTransactions 搴斾负鏁扮粍');
  }

  if (data.trashedCategories !== undefined && !Array.isArray(data.trashedCategories)) {
    throw new Error('澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.trashedCategories 搴斾负鏁扮粍');
  }

  if (data.trashedAccounts !== undefined && !Array.isArray(data.trashedAccounts)) {
    throw new Error('澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.trashedAccounts 搴斾负鏁扮粍');
  }

  if (data.balanceChangeEntries !== undefined && !Array.isArray(data.balanceChangeEntries)) {
    throw new Error('澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.balanceChangeEntries 搴斾负鏁扮粍');
  }

  if (data.trashedSubscriptions !== undefined && !Array.isArray(data.trashedSubscriptions)) {
    throw new Error('澶囦唤鏂囦欢瀛楁鏃犳晥锛歞ata.trashedSubscriptions 搴斾负鏁扮粍');
  }

  if (data.globalMemories !== undefined && !Array.isArray(data.globalMemories)) {
    throw new Error('备份文件字段无效：data.globalMemories 应为数组');
  }

  const transactions = data.transactions.map((item, index) => validateTransactionItem(item, index));
  const categories = data.categories.map((item, index) => validateCategoryItem(item, index));
  const accounts = data.accounts.map((item, index) => validateAccountItem(item, index));
  const subscriptions = (Array.isArray(data.subscriptions) ? data.subscriptions : []).map(
    (item, index) => validateSubscriptionItem(item, index)
  );
  const trashedTransactions = (
    Array.isArray(data.trashedTransactions) ? data.trashedTransactions : []
  ).map((item, index) => validateTransactionItem(item, index));
  const trashedCategories = (
    Array.isArray(data.trashedCategories) ? data.trashedCategories : []
  ).map((item, index) => validateCategoryItem(item, index));
  const trashedAccounts = (Array.isArray(data.trashedAccounts) ? data.trashedAccounts : []).map(
    (item, index) => validateAccountItem(item, index)
  );
  const balanceChangeEntries = (
    Array.isArray(data.balanceChangeEntries) ? data.balanceChangeEntries : []
  ).map((item, index) => validateBalanceChangeEntry(item, index));
  const trashedSubscriptions = (
    Array.isArray(data.trashedSubscriptions) ? data.trashedSubscriptions : []
  ).map((item, index) => validateSubscriptionItem(item, index));
  const globalMemories = (Array.isArray(data.globalMemories) ? data.globalMemories : [])
    .map((item, index) => sanitizePersistedGlobalMemoryItem(item, index))
    .filter((item): item is GlobalMemoryItem => Boolean(item));
  const scope = normalizeFinanceBackupScope(
    isObjectRecord(parsed.scope) ? (parsed.scope as Partial<FinanceBackupScope>) : undefined
  );

  return {
    version:
      typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : 1,
    exportedAt:
      typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    scope,
    data: {
      transactions,
      categories,
      accounts,
      subscriptions,
      trashedTransactions,
      trashedCategories,
      trashedAccounts,
      balanceChangeEntries,
      trashedSubscriptions,
      globalMemories
    }
  };
}

export function applyFinanceBackupPayload(
  current: FinanceBackupSnapshotWithMemories,
  payload: FinanceBackupPayload
): FinanceBackupSnapshotWithMemories {
  const scope = normalizeFinanceBackupScope(payload.scope);

  return {
    transactions: scope.ledger ? payload.data.transactions : current.transactions,
    categories: scope.ledger ? payload.data.categories : current.categories,
    accounts: scope.ledger ? payload.data.accounts : current.accounts,
    subscriptions: scope.subscriptions ? payload.data.subscriptions : current.subscriptions,
    trashedTransactions: scope.ledger
      ? payload.data.trashedTransactions
      : current.trashedTransactions,
    trashedCategories: scope.ledger ? payload.data.trashedCategories : current.trashedCategories,
    trashedAccounts: scope.ledger ? payload.data.trashedAccounts : current.trashedAccounts,
    balanceChangeEntries: scope.ledger
      ? payload.data.balanceChangeEntries
      : current.balanceChangeEntries,
    trashedSubscriptions: scope.subscriptions
      ? payload.data.trashedSubscriptions
      : current.trashedSubscriptions,
    globalMemories: scope.globalMemories ? payload.data.globalMemories : current.globalMemories
  };
}

export function downloadBackupJson(payload: FinanceBackupPayload): void {
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = payload.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ledgerflow-backup-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function readWebdavPasswordFromSession(): string {
  try {
    return window.sessionStorage.getItem(BACKUP_PASSWORD_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

function writeWebdavPasswordToSession(password: string): void {
  try {
    if (password) {
      window.sessionStorage.setItem(BACKUP_PASSWORD_SESSION_KEY, password);
      return;
    }
    window.sessionStorage.removeItem(BACKUP_PASSWORD_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

export function saveWebdavConfig(config: BackupWebdavConfig): void {
  const sanitized = sanitizeWebdavConfig(config);
  writeWebdavPasswordToSession(sanitized.password);
  window.localStorage.setItem(
    BACKUP_KEY,
    JSON.stringify({
      ...sanitized,
      password: ''
    })
  );
}

export function loadWebdavConfig(): BackupWebdavConfig {
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) {
      return {
        endpoint: '',
        username: '',
        password: '',
        remoteFilePath: 'ledgerflow/backup.json',
        retainedVersions: 5,
        proxyEnabled: true,
        proxyBasePath: '/api/webdav'
      };
    }
    const parsed = JSON.parse(raw) as Partial<BackupWebdavConfig>;
    return sanitizeWebdavConfig({
      endpoint: String(parsed.endpoint || ''),
      username: String(parsed.username || ''),
      password: readWebdavPasswordFromSession() || String(parsed.password || ''),
      remoteFilePath: String(parsed.remoteFilePath || 'ledgerflow/backup.json'),
      retainedVersions: Number(parsed.retainedVersions || 5),
      proxyEnabled: parsed.proxyEnabled !== false,
      proxyBasePath: String(parsed.proxyBasePath || '/api/webdav')
    });
  } catch {
    return {
      endpoint: '',
      username: '',
      password: '',
      remoteFilePath: 'ledgerflow/backup.json',
      retainedVersions: 5,
      proxyEnabled: true,
      proxyBasePath: '/api/webdav'
    };
  }
}

function joinWebdavPath(config: BackupWebdavConfig, remoteFilePath: string): string {
  const path = normalizeRemoteFilePath(remoteFilePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  if (config.proxyEnabled) {
    const proxyBase = normalizeProxyBasePath(config.proxyBasePath);
    return `${proxyBase}/${path}`;
  }

  const base = normalizeWebdavEndpoint(config.endpoint);
  return `${base}/${path}`;
}

function joinRemoteWebdavPath(config: BackupWebdavConfig, remoteFilePath: string): string {
  const path = normalizeRemoteFilePath(remoteFilePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const base = normalizeWebdavEndpoint(config.endpoint);
  return `${base}/${path}`;
}

function buildTemporaryUploadPath(remoteFilePath: string, seed = Date.now()): string {
  const { dir, file } = splitRemoteDirAndFile(remoteFilePath);
  const suffix = Math.random().toString(36).slice(2, 8);
  const temporaryFile = `.${file}.uploading-${seed}-${suffix}.tmp`;
  return dir ? `${dir}/${temporaryFile}` : temporaryFile;
}

function buildWebdavHeaders(
  config: BackupWebdavConfig,
  extra?: Record<string, string>
): Record<string, string> {
  const sanitized = sanitizeWebdavConfig(config);
  const headers: Record<string, string> = {
    Authorization: buildBasicAuth(sanitized.username, sanitized.password),
    ...extra
  };

  if (sanitized.proxyEnabled) {
    headers['X-WebDAV-Endpoint'] = sanitized.endpoint;
  }

  return headers;
}

function normalizeWebdavError(action: '上传' | '下载' | '创建目录', error: unknown): Error {
  if (error instanceof Error) {
    if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
      return new Error(
        `WebDAV ${action}失败：请求被浏览器拦截（常见于跨域 CORS / HTTPS 混合内容）。` +
          `可尝试将 endpoint 改为同源代理地址（例如 /api/webdav）并在服务端转发到真实 WebDAV。`
      );
    }
    return error;
  }
  return new Error(`WebDAV ${action}失败，请稍后重试`);
}

async function ensureWebdavDirectoriesByPath(
  config: BackupWebdavConfig,
  remoteFilePath: string
): Promise<void> {
  const normalizedPath = remoteFilePath.replace(/^\/+/, '').split('/').filter(Boolean);
  if (normalizedPath.length <= 1) {
    return;
  }

  const folders = normalizedPath.slice(0, -1);
  let current = '';
  for (const segment of folders) {
    current = current ? `${current}/${segment}` : segment;
    let response: Response;
    try {
      response = await fetch(joinWebdavPath(config, current), {
        method: 'MKCOL',
        headers: buildWebdavHeaders(config)
      });
    } catch {
      // 某些 WebDAV 服务不允许跨域 MKCOL（但允许 PUT），目录创建失败时交给后续 PUT 决定。
      continue;
    }

    if (![200, 201, 204, 301, 302, 400, 403, 405, 409].includes(response.status)) {
      throw new Error(`WebDAV 目录创建失败（${current}，HTTP ${response.status}）`);
    }
  }
}

function buildVersionedBackupPath(remoteFilePath: string, exportedAt: string): string {
  const normalizedPath = normalizeRemoteFilePath(remoteFilePath);
  const parts = normalizedPath.split('/');
  const fileName = parts.pop() || 'backup.json';
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : '.json';
  const stamp = exportedAt.slice(0, 19).replace(/:/g, '-').replace('T', '_');
  return [...parts, `${baseName}-${stamp}${ext}`].join('/');
}

function splitRemoteDirAndFile(remoteFilePath: string): { dir: string; file: string } {
  const normalizedPath = normalizeRemoteFilePath(remoteFilePath);
  const parts = normalizedPath.split('/');
  const file = parts.pop() || normalizedPath;
  return { dir: parts.join('/'), file };
}

function buildBackupFileMatchers(remoteFilePath: string): {
  targetFile: string;
  versionedPattern: RegExp;
} {
  const { file: targetFile } = splitRemoteDirAndFile(remoteFilePath);
  const dotIndex = targetFile.lastIndexOf('.');
  const baseName = dotIndex > 0 ? targetFile.slice(0, dotIndex) : targetFile;
  const ext = dotIndex > 0 ? targetFile.slice(dotIndex) : '.json';
  return {
    targetFile,
    versionedPattern: new RegExp(
      `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}${ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
    )
  };
}

function isBackupCandidateMatch(candidatePath: string, remoteFilePath: string): boolean {
  const candidate = normalizeRemoteFilePath(candidatePath);
  const target = normalizeRemoteFilePath(remoteFilePath);
  const candidateParts = candidate.split('/');
  const targetParts = target.split('/');
  const candidateFile = candidateParts.pop() || '';
  const targetFile = targetParts.pop() || '';
  const { versionedPattern } = buildBackupFileMatchers(remoteFilePath);

  if (candidateParts.join('/') === targetParts.join('/')) {
    if (candidateFile === targetFile) {
      return true;
    }
    if (versionedPattern.test(candidateFile)) {
      return true;
    }
  }

  return candidateFile === targetFile || versionedPattern.test(candidateFile);
}

function isVersionedBackupMatch(candidatePath: string, remoteFilePath: string): boolean {
  const candidate = normalizeRemoteFilePath(candidatePath);
  const candidateFile = candidate.split('/').pop() || '';
  const { targetFile, versionedPattern } = buildBackupFileMatchers(remoteFilePath);
  if (candidateFile === targetFile) {
    return false;
  }
  return versionedPattern.test(candidateFile);
}

function extractHrefText(value: string): string {
  return value.replace(/&amp;/g, '&').trim();
}

function resolveRemotePathFromHref(href: string, endpoint: string, remoteFilePath: string): string {
  const parsed = new URL(href, endpoint);
  const endpointUrl = new URL(endpoint);
  const decodedPath = decodeURIComponent(parsed.pathname);
  const endpointPath = decodeURIComponent(endpointUrl.pathname).replace(/\/+$/, '');

  if (decodedPath.startsWith(`${endpointPath}/`)) {
    return normalizeRemoteFilePath(decodedPath.slice(endpointPath.length + 1));
  }

  const { dir } = splitRemoteDirAndFile(remoteFilePath);
  const dirSegments = dir ? dir.split('/') : [];
  const pathSegments = decodedPath.split('/').filter(Boolean);
  const startIndex = dirSegments.length > 0 ? pathSegments.lastIndexOf(dirSegments[0]) : -1;

  if (startIndex >= 0) {
    return normalizeRemoteFilePath(pathSegments.slice(startIndex).join('/'));
  }

  return normalizeRemoteFilePath(
    pathSegments.slice(-((dir ? dirSegments.length : 0) + 1)).join('/')
  );
}

function extractVersionedBackupPathsFromXml(text: string, remoteFilePath: string): string[] {
  const { dir } = splitRemoteDirAndFile(remoteFilePath);
  const normalizedDir = normalizeRemoteFilePath(dir);
  const { targetFile, versionedPattern } = buildBackupFileMatchers(remoteFilePath);
  const candidates = Array.from(new Set(text.match(/[^\s<>"']+/g) || []))
    .map((item) => extractHrefText(item))
    .map((item) => {
      try {
        return decodeURIComponent(item);
      } catch {
        return item;
      }
    });

  const matched = candidates
    .map((item) => item.split('?')[0].split('#')[0])
    .map((item) => item.replace(/^.*\//, ''))
    .filter((fileName) => fileName === targetFile || versionedPattern.test(fileName))
    .map((fileName) => (normalizedDir ? `${normalizedDir}/${fileName}` : fileName));

  return Array.from(new Set(matched));
}

interface WebdavRemoteFileEntry {
  remotePath: string;
  updatedAt?: string;
}

function parseWebdavDate(value: string): string | undefined {
  const date = new Date(extractHrefText(value));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function extractWebdavRemoteFileEntriesFromXml(
  text: string,
  endpoint: string,
  remoteFilePath: string
): WebdavRemoteFileEntry[] {
  const responseMatches = Array.from(
    text.matchAll(
      /<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi
    )
  );

  return responseMatches
    .map((match): WebdavRemoteFileEntry | null => {
      const body = match[1] || '';
      const hrefMatch = body.match(
        /<(?:[A-Za-z0-9_-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?href>/i
      );
      if (!hrefMatch) {
        return null;
      }

      try {
        const remotePath = resolveRemotePathFromHref(
          extractHrefText(hrefMatch[1] || ''),
          endpoint,
          remoteFilePath
        );
        const updatedAtMatch = body.match(
          /<(?:[A-Za-z0-9_-]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?getlastmodified>/i
        );
        const updatedAt = updatedAtMatch ? parseWebdavDate(updatedAtMatch[1] || '') : undefined;
        return updatedAt ? { remotePath, updatedAt } : { remotePath };
      } catch {
        return null;
      }
    })
    .filter((item): item is WebdavRemoteFileEntry => item !== null);
}

async function listWebdavRemoteFileEntries(
  config: BackupWebdavConfig,
  remoteFilePath: string
): Promise<WebdavRemoteFileEntry[]> {
  const sanitized = sanitizeWebdavConfig(config);
  const { dir } = splitRemoteDirAndFile(remoteFilePath);
  const listTarget = dir || remoteFilePath;
  const response = await fetch(joinWebdavPath(sanitized, listTarget), {
    method: 'PROPFIND',
    headers: buildWebdavHeaders(sanitized, {
      Depth: '1'
    })
  });

  if (!response.ok) {
    throw new Error(`WebDAV 列目录失败（HTTP ${response.status}）`);
  }

  const text = await response.text();
  const entries = extractWebdavRemoteFileEntriesFromXml(text, sanitized.endpoint, remoteFilePath);

  const fallbackPaths = extractVersionedBackupPathsFromXml(text, remoteFilePath);
  const byPath = new Map<string, WebdavRemoteFileEntry>();
  entries.forEach((entry) => byPath.set(entry.remotePath, entry));
  fallbackPaths.forEach((remotePath) => {
    if (!byPath.has(remotePath)) {
      byPath.set(remotePath, { remotePath });
    }
  });

  return Array.from(byPath.values());
}

async function listWebdavRemoteFiles(
  config: BackupWebdavConfig,
  remoteFilePath: string
): Promise<string[]> {
  const entries = await listWebdavRemoteFileEntries(config, remoteFilePath);
  return entries.map((item) => item.remotePath);
}

async function deleteWebdavFile(config: BackupWebdavConfig, remoteFilePath: string): Promise<void> {
  const sanitized = sanitizeWebdavConfig(config);
  const response = await fetch(joinWebdavPath(sanitized, remoteFilePath), {
    method: 'DELETE',
    headers: buildWebdavHeaders(sanitized)
  });
  if (![200, 202, 204, 404].includes(response.status)) {
    throw new Error(`WebDAV 删除失败（${remoteFilePath}，HTTP ${response.status}）`);
  }
}

async function moveWebdavFile(
  config: BackupWebdavConfig,
  sourceRemotePath: string,
  targetRemotePath: string
): Promise<void> {
  const sanitized = sanitizeWebdavConfig(config);
  const response = await fetch(joinWebdavPath(sanitized, sourceRemotePath), {
    method: 'MOVE',
    headers: buildWebdavHeaders(sanitized, {
      Destination: joinRemoteWebdavPath(sanitized, targetRemotePath),
      Overwrite: 'T'
    })
  });

  if (![200, 201, 204].includes(response.status)) {
    throw new Error(`WebDAV 移动失败（${targetRemotePath}，HTTP ${response.status}）`);
  }
}

async function cleanupTemporaryWebdavFile(
  config: BackupWebdavConfig,
  temporaryRemotePath: string
): Promise<void> {
  try {
    await deleteWebdavFile(config, temporaryRemotePath);
  } catch {
    // 清理临时文件失败不覆盖原始上传错误。
  }
}

async function putWebdavFileAtomically(
  config: BackupWebdavConfig,
  remoteFilePath: string,
  body: BodyInit,
  contentType: string
): Promise<void> {
  const sanitized = sanitizeWebdavConfig(config);
  const normalizedRemotePath = normalizeRemoteFilePath(remoteFilePath);
  const temporaryRemotePath = buildTemporaryUploadPath(normalizedRemotePath);

  await ensureWebdavDirectoriesByPath(sanitized, temporaryRemotePath);

  try {
    const response = await fetch(joinWebdavPath(sanitized, temporaryRemotePath), {
      method: 'PUT',
      headers: buildWebdavHeaders(sanitized, {
        'Content-Type': contentType
      }),
      body
    });

    if (!response.ok) {
      throw new Error(`WebDAV 上传失败（HTTP ${response.status}）`);
    }

    await moveWebdavFile(sanitized, temporaryRemotePath, normalizedRemotePath);
  } catch (error) {
    await cleanupTemporaryWebdavFile(sanitized, temporaryRemotePath);
    throw error;
  }
}

async function pruneWebdavBackupVersions(config: BackupWebdavConfig): Promise<void> {
  const sanitized = sanitizeWebdavConfig(config);
  const files = await listWebdavRemoteFiles(sanitized, sanitized.remoteFilePath);
  const matched = files
    .filter((item) => isVersionedBackupMatch(item, sanitized.remoteFilePath))
    .sort((a, b) => b.localeCompare(a, 'en'));
  const obsolete = matched.slice(sanitized.retainedVersions);
  await Promise.all(obsolete.map((item) => deleteWebdavFile(sanitized, item)));
}

export interface WebdavBackupVersionItem {
  remotePath: string;
  fileName: string;
  label: string;
  isLatest: boolean;
  /** ISO time when it can be inferred from the versioned file name or WebDAV metadata. */
  backupAt?: string;
}

function buildWebdavBackupVersionLabel(remotePath: string, baseRemoteFilePath: string): string {
  const normalized = normalizeRemoteFilePath(remotePath);
  const { file: targetFile } = splitRemoteDirAndFile(baseRemoteFilePath);
  const fileName = normalized.split('/').pop() || normalized;
  const dotIndex = targetFile.lastIndexOf('.');
  const baseName = dotIndex > 0 ? targetFile.slice(0, dotIndex) : targetFile;
  const stamp = fileName
    .replace(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`), '')
    .replace(/\.json$/i, '');
  const matched = stamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return fileName;
  }
  return `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}:${matched[6]}`;
}

function extractWebdavBackupVersionTime(
  remotePath: string,
  baseRemoteFilePath: string
): { label: string; backupAt: string } | null {
  const normalized = normalizeRemoteFilePath(remotePath);
  const { file: targetFile } = splitRemoteDirAndFile(baseRemoteFilePath);
  const fileName = normalized.split('/').pop() || normalized;
  const dotIndex = targetFile.lastIndexOf('.');
  const baseName = dotIndex > 0 ? targetFile.slice(0, dotIndex) : targetFile;
  const stamp = fileName
    .replace(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`), '')
    .replace(/\.json$/i, '');
  const matched = stamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }
  return {
    label: `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}:${matched[6]}`,
    backupAt: `${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}:${matched[5]}:${matched[6]}.000Z`
  };
}

function extractWebdavBackupVersionTimeLabel(
  remotePath: string,
  baseRemoteFilePath: string
): string | null {
  return extractWebdavBackupVersionTime(remotePath, baseRemoteFilePath)?.label || null;
}

export async function listWebdavBackupVersions(
  config: BackupWebdavConfig
): Promise<WebdavBackupVersionItem[]> {
  const sanitized = sanitizeWebdavConfig(config);
  try {
    const files = await listWebdavRemoteFileEntries(sanitized, sanitized.remoteFilePath);
    const matched = files
      .filter((item) => isBackupCandidateMatch(item.remotePath, sanitized.remoteFilePath))
      .sort((a, b) => b.remotePath.localeCompare(a.remotePath, 'en'));

    if (matched.length === 0) {
      const fixedEntry = files.find(
        (item) => normalizeRemoteFilePath(item.remotePath) === sanitized.remoteFilePath
      );
      return [
        {
          remotePath: sanitized.remoteFilePath,
          fileName: splitRemoteDirAndFile(sanitized.remoteFilePath).file,
          label: '当前固定备份文件',
          isLatest: true,
          backupAt: fixedEntry?.updatedAt
        }
      ];
    }

    const latestVersioned = matched.find((item) =>
      isVersionedBackupMatch(item.remotePath, sanitized.remoteFilePath)
    );
    const latestVersionedLabel = latestVersioned
      ? extractWebdavBackupVersionTimeLabel(latestVersioned.remotePath, sanitized.remoteFilePath)
      : null;
    const latestVersionedTime = latestVersioned
      ? extractWebdavBackupVersionTime(latestVersioned.remotePath, sanitized.remoteFilePath)
      : null;

    return matched.map((item, index) => {
      const fileName = item.remotePath.split('/').pop() || item.remotePath;
      const isFixedEntry = normalizeRemoteFilePath(item.remotePath) === sanitized.remoteFilePath;
      const versionTime = isFixedEntry
        ? latestVersionedTime
        : extractWebdavBackupVersionTime(item.remotePath, sanitized.remoteFilePath);
      return {
        remotePath: item.remotePath,
        fileName,
        label: isFixedEntry
          ? latestVersionedLabel
            ? `${latestVersionedLabel} · 固定入口`
            : '当前固定备份文件'
          : buildWebdavBackupVersionLabel(item.remotePath, sanitized.remoteFilePath),
        isLatest: index === 0,
        backupAt: versionTime?.backupAt || item.updatedAt
      };
    });
  } catch {
    return [
      {
        remotePath: sanitized.remoteFilePath,
        fileName: splitRemoteDirAndFile(sanitized.remoteFilePath).file,
        label: '当前固定备份文件（目录列表不可用）',
        isLatest: true
      }
    ];
  }
}

async function resolveLatestWebdavBackupPath(config: BackupWebdavConfig): Promise<string> {
  const sanitized = sanitizeWebdavConfig(config);
  try {
    const files = await listWebdavRemoteFiles(sanitized, sanitized.remoteFilePath);
    const matched = files
      .filter((item) => isVersionedBackupMatch(item, sanitized.remoteFilePath))
      .sort((a, b) => b.localeCompare(a, 'en'));
    if (matched.length > 0) {
      return matched[0];
    }
  } catch {
    // 某些 WebDAV / 代理不支持 PROPFIND，回退到固定路径下载。
  }
  return sanitized.remoteFilePath;
}

function buildBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return `Basic ${window.btoa(binary)}`;
}

export async function webdavUploadBackup(
  config: BackupWebdavConfig,
  payload: FinanceBackupPayload,
  onProgress?: (stage: string) => void
): Promise<void> {
  try {
    const sanitized = sanitizeWebdavConfig(config);
    onProgress?.('准备 WebDAV 备份...');
    const versionedRemotePath = buildVersionedBackupPath(
      sanitized.remoteFilePath,
      payload.exportedAt
    );
    const latestRemotePath = sanitized.remoteFilePath;
    await ensureWebdavDirectoriesByPath(sanitized, versionedRemotePath);
    const body = JSON.stringify(payload, null, 2);
    onProgress?.('上传版本备份...');
    await putWebdavFileAtomically(
      sanitized,
      versionedRemotePath,
      body,
      'application/json;charset=utf-8'
    );

    if (latestRemotePath !== versionedRemotePath) {
      await ensureWebdavDirectoriesByPath(sanitized, latestRemotePath);
      onProgress?.('更新最新版本...');
      await putWebdavFileAtomically(
        sanitized,
        latestRemotePath,
        body,
        'application/json;charset=utf-8'
      );
    }

    try {
      onProgress?.('清理旧版本...');
      await pruneWebdavBackupVersions(sanitized);
    } catch {
      // 版本清理失败不阻断主上传成功，避免代理 / WebDAV 实现差异导致上传整体失败。
    }
  } catch (error) {
    throw normalizeWebdavError('上传', error);
  }
}

export async function webdavUploadFile(
  config: BackupWebdavConfig,
  remoteFilePath: string,
  file: Blob,
  contentType?: string
): Promise<{ remotePath: string }> {
  try {
    const sanitized = sanitizeWebdavConfig(config);
    const normalizedRemotePath = normalizeRemoteFilePath(remoteFilePath);
    await putWebdavFileAtomically(
      sanitized,
      normalizedRemotePath,
      file,
      contentType || 'application/octet-stream'
    );

    return { remotePath: normalizedRemotePath };
  } catch (error) {
    throw normalizeWebdavError('上传', error);
  }
}

export async function webdavDownloadBackup(
  config: BackupWebdavConfig,
  remotePath?: string
): Promise<FinanceBackupPayload> {
  try {
    const sanitized = sanitizeWebdavConfig(config);
    const resolvedRemotePath = remotePath
      ? normalizeRemoteFilePath(remotePath)
      : await resolveLatestWebdavBackupPath(sanitized);
    const url = joinWebdavPath(sanitized, resolvedRemotePath);
    const response = await fetch(url, {
      method: 'GET',
      headers: buildWebdavHeaders(sanitized)
    });

    if (!response.ok) {
      throw new Error(`WebDAV 下载失败（HTTP ${response.status}）`);
    }

    const text = await response.text();
    return parseFinanceBackupPayload(text);
  } catch (error) {
    throw normalizeWebdavError('下载', error);
  }
}

function getObjectStorageProviderLabel(provider: BackupObjectStorageProvider): string {
  return provider === 'aliyun-oss' ? '阿里云 OSS' : 'S3 兼容存储';
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeObjectStoragePath(path: string): string {
  return normalizeRemoteFilePath(path).split('/').map(encodeRfc3986).join('/');
}

function buildCanonicalQuery(query: Record<string, string> = {}): string {
  return Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', encodeUtf8(value));
  return arrayBufferToHex(digest);
}

async function hmacSign(
  hash: 'SHA-1' | 'SHA-256',
  key: string | ArrayBuffer,
  value: string
): Promise<ArrayBuffer> {
  const rawKey = typeof key === 'string' ? encodeUtf8(key) : key;
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash },
    false,
    ['sign']
  );
  return window.crypto.subtle.sign('HMAC', cryptoKey, encodeUtf8(value));
}

function getS3AmzDate(now = new Date()): { dateStamp: string; amzDate: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    dateStamp: iso.slice(0, 8),
    amzDate: iso
  };
}

function buildObjectStorageListPrefix(remoteFilePath: string): string {
  const { dir, file } = splitRemoteDirAndFile(remoteFilePath);
  const dotIndex = file.lastIndexOf('.');
  const baseName = dotIndex > 0 ? file.slice(0, dotIndex) : file;
  return dir ? `${dir}/${baseName}` : baseName;
}

function buildS3RequestUrl(
  config: BackupObjectStorageConfig,
  remoteFilePath: string | null,
  query: Record<string, string> = {}
): URL {
  const endpoint = new URL(config.endpoint);
  const url = new URL(endpoint.toString());
  const queryString = buildCanonicalQuery(query);
  const encodedBucket = encodeRfc3986(config.bucket);

  if (config.forcePathStyle) {
    url.pathname = remoteFilePath
      ? `/${encodedBucket}/${encodeObjectStoragePath(remoteFilePath)}`
      : `/${encodedBucket}`;
  } else {
    url.hostname = `${config.bucket}.${endpoint.hostname}`;
    url.pathname = remoteFilePath ? `/${encodeObjectStoragePath(remoteFilePath)}` : '/';
  }

  url.search = queryString ? `?${queryString}` : '';
  return url;
}

function buildAliyunOssRequestUrl(
  config: BackupObjectStorageConfig,
  remoteFilePath: string | null,
  query: Record<string, string> = {}
): URL {
  const endpoint = new URL(config.endpoint);
  const url = new URL(endpoint.toString());
  const queryString = buildCanonicalQuery(query);
  url.hostname = `${config.bucket}.${endpoint.hostname}`;
  url.pathname = remoteFilePath ? `/${encodeObjectStoragePath(remoteFilePath)}` : '/';
  url.search = queryString ? `?${queryString}` : '';
  return url;
}

function buildObjectStorageRequestUrl(
  config: BackupObjectStorageConfig,
  remoteFilePath: string | null,
  query: Record<string, string> = {}
): URL {
  return config.provider === 'aliyun-oss'
    ? buildAliyunOssRequestUrl(config, remoteFilePath, query)
    : buildS3RequestUrl(config, remoteFilePath, query);
}

async function buildS3AuthorizationHeaders(
  config: BackupObjectStorageConfig,
  method: string,
  url: URL,
  query: Record<string, string>,
  body: string,
  extraHeaders: Record<string, string>
): Promise<Record<string, string>> {
  const { dateStamp, amzDate } = getS3AmzDate();
  const payloadHash = await sha256Hex(body);
  const headersToSign: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };

  Object.entries(extraHeaders).forEach(([key, value]) => {
    headersToSign[key.toLowerCase()] = value.trim();
  });

  const sortedHeaders = Object.entries(headersToSign).sort(([left], [right]) =>
    left.localeCompare(right, 'en')
  );
  const canonicalHeaders = sortedHeaders.map(([key, value]) => `${key}:${value}\n`).join('');
  const signedHeaders = sortedHeaders.map(([key]) => key).join(';');
  const canonicalRequest = [
    method,
    url.pathname || '/',
    buildCanonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');
  const dateKey = await hmacSign('SHA-256', `AWS4${config.accessKeySecret}`, dateStamp);
  const regionKey = await hmacSign('SHA-256', dateKey, config.region);
  const serviceKey = await hmacSign('SHA-256', regionKey, 's3');
  const signingKey = await hmacSign('SHA-256', serviceKey, 'aws4_request');
  const signature = arrayBufferToHex(await hmacSign('SHA-256', signingKey, stringToSign));

  return {
    ...extraHeaders,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

function buildAliyunOssCanonicalUri(
  config: BackupObjectStorageConfig,
  remoteFilePath: string | null
): string {
  return remoteFilePath
    ? `/${encodeRfc3986(config.bucket)}/${encodeObjectStoragePath(remoteFilePath)}`
    : `/${encodeRfc3986(config.bucket)}/`;
}

async function buildAliyunOssAuthorizationHeaders(
  config: BackupObjectStorageConfig,
  method: string,
  url: URL,
  remoteFilePath: string | null,
  query: Record<string, string>,
  extraHeaders: Record<string, string>
): Promise<Record<string, string>> {
  const { dateStamp, amzDate } = getS3AmzDate();
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const headersToSign: Record<string, string> = {
    host: url.host,
    'x-oss-content-sha256': payloadHash,
    'x-oss-date': amzDate
  };

  Object.entries(extraHeaders).forEach(([key, value]) => {
    headersToSign[key.toLowerCase()] = value.trim();
  });

  const sortedHeaders = Object.entries(headersToSign).sort(([left], [right]) =>
    left.localeCompare(right, 'en')
  );
  const canonicalHeaders = sortedHeaders.map(([key, value]) => `${key}:${value}\n`).join('');
  const additionalHeaders = sortedHeaders
    .map(([key]) => key)
    .filter((key) => key !== 'content-md5' && key !== 'content-type' && !key.startsWith('x-oss-'))
    .join(';');
  const canonicalRequest = [
    method,
    buildAliyunOssCanonicalUri(config, remoteFilePath),
    buildCanonicalQuery(query),
    canonicalHeaders,
    additionalHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${config.region}/oss/aliyun_v4_request`;
  const stringToSign = [
    'OSS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');
  const dateKey = await hmacSign('SHA-256', `aliyun_v4${config.accessKeySecret}`, dateStamp);
  const regionKey = await hmacSign('SHA-256', dateKey, config.region);
  const serviceKey = await hmacSign('SHA-256', regionKey, 'oss');
  const signingKey = await hmacSign('SHA-256', serviceKey, 'aliyun_v4_request');
  const signature = arrayBufferToHex(await hmacSign('SHA-256', signingKey, stringToSign));

  return {
    ...extraHeaders,
    'x-oss-content-sha256': payloadHash,
    'x-oss-date': amzDate,
    Authorization: `OSS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope},AdditionalHeaders=${additionalHeaders},Signature=${signature}`
  };
}

async function buildObjectStorageHeaders(
  config: BackupObjectStorageConfig,
  method: string,
  url: URL,
  remoteFilePath: string | null,
  query: Record<string, string>,
  body: string,
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  return config.provider === 'aliyun-oss'
    ? buildAliyunOssAuthorizationHeaders(config, method, url, remoteFilePath, query, extraHeaders)
    : buildS3AuthorizationHeaders(config, method, url, query, body, extraHeaders);
}

function normalizeObjectStorageError(
  provider: BackupObjectStorageProvider,
  action: '上传' | '下载' | '列目录' | '删除',
  error: unknown
): Error {
  const label = getObjectStorageProviderLabel(provider);
  if (error instanceof Error) {
    if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
      return new Error(
        `${label} ${action}失败：请求被浏览器拦截，通常是 Bucket CORS 未放行。` +
          '请允许 Authorization、x-oss-date/x-amz-date、Content-Type 请求头，以及 PUT/GET/DELETE 方法。'
      );
    }
    return error;
  }
  return new Error(`${label} ${action}失败，请稍后重试`);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseObjectStorageDate(value: string): string | undefined {
  const date = new Date(decodeXmlText(value.trim()));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

interface ObjectStorageRemoteFileEntry {
  remotePath: string;
  updatedAt?: string;
}

function extractObjectStorageRemoteFileEntriesFromXml(
  text: string
): ObjectStorageRemoteFileEntry[] {
  const contentMatches = Array.from(text.matchAll(/<Contents\b[^>]*>([\s\S]*?)<\/Contents>/gi));
  return contentMatches
    .map((match): ObjectStorageRemoteFileEntry | null => {
      const body = match[1] || '';
      const keyMatch = body.match(/<Key\b[^>]*>([\s\S]*?)<\/Key>/i);
      if (!keyMatch) {
        return null;
      }
      const lastModifiedMatch = body.match(/<LastModified\b[^>]*>([\s\S]*?)<\/LastModified>/i);
      const remotePath = decodeXmlText(keyMatch[1] || '').trim();
      const updatedAt = lastModifiedMatch
        ? parseObjectStorageDate(lastModifiedMatch[1] || '')
        : undefined;
      return updatedAt ? { remotePath, updatedAt } : { remotePath };
    })
    .filter((item): item is ObjectStorageRemoteFileEntry => item !== null);
}

async function listObjectStorageRemoteFileEntries(
  config: BackupObjectStorageConfig,
  remoteFilePath: string
): Promise<ObjectStorageRemoteFileEntry[]> {
  const sanitized = sanitizeObjectStorageConfig(config);
  const prefix = buildObjectStorageListPrefix(remoteFilePath);
  const query: Record<string, string> =
    sanitized.provider === 's3-compatible'
      ? { 'list-type': '2', prefix, 'max-keys': '1000' }
      : { prefix, 'max-keys': '1000' };
  const url = buildObjectStorageRequestUrl(sanitized, null, query);
  const headers = await buildObjectStorageHeaders(sanitized, 'GET', url, null, query, '', {});
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw new Error(
      `${getObjectStorageProviderLabel(sanitized.provider)} 列目录失败（HTTP ${response.status}）`
    );
  }

  return extractObjectStorageRemoteFileEntriesFromXml(await response.text());
}

async function deleteObjectStorageFile(
  config: BackupObjectStorageConfig,
  remoteFilePath: string
): Promise<void> {
  const sanitized = sanitizeObjectStorageConfig(config);
  const normalizedRemotePath = normalizeRemoteFilePath(remoteFilePath);
  const url = buildObjectStorageRequestUrl(sanitized, normalizedRemotePath);
  const headers = await buildObjectStorageHeaders(
    sanitized,
    'DELETE',
    url,
    normalizedRemotePath,
    {},
    '',
    {}
  );
  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers
  });

  if (![200, 202, 204, 404].includes(response.status)) {
    throw new Error(
      `${getObjectStorageProviderLabel(sanitized.provider)} 删除失败（${remoteFilePath}，HTTP ${response.status}）`
    );
  }
}

async function pruneObjectStorageBackupVersions(config: BackupObjectStorageConfig): Promise<void> {
  const sanitized = sanitizeObjectStorageConfig(config);
  const files = await listObjectStorageRemoteFileEntries(sanitized, sanitized.remoteFilePath);
  const matched = files
    .map((item) => item.remotePath)
    .filter((item) => isVersionedBackupMatch(item, sanitized.remoteFilePath))
    .sort((a, b) => b.localeCompare(a, 'en'));
  const obsolete = matched.slice(sanitized.retainedVersions);
  await Promise.all(obsolete.map((item) => deleteObjectStorageFile(sanitized, item)));
}

export interface ObjectStorageBackupVersionItem {
  remotePath: string;
  fileName: string;
  label: string;
  isLatest: boolean;
  backupAt?: string;
}

export async function listObjectStorageBackupVersions(
  config: BackupObjectStorageConfig
): Promise<ObjectStorageBackupVersionItem[]> {
  const sanitized = sanitizeObjectStorageConfig(config);
  try {
    const files = await listObjectStorageRemoteFileEntries(sanitized, sanitized.remoteFilePath);
    const matched = files
      .filter((item) => isBackupCandidateMatch(item.remotePath, sanitized.remoteFilePath))
      .sort((a, b) => b.remotePath.localeCompare(a.remotePath, 'en'));

    if (matched.length === 0) {
      const fixedEntry = files.find(
        (item) => normalizeRemoteFilePath(item.remotePath) === sanitized.remoteFilePath
      );
      return [
        {
          remotePath: sanitized.remoteFilePath,
          fileName: splitRemoteDirAndFile(sanitized.remoteFilePath).file,
          label: '当前固定备份文件',
          isLatest: true,
          backupAt: fixedEntry?.updatedAt
        }
      ];
    }

    const latestVersioned = matched.find((item) =>
      isVersionedBackupMatch(item.remotePath, sanitized.remoteFilePath)
    );
    const latestVersionedLabel = latestVersioned
      ? extractWebdavBackupVersionTimeLabel(latestVersioned.remotePath, sanitized.remoteFilePath)
      : null;
    const latestVersionedTime = latestVersioned
      ? extractWebdavBackupVersionTime(latestVersioned.remotePath, sanitized.remoteFilePath)
      : null;

    return matched.map((item, index) => {
      const fileName = item.remotePath.split('/').pop() || item.remotePath;
      const isFixedEntry = normalizeRemoteFilePath(item.remotePath) === sanitized.remoteFilePath;
      const versionTime = isFixedEntry
        ? latestVersionedTime
        : extractWebdavBackupVersionTime(item.remotePath, sanitized.remoteFilePath);
      return {
        remotePath: item.remotePath,
        fileName,
        label: isFixedEntry
          ? latestVersionedLabel
            ? `${latestVersionedLabel} · 固定入口`
            : '当前固定备份文件'
          : buildWebdavBackupVersionLabel(item.remotePath, sanitized.remoteFilePath),
        isLatest: index === 0,
        backupAt: versionTime?.backupAt || item.updatedAt
      };
    });
  } catch {
    return [
      {
        remotePath: sanitized.remoteFilePath,
        fileName: splitRemoteDirAndFile(sanitized.remoteFilePath).file,
        label: '当前固定备份文件（目录列表不可用）',
        isLatest: true
      }
    ];
  }
}

async function resolveLatestObjectStorageBackupPath(
  config: BackupObjectStorageConfig
): Promise<string> {
  const sanitized = sanitizeObjectStorageConfig(config);
  try {
    const files = await listObjectStorageRemoteFileEntries(sanitized, sanitized.remoteFilePath);
    const matched = files
      .map((item) => item.remotePath)
      .filter((item) => isVersionedBackupMatch(item, sanitized.remoteFilePath))
      .sort((a, b) => b.localeCompare(a, 'en'));
    if (matched.length > 0) {
      return matched[0];
    }
  } catch {
    // 对象存储目录列举失败时，回退到固定路径下载。
  }
  return sanitized.remoteFilePath;
}

export async function objectStorageUploadBackup(
  config: BackupObjectStorageConfig,
  payload: FinanceBackupPayload,
  onProgress?: (stage: string) => void
): Promise<void> {
  const provider = config.provider === 's3-compatible' ? 's3-compatible' : 'aliyun-oss';
  try {
    const sanitized = sanitizeObjectStorageConfig(config);
    const label = getObjectStorageProviderLabel(sanitized.provider);
    onProgress?.(`准备 ${label} 备份...`);
    const versionedRemotePath = buildVersionedBackupPath(
      sanitized.remoteFilePath,
      payload.exportedAt
    );
    const body = JSON.stringify(payload, null, 2);
    const uploadOne = async (remotePath: string, stage: string) => {
      const normalizedRemotePath = normalizeRemoteFilePath(remotePath);
      const url = buildObjectStorageRequestUrl(sanitized, normalizedRemotePath);
      const headers = await buildObjectStorageHeaders(
        sanitized,
        'PUT',
        url,
        normalizedRemotePath,
        {},
        body,
        {
          'Content-Type': 'application/json;charset=utf-8'
        }
      );
      onProgress?.(stage);
      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers,
        body
      });

      if (!response.ok) {
        throw new Error(`${label} 上传失败（HTTP ${response.status}）`);
      }
    };

    await uploadOne(versionedRemotePath, '上传版本备份...');
    if (sanitized.remoteFilePath !== versionedRemotePath) {
      await uploadOne(sanitized.remoteFilePath, '更新最新版本...');
    }

    try {
      onProgress?.('清理旧版本...');
      await pruneObjectStorageBackupVersions(sanitized);
    } catch {
      // 版本清理失败不阻断主上传成功，避免不同对象存储的权限差异导致整体失败。
    }
  } catch (error) {
    throw normalizeObjectStorageError(provider, '上传', error);
  }
}

export async function objectStorageDownloadBackup(
  config: BackupObjectStorageConfig,
  remotePath?: string
): Promise<FinanceBackupPayload> {
  const provider = config.provider === 's3-compatible' ? 's3-compatible' : 'aliyun-oss';
  try {
    const sanitized = sanitizeObjectStorageConfig(config);
    const resolvedRemotePath = remotePath
      ? normalizeRemoteFilePath(remotePath)
      : await resolveLatestObjectStorageBackupPath(sanitized);
    const url = buildObjectStorageRequestUrl(sanitized, resolvedRemotePath);
    const headers = await buildObjectStorageHeaders(
      sanitized,
      'GET',
      url,
      resolvedRemotePath,
      {},
      '',
      {}
    );
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      throw new Error(
        `${getObjectStorageProviderLabel(sanitized.provider)} 下载失败（HTTP ${response.status}）`
      );
    }

    return parseFinanceBackupPayload(await response.text());
  } catch (error) {
    throw normalizeObjectStorageError(provider, '下载', error);
  }
}
