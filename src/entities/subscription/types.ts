export type SubscriptionKind = 'digital' | 'mobile' | 'membership' | 'other';
export type SubscriptionBillingCycle = 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';
export type SubscriptionStatus = 'active' | 'due-soon' | 'expired' | 'paused';

export interface SubscriptionItem {
  id: string;
  name: string;
  kind: SubscriptionKind;
  amount: number;
  currency: string;
  billingCycle: SubscriptionBillingCycle;
  customCycleDays?: number;
  accountId?: string;
  provider?: string;
  note?: string;
  renewalDate?: string;
  expireDate?: string;
  autoRenew?: boolean;
  status: SubscriptionStatus;
  lastGeneratedAt?: string;
  lastGeneratedTransactionId?: string;
  /**
   * 「生成支出」推进续费日之前的值,用于把日期精确退回上一期
   * (日期推算有损:1月31日 +1月 = 2月28日,倒推回不到 1月31日)。
   */
  prevRenewalDate?: string;
  prevExpireDate?: string;
  trashedAt?: string;
  createdAt: string;
  updatedAt: string;
}
