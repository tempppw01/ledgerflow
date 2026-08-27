import type { TransactionType } from '../../../entities/transaction/types';
import type { SubscriptionKind } from '../../../entities/subscription/types';

export type WorkbenchStatus =
  | 'idle'
  | 'ready'
  | 'recognizing'
  | 'preview'
  | 'saving'
  | 'saved'
  | 'error';

export interface AiBillItem {
  type: TransactionType;
  amount: number;
  date?: string;
  note?: string;
  category?: string;
  account?: string;
  tags?: string[];
  sourceHint?: 'wechat' | 'alipay' | 'bank' | 'cash' | 'unknown';
  needsReview?: string[];
  orderNo?: string;
  merchantOrderNo?: string;
  currency?: string;
  originalAmountText?: string;
  subscriptionSuggestion?: {
    kind: SubscriptionKind;
    reason: string;
  };
}

export interface AiBillResult {
  transactions: AiBillItem[];
}

export interface ValidationIssue {
  field: 'amount' | 'date' | 'type' | 'currency';
  message: string;
  needsReview?: boolean;
}

export interface DraftBillEntry {
  id: string;
  selected: boolean;
  type: TransactionType | 'unknown';
  amount: number;
  date: string;
  note: string;
  category: string;
  account: string;
  tags: string[];
  sourceHint?: 'wechat' | 'alipay' | 'bank' | 'cash' | 'unknown';
  needsReview?: string[];
  orderNo?: string;
  merchantOrderNo?: string;
  currency?: string;
  originalAmountText?: string;
  subscriptionSuggestion?: {
    kind: SubscriptionKind;
    reason: string;
  };
  duplicateTxId?: string;
  duplicateReason?: 'orderNo' | 'merchantOrderNo' | 'content';
  issues: ValidationIssue[];
}

export interface AssistantToastState {
  message: string;
  variant: 'success' | 'error' | 'warning';
  visible: boolean;
}

export const SMART_TRANSACTION_COMMANDS = [
  {
    key: 'monthly-spending',
    label: '最近1个月消费分析',
    prompt:
      '请只基于当前账本交易数据，分析最近一个月消费情况：总支出、分类占比、Top3 高消费分类、与上一个月对比变化，并给出 3 条可执行建议。'
  },
  {
    key: 'next-month-repayment',
    label: '下个月还款预算',
    prompt:
      '请只基于当前账本交易数据，分析下一个月的还款预算：预计还款总额、可能集中还款日期、资金缺口预警，并给出分摊还款建议。'
  },
  {
    key: 'income-expense-trend',
    label: '近3个月收支趋势',
    prompt:
      '请只基于当前账本交易数据，分析最近三个月收支趋势：每月收入、支出、结余变化，并指出异常波动原因。'
  },
  {
    key: 'tag-cost-hotspots',
    label: '高频标签花费洞察',
    prompt:
      '请只基于当前账本交易数据，按标签分析最近一个月消费：高频标签、标签金额占比、可优化支出点，并给出节流建议。'
  }
] as const;
