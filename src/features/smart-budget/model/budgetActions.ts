export type BudgetActionType = 'apply-next-month' | 'set-month-reminder' | 'adjust-category';

export type BudgetActionLog = {
  id: string;
  createdAt: string;
  type: BudgetActionType;
  category: string;
  delta: number;
  message: string;
};

export const BUDGET_ACTION_LABEL: Record<BudgetActionType, string> = {
  'apply-next-month': '已应用到下月预算',
  'set-month-reminder': '已设为本月提醒',
  'adjust-category': '已调整分类预算'
};

/** 把一条建议动作追加到执行记录顶部，最多保留 12 条。 */
export function appendBudgetActionLog(
  logs: BudgetActionLog[],
  entry: BudgetActionLog
): BudgetActionLog[] {
  return [entry, ...logs].slice(0, 12);
}
