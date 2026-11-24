import type { TfFallback } from '../../../shared/lib/useTFallback';
import {
  DEFAULT_TRANSACTION_STATUS,
  type TransactionStatus
} from '../../../entities/transaction/types';

/**
 * 交易状态列显示什么。
 *
 * 缺状态的行按**默认状态(已完成)**显示 —— 这不是随口取的默认值:
 * 筛选器(`transactions/model/statusQuickFilter.ts`)就是按「缺状态 = 已完成」匹配的,
 * 余额那边也把这类行当作计入余额(`isBalanceAffectingStatus(undefined)` 为真)。
 * 显示成「-」会让同一行「筛得出来却看不出状态」—— 助手导入的账单曾经就是这样。
 *
 * 抽成独立模块是为了能直接测:这段逻辑原先内联在表格组件里,只能靠渲染整张表才能覆盖。
 */
export function formatTransactionStatus(
  status: TransactionStatus | undefined,
  tf: TfFallback
): string {
  switch (status ?? DEFAULT_TRANSACTION_STATUS) {
    case 'pending':
      return tf('transactions.table.status.pending', '待处理');
    case 'completed':
      return tf('transactions.table.status.completed', '已完成');
    case 'refunded':
      return tf('transactions.table.status.refunded', '已退款');
    case 'closed':
      return tf('transactions.table.status.closed', '已关闭');
    case 'failed':
      return tf('transactions.table.status.failed', '失败');
    default:
      // 万一出现没见过的状态值,原样显示而不是硬套一个中文标签
      return status ?? DEFAULT_TRANSACTION_STATUS;
  }
}