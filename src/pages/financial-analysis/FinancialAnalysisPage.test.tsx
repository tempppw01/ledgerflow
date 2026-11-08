import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { Category } from '../../entities/category/types';
import type { SubscriptionItem } from '../../entities/subscription/types';
import type { TransactionItem } from '../../entities/transaction/types';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { FinancialAnalysisPage } from './FinancialAnalysisPage';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

type FinanceStoreState = {
  transactions: TransactionItem[];
  categories: Category[];
  accounts: Account[];
  subscriptions: SubscriptionItem[];
};

type AppPreferencesState = {
  debts: DebtItem[];
  repaymentRecords: RepaymentRecord[];
  monthlyIncome: number;
};

const financeStoreMock = vi.hoisted(() => ({
  state: {
    transactions: [],
    categories: [],
    accounts: [],
    subscriptions: []
  } as FinanceStoreState
}));

const appPreferencesMock = vi.hoisted(() => ({
  state: {
    debts: [],
    repaymentRecords: [],
    monthlyIncome: 0
  } as AppPreferencesState
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

vi.mock('../../shared/store/useAppPreferences', () => ({
  useAppPreferences: (selector: (state: typeof appPreferencesMock.state) => unknown) =>
    selector(appPreferencesMock.state)
}));

vi.mock('../../shared/store/useAiSettings', () => ({
  useAiSettings: (
    selector: (state: { baseUrl: string; apiKey: string; model: string }) => unknown
  ) =>
    selector({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'gpt-test'
    })
}));

vi.mock('../../features/assistant/api/openaiCompatibleClient', () => ({
  sendAiChat: vi.fn()
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <FinancialAnalysisPage />
    </MemoryRouter>
  );
}

describe('FinancialAnalysisPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T08:00:00.000Z'));
    navigateMock.mockReset();

    financeStoreMock.state = {
      transactions: [],
      categories: [],
      accounts: [],
      subscriptions: []
    };

    appPreferencesMock.state = {
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 0
    };
    vi.mocked(sendAiChat).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('应在无交易数据时展示空状态并支持跳转', () => {
    renderPage();

    expect(screen.getByText('还没有足够的财务分析数据')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '去记一笔' }));
    expect(navigateMock).toHaveBeenCalledWith('/transactions/new?quick=1');

    fireEvent.click(screen.getByRole('button', { name: '查看交易记录' }));
    expect(navigateMock).toHaveBeenCalledWith('/transactions');
  });

  it('应提供过去/现在/未来的闭环动作入口', () => {
    financeStoreMock.state = {
      transactions: [
        {
          id: 'tx-current-income',
          date: '2026-04-10',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-bank',
          amount: 3500,
          note: '工资到账',
          tags: []
        },
        {
          id: 'tx-prev-abnormal',
          date: '2026-04-20',
          type: 'expense',
          categoryId: 'cat-rent',
          accountId: 'acc-cash',
          amount: 1200,
          note: '房租',
          tags: []
        },
        {
          id: 'tx-prev-food',
          date: '2026-04-15',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 260,
          note: '聚餐',
          tags: []
        },
        {
          id: 'tx-prev-coffee',
          date: '2026-04-03',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 30,
          note: '咖啡',
          tags: []
        }
      ],
      categories: [
        {
          id: 'cat-food',
          name: '餐饮',
          kind: 'expense',
          color: '#f97316',
          icon: '🍜',
          sortOrder: 1
        },
        {
          id: 'cat-rent',
          name: '住房',
          kind: 'expense',
          color: '#8b5cf6',
          icon: '🏠',
          sortOrder: 2
        },
        {
          id: 'cat-salary',
          name: '工资',
          kind: 'income',
          color: '#16a34a',
          icon: '💰',
          sortOrder: 3
        }
      ],
      accounts: [
        { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 500, balance: 200 },
        { id: 'acc-bank', name: '银行卡', type: 'debit', initialBalance: 1000, balance: 4200 }
      ],
      subscriptions: [
        {
          id: 'sub-1',
          name: '音乐会员',
          kind: 'digital',
          amount: 25,
          currency: 'CNY',
          billingCycle: 'monthly',
          accountId: 'acc-bank',
          renewalDate: '2026-04-25',
          expireDate: '',
          status: 'active',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z'
        }
      ]
    };

    appPreferencesMock.state = {
      debts: [
        {
          id: 'debt-1',
          name: '花呗',
          type: 'consumer-loan',
          balance: 1800,
          repaymentDay: 25,
          status: 'active'
        }
      ],
      repaymentRecords: [
        {
          id: 'rep-1',
          debtId: 'debt-1',
          amount: 300,
          paidAt: '2026-04-05',
          recordMode: 'manual',
          createdAt: '2026-04-05T00:00:00.000Z'
        }
      ],
      monthlyIncome: 500
    };

    renderPage();

    const abnormalQuickActionCard = screen.getByText('定位异常流水').closest('article');
    expect(abnormalQuickActionCard).not.toBeNull();
    fireEvent.click(
      within(abnormalQuickActionCard as HTMLElement).getByRole('button', { name: '继续处理' })
    );
    expect(navigateMock).toHaveBeenCalledWith('/transactions/tx-prev-abnormal');

    const pressureCard = screen.getByText('查看还款压力').closest('article');
    expect(pressureCard).not.toBeNull();
    fireEvent.click(within(pressureCard as HTMLElement).getByRole('button', { name: '立即前往' }));
    expect(navigateMock).toHaveBeenCalledWith('/repayment-management');

    const subscriptionCard = screen.getByText('检查即将续费订阅').closest('article');
    expect(subscriptionCard).not.toBeNull();
    fireEvent.click(
      within(subscriptionCard as HTMLElement).getByRole('button', { name: '去处理' })
    );
    expect(navigateMock).toHaveBeenCalledWith('/subscriptions');
  });

  it('应展示消费习惯、可压缩支出与消费者画像', () => {
    financeStoreMock.state = {
      transactions: [
        {
          id: 'tx-weekday-lunch-1',
          date: '2026-04-21',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 28,
          note: '咖啡',
          tags: []
        },
        {
          id: 'tx-weekday-lunch-2',
          date: '2026-04-20',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 32,
          note: '咖啡',
          tags: []
        },
        {
          id: 'tx-weekend-taxi',
          date: '2026-04-19',
          type: 'expense',
          categoryId: 'cat-transport',
          accountId: 'acc-cash',
          amount: 45,
          note: '打车',
          tags: []
        },
        {
          id: 'tx-weekend-milk-tea',
          date: '2026-04-18',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 26,
          note: '奶茶',
          tags: []
        },
        {
          id: 'tx-shopping',
          date: '2026-04-16',
          type: 'expense',
          categoryId: 'cat-shopping',
          accountId: 'acc-cash',
          amount: 268,
          note: '网购',
          tags: []
        },
        {
          id: 'tx-income',
          date: '2026-04-15',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-bank',
          amount: 5000,
          note: '工资',
          tags: []
        }
      ],
      categories: [
        {
          id: 'cat-food',
          name: '餐饮',
          kind: 'expense',
          color: '#f97316',
          icon: '🍜',
          sortOrder: 1
        },
        {
          id: 'cat-transport',
          name: '交通',
          kind: 'expense',
          color: '#0ea5e9',
          icon: '🚇',
          sortOrder: 2
        },
        {
          id: 'cat-shopping',
          name: '购物',
          kind: 'expense',
          color: '#8b5cf6',
          icon: '🛍️',
          sortOrder: 3
        },
        {
          id: 'cat-salary',
          name: '工资',
          kind: 'income',
          color: '#16a34a',
          icon: '💰',
          sortOrder: 4
        }
      ],
      accounts: [
        { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 500, balance: 180 },
        { id: 'acc-bank', name: '银行卡', type: 'debit', initialBalance: 1000, balance: 6200 }
      ],
      subscriptions: []
    };

    appPreferencesMock.state = {
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 8000
    };

    renderPage();

    expect(screen.getByText('行为洞察：消费习惯与画像')).toBeInTheDocument();
    expect(screen.getByText('消费习惯推断')).toBeInTheDocument();
    expect(screen.getByText('可压缩支出信号')).toBeInTheDocument();
    expect(screen.getByText('消费者画像推测')).toBeInTheDocument();
    expect(
      screen.getByText(/规划型消费者|舒适优先型消费者|即时反馈型消费者|平衡观察型消费者/)
    ).toBeInTheDocument();
    expect(screen.getByText(/该画像只基于当前账本行为特征推测/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看消费明细' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去 AI 助手' })).toBeInTheDocument();
  });

  it('当历史消费被误标为收入但分类仍为支出时，仍应生成消费习惯洞察', () => {
    financeStoreMock.state = {
      transactions: [
        {
          id: 'tx-mislabel-1',
          date: '2026-04-21',
          type: 'income',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 29,
          note: '咖啡',
          tags: []
        },
        {
          id: 'tx-mislabel-2',
          date: '2026-04-20',
          type: 'income',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 31,
          note: '咖啡',
          tags: []
        },
        {
          id: 'tx-mislabel-3',
          date: '2026-04-19',
          type: 'income',
          categoryId: 'cat-shopping',
          accountId: 'acc-cash',
          amount: 188,
          note: '网购',
          tags: []
        },
        {
          id: 'tx-income',
          date: '2026-04-18',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-bank',
          amount: 4200,
          note: '工资',
          tags: []
        }
      ],
      categories: [
        {
          id: 'cat-food',
          name: '餐饮',
          kind: 'expense',
          color: '#f97316',
          icon: '🍜',
          sortOrder: 1
        },
        {
          id: 'cat-shopping',
          name: '购物',
          kind: 'expense',
          color: '#8b5cf6',
          icon: '🛍️',
          sortOrder: 2
        },
        {
          id: 'cat-salary',
          name: '工资',
          kind: 'income',
          color: '#16a34a',
          icon: '💰',
          sortOrder: 3
        }
      ],
      accounts: [
        { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 500, balance: 252 },
        { id: 'acc-bank', name: '银行卡', type: 'debit', initialBalance: 1000, balance: 5200 }
      ],
      subscriptions: []
    };

    appPreferencesMock.state = {
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 8000
    };

    renderPage();

    expect(screen.queryByText('行为样本不足')).not.toBeInTheDocument();
    expect(
      screen.getByText(/餐饮支出较集中|购物支出较集中|消费节奏整体分散|高频小额支出偏多/)
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/餐饮里可能有可压缩支出|购物里可能有可压缩支出/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/舒适优先型消费者|即时反馈型消费者|平衡观察型消费者|规划型消费者/)
    ).toBeInTheDocument();
  });

  it('生成 AI 解读后应补充行为洞察判断', async () => {
    vi.mocked(sendAiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        summary: '当前消费弹性较高，但仍可通过场景约束来改善结余。',
        past: ['过去 30 天支出主要集中在餐饮和购物。'],
        present: ['当前有多笔即时满足型消费。'],
        future: ['若继续保持当前节奏，建议优先压缩高频小额消费。'],
        actions: [{ label: '去制定预算', to: '/smart-budget' }],
        behavior: {
          summary: 'AI 认为你更像场景驱动型消费，容易在便利和情绪补偿场景下放大支出。',
          habits: [
            '工作日存在小额高频咖啡消费，说明你有固定提神型开销。',
            '周末更容易出现临时出行和休闲支出。'
          ],
          avoidable: ['餐饮中的饮品和加餐可优先设限。', '购物类消费更适合改成延迟下单。'],
          profile: '场景驱动型消费者',
          confidenceNote: '该结论由 AI 结合当前账本样本生成，样本期较短时应结合近 2~3 周继续观察。'
        }
      })
    } as Awaited<ReturnType<typeof sendAiChat>>);

    financeStoreMock.state = {
      transactions: [
        {
          id: 'tx-ai-1',
          date: '2026-04-21',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 28,
          note: '咖啡',
          tags: []
        },
        {
          id: 'tx-ai-2',
          date: '2026-04-20',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 32,
          note: '咖啡',
          tags: []
        },
        {
          id: 'tx-ai-3',
          date: '2026-04-19',
          type: 'expense',
          categoryId: 'cat-transport',
          accountId: 'acc-cash',
          amount: 45,
          note: '打车',
          tags: []
        },
        {
          id: 'tx-ai-4',
          date: '2026-04-18',
          type: 'expense',
          categoryId: 'cat-shopping',
          accountId: 'acc-cash',
          amount: 268,
          note: '网购',
          tags: []
        },
        {
          id: 'tx-ai-5',
          date: '2026-04-15',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-bank',
          amount: 5000,
          note: '工资',
          tags: []
        }
      ],
      categories: [
        {
          id: 'cat-food',
          name: '餐饮',
          kind: 'expense',
          color: '#f97316',
          icon: '🍜',
          sortOrder: 1
        },
        {
          id: 'cat-transport',
          name: '交通',
          kind: 'expense',
          color: '#0ea5e9',
          icon: '🚇',
          sortOrder: 2
        },
        {
          id: 'cat-shopping',
          name: '购物',
          kind: 'expense',
          color: '#8b5cf6',
          icon: '🛍️',
          sortOrder: 3
        },
        {
          id: 'cat-salary',
          name: '工资',
          kind: 'income',
          color: '#16a34a',
          icon: '💰',
          sortOrder: 4
        }
      ],
      accounts: [
        { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 500, balance: 180 },
        { id: 'acc-bank', name: '银行卡', type: 'debit', initialBalance: 1000, balance: 6200 }
      ],
      subscriptions: []
    };

    appPreferencesMock.state = {
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 8000
    };

    renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '生成 AI 解读' }));
      await Promise.resolve();
    });

    expect(screen.getByText('AI 补充判断')).toBeInTheDocument();
    expect(screen.getByText('场景驱动型消费者')).toBeInTheDocument();
    expect(screen.getByText(/工作日存在小额高频咖啡消费/)).toBeInTheDocument();
    expect(screen.getByText(/餐饮中的饮品和加餐可优先设限/)).toBeInTheDocument();
    expect(screen.getByText(/样本期较短时应结合近 2~3 周继续观察/)).toBeInTheDocument();
    expect(vi.mocked(sendAiChat)).toHaveBeenCalledTimes(1);
  });

  it('应在过去周期有支出流水时展示过去复盘内容', () => {
    financeStoreMock.state = {
      transactions: [
        {
          id: 'tx-current-income',
          date: '2026-04-18',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-bank',
          amount: 4200,
          note: '工资到账',
          tags: []
        },
        {
          id: 'tx-prev-rent',
          date: '2026-04-20',
          type: 'expense',
          categoryId: 'cat-rent',
          accountId: 'acc-cash',
          amount: 1500,
          note: '房租',
          tags: []
        },
        {
          id: 'tx-prev-grocery',
          date: '2026-04-15',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 120,
          note: '买菜',
          tags: []
        },
        {
          id: 'tx-prev-dinner',
          date: '2026-04-03',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 80,
          note: '晚餐',
          tags: []
        }
      ],
      categories: [
        {
          id: 'cat-food',
          name: '餐饮',
          kind: 'expense',
          color: '#f97316',
          icon: '🍜',
          sortOrder: 1
        },
        {
          id: 'cat-rent',
          name: '住房',
          kind: 'expense',
          color: '#8b5cf6',
          icon: '🏠',
          sortOrder: 2
        },
        {
          id: 'cat-salary',
          name: '工资',
          kind: 'income',
          color: '#16a34a',
          icon: '💰',
          sortOrder: 3
        }
      ],
      accounts: [
        { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 500, balance: 300 },
        { id: 'acc-bank', name: '银行卡', type: 'debit', initialBalance: 1000, balance: 5200 }
      ],
      subscriptions: []
    };

    appPreferencesMock.state = {
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 8000
    };

    renderPage();

    expect(screen.getAllByText('住房').length).toBeGreaterThan(0);
    expect(screen.getByText('房租 · ¥1,500.00')).toBeInTheDocument();
    expect(screen.getByText(/住房是当前分析周期支出最高的分类/)).toBeInTheDocument();
    expect(screen.queryByText('上一阶段还没有足够的支出分类样本。')).not.toBeInTheDocument();
    expect(screen.getByText('查看异常流水')).toBeInTheDocument();
  });

  it('应按当前分析周期构造交易页跳转参数', () => {
    financeStoreMock.state = {
      transactions: [
        {
          id: 'tx-1',
          date: '2026-04-20',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 120,
          note: '晚餐',
          tags: []
        },
        {
          id: 'tx-2',
          date: '2026-04-15',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 80,
          note: '午餐',
          tags: []
        },
        {
          id: 'tx-3',
          date: '2026-04-01',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-bank',
          amount: 3000,
          note: '工资',
          tags: []
        }
      ],
      categories: [
        {
          id: 'cat-food',
          name: '餐饮',
          kind: 'expense',
          color: '#f97316',
          icon: '🍜',
          sortOrder: 1
        },
        {
          id: 'cat-salary',
          name: '工资',
          kind: 'income',
          color: '#16a34a',
          icon: '💰',
          sortOrder: 2
        }
      ],
      accounts: [{ id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 500, balance: 300 }],
      subscriptions: []
    };

    appPreferencesMock.state = {
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 6000
    };

    renderPage();

    const cycleCard = screen.getByText('查看当前周期流水').closest('article');
    expect(cycleCard).not.toBeNull();
    fireEvent.click(within(cycleCard as HTMLElement).getByRole('button', { name: '继续处理' }));

    expect(navigateMock).toHaveBeenCalledWith(
      '/transactions?datePreset=custom&dateFrom=2026-03-22&dateTo=2026-04-20'
    );
  });

  it('行为洞察动作应支持跳转到交易页与 AI 助手', () => {
    financeStoreMock.state = {
      transactions: [
        {
          id: 'tx-1',
          date: '2026-04-20',
          type: 'expense',
          categoryId: 'cat-food',
          accountId: 'acc-cash',
          amount: 38,
          note: '咖啡',
          tags: []
        },
        {
          id: 'tx-2',
          date: '2026-04-19',
          type: 'expense',
          categoryId: 'cat-shopping',
          accountId: 'acc-cash',
          amount: 188,
          note: '网购',
          tags: []
        },
        {
          id: 'tx-3',
          date: '2026-04-12',
          type: 'income',
          categoryId: 'cat-salary',
          accountId: 'acc-bank',
          amount: 3200,
          note: '工资',
          tags: []
        }
      ],
      categories: [
        {
          id: 'cat-food',
          name: '餐饮',
          kind: 'expense',
          color: '#f97316',
          icon: '🍜',
          sortOrder: 1
        },
        {
          id: 'cat-shopping',
          name: '购物',
          kind: 'expense',
          color: '#8b5cf6',
          icon: '🛍️',
          sortOrder: 2
        },
        {
          id: 'cat-salary',
          name: '工资',
          kind: 'income',
          color: '#16a34a',
          icon: '💰',
          sortOrder: 3
        }
      ],
      accounts: [
        { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 500, balance: 200 },
        { id: 'acc-bank', name: '银行卡', type: 'debit', initialBalance: 1000, balance: 4200 }
      ],
      subscriptions: []
    };

    appPreferencesMock.state = {
      debts: [],
      repaymentRecords: [],
      monthlyIncome: 6000
    };

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '查看消费明细' }));
    expect(navigateMock).toHaveBeenCalledWith(
      '/transactions?type=expense&datePreset=custom&dateFrom=2026-03-22&dateTo=2026-04-20'
    );

    fireEvent.click(screen.getByRole('button', { name: '去 AI 助手' }));
    expect(navigateMock).toHaveBeenCalledWith('/assistant');
  });
});
