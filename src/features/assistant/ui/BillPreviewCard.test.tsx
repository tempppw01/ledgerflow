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
    expect(screen.getByText(/选择账户/)).toBeInTheDocument();
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
});
