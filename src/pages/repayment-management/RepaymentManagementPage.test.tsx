import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RepaymentManagementPage } from './RepaymentManagementPage';

vi.mock('../../shared/store/useAiSettings', () => ({
  useAiSettings: () => ({
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test'
  })
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: any) => unknown) =>
    selector({
      transactions: []
    })
}));

vi.mock('../../shared/store/useAppPreferences', () => ({
  useAppPreferences: () => ({
    debts: [],
    repaymentRecords: [],
    monthlyIncome: 0,
    setMonthlyIncome: vi.fn(),
    addDebt: vi.fn(),
    addRepaymentRecord: vi.fn(),
    replaceDebts: vi.fn(),
    removeDebt: vi.fn(),
    removeRepaymentRecord: vi.fn(),
    updateDebt: vi.fn()
  })
}));

describe('RepaymentManagementPage', () => {
  it('应支持从 AI 信贷管家带入预填负债信息', () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/repayment-management',
            state: {
              prefillDebt: {
                name: '招商银行信用卡分期',
                type: 'credit-card',
                balance: '8000',
                repaymentDay: '12',
                totalPeriods: '12',
                remainingMonths: '12'
              }
            }
          }
        ]}
      >
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/已从 AI 信贷管家带入/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('招商银行信用卡分期')).toBeInTheDocument();
    expect(screen.getByLabelText('负债类型')).toHaveValue('credit-card');

    const repaymentDayInputs = screen.getAllByDisplayValue('12');
    expect(repaymentDayInputs.length).toBeGreaterThan(0);
  });

  it('应展示负债状态选项', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByLabelText('负债状态')).toHaveValue('active');
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('已结清')).toBeInTheDocument();
    expect(screen.getByText('已关闭')).toBeInTheDocument();
    expect(screen.getByText('暂缓处理')).toBeInTheDocument();
  });
});
