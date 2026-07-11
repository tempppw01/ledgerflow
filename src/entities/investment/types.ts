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

export type InvestmentPositionHistoryAction = 'add' | 'update' | 'remove' | 'snapshot';

export interface InvestmentPositionHistoryEntry {
  id: string;
  positionId: string;
  positionName: string;
  category: InvestmentCategory;
  platform?: string;
  action: InvestmentPositionHistoryAction;
  investedAmount: number;
  currentValue: number;
  profit: number;
  profitRate: number;
  investedAmountDelta?: number;
  currentValueDelta?: number;
  isActive: boolean;
  note?: string;
  createdAt: string;
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

export type InvestmentAnalysisRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface InvestmentFundAnalysis {
  fundName?: string;
  fundCode?: string;
  verdict: string;
  summary: string;
  riskLevel: InvestmentAnalysisRiskLevel;
  highlights: string[];
  risks: string[];
  actions: string[];
  watchTags: string[];
  performanceHistory?: string[];
  fundAnalysis?: string[];
  fundHoldings?: string[];
  assetAllocation?: string[];
  industryAllocation?: string[];
  netValue?: string;
  addedReturn?: string;
  holdingReturn?: string;
  buyFeeRate?: string;
  fundCompany?: string;
  platform?: string;
  note?: string;
}

export interface InvestmentWatchlistReviewItem {
  id: string;
  rank: number;
  verdict: string;
  summary: string;
  riskLevel: InvestmentAnalysisRiskLevel;
  investmentAdvice?: string;
  adviceReasons?: string[];
  riskNotes?: string[];
  nextActions?: string[];
  watchTags?: string[];
  performanceHistory?: string[];
  fundAnalysis?: string[];
  fundHoldings?: string[];
  assetAllocation?: string[];
  industryAllocation?: string[];
  netValue?: string;
  addedReturn?: string;
  holdingReturn?: string;
  buyFeeRate?: string;
  fundCompany?: string;
  note?: string;
}

export interface InvestmentWatchItem {
  id: string;
  name: string;
  code?: string;
  platform?: string;
  tags: string[];
  note?: string;
  lastVerdict?: string;
  lastSummary?: string;
  lastRiskLevel?: InvestmentAnalysisRiskLevel;
  investmentAdvice?: string;
  adviceReasons?: string[];
  riskNotes?: string[];
  nextActions?: string[];
  holdingShares?: number;
  performanceHistory?: string[];
  fundAnalysis?: string[];
  fundHoldings?: string[];
  assetAllocation?: string[];
  industryAllocation?: string[];
  netValue?: string;
  addedReturn?: string;
  holdingReturn?: string;
  buyFeeRate?: string;
  fundCompany?: string;
  lastAnalysisAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentAiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  feedback?: 'up' | 'down';
  reasoning?: string;
  followUpPrompts?: string[];
  attachmentCount?: number;
  attachmentImages?: string[];
  analysis?: InvestmentFundAnalysis;
  createdAt: string;
}
