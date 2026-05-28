import type {
  InvestmentAiMessage,
  InvestmentFundAnalysis,
  InvestmentGoal,
  InvestmentPosition,
  InvestmentWatchItem
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
      lastAnalysisAt: item.lastAnalysisAt || '',
      updatedAt: item.updatedAt || ''
    }))
  };

  return [
    '你是 LedgerFlow 的基金分析助手，帮助用户判断一只基金是否值得继续关注、定投、持有或减仓。',
    '回答要求：',
    '1. 用自然、直接的简体中文回答，不要解释页面逻辑，不要空话。',
    '2. 先给一句结论，再给 3 条左右依据，最后给 2 到 3 条下一步建议。',
    '3. 可以结合用户上传的截图、用户问题和投资上下文；如果信息不足，必须直接说“信息不足”，并指出还差什么。',
    '4. 如果投资上下文里已有基金自选记录，尤其是同名或同代码基金，要参考自选里的投资建议、建议依据、风险提示、上次结论、摘要、备注和更新时间，说明本次判断是否延续或改变。',
    '5. 不要承诺收益，也不要替用户做最终投资决策。',
    '6. 在正文最后追加一个 JSON 代码块，格式必须是：',
    '```json',
    '{"fundName":"","fundCode":"","verdict":"","summary":"","riskLevel":"low|medium|high|unknown","highlights":[""],"risks":[""],"actions":[""],"watchTags":[""],"platform":"","note":""}',
    '```',
    '7. 如果无法识别基金代码可以留空；数组每个字段最多返回 4 项；JSON 代码块后面不要再追加其他内容。',
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
    platform: normalizeOptionalString(item.platform),
    note: normalizeOptionalString(item.note)
  };
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
  if (text.trim()) {
    return text.trim();
  }

  if (!analysis) {
    return '已完成分析';
  }

  return [analysis.verdict, analysis.summary].filter(Boolean).join('\n');
}

export function createInvestmentAiMessage(input: {
  id: string;
  role: InvestmentAiMessage['role'];
  text: string;
  createdAt: string;
  reasoning?: string;
  attachmentCount?: number;
  analysis?: InvestmentFundAnalysis | null;
}): InvestmentAiMessage {
  return {
    id: input.id,
    role: input.role,
    text: input.text,
    reasoning: normalizeOptionalString(input.reasoning),
    attachmentCount: input.attachmentCount,
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
