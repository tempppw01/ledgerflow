import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import {
  buildCreditAssistantMessageText,
  extractCreditStructuredItems,
  extractStreamingCreditPreview
} from '../../features/assistant/creditAssistant/parser';
import type { CreditExtractedItem, CreditFieldMeta } from '../../features/assistant/creditAssistant/types';
import { useAssistantWorkbench } from '../../features/assistant/workbench/useAssistantWorkbench';
import { BillPreviewCard } from '../../features/assistant/ui/BillPreviewCard';
import { renderMarkdownContent } from '../../features/assistant/ui/MarkdownRenderer';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useGlobalMemoryStore } from '../../shared/store/useGlobalMemoryStore';
import { extractGlobalMemoriesFromConversation } from '../../features/assistant/memory/extractGlobalMemories';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import {
  getTransactionDirection,
  summarizeTransactions
} from '../../shared/lib/transactionMetrics';
import { Toast } from '../../shared/ui/Toast';
import type { DebtItem } from '../../features/debt/model/debtMetrics';
import {
  calculateDebtDerivedMetrics,
  calculateDebtMinimumPayment,
  calculateDebtSummary
} from '../../features/debt/model/debtMetrics';
import type { DraftBillEntry } from '../../features/assistant/workbench/workbenchTypes';
import type { TransactionItem } from '../../entities/transaction/types';
import type { Category } from '../../entities/category/types';
import {
  buildCreditFollowUpPrompts,
  enrichCreditItemsForConfirmation,
  mergeCreditItemsWithHistory
} from './creditAssistantLogic';
import {
  ASSISTANT_ACTIVE_MODE_STORAGE_KEY,
  ASSISTANT_MODE_CHANGED_EVENT,
  getAssistantModeLabel,
  readAssistantModeFromSessionStorage,
  type AssistantMode
} from '../../features/assistant/shared/assistantMode';

function getModelDisplayLabel(modelId: string): string {
  const value = modelId.trim();
  if (!value) return value;
  return value === 'gpt-5.4' ? `${value}（推荐）` : value;
}

function inputPlaceholder(
  status: ReturnType<typeof useAssistantWorkbench>['status'],
  hasApiKey: boolean,
  mode: AssistantMode,
  t: TFunction
): string {
  if (!hasApiKey) return t('assistant.placeholders.needApiKey');

  const assistantHint = t('assistant.placeholders.assistantHint');
  const bookkeepingHint = t('assistant.placeholders.bookkeepingHint');
  const creditHint = '可以直接问我花呗、分期、贷款、账单和还款安排。';

  switch (status) {
    case 'idle':
      return mode === 'bookkeeping'
        ? t('assistant.placeholders.idleBookkeeping', { hint: bookkeepingHint })
        : mode === 'credit'
          ? creditHint
          : assistantHint;
    case 'ready':
      return mode === 'bookkeeping'
        ? t('assistant.placeholders.readyBookkeeping')
        : mode === 'credit'
          ? '把贷款、分期或账单截图贴给我，我先帮你梳理应还信息。'
          : t('assistant.placeholders.readyAssistant', { hint: assistantHint });
    case 'recognizing':
      return t('assistant.placeholders.recognizing');
    case 'preview':
      return t('assistant.placeholders.preview');
    case 'saving':
      return t('assistant.placeholders.saving');
    case 'saved':
      return t('assistant.placeholders.saved');
    case 'error':
      return t('assistant.placeholders.error');
    default:
      return mode === 'bookkeeping' ? bookkeepingHint : mode === 'credit' ? creditHint : assistantHint;
  }
}

function renderCreditCardSkeleton(count = 2) {
  return (
    <div className="chat-credit-cards chat-credit-cards-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <section key={`credit-skeleton-${index}`} className="chat-credit-card chat-credit-card-skeleton">
          <div className="chat-credit-card-head">
            <div>
              <strong className="chat-skeleton-line chat-skeleton-line-lg">&nbsp;</strong>
              <span className="chat-skeleton-line chat-skeleton-line-sm">&nbsp;</span>
            </div>
            <em className="chat-credit-confidence is-medium chat-skeleton-pill">识别中</em>
          </div>
          <div className="chat-credit-grid">
            {Array.from({ length: 6 }, (_, gridIndex) => (
              <div key={`credit-skeleton-grid-${index}-${gridIndex}`}>
                <span className="chat-skeleton-line chat-skeleton-line-sm">&nbsp;</span>
                <strong className="chat-skeleton-line">&nbsp;</strong>
              </div>
            ))}
          </div>
          <div className="chat-credit-pending">
            <span className="chat-skeleton-line chat-skeleton-line-sm">&nbsp;</span>
            <div className="chat-credit-pending-list">
              <span className="chat-skeleton-pill">&nbsp;</span>
              <span className="chat-skeleton-pill">&nbsp;</span>
              <span className="chat-skeleton-pill">&nbsp;</span>
            </div>
          </div>
          <div className="chat-credit-actions">
            <button type="button" className="chat-secondary-action-btn" disabled>
              保存到还款管理
            </button>
            <button type="button" className="chat-secondary-action-btn" disabled>
              带去还款管理
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

interface ChatHistoryItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imageDataUrls?: string[];
  pdfDataUrls?: string[];
  usageText?: string;
  reasoningText?: string;
  embeddingSummaryText?: string;
  embeddingDebugText?: string;
  followUpPrompts?: string[];
  creditItems?: CreditExtractedItem[];
}

interface PresetQuestion {
  id: string;
  label: string;
  prompt: string;
}

interface SmartPresetCard extends PresetQuestion {
  tag: string;
  hint: string;
}

interface PushInsight {
  id: string;
  title: string;
  detail: string;
  level?: 'default' | 'warning';
}

interface TodayTodoItem {
  id: string;
  label: string;
  detail: string;
  level?: 'default' | 'warning';
  count?: number;
  statusLabel?: string;
  href?: string;
}

interface DuplicateReviewPair {
  entry: DraftBillEntry;
  existing: TransactionItem;
}

const ANALYSIS_SHORTCUT_SEEDS = [
  {
    label: '最近1个月消费分析',
    prompt:
      '请结合我近30天账单，从总额、主要分类、异常波动和可优化动作四个角度做一份简洁分析，并给出3条可执行建议。'
  },
  {
    label: '下个月还款预算',
    prompt:
      '基于我最近账单的固定支出和消费节奏，帮我制定下个月还款与现金流预算方案，包含保守/常规两档。'
  },
  {
    label: '近3个月收支趋势',
    prompt: '请按月对比我最近3个月的收入、支出和结余变化，指出趋势拐点，并说明最可能的影响因素。'
  },
  {
    label: '大额支出识别',
    prompt:
      '请识别我最近3个月中金额异常偏高的支出，标注时间、分类、金额及可能原因，并给出下月规避策略。'
  }
];

const CHAT_HISTORY_CACHE_KEYS: Record<AssistantMode, string> = {
  bookkeeping: 'ledgerflow.assistant.chatHistory.bookkeeping',
  assistant: 'ledgerflow.assistant.chatHistory.assistant',
  credit: 'ledgerflow.assistant.chatHistory.credit'
};

const CREDIT_SHORTCUT_SEEDS: PresetQuestion[] = [
  {
    id: 'credit-seed-1',
    label: '梳理本月应还',
    prompt: '请结合我现有账本与接下来可能到期的信用消费，帮我梳理本月应还项目、优先级和资金压力。'
  },
  {
    id: 'credit-seed-2',
    label: '识别花呗与分期',
    prompt: '如果我贴出花呗、白条、信用卡分期或消费贷账单截图，请帮我提炼平台、应还金额、还款日、剩余期数和待补充信息。'
  },
  {
    id: 'credit-seed-3',
    label: '下周还款安排',
    prompt: '请根据我的账本消费和信用账户情况，给我一份下周还款安排建议，按先后顺序列出。'
  },
  {
    id: 'credit-seed-4',
    label: '信贷风险排查',
    prompt: '请从现金流、还款日集中度、可能遗漏的分期项目三个角度，帮我做一次信贷风险排查。'
  }
];

const PRESET_QUESTIONS_CACHE_KEY = 'ledgerflow.assistant.personalizedPresets.v1';
const PRESET_QUESTIONS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

interface CachedPresetQuestion {
  label: string;
  prompt: string;
}

interface PresetQuestionsCachePayload {
  signature: string;
  updatedAt: number;
  questions: CachedPresetQuestion[];
}

function withPresetIds(questions: CachedPresetQuestion[], namespace: string): PresetQuestion[] {
  return questions.map((item, index) => ({
    id: `${namespace}-${index}`,
    label: item.label,
    prompt: item.prompt
  }));
}

function buildPresetQuestionsSignature(transactions: TransactionItem[], categories: Category[]) {
  const txSignature = transactions
    .slice(-120)
    .map((item) => `${item.date}|${item.type}|${item.amount}|${item.categoryId}|${item.note ?? ''}`)
    .join('~');
  const categorySignature = categories
    .map((item) => `${item.id}:${item.name}`)
    .sort()
    .join('~');
  return `${transactions.length}:${categories.length}:${categorySignature}:${txSignature}`;
}

function readPresetQuestionsCache(signature: string): CachedPresetQuestion[] | null {
  try {
    const raw = window.localStorage.getItem(PRESET_QUESTIONS_CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as PresetQuestionsCachePayload;
    if (
      !payload ||
      payload.signature !== signature ||
      Date.now() - payload.updatedAt > PRESET_QUESTIONS_CACHE_TTL_MS ||
      !Array.isArray(payload.questions)
    ) {
      return null;
    }
    return payload.questions.filter(
      (item): item is CachedPresetQuestion =>
        Boolean(item) && typeof item.label === 'string' && typeof item.prompt === 'string'
    );
  } catch {
    return null;
  }
}

function writePresetQuestionsCache(signature: string, questions: CachedPresetQuestion[]) {
  try {
    const payload: PresetQuestionsCachePayload = {
      signature,
      updatedAt: Date.now(),
      questions
    };
    window.localStorage.setItem(PRESET_QUESTIONS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage write errors
  }
}

function readWideLayoutPreference() {
  try {
    return window.localStorage.getItem('ledgerflow.assistant.wide-layout') === '1';
  } catch {
    return false;
  }
}

function readChatHistory(mode: AssistantMode): ChatHistoryItem[] {
  try {
    const raw = window.sessionStorage.getItem(CHAT_HISTORY_CACHE_KEYS[mode]);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatHistoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ChatHistoryItem =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.text === 'string'
      )
      .map((item) => ({
        ...item,
        imageDataUrls: Array.isArray(item.imageDataUrls)
          ? item.imageDataUrls.filter(
              (url): url is string => typeof url === 'string' && url.length > 0
            )
          : [],
        pdfDataUrls: Array.isArray(item.pdfDataUrls)
          ? item.pdfDataUrls.filter(
              (url): url is string => typeof url === 'string' && url.length > 0
            )
          : [],
        followUpPrompts: Array.isArray(item.followUpPrompts)
          ? item.followUpPrompts.filter(
              (prompt): prompt is string => typeof prompt === 'string' && prompt.length > 0
            )
          : [],
        creditItems: Array.isArray(item.creditItems)
          ? item.creditItems.filter(
              (creditItem): creditItem is CreditExtractedItem =>
                Boolean(creditItem) &&
                typeof creditItem.id === 'string' &&
                typeof creditItem.title === 'string' &&
                typeof creditItem.productType === 'string' &&
                Array.isArray(creditItem.pendingFields) &&
                (creditItem.confidence === 'high' ||
                  creditItem.confidence === 'medium' ||
                  creditItem.confidence === 'low')
            )
          : undefined
      }));
  } catch {
    return [];
  }
}

function toMonthKey(date: string) {
  return date.slice(0, 7);
}

function truncateAssistantText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildLocalPresetQuestions(transactions: TransactionItem[], categories: Category[]) {
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  const expenseRows = [...transactions]
    .filter((item) => item.type === 'expense')
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonth = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;
  const monthTotal = (month: string) =>
    expenseRows
      .filter((item) => toMonthKey(item.date) === month)
      .reduce((sum, item) => sum + item.amount, 0);
  const currentTotal = monthTotal(thisMonth);
  const previousTotal = monthTotal(lastMonth);
  const deltaPct = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;

  const topCategory = Object.values(
    expenseRows.reduce<Record<string, { name: string; amount: number }>>((acc, item) => {
      const name = categoryMap.get(item.categoryId) || '其他';
      if (!acc[name]) acc[name] = { name, amount: 0 };
      acc[name].amount += item.amount;
      return acc;
    }, {})
  ).sort((a, b) => b.amount - a.amount)[0];

  const latest = expenseRows[0];
  const generated = [
    {
      label: '本月波动拆解',
      prompt:
        currentTotal > 0
          ? `请围绕本月支出¥${currentTotal.toFixed(2)}（较上月${deltaPct >= 0 ? '增加' : '减少'}${Math.abs(deltaPct).toFixed(1)}%）分析波动来源，并给出具体控费动作。`
          : '我当前月度消费数据不完整，请先给我一套适用于首月记账的预算框架和执行步骤。'
    },
    {
      label: '大头分类诊断',
      prompt: topCategory
        ? `请重点分析“${topCategory.name}”累计¥${topCategory.amount.toFixed(2)}的构成，识别高风险场景并给我可落地的替代方案。`
        : '请先帮我补齐常用消费分类，并设计一套方便执行的分类记账规范。'
    },
    {
      label: '最近消费复盘',
      prompt: latest
        ? `请基于我最近一笔“${latest.note || '未备注消费'}（¥${latest.amount.toFixed(2)}）”，检查是否存在重复记账、误分类或可优化开销。`
        : '我还没有最新消费记录，请先给我一份从零开始的消费复盘清单。'
    },
    {
      label: '7天小额拦截',
      prompt:
        '请统计我过去7天高频小额支出，按“可砍/可替代/保留”分类，并给出一周内可执行的缩减方案。'
    },
    {
      label: '10%节流测算',
      prompt: '如果本月非必要支出降低10%，请测算预计结余提升，并给我3条最值得优先执行的行动建议。'
    }
  ];

  return [...ANALYSIS_SHORTCUT_SEEDS, ...generated]
    .sort(() => Math.random() - 0.5)
    .slice(0, 8)
    .map((item, index) => ({ id: `fallback-${index}`, ...item }));
}

type AssistantIntent = 'trend' | 'review' | 'planning' | 'decision' | 'risk' | 'category';

const ASSISTANT_INTENT_PATTERNS: Array<{ intent: AssistantIntent; regex: RegExp; label: string; priority: number }> = [
  { intent: 'trend', regex: /趋势|变化|波动|上升|下降|最近|本月|上月|环比|同比|拐点/, label: '趋势变化', priority: 6 },
  { intent: 'review', regex: /复盘|回顾|总结|问题在哪|哪里失控|拆解|原因/, label: '复盘拆解', priority: 5 },
  { intent: 'planning', regex: /预算|计划|安排|怎么做|下一步|清单|执行|优先级/, label: '行动规划', priority: 4 },
  { intent: 'decision', regex: /怎么看|判断|值不值|要不要|是否|应该|该不该|合适吗/, label: '判断取舍', priority: 5 },
  { intent: 'risk', regex: /风险|压力|危险|失控|隐患|吃紧|透支/, label: '风险提醒', priority: 4 },
  { intent: 'category', regex: /分类|餐饮|交通|住房|娱乐|日用|订阅|买菜|通勤/, label: '分类聚焦', priority: 3 }
];

function rankAssistantIntents(text: string): AssistantIntent[] {
  const scored = ASSISTANT_INTENT_PATTERNS.map((item) => ({
    intent: item.intent,
    label: item.label,
    priority: item.priority,
    hits: (text.match(new RegExp(item.regex.source, 'g')) || []).length
  }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits * 10 + b.priority - (a.hits * 10 + a.priority));

  return scored.slice(0, 3).map((item) => item.intent);
}

function buildAssistantIntentLabels(intents: AssistantIntent[]): string[] {
  return intents
    .map((intent) => ASSISTANT_INTENT_PATTERNS.find((item) => item.intent === intent)?.label || '')
    .filter(Boolean);
}

function buildAssistantPromptFocus(intents: AssistantIntent[]): string[] {
  const focus = new Set<string>();
  intents.forEach((intent) => {
    if (intent === 'trend') {
      focus.add('先抓变化，再解释驱动因素与后续影响');
    }
    if (intent === 'review') {
      focus.add('优先定位问题，再拆原因，不要只报现象');
    }
    if (intent === 'planning') {
      focus.add('把建议落到先后顺序和可执行动作，不要停在方向层');
    }
    if (intent === 'decision') {
      focus.add('需要明确表态时直接给判断，并交代成立前提');
    }
    if (intent === 'risk') {
      focus.add('指出最值得警惕的风险点，并说明影响范围');
    }
    if (intent === 'category') {
      focus.add('尽量落到具体分类、场景或对象，不要只说泛化结论');
    }
  });

  if (focus.size === 0) {
    focus.add('先回答问题主线，再补最关键的细节');
  }

  return Array.from(focus).slice(0, 3);
}

function buildAssistantConversationPrompt(question: string, history: ChatHistoryItem[]): string {
  const recentHistory = history.slice(-6);
  const context = recentHistory
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.text}`)
    .join('\n');
  const analysisText = `${question}\n${recentHistory
    .filter((item) => item.role === 'user')
    .map((item) => item.text)
    .join('\n')}`;
  const intents = rankAssistantIntents(analysisText);
  const intentLabels = buildAssistantIntentLabels(intents);
  const focusPoints = buildAssistantPromptFocus(intents);
  const promptSections = [
    '请像真正读过账本和上下文的分析助手那样回答。',
    intentLabels.length > 0 ? `回答偏好：${intentLabels.join(' / ')}` : '',
    '回答原则：',
    '- 先直接回应当前问题，不要先说套话。',
    '- 结构允许自然变化，用最适合当前问题的组织方式，不要套固定三段式。',
    '- 只展开最有信息量的 2-4 个点，优先引用具体时间、分类、对象或金额口径。',
    '- 如果信息不足，明确说明缺口及其影响，不要硬编。',
    ...focusPoints.map((item) => `- ${item}`)
  ].filter(Boolean);

  if (!context) {
    return `当前问题：${question}\n\n${promptSections.join('\n')}`;
  }

  return `请结合以下最近对话上下文连续回答，避免重复追问已确认的信息。\n\n最近对话：\n${context}\n\n当前问题：${question}\n\n${promptSections.join('\n')}`;
}

function buildCreditConversationPrompt(question: string, history: ChatHistoryItem[]): string {
  const context = history
    .slice(-6)
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.text}`)
    .join('\n');

  const schema = [
    '请按“结论 → 依据 → 下一步建议”的顺序回答。默认尽量短，不要写成长篇大论。识别类问题优先给 1 句结论 + 最多 3 条依据 + 最多 2 条下一步建议。若问题属于风险判断/现金流/复盘/决策类，也要保持固定骨架：先结论，再依据，最后动作；若数据不足，明确写待确认项。若识别到明确的信贷/分期项目，请在回答末尾追加一个 JSON 代码块，格式如下：',
    '',
    '```json',
    '{',
    '  "creditItems": [',
    '    {',
    '      "title": "产品/平台名",',
    '      "productType": "花呗|白条|信用卡分期|消费贷|房贷|车贷|现金贷|其他",',
    '      "dueAmount": "当前应还金额（可为空）",',
    '      "totalDebt": "总欠款/剩余待还（可为空）",',
    '      "repaymentDate": "还款日/扣款日（可为空）",',
    '      "remainingPeriods": "剩余期数（可为空）",',
    '      "monthlyAmount": "每期金额（可为空）",',
    '      "interest": "利息/服务费/APR（可为空）",',
    '      "rateType": "APR|名义年利率|月利率|日利率|平台口径待确认（可为空）",',
    '      "rateSource": "explicit|inferred|pending",',
    '      "riskHint": "一句风险提示（可为空）",',
    '      "actionSuggestion": "一句下一步建议（可为空）",',
    '      "pendingFields": ["待补充字段1", "待补充字段2"],',
    '      "confidence": "high|medium|low"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '关键要求：1) 原文明确出现的字段才能写明确值；2) 推测值要通过 rateSource 或正文显式标注；3) 无法确认就留空并写入 pendingFields；4) 如果没有识别出明确项目，就不要硬编，改为给出人工核对建议。'
  ].join('\n');

  if (!context) {
    return `${question}\n\n${schema}`;
  }

  return `请结合以下最近对话上下文连续回答，避免重复追问已确认的信息。\n\n最近对话：\n${context}\n\n当前问题：${question}\n\n${schema}`;
}


function splitStreamingSegments(raw: string): { committed: string[]; draft: string } {
  const text = String(raw || '');
  if (!text.trim()) return { committed: [], draft: '' };

  const normalized = text.replace(/\r/g, '');
  const committed: string[] = [];
  let cursor = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const nextChar = normalized[i + 1] || '';
    const isParagraphBreak = char === '\n' && nextChar === '\n';
    const isSentenceBreak = /[。！？!?；;]/.test(char);
    if (!isParagraphBreak && !isSentenceBreak) continue;

    const sliceEnd = isParagraphBreak ? i + 2 : i + 1;
    const chunk = normalized.slice(cursor, sliceEnd).trim();
    if (chunk) committed.push(chunk);
    cursor = sliceEnd;
    if (isParagraphBreak) i += 1;
  }

  const draft = normalized.slice(cursor).trimStart();
  return { committed, draft };
}

function normalizeCreditDebtPayload(item: CreditExtractedItem): Omit<DebtItem, 'id'> {
  const prefill = mapCreditItemToRepaymentPrefill(item);
  const toNumber = (value?: string) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const balance = toNumber(prefill.balance) || 0;
  const annualRate = toNumber(prefill.annualRate);
  const remainingMonths = toNumber(prefill.remainingMonths);
  const totalPeriods = toNumber(prefill.totalPeriods);
  const paidPeriods = toNumber(prefill.paidPeriods);
  const loanPrincipal = toNumber(prefill.loanPrincipal);
  const totalRepayment = toNumber(prefill.totalRepayment);
  const repaymentDay = toNumber(prefill.repaymentDay);

  return {
    name: prefill.name || item.title || '待确认负债',
    type: prefill.type || 'credit-card',
    balance,
    annualRate,
    remainingMonths,
    totalPeriods,
    paidPeriods,
    loanPrincipal,
    totalRepayment,
    repaymentDay,
    paymentAccount: prefill.paymentAccount || undefined,
    customMinPayment: undefined,
    billDay: undefined,
    repaymentMethod: prefill.type === 'loan' ? 'equal-installment' : 'minimum-payment',
    repaymentRecordMode: 'manual',
    graceDays: 0
  };
}

function mapCreditItemToRepaymentPrefill(item: CreditExtractedItem) {
  const normalizedTypeText = `${item.productType} ${item.title}`;
  const type: 'credit-card' | 'consumer-loan' | 'loan' = /房贷|车贷|按揭|贷款/i.test(normalizedTypeText)
    ? 'loan'
    : /花呗|白条|分期|消费贷|借呗|现金贷/i.test(normalizedTypeText)
      ? 'consumer-loan'
      : 'credit-card';

  const extractNumberText = (value?: string) => {
    if (!value) return '';
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? match[0] : '';
  };

  const extractDayText = (value?: string) => {
    if (!value) return '';
    const match = value.match(/(\d{1,2})(?:日|号)?/);
    return match ? match[1] : '';
  };

  const totalPeriodsNumber = extractNumberText(item.remainingPeriods);

  return {
    name: item.title,
    type,
    balance: extractNumberText(item.totalDebt) || extractNumberText(item.dueAmount),
    repaymentDay: extractDayText(item.repaymentDate),
    totalPeriods: totalPeriodsNumber,
    paidPeriods: '',
    remainingMonths: totalPeriodsNumber,
    loanPrincipal: extractNumberText(item.totalDebt),
    totalRepayment: extractNumberText(item.totalDebt),
    annualRate: extractNumberText(item.interest),
    paymentAccount: '',
    source: 'assistant-credit'
  };
}

function buildFollowUpPrompts(answer: string, history: ChatHistoryItem[]): string[] {
  const latestUserQuestion = [...history].reverse().find((item) => item.role === 'user')?.text?.trim() || '';
  const questionSnippet = latestUserQuestion.replace(/\s+/g, ' ').trim().slice(0, 16);
  const questionIntents = rankAssistantIntents(latestUserQuestion);
  const answerIntents = rankAssistantIntents(answer);
  const mergedIntents = Array.from(new Set([...questionIntents, ...answerIntents]));

  const candidates: Array<{ prompt: string; score: number }> = [];
  const pushCandidate = (prompt: string, score: number) => {
    if (!prompt.trim()) return;
    candidates.push({ prompt, score });
  };

  mergedIntents.forEach((intent, index) => {
    const baseScore = 100 - index * 10;
    if (intent === 'trend') {
      pushCandidate('把这个变化拆成几个阶段，我想看真正的拐点。', baseScore);
      pushCandidate('如果按现在的节奏继续走，下个阶段最先恶化的会是什么？', baseScore - 2);
    }
    if (intent === 'review') {
      pushCandidate('别只复述现象，继续往下拆一层真正原因。', baseScore);
      pushCandidate('如果只允许保留一个复盘结论，你觉得最关键的是哪一个？', baseScore - 2);
    }
    if (intent === 'planning') {
      pushCandidate('把建议压缩成一个这周就能执行的小清单。', baseScore);
      pushCandidate('如果我这周只能先做一件事，你建议先做哪一步？', baseScore - 2);
    }
    if (intent === 'decision') {
      pushCandidate('如果你必须明确站一边，你现在会怎么选？', baseScore);
      pushCandidate('换成更保守的前提，你的判断会不会变？', baseScore - 2);
    }
    if (intent === 'risk') {
      pushCandidate('你刚才提到的风险里，哪个最容易被低估？', baseScore);
      pushCandidate('把风险按短期影响和长期拖累重新排一下。', baseScore - 2);
    }
    if (intent === 'category') {
      pushCandidate('按分类重新排一下优先级，只保留最值得先处理的几项。', baseScore);
      pushCandidate('把金额最大和最容易忽视的分类分开说，我想看差别。', baseScore - 2);
    }
  });

  pushCandidate(questionSnippet ? `围绕“${questionSnippet}${latestUserQuestion.length > 16 ? '…' : ''}”这个点，只展开最关键的一层。` : '', 60);
  pushCandidate('哪些判断已经比较稳，哪些地方还需要我补数据？', 50);
  pushCandidate('把刚才那段话压缩成一句提醒，写给下周的我。', 40);

  const ranked = candidates
    .sort((a, b) => b.score - a.score)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.prompt === item.prompt) === index)
    .slice(0, 4)
    .map((item) => item.prompt);

  return ranked;
}

function renderFieldMetaTag(meta?: CreditFieldMeta) {
  if (!meta) return null;

  const sourceLabel =
    meta.source === 'explicit'
      ? '原文识别'
      : meta.source === 'rule'
        ? '规则推算'
        : meta.source === 'ai-inferred'
          ? 'AI推断'
          : meta.source === 'user-supplemented'
            ? '用户补充'
            : '待确认';

  const statusLabel =
    meta.status === 'confirmed'
      ? '已确认'
      : meta.status === 'low-confidence'
        ? '低置信'
        : '待确认';

  return (
    <div className="chat-credit-field-meta">
      <span className={`chat-credit-field-chip is-${meta.status}`}>{statusLabel}</span>
      <span>{sourceLabel}</span>
      {meta.evidence ? <small>{meta.evidence}</small> : null}
    </div>
  );
}

function renderCreditField(label: string, value: string | undefined, meta?: CreditFieldMeta) {
  return (
    <div className="chat-credit-field-card">
      <span>{label}</span>
      <strong>{value || '待补充'}</strong>
      {renderFieldMetaTag(meta)}
    </div>
  );
}

export function AssistantPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AssistantMode>(() => readAssistantModeFromSessionStorage());
  const [isWideLayout, setIsWideLayout] = useState(() => readWideLayoutPreference());
  const baseUrl = useAiSettings((s) => s.baseUrl);
  const apiKey = useAiSettings((s) => s.apiKey);
  const model = useAiSettings((s) => s.model);
  const setModel = useAiSettings((s) => s.setModel);
  const showEmbeddingSummary = useAiSettings((s) => s.showEmbeddingSummary);
  const debts = useAppPreferences((s) => s.debts);
  const updateDebt = useAppPreferences((s) => s.updateDebt);
  const removeDebt = useAppPreferences((s) => s.removeDebt);
  const addRepaymentRecord = useAppPreferences((s) => s.addRepaymentRecord);
  const repaymentRecords = useAppPreferences((s) => s.repaymentRecords);
  const showEmbeddingDebug = useAiSettings((s) => s.showEmbeddingDebug);
  const embeddingModel = useAiSettings((s) => s.embeddingModel);
  const enableEmbeddingModel = useAiSettings((s) => s.enableEmbeddingModel);
  const globalMemories = useGlobalMemoryStore((s) => s.memories);
  const addGlobalMemory = useGlobalMemoryStore((s) => s.addMemory);

  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const transactions = useFinanceStore((s) => s.transactions);
  const subscriptions = useFinanceStore((s) => s.subscriptions);
  const addCategory = useFinanceStore((s) => s.addCategory);
  const addAccount = useFinanceStore((s) => s.addAccount);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const addSubscription = useFinanceStore((s) => s.addSubscription);
  const addDebt = useAppPreferences((s) => s.addDebt);

  const wb = useAssistantWorkbench({
    baseUrl,
    apiKey,
    model,
    categories,
    accounts,
    transactions,
    addCategory,
    addAccount,
    addTransaction,
    updateTransaction,
    debts,
    repaymentRecords,
    sceneMode: mode,
    globalMemories
  });

  const [modelOpen, setModelOpen] = useState(false);
  const [presetQuestions, setPresetQuestions] = useState<PresetQuestion[]>([]);
  const [streamingPreviewMessage, setStreamingPreviewMessage] = useState('');
  const [streamingCommittedSegments, setStreamingCommittedSegments] = useState<string[]>([]);
  const [streamingDraftSegment, setStreamingDraftSegment] = useState('');
  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(() => readChatHistory(mode));
  const [confirmingCreditId, setConfirmingCreditId] = useState<string | null>(null);
  const [modelPickerSource, setModelPickerSource] = useState<'command' | 'toolbar' | null>(null);
  const memoryExtractionSignatureRef = useRef<Record<AssistantMode, string>>({
    bookkeeping: '',
    assistant: '',
    credit: ''
  });
  const hasInitializedModeHistoryRef = useRef(false);
  const activeHistoryModeRef = useRef<AssistantMode>(mode);
  const skipHistoryPersistRef = useRef(false);
  const todayKey = new Date().toISOString().slice(0, 10);
  const thisMonthKey = todayKey.slice(0, 7);
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const latestTransaction = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => +new Date(b.date) - +new Date(a.date))
        .find((item) => item.type !== 'budget') ?? null,
    [transactions]
  );
  const creditOverview = useMemo(() => {
    const monthlyIncome = useAppPreferences.getState().monthlyIncome || 0;
    const summary = calculateDebtSummary(debts, monthlyIncome);
    const monthKey = new Date().toISOString().slice(0, 7);
    const monthRepaymentRecords = repaymentRecords.filter((record) => String(record.paidAt || '').slice(0, 7) === monthKey);
    const totalPaidThisMonth = monthRepaymentRecords.reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const totalDueThisMonth = debts.reduce((sum, item) => sum + calculateDebtDerivedMetrics(item).minimumPayment, 0);
    const dueSoonItems = debts
      .filter((item) => typeof item.repaymentDay === 'number')
      .map((item) => ({
        id: item.id,
        name: item.name,
        repaymentDay: item.repaymentDay || 0,
        minimumPayment: calculateDebtDerivedMetrics(item).minimumPayment
      }))
      .sort((a, b) => a.repaymentDay - b.repaymentDay)
      .slice(0, 3);
    const totalRemainingInterest = debts.reduce((sum, item) => sum + (calculateDebtDerivedMetrics(item).remainingInterestCost || 0), 0);

    return {
      totalDebt: summary.totalDebt,
      totalMinimumPayment: summary.totalMinimumPayment,
      totalDueThisMonth,
      totalPaidThisMonth,
      currentGap: Math.max(0, totalDueThisMonth - totalPaidThisMonth),
      totalRemainingInterest,
      dueSoonItems
    };
  }, [debts, repaymentRecords]);
  const lastAssistantRef = useRef<Record<AssistantMode, string>>({
    bookkeeping: '',
    assistant: '',
    credit: ''
  });
  const pendingRequestModeRef = useRef<AssistantMode>('assistant');
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const [duplicateReviewOpen, setDuplicateReviewOpen] = useState(false);
  const [duplicateReviewPairs, setDuplicateReviewPairs] = useState<DuplicateReviewPair[]>([]);
  const [duplicateReviewIndex, setDuplicateReviewIndex] = useState(0);
  const [overwriteEntryIds, setOverwriteEntryIds] = useState<string[]>([]);
  const [semanticPanelOpen, setSemanticPanelOpen] = useState(false);
  const currentModeLabel = useMemo(() => getAssistantModeLabel(mode, t), [mode, t]);

  useEffect(() => {
    try {
      window.localStorage.setItem('ledgerflow.assistant.wide-layout', isWideLayout ? '1' : '0');
    } catch {
      // ignore storage write errors
    }
  }, [isWideLayout]);

  // 仅保留“被勾选且通过校验”的条目，作为一键保存候选。
  const selectedValidEntries = useMemo(
    () => wb.entries.filter((item) => item.selected && item.issues.length === 0),
    [wb.entries]
  );

  // 预览卡片需要的 JSON 结构，避免在渲染阶段重复构造。
  const duplicateEntriesCount = useMemo(
    () => wb.entries.filter((item) => item.duplicateTxId).length,
    [wb.entries]
  );

  const currentDuplicateReview =
    duplicateReviewPairs.length > 0 ? duplicateReviewPairs[duplicateReviewIndex] : null;

  const startDuplicateReview = () => {
    const selectedRows = wb.entries.filter((item) => item.selected && item.issues.length === 0);
    if (selectedRows.length === 0) {
      return wb.saveSelected();
    }

    const pairs = selectedRows
      .filter((item) => item.duplicateTxId)
      .map((item) => {
        const existing = transactions.find((tx) => tx.id === item.duplicateTxId);
        if (!existing) return null;
        return { entry: item, existing };
      })
      .filter((item): item is DuplicateReviewPair => Boolean(item));

    if (pairs.length === 0) {
      return wb.saveSelected();
    }

    setDuplicateReviewPairs(pairs);
    setDuplicateReviewIndex(0);
    setOverwriteEntryIds([]);
    setDuplicateReviewOpen(true);
    return false;
  };

  const commitDuplicateReview = (nextOverwriteIds: string[]) => {
    const ok = wb.saveSelected({ overwriteDuplicateEntryIds: nextOverwriteIds });
    if (ok) {
      wb.setToastState('账单已写入账本', 'success');
    }
    setDuplicateReviewOpen(false);
    setDuplicateReviewPairs([]);
    setDuplicateReviewIndex(0);
    setOverwriteEntryIds([]);
  };

  const handleDuplicateDecision = (shouldOverwrite: boolean) => {
    if (!currentDuplicateReview) return;
    const entryId = currentDuplicateReview.entry.id;
    const nextOverwriteIds = shouldOverwrite
      ? Array.from(new Set([...overwriteEntryIds, entryId]))
      : overwriteEntryIds.filter((id) => id !== entryId);

    if (duplicateReviewIndex >= duplicateReviewPairs.length - 1) {
      commitDuplicateReview(nextOverwriteIds);
      return;
    }

    setOverwriteEntryIds(nextOverwriteIds);
    setDuplicateReviewIndex((prev) => prev + 1);
  };

  const handleCancelDuplicateReview = () => {
    setDuplicateReviewOpen(false);
    setDuplicateReviewPairs([]);
    setDuplicateReviewIndex(0);
    setOverwriteEntryIds([]);
    wb.setToastState('已取消重复账单处理，本次未保存', 'warning');
  };

  const handleCreateSubscriptionFromEntry = (entryId: string) => {
    const entry = wb.entries.find((item) => item.id === entryId);
    if (!entry || !entry.subscriptionSuggestion) return;

    const candidateName = entry.note?.trim() || 'AI识别订阅';
    const candidateCurrency = (entry.currency || 'CNY').toUpperCase();
    const candidateAmount = Number((Number(entry.amount || 0)).toFixed(2));
    const duplicated = subscriptions.find((item) => {
      const nameMatched = item.name.trim() === candidateName;
      const currencyMatched = (item.currency || 'CNY').toUpperCase() === candidateCurrency;
      const amountMatched = Number((Number(item.amount || 0)).toFixed(2)) === candidateAmount;
      return nameMatched && currencyMatched && amountMatched;
    });

    if (duplicated) {
      wb.setToastState('已存在疑似重复订阅，未重复创建', 'warning');
      return;
    }

    addSubscription({
      name: candidateName,
      kind: entry.subscriptionSuggestion.kind,
      amount: candidateAmount,
      currency: candidateCurrency,
      billingCycle: 'monthly',
      accountId: undefined,
      provider: undefined,
      note: `来自 AI 识别：${entry.subscriptionSuggestion.reason}`,
      renewalDate: undefined,
      expireDate: undefined,
      autoRenew: true
    });

    wb.setToastState('已加入订阅管理', 'success');
  };

  const assistantOverview = useMemo(() => {
    const validRows = transactions.filter(
      (item) => item.type === 'income' || item.type === 'expense'
    );
    const todayRows = validRows.filter((item) => item.date.slice(0, 10) === todayKey);
    const todaySummary = summarizeTransactions(todayRows);
    const todayIncome = todaySummary.incomeTotal;
    const todayExpense = todaySummary.expenseTotal;
    const todayNet = todaySummary.netTotal;

    const monthRows = validRows.filter((item) => item.date.startsWith(thisMonthKey));
    const prevMonthRows = validRows.filter((item) => item.date.startsWith(previousMonthKey));
    const monthSummary = summarizeTransactions(monthRows);
    const prevMonthSummary = summarizeTransactions(prevMonthRows);
    const monthExpense = monthSummary.expenseTotal;
    const prevMonthExpense = prevMonthSummary.expenseTotal;
    const monthIncome = monthSummary.incomeTotal;
    const prevMonthIncome = prevMonthSummary.incomeTotal;

    const expenseDeltaPct =
      prevMonthExpense > 0 ? ((monthExpense - prevMonthExpense) / prevMonthExpense) * 100 : 0;
    const incomeDeltaPct =
      prevMonthIncome > 0 ? ((monthIncome - prevMonthIncome) / prevMonthIncome) * 100 : 0;

    const recentExpenseRows = [...validRows]
      .filter((item) => item.type === 'expense' && item.adjustmentKind !== 'refund')
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, 30);
    const avgExpense =
      recentExpenseRows.length > 0
        ? recentExpenseRows.reduce((sum, item) => sum + item.amount, 0) / recentExpenseRows.length
        : 0;
    const abnormalRow = recentExpenseRows.find(
      (item) => item.amount >= Math.max(avgExpense * 2.2, 500)
    );

    const monthBalance = monthIncome - monthExpense;
    const weeklyRows = validRows.filter((item) => {
      const gap = Math.floor((Date.now() - new Date(item.date).getTime()) / (1000 * 60 * 60 * 24));
      return gap >= 0 && gap < 14;
    });
    const thisWeekExpense = summarizeTransactions(
      weeklyRows.filter((item) => item.type === 'expense').slice(0, 7)
    ).expenseTotal;
    const lastWeekExpense = summarizeTransactions(
      weeklyRows.filter((item) => item.type === 'expense').slice(7, 14)
    ).expenseTotal;
    const weeklyExpenseDeltaPct =
      lastWeekExpense > 0 ? ((thisWeekExpense - lastWeekExpense) / lastWeekExpense) * 100 : 0;

    const creditAccountCount = accounts.filter((item) => item.type === 'credit').length;

    const pushInsights: PushInsight[] = [
      {
        id: 'weekly-expense-delta',
        title:
          lastWeekExpense > 0
            ? `近7天餐饮/日常消费较上周${weeklyExpenseDeltaPct >= 0 ? '增加' : '下降'} ${Math.abs(weeklyExpenseDeltaPct).toFixed(1)}%`
            : '近7天消费记录已更新，建议继续补齐一周数据后看趋势',
        detail:
          lastWeekExpense > 0
            ? `本周支出 ¥${thisWeekExpense.toFixed(2)}，上周 ¥${lastWeekExpense.toFixed(2)}。`
            : `当前累计支出 ¥${thisWeekExpense.toFixed(2)}。`,
        level: weeklyExpenseDeltaPct > 15 ? 'warning' : 'default'
      },
      {
        id: 'credit-reminder',
        title:
          creditAccountCount > 0
            ? `检测到 ${creditAccountCount} 个信用账户，建议提前核对下周还款计划`
            : '尚未配置信用卡账户，可在还款管理页补充后获取到期提醒',
        detail:
          creditAccountCount > 0
            ? '可在还款管理页统一查看信用卡/负债余额，避免临期资金紧张。'
            : '完善账户后，我会基于账户结构持续给出还款相关提醒。',
        level: creditAccountCount > 0 ? 'warning' : 'default'
      }
    ];
    const uncategorizedCount = validRows.filter((item) => item.categoryId === 'uncategorized').length;
    const pendingCount = validRows.filter((item) => item.status === 'pending').length;
    const pendingRefundCount = validRows.filter(
      (item) =>
        item.adjustmentKind === 'refund' ||
        item.adjustmentKind === 'reversal' ||
        item.status === 'refunded'
    ).length;
    const repaymentTodoCount = validRows.filter(
      (item) => item.type === 'repayment' && (item.status === 'pending' || item.status === 'failed')
    ).length;

    const todayTodos: TodayTodoItem[] = [
      {
        id: 'todo-uncategorized',
        label: '待分类交易',
        detail: `还有 ${uncategorizedCount} 笔交易未分类，建议今天先补齐。`,
        level: uncategorizedCount > 0 ? 'warning' : 'default',
        count: uncategorizedCount,
        statusLabel: uncategorizedCount > 0 ? '今日 / 需处理' : undefined,
        href: '/transactions?categoryId=uncategorized'
      },
      {
        id: 'todo-refund-link',
        label: '待关联退款',
        detail: `检测到 ${pendingRefundCount} 笔退款/冲正相关记录，可核对原单关联。`,
        level: pendingRefundCount > 0 ? 'warning' : 'default',
        count: pendingRefundCount,
        statusLabel: pendingRefundCount > 0 ? '今日 / 需处理' : undefined,
        href: '/transactions?status=refunded'
      },
      {
        id: 'todo-pending',
        label: '待处理流水',
        detail: `当前有 ${pendingCount} 笔待处理交易，建议优先确认状态。`,
        level: pendingCount > 0 ? 'warning' : 'default',
        count: pendingCount,
        statusLabel: pendingCount > 0 ? '今日 / 需处理' : undefined,
        href: '/transactions?status=pending'
      },
      {
        id: 'todo-repayment',
        label: '到期还款检查',
        detail: `当前有 ${repaymentTodoCount} 笔还款记录待确认，请核对到期日。`,
        level: repaymentTodoCount > 0 ? 'warning' : 'default',
        count: repaymentTodoCount,
        statusLabel: repaymentTodoCount > 0 ? '今日 / 需处理' : undefined,
        href: '/repayment-management'
      }
    ];

    const monthlyInsights = [
      `本月累计支出 ¥${monthExpense.toFixed(2)}，较上月${expenseDeltaPct >= 0 ? '上升' : '下降'} ${Math.abs(expenseDeltaPct).toFixed(1)}%。`,
      `本月收入趋势${incomeDeltaPct >= 0 ? '向上' : '回落'}，变化幅度 ${Math.abs(incomeDeltaPct).toFixed(1)}%，建议同步调整预算。`,
      `当前月净额 ¥${monthBalance.toFixed(2)}，${monthBalance >= 0 ? '收支结构整体稳健。' : '建议关注可压缩支出项。'}`
    ];

    return {
      todayIncome,
      todayExpense,
      todayNet,
      monthlySummary:
        monthExpense > 0
          ? `本月消费 ¥${monthExpense.toFixed(2)}，主要建议聚焦高频小额与突发大额两类支出。`
          : '本月消费数据较少，建议先连续记录 7 天后再进行结构分析。',
      incomeTrend:
        prevMonthIncome > 0
          ? `收入较上月${incomeDeltaPct >= 0 ? '增长' : '下降'} ${Math.abs(incomeDeltaPct).toFixed(1)}%。`
          : '收入趋势基线不足，建议持续记录每笔收入来源。',
      abnormalReminder: abnormalRow
        ? `发现异常支出：${abnormalRow.note || '未备注'} ¥${abnormalRow.amount.toFixed(2)}（${abnormalRow.date.slice(5)}）。`
        : '暂无明显异常支出，当前波动在正常区间。',
      monthlyInsights,
      todayTodos,
      pushInsights,
      riskAlert:
        monthBalance < 0
          ? '风险提示：本月净额为负，建议优先削减非必要消费并预留还款缓冲。'
          : '风险提示：当前净额为正，但仍建议为突发支出预留至少 10% 安全垫。'
    };
  }, [accounts, previousMonthKey, thisMonthKey, todayKey, transactions]);

  const behaviorRecommendedQuestions = useMemo(() => {
    const categoryNameMap = new Map(categories.map((item) => [item.id, item.name]));
    const recentExpenses = [...transactions]
      .filter((item) => item.type === 'expense')
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, 25);
    const topRecentCategory = Object.values(
      recentExpenses.reduce<Record<string, { name: string; amount: number }>>((acc, item) => {
        const name = categoryNameMap.get(item.categoryId) || '其他';
        if (!acc[name]) acc[name] = { name, amount: 0 };
        acc[name].amount += item.amount;
        return acc;
      }, {})
    ).sort((a, b) => b.amount - a.amount)[0];

    const fallback: PresetQuestion[] = [
      {
        id: 'behavior-fallback-1',
        label: '本月支出压力点',
        prompt: '请结合我最近账单，指出本月最容易超支的 3 个场景，并给出逐条控费动作。'
      },
      {
        id: 'behavior-fallback-2',
        label: '下周现金流提醒',
        prompt: '请基于最近消费节奏，预测我下周资金压力，并给出可执行的预算分配建议。'
      }
    ];

    if (!topRecentCategory) return fallback;

    return [
      {
        id: 'behavior-top-category',
        label: `重点看${topRecentCategory.name}`,
        prompt: `请专项分析我最近在“${topRecentCategory.name}”上的支出结构，说明可立刻执行的降本动作。`
      },
      {
        id: 'behavior-trend-check',
        label: '最近行为趋势',
        prompt: '请结合我最近 14 天消费，找出 2 个行为变化趋势，并说明对应的预算影响。'
      }
    ];
  }, [categories, transactions]);

  const creditBehaviorQuestions = useMemo(
    () => [
      {
        id: 'credit-behavior-1',
        label: '最近信贷压力点',
        prompt: '请结合我最近账本，推测最可能形成信贷压力的消费场景，并提醒我哪些项目最值得核对是否分期。'
      },
      {
        id: 'credit-behavior-2',
        label: '优先核对清单',
        prompt: '如果我要今晚就把贷款、花呗、分期情况摸清，请给我一个 3 步核对清单，按优先级列出。'
      }
    ],
    []
  );

  const displayBehaviorQuestions = useMemo(
    () =>
      (mode === 'credit' ? creditBehaviorQuestions : behaviorRecommendedQuestions).slice(
        0,
        isMobileView ? 1 : 2
      ),
    [behaviorRecommendedQuestions, creditBehaviorQuestions, isMobileView, mode]
  );

  const displayPresetQuestions = useMemo(
    () => (mode === 'credit' ? CREDIT_SHORTCUT_SEEDS : presetQuestions).slice(0, isMobileView ? 1 : 2),
    [presetQuestions, isMobileView, mode]
  );

  const hasCreditContextContent =
    chatHistory.length > 0 ||
    wb.imageDataUrls.length > 0 ||
    wb.pdfDataUrls.length > 0 ||
    wb.rawContent.trim().length > 0 ||
    wb.textInput.trim().length > 0;

  const smartBehaviorCards = useMemo<SmartPresetCard[]>(
    () =>
      displayBehaviorQuestions.map((item) => {
        const text = `${item.label} ${item.prompt}`;
        const latestDirectionLabel =
          latestTransaction && getTransactionDirection(latestTransaction) === 'inflow' ? '最近收入' : '最近支出';
        const latestNote = latestTransaction?.note?.trim()
          ? truncateAssistantText(latestTransaction.note.trim(), isMobileView ? 12 : 18)
          : '最近一笔';

        if (/预算|节流|现金流|压力|控费/.test(text)) {
          return {
            ...item,
            tag: '预算动作',
            hint:
              assistantOverview.todayNet < 0
                ? '今天净流出偏高，先抓大头支出更有效。'
                : truncateAssistantText(assistantOverview.riskAlert, isMobileView ? 24 : 34)
          };
        }

        if (/趋势|波动|最近|7天|14|复盘/.test(text)) {
          return {
            ...item,
            tag: '趋势追踪',
            hint:
              latestTransaction != null
                ? `${latestDirectionLabel}「${latestNote}」适合继续往回追。`
                : '最近账本更新后，这类问题会更容易看到变化。'
          };
        }

        if (/餐饮|交通|住房|娱乐|订阅|分类|重点看/.test(text)) {
          return {
            ...item,
            tag: '分类聚焦',
            hint: truncateAssistantText(assistantOverview.monthlySummary, isMobileView ? 24 : 34)
          };
        }

        return {
          ...item,
          tag: '动态建议',
          hint:
            assistantOverview.todayTodos.filter((todo) => (todo.count ?? 0) > 0).length > 0
              ? '我按今天最值得处理的账本问题帮你挑了一条。'
              : '这条建议会跟着最近账本变化自动更新。'
        };
      }),
    [assistantOverview, displayBehaviorQuestions, isMobileView, latestTransaction]
  );

  const assistantMascotLine = useMemo(() => {
    if (mode === 'credit') {
      return wb.semanticRecallCacheMeta.exists
        ? '把最近账单和截图丢给我，我会先把应还、待补和风险点拆成可执行顺序。'
        : '先把信用账户补齐，我再继续盯到期日、最低还款和异常账单。';
    }

    if (mode === 'bookkeeping') {
      return latestTransaction
        ? `刚刚那笔「${truncateAssistantText(latestTransaction.note || '未备注', isMobileView ? 10 : 16)}」还能继续追问，我会顺手帮你补齐分类和备注。`
        : '先随手记一笔真实流水，后面的分类、复盘和提醒都会更靠谱。';
    }

    const pendingTodos = assistantOverview.todayTodos.filter((item) => (item.count ?? 0) > 0);
    if (pendingTodos.length > 0) {
      return `${pendingTodos[0].label}还没收口，我可以先陪你把这块讲明白，再看趋势。`;
    }

    if (latestTransaction) {
      return `最近一笔是「${truncateAssistantText(
        latestTransaction.note || '未备注',
        isMobileView ? 12 : 18
      )}」，从它往回追最容易看出这阵子的消费习惯。`;
    }

    return truncateAssistantText(assistantOverview.monthlySummary, isMobileView ? 28 : 42);
  }, [assistantOverview, isMobileView, latestTransaction, mode, wb.semanticRecallCacheMeta.exists]);

  const latestContextLabel = latestTransaction
    ? getTransactionDirection(latestTransaction) === 'inflow'
      ? '最近收入'
      : '最近支出'
    : '最近一笔';

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobileView(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // 每次状态或消息变化后，自动将视图滚动到底部，保持聊天体验。
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [wb.status, wb.rawContent, wb.rawReasoning, wb.entries.length, wb.error]);

  // 当 {t('assistant.ui.assistantMode')}/AI 记账收到新的助手回复时，始终自动滚到底部。
  useEffect(() => {
    const latestMessage = chatHistory[chatHistory.length - 1];
    if (!latestMessage || latestMessage.role !== 'assistant') return;
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatHistory, mode]);

  useEffect(() => {
    if (!baseUrl || !apiKey || !model) return;
    if (!enableEmbeddingModel || !embeddingModel.trim()) return;
    if (mode === 'bookkeeping') return;

    const recentConversation = chatHistory
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .slice(-6)
      .map((item) => ({ role: item.role, text: item.text.trim() }))
      .filter((item) => item.text);

    if (recentConversation.length < 4) return;
    const assistantCount = recentConversation.filter((item) => item.role === 'assistant').length;
    const userCount = recentConversation.filter((item) => item.role === 'user').length;
    if (assistantCount < 2 || userCount < 2) return;

    const signature = recentConversation.map((item) => `${item.role}:${item.text}`).join('\n---\n');
    if (!signature || memoryExtractionSignatureRef.current[mode] === signature) return;
    memoryExtractionSignatureRef.current[mode] = signature;

    void extractGlobalMemoriesFromConversation({
      baseUrl,
      apiKey,
      model,
      embeddingModel,
      history: recentConversation,
      source: mode === 'credit' ? 'assistant_chat' : 'assistant_chat'
    })
      .then((items) => {
        if (!items.length) return;
        const existingSignatures = new Set(
          globalMemories.map((item) => `${item.type}::${item.title.trim()}::${item.content.trim()}`)
        );
        for (const item of items) {
          const key = `${item.type}::${item.title.trim()}::${item.content.trim()}`;
          if (existingSignatures.has(key)) continue;
          const result = addGlobalMemory(item);
          if (result.ok) existingSignatures.add(key);
        }
      })
      .catch(() => {
        // ignore extraction failure
      });
  }, [
    addGlobalMemory,
    apiKey,
    baseUrl,
    chatHistory,
    embeddingModel,
    enableEmbeddingModel,
    globalMemories,
    mode,
    model
  ]);

  const appendMessageToMode = useCallback(
    (targetMode: AssistantMode, message: ChatHistoryItem) => {
      if (targetMode === mode) {
        setChatHistory((prev) => [...prev, message]);
        return;
      }
      const next = [...readChatHistory(targetMode), message];
      try {
        window.sessionStorage.setItem(CHAT_HISTORY_CACHE_KEYS[targetMode], JSON.stringify(next));
      } catch {
        // ignore storage write errors
      }
    },
    [mode]
  );

  const handleSaveCreditItem = useCallback(
    (creditItem: CreditExtractedItem, strategy: 'create' | 'update' = 'create') => {
      const payload = normalizeCreditDebtPayload(creditItem);
      if (strategy === 'update' && creditItem.matchedDebtId) {
        updateDebt(creditItem.matchedDebtId, payload);
      } else {
        addDebt(payload);
      }
      setConfirmingCreditId(null);
      wb.setToastState(
        strategy === 'update'
          ? `已将“${creditItem.title}”的最新识别结果更新到现有负债`
          : creditItem.pendingFields.length > 0
            ? `已保存“${creditItem.title}”，但仍建议补充：${creditItem.pendingFields.join('、')}`
            : `已将“${creditItem.title}”保存到还款管理`,
        creditItem.pendingFields.length > 0 && strategy !== 'update' ? 'warning' : 'success'
      );
    },
    [addDebt, updateDebt, wb]
  );

  const handleDeleteMatchedDebt = useCallback(
    (creditItem: CreditExtractedItem) => {
      if (!creditItem.matchedDebtId) return;
      removeDebt(creditItem.matchedDebtId);
      wb.setToastState(`已删除“${creditItem.matchedDebtName || creditItem.title}”对应负债`, 'warning');
    },
    [removeDebt, wb]
  );

  const handleQuickRepaymentRecord = useCallback(
    (creditItem: CreditExtractedItem) => {
      if (!creditItem.matchedDebtId) {
        wb.setToastState('这张卡片还没稳定命中已保存负债，先保存或补全后再登记还款。', 'warning');
        return;
      }
      const matchedDebt = debts.find((item) => item.id === creditItem.matchedDebtId);
      if (!matchedDebt) {
        wb.setToastState('没找到对应负债，先刷新或去还款管理页核对。', 'warning');
        return;
      }
      const amountText = String(creditItem.dueAmount || '').replace(/[^\d.-]/g, '');
      const amount = Number(amountText);
      if (!Number.isFinite(amount) || amount <= 0) {
        wb.setToastState('当前应还金额还不够稳定，先补全金额后再登记还款。', 'warning');
        return;
      }
      const minimumPayment = calculateDebtMinimumPayment(matchedDebt);
      const nextBalance = Math.max(0, Number((matchedDebt.balance - amount).toFixed(2)));
      const shouldAdvancePeriod = amount >= Math.max(1, minimumPayment * 0.98);
      const nextPaidPeriods = matchedDebt.totalPeriods
        ? Math.min(matchedDebt.totalPeriods, (matchedDebt.paidPeriods || 0) + (shouldAdvancePeriod ? 1 : 0))
        : matchedDebt.paidPeriods;
      const nextRemainingMonths =
        typeof matchedDebt.remainingMonths === 'number'
          ? Math.max(0, matchedDebt.remainingMonths - (shouldAdvancePeriod ? 1 : 0))
          : matchedDebt.remainingMonths;
      const paymentAccount = creditItem.repaymentGapSummary?.paymentAccountSummary || matchedDebt.paymentAccount || undefined;

      addRepaymentRecord({
        debtId: creditItem.matchedDebtId,
        amount,
        paidAt: new Date().toISOString().slice(0, 10),
        paymentAccount,
        note: `来自 AI 信贷助手：${creditItem.title}`,
        recordMode: 'manual'
      });
      updateDebt(creditItem.matchedDebtId, {
        ...matchedDebt,
        balance: nextBalance,
        paidPeriods: nextPaidPeriods,
        remainingMonths: nextRemainingMonths,
        paymentAccount,
        repaymentRecordMode: 'manual'
      });
      wb.setToastState(`已为“${creditItem.title}”快速登记一笔 ¥${amount.toFixed(2)} 还款记录，并同步回写剩余待还`, 'success');
    },
    [addRepaymentRecord, debts, updateDebt, wb]
  );

  const buildAssistantMessageText = useCallback(
    (responseMode: AssistantMode) => {
      if (responseMode === 'bookkeeping' && wb.entries.length > 0) {
        return `这次我先帮你整理出了 ${wb.entries.length} 条可保存账单。你可以先核对、去重，再决定要不要落到账本。`;
      }
      if (responseMode === 'credit') {
        return buildCreditAssistantMessageText(wb.rawContent);
      }
      return wb.rawContent;
    },
    [wb.entries.length, wb.rawContent]
  );

  const submitPrompt = (prompt: string) => {
    const clean = prompt.trim();
    const hasAttachments = wb.imageDataUrls.length > 0 || wb.pdfDataUrls.length > 0;
    if (wb.status === 'recognizing' || (!clean && !hasAttachments)) return;

    const requestQuestion = clean || '请根据我上传的附件完成识别与提炼。';
    const requestPrompt =
      mode === 'bookkeeping'
        ? requestQuestion
        : mode === 'credit'
          ? buildCreditConversationPrompt(requestQuestion, chatHistory)
          : buildAssistantConversationPrompt(requestQuestion, chatHistory);
    const imagePayload = [...wb.imageDataUrls];
    const pdfPayload = [...wb.pdfDataUrls];

    pendingRequestModeRef.current = mode;
    setChatHistory((prev) => [
      ...prev,
      {
        id: `${Date.now()}-user`,
        role: 'user',
        text: clean || '（仅发送附件）',
        imageDataUrls: imagePayload,
        pdfDataUrls: pdfPayload
      }
    ]);
    wb.setTextInput('');
    void wb.handleRecognizeWithPrompt(requestPrompt, {
      imageDataUrls: imagePayload,
      pdfDataUrls: pdfPayload
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitPrompt(wb.textInput);
  };

  const handleSelectModel = useCallback(
    (nextModel: string) => {
      setModel(nextModel);
      if (modelPickerSource === 'command') {
        const mentionPattern = /(^|\s)@([^\s@]*)$/;
        const nextInput = wb.textInput.replace(
          mentionPattern,
          (_match, prefix) => `${prefix}@${getModelDisplayLabel(nextModel)} `
        );
        wb.setTextInput(nextInput);
        requestAnimationFrame(() => {
          wb.textareaRef.current?.focus();
        });
      }
      setModelOpen(false);
      setModelPickerSource(null);
    },
    [modelPickerSource, setModel, wb]
  );

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (modelOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Escape')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setModelOpen(false);
        setModelPickerSource(null);
      }
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!wb.canRecognize || wb.status === 'recognizing') return;
    submitPrompt(wb.textInput);
  };

  const syncTextareaHeight = useCallback(() => {
    const el = wb.textareaRef.current;
    if (!el) return;

    const isEmpty = !el.value.trim();
    const minHeight = isEmpty ? 56 : 40;
    const maxHeight = 170;

    // Reset first so it can shrink.
    el.style.height = '0px';
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [wb.textareaRef]);

  useEffect(() => {
    // Defer to ensure DOM updated with latest value.
    requestAnimationFrame(syncTextareaHeight);
  }, [syncTextareaHeight, wb.textInput]);

  useEffect(() => {
    const commandMatch = /(^|\s)@([^\s@]*)$/.exec(wb.textInput);
    if (commandMatch) {
      if (!modelOpen || modelPickerSource !== 'command') {
        setModelOpen(true);
        setModelPickerSource('command');
      }
      return;
    }

    if (modelPickerSource === 'command') {
      setModelOpen(false);
      setModelPickerSource(null);
    }
  }, [modelOpen, modelPickerSource, wb.textInput]);

  // 非记账分析时，模型返回自由文本，解析 JSON 失败属于预期，不展示底部红条。
  const shouldShowError =
    Boolean(wb.error) && !/unexpected token|invalid json|json/i.test(wb.error.toLowerCase());

  useEffect(() => {
    const responseMode = pendingRequestModeRef.current;
    if (mode !== 'bookkeeping' && wb.status === 'recognizing') {
      setStreamingPreviewMessage(wb.rawContent);
      const segments = splitStreamingSegments(wb.rawContent);
      setStreamingCommittedSegments(segments.committed);
      setStreamingDraftSegment(segments.draft);
      return;
    }

    const messageText = buildAssistantMessageText(responseMode);
    if (!messageText || messageText === lastAssistantRef.current[responseMode]) return;

    const flushedSegments = splitStreamingSegments(wb.rawContent);
    setStreamingCommittedSegments(flushedSegments.committed);
    setStreamingDraftSegment(flushedSegments.draft);
    lastAssistantRef.current[responseMode] = messageText;
    setStreamingPreviewMessage('');
    setStreamingCommittedSegments([]);
    setStreamingDraftSegment('');
    const usageText = wb.lastUsage
      ? `Token 消耗：输入 ${wb.lastUsage.promptTokens} / 输出 ${wb.lastUsage.completionTokens} / 总计 ${wb.lastUsage.totalTokens}`
      : undefined;
    const embeddingSummaryText =
      responseMode !== 'bookkeeping' && showEmbeddingSummary && wb.embeddingDebug.enabled
        ? wb.embeddingDebug.used
          ? `语义召回：命中 ${wb.embeddingDebug.hitCount} 条，最高相似度 ${wb.embeddingDebug.topScore.toFixed(2)}，平均相似度 ${wb.embeddingDebug.averageScore.toFixed(2)}，耗时 ${wb.embeddingDebug.latencyMs}ms，索引 ${wb.embeddingDebug.indexedDocs} 条。`
          : wb.embeddingDebug.downgraded
            ? `语义召回已降级：${wb.embeddingDebug.reason || '服务不可用'}（耗时 ${wb.embeddingDebug.latencyMs}ms）。`
            : `语义召回未命中可用上下文（耗时 ${wb.embeddingDebug.latencyMs}ms）。`
        : undefined;

    const embeddingDebugText =
      responseMode !== 'bookkeeping' && showEmbeddingDebug && wb.embeddingDebug.enabled
        ? [
            `模型：${wb.embeddingDebug.model || '-'} | 启用：${wb.embeddingDebug.enabled ? '是' : '否'} | 使用召回：${wb.embeddingDebug.used ? '是' : '否'} | 降级：${wb.embeddingDebug.downgraded ? '是' : '否'}`,
            `命中：${wb.embeddingDebug.hitCount} | 最高：${wb.embeddingDebug.topScore.toFixed(4)} | 平均：${wb.embeddingDebug.averageScore.toFixed(4)} | 索引：${wb.embeddingDebug.indexedDocs} | 耗时：${wb.embeddingDebug.latencyMs}ms`,
            wb.embeddingDebug.reason ? `原因：${wb.embeddingDebug.reason}` : '',
            wb.embeddingDebug.hits.length > 0
              ? `Top Hits:\n${wb.embeddingDebug.hits
                  .map((hit, idx) => `${idx + 1}. [${hit.score.toFixed(4)}] ${hit.id}`)
                  .join('\n')}`
              : ''
          ]
            .filter(Boolean)
            .join('\n')
        : undefined;
    const creditItems =
      responseMode === 'credit'
        ? enrichCreditItemsForConfirmation(
            mergeCreditItemsWithHistory(extractCreditStructuredItems(wb.rawContent), chatHistory),
            chatHistory,
            debts,
            repaymentRecords
          )
        : undefined;

    appendMessageToMode(responseMode, {
      id: `${Date.now()}-assistant`,
      role: 'assistant',
      text: messageText,
      usageText,
      reasoningText: wb.rawReasoning || undefined,
      embeddingSummaryText,
      embeddingDebugText,
      followUpPrompts:
        responseMode === 'credit'
          ? buildCreditFollowUpPrompts(creditItems || [])
          : responseMode !== 'bookkeeping'
            ? buildFollowUpPrompts(wb.rawContent, chatHistory)
            : undefined,
      creditItems
    });
  }, [
    appendMessageToMode,
    buildAssistantMessageText,
    chatHistory,
    debts,
    repaymentRecords,
    showEmbeddingDebug,
    showEmbeddingSummary,
    wb.embeddingDebug,
    wb.lastUsage,
    wb.rawContent,
    wb.rawReasoning,
    wb.status
  ]);

  const removeMessage = (id: string) =>
    setChatHistory((prev) => prev.filter((item) => item.id !== id));

  const retryMessage = (index: number) => {
    const previousUser = [...chatHistory]
      .slice(0, index)
      .reverse()
      .find((item) => item.role === 'user');
    if (!previousUser) return;
    wb.setTextInput(previousUser.text === '（仅发送附件）' ? '' : previousUser.text);
    wb.setImageDataUrls(previousUser.imageDataUrls || []);
    wb.setPdfDataUrls(previousUser.pdfDataUrls || []);
    submitPrompt(previousUser.text === '（仅发送附件）' ? '' : previousUser.text);
  };

  const retryLastPrompt = () => {
    const latestUser = [...chatHistory].reverse().find((item) => item.role === 'user');
    if (!latestUser) return;
    wb.setTextInput(latestUser.text === '（仅发送附件）' ? '' : latestUser.text);
    wb.setImageDataUrls(latestUser.imageDataUrls || []);
    wb.setPdfDataUrls(latestUser.pdfDataUrls || []);
    submitPrompt(latestUser.text === '（仅发送附件）' ? '' : latestUser.text);
  };

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      wb.setToastState('已复制到剪贴板', 'success');
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        wb.setToastState('已复制到剪贴板', 'success');
      } catch {
        wb.setToastState('复制失败，请手动复制', 'error');
      }
      document.body.removeChild(textarea);
    }
  };

  const todayLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date());

  const aiRequestContextRef = useRef({ baseUrl, apiKey, model });

  useEffect(() => {
    aiRequestContextRef.current = { baseUrl, apiKey, model };
  }, [apiKey, baseUrl, model]);

  const loadPersonalizedQuestions = useCallback(
    async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
      const signature = buildPresetQuestionsSignature(transactions, categories);
      const fallback = () => {
        const local = buildLocalPresetQuestions(transactions, categories);
        setPresetQuestions(local);
        writePresetQuestionsCache(
          signature,
          local.map((item) => ({ label: item.label, prompt: item.prompt }))
        );
      };

      if (!forceRefresh) {
        const cached = readPresetQuestionsCache(signature);
        if (cached) {
          setPresetQuestions(withPresetIds(cached, 'preset-cache'));
          return;
        }
      }

      const {
        baseUrl: currentBaseUrl,
        apiKey: currentApiKey,
        model: currentModel
      } = aiRequestContextRef.current;

      if (!currentApiKey || !currentModel) {
        fallback();
        return;
      }

      setLoadingPresets(true);
      try {
        const snapshot = transactions
          .slice(-120)
          .map((item) => ({
            type: item.type,
            amount: item.amount,
            date: item.date,
            note: item.note,
            categoryId: item.categoryId
          }))
          .sort((a, b) => +new Date(b.date) - +new Date(a.date));
        const categoryMap = categories.map((item) => ({ id: item.id, name: item.name }));
        const randomSeed = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
        const reply = await sendAiChat({
          baseUrl: currentBaseUrl,
          apiKey: currentApiKey,
          model: currentModel,
          systemPrompt:
            '你是记账系统中的数据分析助手。请基于用户账单快照一次性生成 4 条快捷提问。每条都要返回 label 和 prompt：label 供 UI 展示（8-16字，像按钮标题），prompt 是实际发送给模型的完整指令（更宽泛、包含分析目标与输出要求，不能与 label 相同）。仅返回 JSON 数组，格式：[{"label":"...","prompt":"..."}]，不要输出其他文本。',
          messages: [
            {
              role: 'user',
              text: `随机种子: ${randomSeed}
分类映射: ${JSON.stringify(categoryMap)}
最近账单: ${JSON.stringify(snapshot)}`
            }
          ]
        });

        const normalized = reply.content
          .trim()
          .replace(/^```json\s*/i, '')
          .replace(/```$/, '');
        const parsed = JSON.parse(normalized) as unknown;
        if (!Array.isArray(parsed) || parsed.length < 2) {
          fallback();
          return;
        }
        const list = parsed
          .filter(
            (item): item is { label: string; prompt: string } =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as { label?: string }).label === 'string' &&
              typeof (item as { prompt?: string }).prompt === 'string'
          )
          .map((item) => ({ label: item.label.trim(), prompt: item.prompt.trim() }))
          .filter((item) => item.label && item.prompt && item.label !== item.prompt)
          .slice(0, 4);

        const nextQuestions =
          list.length >= 2
            ? [...ANALYSIS_SHORTCUT_SEEDS, ...list]
            : buildLocalPresetQuestions(transactions, categories).map((item) => ({
                label: item.label,
                prompt: item.prompt
              }));

        setPresetQuestions(withPresetIds(nextQuestions, 'preset'));
        writePresetQuestionsCache(signature, nextQuestions);
      } catch {
        fallback();
      } finally {
        setLoadingPresets(false);
      }
    },
    [categories, transactions]
  );

  useEffect(() => {
    void loadPersonalizedQuestions();
  }, [loadPersonalizedQuestions]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ASSISTANT_ACTIVE_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage write errors
    }

    window.dispatchEvent(new CustomEvent(ASSISTANT_MODE_CHANGED_EVENT, { detail: { mode } }));
  }, [mode]);

  useEffect(() => {
    if (!hasInitializedModeHistoryRef.current) {
      hasInitializedModeHistoryRef.current = true;
      activeHistoryModeRef.current = mode;
      return;
    }

    const previousMode = activeHistoryModeRef.current;
    if (previousMode !== mode) {
      try {
        window.sessionStorage.setItem(
          CHAT_HISTORY_CACHE_KEYS[previousMode],
          JSON.stringify(chatHistory)
        );
      } catch {
        // ignore storage write errors
      }
    }

    activeHistoryModeRef.current = mode;
    skipHistoryPersistRef.current = true;
    setChatHistory(readChatHistory(mode));
  }, [mode]);

  useEffect(() => {
    if (skipHistoryPersistRef.current) {
      skipHistoryPersistRef.current = false;
      return;
    }

    try {
      window.sessionStorage.setItem(CHAT_HISTORY_CACHE_KEYS[activeHistoryModeRef.current], JSON.stringify(chatHistory));
    } catch {
      // ignore storage write errors
    }
  }, [chatHistory]);

  return (
    <div
      className="chat-fullscreen"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void wb.handleDropImage(e)}
    >
      <header className="chat-topbar">
        <div className="chat-topbar-left">
          <div className="chat-topbar-title-group">
            <span className="chat-topbar-title">{currentModeLabel}</span>
          </div>
        </div>

        <div className="chat-mode-switch" aria-label="模式切换">
          <button
            type="button"
            className={mode === 'bookkeeping' ? 'active' : ''}
            onClick={() => setMode('bookkeeping')}
          >
            {t('assistant.ui.bookkeepingMode')}
          </button>
          <button
            type="button"
            className={mode === 'assistant' ? 'active' : ''}
            onClick={() => setMode('assistant')}
          >
            {t('assistant.ui.assistantMode')}
          </button>
          <button
            type="button"
            className={mode === 'credit' ? 'active' : ''}
            onClick={() => setMode('credit')}
          >
            {t('assistant.ui.creditMode')}
          </button>
        </div>

        <div className="chat-topbar-right">
          {mode !== 'bookkeeping' && wb.semanticRecallCacheMeta.exists ? (
            <button
              type="button"
              className="chat-icon-topbar-btn"
              onClick={() => setSemanticPanelOpen(true)}
              aria-label="语义召回"
              title={`语义召回 · ${wb.semanticRecallCacheMeta.indexedDocs} 条`}
            >
              语
            </button>
          ) : null}
          <button
            type="button"
            className={`chat-icon-topbar-btn chat-wide-toggle ${isWideLayout ? 'is-active' : ''}`}
            onClick={() => setIsWideLayout((prev) => !prev)}
            aria-label={isWideLayout ? '切换为标准宽度' : '拉伸显示'}
            title={isWideLayout ? '切换为标准宽度' : '拉伸显示'}
          >
            {isWideLayout ? '↔' : '⤢'}
          </button>
        </div>
      </header>

      <section className={`chat-messages-area ${isWideLayout ? 'is-wide' : ''}`}>
        <div className={`chat-messages-inner ${isWideLayout ? 'is-wide' : ''}`}>
          {!wb.hasApiKey ? (
            <section className="chat-key-required">
              <h3>{t('assistant.ui.needApiKeyTitle')}</h3>
              <p>{t('assistant.ui.needApiKeyDesc')}</p>
              <Link className="chat-key-required-link" to="/settings">
                {t('assistant.ui.goSettings')}
              </Link>
            </section>
          ) : null}

          {mode === 'bookkeeping' ? (
            <section className="chat-kawaii-panel">
              <div className="chat-kawaii-topline">今天 {todayLabel}</div>
              <div className="chat-kawaii-amount">¥0.00</div>
              <div className="chat-kawaii-sub">本轮准备记账 · 一句话也能生成账单，主打一个不拖延 ✨</div>
              <div className="chat-kawaii-mascot" aria-hidden>
                <span>૮₍ ˶•⤙•˶ ₎ა</span>
                <small>来嘛来嘛，点我就能秒记账～我很快，你别怕。</small>
              </div>
            </section>
          ) : mode === 'credit' ? (
            <section className="chat-kawaii-panel chat-assistant-panel chat-credit-panel">
              <div className="chat-assistant-layout">
                <div className="chat-assistant-layout-main">
                  <div className="chat-assistant-hero">
                    <h2>💳 你好，我是你的 AI 信贷管家</h2>
                    <p>贷款、花呗、分期、信用账单都可以丢给我。我先帮你把“到底欠什么、先还什么、哪里还没补齐”讲明白。</p>
                  </div>
                  {hasCreditContextContent ? (
                    <div className="chat-insight-section" aria-label="优先处理">
                      <div className="chat-insight-section-head">
                        <h3>🧭 优先处理</h3>
                        <span>应还 / 待核对 / 风险点</span>
                      </div>
                      <div className="chat-push-insights">
                        <article className="chat-push-insight-item warning">
                          <h4>先把本月应还摸清</h4>
                          <p>你可以直接贴花呗、信用卡分期、消费贷截图，我先帮你提炼应还金额、还款日和剩余期数。</p>
                        </article>
                        <article className="chat-push-insight-item">
                          <h4>把模糊负债说清楚</h4>
                          <p>如果你只记得“大概有几笔分期”，也没关系，我会先帮你整理成待补充清单。</p>
                        </article>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="chat-preset-list">
                {displayPresetQuestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="chat-preset-item"
                    onClick={() => submitPrompt(item.prompt)}
                    disabled={wb.status === 'recognizing'}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="chat-kawaii-mascot" aria-hidden>
                <span>💳</span>
                <small>别怕数字绕，你先把截图甩过来，我负责把“这笔到底算什么”翻译清楚。</small>
              </div>
            </section>
          ) : (
            <section className="chat-kawaii-panel chat-assistant-panel">
              <div className="chat-assistant-layout">
                <div className="chat-assistant-layout-main">
                  <div className="chat-assistant-hero">
                    <h2>🤖 你好，我是你的财务助手</h2>
                    <p>先看关键数据，再像聊天一样提问。我会尽量把复杂数字翻译成能马上动手的建议。</p>
                  </div>
                  <div className="chat-insight-section" aria-label="今日要做">
                    <div className="chat-insight-section-head">
                      <h3>🗓 今日要做</h3>
                      <span>提醒 / 风险 / 待处理</span>
                    </div>
                    {assistantOverview.todayTodos.filter((item) => (item.count ?? 0) > 0).length > 0 ? (
                      <div className="chat-push-insights">
                        {assistantOverview.todayTodos
                          .filter((item) => (item.count ?? 0) > 0)
                          .map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`chat-push-insight-item ${item.level === 'warning' ? 'warning' : ''}`}
                              onClick={() => item.href && navigate(item.href)}
                            >
                              <div className="chat-push-insight-top">
                                <h4>{item.label}</h4>
                                {item.statusLabel ? (
                                  <span className="chat-push-insight-tag">{item.statusLabel}</span>
                                ) : null}
                              </div>
                              <p>{item.detail}</p>
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>

                </div>

                <div className="chat-assistant-layout-side">
                  <div className="chat-insight-section" aria-label="本月总结">
                    <div className="chat-insight-section-head">
                      <h3>📈 本月总结</h3>
                      <span>趋势 / 对比 / 结构</span>
                    </div>
                    <div className="chat-auto-insight-block">
                      <p>
                        <strong>本月消费总结：</strong>
                        {assistantOverview.monthlySummary}
                      </p>
                      <p>
                        <strong>收入趋势变化：</strong>
                        {assistantOverview.incomeTrend}
                      </p>
                      <p>
                        <strong>异常支出提醒：</strong>
                        {assistantOverview.abnormalReminder}
                      </p>
                    </div>
                    <div className="chat-insight-list" aria-label="本月洞察列表">
                      {assistantOverview.monthlyInsights.map((insight) => (
                        <p key={insight}>💡 {insight}</p>
                      ))}
                      <p className="chat-risk-alert">⚠️ {assistantOverview.riskAlert}</p>
                    </div>
                  </div>

                  <div className="chat-insight-section" aria-label="主动洞察推送">
                    <div className="chat-insight-section-head">
                      <h3>🧭 主动洞察</h3>
                      <span>系统持续追踪</span>
                    </div>
                    <div className="chat-push-insights" aria-label="主动洞察推送">
                      {assistantOverview.pushInsights.map((item) => (
                        <article
                          key={item.id}
                          className={`chat-push-insight-item ${item.level === 'warning' ? 'warning' : ''}`}
                        >
                          <h4>{item.title}</h4>
                          <p>{item.detail}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="chat-preset-head">
                <strong>智能场景提问</strong>
                <button
                  type="button"
                  onClick={() => void loadPersonalizedQuestions({ forceRefresh: true })}
                >
                  {loadingPresets ? '生成中...' : '换一批'}
                </button>
              </div>
              <div className="chat-preset-list chat-preset-list-smart">
                {smartBehaviorCards.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="chat-preset-item chat-preset-item-smart"
                    onClick={() => submitPrompt(item.prompt)}
                    disabled={wb.status === 'recognizing'}
                  >
                    <span className="chat-preset-item-tag">{item.tag}</span>
                    <strong>{item.label}</strong>
                    <small className="chat-preset-item-meta">{item.hint}</small>
                  </button>
                ))}
              </div>
              <div className="chat-preset-list">
                {displayPresetQuestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="chat-preset-item"
                    onClick={() => submitPrompt(item.prompt)}
                    disabled={wb.status === 'recognizing'}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="chat-kawaii-mascot" aria-hidden>
                <span>🧾</span>
                <small>{assistantMascotLine}</small>
              </div>
            </section>
          )}

          <article className="chat-msg">
            <div className="chat-msg-avatar">🤖</div>
            <div className="chat-msg-body">
              <div className="chat-msg-header">
                {mode === 'bookkeeping'
                  ? t('assistant.ui.bookkeepingAssistant')
                  : mode === 'credit'
                    ? 'AI 信贷管家'
                    : t('assistant.ui.qaAssistant')}
              </div>
              <div className="chat-msg-content">
                <p>
                  {mode === 'assistant'
                    ? `今天 ${todayLabel}，我已经把重点线索铺在上面了。你尽管问，我来负责把账本里的脾气翻译成人话。`
                    : mode === 'credit'
                      ? '把花呗、分期、贷款或信用账单交给我，我先帮你拆出应还金额、时间点和待补信息。'
                      : '输入一句话或贴截图，我会帮你快速生成可保存账单。能省几步就省几步。'}
                </p>
              </div>
            </div>
          </article>

          {mode === 'credit' && debts.length > 0 ? (
            <article className="chat-msg">
              <div className="chat-msg-avatar">📊</div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">信贷汇总快照</div>
                <div className="chat-credit-overview-card">
                  <div className="chat-credit-overview-grid">
                    <div>
                      <span>当前总欠款</span>
                      <strong>¥{creditOverview.totalDebt.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>本月总应还</span>
                      <strong>¥{creditOverview.totalDueThisMonth.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>本月已还</span>
                      <strong>¥{creditOverview.totalPaidThisMonth.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>当前还差</span>
                      <strong>¥{creditOverview.currentGap.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>最低还款合计</span>
                      <strong>¥{creditOverview.totalMinimumPayment.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>剩余利息估算</span>
                      <strong>¥{creditOverview.totalRemainingInterest.toFixed(2)}</strong>
                    </div>
                  </div>
                  {creditOverview.dueSoonItems.length > 0 ? (
                    <div className="chat-credit-overview-due-list">
                      {creditOverview.dueSoonItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="chat-credit-overview-due-chip"
                          onClick={() => navigate('/repayment-management')}
                        >
                          {item.name} · {item.repaymentDay}日 · ¥{item.minimumPayment.toFixed(0)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="chat-credit-actions">
                    <button
                      type="button"
                      className="chat-secondary-action-btn"
                      onClick={() => navigate('/repayment-management')}
                    >
                      去看完整台账
                    </button>
                    <button
                      type="button"
                      className="chat-secondary-action-btn"
                      onClick={() => submitPrompt('帮我看本月总应还、已还多少、还差多少，并指出最值得先处理的项目')}
                    >
                      继续做汇总分析
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ) : null}

          {chatHistory.map((item, index) => (
            <article
              key={item.id}
              className={`chat-msg ${item.role === 'user' ? 'chat-msg-user' : ''}`}
            >
              <div className="chat-msg-avatar">{item.role === 'user' ? '🙂' : '🤖'}</div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">{item.role === 'user' ? '你' : '助手'}</div>
                <div className="chat-msg-content chat-msg-content-rich">
                  {renderMarkdownContent(item.text)}
                </div>
                {item.role === 'user' &&
                ((item.imageDataUrls && item.imageDataUrls.length > 0) ||
                  (item.pdfDataUrls && item.pdfDataUrls.length > 0)) ? (
                  <div className="chat-image-strip chat-msg-attachments">
                    <div className="chat-thumb-list">
                      {(item.imageDataUrls || []).map((url, idx) => (
                        <div className="chat-thumb-item" key={`sent-img-${item.id}-${idx}`}>
                          <img className="chat-thumb" src={url} alt={`发送图片${idx + 1}`} />
                        </div>
                      ))}
                      {(item.pdfDataUrls || []).map((url, idx) => (
                        <div
                          className="chat-thumb-item"
                          key={`sent-pdf-${item.id}-${idx}-${url.slice(0, 12)}`}
                        >
                          <div
                            className="chat-thumb"
                            style={{ display: 'grid', placeItems: 'center' }}
                          >
                            📄 PDF
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {item.role === 'assistant' && item.creditItems && item.creditItems.length > 0 ? (
                  <div className="chat-credit-cards">
                    {enrichCreditItemsForConfirmation(item.creditItems, chatHistory, debts, repaymentRecords).map((creditItem) => (
                      <section key={creditItem.id} className="chat-credit-card">
                        <div className="chat-credit-card-head">
                          <div>
                            <strong>{creditItem.title}</strong>
                            <span>{creditItem.productType}</span>
                          </div>
                          <div className="chat-credit-card-head-meta">
                            {creditItem.mergedFromHistory ? <span className="chat-credit-progress-tag">已承接上轮补充</span> : null}
                            <em className={`chat-credit-confidence is-${creditItem.confidence}`}>
                              {creditItem.confidence === 'high'
                                ? '高置信'
                                : creditItem.confidence === 'low'
                                  ? '低置信'
                                  : '中置信'}
                            </em>
                          </div>
                        </div>
                        <div className="chat-credit-progress" aria-label="字段补全进度">
                          <div className="chat-credit-progress-head">
                            <span>{creditItem.completionLabel || '0/6 关键字段已补齐'}</span>
                            <strong>{creditItem.completionRatio || 0}%</strong>
                          </div>
                          <div className="chat-credit-progress-track">
                            <span style={{ width: `${creditItem.completionRatio || 0}%` }} />
                          </div>
                          {creditItem.bindingProgressText ? (
                            <div className="chat-credit-binding-note">
                              <strong>{creditItem.draftCreditId || creditItem.identityKey}</strong>
                              <span>{creditItem.bindingProgressText}</span>
                              {creditItem.matchReason ? <small>{creditItem.matchReason}</small> : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="chat-credit-grid">
                          {renderCreditField('当前应还', creditItem.dueAmount, creditItem.fieldMeta?.dueAmount)}
                          {renderCreditField('剩余待还', creditItem.totalDebt, creditItem.fieldMeta?.totalDebt)}
                          {renderCreditField('还款日', creditItem.repaymentDate, creditItem.fieldMeta?.repaymentDate)}
                          {renderCreditField('剩余期数', creditItem.remainingPeriods, creditItem.fieldMeta?.remainingPeriods)}
                          {renderCreditField('每期金额', creditItem.monthlyAmount, creditItem.fieldMeta?.monthlyAmount)}
                          {renderCreditField('利息/费率', creditItem.interest, creditItem.fieldMeta?.interest)}
                        </div>
                        {creditItem.rateType || creditItem.rateSource || creditItem.riskHint || creditItem.actionSuggestion ? (
                          <div className="chat-credit-pending" style={{ marginTop: 10 }}>
                            {creditItem.rateType || creditItem.rateSource ? (
                              <div>
                                <span>利率口径：</span>
                                <strong>
                                  {creditItem.rateType || '待确认'}
                                  {creditItem.rateSource === 'explicit'
                                    ? ' · 明确值'
                                    : creditItem.rateSource === 'inferred'
                                      ? ' · 推测值'
                                      : creditItem.rateSource === 'pending'
                                        ? ' · 待确认'
                                        : ''}
                                </strong>
                              </div>
                            ) : null}
                            {creditItem.riskHint ? (
                              <div style={{ marginTop: 6 }}>
                                <span>风险提示：</span>
                                <strong>{creditItem.riskHint}</strong>
                              </div>
                            ) : null}
                            {creditItem.actionSuggestion ? (
                              <div style={{ marginTop: 6 }}>
                                <span>下一步：</span>
                                <strong>{creditItem.actionSuggestion}</strong>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {creditItem.repaymentLookupSummary ? (
                          <div className="chat-credit-lookup-card">
                            <div className="chat-credit-lookup-head">
                              <div className="chat-credit-lookup-title-block">
                                <strong>还款检索结果</strong>
                                <span>{creditItem.repaymentLookupSummary.matchedDebtName || '未稳定命中已保存负债'}</span>
                              </div>
                              <em className="chat-credit-lookup-status">
                                {creditItem.repaymentLookupSummary.recordStatusText || '待确认'}
                              </em>
                            </div>
                            <div className="chat-credit-lookup-grid">
                              <div>
                                <span>计划中的应还</span>
                                <strong>{creditItem.repaymentLookupSummary.plannedRepaymentText || '待确认'}</strong>
                              </div>
                              <div>
                                <span>计划 / 实际账户</span>
                                <strong>{creditItem.repaymentLookupSummary.paymentAccountText || '待确认'}</strong>
                              </div>
                              <div>
                                <span>最近已还流水</span>
                                <strong>{creditItem.repaymentLookupSummary.actualRepaymentText || '暂无命中'}</strong>
                              </div>
                              <div>
                                <span>流水状态</span>
                                <strong>{creditItem.repaymentLookupSummary.recordStatusText || '待确认'}</strong>
                              </div>
                            </div>
                            {creditItem.repaymentLookupSummary.lookupHint ? (
                              <div className="chat-credit-lookup-hint">{creditItem.repaymentLookupSummary.lookupHint}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {creditItem.repaymentGapSummary ? (
                          <div className="chat-credit-gap-card">
                            <div className="chat-credit-gap-head">
                              <strong>计划 vs 实际</strong>
                              <span>{creditItem.repaymentGapSummary.statusText || '先看有没有缺口'}</span>
                            </div>
                            <div className="chat-credit-gap-grid">
                              <div>
                                <span>计划应还</span>
                                <strong>{creditItem.repaymentGapSummary.plannedDueAmount || '待确认'}</strong>
                              </div>
                              <div>
                                <span>最近已还</span>
                                <strong>{creditItem.repaymentGapSummary.recentActualPaidAmount || '暂无记录'}</strong>
                              </div>
                              <div>
                                <span>当前还差</span>
                                <strong>{creditItem.repaymentGapSummary.gapAmount || '0'}</strong>
                              </div>
                              <div>
                                <span>扣款/还款账户</span>
                                <strong>{creditItem.repaymentGapSummary.paymentAccountSummary || '待确认'}</strong>
                              </div>
                            </div>
                            {creditItem.repaymentGapSummary.explanationItems && creditItem.repaymentGapSummary.explanationItems.length > 0 ? (
                              <div className="chat-credit-gap-points">
                                {creditItem.repaymentGapSummary.explanationItems.map((point: string) => (
                                  <span key={`${creditItem.id}-${point}`}>{point}</span>
                                ))}
                              </div>
                            ) : null}
                            <div className="chat-credit-gap-reason">
                              {creditItem.repaymentGapSummary.gapReason}
                            </div>
                            {creditItem.repaymentGapSummary.shortfallAction ? (
                              <div className="chat-credit-gap-action">{creditItem.repaymentGapSummary.shortfallAction}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {(creditItem.confirmationState === 'ready' || confirmingCreditId === creditItem.id) ? (
                          <div className="chat-credit-confirmation">
                            <div className="chat-credit-confirmation-head">
                              <strong>保存前确认</strong>
                              <span>
                                {creditItem.pendingFields.length === 0 ? '字段基本齐全' : '建议确认后再保存'}
                              </span>
                            </div>
                            <div className="chat-credit-confirmation-list">
                              {(creditItem.confirmationSummary || []).map((row) => (
                                <div key={`${creditItem.id}-${row}`} className="chat-credit-confirmation-row">{row}</div>
                              ))}
                            </div>
                            {creditItem.conflictHint ? (
                              <div className="chat-credit-conflict-hint">{creditItem.conflictHint}</div>
                            ) : null}
                            {creditItem.conflictFields && creditItem.conflictFields.length > 0 ? (
                              <div className="chat-credit-diff-card">
                                <div className="chat-credit-diff-head">
                                  <strong>与已保存负债的差异</strong>
                                  <span>{creditItem.matchedDebtName || '已有负债'}</span>
                                </div>
                                <div className="chat-credit-diff-list">
                                  {creditItem.conflictFields.map((field) => (
                                    <div key={`${creditItem.id}-${field.label}`} className="chat-credit-diff-row">
                                      <span>{field.label}</span>
                                      <div>
                                        <em>当前：{field.currentValue}</em>
                                        <strong>识别：{field.nextValue}</strong>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <div className="chat-credit-actions">
                              {creditItem.matchedDebtId && creditItem.conflictFields && creditItem.conflictFields.length > 0 ? (
                                <button
                                  type="button"
                                  className="chat-secondary-action-btn"
                                  onClick={() => handleSaveCreditItem(creditItem, 'update')}
                                >
                                  更新已有负债
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="chat-secondary-action-btn"
                                  onClick={() => handleSaveCreditItem(creditItem)}
                                >
                                  确认保存到还款管理
                                </button>
                              )}
                              <button
                                type="button"
                                className="chat-secondary-action-btn"
                                onClick={() =>
                                  navigate('/repayment-management', {
                                    state: {
                                      prefillDebt: mapCreditItemToRepaymentPrefill(creditItem)
                                    }
                                  })
                                }
                              >
                                继续补充后保存
                              </button>
                              <button
                                type="button"
                                className="chat-secondary-action-btn"
                                onClick={() => {
                                  setConfirmingCreditId(null);
                                  handleSaveCreditItem({
                                    ...creditItem,
                                    matchedDebtId: undefined,
                                    matchedDebtName: undefined,
                                    conflictFields: undefined,
                                    conflictHint: undefined
                                  });
                                  wb.setToastState('已按新项目另存，不与已有负债自动合并。', 'warning');
                                }}
                              >
                                另存为新负债
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <div className="chat-credit-actions">
                          <button
                            type="button"
                            className="chat-secondary-action-btn"
                            onClick={() => {
                              if (creditItem.confirmationState === 'ready') {
                                setConfirmingCreditId(creditItem.id);
                                return;
                              }
                              handleSaveCreditItem(creditItem);
                            }}
                          >
                            {creditItem.confirmationState === 'ready'
                              ? '进入保存前确认'
                              : creditItem.pendingFields.length > 0
                                ? '先保存，后续补充'
                                : '保存到还款管理'}
                          </button>
                          <button
                            type="button"
                            className="chat-secondary-action-btn"
                            onClick={() =>
                              navigate('/repayment-management', {
                                state: {
                                  prefillDebt: mapCreditItemToRepaymentPrefill(creditItem),
                                  editingDebtId: creditItem.matchedDebtId
                                }
                              })
                            }
                          >
                            {creditItem.matchedDebtId ? '编辑这笔负债' : creditItem.pendingFields.length > 0 ? '去补充后保存' : '带去还款管理'}
                          </button>
                          {creditItem.matchedDebtId ? (
                            <>
                              <button
                                type="button"
                                className="chat-secondary-action-btn"
                                onClick={() => handleQuickRepaymentRecord(creditItem)}
                              >
                                快速登记已还
                              </button>
                              <button
                                type="button"
                                className="chat-secondary-action-btn danger"
                                onClick={() => handleDeleteMatchedDebt(creditItem)}
                              >
                                删除这笔负债
                              </button>
                            </>
                          ) : null}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}
                {item.role === 'assistant' && item.reasoningText ? (
                  <details className="chat-reasoning-collapse">
                    <summary>模型思考过程（点击展开）</summary>
                    <pre>{item.reasoningText}</pre>
                  </details>
                ) : null}
                {item.role === 'assistant' && item.embeddingSummaryText ? (
                  <p className="chat-token-usage">{item.embeddingSummaryText}</p>
                ) : null}
                {item.role === 'assistant' && item.followUpPrompts && item.followUpPrompts.length > 0 ? (
                  <div className="chat-follow-up-block">
                    <span className="chat-follow-up-title">你可以顺手继续问：</span>
                    <div className="chat-follow-up-list">
                      {item.followUpPrompts.map((prompt) => (
                        <button
                          key={`${item.id}-${prompt}`}
                          type="button"
                          className="chat-follow-up-chip"
                          onClick={() => submitPrompt(prompt)}
                          disabled={wb.status === 'recognizing'}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {item.usageText ? <p className="chat-token-usage">{item.usageText}</p> : null}
                <div className="chat-message-actions">
                  <button
                    type="button"
                    className="chat-icon-action-btn"
                    onClick={() => removeMessage(item.id)}
                    aria-label="删除消息"
                    title="删除消息"
                  >
                    🗑️
                  </button>
                  <button
                    type="button"
                    className="chat-icon-action-btn"
                    onClick={() => copyMessage(item.text)}
                    aria-label="复制消息"
                    title="复制消息"
                  >
                    📋
                  </button>
                  {item.role === 'user' ? (
                    <button
                      type="button"
                      className="chat-icon-action-btn"
                      onClick={() => retryMessage(index + 1)}
                      disabled={wb.status === 'recognizing'}
                      aria-label="重新生成"
                      title="重新生成"
                    >
                      ↻
                    </button>
                  ) : null}
                  {item.role === 'assistant' ? (
                    <button
                      type="button"
                      className="chat-icon-action-btn"
                      onClick={() => retryMessage(index)}
                      disabled={wb.status === 'recognizing'}
                      aria-label="重新生成"
                      title="重新生成"
                    >
                      ↻
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}

          {selectedValidEntries.length > 0 ? (
            <article className="chat-msg">
              <div className="chat-msg-avatar">✅</div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">识别结果</div>
                <BillPreviewCard
                  entries={wb.entries}
                  duplicateCount={duplicateEntriesCount}
                  onCheckDuplicates={wb.checkDuplicates}
                  onSave={startDuplicateReview}
                  onCreateSubscription={handleCreateSubscriptionFromEntry}
                />
              </div>
            </article>
          ) : null}

          {streamingPreviewMessage ? (
            <article className="chat-msg">
              <div className="chat-msg-avatar">🤖</div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">助手（正在生成）</div>
                {mode === 'credit' ? (() => {
                  const previewItems = extractStreamingCreditPreview(streamingPreviewMessage);
                  return previewItems.length > 0 ? (
                    <div className="chat-credit-cards chat-credit-cards-skeleton">
                      {previewItems.map((creditItem) => (
                        <section key={creditItem.id} className="chat-credit-card chat-credit-card-skeleton is-preview">
                          <div className="chat-credit-card-head">
                            <div>
                              <strong>{creditItem.title}</strong>
                              <span>{creditItem.productType}</span>
                            </div>
                            <em className={`chat-credit-confidence is-${creditItem.confidence}`}>流式预览</em>
                          </div>
                          <div className="chat-credit-grid">
                            <div>
                              <span>当前应还</span>
                              <strong>{creditItem.dueAmount || '识别中'}</strong>
                            </div>
                            <div>
                              <span>剩余待还</span>
                              <strong>{creditItem.totalDebt || '识别中'}</strong>
                            </div>
                            <div>
                              <span>还款日</span>
                              <strong>{creditItem.repaymentDate || '识别中'}</strong>
                            </div>
                            <div>
                              <span>剩余期数</span>
                              <strong>{creditItem.remainingPeriods || '识别中'}</strong>
                            </div>
                            <div>
                              <span>每期金额</span>
                              <strong>{creditItem.monthlyAmount || '识别中'}</strong>
                            </div>
                            <div>
                              <span>利息/费率</span>
                              <strong>{creditItem.interest || '识别中'}</strong>
                            </div>
                          </div>
                          {creditItem.riskHint || creditItem.actionSuggestion || creditItem.pendingFields.length > 0 ? (
                            <div className="chat-credit-pending">
                              {creditItem.riskHint ? (
                                <div>
                                  <span>风险提示：</span>
                                  <strong>{creditItem.riskHint}</strong>
                                </div>
                              ) : null}
                              {creditItem.actionSuggestion ? (
                                <div>
                                  <span>下一步：</span>
                                  <strong>{creditItem.actionSuggestion}</strong>
                                </div>
                              ) : null}
                              {creditItem.pendingFields.length > 0 ? (
                                <div className="chat-credit-pending-list">
                                  {creditItem.pendingFields.map((field) => (
                                    <span key={`${creditItem.id}-${field}`}>{field}</span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="chat-credit-lookup-card chat-credit-preview-block">
                            <div className="chat-credit-lookup-head">
                              <div className="chat-credit-lookup-title-block">
                                <strong>还款检索结果</strong>
                                <span>计划 / 账户 / 流水检索中</span>
                              </div>
                              <em className="chat-credit-lookup-status">预加载中</em>
                            </div>
                            <div className="chat-credit-lookup-grid">
                              <div>
                                <span>计划中的应还</span>
                                <strong>检索中</strong>
                              </div>
                              <div>
                                <span>计划 / 实际账户</span>
                                <strong>检索中</strong>
                              </div>
                              <div>
                                <span>最近已还流水</span>
                                <strong>检索中</strong>
                              </div>
                              <div>
                                <span>流水状态</span>
                                <strong>等待串联</strong>
                              </div>
                            </div>
                            <div className="chat-credit-lookup-hint">先把台账骨架亮出来，正文和检索结果会继续补齐。</div>
                          </div>
                          <div className="chat-credit-gap-card chat-credit-preview-block">
                            <div className="chat-credit-gap-head">
                              <strong>计划 vs 实际</strong>
                              <span>差异分析预加载中</span>
                            </div>
                            <div className="chat-credit-gap-grid">
                              <div>
                                <span>计划应还</span>
                                <strong>检索中</strong>
                              </div>
                              <div>
                                <span>最近已还</span>
                                <strong>检索中</strong>
                              </div>
                              <div>
                                <span>当前还差</span>
                                <strong>待计算</strong>
                              </div>
                              <div>
                                <span>扣款/还款账户</span>
                                <strong>待串联</strong>
                              </div>
                            </div>
                            <div className="chat-credit-gap-reason">流式阶段先展示台账卡片骨架，等模型继续输出后再补全差额原因。</div>
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : renderCreditCardSkeleton(2);
                })() : null}
                <div className="chat-msg-content chat-msg-content-rich chat-msg-content-streaming">
                  {streamingCommittedSegments.map((segment, index) => (
                    <div key={`stream-segment-${index}`} className="chat-stream-segment">
                      {renderMarkdownContent(segment)}
                    </div>
                  ))}
                  {streamingDraftSegment ? (
                    <div className="chat-stream-draft">{renderMarkdownContent(streamingDraftSegment)}</div>
                  ) : null}
                </div>
              </div>
            </article>
          ) : null}

          {wb.status === 'recognizing' ? (
            <article className="chat-msg">
              <div className="chat-msg-avatar">🤖</div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">助手</div>
                <div className="chat-typing">
                  模型思考中<span className="dot1">.</span>
                  <span className="dot2">.</span>
                  <span className="dot3">.</span>
                </div>
              </div>
            </article>
          ) : null}

          {wb.status === 'saved' ? (
            <article className="chat-msg">
              <div className="chat-msg-avatar">✅</div>
              <div className="chat-msg-body">
                <div className="chat-msg-header">系统</div>
                <div className="chat-auto-card">
                  <strong>账单已保存到账本。</strong>
                </div>
              </div>
            </article>
          ) : null}

          <div ref={messageEndRef} />
        </div>
      </section>

      <section className="chat-input-bar">
        {shouldShowError ? (
          <div className="chat-error-strip" role="alert">
            <span>{wb.error}</span>
            <button type="button" onClick={retryLastPrompt} disabled={wb.status === 'recognizing'}>
              重试
            </button>
          </div>
        ) : null}

        {wb.imageDataUrls.length > 0 || wb.pdfDataUrls.length > 0 ? (
          <div className="chat-image-strip">
            <div className="chat-thumb-list">
              {wb.imageDataUrls.map((url, idx) => (
                <div className="chat-thumb-item" key={`${url.slice(0, 12)}-${idx}`}>
                  <img className="chat-thumb" src={url} alt={`截图${idx + 1}`} />
                  <button
                    type="button"
                    className="chat-thumb-remove"
                    onClick={() => wb.setImageDataUrls((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                </div>
              ))}
              {wb.pdfDataUrls.map((url, idx) => (
                <div className="chat-thumb-item" key={`pending-pdf-${idx}-${url.slice(0, 12)}`}>
                  <div className="chat-thumb" style={{ display: 'grid', placeItems: 'center' }}>
                    📄 PDF
                  </div>
                  <button
                    type="button"
                    className="chat-thumb-remove"
                    onClick={() => wb.setPdfDataUrls((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                wb.setImageDataUrls([]);
                wb.setPdfDataUrls([]);
              }}
            >
              清空附件
            </button>
          </div>
        ) : null}

        <p className="chat-disclaimer">AI 生成内容仅供参考，请结合原始账单核对后再保存。</p>

        {latestTransaction ? (
          <div className="chat-input-meta">
            <div
              className={`chat-input-context ${wb.textInput.trim() ? 'is-collapsed' : ''}`}
              aria-label="最近一笔账单"
            >
              <span>{latestContextLabel}</span>
              <strong>
                {latestTransaction.note || '未备注'} ·
                {getTransactionDirection(latestTransaction) === 'inflow' ? ' +' : ' -'}¥
                {latestTransaction.amount.toFixed(2)}
              </strong>
            </div>
          </div>
        ) : null}

        <form className="chat-input-form" onSubmit={onSubmit}>
          <div className="chat-input-stack">
            <div className="chat-input-toolbar">
              <div className="chat-input-toolbar-left">
                <div className="chat-model-selector chat-model-selector-inline">
                  <button
                    type="button"
                    className="chat-model-icon-btn"
                    onClick={() => {
                      setModelOpen((prev) => {
                        const next = !prev;
                        setModelPickerSource(next ? 'toolbar' : null);
                        return next;
                      });
                    }}
                    aria-haspopup="listbox"
                    aria-label={`当前模型：${getModelDisplayLabel(model || t('assistant.ui.selectModel'))}`}
                    title={getModelDisplayLabel(model || t('assistant.ui.selectModel'))}
                  >
                    @
                  </button>
                  <span className="chat-model-inline-label">{getModelDisplayLabel(model || t('assistant.ui.selectModel'))}</span>

                  {modelOpen ? (
                    <div
                      className={`chat-model-dropdown ${modelPickerSource === 'command' ? 'is-command-open' : ''}`}
                      role="dialog"
                      aria-label="模型列表"
                    >
                      <div className="chat-model-dropdown-header">
                        <button
                          type="button"
                          className="chat-model-fetch-btn"
                          disabled={wb.loadingModels}
                          onClick={() => void wb.handleLoadModels()}
                        >
                          {wb.loadingModels
                            ? t('assistant.ui.loadingModels')
                            : t('assistant.ui.refreshModels')}
                        </button>
                      </div>
                      <div className="chat-model-list">
                        {wb.models.length === 0 ? (
                          <div className="chat-model-empty">{t('assistant.ui.emptyModels')}</div>
                        ) : (
                          wb.models.map((item: string) => (
                            <button
                              key={item}
                              type="button"
                              className={`chat-model-option ${item === model ? 'active' : ''}`}
                              onClick={() => handleSelectModel(item)}
                            >
                              {getModelDisplayLabel(item)}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                className="chat-input-toolbar-btn"
                aria-label={t('assistant.ui.clearContext')}
                title={t('assistant.ui.clearContext')}
                onClick={() => {
                  setChatHistory([]);
                  setStreamingPreviewMessage('');
                  setStreamingCommittedSegments([]);
                  setStreamingDraftSegment('');
                  wb.resetWorkbench();
                  try {
                    window.sessionStorage.removeItem(CHAT_HISTORY_CACHE_KEYS[activeHistoryModeRef.current]);
                  } catch {
                    // ignore storage write errors
                  }
                }}
                disabled={chatHistory.length === 0}
              >
                清空上下文
              </button>
            </div>

            <div className="chat-input-row">
              <button
                type="button"
                className="chat-upload-btn"
                title="上传图片/PDF"
                onClick={() => wb.fileInputRef.current?.click()}
                disabled={wb.status === 'recognizing'}
              >
                ＋
              </button>

              <div className="chat-input-main">
                <textarea
                  ref={wb.textareaRef}
                  className="chat-input-textarea"
                  rows={1}
                  placeholder={inputPlaceholder(wb.status, wb.hasApiKey, mode, t)}
                  value={wb.textInput}
                  onChange={(e) => wb.setTextInput(e.target.value)}
                  onPaste={(e) => void wb.handlePasteImage(e)}
                  onKeyDown={onInputKeyDown}
                />
              </div>

              <button
                type={wb.status === 'recognizing' ? 'button' : 'submit'}
                className={`chat-send-btn ${wb.status === 'recognizing' ? 'chat-send-btn-stop' : ''}`}
                title={wb.status === 'recognizing' ? '停止' : '发送'}
                onClick={wb.status === 'recognizing' ? wb.stopRecognize : undefined}
                disabled={wb.status !== 'recognizing' && !wb.canRecognize}
              >
                {wb.status === 'recognizing' ? '■' : '↑'}
              </button>
            </div>

            <input
              ref={wb.fileInputRef}
              className="chat-file-input-hidden"
              type="file"
              accept="image/*,application/pdf"
              title="上传账单图片或 PDF"
              aria-label="上传账单图片或 PDF"
              onChange={(e) => void wb.handleSetFile(e.target.files?.[0])}
            />
          </div>
        </form>
      </section>

      {semanticPanelOpen ? (
        <div className="drawer-overlay" role="presentation" onClick={() => setSemanticPanelOpen(false)}>
          <aside
            className="drawer-panel chat-semantic-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="语义召回详情"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="drawer-header">
              <h3>语义召回</h3>
              <button type="button" onClick={() => setSemanticPanelOpen(false)}>
                关闭
              </button>
            </header>
            <div className="drawer-body">
              <details className="chat-semantic-drawer-card" open>
                <summary>
                  <strong>索引状态</strong>
                </summary>
                <span>
                  {wb.semanticRecallCacheMeta.exists
                    ? `已建立 · ${wb.semanticRecallCacheMeta.indexedDocs} 条 · ${wb.semanticRecallCacheMeta.updatedAt ? new Date(wb.semanticRecallCacheMeta.updatedAt).toLocaleString() : '-'}`
                    : '当前尚未建立语义召回索引'}
                </span>
                <div className="chat-semantic-status-actions">
                  <button
                    type="button"
                    className="chat-secondary-action-btn"
                    onClick={() => {
                      wb.refreshSemanticRecallCacheMeta();
                      wb.setToastState('语义召回索引状态已刷新', 'success');
                    }}
                  >
                    刷新
                  </button>
                  <button
                    type="button"
                    className="chat-secondary-action-btn"
                    onClick={() => {
                      const ok = wb.clearSemanticRecallIndex();
                      if (!ok) {
                        wb.setToastState('请先配置 Base URL 与 Embedding 模型后再清理缓存', 'warning');
                      }
                    }}
                  >
                    清缓存
                  </button>
                </div>
              </details>
              {(showEmbeddingSummary && wb.embeddingDebug.enabled) || (showEmbeddingDebug && wb.embeddingDebug.enabled) ? (
                <details className="chat-semantic-drawer-card">
                  <summary>
                    <strong>当前状态</strong>
                  </summary>
                  {showEmbeddingSummary && wb.embeddingDebug.enabled ? (
                    <p className="chat-semantic-drawer-text">
                      {wb.embeddingDebug.used
                        ? `语义召回：命中 ${wb.embeddingDebug.hitCount} 条，最高相似度 ${wb.embeddingDebug.topScore.toFixed(2)}，平均相似度 ${wb.embeddingDebug.averageScore.toFixed(2)}，耗时 ${wb.embeddingDebug.latencyMs}ms，索引 ${wb.embeddingDebug.indexedDocs} 条。`
                        : wb.embeddingDebug.downgraded
                          ? `语义召回已降级：${wb.embeddingDebug.reason || '服务不可用'}（耗时 ${wb.embeddingDebug.latencyMs}ms）。`
                          : `语义召回未命中可用上下文（耗时 ${wb.embeddingDebug.latencyMs}ms）。`}
                    </p>
                  ) : null}
                  {showEmbeddingDebug && wb.embeddingDebug.enabled ? (
                    <pre className="chat-semantic-drawer-pre">
                      {[
                        `模型：${wb.embeddingDebug.model || '-'} | 启用：${wb.embeddingDebug.enabled ? '是' : '否'} | 使用召回：${wb.embeddingDebug.used ? '是' : '否'} | 降级：${wb.embeddingDebug.downgraded ? '是' : '否'}`,
                        `命中：${wb.embeddingDebug.hitCount} | 最高：${wb.embeddingDebug.topScore.toFixed(4)} | 平均：${wb.embeddingDebug.averageScore.toFixed(4)} | 索引：${wb.embeddingDebug.indexedDocs} | 耗时：${wb.embeddingDebug.latencyMs}ms`,
                        wb.embeddingDebug.reason ? `原因：${wb.embeddingDebug.reason}` : '',
                        wb.embeddingDebug.hits.length > 0
                          ? `Top Hits:\n${wb.embeddingDebug.hits
                              .map((hit, idx) => `${idx + 1}. [${hit.score.toFixed(4)}] ${hit.id}`)
                              .join('\n')}`
                          : ''
                      ]
                        .filter(Boolean)
                        .join('\n')}
                    </pre>
                  ) : null}
                </details>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {duplicateReviewOpen && currentDuplicateReview ? (
        <div className="dialog-overlay" role="presentation" onClick={handleCancelDuplicateReview}>
          <section
            className="dialog chat-dup-compare-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="重复账单对比确认"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dialog-header">
              重复账单确认（{duplicateReviewIndex + 1}/{duplicateReviewPairs.length}）
            </header>
            <div className="dialog-body chat-dup-compare-body">
              <p className="chat-dup-compare-tip">
                请核对左侧新识别数据与右侧已有账单，确认是否覆盖旧账单。
              </p>
              <div className="chat-dup-compare-grid">
                <article className="chat-dup-compare-card is-new">
                  <h4>新数据（AI 识别）</h4>
                  <dl>
                    <div>
                      <dt>日期</dt>
                      <dd>{currentDuplicateReview.entry.date.slice(0, 10)}</dd>
                    </div>
                    <div>
                      <dt>类型</dt>
                      <dd>{currentDuplicateReview.entry.type}</dd>
                    </div>
                    <div>
                      <dt>金额</dt>
                      <dd>¥{currentDuplicateReview.entry.amount.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>分类</dt>
                      <dd>{currentDuplicateReview.entry.category || '未分类'}</dd>
                    </div>
                    <div>
                      <dt>账户</dt>
                      <dd>{currentDuplicateReview.entry.account || '未指定账户'}</dd>
                    </div>
                    <div>
                      <dt>备注</dt>
                      <dd>{currentDuplicateReview.entry.note || '—'}</dd>
                    </div>
                  </dl>
                </article>
                <article className="chat-dup-compare-card is-existing">
                  <h4>已有账单（命中重复）</h4>
                  <dl>
                    <div>
                      <dt>日期</dt>
                      <dd>{currentDuplicateReview.existing.date.slice(0, 10)}</dd>
                    </div>
                    <div>
                      <dt>类型</dt>
                      <dd>{currentDuplicateReview.existing.type}</dd>
                    </div>
                    <div>
                      <dt>金额</dt>
                      <dd>¥{currentDuplicateReview.existing.amount.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>分类</dt>
                      <dd>
                        {categories.find(
                          (item) => item.id === currentDuplicateReview.existing.categoryId
                        )?.name || '未分类'}
                      </dd>
                    </div>
                    <div>
                      <dt>账户</dt>
                      <dd>
                        {accounts.find(
                          (item) => item.id === currentDuplicateReview.existing.accountId
                        )?.name || '未指定账户'}
                      </dd>
                    </div>
                    <div>
                      <dt>备注</dt>
                      <dd>{currentDuplicateReview.existing.note || '—'}</dd>
                    </div>
                  </dl>
                </article>
              </div>
            </div>
            <footer className="dialog-footer chat-dup-compare-footer">
              <button type="button" onClick={handleCancelDuplicateReview}>
                取消本次保存
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => handleDuplicateDecision(false)}
              >
                保留旧账单并新增
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => handleDuplicateDecision(true)}
              >
                覆盖旧账单
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <Toast
        message={wb.toast.message}
        variant={wb.toast.variant}
        visible={wb.toast.visible}
        onClose={() => wb.setToastVisible(false)}
      />
    </div>
  );
}
