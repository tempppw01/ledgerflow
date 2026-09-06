import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { RepaymentManagementPage } from './RepaymentManagementPage';

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  sendAiChat: vi.fn()
}));

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
    vi.mocked(sendAiChat).mockReset();
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

  it('月收入设置只保留手动填写，不再展示 AI 智能估算', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /AI 智能估算/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('手动月收入'), { target: { value: '8000' } });
    fireEvent.click(screen.getByRole('button', { name: '保存收入' }));

    expect(appPreferencesMock.state.setMonthlyIncome).toHaveBeenCalledWith(8000);
  });

  it('应支持使用微粒贷预设快速开始录入', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.click(screen.getByRole('button', { name: '使用微粒贷模板' }));

    expect(screen.getByDisplayValue('微粒贷')).toBeInTheDocument();
    expect(screen.getByLabelText('负债类型')).toHaveValue('loan');
    expect(screen.getByLabelText('年化利率')).toHaveValue(null);
    expect(screen.getByLabelText('剩余期数')).toHaveValue(null);
    expect(screen.getByText(/微粒贷模板已带入/)).toBeInTheDocument();
    expect(
      document.querySelector(
        'img[src="https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/public/webank.png"]'
      )
    ).toBeInTheDocument();
  });

  it('保存微粒贷模板后应把品牌图标写入负债数据', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.click(screen.getByRole('button', { name: '使用微粒贷模板' }));
    fireEvent.change(screen.getByLabelText('剩余本金'), { target: { value: '1800' } });
    fireEvent.change(screen.getByLabelText('年化利率'), { target: { value: '7.2' } });
    fireEvent.change(screen.getByLabelText('剩余期数'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '+ 添加负债' }));

    expect(appPreferencesMock.state.addDebt).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '微粒贷',
        iconUrl: 'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/public/webank.png'
      })
    );
  });

  it('应展示常见贷款模板并将截图识别结果匹配到对应模板', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        debts: [
          {
            name: '花呗分期',
            type: 'credit-card',
            balance: 3200,
            remainingMonths: 8,
            annualRate: 6.5,
            repaymentDay: 10
          },
          {
            name: '京东金条',
            type: 'credit-card',
            balance: 1800
          }
        ]
      }),
      reasoning: ''
    });

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    expect(screen.getByRole('button', { name: '使用借呗模板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用花呗模板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用京东金条模板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用信用卡分期模板' })).toBeInTheDocument();

    const file = new File(['bill'], 'bill.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传负债截图'), {
      target: { files: [file] }
    });

    await waitFor(() => expect(appPreferencesMock.state.replaceDebts).toHaveBeenCalledTimes(1));
    expect(appPreferencesMock.state.replaceDebts).toHaveBeenCalledWith([
      expect.objectContaining({
        name: '花呗分期',
        type: 'consumer-loan',
        balance: 3200,
        annualRate: 6.5,
        remainingMonths: 8,
        repaymentDay: 10,
        repaymentMethod: 'custom'
      }),
      expect.objectContaining({
        name: '京东金条',
        type: 'loan',
        balance: 1800,
        annualRate: undefined,
        remainingMonths: undefined
      })
    ]);
    expect(screen.getByText(/已推荐：花呗、京东金条/)).toBeInTheDocument();
  });

  it('单笔截图识别时应自动推荐模板并带入新增表单', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        debts: [
          {
            name: '微粒贷',
            type: 'credit-card',
            balance: 5800,
            annualRate: 7.2,
            remainingMonths: 10,
            repaymentDay: 15
          }
        ]
      }),
      reasoning: ''
    });

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    const file = new File(['bill'], 'weilidai.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传负债截图'), {
      target: { files: [file] }
    });

    await waitFor(() => expect(screen.getByDisplayValue('微粒贷')).toBeInTheDocument());
    expect(screen.getByLabelText('负债类型')).toHaveValue('loan');
    expect(screen.getByLabelText('剩余本金')).toHaveValue(5800);
    expect(screen.getByLabelText('年化利率')).toHaveValue(7.2);
    expect(screen.getByLabelText('剩余期数')).toHaveValue(10);
    expect(screen.getByLabelText('还款日')).toHaveValue(15);
    expect(screen.getByText(/自动推荐微粒贷模板/)).toBeInTheDocument();
    expect(appPreferencesMock.state.replaceDebts).not.toHaveBeenCalled();
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

  it('应显示当前负债在进行中项目里的年化利率排名', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-high-rate',
        name: '高利率贷款',
        type: 'loan',
        status: 'active',
        balance: 3000,
        annualRate: 10.56,
        remainingMonths: 12,
        repaymentDay: 10
      },
      {
        id: 'debt-low-rate',
        name: '低利率贷款',
        type: 'loan',
        status: 'active',
        balance: 5000,
        annualRate: 4.2,
        remainingMonths: 12,
        repaymentDay: 20
      },
      {
        id: 'debt-settled-rate',
        name: '已结清贷款',
        type: 'loan',
        status: 'settled',
        balance: 0,
        annualRate: 20,
        remainingMonths: 12
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('年化利率（APR）')).toBeInTheDocument();
    expect(screen.getByText('10.56%')).toBeInTheDocument();
    expect(screen.getByText('年化排名 第 1 / 2')).toBeInTheDocument();
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
    expect(screen.queryByRole('dialog', { name: '新增负债' })).not.toBeInTheDocument();
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
