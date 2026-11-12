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
  if (/微信|微信支付|零钱通|零钱|wechat|weixin|wxpay|\bwx\b/.test(normalized)) return 'wechat';
  if (/支付宝|alipay|蚂蚁|余额宝|zfb|zhifubao/.test(normalized)) return 'alipay';
  return 'ai';
}

export function inferCategoryFromText(type: TransactionType, text: string): string {
  const normalized = text.toLowerCase();
  if (type === 'income') {
    if (/工资|薪资|薪水|月薪|底薪|发薪|salary|payroll/.test(normalized)) return '工资';
    if (/奖金|年终奖|绩效|提成|bonus/.test(normalized)) return '奖金';
    if (/兼职|副业|外快|稿费|咨询费|part[-\s]?time|freelance/.test(normalized)) return '兼职';
    if (/分红|股息|利息|理财收益|基金收益/.test(normalized)) return '投资收益';
    if (/报销|退款|返现/.test(normalized)) return '报销';
    return '收入';
  }
  if (
    type === 'repayment' ||
    /还款|还清|还了|贷款|房贷|车贷|按揭|月供|花呗|白条|信用卡|借呗|分期|最低还款/.test(
      normalized
    )
  ) {
    return '还款';
  }
  if (
    /餐|饭|早餐|午饭|午餐|晚饭|晚餐|夜宵|宵夜|外卖|食堂|快餐|火锅|烧烤|奶茶|咖啡|饮料|星巴克|瑞幸|蜜雪|霸王茶姬|food|meal|restaurant/.test(
      normalized
    )
  ) {
    return '餐饮';
  }
  if (
    /地铁|公交|打车|网约车|出租|滴滴|顺风车|拼车|加油|停车|高速|过路费|单车|火车|高铁|机票|飞机|交通|taxi|metro|bus|fuel|parking/.test(
      normalized
    )
  ) {
    return '交通';
  }
  if (
    /京东|淘宝|天猫|猫超|拼多多|抖音|超市|便利店|盒马|山姆|沃尔玛|购物|网购|日用品|shop|mall|market/.test(
      normalized
    )
  ) {
    return '购物';
  }
  if (/房租|租金|水费|电费|水电|燃气|物业|取暖|家政|装修|居住|rent|utility/.test(normalized)) {
    return '居住';
  }
  if (/医院|药店|买药|挂号|看病|诊所|牙科|体检|医疗|医保|medical|doctor/.test(normalized)) {
    return '医疗';
  }
  if (/电影|演出|演唱会|游戏|KTV|娱乐|music|movie|game/.test(normalized)) return '娱乐';
  if (/学费|课程|培训|培训班|书籍|买书|考试|报名费|education|course/.test(normalized)) {
    return '教育';
  }
  if (/话费|充话费|冲话费|流量|宽带|手机费|电话费|通讯/.test(normalized)) return '通讯';
  if (/旅行|旅游|酒店|民宿|门票|景区|trip|hotel/.test(normalized)) return '旅行';
  if (/宠物|猫粮|狗粮|猫砂/.test(normalized)) return '宠物';
  if (/保险|保费|insurance/.test(normalized)) return '保险';
  if (/会员|订阅|续费|subscription/.test(normalized)) return '订阅';
  if (/人情|礼物|随礼|红包|请客/.test(normalized)) return '人情';
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
  const repaymentLike =
    type === 'repayment' || /还款|还清|还了|贷款|房贷|车贷|按揭|月供|花呗|白条|借呗|分期/.test(normalized);
  if (type === 'income') pushTag('收入');
  else if (type === 'budget') pushTag('预算');
  else if (repaymentLike) pushTag('还款');
  else pushTag('支出');
  if (/早餐|早饭|morning/.test(normalized)) pushTag('早餐');
  if (/午餐|午饭|中餐|noon/.test(normalized)) pushTag('午餐');
  if (/晚餐|晚饭|宵夜|夜宵|dinner/.test(normalized)) pushTag('晚餐');
  if (/外卖|食堂|快餐/.test(normalized)) pushTag('外卖');
  if (/滴滴|打车|网约车|出租|taxi/.test(normalized)) pushTag('打车');
  if (/地铁|公交|单车|metro|bus/.test(normalized)) pushTag('公共交通');
  if (/加油|停车|高速|过路费/.test(normalized)) pushTag('用车');
  if (/支付宝|alipay|余额宝/.test(normalized)) pushTag('支付宝');
  if (/微信|wechat|weixin|零钱/.test(normalized)) pushTag('微信');
  if (/京东|淘宝|天猫|拼多多|shop/.test(normalized)) pushTag('网购');
  if (/工资|薪资|薪水|salary|payroll/.test(normalized)) pushTag('工资');
  if (/奖金|年终奖|绩效|提成|bonus/.test(normalized)) pushTag('奖金');
  if (/贷款|房贷|车贷|按揭|月供/.test(normalized)) pushTag('贷款');
  if (/信用卡|花呗|白条|借呗/.test(normalized)) pushTag('信用账户');
  if (/课程|培训|学费|书籍|买书/.test(normalized)) pushTag('学习');
  if (/话费|流量|宽带/.test(normalized)) pushTag('通讯');
  if (/会员|订阅|续费/.test(normalized)) pushTag('订阅');
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

export interface DraftAccountInput {
  account?: string;
  sourceHint?: 'wechat' | 'alipay' | 'bank' | 'cash' | 'unknown';
  type?: TransactionType | 'unknown';
  note?: string;
  tags?: string[];
}

export interface DraftAccountTarget {
  source: AccountResolveSource;
  type: TransactionType;
  /** 传给 ensureAccountId 的账户名；undefined 表示只复用已有账户。 */
  name?: string;
  /** 账户名是否来自本地推断而非模型/用户明确指定。 */
  inferred: boolean;
}

/**
 * 统一账单草稿的账户决策，预览与保存必须共用这一份规则，
 * 避免出现“预览未指定账户、保存后却落到微信钱包”的不一致。
 */
export function resolveDraftAccountTarget(input: DraftAccountInput): DraftAccountTarget {
  const type: TransactionType =
    input.type && input.type !== 'unknown' ? input.type : 'expense';
  const noteAndTagsText = `${input.note || ''} ${(input.tags || []).join(' ')}`;

  let source: AccountResolveSource =
    input.sourceHint ?? inferSourceFromText(noteAndTagsText);
  if (source === 'unknown' || source === 'ai') {
    if (/(现金|cash|现付|纸币|硬币)/i.test(noteAndTagsText)) {
      source = 'cash';
    } else if (/(银行|银行卡|储蓄卡|借记卡|bank)/i.test(noteAndTagsText)) {
      source = 'bank';
    }
  }

  const accountHintForInference =
    source === 'wechat' || source === 'alipay' || source === 'bank' || source === 'cash' || source === 'unknown'
      ? source
      : undefined;

  const trimmedAccount = String(input.account || '').trim();
  const hasGenericAccountName =
    /^(银行卡|银行账户|储蓄卡|借记卡|bank|bank\s*card|account)$/i.test(trimmedAccount);
  if (trimmedAccount && !hasGenericAccountName) {
    return { source, type, name: trimmedAccount, inferred: false };
  }

  const inferredName = inferAccountNameFromText(noteAndTagsText, accountHintForInference, {
    type
  });
  return { source, type, name: inferredName || undefined, inferred: true };
}

export function resolveDraftAccountLabel(
  input: DraftAccountInput,
  accounts: Account[]
): { label: string; inferred: boolean } {
  const target = resolveDraftAccountTarget(input);
  if (target.name) {
    const matched = findAccountByName(target.name, accounts);
    return { label: matched?.name || target.name, inferred: target.inferred };
  }

  const fallbackId = resolveAccountId(undefined, accounts, {
    source: target.source,
    type: target.type
  });
  const fallback = accounts.find((item) => item.id === fallbackId);
  return { label: fallback?.name || '', inferred: true };
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
  if (text.includes('超时') || text.includes('timeout'))
    return '模型响应超时:这次生成太久已自动结束。点「重试」可重新提交,或换一个响应更快的模型。';
  if (text.includes('aborted')) return '请求已中止:可以点「重试」重新提交。';
  if (text.includes('http 429') || text.includes('http_429') || text.includes('rate limit'))
    return '请求过于频繁：已触发限流，请稍后重试。';
  if (text.includes('http 5') || text.includes('http_5'))
    return '服务暂时不可用：供应商服务异常，请稍后重试。';
  return 'AI 服务调用失败:可能是网络波动或服务暂时异常,请稍后重试;若持续失败,再检查接口地址、模型与 API Key。';
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
