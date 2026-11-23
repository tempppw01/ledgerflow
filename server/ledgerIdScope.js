import { createHash } from 'node:crypto';

/*
 * 会被加上用户作用域前缀的字段。
 *
 * parentId 一度漏在这里:子分类的 parentId 不做作用域化,而分类 id 做了,
 * 于是「父级是否存在于本账本」的校验永远为假 —— 写入时被落成 null,
 * 刷新后子分类就变成了一级分类(换设备同样丢)。
 */
const ID_KEYS = new Set([
  'id',
  'accountId',
  'categoryId',
  'parentId',
  'transactionId',
  'relatedTransactionId',
  'refundOfTransactionId',
  'lastGeneratedTransactionId',
  'debtId',
  'paymentAccount',
  'positionId',
  'linkedAccountId',
  'fromCategoryId',
  'toCategoryId'
]);

function namespaceFor(userId) {
  return createHash('sha256').update(String(userId)).digest('hex').slice(0, 8);
}

export function scopeLedgerId(userId, value) {
  if (typeof value !== 'string' || !value) return value;
  const prefix = `${namespaceFor(userId)}-`;
  if (value.startsWith(prefix)) return value;
  return `${prefix}${value.slice(0, 64 - prefix.length)}`;
}

export function unscopeLedgerId(userId, value) {
  if (typeof value !== 'string' || !value) return value;
  const prefix = `${namespaceFor(userId)}-`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function mapLedgerIds(value, mapper) {
  if (Array.isArray(value)) return value.map((item) => mapLedgerIds(item, mapper));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (ID_KEYS.has(key) && typeof entry === 'string') {
      output[key] = mapper(entry);
      continue;
    }
    output[key] = mapLedgerIds(entry, mapper);
  }
  return output;
}

export function scopeLedgerPayload(payload, userId) {
  return mapLedgerIds(payload, (value) => scopeLedgerId(userId, value));
}

export function unscopeLedgerPayload(payload, userId) {
  return mapLedgerIds(payload, (value) => unscopeLedgerId(userId, value));
}
