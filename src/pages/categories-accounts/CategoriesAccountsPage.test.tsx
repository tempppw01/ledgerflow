import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoriesAccountsPage } from './CategoriesAccountsPage';
import { ALIPAY_LOGO_URL, WECHAT_LOGO_URL } from '../../shared/config/brandAssets';

const financeStoreMock = {
  state: {
    categories: [],
    accounts: [
      {
        id: 'acc-alipay',
        name: '支付宝',
        type: 'virtual',
        initialBalance: 630.73,
        balance: 630.73,
        sortOrder: 1
      },
      {
        id: 'acc-wechat',
        name: '微信',
        type: 'virtual',
        initialBalance: 901.53,
        balance: 901.53,
        sortOrder: 2
      },
      {
        id: 'acc-bank',
        name: '邮政银行卡',
        type: 'debit',
        initialBalance: 3756.59,
        balance: 3756.59,
        sortOrder: 3
      }
    ],
    transactions: [],
    addCategory: vi.fn(),
    updateCategory: vi.fn(),
    reorderCategories: vi.fn(),
    removeCategory: vi.fn(),
    addAccount: vi.fn(),
    addTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    updateAccountBalance: vi.fn(),
    reorderAccounts: vi.fn(),
    removeAccount: vi.fn()
  }
};

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

describe('CategoriesAccountsPage', () => {
  beforeEach(() => {
    financeStoreMock.state.updateAccountBalance.mockClear();
  });

  it('uses the top-right balance as the only balance edit entry', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /资金账户 3/ }));

    await screen.findByRole(
      'button',
      { name: 'account-balance-display-acc-alipay' },
      { timeout: 10000 }
    );

    expect(screen.getAllByText('¥630.73')).toHaveLength(1);
    expect(document.querySelector('.account-card-brand-icon')).toHaveAttribute(
      'src',
      ALIPAY_LOGO_URL
    );
    expect(document.querySelectorAll('.account-card-brand-icon')[1]).toHaveAttribute(
      'src',
      WECHAT_LOGO_URL
    );

    await user.dblClick(screen.getByRole('button', { name: 'account-balance-display-acc-alipay' }));

    expect(
      screen.getByRole('spinbutton', { name: 'account-balance-editor-acc-alipay' })
    ).toHaveValue(630.73);
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('uses top tabs to switch between the category and account workspaces', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: '分类与标签管理' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '账户管理' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /资金账户 3/ }));

    expect(screen.getByRole('heading', { name: '账户管理' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '分类与标签管理' })).not.toBeInTheDocument();
  });

  it('分类按收支分组,并支持给一级分类添加子分类', async () => {
    const user = userEvent.setup();
    financeStoreMock.state.categories = [
      { id: 'cat-food', name: '餐饮', kind: 'expense', icon: '🍜' },
      { id: 'cat-food-takeout', name: '外卖', kind: 'expense', parentId: 'cat-food' },
      { id: 'cat-salary', name: '工资', kind: 'income', icon: '💰' }
    ] as never;

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('餐饮')).toBeInTheDocument();
    expect(screen.getByText('外卖')).toBeInTheDocument();
    expect(screen.queryByText('工资')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '收入分类' }));
    expect(screen.getByText('工资')).toBeInTheDocument();
    expect(screen.queryByText('餐饮')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '支出分类' }));
    await user.click(screen.getByRole('button', { name: '＋子分类' }));
    expect(screen.getByLabelText('上级分类')).toHaveValue('cat-food');

    await user.type(screen.getByLabelText('新增分类名称'), '咖啡奶茶');
    await user.click(screen.getByRole('button', { name: '添加' }));

    expect(financeStoreMock.state.addCategory).toHaveBeenCalledWith(
      '咖啡奶茶',
      expect.objectContaining({ parentId: 'cat-food', kind: 'expense' })
    );
  });

  it('分类支持行内改名并调整上级', async () => {
    const user = userEvent.setup();
    financeStoreMock.state.categories = [
      { id: 'cat-food', name: '餐饮', kind: 'expense', icon: '🍜' },
      { id: 'cat-transport', name: '交通', kind: 'expense', icon: '🚇' },
      { id: 'cat-food-takeout', name: '外卖', kind: 'expense', parentId: 'cat-food' }
    ] as never;

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    await screen.findByText('外卖');
    await user.click(screen.getAllByRole('button', { name: '编辑' })[1]);
    const nameInput = screen.getByLabelText('重命名分类 外卖');
    expect(nameInput).toHaveValue('外卖');

    await user.clear(nameInput);
    await user.type(nameInput, '外食');
    await user.selectOptions(screen.getByLabelText('设置分类 外卖 的上级'), 'cat-transport');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(financeStoreMock.state.updateCategory).toHaveBeenCalledWith('cat-food-takeout', {
      name: '外食',
      parentId: 'cat-transport'
    });
  });
});
