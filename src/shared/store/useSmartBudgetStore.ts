import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  BudgetAnswers,
  BudgetRecommendation,
  normalizeBudgetAnswers
} from '../../features/smart-budget/model/budgetPlanner';

export type ConfirmedSmartBudgetPlan = {
  answers: BudgetAnswers;
  recommendation: BudgetRecommendation;
  confirmedAt: string;
};

export type SmartBudgetPlanHistoryItem = ConfirmedSmartBudgetPlan;
const SMART_BUDGET_DRAFT_KEY = 'ledgerflow-smart-budget-wizard-draft-v1';

function clearWizardDraft() {
  try {
    window.localStorage.removeItem(SMART_BUDGET_DRAFT_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}

interface SmartBudgetState {
  confirmedPlan: ConfirmedSmartBudgetPlan | null;
  history: SmartBudgetPlanHistoryItem[];
  confirmPlan: (payload: { answers: BudgetAnswers; recommendation: BudgetRecommendation }) => void;
  /** 就地更新当前方案，不新增历史版本（用于看板上的分类微调）。 */
  updatePlan: (recommendation: BudgetRecommendation) => void;
  restorePlan: (plan: SmartBudgetPlanHistoryItem) => void;
  clearPlan: () => void;
}

function normalizePlan(raw: unknown): ConfirmedSmartBudgetPlan | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as Partial<ConfirmedSmartBudgetPlan>;
  if (!source.recommendation || !source.answers) {
    return null;
  }
  return {
    answers: normalizeBudgetAnswers(source.answers),
    recommendation: source.recommendation,
    confirmedAt: String(source.confirmedAt || new Date().toISOString())
  };
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
        clearWizardDraft();
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
      restorePlan: (plan) => {
        clearWizardDraft();
        set({ confirmedPlan: plan });
      },
      updatePlan: (recommendation) => {
        set((state) =>
          state.confirmedPlan
            ? {
                confirmedPlan: {
                  ...state.confirmedPlan,
                  recommendation
                }
              }
            : state
        );
      },
      clearPlan: () => {
        clearWizardDraft();
        set({ confirmedPlan: null });
      }
    }),
    {
      name: 'ledgerflow-smart-budget',
      partialize: (state) => ({ confirmedPlan: state.confirmedPlan, history: state.history }),
      merge: (persisted, current) => {
        const source = (persisted || {}) as Partial<SmartBudgetState>;
        const history = Array.isArray(source.history)
          ? source.history
              .map((item) => normalizePlan(item))
              .filter((item): item is ConfirmedSmartBudgetPlan => Boolean(item))
          : [];
        return {
          ...current,
          confirmedPlan: normalizePlan(source.confirmedPlan),
          history
        };
      }
    }
  )
);
