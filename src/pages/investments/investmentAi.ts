import type {
  InvestmentAiMessage,
  InvestmentFundAnalysis,
  InvestmentGoal,
  InvestmentPosition,
  InvestmentWatchItem,
  InvestmentWatchlistReviewItem
} from '../../entities/investment/types';

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
    goals: input.goals.slice(0, 5).map((item) => ({
      name: item.name,
      targetAmount: Number(item.targetAmount.toFixed(2)),
      currentAmount: Number(item.currentAmount.toFixed(2)),
      priority: item.priority,
      targetDate: item.targetDate || ''
    })),
    monthlyInvestableCash: Number(input.monthlyInvestableCash.toFixed(2)),
    watchlist: input.watchlist.slice(0, 8).map((item) => ({
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
    }))
  };

  return [
    '你是 LedgerFlow 的 AI 投资推荐专家，面向不熟悉投资理财的新手用户。你的目标不是堆术语，而是把“能不能买、怎么买更稳、哪里不能碰、下一步做什么”讲清楚。',
    '回答要求：',
    '1. 用自然、直接的简体中文回答，不要解释页面逻辑，不要空话，不要把专业术语原样丢给用户。',
    '2. 第一段必须给行动倾向：可以小额试、继续观察、暂不建议、需要补充信息四选一，并说明一句原因。',
    '3. 然后给 3 条左右依据，尽量翻译成新手能懂的话；最后给 2 到 3 条下一步建议，建议要可执行。',
    '4. 需要结合用户上传的截图、用户问题和投资上下文；如果上下文里有市场新闻、政策线索或大盘变化，必须一起纳入判断。',
    '5. 如果投资上下文里已有基金自选记录，尤其是同名或同代码基金，要参考自选里的投资建议、历史业绩、重仓股票、资产/行业分布、净值、添加后收益、持有收益、费率、基金公司、风险提示、上次结论、摘要、备注和更新时间，说明本次判断是否延续或改变。',
    '6. 如果页面实时上下文里有市场新闻、政策催化或行业主题变化，回答里必须明确提到它们；如果没有看到足够强的新闻或政策催化，要直接说出来。',
    '7. 不要把联网过程、思考过程或相关资讯数据写进正文，界面会把这些内容单独折叠显示；正文只保留结论、依据和下一步建议。',
    '8. 不要承诺收益，也不要替用户做最终投资决策；但可以给出清晰的风险分级和操作优先级。',
    '9. 在正文最后追加一个 JSON 代码块，格式必须是：',
    '```json',
    '{"fundName":"","fundCode":"","verdict":"","summary":"","riskLevel":"low|medium|high|unknown","highlights":[""],"risks":[""],"actions":[""],"watchTags":[""],"performanceHistory":[""],"fundAnalysis":[""],"fundHoldings":[""],"assetAllocation":[""],"industryAllocation":[""],"netValue":"","addedReturn":"","holdingReturn":"","buyFeeRate":"","fundCompany":"","platform":"","note":""}',
    '```',
    '10. 如果无法识别基金代码可以留空；数组每个字段最多返回 4 项；JSON 代码块后面不要再追加其他内容。',
    `投资上下文：\n${JSON.stringify(context, null, 2)}`
  ].join('\n');
}

export function buildInvestmentAssistantAuxiliaryInfo(input: {
  webEnabled?: boolean;
  webQuery?: string;
  timeContext?: string;
  contextNote?: string;
  webSearchPrompt?: string;
}) {
  const webTrace = [
    `联网过程：${input.webEnabled ? '已开启联网核验' : '未开启联网核验'}`,
    input.webEnabled && input.webQuery ? `检索关键词：${input.webQuery}` : ''
  ]
    .filter(Boolean)
    .join('\n');

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
    note: normalizeOptionalString(item.note)
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
