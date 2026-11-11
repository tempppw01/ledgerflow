import { describe, expect, it, vi } from 'vitest';
import type {
  InvestmentGoal,
  InvestmentPosition,
  InvestmentWatchItem
} from '../../../entities/investment/types';
import {
  executeInvestmentToolCall,
  INVESTMENT_AGENT_TOOLS,
  type InvestmentAgentContext
} from './investmentAgentTools';

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
    isActive: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  },
  {
    id: 'pos-2',
    name: '医疗主题股票基金',
    category: 'active-fund',
    investedAmount: 12000,
    currentValue: 9860,
    riskLevel: 'high',
    isActive: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  }
];

const goals: InvestmentGoal[] = [
  {
    id: 'goal-1',
    name: '家庭应急金',
    kind: 'emergency',
    targetAmount: 60000,
    currentAmount: 5000,
    priority: 'high',
    targetDate: '2027-06-01',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  }
];

const watchlist: InvestmentWatchItem[] = [
  {
    id: 'watch-1',
    name: '科技成长混合',
    code: '123456',
    platform: '东方财富',
    tags: ['关注中'],
    holdingShares: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-16T09:10:00.000Z'
  }
];

function createContext() {
  const upsertWatchItem = vi.fn();
  const updateGoal = vi.fn();
  const ctx: InvestmentAgentContext = {
    positions: positions.map((item) => ({ ...item })),
    goals: goals.map((item) => ({ ...item })),
    watchlist: watchlist.map((item) => ({ ...item })),
    monthlyInvestableCash: 4000,
    upsertWatchItem,
    updateGoal
  };
  return { ctx, upsertWatchItem, updateGoal };
}

function call(name: string, args: Record<string, unknown>) {
  return { id: `${name}-1`, name, arguments: JSON.stringify(args) };
}

describe('investment agent tools', () => {
  it('exposes the documented investment tool set', () => {
    const names = INVESTMENT_AGENT_TOOLS.map((tool) => tool.function.name);
    expect(names).toEqual([
      'get_portfolio_snapshot',
      'query_investment_watchlist',
      'update_watch_holding_shares',
      'update_investment_goal_progress'
    ]);
  });

  it('returns portfolio totals, positions and goal gaps', () => {
    const { ctx } = createContext();
    const execution = executeInvestmentToolCall(call('get_portfolio_snapshot', {}), ctx);
    const payload = JSON.parse(execution.content) as {
      ok: boolean;
      summary: { totalCurrentValue: number; totalProfit: number; positionCount: number };
      goals: Array<{ name: string; gap: number }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.summary.positionCount).toBe(2);
    expect(payload.summary.totalCurrentValue).toBeCloseTo(20740);
    expect(payload.summary.totalProfit).toBeCloseTo(-1260);
    expect(payload.goals[0]).toMatchObject({ name: '家庭应急金', gap: 55000 });
    expect(execution.views[0]).toMatchObject({ kind: 'read', undoable: false });
  });

  it('filters the watchlist by code or name keyword', () => {
    const { ctx } = createContext();
    const execution = executeInvestmentToolCall(
      call('query_investment_watchlist', { keyword: '123456' }),
      ctx
    );
    const payload = JSON.parse(execution.content) as {
      matchedCount: number;
      watchlist: Array<{ id: string; name: string }>;
    };

    expect(payload.matchedCount).toBe(1);
    expect(payload.watchlist[0]).toMatchObject({ id: 'watch-1', name: '科技成长混合' });
  });

  it('updates holding shares and can undo the change', () => {
    const { ctx, upsertWatchItem } = createContext();
    const execution = executeInvestmentToolCall(
      call('update_watch_holding_shares', { id: 'watch-1', shares: 1500 }),
      ctx
    );
    const payload = JSON.parse(execution.content) as { ok: boolean; holdingShares: number };

    expect(payload).toMatchObject({ ok: true, holdingShares: 1500 });
    expect(ctx.watchlist[0].holdingShares).toBe(1500);
    expect(upsertWatchItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'watch-1', holdingShares: 1500 })
    );
    expect(execution.views[0]).toMatchObject({ kind: 'update', undoable: true });

    execution.undo[0].run();
    expect(ctx.watchlist[0].holdingShares).toBe(0);
    expect(upsertWatchItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'watch-1', holdingShares: 0 })
    );
  });

  it('rejects a holding update when no watch item matches', () => {
    const { ctx } = createContext();
    const execution = executeInvestmentToolCall(
      call('update_watch_holding_shares', { name: '不存在的基金', shares: 100 }),
      ctx
    );
    expect(JSON.parse(execution.content)).toMatchObject({ ok: false });
    expect(execution.views).toHaveLength(0);
  });

  it('updates goal progress and can undo the change', () => {
    const { ctx, updateGoal } = createContext();
    const execution = executeInvestmentToolCall(
      call('update_investment_goal_progress', { name: '应急金', currentAmount: 12000 }),
      ctx
    );
    const payload = JSON.parse(execution.content) as { ok: boolean; gap: number };

    expect(payload).toMatchObject({ ok: true, gap: 48000 });
    expect(ctx.goals[0].currentAmount).toBe(12000);
    expect(updateGoal).toHaveBeenCalledWith(
      'goal-1',
      expect.objectContaining({ currentAmount: 12000 })
    );

    execution.undo[0].run();
    expect(ctx.goals[0].currentAmount).toBe(5000);
  });

  it('returns a structured error for unknown tools', () => {
    const { ctx } = createContext();
    const execution = executeInvestmentToolCall(call('unknown_tool', {}), ctx);
    expect(JSON.parse(execution.content)).toMatchObject({ ok: false });
  });
});
