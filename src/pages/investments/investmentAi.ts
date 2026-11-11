import type {
  InvestmentAiMessage,
  InvestmentFundAnalysis,
  InvestmentGoal,
  InvestmentPosition,
  InvestmentWatchItem,
  InvestmentWatchlistReviewItem
} from '../../entities/investment/types';

export type InvestmentMarketInsightSuggestion = {
  tone: 'positive' | 'warning' | 'neutral';
  emoji: string;
  title: string;
  reason: string;
};

export type InvestmentMarketInsight = {
  headline: string;
  summary: string;
  points: Array<{ label: string; text: string }>;
  suggestions: InvestmentMarketInsightSuggestion[];
  confidence: 'low' | 'medium' | 'high';
  source?: 'ai' | 'algorithm';
  generatedAt?: string;
};

function normalizeList(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function findLastJsonObject(raw: string): string {
  const end = raw.lastIndexOf('}');
  if (end < 0) return '';

  let start = raw.lastIndexOf('{', end);
  let attempts = 0;
  while (start >= 0 && attempts < 80) {
    const candidate = raw.slice(start, end + 1).trim();
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return candidate;
      }
    } catch {
      // Keep walking back until the outermost valid object is found.
    }
    start = raw.lastIndexOf('{', start - 1);
    attempts += 1;
  }

  return '';
}

function looksLikeInvestmentPayload(raw: string): boolean {
  return /"(?:fundName|fundCode|verdict|riskLevel|highlights|performanceHistory|items)"\s*:/.test(
    raw
  );
}

function extractJsonCodeBlock(raw: string): string {
  const matches = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length > 0) {
    return matches[matches.length - 1]?.[1]?.trim() || '';
  }

  const openFences = [...raw.matchAll(/```json\s*/gi)];
  if (openFences.length > 0) {
    const lastFence = openFences[openFences.length - 1];
    const contentStart = (lastFence?.index || 0) + (lastFence?.[0]?.length || 0);
    const fencedObject = findLastJsonObject(raw.slice(contentStart));
    if (fencedObject) return fencedObject;
  }

  return findLastJsonObject(raw);
}

export function extractInvestmentMarketInsight(raw: string): InvestmentMarketInsight | null {
  const jsonBlock = extractJsonCodeBlock(raw);
  if (!jsonBlock) return null;

  try {
    const parsed = JSON.parse(jsonBlock) as Partial<InvestmentMarketInsight>;
    const headline = String(parsed.headline || '').trim();
    const summary = String(parsed.summary || '').trim();
    if (!headline && !summary) return null;

    const points = Array.isArray(parsed.points)
      ? parsed.points
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const point = item as { label?: unknown; text?: unknown };
            const text = String(point.text || '').trim();
            return text
              ? { label: String(point.label || '观察').trim() || '观察', text: text.slice(0, 120) }
              : null;
          })
          .filter((item): item is { label: string; text: string } => Boolean(item))
          .slice(0, 4)
      : [];

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const suggestion = item as Partial<InvestmentMarketInsightSuggestion>;
            const title = String(suggestion.title || '').trim();
            if (!title) return null;
            const tone =
              suggestion.tone === 'positive' ||
              suggestion.tone === 'warning' ||
              suggestion.tone === 'neutral'
                ? suggestion.tone
                : 'neutral';
            return {
              tone,
              emoji: String(suggestion.emoji || (tone === 'warning' ? '⚠️' : '🧭')).trim(),
              title: title.slice(0, 40),
              reason: String(suggestion.reason || '结合当前市场信号，先按计划执行。')
                .trim()
                .slice(0, 160)
            } satisfies InvestmentMarketInsightSuggestion;
          })
          .filter((item): item is InvestmentMarketInsightSuggestion => Boolean(item))
          .slice(0, 3)
      : [];

    return {
      headline: headline.slice(0, 80) || '市场复合信号已更新',
      summary: summary.slice(0, 180) || '结合大盘、板块和近期资讯给出今日参考。',
      points,
      suggestions,
      confidence:
        parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low'
    };
  } catch {
    return null;
  }
}

export function buildInvestmentMarketInsightPrompt(input: {
  marketContext: string;
  algorithmSignals: string;
  positions: InvestmentPosition[];
  watchlist: InvestmentWatchItem[];
  monthlyInvestableCash: number;
  timeContext: string;
}) {
  const context = {
    algorithmSignals: input.algorithmSignals,
    marketContext: input.marketContext,
    positions: input.positions.slice(0, 8).map((item) => ({
      name: item.name,
      category: item.category,
      currentValue: Number(item.currentValue.toFixed(2)),
      investedAmount: Number(item.investedAmount.toFixed(2)),
      riskLevel: item.riskLevel,
      monthlyContribution: item.monthlyContribution || 0
    })),
    watchlist: input.watchlist.slice(0, 10).map((item) => ({
      name: item.name,
      code: item.code || '',
      holdingShares: item.holdingShares || 0,
      netValue: item.netValue || '',
      todayChange: item.addedReturn || '',
      category: item.tags?.[0] || ''
    })),
    monthlyInvestableCash: Number(input.monthlyInvestableCash.toFixed(2)),
    timeContext: input.timeContext
  };

  return [
    '你是 LedgerFlow 的每日投资市场简报助手。请基于提供的真实行情、板块、新闻和算法信号，输出今天的市场解读和可执行建议。',
    '必须遵守：',
    '1. 只使用上下文中的事实，不要编造新闻、点位、基金收益或政策；信息不足时明确写“数据不足”。',
    '2. 不能给出保证收益或绝对化买卖指令；建议要具体但保守，适合普通用户。',
    '3. 重点解释近期热点、强弱板块、新闻/政策线索如何影响今天的节奏，并结合用户已有持仓和自选份额。',
    '4. 每次输出必须有明显差异：至少引用一个当前板块或新闻事实，不能使用固定套话。',
    '5. 只返回 JSON 代码块，不要返回 Markdown 代码块之外的内容。格式：',
    '```json',
    '{"headline":"","summary":"","points":[{"label":"板块|新闻|持仓|风险","text":""}],"suggestions":[{"tone":"positive|warning|neutral","emoji":"","title":"","reason":""}],"confidence":"low|medium|high"}',
    '```',
    '6. points 返回 2 到 4 条，suggestions 返回 2 到 3 条；每条简短、可读。',
    `上下文：\n${JSON.stringify(context, null, 2)}`
  ].join('\n');
}

export function stripInvestmentAnalysisJson(raw: string): string {
  const withoutCompleteBlocks = raw.replace(/\n?```json[\s\S]*?```/gi, '').trim();
  if (withoutCompleteBlocks !== raw.trim()) return withoutCompleteBlocks;

  const openFences = [...raw.matchAll(/```json\s*/gi)];
  if (openFences.length > 0) {
    const lastFence = openFences[openFences.length - 1];
    const fenceStart = lastFence?.index || 0;
    const tail = raw.slice(fenceStart);
    if (looksLikeInvestmentPayload(tail)) {
      return raw.slice(0, fenceStart).trim();
    }
  }

  const jsonBlock = extractJsonCodeBlock(raw);
  if (!jsonBlock || !looksLikeInvestmentPayload(jsonBlock)) return raw.trim();

  const jsonStart = raw.lastIndexOf(jsonBlock);
  if (jsonStart < 0) return raw.trim();
  return `${raw.slice(0, jsonStart)}${raw.slice(jsonStart + jsonBlock.length)}`.trim();
}

export function buildInvestmentAssistantPrompt(input: {
  positions: InvestmentPosition[];
  goals: InvestmentGoal[];
  watchlist: InvestmentWatchItem[];
  monthlyInvestableCash: number;
  focus?: {
    type: 'position' | 'watch' | 'market' | 'news';
    label: string;
    detail?: string;
  } | null;
}) {
  const activePositions = input.positions.filter((item) => item.isActive);
  const totalInvested = activePositions.reduce((sum, item) => sum + item.investedAmount, 0);
  const totalCurrentValue = activePositions.reduce((sum, item) => sum + item.currentValue, 0);
  const totalProfit = totalCurrentValue - totalInvested;
  const totalMonthlyContribution = activePositions.reduce(
    (sum, item) => sum + (item.monthlyContribution || 0),
    0
  );
  const context = {
    summary: {
      positionCount: activePositions.length,
      watchCount: input.watchlist.length,
      goalCount: input.goals.length,
      totalInvested: Number(totalInvested.toFixed(2)),
      totalCurrentValue: Number(totalCurrentValue.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
      profitRate:
        totalInvested > 0 ? Number(((totalProfit / totalInvested) * 100).toFixed(1)) : null,
      totalMonthlyContribution: Number(totalMonthlyContribution.toFixed(2)),
      monthlyInvestableCash: Number(input.monthlyInvestableCash.toFixed(2))
    },
    positions: activePositions.slice(0, 12).map((item) => {
      const profit = item.currentValue - item.investedAmount;
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        platform: item.platform || '',
        investedAmount: Number(item.investedAmount.toFixed(2)),
        currentValue: Number(item.currentValue.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        profitRate:
          item.investedAmount > 0
            ? Number(((profit / item.investedAmount) * 100).toFixed(1))
            : null,
        allocationShare:
          totalCurrentValue > 0
            ? Number(((item.currentValue / totalCurrentValue) * 100).toFixed(1))
            : null,
        monthlyContribution: Number((item.monthlyContribution || 0).toFixed(2)),
        targetAllocation: item.targetAllocation || 0,
        riskLevel: item.riskLevel,
        note: item.note || ''
      };
    }),
    goals: input.goals.slice(0, 5).map((item) => ({
      id: item.id,
      name: item.name,
      targetAmount: Number(item.targetAmount.toFixed(2)),
      currentAmount: Number(item.currentAmount.toFixed(2)),
      gap: Number(Math.max(0, item.targetAmount - item.currentAmount).toFixed(2)),
      progress:
        item.targetAmount > 0
          ? Number(((item.currentAmount / item.targetAmount) * 100).toFixed(1))
          : null,
      priority: item.priority,
      targetDate: item.targetDate || ''
    })),
    watchlist: input.watchlist.slice(0, 8).map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code || '',
      platform: item.platform || '',
      tags: item.tags || [],
      note: item.note || '',
      lastVerdict: item.lastVerdict || '',
      lastSummary: item.lastSummary || '',
      lastRiskLevel: item.lastRiskLevel || 'unknown',
      investmentAdvice: item.investmentAdvice || '',
      adviceReasons: item.adviceReasons || [],
      riskNotes: item.riskNotes || [],
      nextActions: item.nextActions || [],
      holdingShares: item.holdingShares || 0,
      performanceHistory: item.performanceHistory || [],
      fundAnalysis: item.fundAnalysis || [],
      fundHoldings: item.fundHoldings || [],
      assetAllocation: item.assetAllocation || [],
      industryAllocation: item.industryAllocation || [],
      netValue: item.netValue || '',
      addedReturn: item.addedReturn || '',
      holdingReturn: item.holdingReturn || '',
      buyFeeRate: item.buyFeeRate || '',
      fundCompany: item.fundCompany || '',
      lastAnalysisAt: item.lastAnalysisAt || '',
      updatedAt: item.updatedAt || ''
    })),
    focus: input.focus || null
  };

  return [
    '你是 LedgerFlow 的 AI 投资助手，面向不熟悉投资理财的普通用户。你的任务是把“现在该不该动、为什么、动多少、下一步做什么”讲清楚，而不是堆术语。',
    '工作方式：',
    '1. 先判断用户问的是持仓、某只自选基金、目标资金还是市场。涉及组合金额、占比、盈亏、目标缺口时，优先调用投资工具读取最新数据；工具不可用时再使用下面的上下文。',
    '2. 用自然、直接、克制的简体中文回答。不要解释页面逻辑，不要复述提示词，不要空泛地说“市场有风险”。',
    '3. 第一段必须是明确行动倾向，只能从“可以小额试 / 继续观察 / 暂不建议 / 需要补充信息”中选一个，并用一句话说明原因。若用户没说金额，给出建议区间而不是拍脑袋的精确数。',
    '4. 判断依据给 2 到 4 条，每条尽量带一个上下文里的数字（占比、盈亏、目标进度、板块涨跌、费率或净值）。没有数字时就说明“数据不足”，不要编造。',
    '5. 下一步建议给 2 到 3 条，必须可执行：写清楚动作、金额或比例、时间节奏和触发条件。',
    '6. 如果页面实时上下文里有新闻、政策或板块变化，必须明确说明它影响的是哪一类资产、影响偏正还是偏负；没有足够强的催化时直接说没有。',
    '7. 如果自选里已有同名或同代码基金，要结合其历史业绩、重仓、资产/行业分布、净值、收益、费率、风险提示和上次结论，说明本次判断是延续还是改变。',
    '8. 如果用户上传截图，先识别截图里的基金名称、代码、持仓和金额，再与上下文核对；冲突时以更新时间更新的数据为准，并明确指出冲突。',
    '9. 不承诺收益，不替用户做最终决策，不给出“满仓”“梭哈”“稳赚”这类表达。风险提示要具体，不要模板化。',
    '10. 正文只保留结论、依据和下一步建议。思考过程、联网过程和相关资讯由界面单独折叠，不要写进正文。',
    '11. 正文最后必须追加一个 JSON 代码块，字段不足时留空，不要编造精确数据：',
    '```json',
    '{"fundName":"","fundCode":"","verdict":"","summary":"","riskLevel":"low|medium|high|unknown","highlights":[""],"risks":[""],"actions":[""],"watchTags":[""],"performanceHistory":[""],"fundAnalysis":[""],"fundHoldings":[""],"assetAllocation":[""],"industryAllocation":[""],"netValue":"","addedReturn":"","holdingReturn":"","buyFeeRate":"","fundCompany":"","platform":"","note":"","followUps":["","",""]}',
    '```',
    '12. arrays 每个字段最多 4 项；followUps 返回 3 条用户可能继续追问的问题，每条 8 到 28 个字，必须结合本次回答，不能是泛泛的“还需要了解什么”。JSON 代码块后面不要再追加内容。',
    input.focus
      ? `13. 本次用户是从页面上的“${input.focus.label}”入口进入，请优先回答这个对象，不要跑题。${input.focus.detail ? `入口附带信息：${input.focus.detail}` : ''}`
      : '13. 如果用户没有指定对象，先判断最值得优先讨论的持仓或市场主题，并在开头说明你选择了什么。',
    `投资上下文：\n${JSON.stringify(context, null, 2)}`
  ].join('\n');
}

export function buildInvestmentAssistantAuxiliaryInfo(input: {
  webEnabled?: boolean;
  webQuery?: string;
  timeContext?: string;
  contextNote?: string;
  webSearchPrompt?: string;
  webSearchStatus?: 'success' | 'partial' | 'unavailable';
  webSearchMessage?: string;
  webSearchSources?: string[];
}) {
  const legacyWebTrace = [
    input.webEnabled
      ? input.webSearchStatus === 'unavailable'
        ? '联网过程：已开启联网核验，但本次未取得可用结果'
        : '联网过程：已开启联网核验'
      : '联网过程：未开启联网核验',
    input.webEnabled && input.webQuery ? `检索关键词：${input.webQuery}` : '',
    input.webEnabled && input.webSearchSources?.length
      ? `采用来源：${input.webSearchSources.join('、')}`
      : '',
    input.webEnabled && input.webSearchStatus === 'unavailable' && input.webSearchMessage
      ? `未取得结果原因：${input.webSearchMessage}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');

  const webStatusText =
    input.webSearchStatus === 'unavailable'
      ? '联网核验:未取得可用结果'
      : input.webSearchStatus === 'partial'
        ? '联网核验:仅取得部分可用结果'
        : input.webSearchStatus === 'success'
          ? '联网核验:已取得可用结果'
          : '联网核验:已发起,结果待确认';
  const hasUsableWebResults =
    input.webSearchStatus === 'success' || input.webSearchStatus === 'partial';
  const webMessagePrefix =
    input.webSearchStatus === 'unavailable'
      ? '未取得结果原因'
      : input.webSearchStatus === 'partial'
        ? '部分结果说明'
        : '检索说明';
  const webTrace = input.webEnabled
    ? [
        webStatusText,
        input.webQuery ? `检索关键词:${input.webQuery}` : '',
        hasUsableWebResults && input.webSearchSources?.length
          ? `采用来源:${input.webSearchSources.join('、')}`
          : '',
        input.webSearchMessage ? `${webMessagePrefix}:${input.webSearchMessage}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    : legacyWebTrace;

  const relatedData = [
    input.timeContext ? `当前时间：${input.timeContext}` : '',
    input.contextNote ? `页面实时上下文：\n${input.contextNote}` : '',
    input.webSearchPrompt ? `联网检索结果：\n${input.webSearchPrompt}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    webTrace,
    relatedData
  };
}

export function buildInvestmentWatchlistReviewPrompt(input: {
  positions: InvestmentPosition[];
  watchlist: InvestmentWatchItem[];
  monthlyInvestableCash: number;
  marketContext?: string;
  timeContext?: string;
}) {
  const context = {
    positions: input.positions.slice(0, 8).map((item) => ({
      name: item.name,
      category: item.category,
      platform: item.platform || '',
      currentValue: Number(item.currentValue.toFixed(2)),
      monthlyContribution: item.monthlyContribution || 0,
      targetAllocation: item.targetAllocation || 0,
      riskLevel: item.riskLevel
    })),
    monthlyInvestableCash: Number(input.monthlyInvestableCash.toFixed(2)),
    watchlist: input.watchlist.map((item, index) => ({
      id: item.id,
      currentRank: index + 1,
      name: item.name,
      code: item.code || '',
      platform: item.platform || '',
      tags: item.tags || [],
      note: item.note || '',
      lastVerdict: item.lastVerdict || '',
      lastSummary: item.lastSummary || '',
      lastRiskLevel: item.lastRiskLevel || 'unknown',
      investmentAdvice: item.investmentAdvice || '',
      adviceReasons: item.adviceReasons || [],
      riskNotes: item.riskNotes || [],
      nextActions: item.nextActions || [],
      holdingShares: item.holdingShares || 0,
      performanceHistory: item.performanceHistory || [],
      fundAnalysis: item.fundAnalysis || [],
      fundHoldings: item.fundHoldings || [],
      assetAllocation: item.assetAllocation || [],
      industryAllocation: item.industryAllocation || [],
      netValue: item.netValue || '',
      addedReturn: item.addedReturn || '',
      holdingReturn: item.holdingReturn || '',
      buyFeeRate: item.buyFeeRate || '',
      fundCompany: item.fundCompany || '',
      lastAnalysisAt: item.lastAnalysisAt || '',
      updatedAt: item.updatedAt || ''
    })),
    marketContext: input.marketContext || '',
    timeContext: input.timeContext || ''
  };

  return [
    '你是 LedgerFlow 的 AI 投资自选基金复盘助手，用户希望你帮他把自选基金按“更值得优先关注/更适合先处理”的顺序排好。',
    '任务要求：',
    '1. 逐只复盘所有自选基金，不能遗漏任何 id；不要新增不存在的基金。',
    '2. rank=1 表示最值得优先关注或最需要用户先看的一只；如果信息不足，也要根据已有资料给出保守排序。',
    '3. 投资建议要适合新手，短、直观、可执行，例如“继续观察”“小比例定投”“暂不加仓”“先补资料”。',
    '4. summary 控制在 60 字以内，尽量解释为什么排在这个位置。',
    '5. 你需要结合当前时间、市场新闻、政策催化和板块变化来排序；如果没有看到明确新闻或政策催化，要直接说明。',
    '6. 你可以补全历史业绩、基金分析、基金持仓、资产分布、行业分布、净值、添加后收益、持有收益、买入费率、基金公司；不确定就留空数组或空字符串，不要编造精确数据。',
    '7. 联网过程、思考过程和相关资讯数据不要直接展开在正文里，保留在辅助信息里即可。',
    '8. 只返回 JSON 代码块，格式必须是：',
    '```json',
    '{"items":[{"id":"","rank":1,"verdict":"","summary":"","riskLevel":"low|medium|high|unknown","investmentAdvice":"","adviceReasons":[""],"riskNotes":[""],"nextActions":[""],"watchTags":[""],"performanceHistory":[""],"fundAnalysis":[""],"fundHoldings":[""],"assetAllocation":[""],"industryAllocation":[""],"netValue":"","addedReturn":"","holdingReturn":"","buyFeeRate":"","fundCompany":"","note":""}]}',
    '```',
    '9. 数组字段每项不超过 8 项；JSON 代码块后面不要再追加其他内容。',
    `投资上下文：\n${JSON.stringify(context, null, 2)}`
  ].join('\n');
}

export function buildInvestmentFundAnalysisPrompt(input: {
  watchItem: InvestmentWatchItem;
  positions: InvestmentPosition[];
  marketContext?: string;
  timeContext?: string;
  webContext?: string;
}) {
  const context = {
    watchItem: {
      id: input.watchItem.id,
      name: input.watchItem.name,
      code: input.watchItem.code || '',
      platform: input.watchItem.platform || '',
      tags: input.watchItem.tags || [],
      note: input.watchItem.note || '',
      lastVerdict: input.watchItem.lastVerdict || '',
      lastSummary: input.watchItem.lastSummary || '',
      lastRiskLevel: input.watchItem.lastRiskLevel || 'unknown',
      investmentAdvice: input.watchItem.investmentAdvice || '',
      adviceReasons: input.watchItem.adviceReasons || [],
      riskNotes: input.watchItem.riskNotes || [],
      nextActions: input.watchItem.nextActions || [],
      holdingShares: input.watchItem.holdingShares || 0,
      performanceHistory: input.watchItem.performanceHistory || [],
      fundAnalysis: input.watchItem.fundAnalysis || [],
      fundHoldings: input.watchItem.fundHoldings || [],
      assetAllocation: input.watchItem.assetAllocation || [],
      industryAllocation: input.watchItem.industryAllocation || [],
      netValue: input.watchItem.netValue || '',
      addedReturn: input.watchItem.addedReturn || '',
      holdingReturn: input.watchItem.holdingReturn || '',
      buyFeeRate: input.watchItem.buyFeeRate || '',
      fundCompany: input.watchItem.fundCompany || '',
      lastAnalysisAt: input.watchItem.lastAnalysisAt || '',
      updatedAt: input.watchItem.updatedAt || ''
    },
    positions: input.positions.slice(0, 8).map((item) => ({
      name: item.name,
      category: item.category,
      platform: item.platform || '',
      currentValue: Number(item.currentValue.toFixed(2)),
      monthlyContribution: item.monthlyContribution || 0,
      targetAllocation: item.targetAllocation || 0,
      riskLevel: item.riskLevel
    })),
    marketContext: input.marketContext || '',
    timeContext: input.timeContext || '',
    webContext: input.webContext || ''
  };

  return [
    '你是 LedgerFlow 的基金分析助手，专门分析“这只基金是否该加仓、减仓、继续持有，属于什么行业，以及哪些政策或市场变化会影响它”。',
    '回答要求：',
    '1. 先给一句明确结论，只能在“建议加仓 / 建议减仓 / 继续持有 / 先观望 / 需要补充信息”里选一个。',
    '2. 再给 3 到 5 条依据，尽量结合行业、基金重仓、资产配置、当前大盘、社会新闻、政策和联网资讯。',
    '3. 如果有明显的行业或政策催化，直接点出来；如果没有，就明确说现在没有看到足够强的催化。',
    '4. 如果市场上下文里的 socialNews 或 policySignals 提到了具体新闻、政策、监管、产业催化，必须在依据里直接引用；如果时间点接近盘前、盘中或收盘后，也要说明时点影响。',
    '5. 重仓股票/产品请尽量写出名称和比例；如果拿不到准确比例，明确写“待获取”，不要编造。',
    '6. 联网过程、思考过程和相关资讯数据不要直接写进正文，保留在辅助信息里即可。',
    '7. 输出要能持久化，最后必须追加一个 JSON 代码块，格式必须是：',
    '```json',
    '{"fundName":"","fundCode":"","verdict":"","summary":"","riskLevel":"low|medium|high|unknown","highlights":[""],"risks":[""],"actions":[""],"watchTags":[""],"performanceHistory":[""],"fundAnalysis":[""],"fundHoldings":[""],"assetAllocation":[""],"industryAllocation":[""],"netValue":"","addedReturn":"","holdingReturn":"","buyFeeRate":"","fundCompany":"","platform":"","note":""}',
    '```',
    '8. watchTags 里优先放“加仓 / 减仓 / 观望 / 继续持有 / 政策利好 / 政策承压”这类短标签。',
    '9. JSON 代码块后面不要再追加其他内容。',
    `投资上下文：\n${JSON.stringify(context, null, 2)}`
  ].join('\n');
}

export function normalizeInvestmentFundAnalysis(raw: unknown): InvestmentFundAnalysis | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Partial<InvestmentFundAnalysis>;
  const verdict = String(item.verdict || '').trim();
  const summary = String(item.summary || '').trim();
  const riskLevel =
    item.riskLevel === 'low' ||
    item.riskLevel === 'medium' ||
    item.riskLevel === 'high' ||
    item.riskLevel === 'unknown'
      ? item.riskLevel
      : 'unknown';

  if (!verdict && !summary && !normalizeOptionalString(item.fundName)) {
    return null;
  }

  return {
    fundName: normalizeOptionalString(item.fundName),
    fundCode: normalizeOptionalString(item.fundCode),
    verdict: verdict || summary || '已完成分析',
    summary: summary || verdict || '已完成分析',
    riskLevel,
    highlights: normalizeList(item.highlights),
    risks: normalizeList(item.risks),
    actions: normalizeList(item.actions),
    watchTags: normalizeList(item.watchTags),
    performanceHistory: normalizeList(item.performanceHistory, 6),
    fundAnalysis: normalizeList(item.fundAnalysis, 6),
    fundHoldings: normalizeList(item.fundHoldings, 8),
    assetAllocation: normalizeList(item.assetAllocation, 6),
    industryAllocation: normalizeList(item.industryAllocation, 8),
    netValue: normalizeOptionalString(item.netValue),
    addedReturn: normalizeOptionalString(item.addedReturn),
    holdingReturn: normalizeOptionalString(item.holdingReturn),
    buyFeeRate: normalizeOptionalString(item.buyFeeRate),
    fundCompany: normalizeOptionalString(item.fundCompany),
    platform: normalizeOptionalString(item.platform),
    note: normalizeOptionalString(item.note),
    followUps: normalizeList(item.followUps, 3)
  };
}

export function normalizeInvestmentWatchlistReviewItem(
  raw: unknown
): InvestmentWatchlistReviewItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Partial<InvestmentWatchlistReviewItem>;
  const id = normalizeOptionalString(item.id);
  if (!id) {
    return null;
  }

  const verdict = String(item.verdict || '').trim();
  const summary = String(item.summary || '').trim();
  const rank = Math.max(1, Math.floor(Number(item.rank || 0))) || 999;
  const riskLevel =
    item.riskLevel === 'low' ||
    item.riskLevel === 'medium' ||
    item.riskLevel === 'high' ||
    item.riskLevel === 'unknown'
      ? item.riskLevel
      : 'unknown';

  return {
    id,
    rank,
    verdict: verdict || summary || '已完成复盘',
    summary: summary || verdict || '已完成复盘',
    riskLevel,
    investmentAdvice: normalizeOptionalString(item.investmentAdvice),
    adviceReasons: normalizeList(item.adviceReasons, 6),
    riskNotes: normalizeList(item.riskNotes, 6),
    nextActions: normalizeList(item.nextActions, 6),
    watchTags: normalizeList(item.watchTags),
    performanceHistory: normalizeList(item.performanceHistory, 6),
    fundAnalysis: normalizeList(item.fundAnalysis, 6),
    fundHoldings: normalizeList(item.fundHoldings, 8),
    assetAllocation: normalizeList(item.assetAllocation, 6),
    industryAllocation: normalizeList(item.industryAllocation, 8),
    netValue: normalizeOptionalString(item.netValue),
    addedReturn: normalizeOptionalString(item.addedReturn),
    holdingReturn: normalizeOptionalString(item.holdingReturn),
    buyFeeRate: normalizeOptionalString(item.buyFeeRate),
    fundCompany: normalizeOptionalString(item.fundCompany),
    note: normalizeOptionalString(item.note)
  };
}

export function extractInvestmentWatchlistReview(raw: string): InvestmentWatchlistReviewItem[] {
  const jsonBlock = extractJsonCodeBlock(raw);
  if (!jsonBlock) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonBlock) as { items?: unknown[] };
    if (!Array.isArray(parsed.items)) {
      return [];
    }

    return parsed.items
      .map((item) => normalizeInvestmentWatchlistReviewItem(item))
      .filter((item): item is InvestmentWatchlistReviewItem => Boolean(item));
  } catch {
    return [];
  }
}

export function extractInvestmentAnalysis(raw: string) {
  const displayText = stripInvestmentAnalysisJson(raw);
  const jsonBlock = extractJsonCodeBlock(raw);

  if (!jsonBlock) {
    return {
      displayText,
      analysis: null as InvestmentFundAnalysis | null
    };
  }

  try {
    return {
      displayText,
      analysis: normalizeInvestmentFundAnalysis(JSON.parse(jsonBlock) as unknown)
    };
  } catch {
    return {
      displayText,
      analysis: null as InvestmentFundAnalysis | null
    };
  }
}

export function summarizeInvestmentAnalysis(
  text: string,
  analysis: InvestmentFundAnalysis | null
): string {
  const compactText = text.trim();

  if (!analysis) {
    return compactText || '已完成分析';
  }

  if (compactText) {
    const duplicatedLines = new Set(
      [analysis.verdict, analysis.summary]
        .map((item) => item.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
    );
    const dedupedText = compactText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        const normalizedLine = line
          .replace(/^[-*]\s+/, '')
          .trim()
          .replace(/\s+/g, ' ');
        return normalizedLine && !duplicatedLines.has(normalizedLine);
      })
      .join('\n')
      .trim();

    if (dedupedText) {
      return dedupedText.length > 2600 ? `${dedupedText.slice(0, 2600)}...` : dedupedText;
    }
  }

  const verdict = analysis.verdict.trim();
  const summary = analysis.summary.trim();
  return verdict && verdict !== summary ? verdict : '';
}

export function getInvestmentAssistantDisplayText(
  raw: string,
  storedAnalysis?: InvestmentFundAnalysis | null
): string {
  const extracted = extractInvestmentAnalysis(raw);
  return summarizeInvestmentAnalysis(extracted.displayText, storedAnalysis || extracted.analysis);
}

function normalizeInvestmentFollowUpPrompt(prompt: string): string {
  return prompt
    .replace(/\s+/g, ' ')
    .replace(/^[-*•\d一二三四五六七八九十、.．)）\s]+/, '')
    .trim()
    .slice(0, 42);
}

export function parseInvestmentFollowUpPrompts(raw: string): string[] {
  try {
    const normalized = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '');
    const candidate = normalized.match(/\[[\s\S]*\]/)?.[0] || normalized;
    const parsed = JSON.parse(candidate) as Array<
      string | { prompt?: unknown; question?: unknown; label?: unknown }
    >;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        return String(item.prompt || item.question || item.label || '');
      })
      .map(normalizeInvestmentFollowUpPrompt)
      .filter((item, index, list) => item.length >= 5 && list.indexOf(item) === index)
      .slice(0, 4);
  } catch {
    return [];
  }
}

export function buildInvestmentFollowUpFallback(input: {
  question: string;
  analysis?: InvestmentFundAnalysis | null;
  watchlist?: InvestmentWatchItem[];
}) {
  const fundName =
    input.analysis?.fundName ||
    input.watchlist?.find((item) => item.name.trim())?.name ||
    '这只基金';
  const candidates = [
    ...(input.analysis?.followUps || []),
    input.analysis?.risks[0] ? '这个风险影响大吗？' : '',
    input.analysis?.actions[0] ? '下一步怎么执行更稳？' : '',
    input.analysis?.fundHoldings?.[0] ? '重仓股票会拖累吗？' : '',
    input.analysis?.assetAllocation?.[0] ? '资产分布健康吗？' : '',
    input.analysis?.netValue ? '净值现在算贵吗？' : '',
    input.question.includes('买') ? '先买多少比较稳？' : '',
    `${fundName}适合继续观察吗？`
  ];

  return candidates
    .map(normalizeInvestmentFollowUpPrompt)
    .filter((item, index, list) => item.length >= 5 && list.indexOf(item) === index)
    .slice(0, 4);
}

export function buildInvestmentHoldingAskPrompt(input: {
  name: string;
  profitRate?: number | null;
  allocationShare?: number | null;
  currentValue?: number | null;
  riskLevel?: string;
  monthlyContribution?: number | null;
}) {
  const facts = [
    input.currentValue ? `当前市值约 ¥${Math.round(input.currentValue)}` : '',
    typeof input.profitRate === 'number'
      ? `浮动收益 ${input.profitRate >= 0 ? '+' : ''}${input.profitRate.toFixed(1)}%`
      : '',
    typeof input.allocationShare === 'number'
      ? `占总资产 ${input.allocationShare.toFixed(1)}%`
      : '',
    input.monthlyContribution ? `每月定投 ¥${input.monthlyContribution}` : '',
    input.riskLevel ? `风险等级 ${input.riskLevel}` : ''
  ]
    .filter(Boolean)
    .join('，');
  return [
    `请重点分析我的持仓「${input.name}」。`,
    facts ? `已知信息：${facts}。` : '',
    '结合当前市场、我的整体配置和目标资金，告诉我：继续持有、减仓还是补仓？给出判断依据、建议金额或比例，以及下一步触发条件。'
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildInvestmentWatchAskPrompt(input: {
  name: string;
  code?: string;
  riskLevel?: string;
  advice?: string;
  netValue?: string;
  addedReturn?: string;
  holdingShares?: number;
}) {
  const facts = [
    input.code ? `代码 ${input.code}` : '',
    input.netValue ? `净值 ${input.netValue}` : '',
    input.addedReturn ? `近期收益 ${input.addedReturn}` : '',
    input.holdingShares ? `已持有 ${input.holdingShares} 份` : '尚未记录持有份额',
    input.riskLevel ? `风险等级 ${input.riskLevel}` : '',
    input.advice ? `上次建议 ${input.advice}` : ''
  ]
    .filter(Boolean)
    .join('，');
  return [
    `请重点分析我自选里的「${input.name}」。`,
    facts ? `已知信息：${facts}。` : '',
    '结合最新行情、行业和政策线索，判断现在适合小额试、继续观察还是暂不建议；同时说明它与我的现有持仓是否重复，并给出下一步行动。'
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildInvestmentMarketAskPrompt(input: {
  marketChange?: number | null;
  themes?: string[];
  news?: string;
}) {
  const facts = [
    typeof input.marketChange === 'number'
      ? `主要指数平均 ${input.marketChange >= 0 ? '+' : ''}${input.marketChange.toFixed(2)}%`
      : '指数涨跌暂缺',
    input.themes?.length ? `当前热点 ${input.themes.slice(0, 3).join('、')}` : '',
    input.news ? `最新资讯 ${input.news}` : ''
  ]
    .filter(Boolean)
    .join('；');
  return `请结合今天的行情、板块和新闻，给我一份适合普通人的市场复盘：${facts}。重点说明今天该进攻还是防守、哪些持仓受影响最大，以及我今天最值得做的一两件事。`;
}

export function buildInvestmentBoardAskPrompt(input: { name: string; changePercent?: number }) {
  return `请分析板块「${input.name}」今天的表现${
    typeof input.changePercent === 'number'
      ? `（${input.changePercent >= 0 ? '+' : ''}${input.changePercent.toFixed(2)}%）`
      : ''
  }。结合我的持仓和自选，判断这是短期脉冲还是值得持续关注，并说明如果要参与应该注意什么风险。`;
}

export function buildInvestmentNewsAskPrompt(input: {
  title: string;
  summary?: string;
  stocks?: string[];
}) {
  return `请解读这条市场快讯：「${input.title}」${
    input.summary ? `。摘要：${input.summary}` : ''
  }${input.stocks?.length ? `。关联标的：${input.stocks.slice(0, 4).join('、')}` : ''}。这条消息会影响哪些板块或我的持仓？是实质性催化还是短期情绪？我该怎么应对？`;
}

export function createInvestmentAiMessage(input: {
  id: string;
  role: InvestmentAiMessage['role'];
  text: string;
  createdAt: string;
  reasoning?: string;
  webTrace?: string;
  auxiliaryInfo?: string;
  followUpPrompts?: string[];
  attachmentCount?: number;
  attachmentImages?: string[];
  analysis?: InvestmentFundAnalysis | null;
  agentActions?: InvestmentAiMessage['agentActions'];
}): InvestmentAiMessage {
  const attachmentImages = input.attachmentImages
    ?.filter((value) => value.startsWith('data:image/'))
    .slice(0, 4);
  const followUpPrompts = normalizeList(input.followUpPrompts);
  return {
    id: input.id,
    role: input.role,
    text: input.text,
    reasoning: normalizeOptionalString(input.reasoning),
    webTrace: normalizeOptionalString(input.webTrace),
    auxiliaryInfo: normalizeOptionalString(input.auxiliaryInfo),
    followUpPrompts: followUpPrompts.length ? followUpPrompts : undefined,
    attachmentCount: input.attachmentCount || attachmentImages?.length,
    attachmentImages: attachmentImages?.length ? attachmentImages : undefined,
    analysis: input.analysis || undefined,
    agentActions: input.agentActions?.length ? input.agentActions : undefined,
    createdAt: input.createdAt
  };
}

export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`图片“${file.name}”读取失败，请重试。`));
    reader.readAsDataURL(file);
  });
}

export function trimInvestmentAiMessages(messages: InvestmentAiMessage[]) {
  return messages.slice(-12);
}
