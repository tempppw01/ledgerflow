export type BudgetPacingStatus = 'safe' | 'warning' | 'over';

export type BudgetPacing = {
  monthKey: string;
  isCurrentMonth: boolean;
  daysInMonth: number;
  daysPassed: number;
  daysRemaining: number;
  dailyBudget: number;
  spentPerDay: number;
  remainingAmount: number;
  dailyAllowance: number;
  projectedSpent: number;
  projectedOverspend: number;
  status: BudgetPacingStatus;
};

export type BudgetMonthMeta = {
  year: number;
  month: number;
  daysInMonth: number;
};

export function getBudgetMonthMeta(monthKey: string): BudgetMonthMeta | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month, daysInMonth: new Date(year, month, 0).getDate() };
}

export function formatBudgetMonthLabel(monthKey: string): string {
  const meta = getBudgetMonthMeta(monthKey);
  if (!meta) return monthKey;
  return `${meta.year} 年 ${meta.month} 月`;
}

export function formatBudgetMonthShortLabel(monthKey: string): string {
  const meta = getBudgetMonthMeta(monthKey);
  if (!meta) return monthKey;
  return `${meta.month}月`;
}

/**
 * 预算节奏模型：把「这个月还剩几天」换算成每天可用金额。
 * 全部使用自然月天数，避免跨月时的边界误差。
 */
export function calculateBudgetPacing(params: {
  monthKey: string;
  totalBudget: number;
  totalSpent: number;
  now?: Date;
}): BudgetPacing | null {
  const meta = getBudgetMonthMeta(params.monthKey);
  if (!meta) return null;

  const now = params.now ?? new Date();
  const isCurrentMonth = now.getFullYear() === meta.year && now.getMonth() + 1 === meta.month;

  const daysPassed = isCurrentMonth
    ? Math.min(Math.max(now.getDate(), 1), meta.daysInMonth)
    : meta.daysInMonth;
  const daysRemaining = Math.max(meta.daysInMonth - daysPassed, 0);

  const totalBudget = Number.isFinite(params.totalBudget) ? params.totalBudget : 0;
  const totalSpent = Number.isFinite(params.totalSpent) ? params.totalSpent : 0;

  const dailyBudget = meta.daysInMonth > 0 ? totalBudget / meta.daysInMonth : 0;
  const spentPerDay = daysPassed > 0 ? totalSpent / daysPassed : 0;
  const remainingAmount = totalBudget - totalSpent;
  const dailyAllowance = daysRemaining > 0 ? remainingAmount / daysRemaining : remainingAmount;
  const projectedSpent = spentPerDay * meta.daysInMonth;
  const projectedOverspend = Math.max(projectedSpent - totalBudget, 0);

  let status: BudgetPacingStatus = 'safe';
  if (projectedOverspend > 0) {
    status = 'over';
  } else if (spentPerDay > dailyBudget) {
    status = 'warning';
  }

  return {
    monthKey: params.monthKey,
    isCurrentMonth,
    daysInMonth: meta.daysInMonth,
    daysPassed,
    daysRemaining,
    dailyBudget,
    spentPerDay,
    remainingAmount,
    dailyAllowance,
    projectedSpent,
    projectedOverspend,
    status
  };
}
