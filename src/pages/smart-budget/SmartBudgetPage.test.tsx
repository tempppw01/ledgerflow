import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '../../entities/category/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { useSmartBudgetStore } from '../../shared/store/useSmartBudgetStore';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { SmartBudgetPage } from './SmartBudgetPage';

vi.mock('../../shared/store/useAiSettings', () => ({
  useAiSettings: () => ({
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test'
  })
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  sendAiChat: vi.fn()
}));

const expenseCategories: Category[] = [
  { id: 'cat-1', name: '餐饮', kind: 'expense' },
  { id: 'cat-2', name: '交通', kind: 'expense' },
  { id: 'cat-3', name: '购物日用', kind: 'expense' },
  { id: 'cat-4', name: '保险', kind: 'expense' },
  { id: 'cat-income', name: '工资', kind: 'income' }
];

const monthTransactions: TransactionItem[] = [
  {
    id: 'tx-1',
    type: 'expense',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    amount: 320,
    date: '2026-10-05',
    note: '午餐',
    tags: []
  } as TransactionItem
];

function renderPage() {
  return render(
    <MemoryRouter>
      <SmartBudgetPage />
    </MemoryRouter>
  );
}

function readBoardCategoryBudgets() {
  return screen.getAllByRole('button', { name: /已花费/ }).map((card) => {
    const name = within(card).getByRole('heading').textContent || '';
    const budget = card.querySelector('.sb-category-amounts > div:last-child strong');
    return { name, budget: budget?.textContent || '' };
  });
}

describe('SmartBudgetPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSmartBudgetStore.setState({ confirmedPlan: null, history: [] });
    useFinanceStore.setState({
      transactions: monthTransactions,
      categories: expenseCategories
    });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('walks through the wizard and confirms a plan into the board', () => {
    renderPage();

    expect(screen.getByText('第 1 / 5 步')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(screen.getByText('第 2 / 5 步')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(screen.getByText('第 3 / 5 步')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(screen.getByText('第 4 / 5 步')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /生成预算推荐/ }));
    expect(screen.getByText('第 5 / 5 步')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /就用这份预算/ }));

    expect(screen.getByRole('heading', { name: '分类预算执行' })).toBeInTheDocument();
    expect(useSmartBudgetStore.getState().confirmedPlan).not.toBeNull();
  });

  it('re-distributes a legacy plan so no ledger category shows a zero budget', () => {
    useSmartBudgetStore.setState({
      confirmedPlan: {
        answers: {
          identity: 'employee',
          monthlyIncome: 10000,
          monthlyFixedExpense: 3000,
          savingsRatio: 0.3
        },
        recommendation: {
          monthlyIncome: 10000,
          monthlyFixedExpense: 3000,
          disposableIncome: 7000,
          savingsAmount: 2000,
          flexibleBudget: 5000,
          categoryBudgets: [
            { category: '固定支出', amount: 3000, ratio: 0.3 },
            { category: '储蓄/投资', amount: 2000, ratio: 0.2 },
            { category: '餐饮', amount: 2000, ratio: 0.2 },
            { category: '交通', amount: 1200, ratio: 0.12 },
            { category: '购物日用', amount: 0, ratio: 0 },
            { category: '保险', amount: 0, ratio: 0 }
          ]
        },
        confirmedAt: '2026-10-01T00:00:00.000Z'
      }
    });

    renderPage();

    const rows = readBoardCategoryBudgets();
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.budget).not.toBe('¥0.00');
    });

    const plan = useSmartBudgetStore.getState().confirmedPlan;
    expect(plan?.recommendation.categoryBudgets.every((item) => item.amount > 0)).toBe(true);
  });

  it('persists a manual budget adjustment to the confirmed plan', () => {
    useSmartBudgetStore.setState({
      confirmedPlan: {
        answers: {
          identity: 'employee',
          monthlyIncome: 10000,
          monthlyFixedExpense: 3000,
          savingsRatio: 0.3
        },
        recommendation: {
          monthlyIncome: 10000,
          monthlyFixedExpense: 3000,
          disposableIncome: 7000,
          savingsAmount: 2000,
          flexibleBudget: 5000,
          distributionVersion: 2,
          flexibleWeights: {
            餐饮: 0.26,
            交通: 0.16,
            通讯网络: 0.12,
            家庭生活: 0.24,
            娱乐社交: 0.12,
            学习成长: 0.1
          },
          categoryBudgets: [
            { category: '固定支出', amount: 3000, ratio: 0.3 },
            { category: '储蓄/投资', amount: 2000, ratio: 0.2 },
            { category: '餐饮', amount: 1300, ratio: 0.13 },
            { category: '交通', amount: 800, ratio: 0.08 },
            { category: '购物日用', amount: 1450, ratio: 0.145 },
            { category: '保险', amount: 1450, ratio: 0.145 }
          ]
        },
        confirmedAt: '2026-10-01T00:00:00.000Z'
      }
    });

    renderPage();

    const diningCard = screen
      .getAllByRole('button', { name: /已花费/ })
      .find((card) => within(card).getByRole('heading').textContent === '餐饮');
    expect(diningCard).toBeDefined();

    act(() => {
      fireEvent.click(within(diningCard as HTMLElement).getByRole('button', { name: /调整预算/ }));
    });

    const input = screen.getByLabelText('餐饮预算金额');
    act(() => {
      fireEvent.change(input, { target: { value: '1500' } });
      fireEvent.blur(input);
    });

    const plan = useSmartBudgetStore.getState().confirmedPlan;
    const dining = plan?.recommendation.categoryBudgets.find((item) => item.category === '餐饮');
    expect(dining?.amount).toBe(1500);

    const total = plan?.recommendation.categoryBudgets.reduce((sum, item) => sum + item.amount, 0);
    expect(total).toBe(plan?.recommendation.monthlyIncome);
  });
});
