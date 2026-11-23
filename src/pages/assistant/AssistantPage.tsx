import { roundMoney } from '../../shared/lib/money';
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useDialogFocus } from '../../shared/lib/useDialogFocus';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Link, useNavigate } from 'react-router-dom';
import {
  buildCreditAssistantMessageText,
  extractCreditStructuredItems,
  extractStreamingCreditPreview
} from '../../features/assistant/creditAssistant/parser';
import type {
  CreditExtractedItem,
  CreditFieldMeta
} from '../../features/assistant/creditAssistant/types';
import { useAssistantWorkbench } from '../../features/assistant/workbench/useAssistantWorkbench';
import { BillPreviewCard } from '../../features/assistant/ui/BillPreviewCard';
import {
  isSupportedLedgerCurrency,
  normalizeLedgerCurrency
} from '../../features/assistant/workbench/workbenchUtils';
import { renderMarkdownContent } from '../../features/assistant/ui/MarkdownRenderer';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useGlobalMemoryStore } from '../../shared/store/useGlobalMemoryStore';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import { extractGlobalMemoriesFromConversation } from '../../features/assistant/memory/extractGlobalMemories';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import {
  filterCountableTransactions,
  getTransactionDirection,
  isTransactionRefundLike,
  summarizeTransactions
} from '../../shared/lib/transactionMetrics';
import { useTFallback } from '../../shared/lib/useTFallback';
import {
  daysSinceLocalDate,
  resolveTransactionLocalDay,
  toLocalDateKey,
  todayLocalDateKey
} from '../../shared/lib/localDate';
import { EMPTY_CATEGORY_FILTER_VALUE } from '../../features/transactions/model/categoryQuickFilter';
import { formatCurrencyFixed2, formatMoneyByCurrency } from '../../shared/lib/format';
import { Toast } from '../../shared/ui/Toast';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import type { DebtItem } from '../../features/debt/model/debtMetrics';
import {
  creditDraftToDebt,
  getCreditDraftPendingFields,
  isCreditDraftReady
} from '../../features/debt/model/creditDrafts';
import {
  calculateDebtDerivedMetrics,
  calculateDebtMinimumPayment,
  calculateDebtSummary
} from '../../features/debt/model/debtMetrics';
import type { DraftBillEntry } from '../../features/assistant/workbench/workbenchTypes';
import type { TransactionItem } from '../../entities/transaction/types';
import {
  annualizeCreditInterest,
  buildCreditFollowUpPrompts,
  enrichCreditItemsForConfirmation,
  formatCreditAccountReference,
  mergeCreditItemsWithHistory,
  parseCreditRepaymentDay
} from './creditAssistantLogic';
import { resolveCreditRepaymentDueDisplay } from './creditRepaymentHelpers';
import { inferCreditDebtType } from '../../features/assistant/creditAssistant/debtClassification';
import {
  ASSISTANT_ACTIVE_MODE_STORAGE_KEY,
  ASSISTANT_MODE_CHANGED_EVENT,
  readAssistantModeFromSessionStorage,
  type AssistantMode
} from '../../features/assistant/shared/assistantMode';
import { rankAssistantIntents as rankAssistantIntentsVocabulary } from '../../features/assistant/shared/assistantIntentVocabulary';
import { InvestmentChatPanel } from '../../features/assistant/investment-chat/InvestmentChatPanel';
import type { AgentActionView } from '../../features/assistant/agent/assistantAgentTools';
import {
  ChatClearIcon,
  ChatCopyIcon,
  ChatRotateCcwIcon,
  ChatSendIcon,
  ChatStopIcon,
  ChatThumbsDownIcon,
  ChatThumbsUpIcon,
  ChatUploadIcon
} from '../../features/assistant/ui/chatIcons';
import { BOT_ICON_URL, USER_ICON_URL } from '../../shared/config/brandAssets';
import { getAiModelDisplayLabel } from '../../shared/config/aiModels';
import { AiModelFamilyIcon } from '../../shared/ui/brandIcons';
import { resolveAiModelFamily } from '../../shared/ui/brandIconResolvers';

function getModelDisplayLabel(modelId: string): string {
  return getAiModelDisplayLabel(modelId);
}

/** 信贷管家输入框上方的一键指令,覆盖最常见的查询与登记场景。 */
const CREDIT_QUICK_COMMANDS = [
  '本月总应还、已还、还差多少?',
  '哪几笔最该先还?',
  '帮我梳理未来 3 个月的还款安排'
] as const;

function getDraftTypeLabel(type: string): string {
  if (type === 'expense') return '支出';
  if (type === 'income') return '收入';
  if (type === 'budget') return '预算';
  if (type === 'repayment') return '还款';
  return '待确认类型';
}

function inputPlaceholder(
  status: ReturnType<typeof useAssistantWorkbench>['status'],
  hasApiKey: boolean,
  mode: AssistantMode,
  t: TFunction
): string {
  if (!hasApiKey) return t('assistant.placeholders.needApiKey');

  const assistantHint = t('assistant.placeholders.assistantHint');
  const creditHint = '直接说“花呗这个月还了 2000”,也可以问我账单和还款安排。';
  // 只有合并后的 AI 助手会进入账单待确认态,其他模式不应被其状态覆盖提示。
  const effectiveStatus =
    mode !== 'assistant' && (status === 'preview' || status === 'saved') ? 'idle' : status;

  switch (effectiveStatus) {
    case 'idle':
      return mode === 'credit' ? creditHint : assistantHint;
    case 'ready':
      return mode === 'credit'
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
      return mode === 'credit' ? creditHint : assistantHint;
  }
}

function CreditCardSkeleton({ count = 2 }: { count?: number }) {
  // 原来是 render*( ) 形式的模块级 helper,拿不到 hook;改成真组件才能用 tf。
  const tf = useTFallback();
  return (
    <div className="chat-credit-cards chat-credit-cards-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <section
          key={`credit-skeleton-${index}`}
          className="chat-credit-card chat-credit-card-skeleton"
        >
          <div className="chat-credit-card-head">
            <div>
              <strong className="chat-skeleton-line chat-skeleton-line-lg">&nbsp;</strong>
              <span className="chat-skeleton-line chat-skeleton-line-sm">&nbsp;</span>
            </div>
            <em className="chat-credit-confidence is-medium chat-skeleton-pill">{tf('assistant.ledger.recognizing', '识别中')}</em>
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
              {tf('assistant.actions.saveToRepayment', '保存到还款管理')}
            </button>
            <button type="button" className="chat-secondary-action-btn" disabled>
              {tf('assistant.actions.sendToRepayment', '带去还款管理')}
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
  feedback?: 'up' | 'down';
  imageDataUrls?: string[];
  pdfDataUrls?: string[];
  usageText?: string;
  reasoningText?: string;
  embeddingSummaryText?: string;
  embeddingSummaryIsError?: boolean;
  embeddingDebugText?: string;
  followUpPrompts?: string[];
  creditItems?: CreditExtractedItem[];
  /** Agent 在本轮执行的账本操作(可撤销)。 */
  agentActions?: AgentActionView[];
}

interface SubmitPromptOptions {
  imageDataUrls?: string[];
  pdfDataUrls?: string[];
  appendUserMessage?: boolean;
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

const EMBEDDING_DEGRADED_SUMMARY = '语义增强暂不可用，本次已按普通账本分析继续回答。';

function formatEmbeddingSummaryForDisplay(summary: string): string {
  return summary.trim().startsWith('语义召回已降级') ? EMBEDDING_DEGRADED_SUMMARY : summary;
}

interface DuplicateReviewPair {
  entry: DraftBillEntry;
  existing: TransactionItem;
}

const CHAT_HISTORY_CACHE_KEYS: Record<AssistantMode, string> = {
  assistant: 'ledgerflow.assistant.chatHistory.assistant',
  credit: 'ledgerflow.assistant.chatHistory.credit',
  investment: 'ledgerflow.assistant.chatHistory.investment'
};

/** 旧版「AI 记账」独立会话缓存;合并后仅用于迁移到 assistant。 */
const LEGACY_BOOKKEEPING_HISTORY_KEY = 'ledgerflow.assistant.chatHistory.bookkeeping';

const ASSISTANT_MODE_ORDER: AssistantMode[] = ['assistant', 'credit', 'investment'];

const ASSISTANT_INTRO_ILLUSTRATION_URL =
  'https://pub-7c333d8dd649422b8c267f82f1a9b4c4.r2.dev/Illustrations/importing.svg';

function renderChatAvatar(kind: 'assistant' | 'user' | 'success') {
  if (kind === 'success') {
    return (
      <div className="chat-msg-avatar chat-msg-avatar-system" aria-hidden="true">
        ✓
      </div>
    );
  }

  return (
    <div className="chat-msg-avatar" aria-hidden="true">
      <img
        className="chat-msg-avatar-image"
        src={kind === 'user' ? USER_ICON_URL : BOT_ICON_URL}
        alt=""
      />
    </div>
  );
}

function readWideLayoutPreference() {
  try {
    return window.localStorage.getItem('ledgerflow.assistant.wide-layout') === '1';
  } catch {
    return false;
  }
}

function isStaleFollowUpPrompt(prompt: string): boolean {
  return (
    FOLLOW_UP_JARGON_PATTERN.test(prompt) ||
    /[\u201C\u201D...]/.test(prompt) ||
    /(?:并|且|以及|然后|再|就|的|了)$/.test(prompt.trim())
  );
}

// 旧版本缓存的追问可能带引号或被截断,这里按当前文案规则重新生成。
function sanitizeCachedFollowUpPrompts(items: ChatHistoryItem[]): ChatHistoryItem[] {
  return items.map((item, index) => {
    if (item.role !== 'assistant' || !item.followUpPrompts?.length) return item;
    if (!item.followUpPrompts.some(isStaleFollowUpPrompt)) return item;
    return {
      ...item,
      followUpPrompts: buildFollowUpPrompts(item.text, items.slice(0, index))
    };
  });
}

function readChatHistory(mode: AssistantMode): ChatHistoryItem[] {
  try {
    let raw = window.sessionStorage.getItem(CHAT_HISTORY_CACHE_KEYS[mode]);
    // 合并初期把旧「AI 记账」会话迁移到 AI 助手,避免升级后上下文突然消失。
    if (mode === 'assistant' && !raw) {
      raw = window.sessionStorage.getItem(LEGACY_BOOKKEEPING_HISTORY_KEY);
      if (raw) {
        window.sessionStorage.setItem(CHAT_HISTORY_CACHE_KEYS.assistant, raw);
        window.sessionStorage.removeItem(LEGACY_BOOKKEEPING_HISTORY_KEY);
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatHistoryItem[];
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .filter(
        (item): item is ChatHistoryItem =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.text === 'string'
      )
      .map((item) => ({
        ...item,
        feedback: item.feedback === 'up' || item.feedback === 'down' ? item.feedback : undefined,
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
          : undefined,
        agentActions: Array.isArray(item.agentActions)
          ? item.agentActions
              .filter(
                (action): action is AgentActionView =>
                  Boolean(action) &&
                  typeof action.id === 'string' &&
                  typeof action.label === 'string' &&
                  (action.kind === 'create' || action.kind === 'update' || action.kind === 'delete')
              )
              // 页面重载后撤销回调已丢失,历史记录里不再展示不可用的撤销按钮。
              .map((action) => ({ ...action, undoable: false }))
          : undefined
      }));
    return sanitizeCachedFollowUpPrompts(normalized);
  } catch {
    return [];
  }
}

type AssistantIntent = 'trend' | 'review' | 'planning' | 'decision' | 'risk' | 'category';

const ASSISTANT_INTENT_PATTERNS: Array<{
  intent: AssistantIntent;
  regex: RegExp;
  label: string;
  priority: number;
}> = [
  {
    intent: 'trend',
    regex:
      /趋势|变化|波动|上升|下降|增长|减少|最近|近[一二三四五六七八九十\d]+(?:天|周|个月|年)|本月|这月|上月|上个月|环比|同比|对比|拐点/,
    label: '趋势变化',
    priority: 6
  },
  {
    intent: 'review',
    regex: /复盘|回顾|总结|问题在哪|哪里出问题|哪里失控|拆解|原因|为啥|为什么|怎么回事/,
    label: '复盘拆解',
    priority: 5
  },
  {
    intent: 'planning',
    regex: /预算|计划|安排|怎么做|怎么省|下一步|清单|执行|优先级|先还|先买|先花|攒钱/,
    label: '行动规划',
    priority: 4
  },
  {
    intent: 'decision',
    regex: /怎么看|判断|值不值|划算吗|要不要|是否|应该|该不该|合适吗|能不能|该选|选哪个/,
    label: '判断取舍',
    priority: 5
  },
  {
    intent: 'risk',
    regex: /风险|压力|危险|失控|隐患|吃紧|透支|超支|还不上了?|逾期|爆仓|扛不住/,
    label: '风险提醒',
    priority: 4
  },
  {
    intent: 'category',
    regex:
      /分类|餐饮|吃饭|外卖|交通|通勤|住房|居住|娱乐|日用|订阅|买菜|出行|购物|医疗|教育|旅行|宠物|保险/,
    label: '分类聚焦',
    priority: 3
  }
];

function rankAssistantIntents(text: string): AssistantIntent[] {
  return rankAssistantIntentsVocabulary(text);
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
  const dueAmount = toNumber(prefill.dueAmount);
  const annualRate = annualizeCreditInterest(item.interest, item.rateType);
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
    customMinPayment: dueAmount && dueAmount > 0 ? dueAmount : undefined,
    billDay: undefined,
    repaymentMethod: prefill.type === 'loan' ? 'equal-installment' : 'minimum-payment',
    repaymentRecordMode: 'manual',
    graceDays: 0
  };
}

function buildCreditDebtUpdatePatch(item: CreditExtractedItem): Partial<Omit<DebtItem, 'id'>> {
  const prefill = mapCreditItemToRepaymentPrefill(item);
  const patch: Partial<Omit<DebtItem, 'id'>> = {};

  const name = String(prefill.name || '').trim();
  if (name) patch.name = name;

  const balance = Number(prefill.balance);
  if (prefill.balance && Number.isFinite(balance)) patch.balance = balance;

  const annualRate = annualizeCreditInterest(item.interest, item.rateType);
  if (annualRate !== undefined) patch.annualRate = annualRate;

  const repaymentDay = Number(prefill.repaymentDay);
  if (prefill.repaymentDay && Number.isFinite(repaymentDay)) patch.repaymentDay = repaymentDay;

  const periods = Number(prefill.totalPeriods);
  if (prefill.totalPeriods && Number.isFinite(periods)) {
    patch.totalPeriods = periods;
    patch.remainingMonths = periods;
  }

  return patch;
}

function resolveQuickRepayAmount(
  creditItem: CreditExtractedItem,
  debt: DebtItem
): { amount: number; capped: boolean } | null {
  const rawAmount = Number(String(creditItem.dueAmount || '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return null;
  const balance = Math.max(0, debt.balance);
  const amount = Math.min(rawAmount, balance);
  if (amount <= 0) return null;
  return { amount: roundMoney(amount), capped: rawAmount > balance };
}

function mapCreditItemToRepaymentPrefill(item: CreditExtractedItem) {
  const type = inferCreditDebtType(item.productType, item.title);

  const extractNumberText = (value?: string) => {
    if (!value) return '';
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? match[0] : '';
  };

  const totalPeriodsNumber = extractNumberText(item.remainingPeriods);
  const annualRate = annualizeCreditInterest(item.interest, item.rateType);

  return {
    name: item.title,
    type,
    balance: extractNumberText(item.totalDebt),
    dueAmount: extractNumberText(item.dueAmount),
    repaymentDay: parseCreditRepaymentDay(item.repaymentDate),
    totalPeriods: totalPeriodsNumber,
    paidPeriods: '',
    remainingMonths: totalPeriodsNumber,
    loanPrincipal: extractNumberText(item.totalDebt),
    totalRepayment: extractNumberText(item.totalDebt),
    annualRate: annualRate !== undefined ? String(annualRate) : '',
    paymentAccount: '',
    source: 'assistant-credit'
  };
}

function buildFollowUpPrompts(answer: string, history: ChatHistoryItem[]): string[] {
  const latestUserQuestion =
    [...history]
      .reverse()
      .find((item) => item.role === 'user')
      ?.text?.trim() || '';
  const compact = (text: string) =>
    text
      .replace(/\s+/g, ' ')
      .replace(/[。！？?；;]+$/g, '')
      .trim();
  const question = compact(latestUserQuestion);
  const response = compact(answer);
  const topic = extractFollowUpTopic(question || response);
  if (!topic) return [];

  const intents = Array.from(
    new Set([...rankAssistantIntents(question), ...rankAssistantIntents(response)])
  );
  const focus = intents[0];
  const prompts =
    focus === 'trend'
      ? [`${topic}接下来会怎么变?`, `这段时间哪天花得最多?`, `下个月要不要盯紧${topic}?`]
      : focus === 'risk'
        ? [`${topic}最怕出什么问题?`, `现在先做哪一步最稳?`, `要不要先留点钱应急?`]
        : focus === 'planning'
          ? [`这周先做哪件事最有用?`, `${topic}从哪一步开始最好上手?`, `做到什么程度算有进步?`]
          : focus === 'decision'
            ? [`这件事最该先看哪一点?`, `换个想法,结论会变吗?`, `还差什么信息才能定下来?`]
            : focus === 'category'
              ? [`${topic}主要花在哪几项?`, `这些里哪些能省、哪些省不了?`, `跟哪段时间比更合适?`]
              : [
                  `${topic}是怎么算出来的?`,
                  `关于${topic},我还想知道什么?`,
                  `接下来我可以做点什么?`
                ];

  // 问题本身过长时，减少重复引用，保持按钮短而具体。
  return Array.from(new Set(prompts.map(normalizeFollowUpPrompt))).slice(0, 3);
}

function normalizeFollowUpPrompt(prompt: string): string {
  return prompt
    .replace(/\s+/g, ' ')
    .replace(/^[-*•\d一二三四五六七八九十、.．)）\s]+/, '')
    .trim()
    .slice(0, 48);
}

/** 追问建议里不该出现的专业词,命中就放弃这条建议。 */
const FOLLOW_UP_JARGON_PATTERN =
  /(口径|维度|样本|归因|结构化|验证|依据|趋势反转|资金面|显著性|复现|颗粒度|执行路径|优先级|周期对比|风险评估|协同矩阵|漏斗)/;

const FOLLOW_UP_PERIOD_PATTERN =
  /(本月|这个月|当月|上月|上个月|本周|这周|本季度|今年|去年|最近|近[一二三四五六七八九十\d]+(?:天|周|个月|年))/;

const FOLLOW_UP_CATEGORY_WORDS =
  '(?:餐饮|外卖|通勤|交通|房租|住房|购物|娱乐|医疗|教育|人情|旅行|水电|日用|通讯|宠物|学习|保险|子女)';

// 优先匹配用户口中的账务主题,避免把整句问题当作追问主题。
const FOLLOW_UP_TOPIC_PATTERNS = [
  /(?:收支|收入|支出|结余|预算|账单|花销|开销|储蓄|存款|现金流)/,
  new RegExp(
    `${FOLLOW_UP_CATEGORY_WORDS}(?:[和与及跟、]?${FOLLOW_UP_CATEGORY_WORDS})*(?:支出|花销|开销|费用|消费|预算)?`
  ),
  /(?:信用卡|花呗|借呗|房贷|车贷|贷款|负债|还款|分期|利息|手续费)/,
  /(?:投资|理财|基金|股票|收益|仓位|资产|持仓|行情|回撤)/
];

function pickFollowUpTopicKeyword(text: string): string {
  let best = '';
  for (const pattern of FOLLOW_UP_TOPIC_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const index = typeof match.index === 'number' ? match.index : 0;
    const lead = text.slice(Math.max(0, index - 6), index);
    const periods = lead.match(new RegExp(FOLLOW_UP_PERIOD_PATTERN.source, 'g'));
    const period = periods ? periods[periods.length - 1] : '';
    const topic = `${period}${match[0]}`.trim();
    if (topic.length > best.length) best = topic;
  }
  return best;
}

function extractFollowUpTopic(source: string): string {
  const cleaned = source
    .replace(/[。！？；;]+$/g, '')
    .replace(/^(?:请帮我|麻烦帮我|帮我|请|麻烦|能否|可否)+/, '')
    .trim();
  if (!cleaned) return '';
  const keywordTopic = pickFollowUpTopicKeyword(cleaned);
  if (keywordTopic) {
    return keywordTopic.length > 16 ? `${keywordTopic.slice(0, 16)}...` : keywordTopic;
  }
  const clauses = cleaned
    .split(/[，,；;、：:]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const primaryClause =
    clauses.find((part) => part.length >= 8) ||
    clauses.reduce((longest, part) => (part.length > longest.length ? part : longest), '') ||
    cleaned;
  const trimmed = primaryClause
    .replace(/[和与及跟、，,]+$/g, '')
    .replace(/(?:并|且|以及|然后|再|就|的|了)$/g, '')
    .trim();
  return trimmed.length > 16 ? `${trimmed.slice(0, 16)}…` : trimmed;
}

function parseAiFollowUpPrompts(raw: string): string[] {
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

  return (
    parsed
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        return String(item.prompt || item.question || item.label || '');
      })
      .map(normalizeFollowUpPrompt)
      .filter((item, index, list) => item.length >= 6 && list.indexOf(item) === index)
      // 模型偶尔会冒出「口径」「样本」这类专业词,这类建议直接丢弃,交给口语化兜底文案。
      .filter((item) => !FOLLOW_UP_JARGON_PATTERN.test(item))
      .slice(0, 4)
  );
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
    meta.status === 'confirmed' ? '已确认' : meta.status === 'low-confidence' ? '低置信' : '待确认';

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
  const { t, i18n } = useTranslation();
  const tf = useTFallback();
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
  const removeRepaymentRecord = useAppPreferences((s) => s.removeRepaymentRecord);
  const monthlyIncome = useAppPreferences((s) => s.monthlyIncome);
  const repaymentRecords = useAppPreferences((s) => s.repaymentRecords);
  const storedCreditDrafts = useAppPreferences((s) => s.creditDrafts);
  const creditDrafts = useMemo(() => storedCreditDrafts || [], [storedCreditDrafts]);
  const upsertCreditDraft = useAppPreferences((s) => s.upsertCreditDraft);
  const removeCreditDraft = useAppPreferences((s) => s.removeCreditDraft);
  const showEmbeddingDebug = useAiSettings((s) => s.showEmbeddingDebug);
  const embeddingModel = useAiSettings((s) => s.embeddingModel);
  const enableEmbeddingModel = useAiSettings((s) => s.enableEmbeddingModel);
  const globalMemories = useGlobalMemoryStore((s) => s.memories);
  const addGlobalMemory = useGlobalMemoryStore((s) => s.addMemory);

  const categories = useFinanceStore((s) => s.categories);
  const accounts = useFinanceStore((s) => s.accounts);
  const trashedAccounts = useFinanceStore((s) => s.trashedAccounts);
  const transactions = useFinanceStore((s) => s.transactions);
  const subscriptions = useFinanceStore((s) => s.subscriptions);
  const addCategory = useFinanceStore((s) => s.addCategory);
  const addAccount = useFinanceStore((s) => s.addAccount);
  const updateAccount = useFinanceStore((s) => s.updateAccount);
  const updateAccountBalance = useFinanceStore((s) => s.updateAccountBalance);
  const removeAccount = useFinanceStore((s) => s.removeAccount);
  const restoreAccount = useFinanceStore((s) => s.restoreAccount);
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const removeTransaction = useFinanceStore((s) => s.removeTransaction);
  const restoreTransaction = useFinanceStore((s) => s.restoreTransaction);
  const addSubscription = useFinanceStore((s) => s.addSubscription);
  const addDebt = useAppPreferences((s) => s.addDebt);

  const wb = useAssistantWorkbench({
    baseUrl,
    apiKey,
    model,
    categories,
    accounts,
    trashedAccounts,
    transactions,
    addCategory,
    addAccount,
    updateAccount,
    updateAccountBalance,
    removeAccount,
    restoreAccount,
    addTransaction,
    updateTransaction,
    removeTransaction,
    restoreTransaction,
    debts,
    repaymentRecords,
    monthlyIncome,
    addDebt,
    updateDebt,
    removeDebt,
    addRepaymentRecord,
    removeRepaymentRecord,
    creditDrafts,
    upsertCreditDraft,
    removeCreditDraft,
    sceneMode: mode,
    globalMemories
  });

  const [modelOpen, setModelOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [streamingPreviewMessage, setStreamingPreviewMessage] = useState('');
  const [streamingPreviewReasoning, setStreamingPreviewReasoning] = useState('');
  const [streamingCommittedSegments, setStreamingCommittedSegments] = useState<string[]>([]);
  const [streamingDraftSegment, setStreamingDraftSegment] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(() => readChatHistory(mode));
  const chatHistoryRef = useRef(chatHistory);
  chatHistoryRef.current = chatHistory;
  const [confirmingCreditId, setConfirmingCreditId] = useState<string | null>(null);
  const [pendingDeleteCreditItem, setPendingDeleteCreditItem] =
    useState<CreditExtractedItem | null>(null);
  const [pendingQuickRepay, setPendingQuickRepay] = useState<{
    item: CreditExtractedItem;
    amount: number;
    capped: boolean;
    balanceAfter: number;
    debtName: string;
  } | null>(null);
  const quickRepayLockRef = useRef(false);
  const [modelPickerSource, setModelPickerSource] = useState<'command' | 'toolbar' | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modeTabRefs = useRef<Record<AssistantMode, HTMLButtonElement | null>>({
    assistant: null,
    credit: null,
    investment: null
  });
  const memoryExtractionSignatureRef = useRef<Record<AssistantMode, string>>({
    assistant: '',
    credit: '',
    investment: ''
  });
  const hasInitializedModeHistoryRef = useRef(false);
  const activeHistoryModeRef = useRef<AssistantMode>(mode);
  const skipHistoryPersistRef = useRef(false);
  const todayKey = toLocalDateKey(new Date());
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
    const monthRepaymentRecords = repaymentRecords.filter(
      (record) => String(record.paidAt || '').slice(0, 7) === thisMonthKey
    );
    const monthPaidByDebt = new Map<string, number>();
    monthRepaymentRecords.forEach((record) => {
      const debtId = String(record.debtId || '');
      if (!debtId) return;
      monthPaidByDebt.set(debtId, (monthPaidByDebt.get(debtId) || 0) + Number(record.amount || 0));
    });

    const dueItems = debts.map((item) => ({
      item,
      minimumPayment: calculateDebtDerivedMetrics(item).minimumPayment,
      dueDisplay: resolveCreditRepaymentDueDisplay(
        {
          debtId: item.id,
          repaymentDay: item.repaymentDay,
          minimumPayment: calculateDebtDerivedMetrics(item).minimumPayment
        },
        repaymentRecords
      )
    }));
    const totalDueThisMonth = dueItems.reduce((sum, entry) => sum + entry.minimumPayment, 0);
    const paidByDebt = new Map(
      dueItems.map((entry) => [
        entry.item.id,
        entry.dueDisplay?.paidAmount ?? monthPaidByDebt.get(entry.item.id) ?? 0
      ])
    );
    const totalPaidThisMonth = dueItems.reduce(
      (sum, entry) => sum + (paidByDebt.get(entry.item.id) || 0),
      0
    );
    const currentGap = dueItems.reduce(
      (sum, entry) =>
        sum + Math.max(0, entry.minimumPayment - (paidByDebt.get(entry.item.id) || 0)),
      0
    );

    const dueSoonItems = dueItems
      .filter((entry) => entry.dueDisplay)
      .map((entry) => {
        const dueDisplay = entry.dueDisplay!;
        return {
          id: entry.item.id,
          name: entry.item.name,
          repaymentDay: entry.item.repaymentDay || 0,
          minimumPayment: entry.minimumPayment,
          nextDue: dueDisplay.dueDate,
          daysUntil: dueDisplay.daysUntil,
          isOverdue: dueDisplay.isOverdue,
          isPaid: dueDisplay.isPaid
        };
      })
      .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime() || a.repaymentDay - b.repaymentDay)
      .slice(0, 3);
    const totalRemainingInterest = debts.reduce(
      (sum, item) => sum + (calculateDebtDerivedMetrics(item).remainingInterestCost || 0),
      0
    );

    return {
      totalDebt: summary.totalDebt,
      totalDueThisMonth,
      totalPaidThisMonth,
      currentGap,
      totalRemainingInterest,
      debtCount: debts.length,
      dueSoonItems
    };
  }, [debts, repaymentRecords, thisMonthKey]);
  const lastAssistantRef = useRef<Record<AssistantMode, string>>({
    assistant: '',
    credit: '',
    investment: ''
  });
  const pendingRequestModeRef = useRef<AssistantMode>('assistant');
  const submitInFlightRef = useRef(false);
  const recognitionTurnRef = useRef(0);
  const renderedRecognitionTurnRef = useRef(0);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const messagesAreaRef = useRef<HTMLElement | null>(null);
  const [duplicateReviewOpen, setDuplicateReviewOpen] = useState(false);
  const [duplicateReviewPairs, setDuplicateReviewPairs] = useState<DuplicateReviewPair[]>([]);
  const [duplicateReviewIndex, setDuplicateReviewIndex] = useState(0);
  const [overwriteEntryIds, setOverwriteEntryIds] = useState<string[]>([]);
  const [semanticPanelOpen, setSemanticPanelOpen] = useState(false);
  const semanticDrawerRef = useRef<HTMLElement | null>(null);
  const duplicateDialogRef = useRef<HTMLElement | null>(null);
  // 两个 aria-modal 弹层:焦点收进来、关闭后还给触发按钮。
  useDialogFocus(semanticPanelOpen, semanticDrawerRef, () => setSemanticPanelOpen(false));

  useEffect(() => {
    try {
      window.localStorage.setItem('ledgerflow.assistant.wide-layout', isWideLayout ? '1' : '0');
    } catch {
      // ignore storage write errors
    }
  }, [isWideLayout]);

  // 预览卡片需要的 JSON 结构，避免在渲染阶段重复构造。
  const duplicateEntriesCount = useMemo(
    () =>
      wb.entries.filter((item) => item.duplicateTxId || item.duplicateReason === 'batch').length,
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

  // 重复账单对比确认也是 aria-modal 弹层。
  useDialogFocus(duplicateReviewOpen && Boolean(currentDuplicateReview), duplicateDialogRef, handleCancelDuplicateReview);

  const handleCreateSubscriptionFromEntry = (entryId: string) => {
    const entry = wb.entries.find((item) => item.id === entryId);
    if (!entry || !entry.subscriptionSuggestion) return;

    const candidateName = entry.note?.trim() || 'AI识别订阅';
    const candidateCurrency = (entry.currency || 'CNY').toUpperCase();
    const candidateAmount = Number(Number(entry.amount || 0).toFixed(2));
    const duplicated = subscriptions.find((item) => {
      const nameMatched = item.name.trim() === candidateName;
      const currencyMatched = (item.currency || 'CNY').toUpperCase() === candidateCurrency;
      const amountMatched = Number(Number(item.amount || 0).toFixed(2)) === candidateAmount;
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
    // 与账户余额同口径:排除已删除与待支付/已关闭/失败的行,否则同一屏会出现两套数。
    const validRows = filterCountableTransactions(transactions).filter(
      (item) => item.type === 'income' || item.type === 'expense'
    );
    const todayRows = validRows.filter(
      (item) => resolveTransactionLocalDay(item.date) === todayKey
    );
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
      // 按本地日历日算天数差。旧写法把纯日期按 UTC 零点解析再和当前时刻相减:
      // 在 UTC+8 的 00:00–07:59,「今天」的记录会算出 -1,被 gap >= 0 直接剔除,
      // 等于早上记的账不进这两周的统计。
      const gap = daysSinceLocalDate(item.date);
      return gap !== null && gap >= 0 && gap < 14;
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
    // 「未分类」在数据里的表示是 categoryId 为空(删分类时会把引用清成 ''),
    // 之前这里比的是字符串 'uncategorized' —— 那是个从不存在的值,计数永远是 0,
    // 于是这张待办卡片从来不提示补分类。
    const uncategorizedCount = validRows.filter((item) => !item.categoryId).length;
    const pendingCount = validRows.filter((item) => item.status === 'pending').length;
    // 退款/冲正走共享判断,状态「已退款」是另一回事(refundTransaction 会把原交易置为 refunded)。
    const pendingRefundCount = validRows.filter(
      (item) => isTransactionRefundLike(item) || item.status === 'refunded'
    ).length;
    const repaymentTodoCount = validRows.filter(
      (item) => item.type === 'repayment' && (item.status === 'pending' || item.status === 'failed')
    ).length;

    const todayTodos: TodayTodoItem[] = [
      {
        id: 'todo-uncategorized',
        label: tf('assistant.todos.uncategorized', '待分类交易'),
        detail: tf('assistant.todos.uncategorizedDetail', '还有 {{count}} 笔交易未分类，建议今天先补齐。').replace('{{count}}', String(uncategorizedCount)),
        level: uncategorizedCount > 0 ? 'warning' : 'default',
        count: uncategorizedCount,
        statusLabel: uncategorizedCount > 0 ? tf('assistant.todos.dueToday', '今日 / 需处理') : undefined,
        href: `/transactions?categoryId=${EMPTY_CATEGORY_FILTER_VALUE}`
      },
      {
        id: 'todo-refund-link',
        label: tf('assistant.todos.refundLink', '待关联退款'),
        detail: tf('assistant.todos.refundLinkDetail', '检测到 {{count}} 笔退款/冲正相关记录，可核对原单关联。').replace('{{count}}', String(pendingRefundCount)),
        level: pendingRefundCount > 0 ? 'warning' : 'default',
        count: pendingRefundCount,
        statusLabel: pendingRefundCount > 0 ? tf('assistant.todos.dueToday', '今日 / 需处理') : undefined,
        href: '/transactions?status=refunded'
      },
      {
        id: 'todo-pending',
        label: tf('assistant.todos.pending', '待处理流水'),
        detail: tf('assistant.todos.pendingDetail', '当前有 {{count}} 笔待处理交易，建议优先确认状态。').replace('{{count}}', String(pendingCount)),
        level: pendingCount > 0 ? 'warning' : 'default',
        count: pendingCount,
        statusLabel: pendingCount > 0 ? tf('assistant.todos.dueToday', '今日 / 需处理') : undefined,
        href: '/transactions?status=pending'
      },
      {
        id: 'todo-repayment',
        label: tf('assistant.todos.repayment', '到期还款检查'),
        detail: tf('assistant.todos.repaymentDetail', '当前有 {{count}} 笔还款记录待确认，请核对到期日。').replace('{{count}}', String(repaymentTodoCount)),
        level: repaymentTodoCount > 0 ? 'warning' : 'default',
        count: repaymentTodoCount,
        statusLabel: repaymentTodoCount > 0 ? tf('assistant.todos.dueToday', '今日 / 需处理') : undefined,
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
      monthlyBriefs: [
        {
          key: 'expense',
          labelKey: 'assistant.welcome.briefExpense',
          value:
            monthExpense > 0
              ? formatCurrencyFixed2(monthExpense)
              : tf('assistant.welcome.briefEmpty', '暂无')
        },
        {
          key: 'income',
          labelKey: 'assistant.welcome.briefIncome',
          value:
            monthIncome > 0
              ? formatCurrencyFixed2(monthIncome)
              : tf('assistant.welcome.briefEmpty', '暂无')
        },
        {
          key: 'balance',
          labelKey: 'assistant.welcome.briefBalance',
          value: formatCurrencyFixed2(monthBalance)
        },
        {
          key: 'advice',
          labelKey: 'assistant.welcome.briefAdvice',
          value:
            monthBalance >= 0
              ? tf('assistant.welcome.briefKeepLogging', '继续记录')
              : tf('assistant.welcome.briefCutLarge', '先控大额')
        }
      ],
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
  }, [accounts, previousMonthKey, thisMonthKey, todayKey, transactions, tf]);

  const shouldShowIntroIllustration = !chatHistory.some((item) => item.role === 'user');
  const regularComposerExpanded =
    composerFocused ||
    Boolean(wb.textInput.trim()) ||
    wb.imageDataUrls.length > 0 ||
    wb.pdfDataUrls.length > 0 ||
    modelOpen;

  const latestContextLabel = latestTransaction
    ? getTransactionDirection(latestTransaction) === 'inflow'
      ? '最近收入'
      : '最近支出'
    : '最近一笔';

  // 滚动到底部。**必须显式区分 instant 与 smooth**:
  // .chat-messages-area 的 CSS 里写了 scroll-behavior: smooth,而 behavior: auto 会沿用 CSS 的值 ——
  // 也就是说进入页面时「跳到最新一条」会被浏览器演成一段动画,用户看到的是从顶部一路滚下去。
  // 只有 'instant' 才是真正的瞬间落位。
  const scrollMessagesToEnd = useCallback((behavior: ScrollBehavior) => {
    const container = messagesAreaRef.current;
    if (container) {
      // jsdom 没有实现 Element.scrollTo(测试环境会直接抛错),所以留一条兜底路径。
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior });
        return;
      }
      container.scrollTop = container.scrollHeight;
      return;
    }
    messageEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  /**
   * 进入助手页时**直接落在最后一条消息上**,不要从顶部滚下来。
   *
   * 用 useLayoutEffect(而不是 useEffect)是为了在浏览器绘制之前就落位,
   * 否则会先画一帧顶部、再跳到末尾。等历史消息到位再跳:历史可能是异步拉来的,
   * 空数组时跳没有意义,而那一次跳必须是瞬间的。
   */
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (didInitialScrollRef.current || chatHistory.length === 0) return;
    didInitialScrollRef.current = true;
    scrollMessagesToEnd('instant');
    // 首帧之后再落一次:字体/图片撑高内容时位置会漂,这次同样不许有动画
    const frame = requestAnimationFrame(() => scrollMessagesToEnd('instant'));
    return () => cancelAnimationFrame(frame);
  }, [chatHistory.length, scrollMessagesToEnd]);

  // 每次状态或消息变化后,自动将视图滚动到底部,保持聊天体验。
  useEffect(() => {
    if (!didInitialScrollRef.current) return; // 首次由上面那次瞬间落位负责
    scrollMessagesToEnd('smooth');
  }, [wb.status, wb.rawContent, wb.rawReasoning, wb.entries.length, wb.error, scrollMessagesToEnd]);

  // 当 {t('assistant.ui.assistantMode')}/AI 记账收到新的助手回复时,始终自动滚到底部。
  useEffect(() => {
    const latestMessage = chatHistory[chatHistory.length - 1];
    if (!latestMessage || latestMessage.role !== 'assistant') return;
    if (!didInitialScrollRef.current) return; // 首次由上面那次瞬间落位负责
    scrollMessagesToEnd('smooth');
  }, [chatHistory, mode, scrollMessagesToEnd]);

  useEffect(() => {
    if (!baseUrl || !apiKey || !model) return;
    if (!enableEmbeddingModel || !embeddingModel.trim()) return;

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

  const updateMessageInMode = useCallback(
    (targetMode: AssistantMode, messageId: string, patch: Partial<ChatHistoryItem>) => {
      const applyPatch = (items: ChatHistoryItem[]) =>
        items.map((item) => (item.id === messageId ? { ...item, ...patch } : item));

      if (targetMode === mode) {
        setChatHistory((prev) => applyPatch(prev));
        return;
      }

      const next = applyPatch(readChatHistory(targetMode));
      try {
        window.sessionStorage.setItem(CHAT_HISTORY_CACHE_KEYS[targetMode], JSON.stringify(next));
      } catch {
        // ignore storage write errors
      }
    },
    [mode]
  );

  const generateAssistantFollowUpPrompts = useCallback(
    async (params: { question: string; answer: string; history: ChatHistoryItem[] }) => {
      const fallback = buildFollowUpPrompts(params.answer, params.history);
      if (!baseUrl || !apiKey || !model) {
        return fallback;
      }

      const recentTurns = params.history
        .filter((item) => item.role === 'user' || item.role === 'assistant')
        .slice(-6)
        .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.text.trim()}`)
        .filter(Boolean)
        .join('\n');

      try {
        const reply = await sendAiChat({
          baseUrl,
          apiKey,
          model,
          systemPrompt:
            '你是 AI 助手里的「继续追问建议生成器」。请基于最近对话、用户刚才的问题和助手本轮回答，生成 3 到 4 条像普通人随口追问的问题。只返回 JSON 数组，例如 ["问题1","问题2","问题3"]。要求：1) 全部用日常口语，像朋友聊天，不用书面词和专业词；2) 禁止出现这些词及其同类：口径、维度、样本、归因、结构化、验证、依据、趋势反转、资金面、显著性、复现、颗粒度、执行路径、优先级、周期对比、风险评估；3) 每条不超过 20 个字，越短越好；4) 尽量带上具体金额、日期、商家、分类这些真实信息；5) 都从「我」的角度问自己的事，例如“这 330 是微信付的吗？”；6) 三条角度不同，可以是确认一件事、下一步怎么做、会不会出问题；7) 不要出现「如果你愿意」「我可以帮你」这类助手口吻，也不要问「还有什么可以帮你」。',
          messages: [
            {
              role: 'user',
              text: `最近对话：\n${recentTurns || '无'}\n\n用户刚才的问题：${params.question || '无'}\n\n助手本轮回答：${params.answer}\n\n请生成 3 到 4 条继续追问建议。`
            }
          ]
        });

        const prompts = parseAiFollowUpPrompts(reply.content);
        return prompts.length >= 2 ? prompts : fallback;
      } catch {
        return fallback;
      }
    },
    [apiKey, baseUrl, model]
  );

  const handleSaveCreditItem = useCallback(
    (creditItem: CreditExtractedItem, strategy: 'create' | 'update' = 'create') => {
      const payload = normalizeCreditDebtPayload(creditItem);
      if (strategy === 'update' && creditItem.matchedDebtId) {
        const existing = debts.find((item) => item.id === creditItem.matchedDebtId);
        if (existing) {
          updateDebt(creditItem.matchedDebtId, {
            ...existing,
            ...buildCreditDebtUpdatePatch(creditItem)
          });
        } else {
          updateDebt(creditItem.matchedDebtId, payload);
        }
      } else {
        const prefill = mapCreditItemToRepaymentPrefill(creditItem);
        if (!(Number(prefill.balance) > 0)) {
          navigate('/repayment-management', {
            state: { prefillDebt: prefill }
          });
          wb.setToastState(
            '还缺“剩余待还”金额,已带你到还款管理补齐;当前应还会保留为最低还款额。',
            'warning'
          );
          return;
        }
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
    [addDebt, debts, navigate, updateDebt, wb]
  );

  const focusCreditComposer = useCallback(
    (title: string) => {
      const prompt = `补充${title || '这笔信贷'}:`;
      wb.setTextInput(prompt);
      window.setTimeout(() => {
        // 直接用 ref,不要再靠 aria-label 文本去 querySelector:
        // aria-label 现在会跟着界面语言变,用中文串当选择器在英文界面下会找不到元素。
        const composer = wb.textareaRef.current;
        composer?.focus();
        composer?.setSelectionRange(prompt.length, prompt.length);
      }, 0);
    },
    [wb]
  );

  const handleDeleteMatchedDebt = useCallback(
    (creditItem: CreditExtractedItem) => {
      if (!creditItem.matchedDebtId) return;
      removeDebt(creditItem.matchedDebtId);
      wb.setToastState(
        `已删除“${creditItem.matchedDebtName || creditItem.title}”对应负债`,
        'warning'
      );
    },
    [removeDebt, wb]
  );

  const handlePromoteCreditDraft = useCallback(
    (draftId: string) => {
      const draft = creditDrafts.find((item) => item.id === draftId);
      if (!draft) {
        wb.setToastState('这条草稿已经不存在,请刷新后重试。', 'warning');
        return;
      }
      if (!isCreditDraftReady(draft)) {
        wb.setToastState(
          `还缺${getCreditDraftPendingFields(draft).join('、') || '必要字段'},补齐后才能转为正式负债。`,
          'warning'
        );
        return;
      }
      addDebt(creditDraftToDebt(draft));
      removeCreditDraft(draft.id);
      wb.setToastState(`已将“${draft.name || '信贷草稿'}”转为正式负债`, 'success');
    },
    [addDebt, creditDrafts, removeCreditDraft, wb]
  );

  const handleDeleteCreditDraft = useCallback(
    (draftId: string) => {
      const draft = creditDrafts.find((item) => item.id === draftId);
      if (!draft) return;
      removeCreditDraft(draftId);
      wb.setToastState(`已删除草稿“${draft.name || '待确认项目'}”`, 'warning');
    },
    [creditDrafts, removeCreditDraft, wb]
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
      const resolved = resolveQuickRepayAmount(creditItem, matchedDebt);
      if (!resolved) {
        wb.setToastState(
          matchedDebt.balance <= 0
            ? '这笔负债已结清，无需再登记还款。'
            : '当前应还金额还不够稳定，先补全金额后再登记还款。',
          'warning'
        );
        return;
      }
      const amount = resolved.amount;
      const minimumPayment = calculateDebtMinimumPayment(matchedDebt);
      const nextBalance = Math.max(0, roundMoney(matchedDebt.balance - amount));
      const shouldAdvancePeriod = amount >= Math.max(1, minimumPayment * 0.98);
      const nextPaidPeriods = matchedDebt.totalPeriods
        ? Math.min(
            matchedDebt.totalPeriods,
            (matchedDebt.paidPeriods || 0) + (shouldAdvancePeriod ? 1 : 0)
          )
        : matchedDebt.paidPeriods;
      const nextRemainingMonths =
        typeof matchedDebt.remainingMonths === 'number'
          ? Math.max(0, matchedDebt.remainingMonths - (shouldAdvancePeriod ? 1 : 0))
          : matchedDebt.remainingMonths;
      const paymentAccount =
        creditItem.repaymentGapSummary?.paymentAccountSummary ||
        matchedDebt.paymentAccount ||
        undefined;

      addRepaymentRecord({
        debtId: creditItem.matchedDebtId,
        amount,
        paidAt: todayLocalDateKey(),
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
      wb.setToastState(
        `已为“${creditItem.title}”快速登记一笔 ¥${amount.toFixed(2)} 还款记录，并同步回写剩余待还`,
        'success'
      );
    },
    [addRepaymentRecord, debts, updateDebt, wb]
  );

  const buildAssistantMessageText = useCallback(
    (responseMode: AssistantMode) => {
      if (responseMode === 'assistant' && wb.entries.length > 0) {
        const entries = wb.entries;
        if (entries.length === 1) {
          const entry = entries[0];
          const normalizedCurrency = normalizeLedgerCurrency(entry.currency);
          const displayCurrency =
            isSupportedLedgerCurrency(normalizedCurrency) && normalizedCurrency !== 'UNKNOWN'
              ? normalizedCurrency
              : 'CNY';
          const amount = formatMoneyByCurrency(entry.amount, displayCurrency);
          const description = entry.note?.trim() || entry.category || '这笔账';
          return `记下了：${description}，${entry.type === 'income' ? '收入' : '支出'} ${amount}。确认一下分类和账户，没问题就保存到账本吧。`;
        }

        const total = entries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
        return `我整理好了 ${entries.length} 笔账单，合计 ¥${total.toFixed(2)}。你可以先检查每笔的备注、分类和账户，确认后再一起保存。`;
      }
      const fallbackFromReasoning = wb.rawReasoning
        ? '模型已返回思考过程，但还没有输出正式回复。'
        : '';
      // 模型只回思考、没有正文时,给一句能指导下一步的提示,而不是内部口吻的占位。
      const reasoningOnlyNotice =
        wb.rawReasoning && !wb.rawContent.trim()
          ? '模型这次只输出了思考过程,还没有给出结论。点「重试」可重新生成,或换个模型再问一次。'
          : fallbackFromReasoning;
      if (responseMode === 'credit') {
        return buildCreditAssistantMessageText(wb.rawContent) || reasoningOnlyNotice;
      }
      return wb.rawContent || reasoningOnlyNotice;
    },
    [wb.entries, wb.rawContent, wb.rawReasoning]
  );

  const submitPrompt = (prompt: string, options: SubmitPromptOptions = {}) => {
    if (submitInFlightRef.current) return;

    const clean = prompt.trim();
    const imagePayload = [...(options.imageDataUrls ?? wb.imageDataUrls)];
    const pdfPayload = [...(options.pdfDataUrls ?? wb.pdfDataUrls)];
    const hasAttachments = imagePayload.length > 0 || pdfPayload.length > 0;
    if (!clean && !hasAttachments) return;
    if (!wb.hasApiKey) {
      wb.setToastState('请先配置 API Key', 'warning');
      return;
    }
    if (!model.trim()) {
      wb.setToastState('请先选择模型', 'warning');
      return;
    }

    const requestQuestion = clean || '请根据我上传的附件完成识别与提炼。';
    // 合并后的 AI 模式:带附件走账单识别;纯文本走 Agent 对话,可直接增删改账单。
    const recognizeTask: 'bill' | 'chat' = mode === 'assistant' && hasAttachments ? 'bill' : 'chat';
    // AI 助手在纯文本对话里启用账本/账户 Agent;信贷管家启用负债与还款台账 Agent。
    const agentEnabled = mode === 'credit' || (mode === 'assistant' && recognizeTask === 'chat');
    const requestPrompt =
      recognizeTask === 'bill'
        ? requestQuestion
        : mode === 'credit'
          ? buildCreditConversationPrompt(requestQuestion, chatHistory)
          : buildAssistantConversationPrompt(requestQuestion, chatHistory);
    submitInFlightRef.current = true;
    if (agentEnabled) wb.resetAgentActions();
    const recognitionTurn = recognitionTurnRef.current + 1;
    recognitionTurnRef.current = recognitionTurn;
    pendingRequestModeRef.current = mode;
    lastAssistantRef.current[mode] = '';
    if (options.appendUserMessage !== false) {
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
    }
    wb.setTextInput('');
    setComposerFocused(false);
    wb.textareaRef.current?.blur();
    void Promise.resolve(
      wb.handleRecognizeWithPrompt(
        requestPrompt,
        {
          imageDataUrls: imagePayload,
          pdfDataUrls: pdfPayload
        },
        { task: recognizeTask, agent: agentEnabled }
      )
    ).finally(() => {
      submitInFlightRef.current = false;
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitPrompt(wb.textInput);
  };

  const openModelPicker = useCallback(
    (source: 'command' | 'toolbar') => {
      setModelOpen(true);
      setModelPickerSource(source);
      if (!wb.loadingModels) {
        void wb.handleLoadModels();
      }
    },
    [wb]
  );

  const restoreModelPickerFocus = useCallback(
    (source: 'command' | 'toolbar' | null) => {
      requestAnimationFrame(() => {
        if (source === 'command') {
          wb.textareaRef.current?.focus();
          return;
        }
        modelTriggerRef.current?.focus();
      });
    },
    [wb]
  );

  const closeModelPicker = useCallback(
    (restoreFocus = true) => {
      const source = modelPickerSource;
      setModelOpen(false);
      setModelPickerSource(null);
      if (restoreFocus) restoreModelPickerFocus(source);
    },
    [modelPickerSource, restoreModelPickerFocus]
  );

  const focusModelOption = useCallback((index: number) => {
    const options =
      modelMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!options?.length) return;
    const safeIndex =
      index < 0 ? options.length - 1 : Math.min(Math.max(index, 0), options.length - 1);
    options[safeIndex]?.focus();
  }, []);

  const handleSelectModel = useCallback(
    (nextModel: string) => {
      const source = modelPickerSource;
      setModel(nextModel);
      if (source === 'command') {
        const mentionPattern = /(^|\s)@([^\s@]*)$/;
        const nextInput = wb.textInput.replace(
          mentionPattern,
          (_match, prefix) => `${prefix}@${getModelDisplayLabel(nextModel)} `
        );
        wb.setTextInput(nextInput);
      }
      setModelOpen(false);
      setModelPickerSource(null);
      restoreModelPickerFocus(source);
    },
    [modelPickerSource, restoreModelPickerFocus, setModel, wb]
  );

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      modelOpen &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Escape')
    ) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModelPicker(false);
      } else {
        event.preventDefault();
        focusModelOption(event.key === 'ArrowDown' ? 0 : -1);
      }
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!wb.canRecognize || wb.status === 'recognizing') return;
    submitPrompt(wb.textInput);
  };

  const onModelMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    );
    if (!options.length) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModelPicker();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModelPicker();
      return;
    }
    if (event.key === 'Tab') {
      setModelOpen(false);
      setModelPickerSource(null);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    if (event.key === 'ArrowDown')
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
    if (event.key === 'ArrowUp') {
      nextIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
    }
    options[nextIndex]?.focus();
  };

  const syncTextareaHeight = useCallback(() => {
    const el = wb.textareaRef.current;
    if (!el) return;

    if (!regularComposerExpanded) {
      el.style.height = '36px';
      el.style.overflowY = 'hidden';
      return;
    }

    const isEmpty = !el.value.trim();
    const minHeight = isEmpty ? 56 : 40;
    const maxHeight = 170;

    // Reset first so it can shrink.
    el.style.height = '0px';
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [regularComposerExpanded, wb.textareaRef]);

  useEffect(() => {
    // Defer to ensure DOM updated with latest value.
    requestAnimationFrame(syncTextareaHeight);
  }, [syncTextareaHeight, wb.textInput]);

  useEffect(() => {
    const commandMatch = /(^|\s)@([^\s@]*)$/.exec(wb.textInput);
    if (commandMatch) {
      if (!modelOpen || modelPickerSource !== 'command') {
        openModelPicker('command');
      }
      return;
    }

    if (modelPickerSource === 'command') {
      setModelOpen(false);
      setModelPickerSource(null);
    }
  }, [modelOpen, modelPickerSource, openModelPicker, wb.textInput]);

  useEffect(() => {
    if (!modelOpen || modelPickerSource !== 'toolbar' || wb.models.length === 0) return;
    requestAnimationFrame(() => {
      const selectedIndex = Math.max(
        0,
        wb.models.findIndex((item) => item === model)
      );
      focusModelOption(selectedIndex);
    });
  }, [focusModelOption, model, modelOpen, modelPickerSource, wb.models]);

  // 非记账分析时，模型返回自由文本，解析 JSON 失败属于预期，不展示底部红条。
  const shouldShowError = Boolean(wb.error);
  // 只有当错误里确实有比摘要更多的内容时才值得展开“详情”,避免同文重复展示。
  const hasErrorDetail =
    shouldShowError && (wb.error.includes('\n') || wb.error.trim().length > 60);

  useEffect(() => {
    const responseMode = pendingRequestModeRef.current;
    if (wb.status === 'recognizing') {
      setStreamingPreviewMessage(wb.rawContent);
      setStreamingPreviewReasoning(wb.rawReasoning);
      const segments = splitStreamingSegments(wb.rawContent);
      setStreamingCommittedSegments(segments.committed);
      setStreamingDraftSegment(segments.draft);
      return;
    }

    const currentRecognitionTurn = recognitionTurnRef.current;
    if (
      currentRecognitionTurn > 0 &&
      currentRecognitionTurn <= renderedRecognitionTurnRef.current
    ) {
      return;
    }

    const messageText = buildAssistantMessageText(responseMode);
    if (!messageText || messageText === lastAssistantRef.current[responseMode]) return;
    if (currentRecognitionTurn > 0) {
      renderedRecognitionTurnRef.current = currentRecognitionTurn;
    }

    const flushedSegments = splitStreamingSegments(wb.rawContent);
    setStreamingCommittedSegments(flushedSegments.committed);
    setStreamingDraftSegment(flushedSegments.draft);
    lastAssistantRef.current[responseMode] = messageText;
    setStreamingPreviewMessage('');
    setStreamingPreviewReasoning('');
    setStreamingCommittedSegments([]);
    setStreamingDraftSegment('');
    const usageText = wb.lastUsage
      ? `Token 消耗：输入 ${wb.lastUsage.promptTokens} / 输出 ${wb.lastUsage.completionTokens} / 总计 ${wb.lastUsage.totalTokens}`
      : undefined;
    const embeddingSummaryText =
      showEmbeddingSummary && wb.embeddingDebug.enabled
        ? wb.embeddingDebug.used
          ? `语义召回：命中 ${wb.embeddingDebug.hitCount} 条，最高相似度 ${wb.embeddingDebug.topScore.toFixed(2)}，平均相似度 ${wb.embeddingDebug.averageScore.toFixed(2)}，耗时 ${wb.embeddingDebug.latencyMs}ms，索引 ${wb.embeddingDebug.indexedDocs} 条。`
          : wb.embeddingDebug.downgraded
            ? EMBEDDING_DEGRADED_SUMMARY
            : `语义召回未命中可用上下文（耗时 ${wb.embeddingDebug.latencyMs}ms）。`
        : undefined;

    const embeddingDebugText =
      showEmbeddingDebug && wb.embeddingDebug.enabled
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

    const assistantMessageId = `${Date.now()}-assistant`;
    appendMessageToMode(responseMode, {
      id: assistantMessageId,
      role: 'assistant',
      text: messageText,
      usageText,
      reasoningText: wb.rawReasoning || undefined,
      embeddingSummaryText,
      embeddingSummaryIsError: Boolean(
        showEmbeddingSummary && wb.embeddingDebug.enabled && wb.embeddingDebug.downgraded
      ),
      embeddingDebugText,
      followUpPrompts:
        responseMode === 'credit' ? buildCreditFollowUpPrompts(creditItems || []) : undefined,
      creditItems,
      agentActions: wb.agentActions.length > 0 ? wb.agentActions : undefined
    });

    if (responseMode === 'assistant') {
      const latestUserQuestion =
        [...chatHistory]
          .reverse()
          .find((item) => item.role === 'user')
          ?.text?.trim() || '';
      void generateAssistantFollowUpPrompts({
        question: latestUserQuestion,
        answer: messageText,
        history: chatHistory
      }).then((prompts) => {
        if (!prompts.length) return;
        updateMessageInMode(responseMode, assistantMessageId, {
          followUpPrompts: prompts
        });
      });
    }
  }, [
    appendMessageToMode,
    buildAssistantMessageText,
    chatHistory,
    debts,
    generateAssistantFollowUpPrompts,
    repaymentRecords,
    showEmbeddingDebug,
    showEmbeddingSummary,
    updateMessageInMode,
    wb.embeddingDebug,
    wb.agentActions,
    wb.lastUsage,
    wb.rawContent,
    wb.rawReasoning,
    wb.status
  ]);

  const removeMessage = (id: string) =>
    setChatHistory((prev) => prev.filter((item) => item.id !== id));

  const setMessageFeedback = useCallback(
    (messageId: string, feedback: ChatHistoryItem['feedback']) => {
      const current = chatHistory.find((item) => item.id === messageId);
      if (!current) return;
      updateMessageInMode(mode, messageId, {
        feedback: current.feedback === feedback ? undefined : feedback
      });
    },
    [chatHistory, mode, updateMessageInMode]
  );

  /** 撤销 Agent 刚执行的记账/改账/删账,并从消息里移除该条操作记录。 */
  const undoAgentActionItem = useCallback(
    (messageId: string, actionId: string) => {
      const current = chatHistory.find((item) => item.id === messageId);
      if (!current?.agentActions?.length) return;
      if (!wb.undoAgentAction(actionId)) return;
      updateMessageInMode(mode, messageId, {
        agentActions: current.agentActions.filter((action) => action.id !== actionId)
      });
    },
    [chatHistory, mode, updateMessageInMode, wb]
  );

  const retryMessage = (index: number) => {
    const previousUser = [...chatHistory]
      .slice(0, index)
      .reverse()
      .find((item) => item.role === 'user');
    if (!previousUser) return;
    submitPrompt(previousUser.text === '（仅发送附件）' ? '' : previousUser.text, {
      imageDataUrls: previousUser.imageDataUrls || [],
      pdfDataUrls: previousUser.pdfDataUrls || [],
      appendUserMessage: false
    });
  };

  const retryLastPrompt = () => {
    const latestUser = [...chatHistory].reverse().find((item) => item.role === 'user');
    if (!latestUser) return;
    submitPrompt(latestUser.text === '（仅发送附件）' ? '' : latestUser.text, {
      imageDataUrls: latestUser.imageDataUrls || [],
      pdfDataUrls: latestUser.pdfDataUrls || [],
      appendUserMessage: false
    });
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

  const todayLabel = useMemo(() => {
    const language = i18n?.language?.startsWith('en') ? 'en-US' : 'zh-CN';
    return new Intl.DateTimeFormat(language, {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short'
    }).format(new Date());
  }, [i18n?.language]);

  const assistantGreeting = useMemo(() => {
    const dateTemplate = tf('assistant.greeting.date', '今天 {{date}}，');
    const greetingText = tf(
      'assistant.greeting.assistant',
      '记账、查账、改账都可以直接说，我先给结论。'
    );
    return `${dateTemplate.split('{{date}}').join(todayLabel)}${greetingText}`;
  }, [tf, todayLabel]);

  const creditGreeting = useMemo(
    () =>
      tf(
        'assistant.greeting.credit',
        '把花呗、分期、贷款或信用账单交给我，我先帮你拆出应还金额、时间点和待补信息。'
      ),
    [tf]
  );

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
          JSON.stringify(chatHistoryRef.current)
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
      window.sessionStorage.setItem(
        CHAT_HISTORY_CACHE_KEYS[activeHistoryModeRef.current],
        JSON.stringify(chatHistory)
      );
    } catch {
      // ignore storage write errors
    }
  }, [chatHistory]);

  const selectAssistantMode = (nextMode: AssistantMode) => {
    setMode(nextMode);
  };

  const onModeTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: AssistantMode
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = ASSISTANT_MODE_ORDER.indexOf(currentMode);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ASSISTANT_MODE_ORDER.length - 1;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % ASSISTANT_MODE_ORDER.length;
    }
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + ASSISTANT_MODE_ORDER.length) % ASSISTANT_MODE_ORDER.length;
    }

    const nextMode = ASSISTANT_MODE_ORDER[nextIndex];
    selectAssistantMode(nextMode);
    requestAnimationFrame(() => modeTabRefs.current[nextMode]?.focus());
  };

  return (
    <div
      className="chat-fullscreen"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void wb.handleDropImage(e)}
    >
      <header className="chat-topbar chat-topbar-no-title">
        <div className="chat-mode-switch" aria-label={tf('assistant.modeSwitch', '模式切换')}>
          <div className="chat-mode-switch-options" role="tablist" aria-label={tf('assistant.modeAria', 'AI 助手模式')}>
            <button
              ref={(node) => {
                modeTabRefs.current.assistant = node;
              }}
              type="button"
              role="tab"
              aria-selected={mode === 'assistant'}
              tabIndex={mode === 'assistant' ? 0 : -1}
              className={mode === 'assistant' ? 'active' : ''}
              onClick={() => selectAssistantMode('assistant')}
              onKeyDown={(event) => onModeTabKeyDown(event, 'assistant')}
            >
              {t('assistant.ui.assistantMode')}
            </button>
            <button
              ref={(node) => {
                modeTabRefs.current.credit = node;
              }}
              type="button"
              role="tab"
              aria-selected={mode === 'credit'}
              tabIndex={mode === 'credit' ? 0 : -1}
              className={mode === 'credit' ? 'active' : ''}
              onClick={() => selectAssistantMode('credit')}
              onKeyDown={(event) => onModeTabKeyDown(event, 'credit')}
            >
              {t('assistant.ui.creditMode')}
            </button>
            <button
              ref={(node) => {
                modeTabRefs.current.investment = node;
              }}
              type="button"
              role="tab"
              aria-selected={mode === 'investment'}
              tabIndex={mode === 'investment' ? 0 : -1}
              className={mode === 'investment' ? 'active' : ''}
              onClick={() => selectAssistantMode('investment')}
              onKeyDown={(event) => onModeTabKeyDown(event, 'investment')}
            >
              {t('assistant.ui.investmentMode')}
            </button>
          </div>
        </div>

        <div className="chat-topbar-right">
          {wb.semanticRecallCacheMeta.exists ? (
            <button
              type="button"
              className="chat-icon-topbar-btn"
              onClick={() => setSemanticPanelOpen(true)}
              aria-label={tf('assistant.semanticRecall', '语义召回')}
              title={`语义召回 · ${wb.semanticRecallCacheMeta.indexedDocs} 条`}
            >
              {tf('assistant.modelShortLabel', '语')}
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

      {mode === 'investment' ? (
        <div className="chat-investment-mode-content">
          <InvestmentChatPanel showHero showComposer defaultWebEnabled />
        </div>
      ) : (
        <>
          <section
            className={`chat-messages-area ${isWideLayout ? 'is-wide' : ''}`}
            ref={messagesAreaRef}
          >
            <div className={`chat-messages-inner ${isWideLayout ? 'is-wide' : ''}`}>
              {!wb.hasApiKey ? (
                <section className="chat-key-required">
                  <div className="chat-key-required-icon" aria-hidden="true">
                    ⌁
                  </div>
                  <div className="chat-key-required-copy">
                    <h3>{t('assistant.ui.needApiKeyTitle')}</h3>
                    <p>{t('assistant.ui.needApiKeyDesc')}</p>
                  </div>
                  <Link className="chat-key-required-link" to="/settings">
                    {t('assistant.ui.goSettings')}
                  </Link>
                </section>
              ) : null}

              {mode === 'credit' ? (
                <section
                  className="chat-mode-welcome chat-credit-welcome"
                  aria-label={tf('assistant.creditWelcome.sectionAria', 'AI 信贷管家')}
                >
                  <div className="chat-mode-welcome-copy">
                    <div className="chat-mode-welcome-eyebrow">
                      {tf('assistant.creditWelcome.eyebrowBrand', 'AI 信贷管家')} <span>·</span>{' '}
                      {tf('assistant.creditWelcome.eyebrowScope', '从看清开始')}
                    </div>
                    <h2>
                      {tf('assistant.creditWelcome.headlineLead', '每一笔该还什么，')}
                      <em>{tf('assistant.creditWelcome.headlineAccent', '心里都有数')}</em>
                    </h2>
                    <div className="chat-mode-welcome-features">
                      <div>
                        <b>01</b>
                        <span>{tf('assistant.creditWelcome.featureBillTitle', '识别账单')}</span>
                      </div>
                      <div>
                        <b>02</b>
                        <span>{tf('assistant.creditWelcome.featureDueTitle', '核对本期应还')}</span>
                      </div>
                      <div>
                        <b>03</b>
                        <span>{tf('assistant.creditWelcome.featureLogTitle', '登记与核对')}</span>
                      </div>
                    </div>
                  </div>
                  {shouldShowIntroIllustration ? (
                    <img
                      className="chat-mode-welcome-illustration chat-credit-illustration"
                      src={ASSISTANT_INTRO_ILLUSTRATION_URL}
                      alt=""
                      aria-hidden="true"
                    />
                  ) : null}
                </section>
              ) : (
                <section
                  className="chat-mode-welcome chat-general-welcome"
                  aria-label={tf('assistant.welcome.sectionAria', 'AI 助手')}
                >
                  <div className="chat-mode-welcome-copy">
                    <div className="chat-mode-welcome-eyebrow">
                      {tf('assistant.welcome.eyebrowBrand', 'AI 助手')} <span>·</span>{' '}
                      {tf('assistant.welcome.eyebrowScope', '记账、问答、改账')}
                    </div>
                    <h2>
                      {tf('assistant.welcome.headlineLead', '记一笔、查一笔，')}
                      <em>{tf('assistant.welcome.headlineAccent', '直接说就行')}</em>
                    </h2>
                    <div className="chat-mode-welcome-features">
                      <div>
                        <b>01</b>
                        <span>{tf('assistant.welcome.featureVoiceNlTitle', '一句话记账')}</span>
                      </div>
                      <div>
                        <b>02</b>
                        <span>{tf('assistant.welcome.featureOcrTitle', '截图识别')}</span>
                      </div>
                      <div>
                        <b>03</b>
                        <span>{tf('assistant.welcome.featureEditTitle', '查账改账')}</span>
                      </div>
                    </div>
                    <div className="chat-mode-welcome-briefs">
                      {assistantOverview.monthlyBriefs.slice(0, 3).map((item) => (
                        <span key={item.key}>
                          <small>
                            {tf('assistant.welcome.briefPrefix', '本月')}
                            {tf(
                              item.labelKey,
                              item.key === 'expense'
                                ? '支出'
                                : item.key === 'income'
                                  ? '收入'
                                  : '结余'
                            )}
                          </small>
                          <b>{item.value}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  {shouldShowIntroIllustration ? (
                    <img
                      className="chat-mode-welcome-illustration"
                      src={ASSISTANT_INTRO_ILLUSTRATION_URL}
                      alt=""
                      aria-hidden="true"
                    />
                  ) : null}
                </section>
              )}

              <article className="chat-msg">
                {renderChatAvatar('assistant')}
                <div className="chat-msg-body">
                  <div className="chat-msg-header">
                    {mode === 'credit'
                      ? tf('assistant.ui.creditMode', 'AI 信贷管家')
                      : t('assistant.ui.qaAssistant')}
                  </div>
                  <div className="chat-msg-content">
                    <p>{mode === 'assistant' ? assistantGreeting : creditGreeting}</p>
                  </div>
                </div>
              </article>

              {mode === 'credit' && debts.length > 0 ? (
                <article className="chat-msg">
                  {renderChatAvatar('assistant')}
                  <div className="chat-msg-body">
                    <div className="chat-msg-header">{t('assistant.ui.creditOverviewTitle')}</div>
                    <div className="chat-credit-overview-card is-compact">
                      <div className="chat-credit-overview-grid is-compact">
                        <div className="is-primary">
                          <span>{t('assistant.ui.creditTotalDebt')}</span>
                          <strong>{formatCurrencyFixed2(creditOverview.totalDebt)}</strong>
                        </div>
                        <div>
                          <span>{t('assistant.ui.creditDueThisMonth')}</span>
                          <strong>{formatCurrencyFixed2(creditOverview.currentGap)}</strong>
                        </div>
                        <div>
                          <span>{t('assistant.ui.creditPaidThisMonth')}</span>
                          <strong>{formatCurrencyFixed2(creditOverview.totalPaidThisMonth)}</strong>
                        </div>
                      </div>
                      {creditOverview.dueSoonItems.length > 0 ? (
                        <div className="chat-credit-overview-due-list">
                          {creditOverview.dueSoonItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`chat-credit-overview-due-chip${item.isOverdue ? ' is-overdue' : ''}`}
                              onClick={() => navigate('/repayment-management')}
                            >
                              {item.name} ·{' '}
                              {item.isOverdue
                                ? t('assistant.ui.creditOverdueDays', {
                                    days: Math.abs(item.daysUntil)
                                  })
                                : item.daysUntil <= 0
                                  ? t('assistant.ui.creditDueToday')
                                  : t('assistant.ui.creditDueOn', {
                                      date: new Intl.DateTimeFormat(undefined, {
                                        month: 'short',
                                        day: 'numeric'
                                      }).format(item.nextDue)
                                    })}{' '}
                              · {formatCurrencyFixed2(item.minimumPayment)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <details className="chat-credit-overview-details">
                        <summary>{t('assistant.ui.creditMoreRepaymentData')}</summary>
                        <div className="chat-credit-overview-extra">
                          <span>
                            {t('assistant.ui.creditTotalDueThisMonth')}{' '}
                            <strong>{formatCurrencyFixed2(creditOverview.totalDueThisMonth)}</strong>
                          </span>
                          <span>
                            {t('assistant.ui.creditDebtCount')}{' '}
                            <strong>
                              {t('assistant.ui.creditDebtCountValue', {
                                total: creditOverview.debtCount
                              })}
                            </strong>
                          </span>
                          <span>
                            {t('assistant.ui.creditRemainingInterest')}{' '}
                            <strong>{formatCurrencyFixed2(creditOverview.totalRemainingInterest)}</strong>
                          </span>
                        </div>
                      </details>
                      <div className="chat-credit-actions">
                        <button
                          type="button"
                          className="chat-secondary-action-btn is-compact"
                          onClick={() => navigate('/repayment-management')}
                        >
                          {tf('assistant.actions.viewFullLedger', '查看完整台账')}
                        </button>
                        <button
                          type="button"
                          className="chat-secondary-action-btn is-compact"
                          onClick={() =>
                            submitPrompt(
                              '帮我看本月总应还、已还多少、还差多少，并指出最值得先处理的项目'
                            )
                          }
                        >
                          {tf('assistant.actions.continueSummary', '继续做汇总分析')}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ) : null}

              {mode === 'credit' && creditDrafts.length > 0 ? (
                <article className="chat-msg chat-credit-draft-msg">
                  {renderChatAvatar('assistant')}
                  <div className="chat-msg-body">
                    <div className="chat-msg-header">待{tf('assistant.actions.continueFilling', '继续补充')}</div>
                    <div className="chat-credit-drafts">
                      {creditDrafts.map((draft) => {
                        const pendingFields = getCreditDraftPendingFields(draft);
                        const ready = isCreditDraftReady(draft);
                        return (
                          <section key={draft.id} className="chat-credit-draft-card">
                            <div className="chat-credit-draft-head">
                              <div>
                                <strong>{draft.name || '待确认信贷项目'}</strong>
                                <span>
                                  {draft.type === 'loan'
                                    ? '贷款'
                                    : draft.type === 'consumer-loan'
                                      ? '消费贷'
                                      : '信用账单'}
                                </span>
                              </div>
                              <em className={ready ? 'is-ready' : ''}>
                                {ready ? '可转正' : '待补充'}
                              </em>
                            </div>
                            <div className="chat-credit-draft-fields">
                              {draft.balance !== undefined ? (
                                <span>
                                  {tf('assistant.ledger.totalOutstanding', '总待还')} <strong>{formatCurrencyFixed2(draft.balance)}</strong>
                                </span>
                              ) : null}
                              {draft.remainingMonths !== undefined ? (
                                <span>
                                  {tf('assistant.ledger.remaining', '剩余')} <strong>{draft.remainingMonths} 期</strong>
                                </span>
                              ) : null}
                              {draft.repaymentDay !== undefined ? (
                                <span>
                                  {tf('assistant.ledger.dueDay', '还款日')} <strong>{draft.repaymentDay} 号</strong>
                                </span>
                              ) : null}
                              {draft.monthlyAmount !== undefined ? (
                                <span>
                                  {tf('assistant.ledger.perPeriod', '每期')} <strong>{formatCurrencyFixed2(draft.monthlyAmount)}</strong>
                                </span>
                              ) : null}
                              {draft.dueAmount !== undefined ? (
                                <span>
                                  {tf('assistant.ledger.currentDue', '本期应还')} <strong>{formatCurrencyFixed2(draft.dueAmount)}</strong>
                                </span>
                              ) : null}
                            </div>
                            {pendingFields.length > 0 ? (
                              <div className="chat-credit-draft-pending">
                                <span>{tf('assistant.ledger.missing', '还缺')}</span>
                                {pendingFields.map((field) => (
                                  <b key={`${draft.id}-${field}`}>{field}</b>
                                ))}
                              </div>
                            ) : null}
                            <div className="chat-credit-actions">
                              {ready ? (
                                <button
                                  type="button"
                                  className="chat-secondary-action-btn"
                                  onClick={() => handlePromoteCreditDraft(draft.id)}
                                >
                                  {tf('assistant.actions.convertToDebt', '转为正式负债')}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="chat-secondary-action-btn"
                                  onClick={() =>
                                    wb.setTextInput(`补充${draft.name || '这笔信贷'}：例如总共12期`)
                                  }
                                >
                                  {tf('assistant.actions.continueFilling', '继续补充')}
                                </button>
                              )}
                              <button
                                type="button"
                                className="chat-secondary-action-btn is-danger"
                                onClick={() => handleDeleteCreditDraft(draft.id)}
                              >
                                {tf('assistant.actions.remove', '移除')}
                              </button>
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </article>
              ) : null}

              {chatHistory.map((item, index) => (
                <article
                  key={item.id}
                  className={`chat-msg ${item.role === 'user' ? 'chat-msg-user' : ''}`}
                >
                  {renderChatAvatar(item.role === 'user' ? 'user' : 'assistant')}
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
                    {item.role === 'assistant' &&
                    item.agentActions &&
                    item.agentActions.length > 0 ? (
                      <div className="chat-agent-actions">
                        <div className="chat-agent-actions-head">
                          {item.agentActions.some((action) => action.kind !== 'read')
                            ? '本次操作结果'
                            : '本次查询结果'}
                        </div>
                        {item.agentActions.map((action) => (
                          <div key={action.id} className={`chat-agent-action is-${action.kind}`}>
                            <span>{action.label}</span>
                            {action.undoable ? (
                              <button
                                type="button"
                                className="chat-agent-action-undo"
                                onClick={() => undoAgentActionItem(item.id, action.id)}
                              >
                                {tf('assistant.actions.undo', '撤销')}
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {item.role === 'assistant' &&
                    item.creditItems &&
                    item.creditItems.length > 0 ? (
                      <div className="chat-credit-cards">
                        {enrichCreditItemsForConfirmation(
                          item.creditItems,
                          chatHistory,
                          debts,
                          repaymentRecords
                        ).map((creditItem) => (
                          <section key={creditItem.id} className="chat-credit-card">
                            <div className="chat-credit-card-head">
                              <div>
                                <strong>{creditItem.title}</strong>
                                <span>{creditItem.productType}</span>
                              </div>
                              <em
                                className={`chat-credit-state ${
                                  creditItem.confirmationState === 'ready'
                                    ? 'is-ready'
                                    : 'is-pending'
                                }`}
                              >
                                {creditItem.confirmationState === 'ready' ? '可确认' : '待补充'}
                              </em>
                            </div>
                            <div className="chat-credit-card-summary">
                              <span>
                                {tf('assistant.ledger.totalOutstanding', '总待还')}
                                <strong>{creditItem.totalDebt || '待补充'}</strong>
                              </span>
                              <span>
                                {tf('assistant.ledger.currentDue', '本期应还')}
                                <strong>{creditItem.dueAmount || '待补充'}</strong>
                              </span>
                              <span>
                                {tf('assistant.ledger.dueDay', '还款日')}
                                <strong>{creditItem.repaymentDate || '待补充'}</strong>
                              </span>
                            </div>
                            {creditItem.mergedFromHistory ? (
                              <span className="chat-credit-history-note">{tf('assistant.duplicate.carriedOver', '已承接上轮补充')}</span>
                            ) : null}
                            {creditItem.pendingFields.length > 0 ? (
                              <p className="chat-credit-card-next">
                                已自动保留,下一步:补
                                {creditItem.pendingFields.slice(0, 3).join('、')}
                                {creditItem.pendingFields.length > 3 ? ' 等' : ''}
                              </p>
                            ) : (
                              <p className="chat-credit-card-next is-ready">
                                {tf('assistant.duplicate.readyToSave', '信息已齐,可以核对后保存。')}
                              </p>
                            )}
                            <div className="chat-credit-card-primary-actions">
                              <button
                                type="button"
                                className="chat-primary-action-btn"
                                onClick={() => {
                                  if (creditItem.confirmationState === 'ready') {
                                    setConfirmingCreditId(creditItem.id);
                                    return;
                                  }
                                  focusCreditComposer(creditItem.title);
                                }}
                              >
                                {creditItem.confirmationState === 'ready'
                                  ? '核对并保存'
                                  : '继续补充'}
                              </button>
                              <button
                                type="button"
                                className="chat-secondary-action-btn is-compact"
                                onClick={() =>
                                  navigate('/repayment-management', {
                                    state: {
                                      prefillDebt: mapCreditItemToRepaymentPrefill(creditItem),
                                      editingDebtId: creditItem.matchedDebtId
                                    }
                                  })
                                }
                              >
                                {tf('assistant.actions.openRepayment', '去还款管理')}
                              </button>
                            </div>
                            <details className="chat-credit-card-details">
                              <summary>{tf('assistant.actions.viewRecognitionDetail', '查看识别明细')}</summary>
                              <div className="chat-credit-progress" aria-label={tf('assistant.fieldFillProgress', '字段补全进度')}>
                                <div className="chat-credit-progress-head">
                                  <span>{creditItem.completionLabel || '0/7 项字段已补齐'}</span>
                                  <strong>{creditItem.completionRatio || 0}%</strong>
                                </div>
                                <div className="chat-credit-progress-track">
                                  <span style={{ width: `${creditItem.completionRatio || 0}%` }} />
                                </div>
                                {creditItem.bindingProgressText ? (
                                  <div className="chat-credit-binding-note">
                                    <strong>
                                      {creditItem.draftCreditId || creditItem.identityKey}
                                    </strong>
                                    <span>{creditItem.bindingProgressText}</span>
                                    {creditItem.matchReason ? (
                                      <small>{creditItem.matchReason}</small>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              <div className="chat-credit-grid">
                                {renderCreditField(
                                  '当前应还',
                                  creditItem.dueAmount,
                                  creditItem.fieldMeta?.dueAmount
                                )}
                                {renderCreditField(
                                  '剩余待还',
                                  creditItem.totalDebt,
                                  creditItem.fieldMeta?.totalDebt
                                )}
                                {renderCreditField(
                                  '还款日',
                                  creditItem.repaymentDate,
                                  creditItem.fieldMeta?.repaymentDate
                                )}
                                {renderCreditField(
                                  '剩余期数',
                                  creditItem.remainingPeriods,
                                  creditItem.fieldMeta?.remainingPeriods
                                )}
                                {renderCreditField(
                                  '每期金额',
                                  creditItem.monthlyAmount,
                                  creditItem.fieldMeta?.monthlyAmount
                                )}
                                {renderCreditField(
                                  '利息/费率',
                                  creditItem.interest,
                                  creditItem.fieldMeta?.interest
                                )}
                              </div>
                              {creditItem.rateType ||
                              creditItem.rateSource ||
                              creditItem.riskHint ||
                              creditItem.actionSuggestion ? (
                                <div className="chat-credit-pending" style={{ marginTop: 10 }}>
                                  {creditItem.rateType || creditItem.rateSource ? (
                                    <div>
                                      <span>{tf('assistant.ledger.rateBasis', '利率口径：')}</span>
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
                                      <span>{tf('assistant.ledger.riskNote', '风险提示：')}</span>
                                      <strong>{creditItem.riskHint}</strong>
                                    </div>
                                  ) : null}
                                  {creditItem.actionSuggestion ? (
                                    <div style={{ marginTop: 6 }}>
                                      <span>{tf('assistant.ledger.nextStep', '下一步：')}</span>
                                      <strong>{creditItem.actionSuggestion}</strong>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {creditItem.repaymentLookupSummary ? (
                                <div className="chat-credit-lookup-card">
                                  <div className="chat-credit-lookup-head">
                                    <div className="chat-credit-lookup-title-block">
                                      <strong>{tf('assistant.stream.repaymentSearchTitle', '还款检索结果')}</strong>
                                      <span>
                                        {creditItem.repaymentLookupSummary.matchedDebtName ||
                                          '未稳定命中已保存负债'}
                                      </span>
                                    </div>
                                    <em className="chat-credit-lookup-status">
                                      {creditItem.repaymentLookupSummary.recordStatusText ||
                                        '待确认'}
                                    </em>
                                  </div>
                                  <div className="chat-credit-lookup-grid">
                                    <div>
                                      <span>{tf('assistant.stream.plannedDue', '计划中的应还')}</span>
                                      <strong>
                                        {creditItem.repaymentLookupSummary.plannedRepaymentText ||
                                          '待确认'}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>计划 / 实际{tf('transactions.table.col.account', '账户')}</span>
                                      <strong>
                                        {formatCreditAccountReference(
                                          creditItem.repaymentLookupSummary.paymentAccountText,
                                          accounts
                                        ) || '待确认'}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.stream.recentPaid', '最近已还')}流水</span>
                                      <strong>
                                        {creditItem.repaymentLookupSummary.actualRepaymentText ||
                                          '暂无命中'}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.stream.recordStatus', '流水状态')}</span>
                                      <strong>
                                        {creditItem.repaymentLookupSummary.recordStatusText ||
                                          '待确认'}
                                      </strong>
                                    </div>
                                  </div>
                                  {creditItem.repaymentLookupSummary.lookupHint ? (
                                    <div className="chat-credit-lookup-hint">
                                      {creditItem.repaymentLookupSummary.lookupHint}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {creditItem.repaymentGapSummary ? (
                                <div className="chat-credit-gap-card">
                                  <div className="chat-credit-gap-head">
                                    <strong>{tf('assistant.stream.planVsActual', '计划 vs 实际')}</strong>
                                    <span>
                                      {creditItem.repaymentGapSummary.statusText ||
                                        '先看有没有缺口'}
                                    </span>
                                  </div>
                                  <div className="chat-credit-gap-grid">
                                    <div>
                                      <span>{tf('assistant.stream.plannedAmountDue', '计划应还')}</span>
                                      <strong>
                                        {creditItem.repaymentGapSummary.plannedDueAmount ||
                                          '待确认'}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.stream.recentPaid', '最近已还')}</span>
                                      <strong>
                                        {creditItem.repaymentGapSummary.recentActualPaidAmount ||
                                          '暂无记录'}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.ledger.stillShort', '当前还差')}</span>
                                      <strong>
                                        {creditItem.repaymentGapSummary.gapAmount || '0'}
                                      </strong>
                                    </div>
                                    <div>
                                      <span>扣款/还款{tf('transactions.table.col.account', '账户')}</span>
                                      <strong>
                                        {formatCreditAccountReference(
                                          creditItem.repaymentGapSummary.paymentAccountSummary,
                                          accounts
                                        ) || '待确认'}
                                      </strong>
                                    </div>
                                  </div>
                                  {creditItem.repaymentGapSummary.explanationItems &&
                                  creditItem.repaymentGapSummary.explanationItems.length > 0 ? (
                                    <div className="chat-credit-gap-points">
                                      {creditItem.repaymentGapSummary.explanationItems.map(
                                        (point: string) => (
                                          <span key={`${creditItem.id}-${point}`}>
                                            {formatCreditAccountReference(point, accounts)}
                                          </span>
                                        )
                                      )}
                                    </div>
                                  ) : null}
                                  <div className="chat-credit-gap-reason">
                                    {formatCreditAccountReference(
                                      creditItem.repaymentGapSummary.gapReason,
                                      accounts
                                    )}
                                  </div>
                                  {creditItem.repaymentGapSummary.shortfallAction ? (
                                    <div className="chat-credit-gap-action">
                                      {formatCreditAccountReference(
                                        creditItem.repaymentGapSummary.shortfallAction,
                                        accounts
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </details>
                            {confirmingCreditId === creditItem.id ? (
                              <div className="chat-credit-confirmation">
                                <div className="chat-credit-confirmation-head">
                                  <strong>{tf('assistant.actions.confirmBeforeSave', '保存前确认')}</strong>
                                  <span>
                                    {creditItem.pendingFields.length === 0
                                      ? '字段基本齐全'
                                      : '建议确认后再保存'}
                                  </span>
                                </div>
                                <div className="chat-credit-confirmation-list">
                                  {(creditItem.confirmationSummary || []).map((row) => (
                                    <div
                                      key={`${creditItem.id}-${row}`}
                                      className="chat-credit-confirmation-row"
                                    >
                                      {row}
                                    </div>
                                  ))}
                                </div>
                                {creditItem.conflictHint ? (
                                  <div className="chat-credit-conflict-hint">
                                    {creditItem.conflictHint}
                                  </div>
                                ) : null}
                                {creditItem.conflictFields &&
                                creditItem.conflictFields.length > 0 ? (
                                  <div className="chat-credit-diff-card">
                                    <div className="chat-credit-diff-head">
                                      <strong>{tf('assistant.duplicate.diffTitle', '与已保存负债的差异')}</strong>
                                      <span>{creditItem.matchedDebtName || '已有负债'}</span>
                                    </div>
                                    <div className="chat-credit-diff-list">
                                      {creditItem.conflictFields.map((field) => (
                                        <div
                                          key={`${creditItem.id}-${field.label}`}
                                          className="chat-credit-diff-row"
                                        >
                                          <span>{field.label}</span>
                                          <div>
                                            <em>
                                              当前：
                                              {formatCreditAccountReference(
                                                field.currentValue,
                                                accounts
                                              )}
                                            </em>
                                            <strong>
                                              识别：
                                              {formatCreditAccountReference(
                                                field.nextValue,
                                                accounts
                                              )}
                                            </strong>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="chat-credit-actions">
                                  {creditItem.matchedDebtId &&
                                  creditItem.conflictFields &&
                                  creditItem.conflictFields.length > 0 ? (
                                    <button
                                      type="button"
                                      className="chat-secondary-action-btn"
                                      onClick={() => handleSaveCreditItem(creditItem, 'update')}
                                    >
                                      {tf('assistant.actions.updateExistingDebt', '更新已有负债')}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="chat-secondary-action-btn"
                                      onClick={() => handleSaveCreditItem(creditItem)}
                                    >
                                      确认{tf('assistant.actions.saveToRepayment', '保存到还款管理')}
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
                                    {tf('assistant.actions.continueFilling', '继续补充')}后保存
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
                                      wb.setToastState(
                                        '已按新项目另存，不与已有负债自动合并。',
                                        'warning'
                                      );
                                    }}
                                  >
                                    {tf('assistant.actions.saveAsNewDebt', '另存为新负债')}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            <details
                              className="chat-credit-more-actions"
                              hidden={!creditItem.matchedDebtId}
                            >
                              <summary>{tf('assistant.actions.more', '更多操作')}</summary>
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
                                  {tf('assistant.actions.saveAsRecognized', '按当前识别保存')}
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
                                  {creditItem.matchedDebtId ? '编辑这笔负债' : '带去还款管理'}
                                </button>
                                {creditItem.matchedDebtId ? (
                                  <>
                                    <button
                                      type="button"
                                      className="chat-secondary-action-btn"
                                      onClick={() => {
                                        const matchedDebt = debts.find(
                                          (item) => item.id === creditItem.matchedDebtId
                                        );
                                        if (!matchedDebt) {
                                          wb.setToastState(
                                            '没找到对应负债，先刷新或去还款管理页核对。',
                                            'warning'
                                          );
                                          return;
                                        }
                                        const resolved = resolveQuickRepayAmount(
                                          creditItem,
                                          matchedDebt
                                        );
                                        if (!resolved) {
                                          wb.setToastState(
                                            matchedDebt.balance <= 0
                                              ? '这笔负债已结清，无需再登记还款。'
                                              : '当前应还金额还不够稳定，先补全金额后再登记还款。',
                                            'warning'
                                          );
                                          return;
                                        }
                                        quickRepayLockRef.current = false;
                                        setPendingQuickRepay({
                                          item: creditItem,
                                          amount: resolved.amount,
                                          capped: resolved.capped,
                                          balanceAfter: Math.max(
                                            0,
                                            Number(
                                              (matchedDebt.balance - resolved.amount).toFixed(2)
                                            )
                                          ),
                                          debtName:
                                            matchedDebt.name ||
                                            creditItem.matchedDebtName ||
                                            creditItem.title
                                        });
                                      }}
                                    >
                                      {tf('assistant.actions.quickMarkPaid', '快速登记已还')}
                                    </button>
                                    <button
                                      type="button"
                                      className="chat-secondary-action-btn danger"
                                      onClick={() => setPendingDeleteCreditItem(creditItem)}
                                    >
                                      {tf('assistant.actions.deleteThisDebt', '删除这笔负债')}
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </details>
                          </section>
                        ))}
                      </div>
                    ) : null}
                    {item.role === 'assistant' && item.reasoningText ? (
                      <details className="chat-reasoning-collapse">
                        <summary>{tf('assistant.stream.thinkingExpand', '模型思考过程（点击展开）')}</summary>
                        <pre>{item.reasoningText}</pre>
                      </details>
                    ) : null}
                    {item.role === 'assistant' && item.embeddingSummaryText ? (
                      <p
                        className={`chat-token-usage${item.embeddingSummaryIsError ? ' is-warning' : ''}`}
                      >
                        {formatEmbeddingSummaryForDisplay(item.embeddingSummaryText)}
                      </p>
                    ) : null}
                    {item.role === 'assistant' &&
                    item.followUpPrompts &&
                    item.followUpPrompts.length > 0 ? (
                      <div className="chat-follow-up-block">
                        <span className="chat-follow-up-title">{tf('assistant.followUpHint', '你可以顺手继续问：')}</span>
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
                      {item.role === 'assistant' ? (
                        <>
                          <button
                            type="button"
                            className={`chat-icon-action-btn${item.feedback === 'up' ? ' is-active' : ''}`}
                            onClick={() => setMessageFeedback(item.id, 'up')}
                            aria-label={tf('assistant.chatActions.like', '点赞这条回复')}
                            title={tf('assistant.chatActions.like', '点赞这条回复')}
                          >
                            <ChatThumbsUpIcon className="chat-icon-action-svg" />
                          </button>
                          <button
                            type="button"
                            className={`chat-icon-action-btn${item.feedback === 'down' ? ' is-active' : ''}`}
                            onClick={() => setMessageFeedback(item.id, 'down')}
                            aria-label={tf('assistant.chatActions.dislike', '点踩这条回复')}
                            title={tf('assistant.chatActions.dislike', '点踩这条回复')}
                          >
                            <ChatThumbsDownIcon className="chat-icon-action-svg" />
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="chat-icon-action-btn"
                        onClick={() => copyMessage(item.text)}
                        aria-label={tf('assistant.chatActions.copy', '复制消息')}
                        title={tf('assistant.chatActions.copy', '复制消息')}
                      >
                        <ChatCopyIcon className="chat-icon-action-svg" />
                      </button>
                      <button
                        type="button"
                        className="chat-icon-action-btn"
                        onClick={() => removeMessage(item.id)}
                        aria-label={tf('assistant.chatActions.delete', '删除消息')}
                        title={tf('assistant.chatActions.delete', '删除消息')}
                      >
                        <ChatClearIcon className="chat-icon-action-svg" />
                      </button>
                      {item.role === 'user' ? (
                        <button
                          type="button"
                          className="chat-icon-action-btn"
                          onClick={() => retryMessage(index + 1)}
                          disabled={wb.status === 'recognizing'}
                          aria-label={tf('assistant.chatActions.regenerate', '重新生成')}
                          title={tf('assistant.chatActions.regenerate', '重新生成')}
                        >
                          <ChatRotateCcwIcon className="chat-icon-action-svg" />
                        </button>
                      ) : null}
                      {item.role === 'assistant' ? (
                        <button
                          type="button"
                          className="chat-icon-action-btn"
                          onClick={() => retryMessage(index)}
                          disabled={wb.status === 'recognizing'}
                          aria-label={tf('assistant.chatActions.regenerate', '重新生成')}
                          title={tf('assistant.chatActions.regenerate', '重新生成')}
                        >
                          <ChatRotateCcwIcon className="chat-icon-action-svg" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}

              {mode === 'assistant' && wb.entries.length > 0 ? (
                <article className="chat-msg">
                  {renderChatAvatar('success')}
                  <div className="chat-msg-body">
                    <div className="chat-msg-header">{tf('assistant.stream.recognitionResult', '识别结果')}</div>
                    <BillPreviewCard
                      entries={wb.entries}
                      duplicateCount={duplicateEntriesCount}
                      accounts={accounts}
                      onCheckDuplicates={wb.checkDuplicates}
                      onSave={startDuplicateReview}
                      saving={wb.status === 'saving'}
                      onUpdateEntry={wb.updateEntry}
                      onRemoveEntry={wb.removeEntry}
                      onCreateSubscription={handleCreateSubscriptionFromEntry}
                    />
                  </div>
                </article>
              ) : null}

              {streamingPreviewMessage || streamingPreviewReasoning ? (
                <article className="chat-msg">
                  {renderChatAvatar('assistant')}
                  <div className="chat-msg-body">
                    <div className="chat-msg-header">{tf('assistant.stream.roleAssistant', '助手')}（正在生成）</div>
                    {streamingPreviewReasoning ? (
                      <details className="chat-reasoning-collapse chat-reasoning-collapse-stream">
                        <summary>{tf('assistant.stream.thinkingStreaming', '模型思考过程（流式输出中）')}</summary>
                        <pre>{streamingPreviewReasoning}</pre>
                      </details>
                    ) : null}
                    {mode === 'credit'
                      ? (() => {
                          const previewItems =
                            extractStreamingCreditPreview(streamingPreviewMessage);
                          return previewItems.length > 0 ? (
                            <div className="chat-credit-cards chat-credit-cards-skeleton">
                              {previewItems.map((creditItem) => (
                                <section
                                  key={creditItem.id}
                                  className="chat-credit-card chat-credit-card-skeleton is-preview"
                                >
                                  <div className="chat-credit-card-head">
                                    <div>
                                      <strong>{creditItem.title}</strong>
                                      <span>{creditItem.productType}</span>
                                    </div>
                                    <em
                                      className={`chat-credit-confidence is-${creditItem.confidence}`}
                                    >
                                      {tf('assistant.stream.preview', '流式预览')}
                                    </em>
                                  </div>
                                  <div className="chat-credit-grid">
                                    <div>
                                      <span>{tf('assistant.ledger.currentDueNow', '当前应还')}</span>
                                      <strong>{creditItem.dueAmount || '识别中'}</strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.ledger.remaining', '剩余')}待还</span>
                                      <strong>{creditItem.totalDebt || '识别中'}</strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.ledger.dueDay', '还款日')}</span>
                                      <strong>{creditItem.repaymentDate || '识别中'}</strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.ledger.remaining', '剩余')}期数</span>
                                      <strong>{creditItem.remainingPeriods || '识别中'}</strong>
                                    </div>
                                    <div>
                                      <span>每期{tf('transactions.table.col.amount', '金额')}</span>
                                      <strong>{creditItem.monthlyAmount || '识别中'}</strong>
                                    </div>
                                    <div>
                                      <span>{tf('assistant.ledger.interestRate', '利息/费率')}</span>
                                      <strong>{creditItem.interest || '识别中'}</strong>
                                    </div>
                                  </div>
                                  {creditItem.riskHint ||
                                  creditItem.actionSuggestion ||
                                  creditItem.pendingFields.length > 0 ? (
                                    <div className="chat-credit-pending">
                                      {creditItem.riskHint ? (
                                        <div>
                                          <span>{tf('assistant.ledger.riskNote', '风险提示：')}</span>
                                          <strong>{creditItem.riskHint}</strong>
                                        </div>
                                      ) : null}
                                      {creditItem.actionSuggestion ? (
                                        <div>
                                          <span>{tf('assistant.ledger.nextStep', '下一步：')}</span>
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
                                        <strong>{tf('assistant.stream.repaymentSearchTitle', '还款检索结果')}</strong>
                                        <span>计划 / {tf('transactions.table.col.account', '账户')} / 流水检索中</span>
                                      </div>
                                      <em className="chat-credit-lookup-status">{tf('assistant.stream.preloading', '预加载中')}</em>
                                    </div>
                                    <div className="chat-credit-lookup-grid">
                                      <div>
                                        <span>{tf('assistant.stream.plannedDue', '计划中的应还')}</span>
                                        <strong>{tf('assistant.stream.searching', '检索中')}</strong>
                                      </div>
                                      <div>
                                        <span>计划 / 实际{tf('transactions.table.col.account', '账户')}</span>
                                        <strong>{tf('assistant.stream.searching', '检索中')}</strong>
                                      </div>
                                      <div>
                                        <span>{tf('assistant.stream.recentPaid', '最近已还')}流水</span>
                                        <strong>{tf('assistant.stream.searching', '检索中')}</strong>
                                      </div>
                                      <div>
                                        <span>{tf('assistant.stream.recordStatus', '流水状态')}</span>
                                        <strong>等{tf('assistant.stream.pendingLink', '待串联')}</strong>
                                      </div>
                                    </div>
                                    <div className="chat-credit-lookup-hint">
                                      {tf('assistant.stream.skeletonFirst', '先把台账骨架亮出来，正文和检索结果会继续补齐。')}
                                    </div>
                                  </div>
                                  <div className="chat-credit-gap-card chat-credit-preview-block">
                                    <div className="chat-credit-gap-head">
                                      <strong>{tf('assistant.stream.planVsActual', '计划 vs 实际')}</strong>
                                      <span>差异分析{tf('assistant.stream.preloading', '预加载中')}</span>
                                    </div>
                                    <div className="chat-credit-gap-grid">
                                      <div>
                                        <span>{tf('assistant.stream.plannedAmountDue', '计划应还')}</span>
                                        <strong>{tf('assistant.stream.searching', '检索中')}</strong>
                                      </div>
                                      <div>
                                        <span>{tf('assistant.stream.recentPaid', '最近已还')}</span>
                                        <strong>{tf('assistant.stream.searching', '检索中')}</strong>
                                      </div>
                                      <div>
                                        <span>{tf('assistant.ledger.stillShort', '当前还差')}</span>
                                        <strong>{tf('assistant.stream.pendingCalc', '待计算')}</strong>
                                      </div>
                                      <div>
                                        <span>扣款/还款{tf('transactions.table.col.account', '账户')}</span>
                                        <strong>{tf('assistant.stream.pendingLink', '待串联')}</strong>
                                      </div>
                                    </div>
                                    <div className="chat-credit-gap-reason">
                                      {tf('assistant.stream.skeletonDiffNote', '流式阶段先展示台账卡片骨架，等模型继续输出后再补全差额原因。')}
                                    </div>
                                  </div>
                                </section>
                              ))}
                            </div>
                          ) : (
                            <CreditCardSkeleton count={2} />
                          );
                        })()
                      : null}
                    {streamingPreviewMessage ? (
                      <div className="chat-msg-content chat-msg-content-rich chat-msg-content-streaming">
                        {streamingCommittedSegments.map((segment, index) => (
                          <div key={`stream-segment-${index}`} className="chat-stream-segment">
                            {renderMarkdownContent(segment)}
                          </div>
                        ))}
                        {streamingDraftSegment ? (
                          <div className="chat-stream-draft">
                            {renderMarkdownContent(streamingDraftSegment)}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="chat-stream-waiting">
                        {tf('assistant.stream.organizing', '正在把思考整理成回复')}
                        <span className="chat-typing-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              ) : null}

              {wb.status === 'recognizing' &&
              !streamingPreviewMessage &&
              !streamingPreviewReasoning ? (
                <article className="chat-msg">
                  {renderChatAvatar('assistant')}
                  <div className="chat-msg-body">
                    <div className="chat-msg-header">{tf('assistant.stream.roleAssistant', '助手')}</div>
                    <div className="chat-typing">
                      {tf('assistant.stream.thinking', '模型思考中')}
                      <span className="chat-typing-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </div>
                </article>
              ) : null}

              {wb.status === 'saved' ? (
                <article className="chat-msg">
                  {renderChatAvatar('success')}
                  <div className="chat-msg-body">
                    <div className="chat-msg-header">{tf('assistant.stream.roleSystem', '系统')}</div>
                    <div className="chat-auto-card">
                      <strong>{tf('assistant.ledger.billSaved', '账单已保存到账本。')}</strong>
                    </div>
                  </div>
                </article>
              ) : null}

              <div ref={messageEndRef} />
            </div>
          </section>

          <section
            className={`chat-input-bar chat-input-bar-collapsible ${
              regularComposerExpanded ? 'is-expanded' : 'is-compact'
            }`}
          >
            {shouldShowError ? (
              <div className="chat-error-strip" role="alert">
                <details className={`chat-error-details${hasErrorDetail ? '' : ' is-plain'}`}>
                  <summary>
                    <span className="chat-error-summary-label">{tf('assistant.error.requestFailed', '请求失败')}</span>
                    <span className="chat-error-summary-text">{wb.error}</span>
                    <span className="chat-error-expand">{tf('assistant.actions.details', '详情')}</span>
                  </summary>
                  <pre className="chat-error-detail-text">{wb.error}</pre>
                </details>
                <button
                  type="button"
                  onClick={retryLastPrompt}
                  disabled={wb.status === 'recognizing'}
                >
                  {tf('assistant.actions.retry', '重试')}
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
                        onClick={() =>
                          wb.setImageDataUrls((prev) => prev.filter((_, i) => i !== idx))
                        }
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
                        onClick={() =>
                          wb.setPdfDataUrls((prev) => prev.filter((_, i) => i !== idx))
                        }
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
                  {tf('assistant.actions.clearAttachments', '清空附件')}
                </button>
              </div>
            ) : null}

            <p className="chat-disclaimer">{tf('assistant.aiDisclaimer', 'AI 生成内容仅供参考，请结合原始账单核对后再保存。')}</p>

            {mode === 'credit' && wb.hasApiKey && !wb.textInput.trim() ? (
              <div className="chat-credit-quick-commands" aria-label={tf('assistant.creditQuickCommands', '信贷管家快捷指令')}>
                {CREDIT_QUICK_COMMANDS.map((command) => (
                  <button
                    key={command}
                    type="button"
                    className="chat-smart-command-chip"
                    onClick={() => submitPrompt(command)}
                    disabled={wb.status === 'recognizing'}
                  >
                    {command}
                  </button>
                ))}
              </div>
            ) : null}

            {latestTransaction ? (
              <div className="chat-input-meta">
                <div
                  className={`chat-input-context ${wb.textInput.trim() ? 'is-collapsed' : ''}`}
                  aria-label={tf('assistant.latestBill', '最近一笔账单')}
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

            <form
              className={`chat-input-form chat-input-form-collapsible ${
                regularComposerExpanded ? 'is-expanded' : 'is-compact'
              }`}
              aria-expanded={regularComposerExpanded}
              onSubmit={onSubmit}
              onFocusCapture={() => setComposerFocused(true)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setComposerFocused(false);
                }
              }}
            >
              <div className="chat-input-stack">
                <div
                  className="chat-input-main"
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (!target.closest('button, input')) wb.textareaRef.current?.focus();
                  }}
                >
                  <textarea
                    ref={wb.textareaRef}
                    className="chat-input-textarea"
                    aria-label={
                      mode === 'credit'
                        ? tf('assistant.composer.ariaCredit', 'AI 信贷管家输入')
                        : tf('assistant.composer.ariaDefault', 'AI 助手输入')
                    }
                    rows={1}
                    placeholder={inputPlaceholder(wb.status, wb.hasApiKey, mode, t)}
                    value={wb.textInput}
                    onChange={(e) => wb.setTextInput(e.target.value)}
                    onPaste={(e) => void wb.handlePasteImage(e)}
                    onKeyDown={onInputKeyDown}
                  />

                  <div className="chat-input-toolbar">
                    <div className="chat-input-toolbar-left">
                      <button
                        type="button"
                        className="chat-upload-btn"
                        title={tf('assistant.attachments.uploadGeneric', '上传图片/PDF')}
                        onClick={() => wb.fileInputRef.current?.click()}
                        disabled={wb.status === 'recognizing'}
                      >
                        <ChatUploadIcon className="chat-svg-icon" />
                      </button>

                      <div className="chat-model-selector chat-model-selector-inline">
                        <button
                          ref={modelTriggerRef}
                          type="button"
                          className={`chat-model-trigger ${modelOpen ? 'is-open' : ''}`}
                          onClick={() => {
                            if (modelOpen && modelPickerSource === 'toolbar') {
                              closeModelPicker(false);
                              return;
                            }
                            openModelPicker('toolbar');
                          }}
                          aria-haspopup="menu"
                          aria-expanded={modelOpen}
                          aria-controls={modelOpen ? 'assistant-model-menu' : undefined}
                          aria-label={`当前模型：${getModelDisplayLabel(model || t('assistant.ui.selectModel'))}`}
                          title={getModelDisplayLabel(model || t('assistant.ui.selectModel'))}
                        >
                          <span className="chat-model-trigger-icon">
                            <AiModelFamilyIcon
                              family={resolveAiModelFamily(model)}
                              className="chat-svg-icon chat-model-trigger-glyph"
                            />
                          </span>
                          <span className="chat-model-inline-label">
                            {getModelDisplayLabel(model || t('assistant.ui.selectModel'))}
                          </span>
                        </button>

                        {modelOpen ? (
                          <div
                            ref={modelMenuRef}
                            id="assistant-model-menu"
                            className={`chat-model-dropdown ${modelPickerSource === 'command' ? 'is-command-open' : ''}`}
                            role="menu"
                            aria-label={tf('assistant.modelList', '模型列表')}
                            onKeyDown={onModelMenuKeyDown}
                          >
                            <div className="chat-model-list">
                              {wb.models.length === 0 ? (
                                <div className="chat-model-empty">
                                  {wb.loadingModels
                                    ? t('assistant.ui.loadingModels')
                                    : t('assistant.ui.emptyModels')}
                                </div>
                              ) : (
                                wb.models.map((item: string) => (
                                  <button
                                    key={item}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={item === model}
                                    className={`chat-model-option ${item === model ? 'active' : ''}`}
                                    onClick={() => handleSelectModel(item)}
                                  >
                                    <AiModelFamilyIcon
                                      family={resolveAiModelFamily(item)}
                                      className="chat-model-option-glyph"
                                    />
                                    <span className="chat-model-option-label">
                                      {getModelDisplayLabel(item)}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        ) : null}
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
                            window.sessionStorage.removeItem(
                              CHAT_HISTORY_CACHE_KEYS[activeHistoryModeRef.current]
                            );
                          } catch {
                            // ignore storage write errors
                          }
                        }}
                        disabled={chatHistory.length === 0}
                      >
                        <ChatClearIcon className="chat-svg-icon" />
                        <span className="chat-input-toolbar-btn-label">{tf('assistant.actions.clearContext', '清空上下文')}</span>
                      </button>
                    </div>

                    <button
                      type={wb.status === 'recognizing' ? 'button' : 'submit'}
                      className={`chat-send-btn ${wb.status === 'recognizing' ? 'chat-send-btn-stop' : ''}`}
                      title={wb.status === 'recognizing' ? '停止' : '发送'}
                      onClick={wb.status === 'recognizing' ? wb.stopRecognize : undefined}
                      disabled={wb.status !== 'recognizing' && !wb.canRecognize}
                    >
                      {wb.status === 'recognizing' ? (
                        <ChatStopIcon className="chat-svg-icon chat-svg-icon--filled" />
                      ) : (
                        <ChatSendIcon className="chat-svg-icon" />
                      )}
                    </button>
                  </div>
                </div>

                <input
                  ref={wb.fileInputRef}
                  className="chat-file-input-hidden"
                  type="file"
                  accept="image/*,application/pdf"
                  title={tf('assistant.attachments.uploadBill', '上传账单图片或 PDF')}
                  aria-label={tf('assistant.attachments.uploadBill', '上传账单图片或 PDF')}
                  aria-hidden="true"
                  tabIndex={-1}
                  hidden
                  onChange={(e) => void wb.handleSetFile(e.target.files?.[0])}
                />
              </div>
            </form>
          </section>

          {semanticPanelOpen ? (
            <div
              className="drawer-overlay"
              role="presentation"
              onClick={() => setSemanticPanelOpen(false)}
            >
              <aside
                ref={semanticDrawerRef}
                className="drawer-panel chat-semantic-drawer"
                role="dialog"
                aria-modal="true"
                aria-label={tf('assistant.semanticRecallDetail', '语义召回详情')}
                onClick={(event) => event.stopPropagation()}
              >
                <header className="drawer-header">
                  <h3>{tf('assistant.semanticRecall', '语义召回')}</h3>
                  <button type="button" onClick={() => setSemanticPanelOpen(false)}>
                    {tf('common.close', '关闭')}
                  </button>
                </header>
                <div className="drawer-body">
                  <details className="chat-semantic-drawer-card" open>
                    <summary>
                      <strong>{tf('assistant.semanticIndexStatus', '索引状态')}</strong>
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
                        {tf('assistant.actions.refresh', '刷新')}
                      </button>
                      <button
                        type="button"
                        className="chat-secondary-action-btn"
                        onClick={() => {
                          const ok = wb.clearSemanticRecallIndex();
                          if (!ok) {
                            wb.setToastState(
                              '请先配置 Base URL 与 Embedding 模型后再清理缓存',
                              'warning'
                            );
                          }
                        }}
                      >
                        {tf('assistant.actions.clearCache', '清缓存')}
                      </button>
                    </div>
                  </details>
                  {(showEmbeddingSummary && wb.embeddingDebug.enabled) ||
                  (showEmbeddingDebug && wb.embeddingDebug.enabled) ? (
                    <details className="chat-semantic-drawer-card">
                      <summary>
                        <strong>{tf('assistant.currentStatus', '当前状态')}</strong>
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
                                  .map(
                                    (hit, idx) => `${idx + 1}. [${hit.score.toFixed(4)}] ${hit.id}`
                                  )
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
            <div
              className="dialog-overlay"
              role="presentation"
              onClick={handleCancelDuplicateReview}
            >
              <section
                ref={duplicateDialogRef}
                className="dialog chat-dup-compare-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={tf('assistant.duplicateCompare', '重复账单对比确认')}
                onClick={(event) => event.stopPropagation()}
              >
                <header className="dialog-header">
                  重复账单确认（{duplicateReviewIndex + 1}/{duplicateReviewPairs.length}）
                </header>
                <div className="dialog-body chat-dup-compare-body">
                  <p className="chat-dup-compare-tip">
                    请核对左侧新识别数据与右侧已有账单，确认是否{tf('assistant.duplicate.overwrite', '覆盖旧账单')}。
                  </p>
                  <div className="chat-dup-compare-grid">
                    <article className="chat-dup-compare-card is-new">
                      <h4>{tf('assistant.duplicate.newData', '新数据（AI 识别）')}</h4>
                      <dl>
                        <div>
                          <dt>{tf('transactions.table.col.date', '日期')}</dt>
                          <dd>{resolveTransactionLocalDay(currentDuplicateReview.entry.date)}</dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.type', '类型')}</dt>
                          <dd>{getDraftTypeLabel(currentDuplicateReview.entry.type)}</dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.amount', '金额')}</dt>
                          <dd>
                            {formatMoneyByCurrency(
                              currentDuplicateReview.entry.amount,
                              currentDuplicateReview.entry.currency
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.category', '分类')}</dt>
                          <dd>{currentDuplicateReview.entry.category || '未分类'}</dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.account', '账户')}</dt>
                          <dd>{currentDuplicateReview.entry.account || '未指定账户'}</dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.note', '备注')}</dt>
                          <dd>{currentDuplicateReview.entry.note || '—'}</dd>
                        </div>
                      </dl>
                    </article>
                    <article className="chat-dup-compare-card is-existing">
                      <h4>{tf('assistant.duplicate.existingBill', '已有账单（命中重复）')}</h4>
                      <dl>
                        <div>
                          <dt>{tf('transactions.table.col.date', '日期')}</dt>
                          <dd>{resolveTransactionLocalDay(currentDuplicateReview.existing.date)}</dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.type', '类型')}</dt>
                          <dd>{getDraftTypeLabel(currentDuplicateReview.existing.type)}</dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.amount', '金额')}</dt>
                          <dd>{formatMoneyByCurrency(currentDuplicateReview.existing.amount)}</dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.category', '分类')}</dt>
                          <dd>
                            {categories.find(
                              (item) => item.id === currentDuplicateReview.existing.categoryId
                            )?.name || '未分类'}
                          </dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.account', '账户')}</dt>
                          <dd>
                            {accounts.find(
                              (item) => item.id === currentDuplicateReview.existing.accountId
                            )?.name || '未指定账户'}
                          </dd>
                        </div>
                        <div>
                          <dt>{tf('transactions.table.col.note', '备注')}</dt>
                          <dd>{currentDuplicateReview.existing.note || '—'}</dd>
                        </div>
                      </dl>
                    </article>
                  </div>
                </div>
                <footer className="dialog-footer chat-dup-compare-footer">
                  <button type="button" onClick={handleCancelDuplicateReview}>
                    {tf('assistant.duplicate.cancelSave', '取消本次保存')}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => handleDuplicateDecision(false)}
                  >
                    {tf('assistant.duplicate.keepBoth', '保留旧账单并新增')}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleDuplicateDecision(true)}
                  >
                    {tf('assistant.duplicate.overwrite', '覆盖旧账单')}
                  </button>
                </footer>
              </section>
            </div>
          ) : null}

          <ConfirmDialog
            open={Boolean(pendingDeleteCreditItem)}
            title={tf('assistant.confirmDeleteDebt', '删除这笔负债？')}
            description={`将从还款管理删除“${
              pendingDeleteCreditItem?.matchedDebtName ||
              pendingDeleteCreditItem?.title ||
              '这笔负债'
            }”。删除后无法在还款管理中继续查看，请确认已经不再需要它。`}
            confirmText="确认删除"
            danger
            onConfirm={() => {
              if (pendingDeleteCreditItem) {
                handleDeleteMatchedDebt(pendingDeleteCreditItem);
              }
              setPendingDeleteCreditItem(null);
            }}
            onCancel={() => setPendingDeleteCreditItem(null)}
          />

          <ConfirmDialog
            open={Boolean(pendingQuickRepay)}
            title={tf('assistant.confirmMarkPaid', '登记这笔已还？')}
            description={
              pendingQuickRepay
                ? `将从“${pendingQuickRepay.debtName}”登记一笔 ¥${pendingQuickRepay.amount.toFixed(
                    2
                  )} 还款，剩余待还更新为 ¥${pendingQuickRepay.balanceAfter.toFixed(2)}。${
                    pendingQuickRepay.capped ? ' 当前应还高于剩余待还，已按剩余金额封顶。' : ''
                  }`
                : ''
            }
            confirmText="确认登记"
            onConfirm={() => {
              if (!pendingQuickRepay || quickRepayLockRef.current) return;
              quickRepayLockRef.current = true;
              handleQuickRepaymentRecord(pendingQuickRepay.item);
              setPendingQuickRepay(null);
            }}
            onCancel={() => setPendingQuickRepay(null)}
          />

          <Toast
            message={wb.toast.message}
            variant={wb.toast.variant}
            visible={wb.toast.visible}
            onClose={() => wb.setToastVisible(false)}
          />
        </>
      )}
    </div>
  );
}
