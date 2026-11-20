/** 汇率数据模块的核心类型定义 */

/** 单条汇率记录 */
export interface ExchangeRate {
  /** 货币代码，如 USD / CNY / EUR */
  code: string;
  /** 货币名称（中文） */
  name: string;
  /** 相对于基准货币的汇率 */
  rate: number;
  /** 相比上一次数据的变动方向 */
  trend?: 'up' | 'down' | 'flat';
}

/** API 返回的原始数据结构（frankfurter.app 格式） */
export interface ExchangeApiResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

/** 本地缓存条目 */
export interface ExchangeCache {
  base: string;
  date: string;
  rates: Record<string, number>;
  /** 缓存写入时间戳 (ms) */
  cachedAt: number;
}

/** 常用货币中文名映射 */
export const CURRENCY_NAMES: Record<string, string> = {
  USD: '美元',
  EUR: '欧元',
  GBP: '英镑',
  JPY: '日元',
  CNY: '人民币',
  HKD: '港币',
  TWD: '新台币',
  KRW: '韩元',
  SGD: '新加坡元',
  AUD: '澳元',
  CAD: '加元',
  CHF: '瑞士法郎',
  NZD: '新西兰元',
  THB: '泰铢',
  INR: '印度卢比',
  MYR: '马来西亚林吉特',
  PHP: '菲律宾比索',
  IDR: '印尼盾',
  SEK: '瑞典克朗',
  NOK: '挪威克朗',
  DKK: '丹麦克朗',
  PLN: '波兰兹罗提',
  CZK: '捷克克朗',
  HUF: '匈牙利福林',
  TRY: '土耳其里拉',
  ZAR: '南非兰特',
  BRL: '巴西雷亚尔',
  MXN: '墨西哥比索',
  ILS: '以色列新谢克尔',
  RON: '罗马尼亚列伊',
  BGN: '保加利亚列弗',
  ISK: '冰岛克朗'
};

/** 货币代码与国家/地区旗帜映射（用于 UI 展示） */
const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  CNY: '🇨🇳',
  HKD: '🇭🇰',
  TWD: '🇹🇼',
  KRW: '🇰🇷',
  SGD: '🇸🇬',
  AUD: '🇦🇺',
  CAD: '🇨🇦',
  CHF: '🇨🇭',
  NZD: '🇳🇿',
  THB: '🇹🇭',
  INR: '🇮🇳',
  MYR: '🇲🇾',
  PHP: '🇵🇭',
  IDR: '🇮🇩',
  SEK: '🇸🇪',
  NOK: '🇳🇴',
  DKK: '🇩🇰',
  PLN: '🇵🇱',
  CZK: '🇨🇿',
  HUF: '🇭🇺',
  TRY: '🇹🇷',
  ZAR: '🇿🇦',
  BRL: '🇧🇷',
  MXN: '🇲🇽',
  ILS: '🇮🇱',
  RON: '🇷🇴',
  BGN: '🇧🇬',
  ISK: '🇮🇸'
};

/** 获取货币国旗，无映射时返回 🌐 */
export function getCurrencyFlag(code: string): string {
  return CURRENCY_FLAGS[code] || '🌐';
}

/** 获取货币中文名，无映射时返回代码本身 */
export function getCurrencyName(code: string): string {
  return CURRENCY_NAMES[code] || code;
}

/**
 * 货币名称的 i18n key。
 * 币种代码来自汇率接口,不参与翻译;名称用 exchange.currency.<CODE> 取译文,
 * 取不到时以 CURRENCY_NAMES 里的中文名兜底(单测环境同样走中文)。
 */
export function getCurrencyNameKey(code: string): string {
  return `exchange.currency.${code}`;
}
