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

  it('外币账单提供确认原币保存入口', () => {
    const onUpdateEntry = vi.fn();
    const usdEntry: DraftBillEntry = {
      ...entry,
      id: 'draft-usd',
      amount: 20.5,
      currency: 'USD',
      currencyConfirmed: false,
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

    fireEvent.click(screen.getByRole('button', { name: '确认按人民币金额入账' }));

    expect(onUpdateEntry).toHaveBeenCalledWith('draft-usd', { currencyConfirmed: true });
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
      currency: 'USD'
    });
  });
});
