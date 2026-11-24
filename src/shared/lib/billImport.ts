import { TransactionItem, TransactionStatus } from '../../entities/transaction/types';
import { roundMoney } from './money';
import { inferCategoryFromText, resolveCategoryId } from '../../features/assistant/workbench/workbenchMapping';
import type { Category } from '../../entities/category/types';
import { suggestCategoryFromRules, type CategoryLearningRule } from './categoryLearning';
import { resolveTransactionLocalDay } from './localDate';

type BillSource = 'wechat' | 'alipay';

// 正则字面量里不需要转义的字符集合 → 用于把英文列名安全地拼进 RegExp
const ESCAPE_REGEXP = /[.*+?^${}()|[\]\\]/g;
const escapedChar = (match: string) => `\\${match}`;

interface ParseBillInput {
  csvText: string;
  source: BillSource;
  defaultCategoryId: string;
  defaultAccountId: string;
  /**
   * 用户现有的分类。给了就**按每行内容推断分类**(见 inferBillCategoryId),
   * 不给则全部用 defaultCategoryId —— 保持旧行为,不影响已有调用方与测试。
   */
  categories?: Category[];
  /** 用户改分类学出来的规则。命中就先用它 —— 比关键词更贴合这个人自己的习惯。 */
  categoryLearningRules?: CategoryLearningRule[];
}

interface ParseBillFileInput {
  file: File;
  /** 用户现有的分类;给了才按行推断分类(见 inferBillCategoryId)。 */
  categories?: Category[];
  /** 用户改分类学出来的规则,优先级高于关键词。 */
  categoryLearningRules?: CategoryLearningRule[];
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
  '最近修改时间',
  // 本 App 自己导出的 CSV 用的是英文列名(见 csv.ts 的 CSV_EXPORT_HEADERS)。
  // 不认这些别名,就会「导出能成功、导回来 0 条」。
  'date',
  'datetime',
  'time'
];
const AMOUNT_KEYS = [
  '金额',
  // 半角括号与全角括号两种写法都出现在真实导出里(以前重复写了两遍同一个格式)
  '金额(元)',
  '金额（元）',
  '订单金额',
  '交易金额',
  '收/支金额',
  // 本 App 导出的 CSV 用 `amount` 作列名。漏了这一项时 isLikelyHeader 会因为
  // “没有金额列”直接判否 → 整份文件 0 条,界面却照样提示导入成功。
  'amount',
  'money'
];
const TYPE_KEYS = ['收/支', '收支类型', '交易类型', '资金类型', '类型', 'type'];
const NOTE_KEYS = [
  '商品名称',
  '商品',
  '商品说明',
  '交易对方',
  '备注',
  '商户',
  '收款方',
  'note',
  'description'
];
const STATUS_KEYS = ['交易状态', '当前状态', '状态', 'status'];
const ORDER_NO_KEYS = ['交易号', '交易订单号', '订单号', '交易单号', 'orderNo', 'order_no'];
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

const EN_WORD_KEYS = new Set([
  // 'amount' 必须是整词匹配:它是 'type' 的父串,'amount'.includes('type') 为真,
  // 用包含匹配去找「类型」列会先命中 amount 列,把 58.00 当成交易类型读出来。
  'amount',
  'money',
  'date',
  'datetime',
  'time',
  'type',
  'note',
  'description',
  'status',
  'orderNo',
  'order_no'
]);

/**
 * 列名里的英文键按**整词**匹配,中文键仍按包含匹配。
 *
 * 曾经只用 `k.includes(key)`:找「成功退款」时,键列表里的 `amount`(子串匹配)
 * 会先撞上本 App 导出的 `amount` 列,于是**支出金额被当成退款金额**,
 * 一笔 ¥58.00 的支出被算成「全额退款」→ 整行丢弃。导出导入闭环因此在第二处断掉。
 */
function keyMatchesColumn(column: string, key: string): boolean {
  if (EN_WORD_KEYS.has(key)) {
    // 按单词边界匹配,避免 amount 命中 refundAmount、date 命中 updateDate
    const escaped = key.replace(ESCAPE_REGEXP, escapedChar);
    const pattern = new RegExp('(^|[^a-zA-Z0-9])' + escaped + '([^a-zA-Z0-9]|$)', 'i');
    return pattern.test(column);
  }
  return column.includes(key);
}

function pickByKeys(row: Record<string, string>, keys: string[]): string {
  // 先精确匹配:列名与键完全相等时直接取,不受匹配规则影响
  for (const key of keys) {
    const exact = Object.keys(row).find((k) => k === key);
    if (exact && row[exact]) {
      return row[exact];
    }
  }

  for (const key of keys) {
    const matched = Object.keys(row).find((k) => keyMatchesColumn(k, key));
    if (matched && row[matched]) {
      return row[matched];
    }
  }
  return '';
}

/**
 * 把一行的第 idx 个单元格写进 row[h]。
 * 同一列名出现多次时(某些导出会重复列)用空格拼接,而不是后一个覆盖前一个 ——
 * 覆盖会让「金额」这类信息静默丢掉其中一列。
 */
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
  // 先把「全角数字 / 全角标点」折半,再剥掉货币符号与币种代码。
  // 这些写法在真实导出里都见过:全角数字(FF10-FF19)、带币种代码(CNY 58.00)、
  // 带符号与千分位(¥1,234.56)。以前只处理了后者,前两种会让 parseFloat 得到 NaN,
  // 于是整行被静默丢掉。
  const cleaned = raw
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\uFF0E/g, '.')
    .replace(/\uFF0C/g, ',')
    // 只剥离人民币相关的写法。**外币符号与代码不剥**($ / USD / EUR …):
    // 这个账本只有人民币,把「$1,234.56」当成 ¥1,234.56 记进去比跳过更糟。
    .replace(/CNY|RMB/gi, '')
    .replace(/[\u00A5\uFFE5,\s]/g, '');
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  // 统一两位小数,避免浮点误差导致金额展示异常。
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
  return `content:${resolveTransactionLocalDay(item.date)}|${amount}|${String(item.type || '')}|${String(item.note || '').trim()}`;
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
  /*
   * 变更检测必须与**去重键**用同一套归一,否则同一份账单会同时被判成
   * 「是同一笔」(身份键相同)和「有变化」(检测不等)—— 自相矛盾。
   *
   * 去重键(buildBillIdentity)对这几个字段是归一的:
   *   金额 → roundMoney(Math.abs(...))
   *   日期 → resolveTransactionLocalDay(...)
   *   备注 / 订单号 / 商家订单号 → String(...).trim()
   * 而这里原先比的是原始值,于是:CSV 里带尾随空格的备注、被取过整的金额、
   * 纯日期 vs ISO 瞬间的日期,都会被判成「有变化」→ 每次重新导入都发一条没必要的
   * update,报告里多出一批其实没变的「已更新」。
   */
  const sameAmount =
    roundMoney(Math.abs(Number(existing.amount || 0))) ===
    roundMoney(Math.abs(Number(incoming.amount || 0)));
  const sameNote = String(existing.note || '').trim() === String(incoming.note || '').trim();
  const sameOrderNo =
    String(existing.orderNo || '').trim() === String(incoming.orderNo || '').trim();
  const sameMerchantOrderNo =
    String(existing.merchantOrderNo || '').trim() ===
    String(incoming.merchantOrderNo || '').trim();

  // 来源为 undefined 表示「这份账单没提供该字段」,不算变化 —— 否则每次重新导入
  // 都会生成一批内容其实没变的更新。
  return (
    existing.type !== incoming.type ||
    !sameAmount ||
    /*
     * 比的是**本地日历日**,不是原始字符串。
     *
     * 同一天的日期有两种存法:手动快记写纯日期(`2026-11-24`),助手导入写 ISO 瞬间
     * (`2026-11-24T00:00:00.000Z`,来自 normalizeEntryDate)。直接比字符串会把它们判成
     * 「有变化」,于是每次重新导入同一笔账单都会发出一条更新 —— 报告里出现一批其实没变的
     * 「已更新」,还会把用户原来记的日期格式一起改写掉。
     * 上面的去重键本来就是按本地日归一的,这里与它对齐。
     */
    resolveTransactionLocalDay(existing.date) !== resolveTransactionLocalDay(incoming.date) ||
    !sameNote ||
    (incoming.source !== undefined && existing.source !== incoming.source) ||
    (incoming.orderNo !== undefined && !sameOrderNo) ||
    (incoming.merchantOrderNo !== undefined && !sameMerchantOrderNo) ||
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
    pickByKeys(row, [
      '成功退款(元)',
      '成功退款（元）',
      '退款金额',
      'refundAmount',
      'refund_amount'
    ]) || '';
  const refundAmount = parseAmount(refundAmountRaw);
  const all = `${cashflowText} ${typeText} ${statusText} ${noteText} ${amountRaw}`;

  // 本 App 导出的 CSV 里 `type` 列是英文枚举(expense / income / ...),中文关键词
  // 匹配不到它,这里直接按值映射。必须整词相等:账单的「类型」列也可能是自由文本,
  // 用包含匹配会把「非支出」这类值误判成支出。
  //
  // 注意读的是 typeText(「交易类型」列)而不是 cashflowText(「收/支」列):
  // 英文导出里「收/支」列是空的,读错列会让这段判断永远不生效 ——
  // 一笔 ¥58 的支出会被记成收入(见 csv.roundtrip.test.ts)。
  const englishType = typeText.trim().toLowerCase();
  if (
    englishType === 'expense' ||
    englishType === 'income' ||
    englishType === 'budget' ||
    englishType === 'repayment'
  ) {
    return englishType;
  }

  // 收支列能读出来(支出/收入)时以它为准;只有列里是乱码或缺失时,才用退款列兜底。
  // 否则「支出 24.59 + 成功退款 24.59」这种行会被判成收入(见 buildTransactionFromLine 的净额处理)。
  const cashflowReadable = /支出|付款|消费|转出|支付|扣款|收入|收款|入账|转入/.test(cashflowText);
  if (refundAmount > 0 && !cashflowReadable) {
    return 'income';
  }

  if (/花呗还款|信用卡还款|借呗还款|还款|自动还款/i.test(all)) {
    return 'repayment';
  }

  // 收支列读得出来时,以它为准 —— 别再让「交易状态=退款成功」「商品名含退款」这类线索
  // 把一笔支出翻成收入(那样会凭空多出收入)。
  if (cashflowReadable) {
    if (/支出|付款|消费|转出|支付|扣款/.test(cashflowText)) {
      return 'expense';
    }
    return 'income';
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

/**
 * 解析账单里的日期。**认不出来就返回 null,由调用方跳过整行** —— 之前这里会退化成
 * `new Date().toISOString()`(也就是「今天」),于是:
 * - 中文日期「2026年11月18日」认不出来 → 整份账单全部记到今天
 * - 美式日期「11/22/2026」认不出来 → 同样记到今天
 * 这两种都是「数据看着导入成功、账却全错」,比丢一行严重得多。
 */
function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // 先按原样解析。下面的归一化会把 `.` 换成 `-`,而 ISO 时间戳
  // (`2026-11-20T04:30:00.000Z`)里的毫秒点号一旦被替换就变成无效日期,
  // 于是「本 App 自己导出的 CSV」每一行都解析失败 —— 整份文件导回来是 0 条。
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const normalized = trimmed
    // 中文日期:2026年11月18日 → 2026-11-18
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, ' ')
    // 中文时间:9时30分(20秒)→ 9:30(:20)
    .replace(/时/g, ':')
    .replace(/分/g, ':')
    .replace(/秒/g, '')
    // 2026.11.18 / 2026/11/18 → 2026-11-18
    .replace(/[./]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[\s:-]+$/, '')
    .trim();

  if (!normalized) {
    return null;
  }

  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    return null;
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
  const counterparty = pickByKeys(row, ['交易对方', '收款方', '商户', 'counterparty', 'merchant']);
  const goods = pickByKeys(row, ['商品名称', '商品', '商品说明', 'note', 'description']);
  const remark = pickByKeys(row, ['备注', 'remark']);

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

/**
 * 「收/支」列明确写着 / —— 中性交易(转账、提现、理财通转入转出等)。
 * 既不是收入也不是支出,导入时跳过。
 *
 * 只认**明确的 /**(或全角/),不看空值:空值可能是英文导出或列名不同,
 * 那种情况仍有原有的关键词兜底,不能一刀切。
 */
function isNeutralCashflowRow(row: Record<string, string>): boolean {
  const raw = pickByKeys(row, ['收/支', '收支类型']).trim();
  return raw === '/' || raw === '／';
}

/**
 * 按这一行的内容推断分类 id。
 *
 * 原来每行都用同一个 defaultCategoryId —— 用户导微信账单时那一个默认值往往是「餐饮」,
 * 于是 445 笔交易(超市、停车、医院、话费……)全被归到餐饮,分类统计与预算执行数直接失真。
 *
 * 现在复用助手导入已有的推断器(inferCategoryFromText / resolveCategoryId):
 * 按「交易对方 + 商品 + 备注 + 交易类型」匹配关键词,推到哪个分类就用哪个;
 * 推不出来(或用户没有这个分类)才退回 defaultCategoryId。
 */
function inferBillCategoryId(
  row: Record<string, string>,
  type: TransactionItem['type'],
  input: ParseBillInput
): string {
  const categories = input.categories;
  if (!Array.isArray(categories) || categories.length === 0) {
    return input.defaultCategoryId;
  }

  const text = [
    pickByKeys(row, ['交易对方', '商户名称', '对方', 'merchant', 'counterparty']),
    pickByKeys(row, ['商品', '商品说明', '商品名称', 'product', 'item']),
    pickByKeys(row, ['备注', 'note', 'memo']),
    pickByKeys(row, TYPE_KEYS)
  ]
    .filter(Boolean)
    .join(' ');

  if (!text.trim()) return input.defaultCategoryId;

  /*
   * 先把用户自己改出来的规则问一遍 —— 它比关键词更准(那是这个人自己的习惯)。
   * 规则命中就直接用,不再走关键词。
   */
  const learned = suggestCategoryFromRules(
    { type, note: text },
    input.categoryLearningRules ?? []
  );
  if (learned?.categoryId) {
    return learned.categoryId;
  }

  const inferredName = inferCategoryFromText(type, text);
  if (!inferredName) return input.defaultCategoryId;

  const resolvedId = resolveCategoryId(inferredName, categories);
  return resolvedId || input.defaultCategoryId;
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

  /*
   * 中性交易(微信账单里「收/支」是 "/")要跳过。
   *
   * 这类是转账、零钱提现、理财通转入转出等 —— 钱在动,但**既不是收入也不是支出**。
   * 以前收/支列读不出方向时会落到关键词兜底,于是这 93 笔被摊到收支两边:
   * 实测这份账单(共 445 笔、中性 93 笔 ¥29163.47)收入被算成 55088.29(实际 29402.99),
   * 支出算成 11882.08(实际 14522.08)。跳过之后两边才对得上。
   */
  if (isNeutralCashflowRow(row)) {
    return null;
  }

  const amountRaw = pickByKeys(row, AMOUNT_KEYS);
  let amount = parseAmount(amountRaw);
  if (amount <= 0) {
    return null;
  }

  const type = parseType(row, amountRaw, input.source);
  // 支付宝把「退款」记在同一行:金额 24.59、成功退款 24.59。这一行的经济含义是净额,
  // 不是一笔新收入。旧逻辑直接判成 income,等于凭空多出一笔收入。
  if (type === 'expense') {
    const refundAmount = parseAmount(
      pickByKeys(row, ['成功退款(元)', '成功退款（元）', '退款金额'])
    );
    if (refundAmount > 0) {
      // 全额退款:净额为 0,不产生记录
      if (refundAmount >= amount) {
        return null;
      }
      // 部分退款:按净额记账
      amount = roundMoney(amount - refundAmount);
    }
  }

  const dateRaw = pickByKeys(row, DATE_KEYS);
  // 两种情况要区别对待:
  // - **整份账单没有日期列**(有些导出只有金额与商品):沿用「记到今天」的兜底,
  //   用户能立刻看到并自行改日期;
  // - **有日期列但这一行的值认不出来**(中文日期、美式日期、脏数据):整行跳过。
  //   这时用「今天」顶上会让整份账单落到同一天,月统计全错,而且用户看不出来。
  const hasDateColumn = headers.some((header) => DATE_KEYS.some((key) => header.includes(key)));
  let parsedDate = parseDate(dateRaw);
  if (!parsedDate) {
    if (hasDateColumn) {
      return null;
    }
    parsedDate = new Date().toISOString();
  }
  const orderNo = pickByKeys(row, ORDER_NO_KEYS) || undefined;
  const merchantOrderNo = pickByKeys(row, MERCHANT_ORDER_NO_KEYS) || undefined;
  const status = parseStatus(row);

  return {
    type,
    amount,
    date: parsedDate,
    note: buildNote(row),
    tags: [input.source === 'wechat' ? '微信导入' : '支付宝'],
    categoryId: inferBillCategoryId(row, type, input),
    accountId: input.defaultAccountId,
    source: input.source,
    orderNo,
    merchantOrderNo,
    status
  };
}

/**
 * 按行切分,但**跳过引号内的换行**。
 *
 * 账单的备注 / 商品里可能带换行,导出成 CSV 时会被引号包住:
 *   …, 商户消费, 稻家乐, "招牌菜
 *   第二行", 支出, 39.70, …
 * 直接 `split('\n')` 会把这条记录劈成两半 —— 两半都解析不出,
 * 于是**整笔交易静默消失**(用户不会发现少了一笔钱)。
 */
function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      // 引号内连续两个引号是转义,保持引号状态
      if (inQuotes && text[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (char === '\n' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  out.push(current);
  return out;
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

  const lines = splitCsvLines(text)
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

/**
 * Excel 的日期在 sheet XML 里是**序列号**(如 46350.78209490741),不是文本 ——
 * 而号码格式信息在 styles.xml 里。不还原这一层,微信账单的「交易时间」列就是一串数字,
 * 下游按日期解析全部失败,整份文件解析出 **0 条**(这就是「上传微信账单失败」的根因)。
 */
const BUILTIN_DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** 判断一个单元格样式(按 cellXfs 下标)是不是日期/时间格式。 */
function collectDateStyleIndexes(stylesXml: string): Set<number> {
  const result = new Set<number>();
  if (!stylesXml) return result;
  const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');

  // 自定义格式:numFmtId -> formatCode
  const customFormats = new Map<number, string>();
  Array.from(doc.getElementsByTagName('numFmt')).forEach((node) => {
    const id = Number.parseInt(node.getAttribute('numFmtId') || '', 10);
    const code = node.getAttribute('formatCode') || '';
    if (Number.isFinite(id)) customFormats.set(id, code);
  });

  const isDateCode = (code: string) => {
    // 去掉引号里的字面量,避免把 "年" 之类的文本当成日期占位符
    const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    return /[ymdhs]/i.test(bare);
  };

  Array.from(doc.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf') || []).forEach(
    (node, index) => {
      const numFmtId = Number.parseInt(node.getAttribute('numFmtId') || '0', 10);
      const code = customFormats.get(numFmtId);
      if (code ? isDateCode(code) : BUILTIN_DATE_FORMAT_IDS.has(numFmtId)) {
        result.add(index);
      }
    }
  );

  return result;
}

/**
 * Excel 序列号 → 「YYYY-MM-DD HH:mm:ss」**本地墙钟**字符串。
 *
 * 纯算术,不经时区:账单里的时间就是本地时间,过一遍 Date 的时区换算反而会偏移。
 * 基准 1899-12-30 是 Excel 1900 系统的约定。
 */
export function excelSerialToLocalDateTime(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const days = Math.floor(serial);
  const secondsInDay = Math.round((serial - days) * 86400);
  const ms = Date.UTC(1899, 11, 30) + days * 86400000 + secondsInDay * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    date.getUTCFullYear() +
    '-' +
    pad(date.getUTCMonth() + 1) +
    '-' +
    pad(date.getUTCDate()) +
    ' ' +
    pad(date.getUTCHours()) +
    ':' +
    pad(date.getUTCMinutes()) +
    ':' +
    pad(date.getUTCSeconds())
  );
}

function extractSharedStrings(sharedXml: string): string[] {
  const doc = new DOMParser().parseFromString(sharedXml, 'application/xml');
  return Array.from(doc.getElementsByTagName('si')).map((node) => {
    const richTexts = Array.from(node.getElementsByTagName('t')).map((t) => t.textContent || '');
    return richTexts.join('');
  });
}

function extractSheetRows(
  sheetXml: string,
  sharedStrings: string[],
  dateStyles: Set<number> = new Set()
): string[][] {
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
      } else if (!cellType || cellType === 'n') {
        /*
         * t="n" 也要走这里:openpyxl / LibreOffice 这类工具会**显式**把数字标成 t="n",
         * 而微信自己导出的文件不写 t。只处理"没有 t"的那种,会让这些工具产出的账单日期
         * 原样变成 46350.78… 的序列号 —— 下游按日期解析全部失败,整份文件 0 条。
         */
        // 数字单元格:如果是日期样式,就把序列号还原成日期时间(否则下游认不出这一列)
        const styleIndex = Number.parseInt(cell.getAttribute('s') || '-1', 10);
        if (dateStyles.has(styleIndex) && /^\s*\d+(\.\d+)?\s*$/.test(v)) {
          const converted = excelSerialToLocalDateTime(Number(v));
          if (converted) text = converted;
        }
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

  const stylesXml = entries.get('xl/styles.xml');
  const dateStyles = stylesXml ? collectDateStyleIndexes(decoder.decode(stylesXml)) : new Set<number>();
  const rows = extractSheetRows(decoder.decode(sheetEntry), sharedStrings, dateStyles);
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
    defaultAccountId: input.defaultAccountId,
    // 别忘了转发 —— 少这一行,文件级入口就永远用默认分类(功能等于没接上)
    categories: input.categories,
    categoryLearningRules: input.categoryLearningRules
  });
}

export async function parseBillFileToTransactions(
  input: ParseBillFileInput
): Promise<Omit<TransactionItem, 'id'>[]> {
  const result = await parseBillFileToTransactionsDetailed(input);
  return result.rows;
}
