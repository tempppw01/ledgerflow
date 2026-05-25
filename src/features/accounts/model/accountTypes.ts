/** 账户类型枚举与预设模板 */
import { ALIPAY_LOGO_URL } from '../../../shared/config/brandAssets';

/** 账户类型 */
export type AccountType =
  | 'cash'
  | 'debit'
  | 'savings'
  | 'credit'
  | 'virtual'
  | 'liability'
  | 'receivable';

/** 账户类型中文标签 */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: '现金',
  debit: '借记卡',
  savings: '储蓄卡',
  credit: '信用卡',
  virtual: '虚拟账户',
  liability: '负债',
  receivable: '应收'
};

/** 账户类型图标 */
export const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  cash: '💵',
  debit: '💳',
  savings: '🏦',
  credit: '💳',
  virtual: '📱',
  liability: '📄',
  receivable: '📥'
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
  { name: '微信钱包', type: 'virtual', icon: '📱' },
  { name: '工商银行', type: 'debit', icon: '🏦' },
  { name: '招商银行', type: 'debit', icon: '🏦' },
  { name: '建设银行', type: 'debit', icon: '🏦' },
  { name: '农业银行', type: 'debit', icon: '🏦' },
  { name: '交通银行', type: 'debit', icon: '🏦' },
  { name: '储蓄账户', type: 'savings', icon: '🏦' },
  { name: '信用卡', type: 'credit', icon: '💳' },
  { name: '花呗', type: 'credit', icon: '💳' },
  { name: '京东白条', type: 'credit', icon: '💳' },
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

/** 根据账户名称 + 类型推断展示图标 */
export function getAccountDisplayIcon(name: string, type?: AccountType): string {
  const normalized = name.trim().toLowerCase();

  if (isAlipayAccountName(name)) {
    return ACCOUNT_TYPE_ICONS.virtual;
  }
  if (normalized.includes('微信') || normalized.includes('wechat')) {
    return '🟩';
  }
  if (normalized.includes('云闪付')) {
    return '⚡';
  }
  if (normalized.includes('现金')) {
    return '💵';
  }
  if (normalized.includes('花呗') || normalized.includes('白条')) {
    return '💳';
  }

  return type ? ACCOUNT_TYPE_ICONS[type] : '💼';
}
