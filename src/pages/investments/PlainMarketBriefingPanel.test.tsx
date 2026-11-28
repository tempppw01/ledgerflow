import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  EastmoneyMarketBoard,
  EastmoneyMarketNewsItem
} from '../../features/investments/api/eastmoneyMarketClient';
import type { InvestmentMarketInsight } from './investmentAi';
import { PlainMarketBriefingPanel } from './PlainMarketBriefingPanel';

function board(name: string, changePercent: number): EastmoneyMarketBoard {
  return {
    code: name,
    name,
    value: 1000,
    change: 1,
    changePercent,
    volume: null,
    amount: null,
    upCount: null,
    downCount: null,
    flatCount: null
  };
}

function news(title: string, summary = ''): EastmoneyMarketNewsItem {
  return { id: title, title, summary, time: '2026-11-28T02:00:00.000Z', link: '', stocks: [] };
}

/** 8 涨 22 跌:偏弱的一侧,用来验证"结论由数据推出来"。 */
const weakBoards = [
  ...Array.from({ length: 8 }, (_, index) => board(`强${index}`, 1 + index / 10)),
  ...Array.from({ length: 22 }, (_, index) => board(`弱${index}`, -1 - index / 10))
];

const baseProps = {
  themeBoards: [] as EastmoneyMarketBoard[],
  news: [] as EastmoneyMarketNewsItem[],
  insight: null as InvestmentMarketInsight | null,
  signals: { score: 12, riskScore: 40 },
  insightStatus: 'disabled' as const
};

describe('PlainMarketBriefingPanel', () => {
  it('把大盘涨跌与板块涨跌家数都写进那一句里', () => {
    render(<PlainMarketBriefingPanel {...baseProps} marketChange={-0.62} themeBoards={weakBoards} />);

    expect(screen.getByText(/大盘 -0.62%/)).toBeInTheDocument();
    expect(screen.getByText(/8 涨 22 跌/)).toBeInTheDocument();
    expect(screen.getByText(/整体偏弱/)).toBeInTheDocument();
  });

  it('全市场都在涨时,「领跌」那条如实说没有下跌的板块,而不是把涨得最少的说成偏弱', () => {
    render(
      <PlainMarketBriefingPanel
        {...baseProps}
        marketChange={1.2}
        themeBoards={[board('CPO概念', 12.64), board('油气资源', 4.78)]}
      />
    );

    expect(screen.getByText('没有下跌的板块')).toBeInTheDocument();
    expect(screen.getByText('CPO概念 +12.64%')).toBeInTheDocument();
    // 关键回归:那个 +4.78% 曾经被写成「今天偏弱,别急着接」
    expect(screen.queryByText(/偏弱/)).toBeNull();
    expect(screen.queryByText(/4.78%/)).toBeNull();
  });

  it('只有板块、没有指数时,不猜大盘', () => {
    render(<PlainMarketBriefingPanel {...baseProps} marketChange={null} themeBoards={weakBoards} />);

    expect(screen.getByText(/大盘数据暂缺/)).toBeInTheDocument();
    expect(screen.queryByText(/大盘 -|大盘 \+/)).toBeNull();
    expect(screen.getByText(/8 涨 22 跌/)).toBeInTheDocument();
  });

  it('两个数据源都没有时如实说数据没到', () => {
    render(<PlainMarketBriefingPanel {...baseProps} marketChange={null} />);
    expect(screen.getByText(/行情数据还没到/)).toBeInTheDocument();
  });

  it('指数与板块方向相反时说背离,而不是硬说偏强', () => {
    render(
      <PlainMarketBriefingPanel
        {...baseProps}
        marketChange={0.8}
        themeBoards={[board('A', 0.1), board('B', -2), board('C', -1.5)]}
      />
    );
    expect(screen.getByText(/不在一个方向上/)).toBeInTheDocument();
    expect(screen.queryByText(/整体偏强/)).toBeNull();
  });

  it('资讯优先取政策线索,并标成「政策」', () => {
    render(
      <PlainMarketBriefingPanel
        {...baseProps}
        marketChange={0.2}
        themeBoards={[board('A', 0.3)]}
        news={[news('某公司发布新品'), news('证监会发布新规,规范减持')]}
      />
    );
    expect(screen.getByText('政策')).toBeInTheDocument();
    expect(screen.getByText('证监会发布新规,规范减持')).toBeInTheDocument();
    expect(screen.queryByText('某公司发布新品')).toBeNull();
  });

  it('没有资讯时说正在同步,不留空行', () => {
    render(<PlainMarketBriefingPanel {...baseProps} marketChange={0.2} themeBoards={[board('A', 0.3)]} />);
    expect(screen.getByText('资讯正在同步')).toBeInTheDocument();
  });

  it('AI 简报存在时:要点用它自己的,并且把此前没人渲染的 suggestions 也显示出来', () => {
    const insight: InvestmentMarketInsight = {
      headline: 'AI 结论:权重撑指数,题材在退潮',
      summary: '指数微涨但多数板块下跌,情绪偏谨慎。',
      points: [
        { label: '板块', text: '题材股走弱' },
        { label: '风险', text: '成交量继续萎缩' }
      ],
      suggestions: [
        { tone: 'warning', emoji: '', title: '别追高', reason: '指数与题材背离' },
        { tone: 'neutral', emoji: '', title: '看持仓', reason: '等量能恢复' }
      ],
      confidence: 'medium',
      source: 'ai'
    };

    render(
      <PlainMarketBriefingPanel
        {...baseProps}
        marketChange={0.3}
        themeBoards={[board('A', 2), board('B', -1)]}
        insight={insight}
        insightStatus="ready"
        news={[news('某条新闻')]}
      />
    );

    expect(screen.getByText(insight.headline)).toBeInTheDocument();
    expect(screen.getByText(insight.summary)).toBeInTheDocument();
    // AI 要点取代本地三条,避免同一件事说两遍
    expect(screen.getByText('题材股走弱')).toBeInTheDocument();
    expect(screen.queryByText('领涨')).toBeNull();
    // suggestions 以前解析出来却被丢掉,现在渲染
    expect(screen.getByText('别追高')).toBeInTheDocument();
    expect(screen.getByText('等量能恢复')).toBeInTheDocument();
  });

  it('AI 要点最多 3 条、建议最多 2 条 —— 面板高度不能被模型输出拖着走', () => {
    const insight: InvestmentMarketInsight = {
      headline: '结论',
      summary: '',
      points: Array.from({ length: 6 }, (_, index) => ({ label: `L${index}`, text: `T${index}` })),
      suggestions: Array.from({ length: 5 }, (_, index) => ({
        tone: 'neutral' as const,
        emoji: '',
        title: `S${index}`,
        reason: ''
      })),
      confidence: 'low'
    };

    render(
      <PlainMarketBriefingPanel {...baseProps} marketChange={1} themeBoards={[]} insight={insight} />
    );

    expect(screen.getByText('T2')).toBeInTheDocument();
    expect(screen.queryByText('T3')).toBeNull();
    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.queryByText('S2')).toBeNull();
  });

  it('状态说明与分数分开渲染,分数带自己的标签', () => {
    render(<PlainMarketBriefingPanel {...baseProps} marketChange={0.5} themeBoards={[board('A', 1)]} />);

    const footer = document.querySelector('.investments-market-insight-footer') as HTMLElement;
    expect(within(footer).getByText(/本地信号/)).toBeInTheDocument();
    expect(within(footer).getByText('综合分')).toBeInTheDocument();
    expect(within(footer).getByText('12')).toBeInTheDocument();
    expect(within(footer).getByText('风险')).toBeInTheDocument();
    expect(within(footer).getByText('40')).toBeInTheDocument();
  });

  it('AI 复盘按钮把当前行情交给助手', () => {
    const onAskAi = vi.fn();
    render(
      <PlainMarketBriefingPanel
        {...baseProps}
        marketChange={-1.1}
        themeBoards={[board('CPO概念', 2), board('油气资源', -3)]}
        news={[news('政策放松预期升温')]}
        onAskAi={onAskAi}
      />
    );

    screen.getByRole('button', { name: /让 AI 复盘今日市场/ }).click();
    expect(onAskAi).toHaveBeenCalledTimes(1);
    const prompt = onAskAi.mock.calls[0][0] as string;
    expect(prompt).toContain('CPO概念');
    expect(prompt).toContain('政策放松预期升温');
  });
});
