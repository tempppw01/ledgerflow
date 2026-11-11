import { describe, expect, it } from 'vitest';
import type {
  InvestmentFundAnalysis,
  InvestmentPosition,
  InvestmentWatchItem
} from '../../entities/investment/types';
import {
  buildInvestmentAssistantPrompt,
  buildInvestmentAssistantAuxiliaryInfo,
  buildInvestmentFundAnalysisPrompt,
  buildInvestmentHoldingAskPrompt,
  buildInvestmentMarketInsightPrompt,
  buildInvestmentMarketAskPrompt,
  buildInvestmentWatchlistReviewPrompt,
  extractInvestmentAnalysis,
  extractInvestmentMarketInsight,
  getInvestmentAssistantDisplayText,
  stripInvestmentAnalysisJson,
  summarizeInvestmentAnalysis
} from './investmentAi';

const baseAnalysis: InvestmentFundAnalysis = {
  fundName: 'Alpha Growth Fund',
  fundCode: '161706',
  verdict: 'Keep watching before adding',
  summary: 'This fund suits staged entries, but not a one-shot buy.',
  riskLevel: 'medium',
  highlights: ['Broad exposure'],
  risks: ['Short-term volatility'],
  actions: ['Wait for pullback'],
  watchTags: ['watching']
};

describe('summarizeInvestmentAnalysis', () => {
  it('removes lines already rendered by the structured analysis card', () => {
    expect(
      summarizeInvestmentAnalysis(
        [
          'Keep watching before adding',
          'This fund suits staged entries, but not a one-shot buy.',
          '- Check fee and drawdown before buying'
        ].join('\n'),
        baseAnalysis
      )
    ).toBe('- Check fee and drawdown before buying');
  });

  it('does not append the structured summary to the chat bubble fallback', () => {
    expect(summarizeInvestmentAnalysis('', baseAnalysis)).toBe('Keep watching before adding');
  });

  it('hides a structured JSON payload when the closing fence is missing', () => {
    const raw = ['建议先观察，等波动收窄后再决定。', '```json', JSON.stringify(baseAnalysis)].join(
      '\n'
    );

    const result = extractInvestmentAnalysis(raw);

    expect(result.displayText).toBe('建议先观察，等波动收窄后再决定。');
    expect(result.analysis).toMatchObject({ fundCode: '161706', riskLevel: 'medium' });
    expect(stripInvestmentAnalysisJson(raw)).not.toContain('fundName');
  });

  it('uses the structured verdict instead of exposing a JSON-only response', () => {
    const raw = ['```json', JSON.stringify(baseAnalysis)].join('\n');
    const result = extractInvestmentAnalysis(raw);

    expect(result.displayText).toBe('');
    expect(getInvestmentAssistantDisplayText(raw)).toBe('Keep watching before adding');
  });
});

describe('buildInvestmentAssistantAuxiliaryInfo', () => {
  it('does not claim successful web verification when search is unavailable', () => {
    const result = buildInvestmentAssistantAuxiliaryInfo({
      webEnabled: true,
      webQuery: '分析沪深 300 ETF',
      webSearchStatus: 'unavailable',
      webSearchMessage: '搜索服务暂不可用',
      webSearchSources: ['公开网络']
    });

    expect(result.webTrace).toContain('联网核验:未取得可用结果');
    expect(result.webTrace).toContain('未取得结果原因:搜索服务暂不可用');
    expect(result.webTrace).not.toContain('已取得可用结果');
    expect(result.webTrace).not.toContain('已开启联网核验');
    expect(result.webTrace).not.toContain('采用来源');
  });

  it('summarizes successful web search results and sources', () => {
    const result = buildInvestmentAssistantAuxiliaryInfo({
      webEnabled: true,
      webQuery: '分析沪深 300 ETF',
      webSearchStatus: 'success',
      webSearchMessage: '已自动切换到可达的搜索服务',
      webSearchSources: ['同花顺', '雪球']
    });

    expect(result.webTrace).toContain('联网核验:已取得可用结果');
    expect(result.webTrace).toContain('检索关键词:分析沪深 300 ETF');
    expect(result.webTrace).toContain('采用来源:同花顺、雪球');
    expect(result.webTrace).toContain('检索说明:已自动切换到可达的搜索服务');
    expect(result.webTrace).not.toContain('已开启联网核验');
  });

  it('marks partially available web search results accurately', () => {
    const result = buildInvestmentAssistantAuxiliaryInfo({
      webEnabled: true,
      webQuery: '查询基金最新净值',
      webSearchStatus: 'partial',
      webSearchMessage: '仅同花顺返回结果,雪球暂不可用',
      webSearchSources: ['同花顺']
    });

    expect(result.webTrace).toContain('联网核验:仅取得部分可用结果');
    expect(result.webTrace).toContain('部分结果说明:仅同花顺返回结果,雪球暂不可用');
    expect(result.webTrace).toContain('采用来源:同花顺');
    expect(result.webTrace).not.toContain('已取得可用结果');
  });
});

describe('investment prompt builders', () => {
  const positions: InvestmentPosition[] = [
    {
      id: 'pos-1',
      name: '沪深 300 ETF',
      category: 'index-fund',
      platform: '支付宝',
      investedAmount: 10000,
      currentValue: 10880,
      monthlyContribution: 1200,
      targetAllocation: 40,
      riskLevel: 'medium',
      note: '长期底仓',
      isActive: true,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    }
  ];

  const watchItem: InvestmentWatchItem = {
    id: 'watch-1',
    name: '科技成长混合',
    code: '123456',
    platform: '东方财富',
    tags: ['关注中'],
    note: '测试基金',
    lastVerdict: '继续观察',
    lastSummary: '等待政策催化',
    lastRiskLevel: 'unknown',
    investmentAdvice: '先观察',
    adviceReasons: ['估值较高'],
    riskNotes: ['波动较大'],
    nextActions: ['先看政策'],
    holdingShares: 0,
    performanceHistory: ['近 1 月 1.2%'],
    fundAnalysis: ['基金分析'],
    fundHoldings: ['宁德时代 6.2%'],
    assetAllocation: ['股票 90%', '现金 10%'],
    industryAllocation: ['科技 45%'],
    netValue: '1.2345',
    addedReturn: '+1.20%',
    holdingReturn: '+0.80%',
    buyFeeRate: '0.10%',
    fundCompany: '测试基金公司',
    lastAnalysisAt: '2026-07-16T09:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-16T09:10:00.000Z'
  };

  it('includes current time and market policy signals in fund analysis prompts', () => {
    const prompt = buildInvestmentFundAnalysisPrompt({
      watchItem,
      positions,
      marketContext: JSON.stringify(
        {
          socialNews: [{ title: '国务院支持消费政策落地', summary: '市场关注扩内需信号' }],
          policySignals: [{ title: '国务院支持消费政策落地', summary: '市场关注扩内需信号' }]
        },
        null,
        2
      ),
      timeContext: '当前中国标准时间：2026-07-16 09:30:00（来源：测试）',
      webContext: '联网资讯：暂无更多补充'
    });

    expect(prompt).toContain('当前中国标准时间：2026-07-16 09:30:00（来源：测试）');
    expect(prompt).toContain('socialNews');
    expect(prompt).toContain('policySignals');
    expect(prompt).toContain('国务院支持消费政策落地');
  });

  it('includes current time and market policy signals in watchlist review prompts', () => {
    const prompt = buildInvestmentWatchlistReviewPrompt({
      positions,
      watchlist: [watchItem],
      monthlyInvestableCash: 1234,
      marketContext: JSON.stringify(
        {
          socialNews: [{ title: '监管部门发布新规', summary: '强调稳增长和政策支持' }],
          policySignals: [{ title: '监管部门发布新规', summary: '强调稳增长和政策支持' }]
        },
        null,
        2
      ),
      timeContext: '当前中国标准时间：2026-07-16 09:30:00（来源：测试）'
    });

    expect(prompt).toContain('当前中国标准时间：2026-07-16 09:30:00（来源：测试）');
    expect(prompt).toContain('socialNews');
    expect(prompt).toContain('policySignals');
    expect(prompt).toContain('监管部门发布新规');
  });

  it('builds a daily market prompt with algorithm, news and holding context', () => {
    const prompt = buildInvestmentMarketInsightPrompt({
      positions,
      watchlist: [{ ...watchItem, holdingShares: 1200 }],
      monthlyInvestableCash: 2500,
      algorithmSignals: JSON.stringify({ score: 42, strongestTheme: '创新药 +2.10%' }),
      marketContext: JSON.stringify({
        socialNews: [{ title: '创新药审批提速', summary: '板块获得政策关注' }],
        hotThemes: [{ name: '创新药', changePercent: 2.1 }]
      }),
      timeContext: '当前中国标准时间：2026-07-16 15:10:00（来源：测试）'
    });

    expect(prompt).toContain('创新药 +2.10%');
    expect(prompt).toContain('创新药审批提速');
    expect(prompt).toContain('holdingShares');
    expect(prompt).toContain('15:10:00');
  });

  it('normalizes structured daily market insight output', () => {
    const insight = extractInvestmentMarketInsight(
      [
        '```json',
        JSON.stringify({
          headline: '创新药领涨，但不要追高',
          summary: '指数震荡，政策新闻让创新药成为当前热点。',
          points: [
            { label: '板块', text: '创新药上涨 2.10%，强于市场。' },
            { label: '新闻', text: '审批提速带来政策催化。' }
          ],
          suggestions: [
            {
              tone: 'warning',
              emoji: '🛑',
              title: '不追盘中急涨',
              reason: '强势板块波动也会放大。'
            }
          ],
          confidence: 'high'
        }),
        '```'
      ].join('\n')
    );

    expect(insight).toMatchObject({
      headline: '创新药领涨，但不要追高',
      confidence: 'high'
    });
    expect(insight?.points).toHaveLength(2);
    expect(insight?.suggestions[0]).toMatchObject({ tone: 'warning', title: '不追盘中急涨' });
  });

  it('summarizes portfolio totals and follow-ups in the assistant prompt', () => {
    const prompt = buildInvestmentAssistantPrompt({
      positions,
      goals: [
        {
          id: 'goal-1',
          name: '应急金',
          kind: 'emergency',
          targetAmount: 60000,
          currentAmount: 5000,
          priority: 'high',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z'
        }
      ],
      watchlist: [watchItem],
      monthlyInvestableCash: 4000,
      focus: { type: 'watch', label: '科技成长混合', detail: '基金代码 123456' }
    });

    expect(prompt).toContain('"totalCurrentValue"');
    expect(prompt).toContain('"allocationShare"');
    expect(prompt).toContain('"followUps"');
    expect(prompt).toContain('科技成长混合');
    expect(prompt).toContain('优先调用投资工具');
  });

  it('builds a scoped holding question with concrete numbers', () => {
    const prompt = buildInvestmentHoldingAskPrompt({
      name: '沪深 300 ETF',
      profitRate: 8.8,
      allocationShare: 52.5,
      currentValue: 10880,
      riskLevel: '中风险',
      monthlyContribution: 1200
    });

    expect(prompt).toContain('沪深 300 ETF');
    expect(prompt).toContain('+8.8%');
    expect(prompt).toContain('52.5%');
    expect(prompt).toContain('每月定投 ¥1200');
  });

  it('builds a market review question from themes and news', () => {
    const prompt = buildInvestmentMarketAskPrompt({
      marketChange: -0.42,
      themes: ['创新药', 'CPO概念'],
      news: '创新药审批提速'
    });

    expect(prompt).toContain('-0.42%');
    expect(prompt).toContain('创新药');
    expect(prompt).toContain('创新药审批提速');
  });

  it('keeps followUps from the structured analysis block', () => {
    const raw = [
      '先观察,不要一次性买入。',
      '```json',
      JSON.stringify({
        fundName: '科技成长混合',
        verdict: '继续观察',
        summary: '等待政策催化。',
        riskLevel: 'medium',
        highlights: [],
        risks: [],
        actions: [],
        followUps: ['这个基金重仓什么行业?', '回调多少再考虑?', '适合定投吗?']
      }),
      '```'
    ].join('\n');
    const extracted = extractInvestmentAnalysis(raw);

    expect(extracted.analysis?.followUps).toEqual([
      '这个基金重仓什么行业?',
      '回调多少再考虑?',
      '适合定投吗?'
    ]);
  });
});
