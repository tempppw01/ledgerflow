import { describe, expect, it } from 'vitest';
import {
  aggregateRowsByMonth,
  buildAssetLiabilitySimulation,
  classifyForecastBillsByWindow
} from './assetLiabilitySimulation';
import { describeSimulationEvent } from './assetLiabilitySimulationFormat';
import type { ForecastBill } from '../../../entities/forecast/types';

describe('buildAssetLiabilitySimulation', () => {
  it('projects scheduled income, repayment and subscription changes by date', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [
        { id: 'cash', name: '现金', type: 'cash', balance: 1000 },
        { id: 'card', name: '信用卡', type: 'credit', balance: 500 }
      ],
      investmentPositions: [],
      transactions: [
        {
          id: 'income',
          type: 'income',
          categoryId: 'salary',
          accountId: 'cash',
          amount: 2000,
          date: '2026-09-22',
          note: '',
          tags: []
        }
      ],
      subscriptions: [
        {
          id: 'music',
          name: '音乐会员',
          kind: 'digital',
          amount: 30,
          currency: 'CNY',
          billingCycle: 'monthly',
          renewalDate: '2026-09-23',
          status: 'active',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ],
      debts: [
        {
          id: 'loan',
          name: '消费贷',
          type: 'consumer-loan',
          balance: 900,
          manualRepayments: [{ id: 'p1', dueDate: '2026-09-24', amount: 100 }]
        }
      ],
      days: 7
    });

    expect(result.initialAssets).toBe(1000);
    expect(result.initialLiabilities).toBe(1400);
    expect(result.rows[2]).toMatchObject({ date: '2026-09-22', delta: 2000, assets: 3000 });
    expect(result.rows[3]).toMatchObject({
      date: '2026-09-23',
      delta: -30,
      assets: 2970
    });
    expect(result.rows[4]).toMatchObject({
      date: '2026-09-24',
      delta: 0,
      assets: 2870,
      liabilities: 1300
    });
    // 事件只带 kind 与名称(i18n 友好的枚举),不预拼中文文案。
    expect(result.rows[2].events).toEqual([{ kind: 'plannedIncome' }]);
    expect(result.rows[3].events).toEqual([{ kind: 'subscription', name: '音乐会员' }]);
    expect(result.rows[4].events).toEqual([{ kind: 'plannedRepayment', name: '消费贷' }]);
    expect(result.hasEvents).toBe(true);
  });

  it('projects recurring monthly repayments and reduces liabilities over time', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 2000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [
        {
          id: 'loan',
          name: '固定月供贷款',
          type: 'loan',
          balance: 1200,
          customMinPayment: 300,
          repaymentDay: 25,
          annualRate: 0
        }
      ],
      days: 7
    });

    expect(result.rows[4]).toMatchObject({
      date: '2026-09-24',
      assets: 2000,
      liabilities: 1200
    });
    expect(result.rows[5]).toMatchObject({
      date: '2026-09-25',
      assets: 1700,
      liabilities: 900,
      liabilityDelta: -300
    });
  });

  it('applies one-off forecast income and expense bills on their own dates only', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 1000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [],
      forecastBills: [
        {
          id: 'bill-rent',
          name: '房租',
          amount: 600,
          date: '2026-09-22',
          direction: 'expense',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        },
        {
          id: 'bill-bonus',
          name: '奖金',
          amount: 800,
          date: '2026-09-24',
          direction: 'income',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        }
      ],
      days: 7
    });

    expect(result.rows[1]).toMatchObject({ date: '2026-09-21', forecastDelta: 0, assets: 1000 });
    expect(result.rows[2]).toMatchObject({ date: '2026-09-22', forecastDelta: -600, assets: 400 });
    expect(result.rows[2].forecastBillIds).toEqual(['bill-rent']);
    expect(result.rows[3]).toMatchObject({ date: '2026-09-23', forecastDelta: 0, assets: 400 });
    expect(result.rows[3].forecastBillIds).toEqual([]);
    expect(result.rows[4]).toMatchObject({ date: '2026-09-24', forecastDelta: 800, assets: 1200 });
    expect(result.rows[4].forecastBillIds).toEqual(['bill-bonus']);
    // 事件只带 kind 与名称,模型层不拼展示文案。
    expect(result.rows[2].events).toEqual([{ kind: 'forecastExpense', name: '房租' }]);
    expect(result.rows[3].events).toEqual([]);
    expect(result.rows[4].events).toEqual([{ kind: 'forecastIncome', name: '奖金' }]);
    // 预测账单只推演现金流,不会凭空改变负债。
    expect(result.rows[4].liabilities).toBe(result.initialLiabilities);
  });

  it('repeats monthly forecast bills on the same day and clamps short months', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-01-05T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 5000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [],
      forecastBills: [
        {
          id: 'bill-insurance',
          name: '保险分期',
          amount: 300,
          date: '2026-01-31',
          direction: 'expense',
          repeat: 'monthly',
          createdAt: '2026-01-05T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z'
        }
      ],
      days: 90
    });

    const hits = result.rows.filter((row) => row.forecastDelta !== 0).map((row) => row.date);
    expect(hits).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(
      hits.every((date) => result.rows.find((row) => row.date === date)?.forecastDelta === -300)
    ).toBe(true);
    // 每条命中都要带上账单 id,面板才能按账单统计本期次数。
    expect(
      result.rows.filter((row) => row.forecastBillIds.length > 0).map((row) => row.date)
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('ignores forecast bills that fall outside the simulated window', () => {
    const result = buildAssetLiabilitySimulation({
      now: new Date('2026-09-20T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 1000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [],
      forecastBills: [
        {
          id: 'bill-late',
          name: '远期支出',
          amount: 2000,
          date: '2027-03-01',
          direction: 'expense',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        },
        {
          id: 'bill-empty',
          name: '零金额',
          amount: 0,
          date: '2026-09-21',
          direction: 'expense',
          repeat: 'once',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z'
        }
      ],
      days: 7
    });

    expect(result.hasEvents).toBe(false);
    expect(result.rows.every((row) => row.forecastDelta === 0)).toBe(true);
    expect(result.rows.every((row) => row.forecastBillIds.length === 0)).toBe(true);
    expect(result.rows.at(-1)?.assets).toBe(1000);
  });
});

describe('aggregateRowsByMonth', () => {
  const buildSimulation = () =>
    buildAssetLiabilitySimulation({
      now: new Date('2026-11-20T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 10000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [
        {
          id: 'sub-1',
          name: '云盘',
          kind: 'digital',
          amount: 100,
          currency: 'CNY',
          billingCycle: 'monthly',
          renewalDate: '2026-12-05',
          status: 'active',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ],
      debts: [
        {
          id: 'loan',
          name: '消费贷',
          type: 'consumer-loan',
          balance: 3000,
          customMinPayment: 1000,
          repaymentDay: 25,
          annualRate: 0
        }
      ],
      days: 90
    });

  it('把当月所有天的变化累加,而不是只取月末那天', () => {
    const simulation = buildSimulation();
    const monthly = aggregateRowsByMonth(simulation.rows);
    const december = monthly.find((row) => row.date.startsWith('2026-12'));
    const dailyDecember = simulation.rows.filter((row) => row.date.startsWith('2026-12'));

    expect(dailyDecember.length).toBeGreaterThan(1);
    expect(december?.delta).toBe(dailyDecember.reduce((sum, row) => sum + row.delta, 0));
    expect(december?.date).toBe('2026-12-31');

    // 12/5 订阅 −100、12/25 还款 −1000:还款让现金和负债同时减少,对净资产是 0,
    // 所以净变化只有订阅那 100;但资产口径把两笔都算进去,合计 −1100。
    expect(december?.delta).toBe(-100);
    expect(december?.assetDelta).toBe(-1100);
    // 旧实现取的是 12/31 当天(没有任何安排)的 delta,也就是 0。
    expect(simulation.rows.find((row) => row.date === '2026-12-31')?.delta).toBe(0);
  });

  it('月度 delta 与月末净资产之差始终一致(和折线同口径)', () => {
    const simulation = buildSimulation();
    const monthly = aggregateRowsByMonth(simulation.rows);
    const initialNetWorth = simulation.initialAssets - simulation.initialLiabilities;

    expect(monthly[0].delta).toBe(monthly[0].netWorth - initialNetWorth);
    monthly.slice(1).forEach((row, index) => {
      const previous = monthly[index];
      expect(row.delta).toBeCloseTo(row.netWorth - previous.netWorth, 6);
    });
  });

  it('同一条事件在月内出现多次时合并成一条并记次数', () => {
    const monthly = aggregateRowsByMonth(
      buildAssetLiabilitySimulation({
        now: new Date('2026-11-20T08:00:00'),
        accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 10000 }],
        investmentPositions: [],
        transactions: [],
        subscriptions: [],
        debts: [
          {
            id: 'loan-a',
            name: '消费贷',
            type: 'consumer-loan',
            balance: 3000,
            customMinPayment: 500,
            repaymentDay: 25,
            annualRate: 0
          },
          {
            id: 'loan-b',
            name: '消费贷',
            type: 'consumer-loan',
            balance: 3000,
            customMinPayment: 500,
            repaymentDay: 25,
            annualRate: 0
          }
        ],
        days: 40
      }).rows
    );
    const november = monthly.find((row) => row.date.startsWith('2026-11'));

    // 同名同日的两笔都在 11/25 扣款 → 合并成一条,次数记 2。
    expect(november?.events).toEqual([{ kind: 'monthlyRepayment', name: '消费贷', count: 2 }]);
    expect(describeSimulationEvent(november!.events[0], (key) => key)).toBe(
      'dashboard.ui.simulation.event.monthlyRepayment · 消费贷 ×2'
    );
  });

  it('空区间返回空数组,不抛错', () => {
    expect(aggregateRowsByMonth([])).toEqual([]);
  });
});

describe('classifyForecastBillsByWindow', () => {
  const bill = (id: string, date: string): ForecastBill => ({
    id,
    name: id,
    amount: 100,
    date,
    direction: 'expense',
    repeat: 'once',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  });

  const oneMonthWindow = (bills: ForecastBill[] = []) =>
    buildAssetLiabilitySimulation({
      now: new Date('2026-11-23T08:00:00'),
      accounts: [{ id: 'cash', name: '现金', type: 'cash', balance: 1000 }],
      investmentPositions: [],
      transactions: [],
      subscriptions: [],
      debts: [],
      forecastBills: bills,
      days: 30
    }).rows;

  const occurrencesOf = (rows: ReturnType<typeof oneMonthWindow>) =>
    rows.reduce<Record<string, number>>((acc, row) => {
      row.forecastBillIds.forEach((id) => {
        acc[id] = (acc[id] || 0) + 1;
      });
      return acc;
    }, {});

  // 用户报的现象:录入了账单,账单在列表里、还计入净影响,日历却一格不动。
  // 根因是窗口外,而这一点以前在界面上完全看不出来。
  it('窗口外的账单被单独识别出来(而不是静默消失)', () => {
    const bills = [
      bill('in-window', '2026-12-01'),
      bill('far-away', '2027-06-01'),
      bill('beyond-horizon', '2030-01-01')
    ];
    const rows = oneMonthWindow(bills); // 2026-11-23 起 30 天

    const status = classifyForecastBillsByWindow(rows, bills, occurrencesOf(rows));

    expect(status.windowStart).toBe('2026-11-23');
    expect(status.windowEnd).toBe('2026-12-22');
    expect(status.visibleIds).toEqual(['in-window']);
    expect(status.outOfWindowIds).toEqual(['far-away', 'beyond-horizon']);
    // 2027-06-01 在 12 个月窗口内(切过去就能看到),2030 的不能
    expect(status.unreachableIds).toEqual(['beyond-horizon']);
  });

  it('日期非法或缺失的账单算作窗口外,并且不谎称「切到 12 个月能看到」', () => {
    const bills = [bill('no-date', ''), bill('bad-date', '2026/12/01')];
    const rows = oneMonthWindow(bills);

    const status = classifyForecastBillsByWindow(rows, bills, occurrencesOf(rows));

    expect(status.outOfWindowIds).toEqual(['no-date', 'bad-date']);
    expect(status.unreachableIds).toEqual(['no-date', 'bad-date']);
  });

  it('可见与否以推演结果为准:每月账单的首次发生日更早,当期仍然可见', () => {
    // 首次发生日 2026-09-25 早于窗口起点(11-23),窗口内只落到 11/25 一次
    // (下一次 12/25 已在窗口末日 12-22 之后)。
    const monthly = { ...bill('monthly-since', '2026-09-25'), repeat: 'monthly' as const };
    const rows = oneMonthWindow([monthly]);
    const status = classifyForecastBillsByWindow(rows, [monthly], occurrencesOf(rows));

    expect(occurrencesOf(rows)['monthly-since']).toBe(1);
    expect(status.outOfWindowIds).toEqual([]);
    expect(status.visibleIds).toEqual(['monthly-since']);
  });

  it('没有推演行时窗口为空,所有账单都算窗口外', () => {
    const status = classifyForecastBillsByWindow([], [bill('a', '2026-12-01')], {});

    expect(status.windowStart).toBe('');
    expect(status.windowEnd).toBe('');
    expect(status.outOfWindowIds).toEqual(['a']);
  });
});
