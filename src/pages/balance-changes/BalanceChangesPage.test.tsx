import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { BalanceChangeEntry, TransactionItem } from '../../entities/transaction/types';
import { BalanceChangesPage } from './BalanceChangesPage';

/**
 * 这一页重构后必须守住的三件事(都是重构前的硬伤):
 *
 * 1. **默认就看得到明细** —— 原来三组全部收起,一屏只有折叠头
 * 2. **汇总是筛选后的全部口径,不是当前页** —— 原来「合计」只统计当页 50 条却看起来像全局
 * 3. **按天分组,每天是完整一组** —— 原来按「增加/减少」分组并且只分当页
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'zh' }, t: (key: string) => key })
}));

const financeStoreMock = vi.hoisted(() => ({
  state: {
    balanceChangeEntries: [] as BalanceChangeEntry[],
    accounts: [] as Account[],
    transactions: [] as TransactionItem[]
  }
}));

vi.mock('../../shared/store/useFinanceStore', () => ({
  useFinanceStore: (selector: (state: typeof financeStoreMock.state) => unknown) =>
    selector(financeStoreMock.state)
}));

const account: Account = {
  id: 'acc-cash',
  name: '现金',
  type: 'cash',
  initialBalance: 0,
  balance: 0,
  sortOrder: 1
};

/** 造一条明细:同一账户上连续变动,保证 before/after 首尾相接。 */
function entry(
  id: string,
  options: { at: string; amount: number; before: number; type?: string; note?: string; accountId?: string; relatedTransactionId?: string } = {
    at: '2026-04-25T13:12:35.000Z',
    amount: 0,
    before: 0
  }
): BalanceChangeEntry {
  return {
    id,
    accountId: options.accountId ?? account.id,
    transactionId: `tx-${id}`,
    type: (options.type as BalanceChangeEntry['type']) ?? 'transaction-expense',
    amount: options.amount,
    beforeBalance: options.before,
    afterBalance: options.before + options.amount,
    createdAt: options.at,
    note: options.note ?? '',
    relatedTransactionId: options.relatedTransactionId
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BalanceChangesPage />
    </MemoryRouter>
  );
}

describe('BalanceChangesPage', () => {
  beforeEach(() => {
    financeStoreMock.state = {
      balanceChangeEntries: [],
      accounts: [account],
      transactions: []
    };
  });

  it('默认就展示明细行,不需要先展开', () => {
    financeStoreMock.state.balanceChangeEntries = [
      entry('e1', { at: '2026-04-25T13:12:35.000Z', amount: -11, before: 0, note: '夜宵' })
    ];

    renderPage();

    // 一进来就该看到这一条(重构前默认收起,只有折叠头)
    expect(screen.getByText('夜宵')).toBeInTheDocument();
    // 当天净额与这一行的变动额都会显示这个数
    expect(screen.getAllByText('−¥11.00').length).toBeGreaterThan(0);
  });

  it('没有任何记录时显示空态', () => {
    renderPage();
    expect(screen.getByText('暂无余额变动明细')).toBeInTheDocument();
  });

  it('汇总是筛选后的全部口径:翻页后数字不变', () => {
    // 40 天,每天 1 条,每页 20 天 → 两页
    const entries: BalanceChangeEntry[] = [];
    for (let i = 0; i < 40; i += 1) {
      const day = String(25 - (i % 25)).padStart(2, '0');
      const month = i < 25 ? '04' : '03';
      entries.push(
        entry(`e${i}`, {
          at: `2026-${month}-${day}T10:00:00.000Z`,
          amount: i % 2 === 0 ? 100 : -50,
          before: 0,
          note: `第 ${i} 条`
        })
      );
    }
    financeStoreMock.state.balanceChangeEntries = entries;

    renderPage();

    const netBefore = screen.getByText('净变动').nextElementSibling?.textContent;
    const pageInfoBefore = screen.getByText(/第 \d+ \/ \d+ 页/).textContent;

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    expect(screen.getByText(/第 \d+ \/ \d+ 页/).textContent).not.toBe(pageInfoBefore);
    // 汇总口径不变(重构前这里会变,因为只统计当页)
    expect(screen.getByText('净变动').nextElementSibling?.textContent).toBe(netBefore);
    expect(screen.getByText('笔数').nextElementSibling?.textContent).toBe('40');
  });

  it('按天分组,组头给出当天笔数与小计', () => {
    // 用本地时间构造:UTC 字面量会在 UTC+8 落到次日,把一天拆成两组
    const localAt = (day: number, hour: number) => new Date(2026, 3, day, hour, 0, 0).toISOString();
    financeStoreMock.state.balanceChangeEntries = [
      entry('d1-a', { at: localAt(25, 9), amount: 100, before: 0, note: '上午' }),
      entry('d1-b', { at: localAt(25, 18), amount: -30, before: 100, note: '晚上' }),
      entry('d2-a', { at: localAt(24, 12), amount: -20, before: 200, note: '昨天' })
    ];

    renderPage();

    // 一天有 2 条 → 有分组头(笔数 + 当天小计);一天只有 1 条 → 不占表头,
    // 日期并入该行的时间列(否则稀疏数据里表头会占掉半屏)
    const groups = document.querySelectorAll('.balance-change-day');
    expect(groups).toHaveLength(2);

    const multiEntryGroup = [...groups].find((g) => g.querySelector('.balance-change-day-head'));
    expect(multiEntryGroup).toBeTruthy();
    expect(within(multiEntryGroup as HTMLElement).getByText('2 笔')).toBeInTheDocument();
    // 当天净额只出现一次(「小计 +¥70.00」),而不是在两列里各写一遍
    expect(within(multiEntryGroup as HTMLElement).getByText(/小计 \+¥70\.00/)).toBeInTheDocument();

    const singleEntryGroup = [...groups].find((g) => !g.querySelector('.balance-change-day-head'));
    expect(singleEntryGroup).toBeTruthy();
    expect(
      (singleEntryGroup as HTMLElement).querySelector('.balance-change-day-inline')?.textContent
    ).toBeTruthy();
    expect(within(singleEntryGroup as HTMLElement).getByText('昨天')).toBeInTheDocument();
  });

  it('按类型筛选后只剩该类型,且无结果时给出专门提示', () => {
    financeStoreMock.state.balanceChangeEntries = [
      entry('a', { at: '2026-04-25T09:00:00.000Z', amount: -10, before: 0, note: '支出记录' }),
      entry('b', {
        at: '2026-04-25T10:00:00.000Z',
        amount: 20,
        before: 100,
        type: 'manual-adjustment',
        note: '手动调整'
      })
    ];

    renderPage();

    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'manual-adjustment' } });

    expect(screen.getByText('手动调整')).toBeInTheDocument();
    expect(screen.queryByText('支出记录')).not.toBeInTheDocument();

    // 关键字搜不到时是「没有匹配的记录」,而不是「暂无明细」
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '不存在的关键字' } });
    expect(screen.getByText('没有匹配的记录')).toBeInTheDocument();
    expect(screen.queryByText('暂无余额变动明细')).not.toBeInTheDocument();
  });

  it('展开某一行显示余额变化路径与关联原单', () => {
    financeStoreMock.state.balanceChangeEntries = [
      entry('e1', {
        at: '2026-04-25T13:12:35.000Z',
        amount: 390.55,
        before: 1000,
        type: 'transaction-refund',
        note: '退款回补',
        relatedTransactionId: 'tx-origin'
      })
    ];
    financeStoreMock.state.transactions = [
      {
        id: 'tx-origin',
        date: '2026-04-20T10:00:00.000Z',
        type: 'expense',
        categoryId: 'cat-food',
        accountId: account.id,
        amount: 390.55,
        note: '原单:家居小物',
        tags: []
      } as TransactionItem
    ];

    renderPage();

    expect(screen.queryByText('变动前')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /退款回补/ }));

    expect(screen.getByText('变动前')).toBeInTheDocument();
    expect(screen.getByText('变动后')).toBeInTheDocument();
    // 关联原单只说一次(重构前同一件事在卡片里出现三次)
    expect(screen.getByText(/关联原单:原单:家居小物/)).toBeInTheDocument();
  });

  it('筛选与页码写进 URL,刷新后仍是同一视图', () => {
    financeStoreMock.state.balanceChangeEntries = [
      entry('a', { at: '2026-04-25T09:00:00.000Z', amount: -10, before: 0, note: '支出记录' })
    ];

    renderPage();
    const searchInput = screen.getByLabelText('搜索') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: '支出' } });

    // 值受 URL 参数驱动:若没写进 URL,受控输入会立刻被重置为空
    expect(searchInput.value).toBe('支出');
    expect(screen.getByText('支出记录')).toBeInTheDocument();
  });
});
