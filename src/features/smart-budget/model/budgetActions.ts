export type BudgetActionType = 'apply-next-month' | 'set-month-reminder' | 'adjust-category';

export type BudgetActionLog = {
  id: string;
  createdAt: string;
  type: BudgetActionType;
  category: string;
  delta: number;
  message: string;
};

/** 把一条建议动作追加到执行记录顶部，最多保留 12 条。 */
export function appendBudgetActionLog(
  logs: BudgetActionLog[],
  entry: BudgetActionLog
): BudgetActionLog[] {
  return [entry, ...logs].slice(0, 12);
}
