import { beforeEach, describe, expect, it } from 'vitest';
import { useAppPreferences } from './useAppPreferences';

describe('useAppPreferences RSS subscriptions', () => {
  beforeEach(() => {
    localStorage.removeItem('ledgerflow-preferences');
    useAppPreferences.setState({
      theme: 'system',
      investmentPositions: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: [],
      rssSubscriptions: [
        {
          id: 'rss-financial-times-markets',
          title: 'Financial Times · Markets',
          url: 'https://www.ft.com/markets?format=rss',
          enabled: true
        },
        {
          id: 'rss-yahoo-finance-top',
          title: 'Yahoo Finance · Top News',
          url: 'https://finance.yahoo.com/news/rssindex',
          enabled: true
        }
      ]
    });
  });

  it('should add a valid RSS feed and reject duplicates', () => {
    const first = useAppPreferences.getState().addRssSubscription({
      title: 'Reuters Markets',
      url: 'https://www.reutersagency.com/feed/?best-topics=business-finance'
    });
    const second = useAppPreferences.getState().addRssSubscription({
      title: 'Reuters Markets 2',
      url: 'https://www.reutersagency.com/feed/?best-topics=business-finance'
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('已订阅');
  });

  it('should toggle and remove RSS subscription', () => {
    const current = useAppPreferences.getState().rssSubscriptions[0];
    useAppPreferences.getState().toggleRssSubscription(current.id);
    const toggled = useAppPreferences
      .getState()
      .rssSubscriptions.find((item) => item.id === current.id);

    expect(toggled?.enabled).toBe(false);

    useAppPreferences.getState().removeRssSubscription(current.id);
    const removed = useAppPreferences
      .getState()
      .rssSubscriptions.find((item) => item.id === current.id);

    expect(removed).toBeUndefined();
  });

  it('should add, update and remove investment positions and goals', () => {
    useAppPreferences.getState().addInvestmentPosition({
      name: '沪深 300 ETF',
      category: 'index-fund',
      platform: '支付宝',
      linkedAccountId: '',
      investedAmount: 10000,
      currentValue: 10880,
      monthlyContribution: 1200,
      targetAllocation: 35,
      riskLevel: 'medium',
      note: '长期底仓',
      isActive: true
    });
    useAppPreferences.getState().addInvestmentGoal({
      name: '6 个月应急金',
      kind: 'emergency',
      targetAmount: 30000,
      currentAmount: 12000,
      monthlyContribution: 2000,
      targetDate: '2026-12-31',
      priority: 'high',
      note: '优先补足'
    });

    const position = useAppPreferences.getState().investmentPositions[0];
    const goal = useAppPreferences.getState().investmentGoals[0];

    expect(position.name).toBe('沪深 300 ETF');
    expect(goal.name).toBe('6 个月应急金');

    useAppPreferences.getState().updateInvestmentPosition(position.id, {
      ...position,
      currentValue: 11200,
      note: '继续持有'
    });
    useAppPreferences.getState().updateInvestmentGoal(goal.id, {
      ...goal,
      currentAmount: 15000,
      note: '进度提升'
    });

    expect(useAppPreferences.getState().investmentPositions[0].currentValue).toBe(11200);
    expect(useAppPreferences.getState().investmentGoals[0].currentAmount).toBe(15000);

    useAppPreferences.getState().removeInvestmentPosition(position.id);
    useAppPreferences.getState().removeInvestmentGoal(goal.id);

    expect(useAppPreferences.getState().investmentPositions).toEqual([]);
    expect(useAppPreferences.getState().investmentGoals).toEqual([]);
  });

  it('should upsert investment watchlist items and persist ai messages', () => {
    useAppPreferences.getState().upsertInvestmentWatchItem({
      name: '易方达沪深300ETF',
      code: '510310',
      platform: '支付宝',
      tags: ['宽基', '指数'],
      note: '适合长期观察',
      lastVerdict: '可以继续跟踪',
      lastSummary: '规模稳定，波动相对可控',
      lastRiskLevel: 'medium',
      lastAnalysisAt: '2026-05-27T10:00:00.000Z'
    });
    useAppPreferences.getState().upsertInvestmentWatchItem({
      name: '易方达沪深300ETF',
      code: '510310',
      platform: '支付宝',
      tags: ['宽基', '定投'],
      note: '更新后的备注',
      lastVerdict: '更适合分批跟踪',
      lastSummary: '最新分析优先级更高',
      lastRiskLevel: 'low',
      lastAnalysisAt: '2026-05-27T12:00:00.000Z'
    });
    useAppPreferences.getState().setInvestmentAiMessages([
      {
        id: 'msg-user-1',
        role: 'user',
        text: '这只基金还能继续定投吗？',
        createdAt: '2026-05-27T10:00:00.000Z'
      },
      {
        id: 'msg-assistant-1',
        role: 'assistant',
        text: '可以继续跟踪，但先控制节奏。',
        reasoning: '先看规模和波动，再看用户当前仓位。',
        analysis: {
          fundName: '易方达沪深300ETF',
          fundCode: '510310',
          verdict: '可以继续跟踪',
          summary: '规模稳定，适合作为观察名单的一部分。',
          riskLevel: 'medium',
          highlights: ['宽基属性清晰'],
          risks: ['短期波动仍在'],
          actions: ['观察回撤区间'],
          watchTags: ['宽基']
        },
        createdAt: '2026-05-27T10:01:00.000Z'
      }
    ]);

    const state = useAppPreferences.getState();
    expect(state.investmentWatchlist).toHaveLength(1);
    expect(state.investmentWatchlist[0].lastSummary).toBe('最新分析优先级更高');
    expect(state.investmentWatchlist[0].lastRiskLevel).toBe('low');
    expect(state.investmentAiMessages).toHaveLength(2);
    expect(state.investmentAiMessages[1].analysis?.fundCode).toBe('510310');
  });
});
