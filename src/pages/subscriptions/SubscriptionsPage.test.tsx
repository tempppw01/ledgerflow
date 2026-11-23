import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionItem } from '../../entities/subscription/types';
import { SubscriptionsPage } from './SubscriptionsPage';

/**
 * 订阅管理页原来没有测试。这里钉住本次调整的四处行为:
 *
 * 1. 概览药丸从「死统计」变成**可点筛选**(点「已到期」只显示已到期)
 * 2. 「只看待处理」筛出已到期 + 即将到期
 * 3. 筛选无匹配时给专门空态,并能一键回到全部
 * 4. 卡片操作收敛:默认只有主操作 + 「更多」;表单默认收起
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'zh' }, t: (key: string) => key })
}));

const financeStoreMock = vi.hoisted(() => ({
  state: {
    subscriptions: [] as SubscriptionItem[],
    accounts: [] as never[],
    addSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    removeSubscription: vi.fn(),
    generateSubscriptionTransaction: vi.fn()
  }
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

function subscription(
  id: string,
  name: string,
  status: SubscriptionItem['status'],
  overrides: Partial<SubscriptionItem> = {}
): SubscriptionItem {
  return {
    id,
    name,
    kind: 'digital',
    amount: 15,
    currency: 'CNY',
    billingCycle: 'monthly',
    status,
    renewalDate: '2026-11-20',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SubscriptionsPage />
    </MemoryRouter>
  );
}

describe('SubscriptionsPage', () => {
  beforeEach(() => {
    financeStoreMock.state = {
      subscriptions: [
        subscription('sub-expired', 'Spotify Premium', 'expired'),
        subscription('sub-due', 'iCloud+ 200GB', 'due-soon'),
        subscription('sub-active', 'Netflix 标准版', 'active')
      ],
      accounts: [],
      addSubscription: vi.fn(),
      updateSubscription: vi.fn(),
      removeSubscription: vi.fn(),
      generateSubscriptionTransaction: vi.fn()
    };
  });

  it('概览药丸是可点的筛选按钮,点击后只显示该状态的订阅', () => {
    renderPage();

    const expiredPill = screen.getByRole('button', { name: /已到期/ });
    expect(expiredPill).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Spotify Premium')).toBeInTheDocument();
    expect(screen.getByText('Netflix 标准版')).toBeInTheDocument();

    fireEvent.click(expiredPill);

    expect(screen.getByRole('button', { name: /已到期/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByText('Spotify Premium')).toBeInTheDocument();
    expect(screen.queryByText('Netflix 标准版')).not.toBeInTheDocument();
  });

  it('「只看待处理」会筛出已到期与即将到期', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '只看待处理' }));

    expect(screen.getByText('Spotify Premium')).toBeInTheDocument();
    expect(screen.getByText('iCloud+ 200GB')).toBeInTheDocument();
    expect(screen.queryByText('Netflix 标准版')).not.toBeInTheDocument();
  });

  it('筛选无匹配时给出专门空态,并可一键回到全部', () => {
    financeStoreMock.state.subscriptions = [subscription('sub-active', 'Netflix 标准版', 'active')];

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /已到期/ }));

    expect(screen.getByText('这个状态暂时没有订阅')).toBeInTheDocument();
    expect(screen.queryByText('还没有订阅项目')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '看全部订阅' }));
    expect(screen.getByText('Netflix 标准版')).toBeInTheDocument();
  });

  it('卡片默认只有主操作与「更多」,低频操作在菜单里', () => {
    renderPage();

    const card = screen.getByText('Spotify Premium').closest('.subscriptions-card');
    expect(card).not.toBeNull();
    const buttons = within(card as HTMLElement).getAllByRole('button');
    expect(buttons.map((b) => (b.textContent || '').trim())).toEqual(['生成支出', '⋯']);
    expect(within(card as HTMLElement).queryByText('删除')).not.toBeInTheDocument();

    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '更多操作:Spotify Premium' }));

    expect(within(card as HTMLElement).getByText('查看支出')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('编辑')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('删除')).toBeInTheDocument();
  });

  it('新增表单默认收起,点开后才出现模板与字段', () => {
    renderPage();

    expect(screen.queryByText('从常用模板开始')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新增订阅' }));

    expect(screen.getByText('从常用模板开始')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起表单' })).toBeInTheDocument();
  });

  /*
   * store 的重复保护是对的(同一天同一订阅只记一次),但它返回的是**已有那笔**的 id。
   * 页面原先不区分 duplicated,直接导航到那笔交易的**编辑页** —— 用户双击一下
   * 就被丢进一个已有记录的编辑表单,既没被告知「没有重复记账」,也容易顺手改掉它。
   */
  it('重复生成时说明「今天已经生成过」,不再静默跳进那笔交易的编辑页', () => {
    financeStoreMock.state.generateSubscriptionTransaction.mockReturnValue({
      transactionId: 'tx-existing',
      duplicated: true
    });

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: '生成支出' })[0]);

    expect(
      screen.getByText(/今天已经为「Spotify Premium」生成过支出,没有重复记账。/)
    ).toBeInTheDocument();
    // 没有跳走:订阅清单还在页面上。
    expect(screen.getByText('Spotify Premium')).toBeInTheDocument();
  });

  it('正常生成后不显示「已生成过」提示', () => {
    financeStoreMock.state.generateSubscriptionTransaction.mockReturnValue({
      transactionId: 'tx-new',
      duplicated: false
    });

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: '生成支出' })[0]);

    expect(screen.queryByText(/已经为「Spotify Premium」生成过支出/)).not.toBeInTheDocument();
  });
});
