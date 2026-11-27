/** 账户类型枚举与预设模板 */
import {
  ALIPAY_LOGO_URL,
  CREDIT_CARDS_ICON_URL,
  LANDMARK_ICON_URL,
  WALLET_CARDS_ICON_URL,
  WECHAT_LOGO_URL
} from '../../../shared/config/brandAssets';

/** 账户类型 */
export type AccountType =
  | 'cash'
  | 'debit'
  | 'savings'
  | 'credit'
  | 'virtual'
  | 'ewallet'
  | 'liability'
  | 'receivable';

/**
 * 账户图标种类 —— 由 `features/accounts/ui/accountIcons.tsx` 渲染成线性 SVG。
 * 定义放在 model 层:ui 只依赖 model,model 不反向依赖 ui。
 *
 * 这里刻意不复用 emoji:emoji 由操作系统字体渲染(彩色、各平台不一),
 * 和全站单色线性图标的语言不一致;而且 `debit` 与 `credit` 原本都用 💳,
 * 两种账户类型看起来完全一样。
 */
export type AccountIconKind =
  | 'cash'
  | 'debit'
  | 'bank'
  | 'credit'
  | 'virtual'
  | 'ewallet'
  | 'liability'
  | 'receivable'
  | 'wallet';

/** 各账户类型对应的图标种类 */
export const ACCOUNT_TYPE_ICON_KIND: Record<AccountType, AccountIconKind> = {
  cash: 'cash',
  debit: 'debit',
  savings: 'bank',
  credit: 'credit',
  virtual: 'virtual',
  ewallet: 'ewallet',
  liability: 'liability',
  receivable: 'receivable'
};

/** 账户类型中文标签 */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: '现金',
  debit: '借记卡',
  savings: '储蓄卡',
  credit: '信用卡',
  virtual: '虚拟账户',
  ewallet: '电子钱包',
  liability: '负债',
  receivable: '应收'
};

/** 预设账户模板 */
export interface AccountPreset {
  /** 预设名称 */
  name: string;
  /** 账户类型 */
  type: AccountType;
  /** 图标 */
  icon: string;
  /** 品牌图标地址 */
  iconUrl?: string;
}

/** 内置预设列表 */
export const ACCOUNT_PRESETS: AccountPreset[] = [
  { name: '现金', type: 'cash', icon: '💵' },
  { name: '支付宝', type: 'virtual', icon: '📱', iconUrl: ALIPAY_LOGO_URL },
  { name: '微信钱包', type: 'virtual', icon: '📱', iconUrl: WECHAT_LOGO_URL },
  { name: '工商银行', type: 'debit', icon: '🏦', iconUrl: LANDMARK_ICON_URL },
  { name: '招商银行', type: 'debit', icon: '🏦', iconUrl: LANDMARK_ICON_URL },
  { name: '建设银行', type: 'debit', icon: '🏦', iconUrl: LANDMARK_ICON_URL },
  { name: '农业银行', type: 'debit', icon: '🏦', iconUrl: LANDMARK_ICON_URL },
  { name: '交通银行', type: 'debit', icon: '🏦', iconUrl: LANDMARK_ICON_URL },
  { name: '储蓄账户', type: 'savings', icon: '🏦', iconUrl: WALLET_CARDS_ICON_URL },
  { name: '信用卡', type: 'credit', icon: '💳', iconUrl: CREDIT_CARDS_ICON_URL },
  { name: '花呗', type: 'credit', icon: '💳', iconUrl: CREDIT_CARDS_ICON_URL },
  { name: '京东白条', type: 'credit', icon: '💳', iconUrl: CREDIT_CARDS_ICON_URL },
  { name: '借款', type: 'liability', icon: '📄' },
  { name: '应收款', type: 'receivable', icon: '📥' }
];

/** 获取账户类型标签 */
export function getAccountTypeLabel(type?: AccountType): string {
  return type ? ACCOUNT_TYPE_LABELS[type] : '未分类';
}

export function isAlipayAccountName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes('支付宝') || normalized.includes('alipay');
}

export function isWechatAccountName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    normalized.includes('微信') || normalized.includes('wechat') || normalized.includes('weixin')
  );
}

export function getAccountDisplayIconUrl(name: string, type?: AccountType): string | undefined {
  const normalized = name.trim().toLowerCase();

  if (isAlipayAccountName(name)) return ALIPAY_LOGO_URL;
  if (isWechatAccountName(name)) return WECHAT_LOGO_URL;
  if (normalized.includes('花呗') || normalized.includes('白条') || type === 'credit') {
    return CREDIT_CARDS_ICON_URL;
  }
  if (type === 'debit' || type === 'savings') {
    return type === 'savings' ? WALLET_CARDS_ICON_URL : LANDMARK_ICON_URL;
  }

  return undefined;
}

/**
 * 根据账户名称 + 类型推断展示图标。
 *
 * 返回的是**图标种类标识**,由 `AccountIcon` 组件渲染成线性 SVG。
 * 以前这里返回 emoji(💵 🧾 👛 📄 📥),两个问题:
 *   1. emoji 由操作系统字体渲染,彩色且各平台不一,和全站单色线性图标不是一套语言;
 *   2. `debit` 与 `credit` 原本都映射到 💳,两种账户类型看起来完全一样。
 */
export function getAccountDisplayIconKind(
  name: string,
  type?: AccountType
): AccountIconKind {
  const normalized = name.trim().toLowerCase();

  if (isAlipayAccountName(name)) {
    return 'virtual';
  }
  if (isWechatAccountName(name)) {
    return 'ewallet';
  }
  if (normalized.includes('云闪付')) {
    return 'ewallet';
  }
  if (normalized.includes('现金')) {
    return 'cash';
  }
  if (normalized.includes('花呗') || normalized.includes('白条')) {
    return 'credit';
  }

  return type ? ACCOUNT_TYPE_ICON_KIND[type] : 'wallet';
}
