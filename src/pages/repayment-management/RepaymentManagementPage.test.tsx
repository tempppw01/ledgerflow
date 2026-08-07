import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import { RepaymentManagementPage } from './RepaymentManagementPage';

vi.mock('../../shared/store/useAiSettings', () => ({
  useAiSettings: () => ({
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test'
  })
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: { transactions: never[] }) => unknown) =>
    selector({
      transactions: []
    })
}));

const appPreferencesMock = vi.hoisted(() => ({
  state: {
    debts: [] as DebtItem[],
    repaymentRecords: [] as RepaymentRecord[],
    monthlyIncome: 0,
    setMonthlyIncome: vi.fn(),
    addDebt: vi.fn(),
    addRepaymentRecord: vi.fn(),
    replaceDebts: vi.fn(),
    removeDebt: vi.fn(),
    removeRepaymentRecord: vi.fn(),
    updateDebt: vi.fn()
  }
}));

vi.mock('../../shared/store/useAppPreferences', () => ({
  useAppPreferences: () => appPreferencesMock.state
}));

describe('RepaymentManagementPage', () => {
  beforeEach(() => {
    appPreferencesMock.state.debts = [];
    appPreferencesMock.state.repaymentRecords = [];
    appPreferencesMock.state.monthlyIncome = 0;
    appPreferencesMock.state.setMonthlyIncome = vi.fn();
    appPreferencesMock.state.addDebt = vi.fn();
    appPreferencesMock.state.addRepaymentRecord = vi.fn();
    appPreferencesMock.state.replaceDebts = vi.fn();
    appPreferencesMock.state.removeDebt = vi.fn();
    appPreferencesMock.state.removeRepaymentRecord = vi.fn();
    appPreferencesMock.state.updateDebt = vi.fn();
  });

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

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));

    expect(screen.getByRole('dialog', { name: '新增负债' })).toBeInTheDocument();
    expect(screen.getByLabelText('负债状态')).toHaveValue('active');
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('已结清')).toBeInTheDocument();
    expect(screen.getByText('已关闭')).toBeInTheDocument();
    expect(screen.getByText('暂缓处理')).toBeInTheDocument();
  });

  it('应支持从未来还款快捷标记当期已还并同步余额', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-1',
        name: '测试消费贷',
        type: 'consumer-loan',
        status: 'active',
        balance: 5000,
        customMinPayment: 500,
        repaymentDay: 18,
        totalPeriods: 12,
        paidPeriods: 2,
        remainingMonths: 10,
        paymentAccount: '工资卡',
        repaymentRecordMode: 'auto-debit'
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '标记测试消费贷本期已还' }));

    expect(appPreferencesMock.state.addRepaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        debtId: 'debt-1',
        amount: 500,
        paymentAccount: '工资卡',
        recordMode: 'auto-debit'
      })
    );
    expect(appPreferencesMock.state.updateDebt).toHaveBeenCalledWith(
      'debt-1',
      expect.objectContaining({
        balance: 4500,
        paidPeriods: 3,
        remainingMonths: 9
      })
    );
  });
});
