export type InvestmentCategory =
  | 'cash'
  | 'fixed-income'
  | 'index-fund'
  | 'active-fund'
  | 'stock'
  | 'gold'
  | 'other';

export type InvestmentRiskLevel = 'low' | 'medium' | 'high';

export interface InvestmentPosition {
  id: string;
  name: string;
  category: InvestmentCategory;
  platform?: string;
  linkedAccountId?: string;
  investedAmount: number;
  currentValue: number;
  monthlyContribution?: number;
  targetAllocation?: number;
  riskLevel: InvestmentRiskLevel;
  note?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InvestmentGoalKind =
  | 'emergency'
  | 'house'
  | 'travel'
  | 'education'
  | 'retirement'
  | 'other';

export type InvestmentGoalPriority = 'low' | 'medium' | 'high';

export interface InvestmentGoal {
  id: string;
  name: string;
  kind: InvestmentGoalKind;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution?: number;
  targetDate?: string;
  priority: InvestmentGoalPriority;
  note?: string;
  createdAt: string;
  updatedAt: string;
}
