function normalizeCurrencyInput(value: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** fractionDigits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 本位币(账本计价单位)的当前值。
 *
 * 语义是「这个账本的数字以什么货币计」—— 只影响**符号与小数位规则**,**不做任何换算**。
 * 也就是说把本位币从 CNY 改成 USD,屏幕上的数字不会变,变的只是它们被标成什么货币。
 * (带汇率换算的版本是另一件事,需要接汇率接口并处理离线降级,没有做。)
 *
 * 由 useAppPreferences 在启动与修改时调用 setBaseCurrency 写入,业务代码不传参 ——
 * 和 setFormattingLocale 一样是模块级状态。
 */
export const LEDGER_BASE_CURRENCIES = [
  'CNY',
  'USD',
  'EUR',
  'HKD',
  'JPY',
  'GBP',
  'KRW',
  'SGD',
  'AUD',
  'CAD',
  'CHF',
  'TWD'
] as const;

export type LedgerBaseCurrency = (typeof LEDGER_BASE_CURRENCIES)[number];

const BASE_CURRENCY_SET = new Set<string>(LEDGER_BASE_CURRENCIES);

let baseCurrency: LedgerBaseCurrency = 'CNY';

/** 校验并写入当前本位币;非法值忽略(保持原值),避免外部数据把界面弄坏。 */
export function setBaseCurrency(value: unknown): LedgerBaseCurrency {
  const code = String(value ?? '').trim().toUpperCase();
  if (BASE_CURRENCY_SET.has(code)) {
    baseCurrency = code as LedgerBaseCurrency;
  }
  return baseCurrency;
}

export function getBaseCurrency(): LedgerBaseCurrency {
  return baseCurrency;
}

/**
 * 本位币的**短符号**表。
 *
 * 不用 Intl 取符号:英文 locale 下 Intl 会把 CNY 显示成 `CN¥`,而界面里要的是 `¥`
 * (原代码的注释就为这件事写过警告)。短符号与界面语言无关,所以写死更稳、也更好测。
 * JPY 与 CNY 共用 `¥` 是事实如此,不是笔误。
 */
const CURRENCY_SYMBOLS: Record<LedgerBaseCurrency, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  HKD: 'HK$',
  JPY: '¥',
  GBP: '£',
  KRW: '₩',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF',
  TWD: 'NT$'
};

/** 当前本位币的短符号(¥ / $ / € …)。 */
export function baseCurrencySymbol(): string {
  return CURRENCY_SYMBOLS[baseCurrency] || baseCurrency;
}

export function formatCurrency(value: number) {
  const normalized = normalizeCurrencyInput(value, 2);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: baseCurrency,
    maximumFractionDigits: 2
  }).format(normalized);
}

type CompactLocale = 'zh' | 'en';

let compactLocale: CompactLocale = 'zh';

/** Intl 的 locale 标识,供日期与纯数字格式化复用。 */
function activeIntlLocale() {
  return compactLocale === 'en' ? 'en-US' : 'zh-CN';
}

const EN_UNITS = [
  { threshold: 1e12, divisor: 1e12, label: 'T' },
  { threshold: 1e9, divisor: 1e9, label: 'B' },
  { threshold: 1e6, divisor: 1e6, label: 'M' },
  { threshold: 1e3, divisor: 1e3, label: 'K' }
];

/**
 * 金额简写跟随界面语言:中文用「万/亿」,英文用「K/M/B」。
 * i18n 初始化与切换语言时调用,业务代码不需要传参。
 */
export function setFormattingLocale(language: string | undefined) {
  compactLocale = language && language.startsWith('en') ? 'en' : 'zh';
}

/** 金额自动简写:按当前语言的数量级缩写,避免长数字挤压布局。 */
export function formatCurrencyAuto(value: number) {
  const normalized = normalizeCurrencyInput(value, 2);
  const abs = Math.abs(normalized);
  const isEn = compactLocale === 'en';

  if (abs < 1000) {
    if (isEn) {
      // 英文环境仍用符号前缀(与简写分支保持一致),避免出现 CN¥ 这种本地化差异。
      const body = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(abs);
      return `${normalized < 0 ? '-' : ''}${baseCurrencySymbol()}${body.includes('.') ? body : `${body}.00`}`;
    }
    return formatCurrency(normalized);
  }

  if (isEn) {
    const enUnit = EN_UNITS.find((item) => abs >= item.threshold) ?? EN_UNITS[EN_UNITS.length - 1];
    const enCompact = abs / enUnit.divisor;
    const enDigits = enCompact >= 100 ? 0 : enCompact >= 10 ? 1 : 2;
    const enText = enCompact
      .toFixed(enDigits)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*[1-9])0+$/, '$1');
    return `${normalized < 0 ? '-' : ''}${baseCurrencySymbol()}${enText}${enUnit.label}`;
  }

  const units = [
    { threshold: 1e24, divisor: 1e24, label: '秭' },
    { threshold: 1e20, divisor: 1e20, label: '垓' },
    { threshold: 1e16, divisor: 1e16, label: '京' },
    { threshold: 1e12, divisor: 1e12, label: '兆' },
    { threshold: 1e8, divisor: 1e8, label: '亿' },
    { threshold: 1e4, divisor: 1e4, label: '万' },
    { threshold: 1e3, divisor: 1e3, label: '千' }
  ];
  const unit = units.find((item) => abs >= item.threshold) || units[units.length - 1];
  const compact = abs / unit.divisor;
  const digits = compact >= 100 ? 0 : compact >= 10 ? 1 : 2;
  const compactText = compact
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');

  return `${normalized < 0 ? '-' : ''}${baseCurrencySymbol()}${compactText}${unit.label}`;
}

/** 货币格式化（固定两位小数） */
export function formatCurrencyFixed2(value: number) {
  const normalized = normalizeCurrencyInput(value, 2);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(normalized);
}

export function formatMoneyByCurrency(value: number, currency = 'CNY') {
  const normalized = normalizeCurrencyInput(value, 2);
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currency || 'CNY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(normalized);
  } catch {
    return `${currency || 'CNY'} ${normalized.toFixed(2)}`;
  }
}

/** 格式化日期（仅日期） */
export function formatDate(value: string) {
  const date = new Date(value);
  // 传进来的可能已经是坏值或空串:返回原值好过抛出,也避免渲染出 "Invalid Date"。
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(activeIntlLocale()).format(date);
}

/**
 * 纯数字格式化(千分位 + 两位小数,不带货币符号)。
 * 用于「大号数字 + 小号单位」的统计卡布局:金额和单位是两个 span,没法直接用 formatCurrency。
 * 这些卡片原先用 toFixed(2),渲染出 54860.40 这种没有千分位的数字,和同页其它金额不一致。
 */
export function formatNumberFixed2(value: number) {
  const normalized = normalizeCurrencyInput(value, 2);
  return new Intl.NumberFormat(activeIntlLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(normalized);
}

/** 格式化日期+时间（24小时制） */
export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value));
}
