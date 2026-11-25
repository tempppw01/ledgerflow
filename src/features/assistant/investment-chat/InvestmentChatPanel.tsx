import {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useMenuKeyboard } from '../../../shared/lib/useMenuKeyboard';
import type { CSSProperties } from 'react';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import type { InvestmentAiAgentAction } from '../../../entities/investment/types';
import {
  buildInvestmentAssistantPrompt,
  buildInvestmentAssistantAuxiliaryInfo,
  buildInvestmentFollowUpFallback,
  createInvestmentAiMessage,
  extractInvestmentAnalysis,
  getInvestmentAssistantDisplayText,
  parseInvestmentFollowUpPrompts,
  readImageAsDataUrl,
  trimInvestmentAiMessages
} from '../../../pages/investments/investmentAi';
import { fetchAiModels, sendAiChat, sendAiChatStream } from '../api/openaiCompatibleClient';
import type { ChatToolCall } from '../api/openaiCompatibleClient';
import {
  executeInvestmentToolCall,
  INVESTMENT_AGENT_INSTRUCTIONS,
  INVESTMENT_AGENT_TOOLS,
  type InvestmentAgentContext
} from '../agent/investmentAgentTools';
import {
  buildWebSearchPrompt,
  fetchWebSearchContext,
  type WebSearchContext
} from '../api/webSearchClient';
import { renderMarkdownContent } from '../ui/MarkdownRenderer';
import {
  ChatChevronUpIcon,
  ChatChevronsDownUpIcon,
  ChatChevronsUpDownIcon,
  ChatGlobeIcon,
  ChatGlobeOffIcon,
  ChatSendIcon,
  ChatSparklesIcon,
  ChatStopIcon,
  ChatUploadIcon
} from '../ui/chatIcons';
import {
  BOT_ICON_URL,
  INVESTMENT_HERO_ILLUSTRATION_URL,
  USER_ICON_URL
} from '../../../shared/config/brandAssets';
import { useAiSettings } from '../../../shared/store/useAiSettings';
import { useAppPreferences } from '../../../shared/store/useAppPreferences';
import {
  formatMarketContextTime,
  readCachedMarketContext
} from '../../investments/model/investmentMarketContext';
import { useFinanceStore } from '../../../shared/store/useFinanceStore';
import { calculateMonthlyCashflow } from '../../investments/model/monthlyCashflow';
import { AI_MODEL_PRESETS, mergeAiModelOptions } from '../../../shared/config/aiModels';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { AiModelFamilyIcon } from '../../../shared/ui/brandIcons';
import { resolveAiModelFamily } from '../../../shared/ui/brandIconResolvers';
import { Toast } from '../../../shared/ui/Toast';
import type { ToastVariant } from '../../../shared/ui/Toast';
import { buildTimeContext } from '../workbench/workbenchUtils';
import { InvestmentAiMessageDetails } from './InvestmentAiMessageDetails';

type Message = ReturnType<typeof createInvestmentAiMessage>;
type InvestmentChatProgress = 'market' | 'web' | 'tools' | 'thinking' | 'answering' | '';
type FloatingResizeEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left';

type FloatingPanelBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type FloatingResizeState = FloatingPanelBounds & {
  edge: FloatingResizeEdge;
  startX: number;
  startY: number;
  previousUserSelect: string;
};

const FLOATING_CHAT_MIN_WIDTH = 320;
const FLOATING_CHAT_MIN_HEIGHT = 360;
const FLOATING_CHAT_VIEWPORT_GUTTER = 16;
/** 键盘一次调多少;按住 Shift 用粗档(与侧栏、分栏、列宽同一组步长)。 */
const FLOATING_CHAT_KEYBOARD_STEP = 16;
const FLOATING_CHAT_KEYBOARD_COARSE_STEP = 48;

/**
 * 浮窗某一轴能到多大。
 *
 * 公式与 `startFloatingResize` 里那一份**完全一致**:不能超过视口减两边留白,
 * 也不能超过"当前位置到视口边缘减留白"。—— 键盘能调到的最大值必须和拖拽一样,
 * 否则会报出拖不到的 aria-valuemax(表格列宽踩过:报 656 而实际停在 640)。
 * 外层兜一个 max(min, …) 是为了保证 min <= max,否则 aria 上的区间是反的。
 */
function getFloatingAxisMax(min: number, position: number, viewport: number) {
  return Math.max(
    min,
    Math.min(
      Math.max(min, viewport - FLOATING_CHAT_VIEWPORT_GUTTER * 2),
      viewport - position - FLOATING_CHAT_VIEWPORT_GUTTER
    )
  );
}

const MAX_INVESTMENT_AI_IMAGES = 4;
const MAX_INVESTMENT_AI_IMAGE_SIZE_MB = 6;
const MAX_INVESTMENT_AGENT_ROUNDS = 4;
const INVESTMENT_STARTER_PROMPTS: Array<{ key: string; fallback: string }> = [
  { key: 'investmentAi.suggest.risk', fallback: '帮我看当前持仓的主要风险' },
  { key: 'investmentAi.suggest.stance', fallback: '今天市场该进攻还是防守?' },
  { key: 'investmentAi.suggest.gap', fallback: '帮我检查目标资金缺口' },
  { key: 'investmentAi.suggest.allocation', fallback: '结合我的情况给一个配置思路' }
];
const INVESTMENT_CHAT_PROGRESS_ENTRIES: Record<
  Exclude<InvestmentChatProgress, ''>,
  { key: string; fallback: string }
> = {
  market: { key: 'investmentAi.stage.market', fallback: '正在读取页面持仓、自选和账本数据' },
  web: { key: 'investmentAi.stage.web', fallback: '正在查询公开联网资讯' },
  tools: { key: 'investmentAi.stage.tools', fallback: '正在核对你自己的持仓与目标数据' },
  thinking: { key: 'investmentAi.stage.thinking', fallback: '正在思考投资结论' },
  answering: { key: 'investmentAi.stage.answering', fallback: '正在组织回答' }
};

function getModelDisplayLabel(modelId: string): string {
  const value = modelId.trim();
  if (!value) return value;
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function getClipboardImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      if (file.name) return file;
      return new File([file], `clipboard-fund-screenshot-${Date.now()}-${index}.png`, {
        type: file.type || item.type || 'image/png'
      });
    })
    .filter((file): file is File => Boolean(file));

  if (itemFiles.length > 0) return itemFiles;

  return Array.from(clipboardData.files || []).filter((file) => file.type.startsWith('image/'));
}

function Avatar({ user }: { user?: boolean }) {
  return (
    <div className="chat-msg-avatar" aria-hidden="true">
      <img className="chat-msg-avatar-image" src={user ? USER_ICON_URL : BOT_ICON_URL} alt="" />
    </div>
  );
}

type InvestmentChatComposerProps = {
  showLinks?: boolean;
  defaultWebEnabled?: boolean;
  contextNote?: string;
  focus?: {
    type: 'position' | 'watch' | 'market' | 'news';
    label: string;
    detail?: string;
  } | null;
  onPromptSubmitted?: (messageId: string) => void;
  clearContextVersion?: number;
  starterPrompt?: { text: string; token: number } | null;
  onRegisterAgentUndo?: (id: string, run: () => void) => void;
};

export function InvestmentChatComposer({
  showLinks = true,
  defaultWebEnabled = false,
  contextNote = '',
  focus = null,
  onPromptSubmitted,
  clearContextVersion = 0,
  starterPrompt = null,
  onRegisterAgentUndo
}: InvestmentChatComposerProps) {
  const tf = useTFallback();
  const { baseUrl, apiKey, model, webSearch } = useAiSettings();
  const setModel = useAiSettings((s) => s.setModel);
  const messages = useAppPreferences((s) => s.investmentAiMessages);
  const setMessages = useAppPreferences((s) => s.setInvestmentAiMessages);
  const positions = useAppPreferences((s) => s.investmentPositions);
  const goals = useAppPreferences((s) => s.investmentGoals);
  const watchlist = useAppPreferences((s) => s.investmentWatchlist);
  const upsertInvestmentWatchItem = useAppPreferences((s) => s.upsertInvestmentWatchItem);
  const updateInvestmentGoal = useAppPreferences((s) => s.updateInvestmentGoal);
  const transactions = useFinanceStore((s) => s.transactions);
  const monthlyIncome = useAppPreferences((s) => s.monthlyIncome);

  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [webEnabled, setWebEnabled] = useState(defaultWebEnabled);
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<string[]>(() => [...AI_MODEL_PRESETS]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState('');
  const [failedTurn, setFailedTurn] = useState<{
    messageId: string;
    text: string;
    images: string[];
  } | null>(null);
  const [, setStreaming] = useState('');
  const [, setStreamingReasoning] = useState('');
  const [progress, setProgress] = useState<InvestmentChatProgress>('');
  const [composerFocused, setComposerFocused] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: ToastVariant }>({
    visible: false,
    message: '',
    variant: 'success'
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSelectorRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  // role="menu" 需要有方向键;关闭后焦点还给触发按钮。
  useMenuKeyboard(modelOpen, dropdownRef, () => setModelOpen(false));
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const inFlightRef = useRef(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({
    position: 'fixed',
    left: 0,
    top: 0,
    bottom: 'auto'
  });

  /*
   * 原先这里用**全部历史交易**去减月收入,于是任何用满一个月的账本都算出 0;
   * 而且同样没有排除退款。现在与投资理财页共用同一份按月口径。
   */
  const monthlyInvestableCash = useMemo(
    () => calculateMonthlyCashflow({ transactions, monthlyIncome }).investableCash,
    [monthlyIncome, transactions]
  );

  /**
   * 独立打开 AI 投资助手(例如 /assistant 的投资模式)时,没有父页面传入的行情上下文,
   * 这里复用投资理财页写入的同一份快照,保证两个入口看到同一份数据。
   */
  const cachedMarketContext = useMemo(
    () => (contextNote.trim() ? null : readCachedMarketContext()),
    [contextNote]
  );

  const effectiveContextNote = useMemo(() => {
    if (contextNote.trim()) return contextNote;
    if (!cachedMarketContext) return '';
    return `${cachedMarketContext.summary}\n\n上下文来源:投资理财页行情快照(${formatMarketContextTime(
      cachedMarketContext.updatedAt
    )})`;
  }, [cachedMarketContext, contextNote]);

  const assistantPrompt = useMemo(
    () =>
      buildInvestmentAssistantPrompt({
        positions: positions.filter((item) => item.isActive),
        goals,
        watchlist,
        monthlyInvestableCash,
        focus
      }) + (effectiveContextNote ? `\n\n页面实时上下文:\n${effectiveContextNote}` : ''),
    [effectiveContextNote, focus, goals, monthlyInvestableCash, positions, watchlist]
  );

  const followUps = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((item) => item.role === 'assistant' && item.followUpPrompts?.length)
        ?.followUpPrompts || [],
    [messages]
  );

  const updateModelDropdownPosition = useCallback(() => {
    const trigger = modelTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const dropdownWidth = Math.min(320, window.innerWidth - 24);
    const dropdownHeight = dropdownRef.current?.offsetHeight || 260;
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - dropdownWidth - 12)
    );
    const openAbove = rect.top > dropdownHeight + 20;
    const top = openAbove
      ? Math.max(12, rect.top - dropdownHeight - 8)
      : Math.min(window.innerHeight - dropdownHeight - 12, rect.bottom + 8);

    setDropdownStyle({
      position: 'fixed',
      left,
      top: Math.max(12, top),
      bottom: 'auto',
      minWidth: dropdownWidth,
      zIndex: 10000
    });
  }, []);

  useEffect(() => {
    if (!modelOpen) return;

    updateModelDropdownPosition();
    const frame = window.requestAnimationFrame(updateModelDropdownPosition);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!modelSelectorRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setModelOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelOpen(false);
      }
    };

    window.addEventListener('resize', updateModelDropdownPosition);
    window.addEventListener('scroll', updateModelDropdownPosition, true);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateModelDropdownPosition);
      window.removeEventListener('scroll', updateModelDropdownPosition, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelOpen, updateModelDropdownPosition]);

  useEffect(() => {
    if (clearContextVersion === 0) return;

    requestVersionRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    inFlightRef.current = false;
    setLoading(false);
    setInput('');
    setImages([]);
    setError('');
    setFailedTurn(null);
    setStreaming('');
    setStreamingReasoning('');
    setProgress('');
    setComposerFocused(false);
  }, [clearContextVersion]);

  useEffect(
    () => () => {
      requestVersionRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      inFlightRef.current = false;
    },
    []
  );

  const loadModels = useCallback(async () => {
    if (loadingModels) return;
    if (!baseUrl.trim() || !apiKey.trim()) return;

    setLoadingModels(true);
    try {
      const nextModels = await fetchAiModels(baseUrl, apiKey);
      setModels(mergeAiModelOptions(model, AI_MODEL_PRESETS, nextModels));
    } catch {
      setModels((current) => mergeAiModelOptions(model, AI_MODEL_PRESETS, current));
    } finally {
      setLoadingModels(false);
    }
  }, [apiKey, baseUrl, loadingModels, model]);

  const openModelPicker = useCallback(() => {
    setModelOpen(true);
    void loadModels();
  }, [loadModels]);

  const selectModel = useCallback(
    (nextModel: string) => {
      setModel(nextModel);
      setModelOpen(false);
    },
    [setModel]
  );

  async function appendImageFiles(files: File[]) {
    if (files.length === 0) return;

    const slots = MAX_INVESTMENT_AI_IMAGES - images.length;
    if (slots <= 0) {
      setToast({
        visible: true,
        message: tf('investmentAi.error.tooManyImages', '最多只能附加 {count} 张截图。').replace(
          '{count}',
          String(MAX_INVESTMENT_AI_IMAGES)
        ),
        variant: 'warning'
      });
      return;
    }

    const accepted = files.slice(0, slots);
    const oversized = accepted.find(
      (file) => file.size > MAX_INVESTMENT_AI_IMAGE_SIZE_MB * 1024 * 1024
    );
    if (oversized) {
      setToast({
        visible: true,
        message: tf('investmentAi.error.imageTooLarge', '单张图片不能超过 {size}MB。').replace(
          '{size}',
          String(MAX_INVESTMENT_AI_IMAGE_SIZE_MB)
        ),
        variant: 'warning'
      });
      return;
    }

    try {
      const nextImages = await Promise.all(accepted.map((file) => readImageAsDataUrl(file)));
      setImages((prev) => [...prev, ...nextImages].slice(0, MAX_INVESTMENT_AI_IMAGES));
    } catch (err) {
      setToast({
        visible: true,
        message:
          err instanceof Error
            ? err.message
            : tf('investmentAi.error.imageRead', '图片读取失败，请重试。'),
        variant: 'error'
      });
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLFormElement>) {
    const files = getClipboardImageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void appendImageFiles(files);
  }

  function stopRequest() {
    requestVersionRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    inFlightRef.current = false;
    setLoading(false);
    setStreaming('');
    setStreamingReasoning('');
    setProgress('');
  }

  const submitPrompt = async (prompt?: string, options?: { retryMessageId?: string }) => {
    const retryMessage = options?.retryMessageId
      ? messages.find((item) => item.id === options.retryMessageId)
      : undefined;
    const cleanPrompt = (prompt ?? input).trim();
    if (inFlightRef.current || loading || (!cleanPrompt && images.length === 0 && !retryMessage)) {
      return;
    }
    const retrying = Boolean(retryMessage);
    const requestImages = retryMessage ? [...(retryMessage.attachmentImages || [])] : [...images];
    const requestText = retryMessage?.text || cleanPrompt || '请基于这些基金或持仓截图做投资分析。';
    if (!apiKey.trim()) {
      if (!retrying && requestText) {
        setInput(requestText);
      }
      setToast({
        visible: true,
        message: tf(
          'investmentAi.error.noKey',
          '请先在设置中配置可用的 AI Key，问题已保留在输入框。'
        ),
        variant: 'warning'
      });
      return;
    }
    const abortController = new AbortController();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    abortControllerRef.current = abortController;
    inFlightRef.current = true;
    setLoading(true);
    setError('');
    setFailedTurn(null);
    setProgress('market');
    const userMessage: Message =
      retryMessage ||
      createInvestmentAiMessage({
        id: `investment-user-${Date.now()}`,
        role: 'user',
        text: requestText,
        createdAt: new Date().toISOString(),
        attachmentCount: requestImages.length,
        attachmentImages: requestImages
      });
    const nextMessages = trimInvestmentAiMessages(
      retrying
        ? [...messages.filter((item) => item.id !== userMessage.id), userMessage]
        : [...messages, userMessage]
    );
    setMessages(nextMessages);
    if (!retrying) {
      setInput('');
      setImages([]);
    }
    setStreaming('');
    setStreamingReasoning('');
    setComposerFocused(false);
    textareaRef.current?.blur();
    onPromptSubmitted?.(userMessage.id);

    try {
      const isCurrentRequest = () => requestVersion === requestVersionRef.current;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!isCurrentRequest()) return;
      let webSearchPrompt = '';
      let webSearchStatus: WebSearchContext['status'] | undefined;
      let webSearchMessage: string | undefined;
      let webSearchSources: string[] | undefined;
      if (webEnabled) {
        setProgress('web');
        const webSearchContext = await fetchWebSearchContext(
          cleanPrompt,
          webSearch,
          abortController.signal,
          {
            investmentNewsSources: ['10jqka', 'xueqiu']
          }
        );
        webSearchPrompt = buildWebSearchPrompt(webSearchContext);
        webSearchStatus = webSearchContext.status;
        webSearchMessage = webSearchContext.message;
        webSearchSources = webSearchContext.sources;
      }
      if (!isCurrentRequest()) return;
      setProgress('thinking');
      const timeContext = await buildTimeContext();
      const auxiliaryInfo = buildInvestmentAssistantAuxiliaryInfo({
        webEnabled,
        webQuery: cleanPrompt || requestText,
        timeContext,
        contextNote: effectiveContextNote,
        webSearchPrompt,
        webSearchStatus,
        webSearchMessage,
        webSearchSources
      });
      const webModeInstruction = !webEnabled
        ? ''
        : webSearchStatus === 'unavailable'
          ? '\n\n联网模式：用户已开启联网核验，但本次检索未返回可用结果。请如实说明当前无法实时核验，不要编造最新行情或净值。'
          : '\n\n联网模式：用户已开启联网核验。请优先使用以下联网检索上下文核验基金净值、费率、持仓、基金公司和近期表现等最新信息。';
      const baseSystemPrompt = webEnabled
        ? `${timeContext}\n\n${assistantPrompt}${webModeInstruction}\n\n${webSearchPrompt}`
        : `${timeContext}\n\n${assistantPrompt}`;
      const collectedAgentActions: InvestmentAiAgentAction[] = [];
      const toolContext: InvestmentAgentContext = {
        positions: positions.filter((item) => item.isActive),
        goals: [...goals],
        watchlist: [...watchlist],
        monthlyInvestableCash,
        upsertWatchItem: upsertInvestmentWatchItem,
        updateGoal: updateInvestmentGoal
      };
      type AgentTurn = {
        role: 'user' | 'assistant' | 'tool';
        text: string;
        imageDataUrls?: string[];
        toolCalls?: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }>;
        toolCallId?: string;
      };
      type AgentHandlers = {
        onDelta?: (delta: string) => void;
        onReasoningDelta?: (delta: string) => void;
        onDone?: (content: string, reasoning?: string) => void;
      };
      const runInvestmentAgentConversation = async (
        input: {
          baseUrl: string;
          apiKey: string;
          model: string;
          systemPrompt: string;
          messages: Array<{
            role: 'user' | 'assistant';
            text: string;
            imageDataUrls?: string[];
          }>;
          signal: AbortSignal;
        },
        handlers: AgentHandlers
      ) => {
        const turns: AgentTurn[] = input.messages.map((message) => ({
          role: message.role,
          text: message.text,
          imageDataUrls: message.imageDataUrls
        }));
        let toolsAvailable = true;
        let finalContent = '';
        let finalReasoning = '';

        for (let round = 0; round < MAX_INVESTMENT_AGENT_ROUNDS; round += 1) {
          let streamedText = '';
          let streamedReasoning = '';
          const requestHandlers = {
            onDelta: (delta: string) => {
              streamedText += delta;
              handlers.onDelta?.(delta);
            },
            onReasoningDelta: (delta: string) => {
              streamedReasoning += delta;
              handlers.onReasoningDelta?.(delta);
            },
            onDone: (content: string, reasoning?: string) => {
              if (content) streamedText = content;
              if (reasoning) streamedReasoning = reasoning;
            }
          };
          const requestRound = (useTools: boolean) =>
            sendAiChatStream(
              {
                baseUrl: input.baseUrl,
                apiKey: input.apiKey,
                model: input.model,
                systemPrompt: useTools
                  ? `${input.systemPrompt}\n\n${INVESTMENT_AGENT_INSTRUCTIONS}`
                  : input.systemPrompt,
                messages: turns,
                signal: input.signal,
                tools: useTools ? INVESTMENT_AGENT_TOOLS : undefined
              },
              requestHandlers
            );

          let reply: {
            content: string;
            reasoning?: string;
            toolCalls?: ChatToolCall[];
          } | null = null;
          try {
            reply = await requestRound(toolsAvailable);
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            if (toolsAvailable && /HTTP_(400|404|422)/.test(message)) {
              try {
                const fallback = await sendAiChat({
                  baseUrl: input.baseUrl,
                  apiKey: input.apiKey,
                  model: input.model,
                  systemPrompt: `${input.systemPrompt}\n\n${INVESTMENT_AGENT_INSTRUCTIONS}`,
                  messages: turns,
                  signal: input.signal,
                  tools: INVESTMENT_AGENT_TOOLS
                });
                reply = {
                  content: fallback.content,
                  reasoning: fallback.reasoning,
                  toolCalls: fallback.toolCalls
                };
              } catch {
                toolsAvailable = false;
                reply = await requestRound(false);
              }
            } else {
              throw error;
            }
          }

          if (!reply) break;
          finalReasoning += streamedReasoning || reply.reasoning || '';
          finalContent = reply.content || streamedText || finalContent;
          const calls = reply.toolCalls || [];
          if (calls.length === 0) break;

          turns.push({
            role: 'assistant',
            text: reply.content || '',
            toolCalls: calls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: call.arguments }
            }))
          });
          setProgress('tools');
          calls.forEach((call) => {
            const execution = executeInvestmentToolCall(call, toolContext);
            execution.undo.forEach((entry) => onRegisterAgentUndo?.(entry.id, entry.run));
            collectedAgentActions.push(...execution.views);
            turns.push({
              role: 'tool',
              text: execution.content,
              toolCallId: call.id
            });
          });
        }

        handlers.onDone?.(finalContent, finalReasoning);
        return { content: finalContent, reasoning: finalReasoning };
      };
      const result = await runInvestmentAgentConversation(
        {
          baseUrl,
          apiKey,
          model,
          systemPrompt: baseSystemPrompt,
          messages: nextMessages.map((item) => ({
            role: item.role,
            text: item.text,
            imageDataUrls: item.role === 'user' ? item.attachmentImages : undefined
          })),
          signal: abortController.signal
        },
        {
          onDelta: (delta) => {
            if (!isCurrentRequest()) return;
            setProgress('answering');
            setStreaming((prev) => prev + delta);
          },
          onReasoningDelta: (delta) => {
            if (!isCurrentRequest()) return;
            setProgress('answering');
            setStreamingReasoning((prev) => prev + delta);
          },
          onDone: (content, reasoning) => {
            if (!isCurrentRequest()) return;
            const extracted = extractInvestmentAnalysis(content);
            const analysis = extracted.analysis;
            const answer = getInvestmentAssistantDisplayText(content, analysis);
            const assistantMessage: Message = createInvestmentAiMessage({
              id: `investment-assistant-${Date.now()}`,
              role: 'assistant',
              text: answer || tf('investmentAi.answer.fallback', '已完成分析。'),
              createdAt: new Date().toISOString(),
              reasoning,
              webTrace: auxiliaryInfo.webTrace,
              auxiliaryInfo: auxiliaryInfo.relatedData,
              followUpPrompts: analysis?.followUps?.length
                ? analysis.followUps
                : parseInvestmentFollowUpPrompts(content),
              analysis,
              agentActions: collectedAgentActions
            });
            setMessages(trimInvestmentAiMessages([...nextMessages, assistantMessage]));
            setStreaming('');
            setStreamingReasoning('');
            setProgress('');
          }
        }
      );
      if (!isCurrentRequest()) return;
      if (!result.content.trim()) {
        const fallbackPrompts = buildInvestmentFollowUpFallback({
          question: requestText,
          watchlist
        });
        const actionSummary = collectedAgentActions
          .filter((action) => action.kind === 'update')
          .map((action) => action.label)
          .join(';');
        const fallback: Message = createInvestmentAiMessage({
          id: `investment-assistant-${Date.now()}`,
          role: 'assistant',
          text: actionSummary || fallbackPrompts.join(' / '),
          createdAt: new Date().toISOString(),
          followUpPrompts: fallbackPrompts,
          agentActions: collectedAgentActions
        });
        setMessages(trimInvestmentAiMessages([...nextMessages, fallback]));
      }
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(
        err instanceof Error ? err.message : tf('investmentAi.error.analysisFailed', '投资分析失败')
      );
      setFailedTurn({ messageId: userMessage.id, text: requestText, images: requestImages });
      setToast({
        visible: true,
        message: tf('investmentAi.error.analysisFailed', '投资分析失败'),
        variant: 'error'
      });
    } finally {
      if (requestVersion === requestVersionRef.current) {
        abortControllerRef.current = null;
        inFlightRef.current = false;
        setLoading(false);
        setProgress('');
      }
    }
  };

  const submitPromptRef = useRef(submitPrompt);
  submitPromptRef.current = submitPrompt;

  useEffect(() => {
    if (!starterPrompt) return;
    void submitPromptRef.current(starterPrompt.text);
  }, [starterPrompt]);

  const composerExpanded =
    composerFocused || Boolean(input.trim()) || images.length > 0 || modelOpen;

  const scrollToConversationTop = useCallback(() => {
    const targets = new Set<HTMLElement>();
    const messagesArea = document.querySelector<HTMLElement>(
      '.chat-investment-panel .investments-ai-messages-area'
    );
    const supportColumn = textareaRef.current?.closest<HTMLElement>('.investments-support-column');

    if (messagesArea) targets.add(messagesArea);
    if (supportColumn) targets.add(supportColumn);
    targets.forEach((target) => target.scrollTo({ top: 0, behavior: 'smooth' }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <>
      {error ? (
        <div className="chat-inline-error" role="alert">
          <span>{error}</span>
          {failedTurn ? (
            <button
              type="button"
              onClick={() => void submitPrompt(undefined, { retryMessageId: failedTurn.messageId })}
            >
              {tf('investmentAi.retry', '重试本次')}
            </button>
          ) : null}
        </div>
      ) : null}

      {images.length > 0 ? (
        <div
          className="investments-ai-image-strip"
          aria-label={tf('investmentAi.imagesAria', '待分析图片')}
        >
          <div className="investments-ai-thumb-list">
            {images.map((url, index) => (
              <div key={`${url.slice(0, 20)}-${index}`} className="investments-ai-thumb-item">
                <img
                  src={url}
                  alt={tf('investmentAi.imageAlt', '待分析图片 {index}').replace(
                    '{index}',
                    String(index + 1)
                  )}
                  className="investments-ai-thumb"
                />
                <button
                  type="button"
                  className="investments-ai-thumb-remove"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== index))}
                  aria-label={tf('investmentAi.removeImage', '移除第 {index} 张图片').replace(
                    '{index}',
                    String(index + 1)
                  )}
                >
                  x
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setImages([])}>
            {tf('investmentAi.clearImages', '清空图片')}
          </button>
        </div>
      ) : null}

      {showLinks ? (
        <div className="investments-ai-links">
          <Link to="/investments" className="button-with-icon">
            <ChatUploadIcon className="chat-svg-icon" />
            {tf('investmentAi.manage', '投资资料与管理')}
          </Link>
        </div>
      ) : null}

      {!apiKey.trim() ? (
        <div className="investments-ai-settings-hint" role="status">
          <span>
            {tf('investmentAi.noKeyHint', '尚未配置 AI 模型 Key，配置后才能生成投资分析。')}
          </span>
          <Link to="/settings">{tf('investmentAi.goSettings', '去设置')}</Link>
        </div>
      ) : null}

      {progress ? (
        <div className="investments-ai-progress" role="status" aria-live="polite">
          <span className="investments-ai-progress-indicator" aria-hidden="true" />
          <span>
            {tf(
              INVESTMENT_CHAT_PROGRESS_ENTRIES[progress].key,
              INVESTMENT_CHAT_PROGRESS_ENTRIES[progress].fallback
            )}
          </span>
        </div>
      ) : null}

      <form
        className={`chat-input-form investments-ai-composer ${
          composerExpanded ? 'is-expanded' : 'is-compact'
        }`}
        aria-expanded={composerExpanded}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submitPrompt();
        }}
        onPaste={handlePaste}
        onFocusCapture={() => setComposerFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setComposerFocused(false);
          }
        }}
      >
        <div className="chat-input-stack">
          <div
            className="chat-input-main investments-ai-input-main"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (!target.closest('button, input')) textareaRef.current?.focus();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              tabIndex={-1}
              aria-hidden="true"
              className="chat-file-input-hidden"
              aria-label={tf('investmentAi.uploadAria', '上传基金截图')}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                void appendImageFiles(files);
                event.target.value = '';
              }}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              className="chat-input-textarea investments-ai-textarea"
              placeholder={tf('investmentAi.inputPlaceholder', '输入基金问题，Enter 发送')}
              aria-label={tf('investmentAi.inputAria', '基金分析输入框')}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitPrompt();
                }
              }}
              disabled={loading}
            />
            <div className="chat-input-toolbar investments-ai-input-toolbar">
              <div
                className="chat-input-toolbar-left investments-ai-suggestion-row"
                aria-label={tf('investmentAi.suggestionsAria', 'AI 联想提问')}
              >
                <button
                  type="button"
                  className="chat-upload-btn investments-ai-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title={tf('investmentAi.uploadHint', '支持上传或粘贴最多 {count} 张截图').replace(
                    '{count}',
                    String(MAX_INVESTMENT_AI_IMAGES)
                  )}
                  aria-label={tf('investmentAi.uploadAria', '上传基金截图')}
                >
                  <ChatUploadIcon className="chat-svg-icon" />
                </button>
                <button
                  type="button"
                  className={`chat-upload-btn investments-ai-web-btn ${webEnabled ? 'is-active' : ''}`}
                  onClick={() => setWebEnabled((value) => !value)}
                  aria-pressed={webEnabled}
                  aria-label={
                    webEnabled
                      ? tf('investmentAi.webOff', '关闭联网核验')
                      : tf('investmentAi.webOn', '开启联网核验')
                  }
                  title={
                    webEnabled
                      ? tf('investmentAi.webOnTitle', '已开启联网核验')
                      : tf('investmentAi.webOn', '开启联网核验')
                  }
                >
                  {webEnabled ? (
                    <ChatGlobeIcon className="chat-svg-icon" />
                  ) : (
                    <ChatGlobeOffIcon className="chat-svg-icon" />
                  )}
                </button>
                <button
                  type="button"
                  className="chat-upload-btn investments-ai-suggestions-toggle"
                  onClick={() => setSuggestionsCollapsed((value) => !value)}
                  aria-expanded={!suggestionsCollapsed}
                  aria-controls="investments-ai-suggestions"
                  aria-label={
                    suggestionsCollapsed
                      ? tf('investmentAi.expandSuggestions', '展开追问建议')
                      : tf('investmentAi.collapseSuggestions', '收起追问建议')
                  }
                  title={
                    suggestionsCollapsed
                      ? tf('investmentAi.expandSuggestions', '展开追问建议')
                      : tf('investmentAi.collapseSuggestions', '收起追问建议')
                  }
                >
                  {suggestionsCollapsed ? (
                    <ChatChevronsUpDownIcon className="chat-svg-icon" />
                  ) : (
                    <ChatChevronsDownUpIcon className="chat-svg-icon" />
                  )}
                </button>
                <div
                  className="chat-model-selector chat-model-selector-inline investments-ai-model-selector"
                  ref={modelSelectorRef}
                >
                  <button
                    type="button"
                    className={`chat-model-trigger investments-ai-model-trigger ${modelOpen ? 'is-open' : ''}`}
                    onClick={() => {
                      if (modelOpen) {
                        setModelOpen(false);
                        return;
                      }
                      openModelPicker();
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={modelOpen}
                    aria-label={tf('investmentAi.currentModelAria', '当前模型：{name}').replace(
                      '{name}',
                      getModelDisplayLabel(model || tf('investmentAi.modelFallback', '选择模型'))
                    )}
                    title={getModelDisplayLabel(
                      model || tf('investmentAi.modelFallback', '选择模型')
                    )}
                    ref={modelTriggerRef}
                  >
                    <span className="chat-model-trigger-icon">
                      <AiModelFamilyIcon
                        family={resolveAiModelFamily(model)}
                        className="chat-svg-icon chat-model-trigger-glyph"
                      />
                    </span>
                    <span className="chat-model-inline-label">
                      {getModelDisplayLabel(model || tf('investmentAi.modelFallback', '选择模型'))}
                    </span>
                  </button>

                  {modelOpen
                    ? createPortal(
                        <div
                          ref={dropdownRef}
                          className="chat-model-dropdown investments-ai-model-dropdown"
                          role="menu"
                          aria-label={tf('investmentAi.modelListAria', '模型列表')}
                          style={dropdownStyle}
                        >
                          <div className="chat-model-list">
                            {loadingModels ? (
                              <div className="chat-model-empty">
                                {tf('investmentAi.modelLoading', '正在加载模型列表...')}
                              </div>
                            ) : models.length === 0 ? (
                              <div className="chat-model-empty">
                                {tf('investmentAi.modelEmpty', '暂无可选模型')}
                              </div>
                            ) : (
                              models.map((item) => (
                                <button
                                  key={item}
                                  type="button"
                                  role="menuitem"
                                  className={`chat-model-option ${item === model ? 'active' : ''}`}
                                  onClick={() => selectModel(item)}
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
                        </div>,
                        document.body
                      )
                    : null}
                </div>
                {!suggestionsCollapsed && followUps.length > 0 ? (
                  <div className="investments-ai-suggestion-list" id="investments-ai-suggestions">
                    {followUps.map((question) => (
                      <button
                        key={question}
                        type="button"
                        className="vi-chip"
                        onClick={() => void submitPrompt(question)}
                        disabled={loading}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="chat-upload-btn investments-ai-scroll-top-btn"
                onClick={scrollToConversationTop}
                title={tf('investmentAi.backToTop', '返回页面顶部')}
                aria-label={tf('investmentAi.backToTop', '返回页面顶部')}
              >
                <ChatChevronUpIcon className="chat-svg-icon" />
              </button>
              {loading ? (
                <button
                  type="button"
                  className="chat-send-btn investments-ai-submit-btn is-stop"
                  onClick={stopRequest}
                  title={tf('investmentAi.stop', '停止生成')}
                  aria-label={tf('investmentAi.stop', '停止生成')}
                >
                  <ChatStopIcon className="chat-svg-icon chat-svg-icon--filled chat-send-stop-icon" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="chat-send-btn investments-ai-submit-btn"
                  disabled={!input.trim() && images.length === 0}
                  title={tf('investmentAi.send', '发送')}
                  aria-label={tf('investmentAi.sendAria', '开始分析')}
                >
                  <ChatSendIcon className="chat-svg-icon" />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      <Toast
        visible={toast.visible}
        message={toast.message}
        variant={toast.variant}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </>
  );
}

type InvestmentChatPanelProps = {
  showComposer?: boolean;
  showHero?: boolean;
  defaultWebEnabled?: boolean;
  contextNote?: string;
  focus?: {
    type: 'position' | 'watch' | 'market' | 'news';
    label: string;
    detail?: string;
  } | null;
  requestedPrompt?: { text: string; token: number } | null;
  floating?: boolean;
  floatingPosition?: 'bottom-right' | 'bottom-left';
};

export function InvestmentChatPanel({
  showComposer = true,
  showHero = true,
  defaultWebEnabled = false,
  contextNote = '',
  focus = null,
  requestedPrompt = null,
  floating = false,
  floatingPosition = 'bottom-right'
}: InvestmentChatPanelProps) {
  const tf = useTFallback();
  const messages = useAppPreferences((s) => s.investmentAiMessages);
  const setInvestmentAiMessages = useAppPreferences((s) => s.setInvestmentAiMessages);
  const clearInvestmentAiMessages = useAppPreferences((s) => s.clearInvestmentAiMessages);
  const positions = useAppPreferences((s) => s.investmentPositions);
  const goals = useAppPreferences((s) => s.investmentGoals);
  const watchlist = useAppPreferences((s) => s.investmentWatchlist);
  const aiApiKey = useAiSettings((s) => s.apiKey);
  const aiModel = useAiSettings((s) => s.model);
  const agentReady = Boolean(aiApiKey.trim() && aiModel.trim());
  const isCompact = !showHero;
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const agentUndoRef = useRef(new Map<string, () => void>());
  const [undoableActionIds, setUndoableActionIds] = useState<Set<string>>(() => new Set());
  const floatingPanelRef = useRef<HTMLElement | null>(null);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null);
  const [activeTurnMessageId, setActiveTurnMessageId] = useState<string | null>(null);
  const [selectedHistoryMessageId, setSelectedHistoryMessageId] = useState('');
  const [clearContextVersion, setClearContextVersion] = useState(0);
  const [starterPrompt, setStarterPrompt] = useState<{ text: string; token: number } | null>(null);
  const starterPromptTokenRef = useRef(0);
  const [clearContextConfirmOpen, setClearContextConfirmOpen] = useState(false);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [floatingPinned, setFloatingPinned] = useState(false);
  const [floatingBounds, setFloatingBounds] = useState<FloatingPanelBounds | null>(null);
  /*
   * 未拖动过时面板尺寸由 CSS 决定,floatingBounds 是 null。键盘调节和 aria-valuenow
   * 都需要一个真实数字,所以量一份 —— 量不到就报 0,而 aria-valuemin 是 320/360,
   * 读屏用户会听到自相矛盾的值(抽屉那边踩过同一个坑)。
   */
  const [floatingMetrics, setFloatingMetrics] = useState<FloatingPanelBounds | null>(null);
  const floatingResizeRef = useRef<FloatingResizeState | null>(null);
  const historyTurns = useMemo(() => messages.filter((item) => item.role === 'user'), [messages]);
  const latestMessageId = messages[messages.length - 1]?.id || '';
  const contextStats = useMemo(
    () => ({
      positions: positions.filter((item) => item.isActive).length,
      goals: goals.length,
      watchlist: watchlist.length
    }),
    [goals.length, positions, watchlist.length]
  );

  const registerAgentUndo = useCallback((id: string, run: () => void) => {
    agentUndoRef.current.set(id, run);
    setUndoableActionIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const handleUndoAgentAction = useCallback(
    (messageId: string, actionId: string) => {
      const run = agentUndoRef.current.get(actionId);
      if (!run) return;
      run();
      agentUndoRef.current.delete(actionId);
      setUndoableActionIds((current) => {
        if (!current.has(actionId)) return current;
        const next = new Set(current);
        next.delete(actionId);
        return next;
      });
      setInvestmentAiMessages(
        messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                agentActions: message.agentActions?.map((entry) =>
                  entry.id === actionId ? { ...entry, undone: true } : entry
                )
              }
            : message
        )
      );
    },
    [messages, setInvestmentAiMessages]
  );

  const minimizeFloatingPanel = useCallback(() => {
    setFloatingOpen(false);
    setFloatingPinned(false);
  }, []);

  const startFloatingResize = useCallback(
    (edge: FloatingResizeEdge, event: ReactPointerEvent<HTMLSpanElement>) => {
      if (!floating || window.innerWidth <= 640) return;

      const panel = floatingPanelRef.current;
      if (!panel) return;

      event.preventDefault();
      event.stopPropagation();

      const rect = panel.getBoundingClientRect();
      const resizeState: FloatingResizeState = {
        edge,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        previousUserSelect: document.body.style.userSelect
      };
      floatingResizeRef.current = resizeState;
      document.body.style.userSelect = 'none';

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const current = floatingResizeRef.current;
        if (!current) return;

        const deltaX = moveEvent.clientX - current.startX;
        const deltaY = moveEvent.clientY - current.startY;
        const movesLeft = current.edge.includes('left');
        const movesRight = current.edge.includes('right');
        const movesTop = current.edge.includes('top');
        const movesBottom = current.edge.includes('bottom');
        const maxWidth = Math.max(
          FLOATING_CHAT_MIN_WIDTH,
          window.innerWidth - FLOATING_CHAT_VIEWPORT_GUTTER * 2
        );
        const maxHeight = Math.max(
          FLOATING_CHAT_MIN_HEIGHT,
          window.innerHeight - FLOATING_CHAT_VIEWPORT_GUTTER * 2
        );
        let nextLeft = current.left;
        let nextTop = current.top;
        let nextWidth = current.width;
        let nextHeight = current.height;

        if (movesLeft) {
          nextLeft = Math.min(
            Math.max(FLOATING_CHAT_VIEWPORT_GUTTER, current.left + deltaX),
            current.left + current.width - FLOATING_CHAT_MIN_WIDTH
          );
          nextWidth = current.width - (nextLeft - current.left);
        } else if (movesRight) {
          nextWidth = Math.min(
            Math.max(FLOATING_CHAT_MIN_WIDTH, current.width + deltaX),
            Math.min(maxWidth, window.innerWidth - current.left - FLOATING_CHAT_VIEWPORT_GUTTER)
          );
        }

        if (movesTop) {
          nextTop = Math.min(
            Math.max(FLOATING_CHAT_VIEWPORT_GUTTER, current.top + deltaY),
            current.top + current.height - FLOATING_CHAT_MIN_HEIGHT
          );
          nextHeight = current.height - (nextTop - current.top);
        } else if (movesBottom) {
          nextHeight = Math.min(
            Math.max(FLOATING_CHAT_MIN_HEIGHT, current.height + deltaY),
            Math.min(maxHeight, window.innerHeight - current.top - FLOATING_CHAT_VIEWPORT_GUTTER)
          );
        }

        setFloatingBounds({
          left: nextLeft,
          top: nextTop,
          width: nextWidth,
          height: nextHeight
        });
      };

      const finishResize = () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', finishResize);
        document.removeEventListener('pointercancel', finishResize);
        document.body.style.userSelect = resizeState.previousUserSelect;
        floatingResizeRef.current = null;
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', finishResize);
      document.addEventListener('pointercancel', finishResize);
    },
    [floating]
  );

  /*
   * 量一次面板的真实位置与尺寸。floatingBounds 只在用户拖动过之后才有值,
   * 所以两条都要跟:显示时量一次,拖动后(floatingBounds 变化)再量一次。
   */
  useEffect(() => {
    if (!floating || !floatingOpen) {
      setFloatingMetrics(null);
      return;
    }
    const node = floatingPanelRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setFloatingMetrics({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
  }, [floating, floatingOpen, floatingBounds]);

  const floatingCurrent = floatingBounds ?? floatingMetrics;

  /*
   * 上限公式与拖拽共用(见 getFloatingAxisMax)。
   *
   * ⚠ 这里的值来自**测量**,而测量可能陈旧(面板打开时有入场过渡,打开瞬间量到的是
   * 过渡中的尺寸:实测真实 430×560 @(986,316),量到 413×538 @(995,339))。
   * 所以按键时不用这份值当基准 —— 一律以实时矩形为准(见 handleFloatingResizeKeyDown),
   * 并在聚焦手柄时重量一次刷新这里,让 aria 读到的是真数。
   */
  const floatingMaxWidth = floatingCurrent
    ? getFloatingAxisMax(FLOATING_CHAT_MIN_WIDTH, floatingCurrent.left, window.innerWidth)
    : FLOATING_CHAT_MIN_WIDTH;
  const floatingMaxHeight = floatingCurrent
    ? getFloatingAxisMax(FLOATING_CHAT_MIN_HEIGHT, floatingCurrent.top, window.innerHeight)
    : FLOATING_CHAT_MIN_HEIGHT;

  /** 聚焦手柄时重量一次:此时面板早已落位,量到的是真值。 */
  const remeasureFloatingPanel = useCallback(() => {
    const node = floatingPanelRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setFloatingMetrics({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
  }, []);

  /*
   * WCAG 2.1.1(键盘可达):这个浮窗原来 8 个手柄全是纯指针的,外层还套着 aria-hidden,
   * 键盘和读屏用户既够不到、也不知道它可调。
   *
   * 只让**右边缘(宽度)和下边缘(高度)**可聚焦:一角同时改宽高在 ARIA 里没有对应的
   * 单轴语义(separator 只有一个值、一个方向),两条边各自成一个 separator 才是诚实的表达。
   *
   * 基准一律取**实时矩形**:用状态里的测量值当基准的话,第一下方向键会把面板从真实尺寸
   * 拉到陈旧尺寸(实测真实宽 430、状态里是 413,按一下 → 面板先缩到 429 再涨)。
   */
  const handleFloatingResizeKeyDown = (
    edge: 'right' | 'bottom',
    event: ReactKeyboardEvent<HTMLSpanElement>
  ) => {
    const node = floatingPanelRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const baseLeft = Math.round(rect.left);
    const baseTop = Math.round(rect.top);
    const step = event.shiftKey ? FLOATING_CHAT_KEYBOARD_COARSE_STEP : FLOATING_CHAT_KEYBOARD_STEP;

    let nextWidth = Math.round(rect.width);
    let nextHeight = Math.round(rect.height);

    if (edge === 'right') {
      const max = getFloatingAxisMax(FLOATING_CHAT_MIN_WIDTH, baseLeft, window.innerWidth);
      let next: number | null = null;
      if (event.key === 'ArrowRight') next = nextWidth + step;
      else if (event.key === 'ArrowLeft') next = nextWidth - step;
      else if (event.key === 'Home') next = FLOATING_CHAT_MIN_WIDTH;
      else if (event.key === 'End') next = max;
      if (next === null) return;
      nextWidth = Math.min(max, Math.max(FLOATING_CHAT_MIN_WIDTH, next));
    } else {
      const max = getFloatingAxisMax(FLOATING_CHAT_MIN_HEIGHT, baseTop, window.innerHeight);
      let next: number | null = null;
      if (event.key === 'ArrowDown') next = nextHeight + step;
      else if (event.key === 'ArrowUp') next = nextHeight - step;
      else if (event.key === 'Home') next = FLOATING_CHAT_MIN_HEIGHT;
      else if (event.key === 'End') next = max;
      if (next === null) return;
      nextHeight = Math.min(max, Math.max(FLOATING_CHAT_MIN_HEIGHT, next));
    }

    event.preventDefault();
    event.stopPropagation();
    setFloatingBounds({
      left: baseLeft,
      top: baseTop,
      width: nextWidth,
      height: nextHeight
    });
  };

  useEffect(() => {
    const handleViewportResize = () => {
      if (window.innerWidth <= 640) {
        setFloatingBounds(null);
      }
    };

    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  useEffect(() => {
    if (!floating || !floatingOpen || floatingPinned) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || floatingPanelRef.current?.contains(target)) return;
      if (target.closest('.chat-model-dropdown, [role="dialog"], .toast')) return;
      setFloatingOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, [floating, floatingOpen, floatingPinned]);

  const scrollToMessage = useCallback(
    (messageId: string, block: ScrollLogicalPosition = 'start') => {
      messageRefs.current.get(messageId)?.scrollIntoView?.({ behavior: 'smooth', block });
    },
    []
  );

  useEffect(() => {
    if (historyTurns.length === 0) {
      setSelectedHistoryMessageId('');
      return;
    }

    setSelectedHistoryMessageId((current) =>
      historyTurns.some((item) => item.id === current)
        ? current
        : historyTurns[historyTurns.length - 1].id
    );
  }, [historyTurns]);

  const handlePromptSubmitted = useCallback((messageId: string) => {
    setActiveTurnMessageId(messageId);
    setPendingScrollMessageId(messageId);
  }, []);

  const handleStarterPrompt = useCallback((text: string) => {
    starterPromptTokenRef.current += 1;
    setStarterPrompt({ text, token: starterPromptTokenRef.current });
  }, []);

  useEffect(() => {
    if (!requestedPrompt) return;
    setFloatingOpen(true);
    setStarterPrompt({ text: requestedPrompt.text, token: requestedPrompt.token });
  }, [requestedPrompt]);

  const clearContext = useCallback(() => {
    clearInvestmentAiMessages();
    messageRefs.current.clear();
    setActiveTurnMessageId(null);
    setPendingScrollMessageId(null);
    setSelectedHistoryMessageId('');
    setClearContextVersion((current) => current + 1);
    setClearContextConfirmOpen(false);
  }, [clearInvestmentAiMessages]);

  useLayoutEffect(() => {
    if (!pendingScrollMessageId) return;
    const messageElement = messageRefs.current.get(pendingScrollMessageId);
    if (!messageElement) return;

    messageElement.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setPendingScrollMessageId(null);
  }, [messages, pendingScrollMessageId]);

  const handleCompactWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!isCompact) return;
      const target = event.target as HTMLElement | null;
      if (floating) {
        const messageArea = target?.closest('.investments-ai-messages-area') as HTMLElement | null;
        if (messageArea && event.deltaY !== 0) {
          messageArea.scrollTop += event.deltaY;
        }
        // 浮动问答内的滚动只属于聊天窗口，避免到达边界时继续带动投资页。
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (target?.closest('textarea, input, select, .chat-model-dropdown')) {
        return;
      }

      if (event.deltaY === 0) return;
      const supportColumn = (event.currentTarget as HTMLElement).closest(
        '.investments-support-column'
      ) as HTMLElement | null;
      if (!supportColumn) return;

      supportColumn.scrollTop += event.deltaY;
      event.preventDefault();
    },
    [floating, isCompact]
  );

  return (
    <>
      {floating && !floatingOpen ? (
        <button
          type="button"
          className="investment-chat-floating-launcher"
          aria-label={tf('investmentAi.launcherOpen', '打开 AI 投资助手')}
          aria-expanded={false}
          onClick={() => setFloatingOpen(true)}
        >
          <span className="investment-chat-floating-launcher-icon" aria-hidden="true">
            <ChatSparklesIcon className="chat-svg-icon" />
          </span>
          <span className="investment-chat-floating-launcher-copy" aria-hidden="true">
            <strong>{tf('investmentAi.title', 'AI 投资助手')}</strong>
          </span>
          {messages.length > 0 ? (
            <i
              aria-label={tf('investmentAi.messageCount', '{count} 条对话').replace(
                '{count}',
                String(messages.length)
              )}
            />
          ) : null}
        </button>
      ) : null}

      <section
        ref={floatingPanelRef}
        className={`${showHero ? 'chat-kawaii-panel chat-assistant-panel ' : ''}chat-investment-panel ${
          isCompact ? 'is-compact' : ''
        } ${messages.length === 0 ? 'is-empty' : ''} ${activeTurnMessageId ? 'has-active-turn' : ''} ${
          floating ? `is-floating is-floating-${floatingPosition}` : ''
        } ${floating && !floatingOpen ? 'is-floating-hidden' : ''}`}
        data-floating-position={floating ? floatingPosition : undefined}
        style={
          floating && floatingBounds
            ? {
                left: `${floatingBounds.left}px`,
                top: `${floatingBounds.top}px`,
                right: 'auto',
                bottom: 'auto',
                width: `${floatingBounds.width}px`,
                height: `${floatingBounds.height}px`
              }
            : undefined
        }
        onWheelCapture={handleCompactWheelCapture}
      >
        {floating ? (
          /*
           * 这里原来有 aria-hidden="true"。它挡不住鼠标操作,却会连带把里面**可聚焦**的
           * 调节手柄从无障碍树里摘掉 —— 那正是 "aria-hidden 里有可聚焦元素" 这类问题的来源。
           * 现在去掉:不参与键盘的 6 个手柄是空的 <span>,本来就不会被读屏读出来;
           * 参与键盘的右/下两条边挂 role="separator",需要被读出来。
           */
          <div className="investment-chat-floating-resize-handles">
            {(
              [
                'top',
                'right',
                'bottom',
                'left',
                'top-left',
                'top-right',
                'bottom-right',
                'bottom-left'
              ] as FloatingResizeEdge[]
            ).map((edge) => {
              // 只有右边缘(调宽)和下边缘(调高)有键盘入口,见 handleFloatingResizeKeyDown。
              const keyboardAxis =
                edge === 'right' ? 'width' : edge === 'bottom' ? 'height' : null;
              return (
                <span
                  key={edge}
                  className={`investment-chat-floating-resize-handle is-${edge}`}
                  {...(keyboardAxis
                    ? {
                        role: 'separator',
                        tabIndex: 0,
                        'aria-orientation': keyboardAxis === 'width' ? 'vertical' : 'horizontal',
                        'aria-label':
                          keyboardAxis === 'width'
                            ? tf('investmentAi.resizeWidthAria', '调整 AI 助手浮窗宽度')
                            : tf('investmentAi.resizeHeightAria', '调整 AI 助手浮窗高度'),
                        'aria-valuenow': Math.round(
                          keyboardAxis === 'width'
                            ? (floatingCurrent?.width ?? FLOATING_CHAT_MIN_WIDTH)
                            : (floatingCurrent?.height ?? FLOATING_CHAT_MIN_HEIGHT)
                        ),
                        'aria-valuemin':
                          keyboardAxis === 'width' ? FLOATING_CHAT_MIN_WIDTH : FLOATING_CHAT_MIN_HEIGHT,
                        'aria-valuemax':
                          keyboardAxis === 'width' ? floatingMaxWidth : floatingMaxHeight
                      }
                    : {})}
                  onPointerDown={(event) => startFloatingResize(edge, event)}
                  {...(keyboardAxis
                    ? {
                        // 聚焦时重量一次:面板此时早已落位,aria 读到的是真值而不是打开那瞬的过渡尺寸。
                        onFocus: remeasureFloatingPanel,
                        onKeyDown: (event: ReactKeyboardEvent<HTMLSpanElement>) =>
                          handleFloatingResizeKeyDown(
                            keyboardAxis === 'width' ? 'right' : 'bottom',
                            event
                          )
                      }
                    : {})}
                />
              );
            })}
          </div>
        ) : null}
        {floating ? (
          <header className="investment-chat-floating-head">
            <div className="investment-chat-floating-title">
              <span className="investment-chat-floating-title-icon" aria-hidden="true">
                <ChatSparklesIcon className="chat-svg-icon" />
              </span>
              <div>
                <strong>
                  {tf('investmentAi.title', 'AI 投资助手')}
                  <em className="investment-chat-agent-badge">
                    {tf('investmentAi.agentBadge', 'Agent')}
                  </em>
                </strong>
                <small>{tf('investmentAi.syncedHint', '已同步持仓、自选与今日行情')}</small>
              </div>
            </div>
            <div className="investment-chat-floating-head-actions">
              <Link
                to="/assistant"
                className="investment-chat-floating-expand"
                aria-label={tf('investmentAi.openFull', '打开完整 AI 投资助手')}
                title={tf('investmentAi.openFull', '打开完整 AI 投资助手')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 4h6v6" />
                  <path d="M20 4 10 14" />
                  <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                </svg>
              </Link>
              <button
                type="button"
                className={`investment-chat-floating-pin ${floatingPinned ? 'is-active' : ''}`}
                aria-label={
                  floatingPinned
                    ? tf('investmentAi.unpin', '取消置顶 AI 投资助手')
                    : tf('investmentAi.pin', '置顶 AI 投资助手')
                }
                title={
                  floatingPinned
                    ? tf('investmentAi.unpinTitle', '取消置顶，点击外围可自动收起')
                    : tf('investmentAi.pinTitle', '置顶，点击外围不收起')
                }
                aria-pressed={floatingPinned}
                onClick={() => setFloatingPinned((current) => !current)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 3h6l-1.2 6 3.2 3v2H7v-2l3.2-3L9 3Z" />
                  <path d="M12 14v7" />
                </svg>
              </button>
              <button
                type="button"
                className="investment-chat-floating-close"
                aria-label={tf('investmentAi.collapse', '收起 AI 投资助手')}
                title={tf('investmentAi.collapse', '收起 AI 投资助手')}
                onClick={minimizeFloatingPanel}
              >
                ×
              </button>
            </div>
          </header>
        ) : null}

        <div
          className="investment-chat-context-strip"
          aria-label={tf('investmentAi.contextAria', 'AI 已同步的投资上下文')}
        >
          <span>
            <b>{contextStats.positions}</b> {tf('investmentAi.context.positions', '笔持仓')}
          </span>
          <span>
            <b>{contextStats.watchlist}</b> {tf('investmentAi.context.watchlist', '只自选')}
          </span>
          <span>
            <b>{contextStats.goals}</b> {tf('investmentAi.context.goals', '个目标')}
          </span>
          <span
            className={agentReady ? 'is-agent-ready' : 'is-agent-offline'}
            title={
              agentReady
                ? tf('investmentAi.readyHint', '已配置 AI 模型\uFF0C可直接读取持仓、自选与今日行情')
                : tf('investmentAi.notReadyHint', '尚未配置 AI 模型 Key\uFF0C配置后助手才能生成分析')
            }
          >
            <i aria-hidden="true" />
            {agentReady
              ? tf('investmentAi.agentReady', 'Agent 已连接')
              : tf('investmentAi.agentPending', '待配置 AI Key')}
          </span>
          {focus ? (
            <strong title={focus.label}>
              {tf('investmentAi.focusLabel', '正在看：{name}').replace('{name}', focus.label)}
            </strong>
          ) : null}
        </div>

        {showHero && messages.length === 0 ? (
          <section
            className="chat-mode-welcome chat-investment-welcome"
            aria-label={tf('investmentAi.title', 'AI 投资助手')}
          >
            <div className="chat-mode-welcome-copy">
              <div className="chat-mode-welcome-eyebrow">
                {tf('investmentAi.title', 'AI 投资助手')}
                <span>·</span> {tf('investmentAi.welcomeEyebrow', '看懂市场，也看懂自己的持仓')}
              </div>
              <h2>
                {tf('investmentAi.welcomeHeadlineLead', '投资上的问题，')}
                <em>{tf('investmentAi.welcomeHeadlineAccent', '一起理清楚')}</em>
              </h2>
              <p>
                {tf(
                  'investmentAi.welcomeDescription',
                  '聊基金、股票和资产配置；结合你的持仓与公开信息分析，不承诺收益。'
                )}
              </p>
              <div className="chat-mode-welcome-features">
                <div>
                  <b>01</b>
                  <span>
                    {tf('investmentAi.welcomeFeatureMarket', '看市场')}
                    <small>{tf('investmentAi.welcomeFeatureMarketNote', '梳理行情与近期变化')}</small>
                  </span>
                </div>
                <div>
                  <b>02</b>
                  <span>
                    {tf('investmentAi.welcomeFeatureHoldings', '看持仓')}
                    <small>{tf('investmentAi.welcomeFeatureHoldingsNote', '结合你的自选与投资组合')}</small>
                  </span>
                </div>
                <div>
                  <b>03</b>
                  <span>
                    {tf('investmentAi.welcomeFeatureJudge', '做判断')}
                    <small>{tf('investmentAi.welcomeFeatureJudgeNote', '说明依据与需要留意的风险')}</small>
                  </span>
                </div>
              </div>
            </div>
            <img
              className="chat-mode-welcome-illustration chat-investment-illustration"
              src={INVESTMENT_HERO_ILLUSTRATION_URL}
              alt=""
              aria-hidden="true"
            />
          </section>
        ) : null}

        {messages.length > 0 ? (
          <div className="chat-messages-area investments-ai-messages-area">
            <div
              className={`investments-ai-history-actions ${historyTurns.length > 2 ? '' : 'is-compact'}`}
            >
              {historyTurns.length > 2 ? (
                <nav
                  className="investments-ai-history-nav"
                  aria-label={tf('investmentAi.historyNavAria', '投资聊天记录导航')}
                >
                  <span>
                    {tf('investmentAi.historyTurns', '{count} 轮').replace(
                      '{count}',
                      String(historyTurns.length)
                    )}
                  </span>
                  <select
                    aria-label={tf('investmentAi.historySelectAria', '跳转到历史提问')}
                    value={selectedHistoryMessageId}
                    onChange={(event) => {
                      const messageId = event.target.value;
                      setSelectedHistoryMessageId(messageId);
                      scrollToMessage(messageId);
                    }}
                  >
                    {historyTurns.map((item, index) => (
                      <option key={item.id} value={item.id}>
                        {getInvestmentChatHistoryLabel(item.text, index, tf)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => scrollToMessage(latestMessageId, 'end')}
                    aria-label={tf('investmentAi.backToLatest', '回到最新消息')}
                    title={tf('investmentAi.backToLatest', '回到最新消息')}
                  >
                    {tf('investmentAi.latest', '最新')}
                  </button>
                </nav>
              ) : null}
              <button
                type="button"
                className="investments-ai-clear-context"
                onClick={() => setClearContextConfirmOpen(true)}
                aria-label={tf('investmentAi.clearContext', '清空上下文')}
                title={tf('investmentAi.clearContext', '清空上下文')}
              >
                {tf('investmentAi.clearContext', '清空上下文')}
              </button>
            </div>
            <div className="chat-messages-inner">
              {messages.map((item) => (
                <article
                  key={item.id}
                  ref={(element) => {
                    if (element) messageRefs.current.set(item.id, element);
                    else messageRefs.current.delete(item.id);
                  }}
                  className={`chat-msg ${item.role === 'user' ? 'chat-msg-user' : ''}`}
                >
                  <Avatar user={item.role === 'user'} />
                  <div className="chat-msg-body">
                    <div className="chat-msg-header">
                      {item.role === 'user'
                        ? tf('investmentAi.roleUser', '你')
                        : tf('investmentAi.roleAssistant', '助手')}
                    </div>
                    <div className="chat-msg-content chat-msg-content-rich">
                      {renderMarkdownContent(
                        item.role === 'assistant'
                          ? getInvestmentAssistantDisplayText(item.text, item.analysis)
                          : item.text
                      )}
                    </div>
                    {item.role === 'assistant' && item.agentActions?.length ? (
                      <div
                        className="investment-ai-agent-actions"
                        aria-label={tf('investmentAi.agentActionsAria', 'AI 已执行的操作')}
                      >
                        {item.agentActions.map((action) => (
                          <span
                            key={action.id}
                            className={`investment-ai-agent-action is-${action.kind} ${
                              action.undone ? 'is-undone' : ''
                            }`}
                          >
                            <b>
                              {action.kind === 'update'
                                ? tf('investmentAi.agentActionUpdated', '已更新')
                                : tf('investmentAi.agentActionRead', '已读取')}
                            </b>
                            <span className="investment-ai-agent-action-label">{action.label}</span>
                            {action.kind === 'update' &&
                            action.undoable &&
                            !action.undone &&
                            undoableActionIds.has(action.id) ? (
                              <button
                                type="button"
                                className="investment-ai-agent-action-undo"
                                onClick={() => handleUndoAgentAction(item.id, action.id)}
                              >
                                {tf('investmentAi.agentActionUndo', '撤销')}
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.role === 'assistant' ? (
                      <InvestmentAiMessageDetails
                        reasoning={item.reasoning}
                        webTrace={item.webTrace}
                        auxiliaryInfo={item.auxiliaryInfo}
                      />
                    ) : null}
                    {item.attachmentImages?.length ? (
                      <div className="investments-ai-message-attachments">
                        {item.attachmentImages.map((url, index) => (
                          <a
                            key={`${item.id}-${index}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={url}
                              alt={tf('investmentAi.attachedImageAlt', '附带图片 {index}').replace(
                                '{index}',
                                String(index + 1)
                              )}
                            />
                          </a>
                        ))}
                      </div>
                    ) : item.attachmentCount ? (
                      <p className="investments-ai-attachment-note">
                        {tf('investmentAi.attachedImagesNote', '附带 {count} 张图片').replace(
                          '{count}',
                          String(item.attachmentCount)
                        )}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
              <div aria-hidden="true" />
            </div>
          </div>
        ) : isCompact ? (
          <div
            className="investments-ai-empty-compact"
            aria-label={tf('investmentAi.emptyCompactAria', '投资理财空状态')}
          >
            <img src={INVESTMENT_HERO_ILLUSTRATION_URL} alt="" aria-hidden="true" />
            <strong>{tf('investmentAi.emptyCompactTitle', '先丢一个基金问题给我')}</strong>
            <p>
              {tf('investmentAi.emptyCompactHint', '例如：这只基金现在适合继续定投吗？')}
            </p>
          </div>
        ) : (
          <article className="chat-msg chat-investment-starter">
            <Avatar />
            <div className="chat-msg-body">
              <div className="chat-msg-header">{tf('investmentAi.starterHeader', '投资助手')}</div>
              <div className="chat-msg-content">
                <p>
                  {tf(
                    'investmentAi.welcomeHint',
                    '可以从你的持仓、基金定投或今天的市场开始问。我会把结论和判断依据说清楚。'
                  )}
                </p>
                <div
                  className="chat-investment-starter-prompts"
                  aria-label={tf('investmentAi.quickPromptsAria', '快捷问题')}
                >
                  {INVESTMENT_STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt.key}
                      type="button"
                      onClick={() => handleStarterPrompt(tf(prompt.key, prompt.fallback))}
                      disabled={Boolean(activeTurnMessageId)}
                    >
                      {tf(prompt.key, prompt.fallback)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </article>
        )}

        {showComposer ? (
          <InvestmentChatComposer
            showLinks={!isCompact}
            defaultWebEnabled={defaultWebEnabled}
            contextNote={contextNote}
            focus={focus}
            onPromptSubmitted={handlePromptSubmitted}
            clearContextVersion={clearContextVersion}
            starterPrompt={starterPrompt}
            onRegisterAgentUndo={registerAgentUndo}
          />
        ) : null}

        <ConfirmDialog
          open={clearContextConfirmOpen}
          title={tf('investmentAi.clearDialogTitle', '清空聊天上下文')}
          description={tf(
            'investmentAi.clearDialogDescription',
            '确定清空本次投资聊天上下文吗？此操作不可恢复。'
          )}
          confirmText={tf('investmentAi.clearDialogConfirm', '清空')}
          danger
          onConfirm={clearContext}
          onCancel={() => setClearContextConfirmOpen(false)}
        />
      </section>
    </>
  );
}

function getInvestmentChatHistoryLabel(text: string, index: number, tf: TfFallback) {
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 20);
  const roundLabel = tf('investmentAi.historyTurnLabel', '第 {round} 轮').replace(
    '{round}',
    String(index + 1)
  );
  return `${roundLabel}${preview ? ` · ${preview}` : ''}`;
}
