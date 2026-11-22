import { TransactionItem, TransactionStatus } from '../../entities/transaction/types';
import { roundMoney } from './money';

type BillSource = 'wechat' | 'alipay';

interface ParseBillInput {
  csvText: string;
  source: BillSource;
  defaultCategoryId: string;
  defaultAccountId: string;
}

interface ParseBillFileInput {
  file: File;
  source: BillSource;
  defaultCategoryId: string;
  defaultAccountId: string;
}

export type BillImportMode = 'incremental' | 'merge' | 'overwrite';

export interface BillImportParseSummary {
  delimiter: ',' | '\t' | null;
  headerDetected: boolean;
  totalLines: number;
  dataLines: number;
  parsedCount: number;
  skippedCount: number;
}

export interface ParseBillFileResult {
  rows: Omit<TransactionItem, 'id'>[];
  summary: BillImportParseSummary;
}

interface ApplyBillImportModeInput {
  mode: BillImportMode;
  existing: TransactionItem[];
  incoming: Omit<TransactionItem, 'id'>[];
}

export interface ApplyBillImportModeResult {
  append: Omit<TransactionItem, 'id'>[];
  update: Array<{ id: string; payload: Omit<TransactionItem, 'id'> }>;
  skipped: number;
  shouldClearBeforeImport: boolean;
}

type ImportedTransactionDraft = Omit<TransactionItem, 'id'>;

const DATE_KEYS = [
  '交易时间',
  '入账时间',
  '创建时间',
  '交易创建时间',
  '付款时间',
  '完成时间',
  '最近修改时间'
];
const AMOUNT_KEYS = ['金额', '金额(元)', '金额（元）', '订单金额', '交易金额', '收/支金额'];
const TYPE_KEYS = ['收/支', '收支类型', '交易类型', '资金类型', '类型'];
const NOTE_KEYS = ['商品名称', '商品', '商品说明', '交易对方', '备注', '商户', '收款方'];
const STATUS_KEYS = ['交易状态', '当前状态', '状态'];
const ORDER_NO_KEYS = ['交易号', '交易订单号', '订单号', '交易单号'];
const MERCHANT_ORDER_NO_KEYS = ['商家订单号', '商户订单号', '商户单号'];

const HEADER_HINT_KEYS = [
  ...DATE_KEYS,
  ...AMOUNT_KEYS,
  ...TYPE_KEYS,
  ...NOTE_KEYS,
  ...STATUS_KEYS,
  ...ORDER_NO_KEYS,
  ...MERCHANT_ORDER_NO_KEYS
];

const IMPORT_PARSE_YIELD_INTERVAL = 300;

function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  result.push(current.trim());
  return result.map((item) => item.replace(/^\uFEFF/, '').trim());
}

function detectDelimiter(lines: string[]): ',' | '\t' {
  let commaScore = 0;
  let tabScore = 0;

  const sample = lines.slice(0, Math.min(lines.length, 60));
  sample.forEach((line) => {
    commaScore += (line.match(/,/g) || []).length;
    tabScore += (line.match(/\t/g) || []).length;
  });

  return tabScore > commaScore ? '\t' : ',';
}

function pickByKeys(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const matched = Object.keys(row).find((k) => k.includes(key));
    if (matched && row[matched]) {
      return row[matched];
    }
  }
  return '';
}

function mergeRowCell(row: Record<string, string>, key: string, value: string): void {
  if (!key) return;
  if (!(key in row)) {
    row[key] = value;
    return;
  }

  const prev = row[key].trim();
  const next = value.trim();
  if (!prev && next) {
    row[key] = value;
    return;
  }

  if (prev && next && prev !== next) {
    row[key] = `${prev} ${next}`;
  }
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[¥￥,\s]/g, '');
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  // 统一两位小数，避免浮点误差导致金额展示异常。
  return roundMoney(Math.abs(value));
}

function buildBillIdentity(item: {
  date: string;
  amount: number;
  type: string;
  note: string;
  orderNo?: string;
  merchantOrderNo?: string;
}): string {
  const orderNo = String(item.orderNo || '').trim();
  if (orderNo) {
    return `order:${orderNo}`;
  }

  const merchantOrderNo = String(item.merchantOrderNo || '').trim();
  if (merchantOrderNo) {
    return `merchant:${merchantOrderNo}`;
  }

  const amount = roundMoney(Math.abs(Number(item.amount || 0)));
  return `content:${String(item.date || '').slice(0, 10)}|${amount}|${String(item.type || '')}|${String(item.note || '').trim()}`;
}

function mergeImportTags(existingTags: string[], incomingTags: string[]): string[] {
  return Array.from(new Set([...(existingTags || []), ...(incomingTags || [])]));
}

function hasAllImportTags(existingTags: string[], incomingTags: string[]): boolean {
  const existing = new Set(existingTags || []);
  return (incomingTags || []).every((tag) => existing.has(tag));
}

function hasImportedFieldChanges(
  existing: TransactionItem,
  incoming: ImportedTransactionDraft
): boolean {
  // 来源为 undefined 表示「这份账单没提供该字段」,不算变化 —— 否则每次重新导入
  // 都会生成一批内容其实没变的更新。
  return (
    existing.type !== incoming.type ||
    existing.amount !== incoming.amount ||
    existing.date !== incoming.date ||
    existing.note !== incoming.note ||
    (incoming.source !== undefined && existing.source !== incoming.source) ||
    (incoming.orderNo !== undefined && existing.orderNo !== incoming.orderNo) ||
    (incoming.merchantOrderNo !== undefined &&
      existing.merchantOrderNo !== incoming.merchantOrderNo) ||
    (incoming.status !== undefined && existing.status !== incoming.status) ||
    !hasAllImportTags(existing.tags || [], incoming.tags || [])
  );
}

function buildImportedTransactionUpdatePayload(
  existing: TransactionItem,
  incoming: ImportedTransactionDraft
): ImportedTransactionDraft {
  return {
    ...existing,
    ...incoming,
    categoryId: existing.categoryId || incoming.categoryId,
    accountId: existing.accountId || incoming.accountId,
    tags: mergeImportTags(existing.tags || [], incoming.tags || []),
    // 来源账单里可能根本没有这几列(值就是 undefined)。直接 `...incoming` 会把已有值
    // 覆盖成 undefined —— 状态被清空尤其危险:isBalanceAffectingStatus(undefined) 为真,
    // 一条已关闭/待支付的记录会因此重新计入余额。所以只有来源确实带了值才覆盖。
    status: incoming.status ?? existing.status,
    orderNo: incoming.orderNo ?? existing.orderNo,
    merchantOrderNo: incoming.merchantOrderNo ?? existing.merchantOrderNo,
    attachments: existing.attachments,
    adjustmentKind: existing.adjustmentKind,
    refundOfTransactionId: existing.refundOfTransactionId,
    updatedAt: existing.updatedAt,
    trashedAt: existing.trashedAt
  };
}

export function applyBillImportMode(input: ApplyBillImportModeInput): ApplyBillImportModeResult {
  const existingByIdentity = new Map<string, TransactionItem>();
  input.existing.forEach((item) => {
    existingByIdentity.set(buildBillIdentity(item), item);
  });

  if (input.mode === 'overwrite') {
    return {
      append: input.incoming,
      update: [],
      skipped: 0,
      shouldClearBeforeImport: true
    };
  }

  const append: Omit<TransactionItem, 'id'>[] = [];
  const update: Array<{ id: string; payload: Omit<TransactionItem, 'id'> }> = [];
  let skipped = 0;

  input.incoming.forEach((item) => {
    const identity = buildBillIdentity(item);
    const existing = existingByIdentity.get(identity);
    if (!existing) {
      append.push(item);
      return;
    }

    if (input.mode === 'merge') {
      update.push({
        id: existing.id,
        payload: buildImportedTransactionUpdatePayload(existing, item)
      });
      return;
    }

    if (hasImportedFieldChanges(existing, item)) {
      update.push({
        id: existing.id,
        payload: buildImportedTransactionUpdatePayload(existing, item)
      });
      return;
    }

    skipped += 1;
  });

  return {
    append,
    update,
    skipped,
    shouldClearBeforeImport: false
  };
}

function parseType(
  row: Record<string, string>,
  amountRaw: string,
  source: BillSource
): TransactionItem['type'] {
  const cashflowText = pickByKeys(row, ['收/支', '收支类型']).trim();
  const typeText = pickByKeys(row, TYPE_KEYS);
  const statusText = pickByKeys(row, STATUS_KEYS);
  const noteText = buildNote(row);
  const refundAmountRaw =
    pickByKeys(row, ['成功退款（元）', '成功退款(元)', '退款金额']) || row['成功退款（元）'] || '';
  const refundAmount = parseAmount(refundAmountRaw);
  const all = `${cashflowText} ${typeText} ${statusText} ${noteText} ${amountRaw}`;

  if (refundAmount > 0) {
    return 'income';
  }

  if (/花呗还款|信用卡还款|借呗还款|还款|自动还款/i.test(all)) {
    return 'repayment';
  }

  if (/退款|退回|退还|冲正|退票/i.test(all)) {
    return 'income';
  }

  if (/不计收支/.test(cashflowText)) {
    return 'expense';
  }

  if (/支出|付款|消费|转出|支付|扣款|支|֧��/i.test(cashflowText)) {
    return 'expense';
  }

  if (/收入|收款|入账|转入|收入到账|到账/i.test(cashflowText)) {
    return 'income';
  }

  if (/支出|付款|消费|转出|支付|扣款|转账|支/i.test(all)) {
    return 'expense';
  }

  if (/收入|收款|入账|转入|收入到账|到账/i.test(all)) {
    return 'income';
  }

  if (source === 'alipay') {
    return 'expense';
  }

  return amountRaw.trim().startsWith('-') ? 'expense' : 'income';
}

function parseStatus(row: Record<string, string>): TransactionStatus | undefined {
  const status = pickByKeys(row, STATUS_KEYS);
  if (!status) {
    return undefined;
  }

  if (/关闭/.test(status)) return 'closed';
  if (/失败/.test(status)) return 'failed';
  if (/退款/.test(status)) return 'refunded';
  if (/成功|完成|已收款|已到账/.test(status)) return 'completed';
  if (/待|确认中|发货|收入|支出/.test(status)) return 'pending';

  return undefined;
}

function shouldSkipByStatus(row: Record<string, string>): boolean {
  const status = pickByKeys(row, STATUS_KEYS);
  if (!status) {
    return false;
  }

  return /失败|撤销|未支付/.test(status);
}

function parseDate(raw: string): string {
  const normalized = raw.replace(/\./g, '-').replace(/\//g, '-').trim();
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString();
  }
  return d.toISOString();
}

function isLikelyHeader(cells: string[]): boolean {
  if (cells.length < 4) {
    return false;
  }

  const hitCount = cells.reduce((count, cell) => {
    const matched = HEADER_HINT_KEYS.some((key) => cell.includes(key));
    return matched ? count + 1 : count;
  }, 0);

  const hasAmount = cells.some((cell) => AMOUNT_KEYS.some((key) => cell.includes(key)));
  const hasDate = cells.some((cell) => DATE_KEYS.some((key) => cell.includes(key)));

  return hitCount >= 3 && hasAmount && hasDate;
}

function findHeaderIndex(lines: string[], delimiter: ',' | '\t'): number {
  let bestIndex = -1;
  let bestScore = -1;

  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i];
    if (/^-{4,}$/.test(line) || /^—{4,}$/.test(line)) {
      continue;
    }

    const cells = parseDelimitedLine(line, delimiter);
    if (cells.length < 4) {
      continue;
    }

    const score = cells.reduce((count, cell) => {
      return HEADER_HINT_KEYS.some((key) => cell.includes(key)) ? count + 1 : count;
    }, 0);

    if (score > bestScore && isLikelyHeader(cells)) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) {
    return bestIndex;
  }

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/交易号|商家订单号|交易创建时间|金额|收\/支/.test(lines[i])) {
      return i;
    }
  }

  return 0;
}

function buildNote(row: Record<string, string>): string {
  const counterparty = pickByKeys(row, ['交易对方', '收款方', '商户']);
  const goods = pickByKeys(row, ['商品名称', '商品', '商品说明']);
  const remark = pickByKeys(row, ['备注']);

  const parts = [counterparty, goods, remark].map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0) {
    return '导入账单';
  }

  return parts.join(' · ');
}

function shouldSkipRow(line: string): boolean {
  if (!line) {
    return true;
  }

  if (/^[-—]+$/.test(line)) {
    return true;
  }

  if (
    /^支付宝交易记录明细查询|^微信支付账单明细|^账号:|^起始日期:|^终止日期:|交易记录明细列表/.test(
      line
    )
  ) {
    return true;
  }

  return false;
}

function buildTransactionFromLine(
  line: string,
  headers: string[],
  delimiter: ',' | '\t',
  input: ParseBillInput
): Omit<TransactionItem, 'id'> | null {
  if (shouldSkipRow(line)) {
    return null;
  }

  const cols = parseDelimitedLine(line, delimiter);
  if (cols.length < 2) {
    return null;
  }

  const row: Record<string, string> = {};
  headers.forEach((h, idx) => {
    mergeRowCell(row, h, cols[idx] ?? '');
  });

  if (shouldSkipByStatus(row)) {
    return null;
  }

  const amountRaw = pickByKeys(row, AMOUNT_KEYS);
  const amount = parseAmount(amountRaw);
  if (amount <= 0) {
    return null;
  }

  const dateRaw = pickByKeys(row, DATE_KEYS);
  const orderNo = pickByKeys(row, ORDER_NO_KEYS) || undefined;
  const merchantOrderNo = pickByKeys(row, MERCHANT_ORDER_NO_KEYS) || undefined;
  const status = parseStatus(row);

  return {
    type: parseType(row, amountRaw, input.source),
    amount,
    date: parseDate(dateRaw),
    note: buildNote(row),
    tags: [input.source === 'wechat' ? '微信导入' : '支付宝'],
    categoryId: input.defaultCategoryId,
    accountId: input.defaultAccountId,
    source: input.source,
    orderNo,
    merchantOrderNo,
    status
  };
}

function parseBillCsvLines(input: ParseBillInput): {
  lines: string[];
  headers: string[];
  delimiter: ',' | '\t';
  headerDetected: boolean;
  totalLines: number;
} | null {
  const text = normalizeText(input.csvText);
  if (!text) {
    return null;
  }

  const lines = text
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  const delimiter = detectDelimiter(lines);
  const headerIndex = findHeaderIndex(lines, delimiter);
  const headers = parseDelimitedLine(lines[headerIndex], delimiter);

  return {
    lines: lines.slice(headerIndex + 1),
    headers,
    delimiter,
    headerDetected: isLikelyHeader(headers),
    totalLines: lines.length
  };
}

function parseBillCsvToTransactionsInternal(input: ParseBillInput): ParseBillFileResult {
  const parsed = parseBillCsvLines(input);
  if (!parsed) {
    return {
      rows: [],
      summary: {
        delimiter: null,
        headerDetected: false,
        totalLines: 0,
        dataLines: 0,
        parsedCount: 0,
        skippedCount: 0
      }
    };
  }

  const rows: Omit<TransactionItem, 'id'>[] = [];
  for (const line of parsed.lines) {
    const item = buildTransactionFromLine(line, parsed.headers, parsed.delimiter, input);
    if (item) {
      rows.push(item);
    }
  }

  return {
    rows,
    summary: {
      delimiter: parsed.delimiter,
      headerDetected: parsed.headerDetected,
      totalLines: parsed.totalLines,
      dataLines: parsed.lines.length,
      parsedCount: rows.length,
      skippedCount: Math.max(0, parsed.lines.length - rows.length)
    }
  };
}

export function parseBillCsvToTransactions(input: ParseBillInput): Omit<TransactionItem, 'id'>[] {
  return parseBillCsvToTransactionsInternal(input).rows;
}

export async function parseBillCsvToTransactionsAsync(
  input: ParseBillInput
): Promise<Omit<TransactionItem, 'id'>[]> {
  const result = await parseBillCsvToTransactionsAsyncDetailed(input);
  return result.rows;
}

export async function parseBillCsvToTransactionsAsyncDetailed(
  input: ParseBillInput
): Promise<ParseBillFileResult> {
  const parsed = parseBillCsvLines(input);
  if (!parsed) {
    return {
      rows: [],
      summary: {
        delimiter: null,
        headerDetected: false,
        totalLines: 0,
        dataLines: 0,
        parsedCount: 0,
        skippedCount: 0
      }
    };
  }

  const rows: Omit<TransactionItem, 'id'>[] = [];

  for (let i = 0; i < parsed.lines.length; i++) {
    const item = buildTransactionFromLine(parsed.lines[i], parsed.headers, parsed.delimiter, input);
    if (item) {
      rows.push(item);
    }

    if (i > 0 && i % IMPORT_PARSE_YIELD_INTERVAL === 0) {
      await yieldToMainThread();
    }
  }

  return {
    rows,
    summary: {
      delimiter: parsed.delimiter,
      headerDetected: parsed.headerDetected,
      totalLines: parsed.totalLines,
      dataLines: parsed.lines.length,
      parsedCount: rows.length,
      skippedCount: Math.max(0, parsed.lines.length - rows.length)
    }
  };
}

function cellRefToColIndex(cellRef: string): number {
  const letters = cellRef.replace(/[0-9]/g, '').toUpperCase();
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, result - 1);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境不支持 XLSX 解压');
  }

  const safeBytes = Uint8Array.from(data);
  const stream = new Blob([safeBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function unzipXlsxEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const files = new Map<string, Uint8Array>();

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error('无效的 XLSX 文件');
  }

  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const decoder = new TextDecoder();

  let ptr = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error('XLSX 中央目录损坏');
    }

    const compression = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const fileNameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const fileName = decoder.decode(bytes.slice(ptr + 46, ptr + 46 + fileNameLen));

    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== 0x04034b50) {
      throw new Error('XLSX 本地文件头损坏');
    }

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    if (compression === 0) {
      files.set(fileName, compressed);
    } else if (compression === 8) {
      files.set(fileName, await inflateRaw(compressed));
    }

    ptr += 46 + fileNameLen + extraLen + commentLen;
  }

  return files;
}

function extractSharedStrings(sharedXml: string): string[] {
  const doc = new DOMParser().parseFromString(sharedXml, 'application/xml');
  return Array.from(doc.getElementsByTagName('si')).map((node) => {
    const richTexts = Array.from(node.getElementsByTagName('t')).map((t) => t.textContent || '');
    return richTexts.join('');
  });
}

function extractSheetRows(sheetXml: string, sharedStrings: string[]): string[][] {
  const doc = new DOMParser().parseFromString(sheetXml, 'application/xml');
  const rows = Array.from(doc.getElementsByTagName('row'));
  return rows.map((row) => {
    const cells = Array.from(row.getElementsByTagName('c'));
    const values: string[] = [];

    cells.forEach((cell) => {
      const ref = cell.getAttribute('r') || '';
      const idx = ref ? cellRefToColIndex(ref) : values.length;
      const cellType = cell.getAttribute('t');
      const v = cell.getElementsByTagName('v')[0]?.textContent || '';
      const inline = cell.getElementsByTagName('is')[0]?.textContent || '';
      let text = inline || v;
      if (cellType === 's') {
        text = sharedStrings[Number.parseInt(v, 10)] || '';
      }
      values[idx] = String(text).trim();
    });

    return values.map((v) => v || '');
  });
}

async function xlsxToDelimitedText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const entries = await unzipXlsxEntries(buffer);
  const decoder = new TextDecoder('utf-8');

  const sharedXml = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedXml ? extractSharedStrings(decoder.decode(sharedXml)) : [];

  const sheetEntry =
    entries.get('xl/worksheets/sheet1.xml') ||
    Array.from(entries.entries()).find(([name]) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    )?.[1];

  if (!sheetEntry) {
    throw new Error('XLSX 未找到工作表');
  }

  const rows = extractSheetRows(decoder.decode(sheetEntry), sharedStrings);
  return rows
    .map((row) => row.map((cell) => String(cell || '').replace(/\r?\n/g, ' ')).join('\t'))
    .join('\n');
}

async function decodeBillFileText(file: File): Promise<string> {
  if (/\.xlsx$/i.test(file.name)) {
    return xlsxToDelimitedText(file);
  }

  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (/交易|金额|收\/支|交易时间|交易创建时间/.test(utf8) && !utf8.includes('�')) {
    return utf8;
  }

  try {
    const gbText = new TextDecoder('gb18030').decode(buffer);
    if (/交易|金额|收\/支|交易时间|交易创建时间/.test(gbText)) {
      return gbText;
    }
  } catch {
    // ignore unsupported encoding
  }

  return utf8;
}

export async function parseBillFileToTransactionsDetailed(
  input: ParseBillFileInput
): Promise<ParseBillFileResult> {
  const csvText = await decodeBillFileText(input.file);
  return parseBillCsvToTransactionsAsyncDetailed({
    csvText,
    source: input.source,
    defaultCategoryId: input.defaultCategoryId,
    defaultAccountId: input.defaultAccountId
  });
}

export async function parseBillFileToTransactions(
  input: ParseBillFileInput
): Promise<Omit<TransactionItem, 'id'>[]> {
  const result = await parseBillFileToTransactionsDetailed(input);
  return result.rows;
}
