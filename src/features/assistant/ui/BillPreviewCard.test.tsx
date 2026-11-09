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

  it('CNY 币种置信度不足时提供确认币种入口', () => {
    const onUpdateEntry = vi.fn();
    const cnyEntry: DraftBillEntry = {
      ...entry,
      id: 'draft-cny',
      currency: 'CNY',
      currencyConfirmed: false,
      issues: [
        {
          field: 'currency',
          message: 'AI 对币种的置信度不足,需人工确认后保存。',
          needsReview: true
        }
      ]
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

    expect(onUpdateEntry).toHaveBeenCalledWith('draft-cny', { currencyConfirmed: true });
  });
});
