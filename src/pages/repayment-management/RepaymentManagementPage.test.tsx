import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { RepaymentManagementPage } from './RepaymentManagementPage';
import {
  ANYIHUA_ICON_URL,
  BAITIAO_ICON_URL,
  FANGXINJIE_ICON_URL,
  JIEBEI_ICON_URL,
  QIFUJIETIAO_ICON_URL,
  WEBANK_ICON_URL
} from '../../shared/config/brandAssets';

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
  useFinanceStore: (
    selector: (state: {
      transactions: never[];
      accounts: { id: string; name: string }[];
    }) => unknown
  ) =>
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
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    window.localStorage.removeItem('ledgerflow-repayment-collapse-state-v1');
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
                annualRate: '18.25',
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
    expect(screen.getByLabelText('年化利率')).toHaveValue(18.25);

    const repaymentDayInputs = screen.getAllByDisplayValue('12');
    expect(repaymentDayInputs.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '+ 添加负债' }));
    expect(appPreferencesMock.state.addDebt).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'credit-card',
        annualRate: 18.25,
        repaymentDay: 12
      })
    );
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

  it('点击负债健康度说明应展示当前评分依据', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-health-info',
        name: '健康度测试贷款',
        type: 'loan',
        status: 'active',
        balance: 1800,
        annualRate: 7.2,
        remainingMonths: 12,
        repaymentDay: 10
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '负债健康度说明' }));

    expect(screen.getByRole('dialog', { name: '负债健康度说明' })).toBeInTheDocument();
    expect(screen.getByText(/尚未设置月收入/)).toBeInTheDocument();
    expect(screen.getByText(/不是征信评分/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭负债健康度说明' }));
    expect(screen.queryByRole('dialog', { name: '负债健康度说明' })).not.toBeInTheDocument();
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
      document.querySelector(`img[src="${WEBANK_ICON_URL}"]`)
    ).toBeInTheDocument();
  });

  it('应支持使用抖音放心借预设快速开始录入', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.click(screen.getByRole('button', { name: '使用抖音放心借模板' }));

    expect(screen.getByDisplayValue('抖音放心借')).toBeInTheDocument();
    expect(screen.getByLabelText('负债类型')).toHaveValue('loan');
    expect(screen.getByText(/抖音放心借模板已带入/)).toBeInTheDocument();
    expect(
      document.querySelector(`img[src="${FANGXINJIE_ICON_URL}"]`)
    ).toBeInTheDocument();
  });

  it('应支持使用奇富借条预设快速开始录入并带入品牌图标', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.click(screen.getByRole('button', { name: '使用奇富借条模板' }));

    expect(screen.getByDisplayValue('奇富借条')).toBeInTheDocument();
    expect(screen.getByLabelText('负债类型')).toHaveValue('loan');
    expect(screen.getByText(/奇富借条模板已带入/)).toBeInTheDocument();
    expect(document.querySelector(`img[src="${QIFUJIETIAO_ICON_URL}"]`)).toBeInTheDocument();
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
        iconUrl: WEBANK_ICON_URL
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
    expect(screen.getByRole('button', { name: '使用京东白条模板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用京东金条模板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用安逸花模板' })).toBeInTheDocument();
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

  it('应为借呗、京东白条和安逸花模板带入品牌图标', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.click(screen.getByRole('button', { name: '使用借呗模板' }));
    expect(document.querySelector(`img[src="${JIEBEI_ICON_URL}"]`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '使用京东白条模板' }));
    expect(document.querySelector(`img[src="${BAITIAO_ICON_URL}"]`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '使用安逸花模板' }));
    expect(document.querySelector(`img[src="${ANYIHUA_ICON_URL}"]`)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: '登记测试消费贷本期还款' }));

    const confirmDialog = screen.getByRole('dialog', { name: '确认登记本期还款' });
    expect(confirmDialog).toBeInTheDocument();
    expect(confirmDialog).toHaveTextContent('本次登记金额');
    expect(confirmDialog).toHaveTextContent('¥500.00');
    expect(appPreferencesMock.state.addRepaymentRecord).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认登记 ¥500.00' }));

    expect(appPreferencesMock.state.addRepaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        debtId: 'debt-1',
        amount: 500,
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

  it('负债列表展示本期应还，删除前需要再次确认', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-delete-confirm',
        name: '待确认删除贷款',
        type: 'loan',
        status: 'active',
        balance: 1200,
        annualRate: 0,
        remainingMonths: 4,
        repaymentDay: 15
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('本期应还 ¥300.00')).toBeInTheDocument();
    const debtListItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.repayment-debt-list-item')
    ).find((item) => item.textContent?.includes('待确认删除贷款'));
    expect(debtListItem).toBeTruthy();
    fireEvent.click(debtListItem!);
    fireEvent.click(screen.getByRole('button', { name: '🗑 删除' }));

    expect(screen.getByRole('dialog', { name: '删除负债记录' })).toBeInTheDocument();
    expect(appPreferencesMock.state.removeDebt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(appPreferencesMock.state.removeDebt).toHaveBeenCalledWith('debt-delete-confirm');
  });

  it('应显示当前负债在进行中项目里的年化利率排名', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 9, 12));
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

  it('贷款详情使用本期应还和剩余期数，不展示最低还款或重复月供', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'fixed-installment-loan',
        name: '固定扣款贷款',
        type: 'loan',
        status: 'active',
        balance: 2400,
        annualRate: 7.2,
        remainingMonths: 8,
        repaymentDay: 10,
        repaymentMethod: 'minimum-payment'
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      Array.from(document.querySelectorAll('.repayment-debt-metric-label')).some(
        (node) => node.textContent === '本期应还'
      )
    ).toBe(true);
    expect(screen.getByText('剩余期数')).toBeInTheDocument();
    expect(screen.queryByText('最低/期供')).not.toBeInTheDocument();
    expect(screen.queryByText('预计月供')).not.toBeInTheDocument();
  });

  it('不再显示账单日和扣款账户字段', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    expect(screen.queryByLabelText('账单日')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('扣款账户')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('实际扣款账户')).not.toBeInTheDocument();
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

  it('会按负债记住更多详情的展开状态', async () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-collapse-details',
        name: '展开状态测试贷款',
        type: 'loan',
        status: 'active',
        balance: 1800,
        annualRate: 7.2,
        remainingMonths: 12,
        repaymentDay: 10
      }
    ];

    const page = () => (
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );
    const firstRender = render(page());
    const details = screen.getByText('更多详情', { exact: true }).closest('details');

    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('更多详情', { exact: true }));
    expect(details).toHaveAttribute('open');
    await waitFor(() => {
      expect(window.localStorage.getItem('ledgerflow-repayment-collapse-state-v1')).toContain(
        'debt-collapse-details'
      );
    });
    firstRender.unmount();

    render(page());
    expect(screen.getByText('更多详情', { exact: true }).closest('details')).toHaveAttribute(
      'open'
    );
  });

  it('会在重新打开页面后保留策略分析和表单更多设置的展开状态', async () => {
    const page = () => (
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );
    const firstRender = render(page());

    fireEvent.click(screen.getByText('查看完整分析', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.click(screen.getByText('更多设置', { exact: true }));

    expect(screen.getByText('查看完整分析', { exact: true }).closest('details')).toHaveAttribute(
      'open'
    );
    expect(screen.getByText('更多设置', { exact: true }).closest('details')).toHaveAttribute(
      'open'
    );
    await waitFor(() => {
      const savedState = window.localStorage.getItem('ledgerflow-repayment-collapse-state-v1');
      expect(savedState).toContain('"aiDetailsOpen":true');
      expect(savedState).toContain('"debtFormMoreSettingsOpen":true');
    });
    firstRender.unmount();

    render(page());
    await waitFor(() => {
      expect(screen.getByText('查看完整分析', { exact: true }).closest('details')).toHaveAttribute(
        'open'
      );
    });
    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    expect(screen.getByText('更多设置', { exact: true }).closest('details')).toHaveAttribute(
      'open'
    );
  });

  it('手动逐期计划从下一次还款日和已还期数后的期号开始', () => {
    const today = new Date();
    const expectedDate = new Date(today.getFullYear(), today.getMonth(), 23);
    if (expectedDate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      expectedDate.setMonth(expectedDate.getMonth() + 1);
    }
    const expectedDateText = `${expectedDate.getFullYear()}-${String(
      expectedDate.getMonth() + 1
    ).padStart(2, '0')}-${String(expectedDate.getDate()).padStart(2, '0')}`;

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.change(screen.getByLabelText('负债类型'), { target: { value: 'loan' } });
    fireEvent.click(screen.getByText('更多设置', { exact: true }));
    fireEvent.change(screen.getByLabelText('还款日'), { target: { value: '23' } });
    fireEvent.change(screen.getByLabelText('总期数'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('已还期数'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('tab', { name: '手动逐期' }));

    expect(screen.getByLabelText('还款日期')).toHaveTextContent(expectedDateText);
    expect(screen.getByLabelText('期数标签')).toHaveAttribute('placeholder', '第 9 期');
    expect(document.querySelector('.debt-form-manual-index')).toHaveTextContent(/^9$/);
  });

  it('手动添加期数时不沿用上一期金额', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    fireEvent.change(screen.getByLabelText('负债类型'), { target: { value: 'loan' } });
    fireEvent.click(screen.getByRole('tab', { name: '手动逐期' }));

    fireEvent.change(screen.getByLabelText('还款金额'), { target: { value: '6000' } });
    fireEvent.click(screen.getByRole('button', { name: '+ 添加期数' }));

    const amounts = screen.getAllByLabelText('还款金额');
    expect(amounts).toHaveLength(2);
    expect(amounts[0]).toHaveValue(6000);
    expect(amounts[1]).toHaveValue(null);
  });

  it('选中单笔负债时会展示内建的未来还款走势', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-with-trend',
        name: '走势测试贷款',
        type: 'loan',
        status: 'active',
        balance: 1800,
        annualRate: 7.2,
        remainingMonths: 12,
        repaymentDay: 10,
        repaymentMethod: 'equal-installment'
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('未来还款走势')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '走势测试贷款还款走势' })).toBeInTheDocument();
    // 期数文案现在由 tf('repayment.chart.futurePeriods', '未来 {count} 期') 组合出两个文本节点。
    expect(document.querySelector('.repayment-debt-trend-header')).toHaveTextContent('未来 12 期');
    expect(document.querySelector('.repayment-debt-trend-next')).toHaveTextContent('首期');
  });

  it('在还款走势底部显示计划对应的年月', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-with-dated-trend',
        name: '日期走势测试贷款',
        type: 'loan',
        status: 'active',
        balance: 1800,
        annualRate: 7.2,
        repaymentDay: 10,
        manualRepayments: [
          { id: 'schedule-1', dueDate: '2026-10-10', amount: 600, label: '' },
          { id: 'schedule-2', dueDate: '2026-11-10', amount: 600, label: '' },
          { id: 'schedule-3', dueDate: '2026-12-10', amount: 600, label: '' }
        ]
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    // 月份刻度改为跟随语言的 Intl 短月份(中文 `10月` / 英文 `Oct`)。
    const trendDates = document.querySelector('.debt-pressure-dates')!;
    expect(trendDates).toHaveTextContent('10月');
    expect(trendDates).toHaveTextContent('12月');
    expect(screen.getByText('其中利息')).toBeInTheDocument();
    expect(screen.getByText(/未来利息约/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: '查看还款期次' }), {
      target: { value: '1' }
    });
    expect(screen.getByRole('slider', { name: '查看还款期次' })).toHaveValue('1');
    fireEvent.click(screen.getByRole('button', { name: '还款后本金' }));
    expect(screen.getByRole('button', { name: '还款后本金' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const chart = screen
      .getByRole('slider', { name: '查看还款期次' })
      .closest('.debt-pressure-chart')!;
    fireEvent.pointerEnter(chart.querySelectorAll('.debt-pressure-hit-area')[2]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('还款后本金');
    expect(screen.getByRole('slider', { name: '查看还款期次' })).toHaveValue('2');
    fireEvent.pointerLeave(chart.querySelector('.debt-pressure-plot')!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('本期还清后,负债卡片展示已还与下期倒计时', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const paidAt = `${today.getFullYear()}-${month}-${day}`;

    appPreferencesMock.state.debts = [
      {
        id: 'debt-settled-cycle',
        name: '招商信用卡',
        type: 'credit-card',
        status: 'active',
        balance: 9600,
        repaymentDay: 10,
        remainingMonths: 12
      }
    ];
    appPreferencesMock.state.repaymentRecords = [
      {
        id: 'record-settled-cycle',
        debtId: 'debt-settled-cycle',
        amount: 1200,
        paidAt,
        recordMode: 'manual',
        createdAt: `${paidAt}T00:00:00.000Z`
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getAllByText(/本期已还 · 下期 \d+ 天后/).length).toBeGreaterThan(0);
  });

  /*
   * 结清 = 这笔债已经还完,剩余本金应当归零。
   * 原先详情面板里的「结清」只改状态不清本金:卡片上写着「已结清」,
   * 下面却还挂着 ¥12,860.40 剩余本金和一整张 12 期还款表。
   * 而右键菜单里的「结清」会清零,却没有任何确认。
   */
  it('结清先确认,确认后才把剩余本金清零', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-1',
        name: '招商银行信用卡',
        type: 'credit-card',
        status: 'active',
        balance: 12860.4,
        annualRate: 18.25,
        remainingMonths: 12,
        repaymentDay: 25,
        customMinPayment: 1286.04
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '结清' }));

    // 点一下不能就把本金清了;要先问,而且说清代价。
    expect(appPreferencesMock.state.updateDebt).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '结清这笔负债' })).toBeInTheDocument();
    expect(screen.getByText(/剩余本金 ¥12,860\.40 会清零/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认结清' }));

    expect(appPreferencesMock.state.updateDebt).toHaveBeenCalledWith(
      'debt-1',
      expect.objectContaining({ status: 'settled', balance: 0 })
    );
  });

  it('结清可以取消,取消后什么都不动', () => {
    appPreferencesMock.state.debts = [
      {
        id: 'debt-1',
        name: '招商银行信用卡',
        type: 'credit-card',
        status: 'active',
        balance: 12860.4,
        annualRate: 18.25,
        remainingMonths: 12,
        repaymentDay: 25
      }
    ];

    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '结清' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(appPreferencesMock.state.updateDebt).not.toHaveBeenCalled();
  });

  /*
   * 「错误要关联到出错的字段」。
   *
   * ⚠ 先说清楚这个表单的形态:提交按钮是 disabled={!canSubmitDebt},而 canSubmitDebt
   * 已经把大部分校验都覆盖了 —— 字段没填全时按钮**是禁用的**,点了根本不触发校验。
   * 所以 onAddDebt 里那些提示是**兜底**,不是主路径(主路径是禁用按钮 + 下方的缺项提示)。
   *
   * 真正"按钮可点但仍然失败"的只有两条:已还期数 > 总期数、借款金额/总还款非法,
   * 而且都得是贷款类型才渲染得出这些字段。所以这里就用第一条来验关联。
   */
  it('债务表单校验失败时把错误关联到出错的字段', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));

    fireEvent.change(screen.getByLabelText('负债名称'), { target: { value: '招商信用卡分期' } });
    fireEvent.change(screen.getByLabelText('剩余本金'), { target: { value: '12000' } });
    // 贷款类型才会渲染期数、年化利率这些字段
    fireEvent.change(screen.getByLabelText('负债类型'), { target: { value: 'loan' } });
    fireEvent.change(screen.getByLabelText('年化利率'), { target: { value: '18.25' } });
    fireEvent.change(screen.getByLabelText('剩余期数'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('总期数'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('已还期数'), { target: { value: '5' } });

    const submit = screen.getByRole('button', { name: '+ 添加负债' });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    expect(document.getElementById('debt-form-error')).toBeTruthy();
    const paid = screen.getByLabelText('已还期数');
    expect(paid).toHaveAttribute('aria-invalid', 'true');
    expect(paid).toHaveAttribute('aria-describedby', 'debt-form-error');
    // 错在已还期数,不该把总期数也标红
    expect(screen.getByLabelText('总期数')).not.toHaveAttribute('aria-invalid');
  });

  /*
   * 提交按钮是禁用的,所以「还差:…」这行提示就是**唯一的"为什么不能提交"**。
   * 它原来既没有 id 也没挂 role,读屏用户完全听不到 —— 这条钉住它可被感知。
   */
  it('缺项提示要能被读屏感知(role=status + 稳定 id)', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));

    const hint = document.getElementById('debt-form-hint');
    expect(hint).toBeTruthy();
    expect(hint).toHaveAttribute('role', 'status');
    expect(hint?.textContent).toContain('还差');
    // 按钮**不再禁用**:提示是主动告知,拦截改由点击后的字段级错误负责
    expect(screen.getByRole('button', { name: '+ 添加负债' })).not.toBeDisabled();
  });

  /*
   * 禁用按钮 → 可点 + 字段级报错(2026-11-27 的行为变更)。
   *
   * 原来按钮是 disabled={!canSubmitDebt}:字段没填全时它灰着,读屏只会念"不可用",
   * **不说明缺什么**。现在按钮可点,点了会走到 onAddDebt 的校验、给出具体哪一项不对,
   * 并把错误关联到出错的输入框。
   */
  it('什么都不填直接提交:给出字段级错误,且不会新增负债', () => {
    render(
      <MemoryRouter initialEntries={['/repayment-management']}>
        <Routes>
          <Route path="/repayment-management" element={<RepaymentManagementPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }));
    const before = appPreferencesMock.state.addDebt.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '+ 添加负债' }));

    // 具体错误出现在字段旁,并关联到出错的输入框
    const nameInput = screen.getByLabelText('负债名称');
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'debt-form-error');
    expect(document.getElementById('debt-form-error')?.textContent).toContain('负债名称');
    // 关键:校验拦住了,没有把空数据写进去
    expect(appPreferencesMock.state.addDebt.mock.calls.length).toBe(before);
  });
});
