import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtItem, RepaymentRecord } from '../model/debtMetrics';
import { RepaymentAgentBar } from './RepaymentAgentBar';

const runCreditAgentCommand = vi.fn();
vi.mock('../../assistant/agent/creditAgentRunner', () => ({
  buildCreditAgentSystemPrompt: () => 'system-prompt',
  runCreditAgentCommand: (...args: unknown[]) => runCreditAgentCommand(...args)
}));

const debts: DebtItem[] = [
  {
    id: 'debt-card',
    name: '招商银行信用卡',
    type: 'credit-card',
    balance: 4200,
    repaymentDay: 12,
    status: 'active',
    entryMode: 'standard'
  }
];
const repaymentRecords: RepaymentRecord[] = [];

function renderBar() {
  return render(
    <RepaymentAgentBar
      baseUrl="https://example.test/v1"
      apiKey="sk-test"
      model="test-model"
      debts={debts}
      repaymentRecords={repaymentRecords}
      monthlyIncome={12000}
      addDebt={vi.fn(() => 'debt-new')}
      updateDebt={vi.fn()}
      removeDebt={vi.fn()}
      addRepaymentRecord={vi.fn(() => 'rec-new')}
      removeRepaymentRecord={vi.fn()}
      creditDrafts={[]}
      upsertCreditDraft={vi.fn(() => 'draft-new')}
      removeCreditDraft={vi.fn()}
    />
  );
}

describe('RepaymentAgentBar', () => {
  beforeEach(() => {
    runCreditAgentCommand.mockReset();
  });

  it('提交自然语言指令后展示回答与可撤销操作', async () => {
    const undo = vi.fn();
    runCreditAgentCommand.mockResolvedValue({
      content: '已为招商银行信用卡登记一笔 ¥300 还款。',
      reasoning: '',
      actions: [
        {
          id: 'act-1',
          kind: 'create',
          label: '已登记 招商银行信用卡 还款 ¥300.00,剩余待还 ¥3900.00',
          undoable: true
        }
      ],
      undo: [{ id: 'act-1', run: undo }]
    });

    renderBar();
    fireEvent.change(screen.getByLabelText('AI 台账助手'), {
      target: { value: '招行信用卡今天还了 300' }
    });
    fireEvent.click(screen.getByRole('button', { name: '执行' }));

    await waitFor(() =>
      expect(runCreditAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ text: '招行信用卡今天还了 300', model: 'test-model' })
      )
    );
    expect(await screen.findByText(/已为招商银行信用卡登记/)).toBeInTheDocument();
    expect(screen.getByText(/剩余待还 ¥3900.00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('撤销')).not.toBeInTheDocument());
  });

  it('缺少 API Key 时提示去设置页配置,不发起请求', async () => {
    render(
      <RepaymentAgentBar
        baseUrl="https://example.test/v1"
        apiKey=""
        model="test-model"
        debts={debts}
        repaymentRecords={repaymentRecords}
        monthlyIncome={12000}
        addDebt={vi.fn(() => 'debt-new')}
        updateDebt={vi.fn()}
        removeDebt={vi.fn()}
        addRepaymentRecord={vi.fn(() => 'rec-new')}
        removeRepaymentRecord={vi.fn()}
        creditDrafts={[]}
        upsertCreditDraft={vi.fn(() => 'draft-new')}
        removeCreditDraft={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '哪几笔最该先还?' }));
    expect(await screen.findByText(/请先在设置页配置/)).toBeInTheDocument();
    expect(runCreditAgentCommand).not.toHaveBeenCalled();
  });
});
