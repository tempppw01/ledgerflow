import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BillPreviewCard } from './BillPreviewCard';
import type { DraftBillEntry } from '../workbench/workbenchTypes';

const entry: DraftBillEntry = {
  id: 'draft-1',
  selected: true,
  type: 'expense',
  amount: 149,
  date: '2026-09-26',
  note: '东城万达 吃饭',
  category: '餐饮',
  account: '',
  tags: [],
  currency: 'CNY',
  issues: []
};

describe('BillPreviewCard', () => {
  it('用易读的账单信息呈现识别结果，并提供明确保存操作', () => {
    render(
      <BillPreviewCard
        entries={[entry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={vi.fn(() => true)}
      />
    );

    expect(screen.getByText('东城万达 吃饭')).toBeInTheDocument();
    expect(screen.getByText(/支出/)).toBeInTheDocument();
    expect(screen.getByText(/未指定账户/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存到账本' })).toBeInTheDocument();
    expect(screen.queryByText('expense')).not.toBeInTheDocument();
  });

  it('保存成功后通知外层完成回调', () => {
    const onSaved = vi.fn();
    render(
      <BillPreviewCard
        entries={[entry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={vi.fn(() => true)}
        onSaved={onSaved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '保存到账本' }));

    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('保存中显示明确状态并阻止重复提交', () => {
    const onSave = vi.fn(() => true);
    render(
      <BillPreviewCard
        entries={[entry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={onSave}
        saving
      />
    );

    const saveButton = screen.getByRole('button', { name: '保存中' });

    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(saveButton);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('同步保存失败后仍可再次点击重试', () => {
    const onSave = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onSaved = vi.fn();
    render(
      <BillPreviewCard
        entries={[entry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={onSave}
        onSaved={onSaved}
      />
    );

    const saveButton = screen.getByRole('button', { name: '保存到账本' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('外币账单先显示原币,并要求填写人民币入账金额', () => {
    const onUpdateEntry = vi.fn();
    const usdEntry: DraftBillEntry = {
      ...entry,
      id: 'draft-usd',
      amount: 20.5,
      currency: 'USD',
      currencyConfirmed: false,
      originalAmountText: '$20.50',
      issues: [
        {
          field: 'currency',
          message: '检测到外币 USD,当前不会自动换算成人民币,请确认后再保存。'
        }
      ]
    };

    render(
      <BillPreviewCard
        entries={[usdEntry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={vi.fn(() => true)}
        onUpdateEntry={onUpdateEntry}
      />
    );

    expect(screen.getByText('US$20.50')).toBeInTheDocument();
    expect(screen.getByText('原币金额')).toBeInTheDocument();
    const conversionInput = screen.getByRole('spinbutton', { name: '人民币入账金额' });
    const confirmButton = screen.getByRole('button', { name: '确认人民币金额' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(conversionInput, { target: { value: '149.35' } });
    fireEvent.click(confirmButton);

    expect(onUpdateEntry).toHaveBeenCalledWith('draft-usd', {
      amount: 149.35,
      currencyConfirmed: true,
      originalAmountText: '$20.50'
    });
  });

  it('外币已确认后显示人民币入账金额和原币说明', () => {
    const usdEntry: DraftBillEntry = {
      ...entry,
      id: 'draft-usd-confirmed',
      amount: 149.35,
      currency: 'USD',
      currencyConfirmed: true,
      originalAmountText: '$20.50',
      issues: []
    };

    render(
      <BillPreviewCard
        entries={[usdEntry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={vi.fn(() => true)}
        onUpdateEntry={vi.fn()}
      />
    );

    expect(screen.getByText('¥149.35')).toBeInTheDocument();
    expect(screen.getByText('人民币入账')).toBeInTheDocument();
    expect(screen.getByText(/\$20\.50/)).toBeInTheDocument();
  });

  it('needsReview 标记为 currency 时,即使 CNY 暂无校验文案也提供确认入口', () => {
    const onUpdateEntry = vi.fn();
    const cnyEntry: DraftBillEntry = {
      ...entry,
      id: 'draft-cny',
      currency: 'CNY',
      currencyConfirmed: false,
      needsReview: ['currency'],
      issues: []
    };

    render(
      <BillPreviewCard
        entries={[cnyEntry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={vi.fn(() => true)}
        onUpdateEntry={onUpdateEntry}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '确认币种为 CNY' }));

    expect(screen.getByText('需人工确认:币种')).toBeInTheDocument();
    expect(onUpdateEntry).toHaveBeenCalledWith('draft-cny', { currencyConfirmed: true });
  });

  it.each(['US', 'U', '12'])(
    '非法币种 %s 不会让预览崩溃,并保留可见校验且不提供误导确认入口',
    (currency) => {
      const invalidEntry: DraftBillEntry = {
        ...entry,
        id: `draft-${currency}`,
        currency,
        issues: [
          {
            field: 'currency',
            message: `币种 ${currency} 无效,请选择 3 位国际代码,如 USD、HKD、JPY。`
          }
        ]
      };

      expect(() =>
        render(
          <BillPreviewCard
            entries={[invalidEntry]}
            duplicateCount={0}
            onCheckDuplicates={vi.fn()}
            onSave={vi.fn(() => true)}
            onUpdateEntry={vi.fn()}
          />
        )
      ).not.toThrow();

      expect(screen.getByText(new RegExp(`币种 ${currency} 无效`))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /确认/ })).not.toBeInTheDocument();
    }
  );

  it('币种编辑只写入规范代码,并允许从非法历史值修复', () => {
    const onUpdateEntry = vi.fn();
    const invalidEntry: DraftBillEntry = {
      ...entry,
      id: 'draft-invalid-currency',
      currency: 'US',
      issues: [
        {
          field: 'currency',
          message: '币种 US 无效,请选择 3 位国际代码,如 USD、HKD、JPY。'
        }
      ]
    };

    render(
      <BillPreviewCard
        entries={[invalidEntry]}
        duplicateCount={0}
        onCheckDuplicates={vi.fn()}
        onSave={vi.fn(() => true)}
        onUpdateEntry={onUpdateEntry}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const currencySelect = screen.getByRole('combobox', { name: '币种' });

    expect(currencySelect).toHaveValue('US');
    expect(screen.getByRole('option', { name: 'US（无效,请重选）' })).toBeInTheDocument();

    fireEvent.change(currencySelect, { target: { value: 'USD' } });

    expect(onUpdateEntry).toHaveBeenCalledWith('draft-invalid-currency', {
      currency: 'USD',
      needsReview: ['amount', 'currency']
    });
  });

  it('保存前展示自动匹配的账户,避免预览与落库不一致', () => {
    render(
      <BillPreviewCard
        entries={[
          {
            ...entry,
            note: '今天午餐 28 元 微信支付',
            account: ''
          }
        ]}
        duplicateCount={0}
        accounts={[{ id: 'acc-wx', name: '微信钱包' }]}
        onCheckDuplicates={vi.fn()}
        onSave={vi.fn(() => true)}
      />
    );

    expect(screen.getByText(/微信钱包\(自动匹配\)/)).toBeInTheDocument();
    expect(screen.queryByText(/未指定账户/)).not.toBeInTheDocument();
  });
});
