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
        columnWidths={{}}
        onColumnResize={() => undefined}
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

  /*
   * WCAG 2.5.7(拖拽移动,AA):列宽原来只能拖表头。方向键解决的是 2.1.1,
   * 而 2.5.7 要的是**单指、非拖拽**的入口,所以这里必须是能点的按钮。
   */
  it('点「加宽」按钮改列宽,不依赖拖拽;没设置过宽度的列按最小宽度起算', () => {
    const onColumnResize = vi.fn();
    renderFilters({
      columnOptions: columns,
      columnOrder: ['date', 'type', 'note'],
      columnWidths: {},
      onColumnResize
    });
    fireEvent.click(screen.getByRole('button', { name: '筛选设置' }));

    fireEvent.click(screen.getByRole('button', { name: '加宽 日期' }));
    expect(onColumnResize).toHaveBeenCalledWith('date', 90 + 16);
  });

  it('已设置过宽度的列从当前宽度起算,不是回到最小值', () => {
    const onColumnResize = vi.fn();
    renderFilters({
      columnOptions: columns,
      columnOrder: ['date', 'type', 'note'],
      columnWidths: { note: 200 },
      onColumnResize
    });
    fireEvent.click(screen.getByRole('button', { name: '筛选设置' }));

    fireEvent.click(screen.getByRole('button', { name: '加宽 备注' }));
    expect(onColumnResize).toHaveBeenCalledWith('note', 216);

    fireEvent.click(screen.getByRole('button', { name: '收窄 备注' }));
    expect(onColumnResize).toHaveBeenCalledWith('note', 184);
  });

  it('已经到边界的列,对应按钮禁用(点不出无变化的动作)', () => {
    renderFilters({
      columnOptions: columns,
      columnOrder: ['date', 'type', 'note'],
      // 备注已在最窄(90),日期已在最宽(640)
      columnWidths: { note: 90, date: 640 }
    });
    fireEvent.click(screen.getByRole('button', { name: '筛选设置' }));

    expect(screen.getByRole('button', { name: '收窄 备注' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '加宽 备注' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '加宽 日期' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '收窄 日期' })).not.toBeDisabled();
  });
});
