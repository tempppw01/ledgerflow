import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TransactionFilters } from './TransactionFilters';

describe('TransactionFilters', () => {
  it('在自定义日期模式下为日期输入设置可用区间', () => {
    render(
      <MemoryRouter>
        <TransactionFilters
          filters={{
            keyword: '',
            type: 'all',
            source: 'all',
            datePreset: 'custom',
            dateFrom: '',
            dateTo: '',
            page: 1
          }}
          onKeywordChange={() => undefined}
          onTypeChange={() => undefined}
          onSourceChange={() => undefined}
          onDatePresetChange={() => undefined}
          onDateFromChange={() => undefined}
          onDateToChange={() => undefined}
          onClear={() => undefined}
          onExport={() => undefined}
          onImportWechat={() => undefined}
          onImportAlipay={() => undefined}
          importMode="incremental"
          onImportModeChange={() => undefined}
          onCheckDuplicates={() => undefined}
          columnOptions={[{ key: 'date', label: '日期' }]}
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
          onToggleColumn={vi.fn()}
          bulkSelectionEnabled={false}
          onToggleBulkSelection={() => undefined}
          minAvailableDate="2026-02-01"
          maxAvailableDate="2026-02-28"
        />
      </MemoryRouter>
    );

    const fromInput = screen.getByLabelText('筛选开始日期');
    const toInput = screen.getByLabelText('筛选结束日期');

    expect(fromInput).toHaveAttribute('min', '2026-02-01');
    expect(fromInput).toHaveAttribute('max', '2026-02-28');
    expect(toInput).toHaveAttribute('min', '2026-02-01');
    expect(toInput).toHaveAttribute('max', '2026-02-28');
  });
});
