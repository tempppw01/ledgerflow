import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionTable } from './TransactionTable';

describe('TransactionTable', () => {
  it('日期快捷筛选输入应用可用日期范围', () => {
    render(
      <TransactionTable
        rows={[]}
        total={0}
        filteredTotal={0}
        page={1}
        pages={1}
        pageSize={8}
        pageSizeOptions={[8, 20]}
        loading={false}
        hasFilters
        selectedIds={[]}
        bulkSelectionEnabled={false}
        canSelectAllOnPage={false}
        allPageSelected={false}
        sortKey="date"
        sortDirection="desc"
        quickFilters={{
          date: '',
          type: 'all',
          status: 'all',
          category: '',
          account: '',
          amountMin: '',
          amountMax: '',
          tags: '',
          merchant: '',
          orderNo: '',
          merchantOrderNo: '',
          note: ''
        }}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
        onPrevPage={vi.fn()}
        onNextPage={vi.fn()}
        onPageSizeChange={vi.fn()}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onDeleteSelected={vi.fn()}
        onBulkEditCategory={vi.fn()}
        onBulkAiRecategorize={vi.fn()}
        bulkAiRecategorizing={false}
        onBulkEditAccount={vi.fn()}
        categoryOptions={[]}
        accountOptions={[]}
        onClearSelection={vi.fn()}
        onToggleSelect={vi.fn()}
        onToggleSelectPage={vi.fn()}
        onSortChange={vi.fn()}
        onQuickFilterChange={vi.fn()}
        visibleColumns={{
          date: true,
          type: true,
          status: true,
          category: true,
          account: true,
          amount: true,
          orderNo: true,
          merchantOrderNo: true,
          note: true
        }}
        columnOrder={[
          'date',
          'type',
          'status',
          'category',
          'account',
          'amount',
          'orderNo',
          'merchantOrderNo',
          'note'
        ]}
        onColumnReorder={vi.fn()}
        columnWidths={{}}
        onColumnResize={vi.fn()}
        minAvailableDate="2026-02-01"
        maxAvailableDate="2026-02-28"
      />
    );

    const dateInput = screen.getByPlaceholderText('筛选日期');
    expect(dateInput).toHaveAttribute('min', '2026-02-01');
    expect(dateInput).toHaveAttribute('max', '2026-02-28');
  });

  it('批量 AI 重分类进行中时按钮可点击并展示停止状态', () => {
    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-1',
              date: '2026-02-10',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 88,
              note: '测试',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '现金'
          }
        ]}
        total={1}
        filteredTotal={1}
        page={1}
        pages={1}
        pageSize={8}
        pageSizeOptions={[8, 20]}
        loading={false}
        hasFilters
        selectedIds={['tx-1']}
        bulkSelectionEnabled
        canSelectAllOnPage
        allPageSelected
        sortKey="date"
        sortDirection="desc"
        quickFilters={{
          date: '',
          type: 'all',
          status: 'all',
          category: '',
          account: '',
          amountMin: '',
          amountMax: '',
          tags: '',
          merchant: '',
          orderNo: '',
          merchantOrderNo: '',
          note: ''
        }}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
        onPrevPage={vi.fn()}
        onNextPage={vi.fn()}
        onPageSizeChange={vi.fn()}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onDeleteSelected={vi.fn()}
        onBulkEditCategory={vi.fn()}
        onBulkAiRecategorize={vi.fn()}
        bulkAiRecategorizing
        onBulkEditAccount={vi.fn()}
        categoryOptions={[]}
        accountOptions={[]}
        onClearSelection={vi.fn()}
        onToggleSelect={vi.fn()}
        onToggleSelectPage={vi.fn()}
        onSortChange={vi.fn()}
        onQuickFilterChange={vi.fn()}
        visibleColumns={{
          date: true,
          type: true,
          status: true,
          category: true,
          account: true,
          amount: true,
          orderNo: true,
          merchantOrderNo: true,
          note: true
        }}
        columnOrder={[
          'date',
          'type',
          'status',
          'category',
          'account',
          'amount',
          'orderNo',
          'merchantOrderNo',
          'note'
        ]}
        onColumnReorder={vi.fn()}
        columnWidths={{}}
        onColumnResize={vi.fn()}
      />
    );

    const aiButton = screen.getByRole('button', { name: '⏹ 停止 AI 重分类' });
    expect(aiButton).toBeEnabled();
  });
});
