import { cleanup, render, screen, within } from '@testing-library/react';
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

vi.mock('../../shared/store/useFinanceStore', async () => {
  // 重名判定要用真实实现:这条逻辑一旦和 store 走偏,
  // 界面就会在「没创建成功」的时候清空输入框,让人以为建好了。
  const actual = await vi.importActual<typeof import('../../shared/store/useFinanceStore')>(
    '../../shared/store/useFinanceStore'
  );
  return {
    findDuplicateCategory: actual.findDuplicateCategory,
    useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
      selector(financeStoreMock.state)
  };
});

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
    financeStoreMock.state.transactions = [
      {
        id: 'tx-takeout',
        type: 'expense',
        categoryId: 'cat-food-takeout',
        accountId: 'acc-alipay',
        amount: 36,
        date: '2026-11-10',
        note: '外卖',
        tags: [],
        source: 'manual',
        status: 'completed'
      }
    ] as never;

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('餐饮')).toBeInTheDocument();
    expect(screen.getByText('外卖')).toBeInTheDocument();
    // 一级分类显示子分类的合计,并和点击后的筛选结果一致。
    expect(
      screen.getByRole('button', { name: '查看分类 餐饮 的 1 条交易' })
    ).toBeInTheDocument();
    expect(screen.queryByText('工资')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '收入分类' }));
    expect(screen.getByText('工资')).toBeInTheDocument();
    expect(screen.queryByText('餐饮')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '支出分类' }));
    await user.click(screen.getByRole('button', { name: '＋子分类' }));
    /*
     * 「+子分类」不再把父级塞进页面顶部的表单再让人滚回去输入 ——
     * 现在点一下就在该分类下方展开输入框,原地输入、提交即建。
     */
    const inlineInput = screen.getByLabelText('在 餐饮 下新增子分类');
    expect(inlineInput).toHaveFocus();

    await user.type(inlineInput, '咖啡奶茶');
    await user.click(screen.getByRole('button', { name: '添加子分类' }));

    expect(financeStoreMock.state.addCategory).toHaveBeenCalledWith(
      '咖啡奶茶',
      expect.objectContaining({ parentId: 'cat-food', kind: 'expense' })
    );
  });

  it('一级分类重名时给出提示,而不是清空输入框假装成功', async () => {
    const user = userEvent.setup();
    financeStoreMock.state.categories = [
      { id: 'cat-food', name: '餐饮', kind: 'expense', icon: '🍜' }
    ] as never;
    financeStoreMock.state.transactions = [] as never;
    financeStoreMock.state.addCategory.mockClear();

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    await screen.findByText('餐饮');
    const input = screen.getByLabelText('新增分类名称');
    await user.type(input, '餐饮');
    await user.click(screen.getByRole('button', { name: '添加' }));

    /*
     * store 对「同名 + 同父级」是静默复用:过去这里照样清空输入框、
     * 不报任何错,用户会以为自己刚建好了一个分类。
     */
    expect(financeStoreMock.state.addCategory).not.toHaveBeenCalled();
    expect(screen.getByText(/已存在/)).toBeInTheDocument();
    expect(input).toHaveValue('餐饮');
  });

  it('子分类重名时在行内提示,并保留已输入的名字', async () => {
    const user = userEvent.setup();
    financeStoreMock.state.categories = [
      { id: 'cat-food', name: '餐饮', kind: 'expense', icon: '🍜' },
      { id: 'cat-food-takeout', name: '外卖', kind: 'expense', parentId: 'cat-food' }
    ] as never;
    financeStoreMock.state.transactions = [] as never;
    financeStoreMock.state.addCategory.mockClear();

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    await screen.findByText('外卖');
    await user.click(screen.getByRole('button', { name: '＋子分类' }));
    const inlineInput = screen.getByLabelText('在 餐饮 下新增子分类');
    await user.type(inlineInput, '外卖');
    await user.click(screen.getByRole('button', { name: '添加子分类' }));

    expect(financeStoreMock.state.addCategory).not.toHaveBeenCalled();
    expect(screen.getByText(/已存在/)).toBeInTheDocument();
    expect(inlineInput).toHaveValue('外卖');
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

  it('改名撞上同级已有分类时拦下来,不做静默合并', async () => {
    const user = userEvent.setup();
    financeStoreMock.state.categories = [
      { id: 'cat-other', name: '其他', kind: 'expense', icon: '📦' },
      { id: 'cat-lunch', name: '午餐外卖', kind: 'expense', icon: '🍜' }
    ] as never;
    financeStoreMock.state.transactions = [] as never;
    financeStoreMock.state.updateCategory.mockClear();

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    const node = (await screen.findByText('午餐外卖')).closest('.category-node') as HTMLElement;
    await user.click(within(node).getByRole('button', { name: '编辑' }));
    const nameInput = screen.getByLabelText('重命名分类 午餐外卖');
    await user.clear(nameInput);
    await user.type(nameInput, '其他');
    await user.click(within(node).getByRole('button', { name: '保存' }));

    /*
     * 过去这里直接写库:界面上立刻出现两个「其他」,
     * 下次载入时 sanitizeCategoriesAndTransactions 再把它俩静默合并,
     * 被合并那个分类下的交易也跟着换了归属。
     */
    expect(financeStoreMock.state.updateCategory).not.toHaveBeenCalled();
    expect(screen.getByText(/已存在/)).toBeInTheDocument();
    // 仍停在改名状态,用户改个名字就能继续。
    expect(screen.getByLabelText('重命名分类 午餐外卖')).toBeInTheDocument();
  });

  it('把子分类挪到已经有同名子分类的上级下时也拦下来', async () => {
    const user = userEvent.setup();
    financeStoreMock.state.categories = [
      { id: 'cat-food', name: '餐饮', kind: 'expense', icon: '🍜' },
      { id: 'cat-food-takeout', name: '外卖', kind: 'expense', parentId: 'cat-food' },
      { id: 'cat-work', name: '工作餐', kind: 'expense', icon: '💼' },
      { id: 'cat-work-takeout', name: '外卖', kind: 'expense', parentId: 'cat-work' }
    ] as never;
    financeStoreMock.state.transactions = [] as never;
    financeStoreMock.state.updateCategory.mockClear();

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    await screen.findByText('工作餐');
    const node = screen.getByText('工作餐').closest('.category-node') as HTMLElement;
    const child = Array.from(
      document.querySelectorAll('.category-node')
    ).find((el) => el.textContent?.includes('外卖') && el !== node) as HTMLElement | undefined;
    if (!child) throw new Error('child category node not found');

    await user.click(within(child).getByRole('button', { name: '编辑' }));
    await user.selectOptions(
      screen.getByLabelText('设置分类 外卖 的上级'),
      'cat-work'
    );
    await user.click(within(child).getByRole('button', { name: '保存' }));

    expect(financeStoreMock.state.updateCategory).not.toHaveBeenCalled();
    expect(screen.getByText(/已存在/)).toBeInTheDocument();
  });

  it('标签支持重命名并同步到交易', async () => {
    const user = userEvent.setup();
    financeStoreMock.state.categories = [] as never;
    financeStoreMock.state.transactions = [
      {
        id: 'tx-coffee',
        type: 'expense',
        categoryId: '',
        accountId: 'acc-alipay',
        amount: 28,
        date: '2026-11-10',
        note: '咖啡',
        tags: ['咖啡', '下午'],
        source: 'manual',
        status: 'completed'
      },
      {
        id: 'tx-food',
        type: 'expense',
        categoryId: '',
        accountId: 'acc-alipay',
        amount: 30,
        date: '2026-11-10',
        note: '午饭',
        tags: ['餐饮'],
        source: 'manual',
        status: 'completed'
      }
    ] as never;

    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    const coffeeLabel = await screen.findByText('#咖啡');
    const coffeeRow = coffeeLabel.closest('li');
    expect(coffeeRow).not.toBeNull();
    await user.click(within(coffeeRow as HTMLElement).getByRole('button', { name: '重命名' }));

    const input = screen.getByLabelText('重命名标签 咖啡');
    await user.clear(input);
    await user.type(input, '下午茶');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(financeStoreMock.state.updateTransaction).toHaveBeenCalledWith(
      'tx-coffee',
      expect.objectContaining({ tags: ['下午茶', '下午'] })
    );
  });
  describe('两级分类的折叠', () => {
    const rootCategory = { id: 'cat-food', name: '餐饮', kind: 'expense', icon: '🍜', sortOrder: 1 };
    const childCategory = {
      id: 'cat-lunch',
      name: '午餐外卖',
      kind: 'expense',
      parentId: 'cat-food',
      sortOrder: 2
    };
    const plainCategory = { id: 'cat-traffic', name: '交通', kind: 'expense', sortOrder: 3 };

    beforeEach(() => {
      window.localStorage.clear();
      financeStoreMock.state.categories = [rootCategory, childCategory, plainCategory] as never;
    });

    function renderTreePage() {
      return render(
        <MemoryRouter>
          <CategoriesAccountsPage />
        </MemoryRouter>
      );
    }

    it('有子分类的一级分类是整行可点的折叠控件', async () => {
      const user = userEvent.setup();
      renderTreePage();

      // 页面用 120ms 的骨架屏计时器,这里要等它结束
      const toggle = await screen.findByRole('button', { name: '收起 餐饮 的子分类' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute('aria-controls', 'category-children-cat-food');
      expect(screen.getByText('午餐外卖')).toBeInTheDocument();

      await user.click(toggle);

      expect(screen.getByRole('button', { name: '展开 餐饮 的子分类' })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      expect(screen.queryByText('午餐外卖')).not.toBeInTheDocument();
    });

    it('没有子分类的分类默认收起,但仍可点开', async () => {
      renderTreePage();
      expect(await screen.findByText('交通')).toBeInTheDocument();
      /*
       * 有意的行为变更:一级分类**一律**可点开,即使当前没有子分类 ——
       * 否则「想给交通加子分类」只能跑回页面顶部,而这一行既不可点、
       * 也看不出能往下挂东西。没有子分类的默认收起,点开才展开并给出提示。
       */
      expect(screen.getByRole('button', { name: '展开 交通 的子分类' })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    });

    it('折叠状态写入本地,重新进入页面仍然收起', async () => {
      const user = userEvent.setup();
      renderTreePage();

      await user.click(await screen.findByRole('button', { name: '收起 餐饮 的子分类' }));
      expect(window.localStorage.getItem('ledgerflow-category-collapse-state-v1')).toBe(
        JSON.stringify(['cat-food'])
      );

      cleanup();
      renderTreePage();

      expect(await screen.findByRole('button', { name: '展开 餐饮 的子分类' })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      expect(screen.queryByText('午餐外卖')).not.toBeInTheDocument();
    });

    it('本地存了非数组的脏数据也不会崩', async () => {
      window.localStorage.setItem('ledgerflow-category-collapse-state-v1', '{"not":"an array"}');
      renderTreePage();
      expect(await screen.findByText('午餐外卖')).toBeInTheDocument();
    });
  });
});

/*
 * 电子钱包必须出现在「资金账户」列表里。
 *
 * 这条盯的是一个真实漏网:页面用 GENERAL_ACCOUNT_TYPES 过滤列表,而它是在
 * 2026-02 写的(当时把 credit/liability/receivable 移到还款页),ewallet 是
 * 2026-11 才补进域类型的 —— 于是支付宝、微信钱包这类账户在「账户与分类」里
 * 完全不显示:看不到、改不了名、也删不掉。
 *
 * 原有用例的 fixture 把支付宝/微信写成 type: 'virtual'(在允许列表内),
 * 正好掩盖了这个问题,所以这里显式用 'ewallet'。
 */
it('电子钱包(ewallet)账户出现在资金账户列表里', async () => {
  const user = userEvent.setup();
  const originalAccounts = financeStoreMock.state.accounts;
  financeStoreMock.state.accounts = [
    {
      id: 'acc-ewallet',
      name: '支付宝',
      type: 'ewallet',
      initialBalance: 100,
      balance: 100,
      sortOrder: 1
    },
    {
      id: 'acc-cash',
      name: '现金',
      type: 'cash',
      initialBalance: 50,
      balance: 50,
      sortOrder: 2
    }
  ] as never;

  try {
    render(
      <MemoryRouter>
        <CategoriesAccountsPage />
      </MemoryRouter>
    );

    // 两个都算「资金账户」,tab 上的计数应当为 2
    await user.click(await screen.findByRole('button', { name: /资金账户 2/ }));
    expect(await screen.findByText('支付宝')).toBeInTheDocument();
    // 「现金」既是账户名也是类型标签,用 getAllByText 避免重名歧义
    expect(screen.getAllByText('现金').length).toBeGreaterThan(0);
    // 类型标签用「电子钱包」,而不是原始英文枚举
    expect(screen.getByText('电子钱包')).toBeInTheDocument();
  } finally {
    financeStoreMock.state.accounts = originalAccounts;
  }
});
