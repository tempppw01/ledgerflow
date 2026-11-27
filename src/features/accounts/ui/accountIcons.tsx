import type { SVGProps } from 'react';
import type { AccountIconKind } from '../model/accountTypes';

/**
 * 账户图标:与 `budgetIcons.tsx` / `chatIcons.tsx` 同一套写法(24×24 线性图标、
 * stroke 用 currentColor),这样账户卡片和全站其它图标是同一个设计语言。
 *
 * 为什么不用 emoji:此前这一处回退用的是 emoji(💵 🧾 👛 📄 📥),而全站其它图标
 * 都是单色线性 SVG。emoji 由**操作系统字体**渲染 —— Windows / macOS / Android
 * 各长一样,还是彩色的,和周围的线性图标摆在一起明显不是一套;而且 `debit` 与
 * `credit` 原本都映射到 💳,两种账户类型看起来完全一样。
 *
 * 注意这里只管「没有品牌图标时的回退」。支付宝 / 微信 / 银行等有品牌图的账户
 * 仍然优先用 `getAccountDisplayIconUrl` 返回的品牌图标。
 */
export type AccountIconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

const shared: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false'
};

/** 现金:纸币 */
export function CashIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 10v4M18 10v4" />
    </svg>
  );
}

/** 储蓄卡 / 借记卡 */
export function DebitCardIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </svg>
  );
}

/** 银行 / 储蓄账户 */
export function BankIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M3 9.5 12 4.5l9 5" />
      <path d="M5 9.5V18M9.5 9.5V18M14.5 9.5V18M19 9.5V18" />
      <path d="M3 18h18" />
    </svg>
  );
}

/** 信用卡 */
export function CreditCardIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 9.5h19" />
      <path d="M6 15.5h5" />
      <path d="M17 15.5h1.5" />
    </svg>
  );
}

/** 虚拟账户 / 电子票据 */
export function VirtualReceiptIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M6 3.5h12v17l-2.5-1.6-2 1.6-2-1.6-2 1.6-2-1.6L6 20.5Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

/** 电子钱包 */
export function EWalletIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M3.5 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2" />
      <path d="M3.5 8v9a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-13a2 2 0 0 1-2-2Z" />
      <path d="M16 14h.01" />
    </svg>
  );
}

/** 负债 / 借据 */
export function LiabilityIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M6 3.5h8l4.5 4.5v12.5H6Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9.5 13h5M9.5 16.5h3" />
    </svg>
  );
}

/** 应收款 */
export function ReceivableIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5L16.5 10" />
      <path d="M4 17.5h16v3H4Z" />
    </svg>
  );
}

/** 兜底:通用账户 */
export function WalletIcon(props: AccountIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M4 7.5a2 2 0 0 1 2-2h9.5a2 2 0 0 1 2 2" />
      <path d="M4 7.5v9a2 2 0 0 0 2 2h11.5" />
      <path d="M20.5 10.5h-4a2.5 2.5 0 0 0 0 5h4a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1Z" />
    </svg>
  );
}

const BY_KIND: Record<AccountIconKind, (p: AccountIconProps) => JSX.Element> = {
  cash: CashIcon,
  debit: DebitCardIcon,
  bank: BankIcon,
  credit: CreditCardIcon,
  virtual: VirtualReceiptIcon,
  ewallet: EWalletIcon,
  liability: LiabilityIcon,
  receivable: ReceivableIcon,
  wallet: WalletIcon
};

export function AccountIcon({ kind, ...rest }: AccountIconProps & { kind: AccountIconKind }) {
  const Component = BY_KIND[kind] ?? WalletIcon;
  return <Component {...rest} />;
}
