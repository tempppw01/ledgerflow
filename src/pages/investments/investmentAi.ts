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

function extractJsonCodeBlock(raw: string): string {
  const matches = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length > 0) {
    return matches[matches.length - 1]?.[1]?.trim() || '';
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1);
  }

  return '';
}

export function stripInvestmentAnalysisJson(raw: string): string {
  return raw.replace(/\n?```json[\s\S]*?```/gi, '').trim();
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
      performanceHistory: item.performanceHistory || [],
      fundAnalysis: item.fundAnalysis || [],
      fundHoldings: item.fundHoldings || [],
      assetAllocation: item.assetAllocation || [],
      industryAllocation: item.industryAllocation || [],
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
    '4. 可以结合用户上传的截图、用户问题和投资上下文；如果信息不足，必须直接说“信息不足”，并指出还差什么。',
    '5. 如果投资上下文里已有基金自选记录，尤其是同名或同代码基金，要参考自选里的投资建议、历史业绩、基金分析、持仓、资产/行业分布、费率、基金公司、风险提示、上次结论、摘要、备注和更新时间，说明本次判断是否延续或改变。',
    '6. 不要承诺收益，也不要替用户做最终投资决策；但可以给出清晰的风险分级和操作优先级。',
    '7. 在正文最后追加一个 JSON 代码块，格式必须是：',
    '```json',
    '{"fundName":"","fundCode":"","verdict":"","summary":"","riskLevel":"low|medium|high|unknown","highlights":[""],"risks":[""],"actions":[""],"watchTags":[""],"performanceHistory":[""],"fundAnalysis":[""],"fundHoldings":[""],"assetAllocation":[""],"industryAllocation":[""],"buyFeeRate":"","fundCompany":"","platform":"","note":""}',
    '```',
    '8. 如果无法识别基金代码可以留空；数组每个字段最多返回 4 项；JSON 代码块后面不要再追加其他内容。',
    `投资上下文：\n${JSON.stringify(context, null, 2)}`
  ].join('\n');
}

export function buildInvestmentWatchlistReviewPrompt(input: {
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
      performanceHistory: item.performanceHistory || [],
      fundAnalysis: item.fundAnalysis || [],
      fundHoldings: item.fundHoldings || [],
      assetAllocation: item.assetAllocation || [],
      industryAllocation: item.industryAllocation || [],
      buyFeeRate: item.buyFeeRate || '',
      fundCompany: item.fundCompany || '',
      lastAnalysisAt: item.lastAnalysisAt || '',
      updatedAt: item.updatedAt || ''
    }))
  };

  return [
    '你是 LedgerFlow 的 AI 投资自选基金复盘助手，用户希望你帮他把自选基金按“更值得优先关注/更适合先处理”的顺序排好。',
    '任务要求：',
    '1. 逐只复盘所有自选基金，不能遗漏任何 id；不要新增不存在的基金。',
    '2. rank=1 表示最值得优先关注或最需要用户先看的一只；如果信息不足，也要根据已有资料给出保守排序。',
    '3. 投资建议要适合新手，短、直观、可执行，例如“继续观察”“小比例定投”“暂不加仓”“先补资料”。',
    '4. summary 控制在 60 字以内，尽量解释为什么排在这个位置。',
    '5. 你可以补全历史业绩、基金分析、基金持仓、资产分布、行业分布、买入费率、基金公司；不确定就留空数组或空字符串，不要编造精确数据。',
    '6. 只返回 JSON 代码块，格式必须是：',
    '```json',
    '{"items":[{"id":"","rank":1,"verdict":"","summary":"","riskLevel":"low|medium|high|unknown","investmentAdvice":"","adviceReasons":[""],"riskNotes":[""],"nextActions":[""],"watchTags":[""],"performanceHistory":[""],"fundAnalysis":[""],"fundHoldings":[""],"assetAllocation":[""],"industryAllocation":[""],"buyFeeRate":"","fundCompany":"","note":""}]}',
    '```',
    '7. 数组字段每项不超过 8 项；JSON 代码块后面不要再追加其他内容。',
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
        const normalizedLine = line.replace(/^[-*]\s+/, '').trim().replace(/\s+/g, ' ');
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

export function createInvestmentAiMessage(input: {
  id: string;
  role: InvestmentAiMessage['role'];
  text: string;
  createdAt: string;
  reasoning?: string;
  attachmentCount?: number;
  attachmentImages?: string[];
  analysis?: InvestmentFundAnalysis | null;
}): InvestmentAiMessage {
  const attachmentImages = input.attachmentImages
    ?.filter((value) => value.startsWith('data:image/'))
    .slice(0, 4);
  return {
    id: input.id,
    role: input.role,
    text: input.text,
    reasoning: normalizeOptionalString(input.reasoning),
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
