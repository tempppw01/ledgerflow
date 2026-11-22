import type { TransactionStatus } from '../../../entities/transaction/types';

/**
 * 没有 status 的历史行(导入的 CSV、老备份)在别处都按「正常/已完成」对待
 * —— `isBalanceAffectingStatus(undefined)` 为真,它们是计入余额的。
 *
 * 但列表的状态筛选原本是 `row.status === filter`,于是这些行**筛「已完成」时找不到**,
 * 却在余额里算着钱。这里把「缺省状态 = 已完成」这件事收口到一处,两边口径一致。
 */
export const DEFAULT_TRANSACTION_STATUS: TransactionStatus = 'completed';

export function matchesStatusQuickFilter(
  filter: 'all' | TransactionStatus,
  status?: TransactionStatus
): boolean {
  if (filter === 'all') {
    return true;
  }
  return (status ?? DEFAULT_TRANSACTION_STATUS) === filter;
}