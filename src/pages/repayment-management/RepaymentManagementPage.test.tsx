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
  useFinanceStore: (selector: (state: { transactions: never[]; accounts: { id: string; name: string }[] }) => unknown) =>
    selector({
      transactions: [],
      accounts: [{ id: 'account-1', name: '工资卡' }]
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

  it('应支持从未来还款卡片快捷设置还款日', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-2',
        name: '待补日期消费贷',
        type: 'consumer-loan',
        status: 'active',
        balance: 1800,
        customMinPayment: 180
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '设置待补日期消费贷还款日' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '待补日期消费贷还款日' }), {
      target: { value: '15' }
    });
    fireEvent.click(screen.getByText('保存', { exact: true }));

    expect(appPreferencesMock.state.updateDebt).toHaveBeenCalledWith(
      'debt-2',
      expect.objectContaining({ repaymentDay: 15 })
    );
  });

  it('贷款填写借款金额、总期数和已还期数后应自动计算剩余本金', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.change(screen.getByLabelText('负债类型'), { target: { value: 'loan' } });
    fireEvent.change(screen.getByLabelText('负债名称'), { target: { value: '测试贷款' } });
    fireEvent.click(screen.getByText('更多设置', { exact: true }));
    fireEvent.change(screen.getByLabelText('剩余期数'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('年化利率'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('总期数'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('已还期数'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('借款金额'), { target: { value: '4129' } });

    expect(screen.getByLabelText('剩余本金')).toHaveValue(1376.33);
    expect(screen.getByText(/已自动估算：¥1376\.33/)).toBeInTheDocument();
  });

  it('扣款账户来自已有账户候补且可以留空提交', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    const accountInput = screen.getByLabelText('扣款账户');
    const datalist = document.getElementById('repayment-account-options');
    expect(accountInput).toHaveValue('');
    expect(datalist?.querySelector('option')?.getAttribute('value')).toBe('工资卡');

    fireEvent.change(screen.getByLabelText('负债名称'), { target: { value: '无账户负债' } });
    fireEvent.change(screen.getByLabelText('剩余本金'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '+ 添加负债' }));

    expect(appPreferencesMock.state.addDebt).toHaveBeenCalledWith(
      expect.objectContaining({ name: '无账户负债', paymentAccount: undefined })
    );
  });

  it('编辑零余额负债时本金输入保持为空，输入 1 不会变成 01', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-zero',
        name: '待补本金负债',
        type: 'credit-card',
        status: 'active',
        balance: 0
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '✏️ 编辑' }));
    const balanceInput = screen.getByLabelText('剩余本金');
    expect(balanceInput).toHaveValue(null);

    fireEvent.change(balanceInput, { target: { value: '01' } });
    expect(balanceInput).toHaveValue(1);
  });

  it('新增负债表单不再展示宽限期', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    expect(screen.queryByText('宽限期')).not.toBeInTheDocument();
  });
});
