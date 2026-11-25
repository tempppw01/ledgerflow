import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TransactionTable } from './TransactionTable';
import type { TransactionColumnKey } from '../model/transactionColumns';
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
        'transactions.bulk.printA4': '打印 A4',
        'transactions.bulk.exportPdf': '📄 导出 PDF',
        'transactions.bulk.exportingPdf': '⏳ 正在导出 PDF…',
        'transactions.bulk.delete': '删除所选',
        'transactions.bulk.clearSelection': '清空选择',
        'datePicker.ariaLabel': '选择日期',
        'datePicker.dialogLabel': '日期选择器',
        'datePicker.placeholder': '选择日期'
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
  onCreate: vi.fn(),
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

    await user.click(screen.getByRole('button', { name: '打印 A4' }));
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

    const dateTrigger = screen.getByRole('button', { name: /选择日期/ });
    const datePicker = dateTrigger.closest('.lf-date-picker');
    expect(datePicker).toHaveAttribute('data-min-date', '2026-02-01');
    expect(datePicker).toHaveAttribute('data-max-date', '2026-02-28');
    /*
     * WCAG 2.5.3(标签包含可见文字,A):按钮上显示的是「筛选日期」,
     * 所以可访问名里必须能找到「筛选日期」—— 否则语音控制用户喊屏幕上的字匹配不到。
     */
    expect(dateTrigger).toHaveAccessibleName(/筛选日期/);
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

    /*
     * 分页按钮的可访问名就是屏幕上的字(2.5.3 标签包含可见文字):
     * 之前可见写「首页」而 aria-label 写「第一页」,语音控制用户喊「首页」匹配不到。
     */
    expect(screen.getByRole('button', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '末页' })).toBeInTheDocument();
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
    const refundRow = document.querySelector('#transaction-row-tx-refund');
    expect(refundRow).not.toBeNull();
    expect(within(refundRow as HTMLElement).getByLabelText('退款')).toHaveClass(
      'transaction-type-badge-income'
    );
  });

  it('移动端批量模式应支持全选、逐笔选择和整卡选择', async () => {
    const user = userEvent.setup();
    const onToggleSelectPage = vi.fn();
    const onToggleSelect = vi.fn();
    const onOpenDetail = vi.fn();

    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-mobile-1',
              date: '2026-03-10',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 32,
              note: '移动午餐',
              tags: []
            },
            categoryName: '餐饮',
            accountName: '现金'
          },
          {
            item: {
              id: 'tx-mobile-2',
              date: '2026-03-11',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 18,
              note: '移动咖啡',
              tags: []
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
        bulkSelectionEnabled
        canSelectAllOnPage
        allPageSelected={false}
        sortKey="date"
        sortDirection="desc"
        {...baseProps}
        onToggleSelectPage={onToggleSelectPage}
        onToggleSelect={onToggleSelect}
        onOpenDetail={onOpenDetail}
      />
    );

    const mobileList = screen.getByLabelText('移动端交易列表');
    await user.click(within(mobileList).getByRole('checkbox', { name: '全选当前页' }));
    expect(onToggleSelectPage).toHaveBeenCalledWith(true);

    await user.click(
      within(mobileList).getByRole('checkbox', {
        name: /选择交易 2026\/3\/10 移动午餐/
      })
    );
    expect(onToggleSelect).toHaveBeenCalledWith('tx-mobile-1', true);

    await user.click(within(mobileList).getByText('移动午餐'));
    expect(onToggleSelect).toHaveBeenCalledWith('tx-mobile-1', true);
    expect(onOpenDetail).not.toHaveBeenCalled();

    const firstCard = within(mobileList).getByText('移动午餐').closest('article');
    expect(firstCard).not.toBeNull();
    fireEvent.touchStart(firstCard!, { touches: [{ clientX: 240 }] });
    fireEvent.touchEnd(firstCard!, { changedTouches: [{ clientX: 120 }] });
    expect(firstCard).not.toHaveClass('is-swiped');
    expect(firstCard!.querySelector('.transaction-mobile-delete')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('移动端更多操作应提供详情、分享和删除入口', async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    const onShare = vi.fn();
    const onDelete = vi.fn();

    render(
      <TransactionTable
        rows={[
          {
            item: {
              id: 'tx-mobile-actions',
              date: '2026-03-12',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 28,
              note: '移动早餐',
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
        selectedIds={[]}
        bulkSelectionEnabled={false}
        canSelectAllOnPage={false}
        allPageSelected={false}
        sortKey="date"
        sortDirection="desc"
        {...baseProps}
        onOpenDetail={onOpenDetail}
        onShare={onShare}
        onDelete={onDelete}
      />
    );

    const mobileList = screen.getByLabelText('移动端交易列表');
    const moreButton = within(mobileList).getByRole('button', { name: '更多操作 移动早餐' });

    await user.click(moreButton);
    let menu = await screen.findByRole('menu', { name: '交易操作' });
    await user.click(within(menu).getByRole('menuitem', { name: '分享账单' }));
    expect(onShare).toHaveBeenCalledWith('tx-mobile-actions');

    await user.click(moreButton);
    menu = await screen.findByRole('menu', { name: '交易操作' });
    await user.click(within(menu).getByRole('menuitem', { name: '删除账单' }));
    expect(onDelete).toHaveBeenCalledWith('tx-mobile-actions');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });
});

/*
 * WCAG 2.1.1(键盘,A):详情抽屉原来只能点行打开。行是 tabIndex={-1}、行内没有任何按钮,
 * 键盘用户走完整个 Tab 顺序也碰不到交易,等于看不了详情。
 * 现在用 roving tabindex:整张表只有一行进 Tab 顺序,↓/↑ 换行,Enter/空格 开详情。
 * 这个测试盯住三件事:只有一行是 tabindex=0、↓ 会换行、Enter 会带对 id 打开详情。
 */
describe('桌面表格:整行详情必须能用键盘打开(WCAG 2.1.1)', () => {
  const keyboardRows = [
    {
      item: {
        id: 'tx-kb-1',
        date: '2026-03-10',
        type: 'expense' as const,
        categoryId: 'cat-1',
        accountId: 'acc-1',
        amount: 32,
        note: '键盘午餐',
        tags: []
      },
      categoryName: '餐饮',
      accountName: '现金'
    },
    {
      item: {
        id: 'tx-kb-2',
        date: '2026-03-11',
        type: 'expense' as const,
        categoryId: 'cat-1',
        accountId: 'acc-1',
        amount: 18,
        note: '键盘咖啡',
        tags: []
      },
      categoryName: '餐饮',
      accountName: '现金'
    }
  ];

  const renderTable = (onOpenDetail: (id: string) => void) =>
    render(
      <TransactionTable
        {...baseProps}
        rows={keyboardRows}
        total={2}
        filteredTotal={2}
        page={1}
        pages={1}
        pageSize={8}
        pageSizeOptions={[8, 20]}
        loading={false}
        hasFilters={false}
        selectedIds={[]}
        bulkSelectionEnabled={false}
        canSelectAllOnPage={false}
        allPageSelected={false}
        sortKey="date"
        sortDirection="desc"
        onOpenDetail={onOpenDetail}
      />
    );

  it('只有一行进 Tab 顺序,↓ 换行,Enter 打开对应交易的详情', async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    renderTable(onOpenDetail);

    const trs = Array.from(
      document.querySelectorAll<HTMLTableRowElement>('tr.transaction-row-clickable')
    );
    expect(trs).toHaveLength(2);
    // 只有一行是 0,其余 -1 —— 否则几十行会全塞进 Tab 链
    expect(trs[0].getAttribute('tabindex')).toBe('0');
    expect(trs[1].getAttribute('tabindex')).toBe('-1');

    trs[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(trs[1]);
    // 焦点移过去后,roving 位置也跟着过去
    expect(document.querySelectorAll('tr.transaction-row-clickable')[1]?.getAttribute('tabindex')).toBe('0');

    await user.keyboard('{Enter}');
    expect(onOpenDetail).toHaveBeenCalledWith('tx-kb-2');
  });

  it('空格键同样能打开详情(不是只有 Enter)', async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    renderTable(onOpenDetail);

    const trs = Array.from(
      document.querySelectorAll<HTMLTableRowElement>('tr.transaction-row-clickable')
    );
    trs[0].focus();
    await user.keyboard(' ');
    expect(onOpenDetail).toHaveBeenCalledWith('tx-kb-1');
  });
});

/*
 * 列宽这块有两个独立的问题,分别钉住:
 * 1) 宽度必须落在 <th> 上。原来只写 <colgroup><col style="width">,而表格是
 *    `width: max-content` —— 实测(col 设 400px)表格毫无反应,th 仍是 90。
 * 2) WCAG 2.5.7:列宽原来只能拖,手柄不可聚焦、没有键盘操作。
 */
describe('列宽:宽度真的生效 + 键盘可调(WCAG 2.5.7)', () => {
  const rowsForColumns = [
    {
      item: {
        id: 'tx-col-1',
        date: '2026-03-10',
        type: 'expense' as const,
        categoryId: 'cat-1',
        accountId: 'acc-1',
        amount: 32,
        note: '列宽午餐',
        tags: []
      },
      categoryName: '餐饮',
      accountName: '现金'
    }
  ];

  const renderWith = (overrides: Record<string, unknown> = {}) =>
    render(
      <TransactionTable
        {...baseProps}
        rows={rowsForColumns}
        total={1}
        filteredTotal={1}
        page={1}
        pages={1}
        pageSize={8}
        pageSizeOptions={[8, 20]}
        loading={false}
        hasFilters={false}
        selectedIds={[]}
        bulkSelectionEnabled={false}
        canSelectAllOnPage={false}
        allPageSelected={false}
        sortKey="date"
        sortDirection="desc"
        {...overrides}
      />
    );

  it('列宽要落在 th 上,不能只写 colgroup 的 col', () => {
    renderWith({ columnWidths: { category: 200 } });
    const th = document.querySelector('th.transaction-col-category');
    expect(th).not.toBeNull();
    expect(th).toHaveStyle({ width: '200px', minWidth: '200px' });
  });

  it('列宽手柄可聚焦,Home/End 到最窄/最宽并回调 onColumnResize', async () => {
    const user = userEvent.setup();
    const onColumnResize = vi.fn();
    renderWith({ onColumnResize });

    const resizers = Array.from(document.querySelectorAll('.transaction-col-resizer'));
    expect(resizers.length).toBeGreaterThan(0);
    const first = resizers[0] as HTMLElement;
    expect(first).toHaveAttribute('role', 'separator');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('aria-orientation', 'vertical');

    first.focus();
    await user.keyboard('{Home}');
    expect(onColumnResize).toHaveBeenCalledWith('date', 90);

    await user.keyboard('{End}');
    // 上限必须与 TransactionsPage 的 COLUMN_MAX_WIDTH 一致
    expect(onColumnResize).toHaveBeenCalledWith('date', 640);
  });
});
