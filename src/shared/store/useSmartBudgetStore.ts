import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  BudgetAnswers,
  BudgetRecommendation
} from '../../features/smart-budget/model/budgetPlanner';

export type ConfirmedSmartBudgetPlan = {
  answers: BudgetAnswers;
  recommendation: BudgetRecommendation;
  confirmedAt: string;
};

export type SmartBudgetPlanHistoryItem = ConfirmedSmartBudgetPlan;

interface SmartBudgetState {
  confirmedPlan: ConfirmedSmartBudgetPlan | null;
  history: SmartBudgetPlanHistoryItem[];
  confirmPlan: (payload: { answers: BudgetAnswers; recommendation: BudgetRecommendation }) => void;
  restorePlan: (plan: SmartBudgetPlanHistoryItem) => void;
  clearPlan: () => void;
}

/**
 * 智能预算确认结果存储。
 * 仅保存用户最终确认的建议，避免中间步骤污染全局状态。
 */
export const useSmartBudgetStore = create<SmartBudgetState>()(
  persist(
    (set) => ({
      confirmedPlan: null,
      history: [],
      confirmPlan: ({ answers, recommendation }) => {
        set((state) => {
          const nextPlan = {
            answers,
            recommendation,
            confirmedAt: new Date().toISOString()
          };
          const nextHistory = [nextPlan, ...state.history].filter(
            (item, index, list) =>
              index === list.findIndex((candidate) => candidate.confirmedAt === item.confirmedAt)
          );
          return {
            confirmedPlan: nextPlan,
            history: nextHistory.slice(0, 12)
          };
        });
      },
      restorePlan: (plan) => set({ confirmedPlan: plan }),
      clearPlan: () => set({ confirmedPlan: null })
    }),
    {
      name: 'ledgerflow-smart-budget',
      partialize: (state) => ({ confirmedPlan: state.confirmedPlan, history: state.history }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SmartBudgetState>),
        history: (persisted as Partial<SmartBudgetState>)?.history || []
      })
    }
  )
);
