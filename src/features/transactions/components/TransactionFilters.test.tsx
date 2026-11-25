import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TransactionFilters } from './TransactionFilters';

function renderFilters(overrides: Partial<ComponentProps<typeof TransactionFilters>> = {}) {
  return render(
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
        columnOrder={['date']}
        onColumnReorder={() => undefined}
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
        onQuickAdd={() => undefined}
        privacyMode={false}
        onTogglePrivacy={() => undefined}
        sidePanelVisible
        onToggleSidePanel={() => undefined}
        {...overrides}
      />
    </MemoryRouter>
  );
}

describe('TransactionFilters', () => {
  it('在自定义日期模式下展示开始和结束日期选择器', () => {
    renderFilters();

    /*
     * 用正则而不是全等:日期按钮的可访问名是「<占位符>, 筛选开始日期」——
     * 把屏幕上的占位符放在最前面,才满足 2.5.3(可访问名要包含可见文字)。
     */
    expect(screen.getByRole('button', { name: /筛选开始日期/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /筛选结束日期/ })).toBeInTheDocument();
  });

  it('应在次级栏直接展示批量与隐私快捷开关', () => {
    renderFilters();

    expect(screen.getByRole('button', { name: '批量操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '隐私模式' })).toBeInTheDocument();
  });

  it('打开高级筛选对话框后展示分区设置与导入整理操作', () => {
    renderFilters();

    fireEvent.click(screen.getByRole('button', { name: '筛选设置' }));

    expect(screen.getByRole('dialog', { name: '筛选与显示设置' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '来源筛选' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '表格显示' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '导入与整理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检测重复' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入微信' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入支付宝' })).toBeInTheDocument();
  });

  it('点击完成后关闭高级筛选对话框', () => {
    renderFilters();

    fireEvent.click(screen.getByRole('button', { name: '筛选设置' }));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    expect(screen.queryByRole('dialog', { name: '筛选与显示设置' })).not.toBeInTheDocument();
  });
});

/*
 * WCAG 2.5.7(拖拽移动,AA):列序原来只能在表头拖。
 * 设置面板里的上移/下移必须是真能用的等价入口,并且首尾要禁用。
 */
describe('列序:不依赖拖拽的上移/下移', () => {
  const columns = [
    { key: 'date' as const, label: '日期' },
    { key: 'type' as const, label: '类型' },
    { key: 'note' as const, label: '备注' }
  ];

  it('点「上移」把当前列移到上一列的key上,并调用同一个 onColumnReorder', () => {
    const onColumnReorder = vi.fn();
    renderFilters({ columnOptions: columns, columnOrder: ['date', 'type', 'note'], onColumnReorder });
    fireEvent.click(screen.getByRole('button', { name: '筛选设置' }));

    fireEvent.click(screen.getByRole('button', { name: '上移 类型' }));
    expect(onColumnReorder).toHaveBeenCalledWith('type', 'date');

    fireEvent.click(screen.getByRole('button', { name: '下移 类型' }));
    expect(onColumnReorder).toHaveBeenCalledWith('type', 'note');
  });

  it('首项不能再上移、末项不能再下移(按钮禁用)', () => {
    renderFilters({ columnOptions: columns, columnOrder: ['date', 'type', 'note'] });
    fireEvent.click(screen.getByRole('button', { name: '筛选设置' }));

    expect(screen.getByRole('button', { name: '上移 日期' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移 备注' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移 日期' })).not.toBeDisabled();
  });
});
