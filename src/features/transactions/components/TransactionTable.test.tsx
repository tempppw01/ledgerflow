import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TransactionTable, type TransactionColumnKey } from './TransactionTable';
import { ALIPAY_LOGO_URL, WECHAT_LOGO_URL } from '../../../shared/config/brandAssets';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      const dict: Record<string, string> = {
        'transactions.bulk.selected': `已选 ${options?.count ?? 0} 条`,
        'transactions.bulk.category': '分类',
        'transactions.bulk.selectCategory': '选择分类',
        'transactions.bulk.aiRecategorize': '🤖 AI 重分类',
        'transactions.bulk.stopAiRecategorize': '⏹ 停止 AI 重分类',
        'transactions.bulk.account': '账户',
        'transactions.bulk.selectAccount': '选择账户',
        'transactions.bulk.template': '打印模板',
        'transactions.bulk.templateFull': '完整',
        'transactions.bulk.templateSummary': '摘要',
        'transactions.bulk.fields': '打印字段',
        'transactions.bulk.fieldsCustom': '自定义',
        'transactions.bulk.fieldsFull': '全部字段',
        'transactions.bulk.fieldsCompact': '精简字段',
        'transactions.bulk.fieldAccount': '账户',
        'transactions.bulk.fieldNote': '备注',
        'transactions.bulk.fieldOrderNo': '订单号',
        'transactions.bulk.fieldTags': '标签',
        'transactions.bulk.printA4': '🖨️ 打印 A4',
        'transactions.bulk.exportPdf': '📄 导出 PDF',
        'transactions.bulk.exportingPdf': '⏳ 正在导出 PDF…',
        'transactions.bulk.delete': '删除所选',
        'transactions.bulk.clearSelection': '清空选择'
      };
      return dict[key] || key;
    }
  })
}));

const baseProps = {
  onRetry: vi.fn(),
  onClearFilters: vi.fn(),
  onFirstPage: vi.fn(),
  onPrevPage: vi.fn(),
  onNextPage: vi.fn(),
  onLastPage: vi.fn(),
  onPageSizeChange: vi.fn(),
  onOpenDetail: vi.fn(),
  onShare: vi.fn(),
  onDelete: vi.fn(),
  onDeleteSelected: vi.fn(),
  onBulkEditCategory: vi.fn(),
  onBulkAiRecategorize: vi.fn(),
  bulkAiRecategorizing: false,
  onBulkEditAccount: vi.fn(),
  onClearSelection: vi.fn(),
  onToggleSelect: vi.fn(),
  onToggleSelectPage: vi.fn(),
  onSortChange: vi.fn(),
  onQuickFilterChange: vi.fn(),
  columnWidths: {},
  onColumnReorder: vi.fn(),
  onColumnResize: vi.fn(),
  quickFilters: {
    date: '',
    type: 'all' as const,
    status: 'all' as const,
    category: '',
    account: '',
    amountMin: '',
    amountMax: '',
    tags: '',
    merchant: '',
    location: '',
    orderNo: '',
    merchantOrderNo: '',
    note: ''
  },
  visibleColumns: {
    date: true,
    type: true,
    status: true,
    category: true,
    account: true,
    amount: true,
    orderNo: true,
    merchantOrderNo: true,
    note: true
  },
  columnOrder: [
    'date',
    'type',
    'status',
    'category',
    'account',
    'amount',
    'orderNo',
    'merchantOrderNo',
    'note'
  ] as TransactionColumnKey[],
  categoryOptions: [],
  accountOptions: []
};

describe('TransactionTable', () => {
  it('批量操作区应展示打印/PDF入口并支持模板与字段切换', async () => {
    const user = userEvent.setup();
    const onBulkPrintA4 = vi.fn();
    const onBulkExportPdf = vi.fn();
    const onBulkPrintTemplateChange = vi.fn();
    const onBulkPrintFieldsChange = vi.fn();

    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-1',
              date: '2026-03-10',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 88,
              note: '测试打印',
              tags: ['餐饮']
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
        onBulkPrintA4={onBulkPrintA4}
        onBulkExportPdf={onBulkExportPdf}
        bulkPrintTemplate="full"
        onBulkPrintTemplateChange={onBulkPrintTemplateChange}
        bulkPrintFields={{
          includeAccount: true,
          includeNote: true,
          includeOrderNo: false,
          includeTags: false
        }}
        onBulkPrintFieldsChange={onBulkPrintFieldsChange}
        {...baseProps}
      />
    );

    await user.click(screen.getByRole('button', { name: '🖨️ 打印 A4' }));
    expect(onBulkPrintA4).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '📄 导出 PDF' }));
    expect(onBulkExportPdf).toHaveBeenCalledTimes(1);

    await user.selectOptions(screen.getByDisplayValue('完整'), 'summary');
    expect(onBulkPrintTemplateChange).toHaveBeenCalledWith('summary');

    await user.click(screen.getByLabelText('订单号'));
    expect(onBulkPrintFieldsChange).toHaveBeenCalledWith({
      includeAccount: true,
      includeNote: true,
      includeOrderNo: true,
      includeTags: false
    });
  });

  it('批量导出 PDF 处理中应显示加载文案并禁用按钮', () => {
    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-1',
              date: '2026-03-10',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 88,
              note: '测试导出',
              tags: ['餐饮']
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
        onBulkExportPdf={vi.fn()}
        bulkExportingPdf
        {...baseProps}
      />
    );

    const exportButton = screen.getByRole('button', { name: '⏳ 正在导出 PDF…' });
    expect(exportButton).toBeDisabled();
  });

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
          location: '',
          orderNo: '',
          merchantOrderNo: '',
          note: ''
        }}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
        onFirstPage={vi.fn()}
        onPrevPage={vi.fn()}
        onNextPage={vi.fn()}
        onLastPage={vi.fn()}
        onPageSizeChange={vi.fn()}
        onOpenDetail={vi.fn()}
        onShare={vi.fn()}
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
          location: '',
          orderNo: '',
          merchantOrderNo: '',
          note: ''
        }}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
        onFirstPage={vi.fn()}
        onPrevPage={vi.fn()}
        onNextPage={vi.fn()}
        onLastPage={vi.fn()}
        onPageSizeChange={vi.fn()}
        onOpenDetail={vi.fn()}
        onShare={vi.fn()}
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

  it('展示分页首尾按钮与当前页汇总行', () => {
    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-income',
              date: '2026-03-10',
              type: 'income',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 200,
              note: '工资',
              tags: []
            },
            categoryName: '收入',
            accountName: '银行卡'
          },
          {
            item: {
              id: 'tx-expense',
              date: '2026-03-11',
              type: 'expense',
              categoryId: 'cat-2',
              accountId: 'acc-1',
              amount: 50,
              note: '午餐',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '银行卡'
          }
        ]}
        total={2}
        filteredTotal={2}
        page={2}
        pages={3}
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
          location: '',
          orderNo: '',
          merchantOrderNo: '',
          note: ''
        }}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
        onFirstPage={vi.fn()}
        onPrevPage={vi.fn()}
        onNextPage={vi.fn()}
        onLastPage={vi.fn()}
        onPageSizeChange={vi.fn()}
        onOpenDetail={vi.fn()}
        onShare={vi.fn()}
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
      />
    );

    expect(screen.getByRole('button', { name: '第一页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最后一页' })).toBeInTheDocument();
    expect(screen.getByText(/汇总（当前页 2 条）/)).toBeInTheDocument();
    expect(screen.getByText(/金额合计 ¥250.00/)).toBeInTheDocument();
  });

  it('隐私模式下应隐藏金额与商家订单号', () => {
    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-mask',
              date: '2026-03-12',
              type: 'expense',
              categoryId: 'cat-2',
              accountId: 'acc-1',
              amount: 188.66,
              note: '晚餐',
              orderNo: 'ORDER-12345678',
              merchantOrderNo: 'MERCHANT-99887766',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '银行卡'
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
        privacyMode
        selectedIds={[]}
        bulkSelectionEnabled={false}
        canSelectAllOnPage={false}
        allPageSelected={false}
        sortKey="date"
        sortDirection="desc"
        {...baseProps}
      />
    );

    expect(screen.getAllByText('¥••••').length).toBeGreaterThan(0);
    expect(screen.getByText(/商家订单：ME\*\*\*66/)).toBeInTheDocument();
  });

  it('应将收支显示为圆圈标签，并在支付宝账户展示图标', () => {
    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-income',
              date: '2026-03-12',
              type: 'income',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 300,
              note: '工资',
              tags: []
            },
            categoryName: '收入',
            accountName: '支付宝'
          },
          {
            item: {
              id: 'tx-wechat',
              date: '2026-03-14',
              type: 'expense',
              categoryId: 'cat-2',
              accountId: 'acc-3',
              amount: 18,
              note: '奶茶',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '微信'
          },
          {
            item: {
              id: 'tx-expense',
              date: '2026-03-13',
              type: 'expense',
              categoryId: 'cat-2',
              accountId: 'acc-2',
              amount: 42,
              note: '午餐',
              tags: [],
              attachments: [
                {
                  id: 'att-1',
                  name: 'receipt.jpg',
                  uploadedAt: '2026-03-13T10:00:00.000Z',
                  remotePath: '/receipts/receipt.jpg'
                }
              ]
            },
            categoryName: '餐饮',
            accountName: '现金'
          }
        ]}
        total={2}
        filteredTotal={2}
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
        {...baseProps}
      />
    );

    expect(screen.getByLabelText('收入')).toBeInTheDocument();
    expect(screen.getAllByLabelText('支出').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.alipay-icon').length).toBeGreaterThan(0);
    expect(document.querySelector('.alipay-icon')).toHaveAttribute('src', ALIPAY_LOGO_URL);
    expect(document.querySelectorAll('.wechat-icon').length).toBeGreaterThan(0);
    expect(document.querySelector('.wechat-icon')).toHaveAttribute('src', WECHAT_LOGO_URL);
    expect(screen.getAllByLabelText('有附件').length).toBeGreaterThan(0);
  });

  it('应为本月重复出现的收支展示角标，并忽略跨月与非收支类型', () => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`;

    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-repeat-1',
              date: `${thisMonth}-03`,
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 18,
              note: '美宜佳',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '现金'
          },
          {
            item: {
              id: 'tx-repeat-2',
              date: `${thisMonth}-11`,
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 26,
              note: ' 美宜佳 ',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '现金'
          },
          {
            item: {
              id: 'tx-repeat-income-1',
              date: `${thisMonth}-05`,
              type: 'income',
              categoryId: 'cat-2',
              accountId: 'acc-1',
              amount: 1000,
              note: '奖金',
              tags: []
            },
            categoryName: '收入',
            accountName: '银行卡'
          },
          {
            item: {
              id: 'tx-repeat-income-2',
              date: `${thisMonth}-15`,
              type: 'income',
              categoryId: 'cat-2',
              accountId: 'acc-1',
              amount: 800,
              note: '奖金',
              tags: []
            },
            categoryName: '收入',
            accountName: '银行卡'
          },
          {
            item: {
              id: 'tx-prev-month',
              date: `${lastMonth}-20`,
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 20,
              note: '美宜佳',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '现金'
          },
          {
            item: {
              id: 'tx-budget',
              date: `${thisMonth}-08`,
              type: 'budget',
              categoryId: 'cat-3',
              accountId: 'acc-1',
              amount: 300,
              note: '美宜佳',
              tags: []
            },
            categoryName: '预算',
            accountName: '现金'
          }
        ]}
        total={6}
        filteredTotal={6}
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
        {...baseProps}
      />
    );

    expect(screen.getAllByText('本月消费 2 次').length).toBeGreaterThan(0);
    expect(screen.getAllByText('本月收入 2 次').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('美宜佳本月消费2次').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('奖金本月收入2次').length).toBeGreaterThan(0);
  });

  it('应展示任务条统计并高亮退款/冲正行', () => {
    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-pending',
              date: '2026-03-10',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 100,
              note: '待处理支出',
              status: 'pending',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '银行卡'
          },
          {
            item: {
              id: 'tx-refund',
              date: '2026-03-11',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 20,
              note: '退款单',
              status: 'refunded',
              adjustmentKind: 'refund',
              refundOfTransactionId: 'tx-origin',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '银行卡'
          },
          {
            item: {
              id: 'tx-failed',
              date: '2026-03-12',
              type: 'expense',
              categoryId: 'cat-2',
              accountId: 'acc-1',
              amount: 30,
              note: '失败单',
              status: 'failed',
              tags: []
            },
            categoryName: '交通',
            accountName: '银行卡'
          },
          {
            item: {
              id: 'tx-done',
              date: '2026-03-13',
              type: 'income',
              categoryId: 'cat-3',
              accountId: 'acc-1',
              amount: 200,
              note: '已完成入账',
              status: 'completed',
              tags: []
            },
            categoryName: '工资',
            accountName: '银行卡'
          }
        ]}
        total={4}
        filteredTotal={4}
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
        {...baseProps}
      />
    );

    const taskStrip = screen.getByLabelText('交易任务概览');
    expect(taskStrip).toBeInTheDocument();
    expect(within(taskStrip).getByText('待处理')).toBeInTheDocument();
    expect(within(taskStrip).getByText('退款 / 冲正')).toBeInTheDocument();
    expect(within(taskStrip).getByText('失败单')).toBeInTheDocument();
    expect(within(taskStrip).getByText('已完成')).toBeInTheDocument();
    expect(within(taskStrip).getByText('¥100.00')).toBeInTheDocument();
    expect(within(taskStrip).getByText('¥20.00')).toBeInTheDocument();
    expect(within(taskStrip).getByText('¥30.00')).toBeInTheDocument();
    expect(within(taskStrip).getByText('¥200.00')).toBeInTheDocument();

    expect(document.querySelector('#transaction-row-tx-refund')).toHaveClass(
      'transaction-row-refund-like'
    );
  });
});
