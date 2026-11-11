import type {
  InvestmentAnalysisRiskLevel,
  InvestmentCategory,
  InvestmentGoal,
  InvestmentPosition,
  InvestmentWatchItem
} from '../../../entities/investment/types';
import type { ChatToolCall, ChatToolDefinition } from '../api/openaiCompatibleClient';

export interface InvestmentAgentActionView {
  id: string;
  kind: 'read' | 'update';
  label: string;
  undoable: boolean;
  undone?: boolean;
}

export interface InvestmentAgentUndoEntry {
  id: string;
  run: () => void;
}

export interface InvestmentAgentContext {
  positions: InvestmentPosition[];
  goals: InvestmentGoal[];
  watchlist: InvestmentWatchItem[];
  monthlyInvestableCash: number;
  upsertWatchItem: (item: InvestmentWatchItem) => void;
  updateGoal: (id: string, payload: Omit<InvestmentGoal, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

export interface InvestmentToolExecution {
  content: string;
  views: InvestmentAgentActionView[];
  undo: InvestmentAgentUndoEntry[];
}

export const INVESTMENT_AGENT_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_portfolio_snapshot',
      description:
        '读取当前投资组合、目标进度、自选基金和每月可投资现金。回答与持仓比例、盈亏、目标缺口有关的问题前先调用它。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_investment_watchlist',
      description: '按基金/股票名称、代码或标签检索自选列表,返回持有份额、净值、收益、风险和建议。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '名称、代码或标签关键词,留空返回全部自选' },
          limit: { type: 'number', description: '返回条数,默认 8,最多 20' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_watch_holding_shares',
      description:
        '记录某只自选基金/股票的实际持有份额。修改前先用 query_investment_watchlist 确认 id。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '自选 id,优先使用' },
          name: { type: 'string', description: '没有 id 时按名称或代码匹配' },
          shares: { type: 'number', description: '持有份额,必须大于等于 0' }
        },
        required: ['shares'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_investment_goal_progress',
      description:
        '更新某个投资目标当前已存金额,例如应急金、旅行金或教育金。修改前先用 get_portfolio_snapshot 确认目标 id。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '目标 id,优先使用' },
          name: { type: 'string', description: '没有 id 时按目标名称匹配' },
          currentAmount: { type: 'number', description: '当前已存金额,必须大于等于 0' }
        },
        required: ['currentAmount'],
        additionalProperties: false
      }
    }
  }
];

export const INVESTMENT_AGENT_INSTRUCTIONS = [
  '你可以使用投资工具核对和更新用户自己的投资数据。',
  '规则:',
  '1. 回答持仓比例、盈亏、目标缺口或某只自选基金前,先调用工具读取真实数据,不要凭上下文猜测金额。',
  '2. 用户要求记录持有份额或目标已存金额时,先确认唯一目标,再调用更新工具;匹配到多个候选时先让用户选择。',
  '3. 工具执行后,用自然语言说明更新了什么,不要输出原始 JSON。',
  '4. 工具只能修改自选持有份额和目标已存金额,不能替用户交易、转账或承诺收益。'
].join('\n');

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(toText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toViewId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function categoryLabel(category: InvestmentCategory): string {
  const labels: Record<InvestmentCategory, string> = {
    cash: '现金理财',
    'fixed-income': '固收',
    'index-fund': '指数基金',
    'active-fund': '主动基金',
    stock: '股票',
    gold: '黄金',
    other: '其他'
  };
  return labels[category];
}

function riskLabel(risk: InvestmentAnalysisRiskLevel | undefined): string {
  if (risk === 'low') return '低风险';
  if (risk === 'medium') return '中风险';
  if (risk === 'high') return '高风险';
  return '风险未知';
}

function buildPortfolioSnapshot(ctx: InvestmentAgentContext) {
  const activePositions = ctx.positions.filter((item) => item.isActive);
  const totalInvested = activePositions.reduce((sum, item) => sum + item.investedAmount, 0);
  const totalCurrentValue = activePositions.reduce((sum, item) => sum + item.currentValue, 0);
  const totalProfit = totalCurrentValue - totalInvested;
  const totalMonthlyContribution = activePositions.reduce(
    (sum, item) => sum + (item.monthlyContribution || 0),
    0
  );
  const positions = activePositions.map((item) => {
    const profit = item.currentValue - item.investedAmount;
    return {
      id: item.id,
      name: item.name,
      category: categoryLabel(item.category),
      platform: item.platform || '',
      investedAmount: roundMoney(item.investedAmount),
      currentValue: roundMoney(item.currentValue),
      profit: roundMoney(profit),
      profitRate:
        item.investedAmount > 0 ? Number(((profit / item.investedAmount) * 100).toFixed(1)) : null,
      allocationShare:
        totalCurrentValue > 0
          ? Number(((item.currentValue / totalCurrentValue) * 100).toFixed(1))
          : null,
      monthlyContribution: roundMoney(item.monthlyContribution || 0),
      targetAllocation: item.targetAllocation ?? null,
      riskLevel: riskLabel(item.riskLevel),
      note: item.note || ''
    };
  });
  const goals = ctx.goals.map((item) => {
    const gap = Math.max(0, item.targetAmount - item.currentAmount);
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      targetAmount: roundMoney(item.targetAmount),
      currentAmount: roundMoney(item.currentAmount),
      gap: roundMoney(gap),
      progress:
        item.targetAmount > 0
          ? Number(((item.currentAmount / item.targetAmount) * 100).toFixed(1))
          : null,
      targetDate: item.targetDate || '',
      priority: item.priority,
      monthlyContribution: roundMoney(item.monthlyContribution || 0),
      note: item.note || ''
    };
  });
  const watchlist = ctx.watchlist.map((item) => ({
    id: item.id,
    name: item.name,
    code: item.code || '',
    tags: item.tags,
    holdingShares: item.holdingShares ?? 0,
    netValue: item.netValue || '',
    addedReturn: item.addedReturn || '',
    riskLevel: riskLabel(item.lastRiskLevel),
    investmentAdvice: item.investmentAdvice || '',
    lastSummary: item.lastSummary || ''
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      positionCount: activePositions.length,
      watchCount: ctx.watchlist.length,
      goalCount: goals.length,
      totalInvested: roundMoney(totalInvested),
      totalCurrentValue: roundMoney(totalCurrentValue),
      totalProfit: roundMoney(totalProfit),
      profitRate:
        totalInvested > 0 ? Number(((totalProfit / totalInvested) * 100).toFixed(1)) : null,
      totalMonthlyContribution: roundMoney(totalMonthlyContribution),
      monthlyInvestableCash: roundMoney(ctx.monthlyInvestableCash)
    },
    positions,
    goals,
    watchlist
  };
}

function executePortfolioSnapshot(ctx: InvestmentAgentContext): InvestmentToolExecution {
  const snapshot = buildPortfolioSnapshot(ctx);
  const viewId = toViewId('investment-read');
  return {
    content: JSON.stringify({ ok: true, ...snapshot }),
    views: [
      {
        id: viewId,
        kind: 'read',
        label: `已读取 ${snapshot.summary.positionCount} 笔持仓、${snapshot.summary.goalCount} 个目标`,
        undoable: false
      }
    ],
    undo: []
  };
}

function findWatchItem(ctx: InvestmentAgentContext, args: Record<string, unknown>) {
  const id = toText(args.id);
  if (id) {
    return ctx.watchlist.find((item) => item.id === id) || null;
  }
  const keyword = toText(args.name).toLowerCase();
  if (!keyword) return null;
  return (
    ctx.watchlist.find(
      (item) =>
        item.name.toLowerCase() === keyword || String(item.code || '').toLowerCase() === keyword
    ) ||
    ctx.watchlist.find(
      (item) =>
        item.name.toLowerCase().includes(keyword) ||
        String(item.code || '')
          .toLowerCase()
          .includes(keyword)
    ) ||
    null
  );
}

function executeWatchlistQuery(
  args: Record<string, unknown>,
  ctx: InvestmentAgentContext
): InvestmentToolExecution {
  const keyword = toText(args.keyword).toLowerCase();
  const limit = Math.min(Math.max(Math.trunc(toNumber(args.limit) ?? 8), 1), 20);
  const matched = ctx.watchlist
    .filter((item) => {
      if (!keyword) return true;
      return [item.name, item.code, item.note, ...(item.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    })
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code || '',
      platform: item.platform || '',
      tags: item.tags,
      holdingShares: item.holdingShares ?? 0,
      netValue: item.netValue || '',
      addedReturn: item.addedReturn || '',
      holdingReturn: item.holdingReturn || '',
      riskLevel: riskLabel(item.lastRiskLevel),
      investmentAdvice: item.investmentAdvice || '',
      adviceReasons: item.adviceReasons || [],
      riskNotes: item.riskNotes || [],
      nextActions: item.nextActions || [],
      lastSummary: item.lastSummary || '',
      fundHoldings: item.fundHoldings || [],
      assetAllocation: item.assetAllocation || [],
      industryAllocation: item.industryAllocation || [],
      updatedAt: item.updatedAt
    }));
  const viewId = toViewId('investment-read');
  return {
    content: JSON.stringify({
      ok: true,
      matchedCount: matched.length,
      totalWatchCount: ctx.watchlist.length,
      available: ctx.watchlist.map((item) => ({
        id: item.id,
        name: item.name,
        code: item.code || ''
      })),
      watchlist: matched
    }),
    views: [
      {
        id: viewId,
        kind: 'read',
        label: keyword
          ? `已检索自选:${matched.map((item) => item.name).join('、') || '无匹配'}`
          : `已读取 ${matched.length} 只自选`,
        undoable: false
      }
    ],
    undo: []
  };
}

function executeUpdateWatchShares(
  args: Record<string, unknown>,
  ctx: InvestmentAgentContext
): InvestmentToolExecution {
  const target = findWatchItem(ctx, args);
  if (!target) {
    return {
      content: JSON.stringify({
        ok: false,
        error: '未找到匹配的自选基金或股票,请先查询自选列表确认名称或代码。'
      }),
      views: [],
      undo: []
    };
  }
  const shares = toNumber(args.shares);
  if (shares === null || shares < 0) {
    return {
      content: JSON.stringify({ ok: false, error: '持有份额必须大于等于 0。' }),
      views: [],
      undo: []
    };
  }

  const previous = { ...target };
  const next: InvestmentWatchItem = {
    ...target,
    holdingShares: roundMoney(shares),
    updatedAt: new Date().toISOString()
  };
  const index = ctx.watchlist.findIndex((item) => item.id === target.id);
  if (index >= 0) ctx.watchlist[index] = next;
  ctx.upsertWatchItem(next);

  const viewId = toViewId('investment-update');
  return {
    content: JSON.stringify({
      ok: true,
      id: next.id,
      name: next.name,
      holdingShares: next.holdingShares
    }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已记录 ${next.name} 持有 ${next.holdingShares} 份`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          const currentIndex = ctx.watchlist.findIndex((item) => item.id === previous.id);
          if (currentIndex >= 0) ctx.watchlist[currentIndex] = previous;
          ctx.upsertWatchItem(previous);
        }
      }
    ]
  };
}

function findGoal(ctx: InvestmentAgentContext, args: Record<string, unknown>) {
  const id = toText(args.id);
  if (id) {
    return ctx.goals.find((item) => item.id === id) || null;
  }
  const keyword = toText(args.name).toLowerCase();
  if (!keyword) return null;
  return (
    ctx.goals.find((item) => item.name.toLowerCase() === keyword) ||
    ctx.goals.find((item) => item.name.toLowerCase().includes(keyword)) ||
    null
  );
}

function toGoalPayload(
  goal: InvestmentGoal
): Omit<InvestmentGoal, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: goal.name,
    kind: goal.kind,
    targetAmount: goal.targetAmount,
    currentAmount: goal.currentAmount,
    monthlyContribution: goal.monthlyContribution,
    targetDate: goal.targetDate,
    priority: goal.priority,
    note: goal.note
  };
}

function executeUpdateGoalProgress(
  args: Record<string, unknown>,
  ctx: InvestmentAgentContext
): InvestmentToolExecution {
  const target = findGoal(ctx, args);
  if (!target) {
    return {
      content: JSON.stringify({
        ok: false,
        error: '未找到匹配的投资目标,请先读取组合快照确认目标名称。'
      }),
      views: [],
      undo: []
    };
  }
  const currentAmount = toNumber(args.currentAmount);
  if (currentAmount === null || currentAmount < 0) {
    return {
      content: JSON.stringify({ ok: false, error: '当前已存金额必须大于等于 0。' }),
      views: [],
      undo: []
    };
  }

  const previous = { ...target };
  const next: InvestmentGoal = {
    ...target,
    currentAmount: roundMoney(currentAmount),
    updatedAt: new Date().toISOString()
  };
  const index = ctx.goals.findIndex((item) => item.id === target.id);
  if (index >= 0) ctx.goals[index] = next;
  ctx.updateGoal(next.id, toGoalPayload(next));

  const viewId = toViewId('investment-update');
  return {
    content: JSON.stringify({
      ok: true,
      id: next.id,
      name: next.name,
      currentAmount: next.currentAmount,
      targetAmount: next.targetAmount,
      gap: roundMoney(Math.max(0, next.targetAmount - next.currentAmount))
    }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已更新 ${next.name} 已存 ¥${next.currentAmount.toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          const currentIndex = ctx.goals.findIndex((item) => item.id === previous.id);
          if (currentIndex >= 0) ctx.goals[currentIndex] = previous;
          ctx.updateGoal(previous.id, toGoalPayload(previous));
        }
      }
    ]
  };
}

export function executeInvestmentToolCall(
  call: ChatToolCall,
  ctx: InvestmentAgentContext
): InvestmentToolExecution {
  const args = parseArgs(call.arguments);
  switch (call.name) {
    case 'get_portfolio_snapshot':
      return executePortfolioSnapshot(ctx);
    case 'query_investment_watchlist':
      return executeWatchlistQuery(args, ctx);
    case 'update_watch_holding_shares':
      return executeUpdateWatchShares(args, ctx);
    case 'update_investment_goal_progress':
      return executeUpdateGoalProgress(args, ctx);
    default:
      return {
        content: JSON.stringify({ ok: false, error: `未知投资工具:${call.name}` }),
        views: [],
        undo: []
      };
  }
}
