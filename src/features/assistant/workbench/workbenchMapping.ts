import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionSource, TransactionType } from '../../../entities/transaction/types';
import type { DraftBillEntry } from './workbenchTypes';

/** 金额统一按分级精度保留两位，避免出现 337.280000000000001 这类展示噪音。 */
export function normalizeMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * 根据文本做轻量来源识别：用于 AI 记账场景下自动匹配“微信/支付宝”等账户。
 * 这里只做 deterministic 规则，避免引入额外随机性。
 */
export function inferSourceFromText(text: string): TransactionSource {
  const normalized = text.toLowerCase();
  if (/微信|wechat|wxpay/.test(normalized)) return 'wechat';
  if (/支付宝|alipay|蚂蚁/.test(normalized)) return 'alipay';
  return 'ai';
}

export function inferCategoryFromText(type: TransactionType, text: string): string {
  const normalized = text.toLowerCase();
  if (type === 'income') {
    if (/工资|salary|payroll|奖金|bonus/.test(normalized)) return '工资';
    if (/兼职|副业|part[-\s]?time|freelance/.test(normalized)) return '兼职';
    return '收入';
  }
  if (
    type === 'repayment' ||
    /还款|贷款|房贷|车贷|按揭|月供|花呗|白条|信用卡还款/.test(normalized)
  ) {
    return '还款';
  }
  if (/餐|外卖|奶茶|咖啡|food|meal|restaurant/.test(normalized)) return '餐饮';
  if (/地铁|公交|打车|出租|滴滴|交通|taxi|metro|bus/.test(normalized)) return '交通';
  if (/京东|淘宝|拼多多|购物|网购|shop|mall/.test(normalized)) return '购物';
  if (/房租|租金|水电|燃气|物业|居住|rent/.test(normalized)) return '居住';
  if (/医院|药店|体检|医疗|medical|doctor/.test(normalized)) return '医疗';
  if (/电影|演出|游戏|娱乐|music|movie/.test(normalized)) return '娱乐';
  return '支出';
}

export function inferTags(
  type: TransactionType,
  note: string,
  category: string,
  currentTags: string[]
): string[] {
  const normalized = `${note} ${category}`.toLowerCase();
  const tags = currentTags
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 6);
  const pushTag = (tag: string) => {
    if (!tags.includes(tag) && tags.length < 6) tags.push(tag);
  };
  if (type === 'income') pushTag('收入');
  else if (type === 'budget') pushTag('预算');
  else if (type === 'repayment') pushTag('还款');
  else pushTag('支出');
  if (/早餐|早饭|morning/.test(normalized)) pushTag('早餐');
  if (/午餐|中餐|noon/.test(normalized)) pushTag('午餐');
  if (/晚餐|宵夜|dinner/.test(normalized)) pushTag('晚餐');
  if (/滴滴|打车|出租|taxi/.test(normalized)) pushTag('打车');
  if (/地铁|公交|metro|bus/.test(normalized)) pushTag('公共交通');
  if (/支付宝|alipay/.test(normalized)) pushTag('支付宝');
  if (/微信|wechat/.test(normalized)) pushTag('微信');
  if (/京东|淘宝|拼多多|shop/.test(normalized)) pushTag('网购');
  if (/工资|salary|payroll/.test(normalized)) pushTag('工资');
  if (/贷款|房贷|车贷|按揭|月供/.test(normalized)) pushTag('贷款');
  if (/信用卡|花呗|白条/.test(normalized)) pushTag('信用账户');
  return tags;
}

export function resolveCategoryId(name: string | undefined, categories: Category[]): string {
  const normalized = (name || '').trim();
  if (!normalized) return categories[0]?.id || 'cat-unknown';
  const matched = categories.find(
    (item) => item.name.trim().toLowerCase() === normalized.toLowerCase()
  );
  return matched?.id || categories[0]?.id || 'cat-unknown';
}

function toLooseCategoryKey(raw: string): string {
  return raw
    .replace(/[\u00A0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s_\-·•、，,。.!！?？/\\]+/g, '')
    .toLocaleLowerCase('zh-CN');
}

export function ensureCategoryId(
  name: string | undefined,
  categories: Category[],
  addCategory: (name: string) => string
): string {
  const normalized = (name || '').trim();
  if (!normalized) return resolveCategoryId(normalized, categories);

  const exactMatched = categories.find(
    (item) => item.name.trim().toLocaleLowerCase('zh-CN') === normalized.toLocaleLowerCase('zh-CN')
  );
  if (exactMatched) return exactMatched.id;

  const normalizedLoose = toLooseCategoryKey(normalized);
  if (!normalizedLoose) return resolveCategoryId(undefined, categories);

  const nearMatched = categories.find((item) => {
    const itemLoose = toLooseCategoryKey(item.name);
    if (!itemLoose) return false;
    if (itemLoose === normalizedLoose) return true;
    if (normalizedLoose.length < 2 || itemLoose.length < 2) return false;
    return itemLoose.includes(normalizedLoose) || normalizedLoose.includes(itemLoose);
  });
  if (nearMatched) return nearMatched.id;

  return addCategory(normalized) || categories[0]?.id || 'cat-unknown';
}

function toLooseAccountKey(raw: string): string {
  return raw
    .replace(/[\u00A0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s_\-·•、，,。.!！?？/\\]+/g, '')
    .toLocaleLowerCase('zh-CN');
}

function findAccountByName(name: string | undefined, accounts: Account[]): Account | undefined {
  const normalized = (name || '').trim();
  if (!normalized) return undefined;
  const normalizedLower = normalized.toLocaleLowerCase('zh-CN');
  const exact = accounts.find(
    (item) => item.name.trim().toLocaleLowerCase('zh-CN') === normalizedLower
  );
  if (exact) return exact;

  const looseKey = toLooseAccountKey(normalized);
  if (!looseKey) return undefined;
  return accounts.find((item) => {
    const itemLoose = toLooseAccountKey(item.name);
    if (!itemLoose) return false;
    if (itemLoose === looseKey) return true;
    if (looseKey.length < 2 || itemLoose.length < 2) return false;
    return itemLoose.includes(looseKey) || looseKey.includes(itemLoose);
  });
}

const BANK_ACCOUNT_PATTERNS = [
  /(中国银行|工商银行|建设银行|农业银行|交通银行|邮储银行|招商银行|平安银行|中信银行|光大银行|华夏银行|浦发银行|民生银行|兴业银行|广发银行|北京银行|上海银行|宁波银行|杭州银行|江苏银行|南京银行)/i,
  /([\u4e00-\u9fa5]{2,12}银行)/,
  /([A-Za-z]{2,20}\s*Bank)/i
];

export function inferAccountNameFromText(
  text: string,
  sourceHint?: 'wechat' | 'alipay' | 'bank' | 'cash' | 'unknown',
  options?: { type?: TransactionType }
): string {
  const normalized = String(text || '').trim();
  if (sourceHint === 'wechat') return '微信钱包';
  if (sourceHint === 'alipay') return '支付宝';
  if (sourceHint === 'cash') return '现金';

  // 还款账单：更优先落到“负债/信用账户”而不是扣款银行卡。
  // 例如“平安银行房贷月供扣款”应更倾向于“房贷账户”，避免误创建“平安银行”借记卡账户。
  if (options?.type === 'repayment') {
    if (/房贷|按揭/.test(normalized)) return '房贷账户';
    if (/车贷/.test(normalized)) return '车贷账户';
    if (/贷款|借款|消费贷/.test(normalized)) return '贷款账户';
    if (/信用卡|花呗|白条/.test(normalized)) return '信用卡';
    return '信用卡';
  }

  for (const pattern of BANK_ACCOUNT_PATTERNS) {
    const matched = normalized.match(pattern);
    if (matched?.[1]) return matched[1].replace(/\s+/g, ' ').trim();
    if (matched?.[0]) return matched[0].replace(/\s+/g, ' ').trim();
  }

  if (/(银行卡|储蓄卡|借记卡|卡里|卡内|银行入账|银行到账|对公账户)/i.test(normalized)) {
    return '银行卡';
  }

  return '';
}

export type AccountResolveSource = TransactionSource | 'bank' | 'cash' | 'unknown';

function inferDefaultAccountName(options?: {
  source?: AccountResolveSource;
  type?: TransactionType;
}): string {
  if (options?.source === 'wechat') return '微信钱包';
  if (options?.source === 'alipay') return '支付宝';
  if (options?.source === 'cash') return '现金';
  if (options?.source === 'bank') return '银行卡';
  if (options?.type === 'repayment') return '信用卡';
  return '现金';
}

function inferAccountType(
  name: string,
  options?: { source?: AccountResolveSource; type?: TransactionType }
): Account['type'] {
  const normalized = name.toLocaleLowerCase('zh-CN');
  if (options?.source === 'wechat' || options?.source === 'alipay') return 'virtual';
  if (/微信|wechat|支付宝|alipay|余额宝|零钱/.test(normalized)) return 'virtual';
  if (/信用卡|花呗|白条/.test(normalized)) return 'credit';
  if (/借款|贷款|房贷|车贷|按揭|负债/.test(normalized)) return 'liability';
  if (options?.type === 'repayment') {
    if (/借款|贷款|房贷|车贷|按揭|负债/.test(normalized)) return 'liability';
    return 'credit';
  }
  if (/银行卡|银行|储蓄|借记/.test(normalized)) return 'debit';
  if (/现金/.test(normalized)) return 'cash';
  return undefined;
}

function resolveMatchedAccountId(
  name: string | undefined,
  accounts: Account[],
  options?: { source?: AccountResolveSource; type?: TransactionType }
): string | null {
  const named = findAccountByName(name, accounts);
  if (named) return named.id;

  const source = options?.source;
  if (source === 'wechat') {
    const wechat = accounts.find((item) => /微信|wechat|零钱|wx/i.test(item.name));
    if (wechat) return wechat.id;
  }
  if (source === 'alipay') {
    const alipay = accounts.find((item) => /支付宝|alipay|余额宝|蚂蚁/i.test(item.name));
    if (alipay) return alipay.id;
  }

  if (options?.type === 'repayment') {
    const liability = accounts.find((item) => item.type === 'credit' || item.type === 'liability');
    if (liability) return liability.id;
  }

  return null;
}

/**
 * 严谨账户匹配策略：
 * 1) 先做名称精确/模糊匹配；
 * 2) 若失败，按来源关键字（微信/支付宝）在账户名中匹配；
 * 3) 还款类优先落到信用卡/负债类账户；
 * 4) 再兜底到首账户。
 */
export function resolveAccountId(
  name: string | undefined,
  accounts: Account[],
  options?: { source?: AccountResolveSource; type?: TransactionType }
): string {
  const matchedId = resolveMatchedAccountId(name, accounts, options);
  if (matchedId) return matchedId;
  return accounts[0]?.id || 'acc-unknown';
}

/**
 * 账户保障策略：
 * - 优先复用已有账户；
 * - 未命中时，根据来源/语义自动新建账户并返回新账户 id。
 */
export function ensureAccountId(
  name: string | undefined,
  accounts: Account[],
  addAccount: (name: string, type?: Account['type']) => string,
  options?: { source?: AccountResolveSource; type?: TransactionType }
): string {
  const matchedId = resolveMatchedAccountId(name, accounts, options);
  if (matchedId) {
    return matchedId;
  }

  const targetName = ((name || '').trim() || inferDefaultAccountName(options)).trim();
  const existing = findAccountByName(targetName, accounts);
  if (existing) return existing.id;

  const createdId = addAccount(targetName, inferAccountType(targetName, options));
  return createdId || accounts[0]?.id || 'acc-unknown';
}

export function mapAssistantErrorMessage(raw: string): string {
  const text = raw.toLowerCase();
  if (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network error') ||
    text.includes('load failed')
  ) {
    return '无法连接到 AI 服务，请检查接口地址与网络后重试。';
  }
  if (
    text.includes('pdf') ||
    text.includes('file_url') ||
    text.includes('application/pdf') ||
    text.includes('unsupported file') ||
    text.includes('unsupported media type')
  ) {
    return 'PDF 直传模型失败，请重试或改传图片。';
  }
  if (
    text.includes('http 400') ||
    text.includes('http_400') ||
    text.includes('improperly formed request') ||
    text.includes('bad_response_status_code')
  ) {
    return '请求格式有误：模型接口未能解析本次请求。请切换标准模型后重试。';
  }
  if (text.includes('http 401') || text.includes('http_401') || text.includes('unauthorized'))
    return '鉴权失败：请检查 API Key。';
  if (text.includes('http 403') || text.includes('http_403') || text.includes('forbidden'))
    return '权限不足：当前 API Key 无模型访问权限。';
  if (text.includes('http 404') || text.includes('http_404'))
    return '接口地址或模型不存在：请检查 Base URL 与模型名称。';
  if (text.includes('http 429') || text.includes('http_429') || text.includes('rate limit'))
    return '请求过于频繁：已触发限流，请稍后重试。';
  if (text.includes('http 5') || text.includes('http_5'))
    return '服务暂时不可用：供应商服务异常，请稍后重试。';
  return raw;
}

export function toPayloadRows(entries: DraftBillEntry[]) {
  return entries
    .filter((item) => item.selected && item.issues.length === 0)
    .map((item) => ({
      type: item.type === 'unknown' ? 'expense' : item.type,
      amount: normalizeMoney(item.amount),
      date: item.date,
      note: item.note,
      category: item.category,
      account: item.account,
      tags: item.tags,
      orderNo: item.orderNo,
      merchantOrderNo: item.merchantOrderNo
    }));
}
