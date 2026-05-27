import { beforeEach, describe, expect, it } from 'vitest';
import { useAppPreferences } from './useAppPreferences';

describe('useAppPreferences RSS subscriptions', () => {
  beforeEach(() => {
    localStorage.removeItem('ledgerflow-preferences');
    useAppPreferences.setState({
      theme: 'system',
      investmentPositions: [],
      investmentGoals: [],
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
});
