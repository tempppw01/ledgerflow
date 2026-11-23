import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BudgetDetailDrawer } from './BudgetDetailDrawer';
import type { BudgetTrackingRow } from '../model/budgetInsights';
import type { BudgetCategoryDetail } from '../model/budgetDetail';

const row: BudgetTrackingRow = {
  category: '购物日用',
  budgetAmount: 1000,
  spentAmount: 900,
  ratio: 0.9,
  diff: -100,
  isOverspent: false
};

const detail: BudgetCategoryDetail = {
  category: '购物日用',
  budgetAmount: 1000,
  recentTransactions: [
    {
      id: 'refund-1',
      // 交易 date 是带时间的 ISO 瞬间。
      date: '2026-11-08T07:09:03.839Z',
      note: '退款:家居小物',
      amount: -390.55
    },
    {
      id: 'expense-1',
      date: '2026-11-03T00:00:00.000Z',
      note: '家居小物',
      amount: 390.55
    }
  ],
  monthlyPoints: [{ monthKey: '2026-11', spent: 900 }],
  totalSpentInWindow: 900,
  averageMonthlySpent: 900
};

describe('BudgetDetailDrawer', () => {
  it('退款显示成 +¥,而不是拼出 --¥;日期不再是原始 ISO 串', () => {
    render(<BudgetDetailDrawer row={row} detail={detail} onClose={vi.fn()} />);

    const items = screen.getAllByRole('listitem');
    const texts = items.map((item) => item.textContent?.replace(/\s+/g, ' ') ?? '');

    const refund = texts.find((text) => text.includes('退款:家居小物'));
    expect(refund).toBeDefined();
    // 修复前:`-${formatCurrency(-390.55)}` →「--¥390.55」
    expect(refund).toContain('+¥390.55');
    expect(refund).not.toContain('--');

    const expense = texts.find((text) => text.includes('家居小物') && !text.includes('退款'));
    expect(expense).toContain('-¥390.55');

    // 修复前:直接渲染 item.date,页面上是 2026-11-08T07:09:03.839Z。
    expect(texts.join(' ')).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
  });
});