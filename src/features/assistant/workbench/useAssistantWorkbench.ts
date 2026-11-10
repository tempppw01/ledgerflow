import {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { fetchAiModels, sendAiChatStream } from '../api/openaiCompatibleClient';
import type { ChatToolCall } from '../api/openaiCompatibleClient';
import {
  ASSISTANT_AGENT_INSTRUCTIONS,
  ASSISTANT_AGENT_TOOLS,
  executeAssistantToolCall,
  type AgentActionView,
  type AgentToolContext
} from '../agent/assistantAgentTools';
import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import { useDebugLogStore } from '../../../shared/store/useDebugLogStore';
import { useAiSettings } from '../../../shared/store/useAiSettings';
import type {
  AddTransactionAction,
  TransactionBatchOperation
} from '../../../shared/store/useFinanceStore';
import { AI_MODEL_PRESETS, mergeAiModelOptions } from '../../../shared/config/aiModels';
import {
  clearSemanticRecallIndexCache,
  createEmptyBlockingSemanticRecallResult,
  createIdleEmbeddingDebug,
  createSemanticRecallMeta,
  readSemanticRecallCacheMeta,
  runBlockingSemanticRecall,
  type EmbeddingRecallDebug,
  type SemanticRecallCacheMeta
} from './assistantSemanticRecall';
import type { GlobalMemoryItem } from '../../../shared/store/globalMemory';
import {
  ANALYSIS_AGENT_PROMPT,
  buildBillContentSignature,
  CREDIT_ANALYSIS_AGENT_PROMPT,
  buildAssistantSystemPrompt,
  buildTimeContext,
  buildTransactionPromptContext,
  buildRepaymentPromptContext,
  extractJsonString,
  JSON_AGENT_PROMPT,
  normalizeAiBill,
  readImageAsDataUrl,
  readPdfAsDataUrl,
  resolveTransactionCurrency,
  splitPdfFileByPages,
  toDraftEntries,
  validateDraft
} from './workbenchUtils';
import {
  ensureAccountId,
  ensureCategoryId,
  inferCategoryFromText,
  inferSourceFromText,
  inferTags,
  mapAssistantErrorMessage,
  normalizeMoney,
  resolveAccountId,
  resolveDraftAccountTarget
} from './workbenchMapping';
import type { AssistantToastState, DraftBillEntry, WorkbenchStatus } from './workbenchTypes';

/** 模型列表本地缓存 key：用于启动时秒开下拉列表。 */
const MODEL_CACHE_KEY = 'ledgerflow-assistant-model-cache-v1';
const MIN_ALLOWED_DATE = '2000-01-01';
const MAX_ALLOWED_DATE = '2100-12-31';
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;
const PDF_SPLIT_TRIGGER_BYTES = 6 * 1024 * 1024;
const PDF_SPLIT_PAGES_PER_CHUNK = 8;
const PDF_SPLIT_MAX_CHUNKS = 12;
const EMBEDDING_COOLDOWN_MS = 10 * 60 * 1000;
const EMBEDDING_COOLDOWN_NOTICE_MS = 30 * 1000;
/** Agent 单次提问内最多允许的「模型 → 工具 → 模型」轮次。 */
const MAX_AGENT_ROUNDS = 4;

function normalizeEntryDate(inputDate?: string) {
  const fallback = new Date().toISOString();
  if (!inputDate) return fallback;
  const parsed = new Date(inputDate);
  if (Number.isNaN(parsed.getTime())) return fallback;

  const day = parsed.toISOString().slice(0, 10);
  if (day < MIN_ALLOWED_DATE || day > MAX_ALLOWED_DATE) return fallback;
  return parsed.toISOString();
}

interface UseAssistantWorkbenchInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  categories: Category[];
  accounts: Account[];
  transactions: TransactionItem[];
  addCategory: (name: string) => string;
  addAccount: (name: string, type?: Account['type'], initialBalance?: number) => string;
  addTransaction: AddTransactionAction;
  updateTransaction: (id: string, payload: Omit<TransactionItem, 'id'>) => void;
  removeTransaction: (id: string) => void;
  restoreTransaction: (id: string) => void;
  debts?: Array<{
    id: string;
    name: string;
    type: string;
    balance: number;
    annualRate?: number;
    repaymentDay?: number;
    paymentAccount?: string;
    repaymentMethod?: string;
    repaymentRecordMode?: string;
    totalPeriods?: number;
    paidPeriods?: number;
    remainingMonths?: number;
  }>;
  repaymentRecords?: Array<{
    debtId: string;
    amount: number;
    paidAt: string;
    paymentAccount?: string;
    recordMode?: string;
    note?: string;
  }>;
  sceneMode?: 'assistant' | 'credit' | 'investment';
  globalMemories?: GlobalMemoryItem[];
}

export interface AssistantRecognizeOptions {
  /**
   * bill:走账单识别 JSON 流程,产出待确认草稿;
   * chat:走对话/分析流程(由 Agent 工具完成增删改)。
   */
  task?: 'bill' | 'chat';
  /** chat 任务是否启用账本工具(增删改)。 */
  agent?: boolean;
}

/**
 * Assistant 核心工作流 Hook：
 * - 管理输入（文本/图片）、识别状态、预览与保存
 * - 管理模型拉取与本地缓存
 * - 统一输出 UI 所需行为与状态
 */
export function useAssistantWorkbench(input: UseAssistantWorkbenchInput) {
  const { addLog } = useDebugLogStore();
  const embeddingModel = useAiSettings((s) => s.embeddingModel);
  const enableEmbeddingModel = useAiSettings((s) => s.enableEmbeddingModel);
  const embeddingChannel = useAiSettings((s) => s.embedding);
  const rerankModel = useAiSettings((s) => s.rerankModel);
  const enableRerankModel = useAiSettings((s) => s.enableRerankModel);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognizeAbortRef = useRef<AbortController | null>(null);
  const recognizeInFlightRef = useRef(false);
  const savingRef = useRef(false);
  const entriesRef = useRef<DraftBillEntry[]>([]);
  const embeddingCooldownUntilRef = useRef(0);
  const embeddingCooldownNoticeRef = useRef(0);
  const [status, setStatus] = useState<WorkbenchStatus>('idle');
  const [textInput, setTextInput] = useState('');
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const [pdfDataUrls, setPdfDataUrls] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>(() => [...AI_MODEL_PRESETS]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [entries, setEntries] = useState<DraftBillEntry[]>([]);
  const [error, setError] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [rawReasoning, setRawReasoning] = useState('');
  const [lastUsage, setLastUsage] = useState<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null>(null);
  const [embeddingDebug, setEmbeddingDebug] = useState<EmbeddingRecallDebug>(
    createIdleEmbeddingDebug()
  );
  const [semanticRecallCacheMeta, setSemanticRecallCacheMeta] = useState<SemanticRecallCacheMeta>(
    createSemanticRecallMeta(embeddingModel.trim())
  );
  const [toast, setToast] = useState<AssistantToastState>({
    message: '',
    variant: 'success',
    visible: false
  });
  const [agentActions, setAgentActions] = useState<AgentActionView[]>([]);
  const agentUndoRef = useRef(new Map<string, () => void>());

  /** 清空上一轮 Agent 操作记录(每次提交新问题前调用)。 */
  const resetAgentActions = useCallback(() => {
    agentUndoRef.current.clear();
    setAgentActions([]);
  }, []);

  const undoAgentAction = useCallback(
    (actionId: string) => {
      const run = agentUndoRef.current.get(actionId);
      if (!run) return false;
      try {
        run();
        agentUndoRef.current.delete(actionId);
        setAgentActions((prev) => prev.filter((item) => item.id !== actionId));
        setToast({ visible: true, variant: 'success', message: '已撤销这一步操作' });
        addLog({ action: 'assistant.agent', status: 'success', message: '撤销 Agent 操作' });
        return true;
      } catch (error) {
        setToast({
          visible: true,
          variant: 'error',
          message: error instanceof Error ? error.message : '撤销失败,请手动检查账单'
        });
        return false;
      }
    },
    [addLog]
  );

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const embeddingOverrideActive =
    Boolean(embeddingChannel.enabled) &&
    Boolean(
      embeddingChannel.baseUrl.trim() ||
      embeddingChannel.apiKey.trim() ||
      embeddingChannel.model.trim()
    );

  const effectiveEmbeddingBaseUrl = embeddingOverrideActive
    ? embeddingChannel.baseUrl.trim() || input.baseUrl
    : input.baseUrl;
  const effectiveEmbeddingApiKey = embeddingOverrideActive
    ? embeddingChannel.apiKey.trim() || input.apiKey
    : input.apiKey;
  const effectiveEmbeddingModel = embeddingOverrideActive
    ? embeddingChannel.model.trim() || embeddingModel.trim()
    : embeddingModel.trim();

  const refreshSemanticRecallCacheMeta = useCallback(() => {
    if (!effectiveEmbeddingBaseUrl.trim() || !effectiveEmbeddingModel.trim()) {
      setSemanticRecallCacheMeta(createSemanticRecallMeta(effectiveEmbeddingModel.trim()));
      return;
    }
    const next = readSemanticRecallCacheMeta(
      effectiveEmbeddingBaseUrl,
      effectiveEmbeddingModel.trim()
    );
    setSemanticRecallCacheMeta(next);
  }, [effectiveEmbeddingBaseUrl, effectiveEmbeddingModel]);

  const clearSemanticRecallIndex = useCallback(() => {
    if (!effectiveEmbeddingBaseUrl.trim() || !effectiveEmbeddingModel.trim()) return false;
    clearSemanticRecallIndexCache(effectiveEmbeddingBaseUrl, effectiveEmbeddingModel.trim());
    refreshSemanticRecallCacheMeta();
    setEmbeddingDebug((prev) => ({
      ...createIdleEmbeddingDebug(effectiveEmbeddingModel.trim()),
      ...prev,
      enabled: enableEmbeddingModel,
      model: effectiveEmbeddingModel.trim(),
      reason: 'cache-cleared'
    }));
    setToast({ visible: true, variant: 'success', message: '语义召回索引缓存已清理' });
    addLog({ action: 'assistant.embedding', status: 'info', message: '已清理语义召回索引缓存' });
    return true;
  }, [
    addLog,
    effectiveEmbeddingBaseUrl,
    effectiveEmbeddingModel,
    enableEmbeddingModel,
    refreshSemanticRecallCacheMeta
  ]);

  const hasApiKey = Boolean(input.apiKey.trim());
  const hasInput = Boolean(textInput.trim()) || imageDataUrls.length > 0 || pdfDataUrls.length > 0;
  const canRecognize = hasApiKey && Boolean(input.model.trim()) && hasInput;
  const currentPromptFocus = textInput.trim();
  const transactionContext = useMemo(
    () =>
      buildTransactionPromptContext(input.transactions, input.categories, input.accounts, {
        focusQuestion: currentPromptFocus
      }),
    [input.transactions, input.categories, input.accounts, currentPromptFocus]
  );
  const repaymentContext = useMemo(
    () =>
      buildRepaymentPromptContext({
        debts: input.debts || [],
        repaymentRecords: input.repaymentRecords || []
      }),
    [input.debts, input.repaymentRecords]
  );

  const detectDuplicate = (entry: DraftBillEntry) => {
    if (entry.orderNo) {
      const found = input.transactions.find(
        (item) => item.orderNo && item.orderNo === entry.orderNo
      );
      if (found) return { id: found.id, reason: 'orderNo' as const };
    }
    if (entry.merchantOrderNo) {
      const found = input.transactions.find(
        (item) => item.merchantOrderNo && item.merchantOrderNo === entry.merchantOrderNo
      );
      if (found) return { id: found.id, reason: 'merchantOrderNo' as const };
    }

    const signature = buildBillContentSignature({
      date: entry.date,
      amount: entry.amount,
      type: entry.type,
      note: entry.note,
      currency: entry.currency
    });
    const found = input.transactions.find((item) => {
      if (!signature) return false;
      return (
        buildBillContentSignature({
          date: item.date,
          amount: item.amount,
          type: item.type,
          note: item.note,
          transactionCurrency: resolveTransactionCurrency(item.tags)
        }) === signature
      );
    });
    if (found) return { id: found.id, reason: 'content' as const };
    return null;
  };

  const buildBatchSignature = (entry: DraftBillEntry): string => {
    if (entry.orderNo) return `order:${entry.orderNo}`;
    if (entry.merchantOrderNo) return `merchant:${entry.merchantOrderNo}`;
    return buildBillContentSignature({
      date: entry.date,
      amount: entry.amount,
      type: entry.type,
      note: entry.note,
      currency: entry.currency
    });
  };

  const attachDuplicateMeta = (rows: DraftBillEntry[]) => {
    const firstSeenIndex = new Map<string, number>();
    return rows.map((item, index) => {
      const baseIssues = item.issues.filter((issue) => issue.field !== 'duplicate');
      const duplicate = detectDuplicate(item);
      if (duplicate) {
        return {
          ...item,
          duplicateTxId: duplicate.id,
          duplicateReason: duplicate.reason,
          issues: baseIssues
        };
      }

      const signature = buildBatchSignature(item);
      const previousIndex = signature ? firstSeenIndex.get(signature) : undefined;
      if (signature && previousIndex === undefined) {
        firstSeenIndex.set(signature, index);
      }
      if (previousIndex === undefined) {
        return {
          ...item,
          duplicateTxId: undefined,
          duplicateReason: undefined,
          issues: baseIssues
        };
      }

      return {
        ...item,
        duplicateTxId: undefined,
        duplicateReason: 'batch' as const,
        issues: [
          ...baseIssues,
          {
            field: 'duplicate' as const,
            message: `与第 ${previousIndex + 1} 笔内容相同，疑似同批次重复，请删除或修改后再保存。`
          }
        ]
      };
    });
  };

  // 根据当前输入与结果条目，自动维护主状态机。
  useEffect(() => {
    if (status === 'recognizing' || status === 'saving' || status === 'preview') return;
    if (entries.length > 0) return setStatus('preview');
    setStatus(hasInput ? 'ready' : 'idle');
  }, [status, hasInput, entries.length]);

  // 监听配置变化，刷新语义召回缓存状态展示。
  useEffect(() => {
    refreshSemanticRecallCacheMeta();
  }, [refreshSemanticRecallCacheMeta]);

  // 首次加载：尝试从本地缓存恢复模型列表（失败不阻塞主流程）。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MODEL_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const list = parsed.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0
      );
      if (list.length > 0) {
        setModels((current) => mergeAiModelOptions('', AI_MODEL_PRESETS, [...list, ...current]));
      }
    } catch {
      // ignore cache parse errors
    }
  }, []);

  const handleSetFile = async (file?: File) => {
    if (!file) return;

    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        const maxSizeMb = Math.round(MAX_IMAGE_SIZE_BYTES / (1024 * 1024));
        const currentMb = (file.size / (1024 * 1024)).toFixed(1);
        const message = `图片过大（${currentMb}MB），请上传小于 ${maxSizeMb}MB 的图片。`;
        setError(message);
        setToast({ visible: true, variant: 'warning', message });
        return;
      }
      const dataUrl = await readImageAsDataUrl(file);
      setImageDataUrls((prev) => [...prev, dataUrl]);
      return;
    }

    if (file.type === 'application/pdf') {
      if (file.size > MAX_PDF_SIZE_BYTES) {
        const maxSizeMb = Math.round(MAX_PDF_SIZE_BYTES / (1024 * 1024));
        const currentMb = (file.size / (1024 * 1024)).toFixed(1);
        const message = `PDF 过大（${currentMb}MB），请上传小于 ${maxSizeMb}MB 的 PDF。`;
        setError(message);
        setToast({ visible: true, variant: 'warning', message });
        return;
      }

      if (file.size >= PDF_SPLIT_TRIGGER_BYTES) {
        try {
          const splitDataUrls = await splitPdfFileByPages(file, {
            pagesPerChunk: PDF_SPLIT_PAGES_PER_CHUNK,
            maxChunks: PDF_SPLIT_MAX_CHUNKS
          });
          setPdfDataUrls((prev) => [...prev, ...splitDataUrls]);
          if (splitDataUrls.length > 1) {
            setToast({
              visible: true,
              variant: 'success',
              message: `PDF 已按页拆分为 ${splitDataUrls.length} 份后发送。`
            });
          }
          return;
        } catch {
          const fallbackUrl = await readPdfAsDataUrl(file);
          setPdfDataUrls((prev) => [...prev, fallbackUrl]);
          setToast({
            visible: true,
            variant: 'warning',
            message: 'PDF 分片失败，已按原文件继续发送。'
          });
          return;
        }
      }

      const dataUrl = await readPdfAsDataUrl(file);
      setPdfDataUrls((prev) => [...prev, dataUrl]);
      return;
    }

    const message = '仅支持上传图片或 PDF 文件。';
    setError(message);
    setToast({ visible: true, variant: 'warning', message });
  };

  const handleSetImage = async (file?: File) => {
    await handleSetFile(file);
  };

  const handlePasteImage = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item.type.startsWith('image/') && item.type !== 'application/pdf') continue;
      const file = item.getAsFile();
      if (!file) continue;
      event.preventDefault();
      await handleSetFile(file);
    }
  };

  const handleDropImage = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []).filter(
      (file) => file.type.startsWith('image/') || file.type === 'application/pdf'
    );
    for (const file of files) await handleSetFile(file);
  };

  // 主动刷新模型：远端拉取成功后同步覆盖本地缓存。
  const handleLoadModels = async () => {
    if (!hasApiKey) return setError('请先填写 API Key');
    setLoadingModels(true);
    setError('');
    try {
      const nextModels = await fetchAiModels(input.baseUrl, input.apiKey);
      const mergedModels = mergeAiModelOptions(input.model, AI_MODEL_PRESETS, nextModels);
      setModels(mergedModels);
      try {
        window.localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(mergedModels));
      } catch {
        // ignore storage write errors
      }
      setToast({ visible: true, variant: 'success', message: '模型列表刷新成功' });
    } catch (err) {
      setError(err instanceof Error ? mapAssistantErrorMessage(err.message) : '模型拉取失败');
      setModels((current) => mergeAiModelOptions(input.model, AI_MODEL_PRESETS, current));
    } finally {
      setLoadingModels(false);
    }
  };

  /**
   * 识别入口：
   * 1) 组装系统提示词 + 交易快照上下文
   * 2) 请求模型并回写原始内容
   * 3) 尝试提取 JSON 账单；若失败则按“纯分析文本”处理
   */
  const buildAgentToolContext = (): AgentToolContext => ({
    // 复制一份工作副本:同一轮对话内的多次工具调用能互相看到结果,
    // 又不会直接改动 store 的数组引用。
    categories: [...input.categories],
    accounts: [...input.accounts],
    transactions: [...input.transactions],
    addCategory: input.addCategory,
    addAccount: input.addAccount,
    addTransaction: input.addTransaction,
    updateTransaction: input.updateTransaction,
    removeTransaction: input.removeTransaction,
    restoreTransaction: input.restoreTransaction
  });

  /**
   * Agent 多轮循环:模型可以先查账户/分类/账单,再增删改,最后用自然语言总结。
   * 每轮都支持流式输出;个别服务商不支持 tools 时自动降级为普通对话。
   */
  const runAgentConversation = async (options: {
    systemPrompt: string;
    text: string;
    imageDataUrls: string[];
    pdfDataUrls: string[];
    signal: AbortSignal;
  }): Promise<{ content: string; reasoning: string }> => {
    const ctx = buildAgentToolContext();
    type AgentMessage = {
      role: 'user' | 'assistant' | 'tool';
      text: string;
      imageDataUrls?: string[];
      pdfDataUrls?: string[];
      toolCalls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
      toolCallId?: string;
    };
    const messages: AgentMessage[] = [
      {
        role: 'user',
        text: options.text,
        imageDataUrls: options.imageDataUrls,
        pdfDataUrls: options.pdfDataUrls
      }
    ];

    let content = '';
    let reasoning = '';
    let toolsAvailable = true;
    let lastActionSummary = '';

    for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
      let streamedText = '';
      let streamedReasoning = '';
      const handlers = {
        onDelta: (delta: string) => {
          streamedText += delta;
          setRawContent(content + streamedText);
        },
        onReasoningDelta: (delta: string) => {
          streamedReasoning += delta;
          setRawReasoning(reasoning + streamedReasoning);
        },
        onDone: (done: string) => {
          streamedText = done || streamedText;
        }
      };
      const requestRound = (useTools: boolean) =>
        sendAiChatStream(
          {
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
            model: input.model,
            systemPrompt: options.systemPrompt,
            messages,
            signal: options.signal,
            tools: useTools ? ASSISTANT_AGENT_TOOLS : undefined
          },
          handlers
        );

      let reply;
      try {
        reply = await requestRound(toolsAvailable);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (toolsAvailable && /HTTP_(400|404|422)/.test(message)) {
          // 服务商不支持 function calling:保留对话能力,只是不能再改账本。
          toolsAvailable = false;
          addLog({
            action: 'assistant.agent',
            status: 'info',
            message: '当前模型不支持工具调用,已降级为普通对话'
          });
          reply = await requestRound(false);
        } else {
          throw error;
        }
      }

      reasoning += streamedReasoning;
      const calls: ChatToolCall[] = reply.toolCalls || [];
      content = reply.content || streamedText || content;
      setRawContent(content);

      if (calls.length === 0) break;

      messages.push({
        role: 'assistant',
        text: reply.content || '',
        toolCalls: calls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments }
        }))
      });

      const roundViews: AgentActionView[] = [];
      calls.forEach((call) => {
        const execution = executeAssistantToolCall(call, ctx);
        execution.undo.forEach((entry) => agentUndoRef.current.set(entry.id, entry.run));
        roundViews.push(...execution.views);
        messages.push({ role: 'tool', text: execution.content, toolCallId: call.id });
        addLog({
          action: 'assistant.agent',
          status: 'success',
          message: `工具 ${call.name} 执行完成`
        });
      });

      if (roundViews.length > 0) {
        lastActionSummary = roundViews.map((view) => view.label).join(';');
        setAgentActions((prev) => [...prev, ...roundViews]);
      }
    }

    if (!content.trim()) {
      content = lastActionSummary ? `已按你的要求处理:${lastActionSummary}` : '';
    }

    return { content, reasoning };
  };

  const runRecognize = async (
    promptText: string,
    payload?: { imageDataUrls?: string[]; pdfDataUrls?: string[] },
    options?: AssistantRecognizeOptions
  ) => {
    const cleanPrompt = promptText.trim();
    const effectiveImageDataUrls = payload?.imageDataUrls ?? imageDataUrls;
    const effectivePdfDataUrls = payload?.pdfDataUrls ?? pdfDataUrls;
    const hasPromptInput =
      Boolean(cleanPrompt) || effectiveImageDataUrls.length > 0 || effectivePdfDataUrls.length > 0;
    if (!hasApiKey || !input.model.trim() || !hasPromptInput) return;
    if (recognizeInFlightRef.current) return;
    recognizeInFlightRef.current = true;
    setStatus('recognizing');
    setError('');
    setRawContent('');
    setRawReasoning('');
    setLastUsage(null);
    addLog({ action: 'assistant.recognize', status: 'pending', message: '开始识别请求' });
    addLog({
      action: 'assistant.recognize',
      status: 'info',
      message: `模型配置：对话=${input.model}；嵌入=${enableEmbeddingModel ? `开启(${embeddingModel || '未设置'})` : '关闭'}；重排序=${enableRerankModel ? `开启(${rerankModel || '未设置'})` : '关闭'}`
    });
    const controller = new AbortController();
    recognizeAbortRef.current = controller;

    try {
      // 只有显式声明为 bill 的任务才走 JSON 记账解析,其余都按对话/Agent 处理。
      const isConversationalMode = options?.task !== 'bill';
      const agentEnabled = options?.agent === true;
      const basePrompt =
        input.sceneMode === 'investment'
          ? `${ANALYSIS_AGENT_PROMPT}\n\n你是用户的投资理财助手，重点讨论基金、股票、市场走势、资产配置、定投和风险管理。结合用户提供的持仓与市场信息给出有依据的分析，区分事实、估算与不确定性，不承诺收益、不把短期波动包装成确定预测，并提醒投资决策由用户自行承担。`
          : !isConversationalMode
            ? JSON_AGENT_PROMPT
            : input.sceneMode === 'credit'
              ? CREDIT_ANALYSIS_AGENT_PROMPT
              : agentEnabled
                ? `${ANALYSIS_AGENT_PROMPT}\n\n${ASSISTANT_AGENT_INSTRUCTIONS}`
                : ANALYSIS_AGENT_PROMPT;

      const now = Date.now();
      const embeddingCooldownActive = now > 0 && now < embeddingCooldownUntilRef.current;
      const effectiveEnableEmbeddingModel = enableEmbeddingModel && !embeddingCooldownActive;

      setEmbeddingDebug(
        createIdleEmbeddingDebug(
          isConversationalMode && effectiveEnableEmbeddingModel
            ? effectiveEmbeddingModel.trim()
            : ''
        )
      );

      if (
        embeddingCooldownActive &&
        now - embeddingCooldownNoticeRef.current > EMBEDDING_COOLDOWN_NOTICE_MS
      ) {
        embeddingCooldownNoticeRef.current = now;
        setToast({
          visible: true,
          variant: 'warning',
          message:
            '语义召回服务暂不可用，已临时降级为普通分析（10 分钟）。可稍后重试或前往设置页测试嵌入配置。'
        });
        addLog({
          action: 'assistant.embedding',
          status: 'info',
          message: '语义召回处于降级冷却期（10 分钟），本次跳过嵌入召回。'
        });
      }

      const semanticRecallTask = isConversationalMode
        ? runBlockingSemanticRecall({
            baseUrl: effectiveEmbeddingBaseUrl,
            apiKey: effectiveEmbeddingApiKey,
            embeddingModel: effectiveEmbeddingModel,
            rerankModel,
            enableEmbeddingModel: effectiveEnableEmbeddingModel,
            enableRerankModel,
            question: cleanPrompt,
            transactions: input.transactions,
            categories: input.categories,
            accounts: input.accounts,
            globalMemories: input.globalMemories || [],
            signal: controller.signal
          })
            .then((semanticRecallResult) => {
              const semanticRecallDebug = semanticRecallResult.debug;
              setEmbeddingDebug(semanticRecallDebug);

              if (semanticRecallDebug.downgraded) {
                embeddingCooldownUntilRef.current = Date.now() + EMBEDDING_COOLDOWN_MS;
                embeddingCooldownNoticeRef.current = Date.now();
                setToast({
                  visible: true,
                  variant: 'warning',
                  message: '语义召回失败，已自动降级为普通分析，并临时停用 10 分钟。'
                });
              }

              if (semanticRecallDebug.enabled) {
                if (semanticRecallDebug.used) {
                  addLog({
                    action: 'assistant.embedding',
                    status: 'success',
                    message: `语义召回命中 ${semanticRecallDebug.hitCount} 条，最高相似度 ${semanticRecallDebug.topScore.toFixed(2)}；平均相似度 ${(semanticRecallDebug.averageScore || 0).toFixed(2)}；索引 ${semanticRecallDebug.indexedDocs} 条；耗时 ${semanticRecallDebug.latencyMs}ms`
                  });
                } else if (semanticRecallDebug.downgraded) {
                  addLog({
                    action: 'assistant.embedding',
                    status: 'info',
                    message: `语义召回失败并已降级：${semanticRecallDebug.reason}；耗时 ${semanticRecallDebug.latencyMs}ms`
                  });
                } else {
                  addLog({
                    action: 'assistant.embedding',
                    status: 'info',
                    message: `语义召回未命中可用上下文；耗时 ${semanticRecallDebug.latencyMs}ms`
                  });
                }
              }

              refreshSemanticRecallCacheMeta();
              return semanticRecallResult;
            })
            .catch((error) => {
              if (error instanceof DOMException && error.name === 'AbortError') {
                return createEmptyBlockingSemanticRecallResult(effectiveEmbeddingModel.trim());
              }
              throw error;
            })
        : Promise.resolve(createEmptyBlockingSemanticRecallResult());

      const semanticRecallResult = await semanticRecallTask;
      const prompt = buildAssistantSystemPrompt({
        basePrompt,
        timeContext: await buildTimeContext(),
        transactionContext,
        repaymentContext: input.sceneMode === 'credit' ? repaymentContext : '',
        semanticRecallContext: semanticRecallResult.semanticContext,
        globalMemoryContext: semanticRecallResult.globalMemoryContext
      });
      let streamedContent = '';
      let streamedReasoning = '';
      let reply: { content: string; reasoning?: string };

      if (agentEnabled) {
        const agentReply = await runAgentConversation({
          systemPrompt: prompt,
          text: cleanPrompt,
          imageDataUrls: effectiveImageDataUrls,
          pdfDataUrls: effectivePdfDataUrls,
          signal: controller.signal
        });
        streamedContent = agentReply.content;
        streamedReasoning = agentReply.reasoning;
        reply = { content: agentReply.content, reasoning: agentReply.reasoning };
      } else {
        const streamedReply = await sendAiChatStream(
          {
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
            model: input.model,
            systemPrompt: prompt,
            messages: [
              {
                role: 'user',
                text: cleanPrompt,
                imageDataUrls: effectiveImageDataUrls,
                pdfDataUrls: effectivePdfDataUrls
              }
            ],
            signal: controller.signal
          },
          {
            onDelta: (delta) => {
              streamedContent += delta;
              setRawContent(streamedContent);
            },
            onReasoningDelta: (delta) => {
              streamedReasoning += delta;
              setRawReasoning(streamedReasoning);
            },
            onDone: (content, reasoning) => {
              streamedContent = content || streamedContent;
              streamedReasoning = reasoning || streamedReasoning;
            }
          }
        );
        reply = {
          content: streamedReply.content || streamedContent,
          reasoning: streamedReply.reasoning || streamedReasoning
        };
      }
      setRawContent(reply.content);
      setRawReasoning(reply.reasoning || '');
      setLastUsage(null);

      if (isConversationalMode) {
        setEntries([]);
        setTextInput('');
        setImageDataUrls([]);
        setPdfDataUrls([]);
        setStatus('idle');
        addLog({
          action: 'assistant.recognize',
          status: 'success',
          message: '分析完成（流式文本模式）'
        });
        return;
      }

      // 兼容两类场景：
      // - 记账：返回 JSON 可落库
      // - 分析：返回普通文本（JSON 解析失败视为预期）
      let parsed = null;
      try {
        parsed = normalizeAiBill(JSON.parse(extractJsonString(reply.content)) as unknown);
      } catch {
        parsed = null;
      }

      if (parsed && parsed.transactions.length > 0) {
        setTextInput('');
        setImageDataUrls([]);
        setPdfDataUrls([]);
        setEntries(attachDuplicateMeta(toDraftEntries(parsed)));
        setStatus('preview');
        addLog({
          action: 'assistant.recognize',
          status: 'success',
          message: `识别成功，条目 ${parsed.transactions.length}`
        });
      } else {
        const hadExistingEntries = entriesRef.current.length > 0;
        setStatus(hadExistingEntries ? 'preview' : 'idle');
        if (hadExistingEntries) {
          setToast({
            visible: true,
            variant: 'warning',
            message: '本次没有识别到新的账单,已保留当前待确认记录。'
          });
        }
        addLog({
          action: 'assistant.recognize',
          status: 'success',
          message: '分析完成（文本模式，无可保存账单）'
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus(hasInput ? 'ready' : 'idle');
        addLog({ action: 'assistant.recognize', status: 'info', message: '用户已停止本次回答' });
        return;
      }
      const message =
        effectivePdfDataUrls.length > 0
          ? 'PDF 直传模型失败，请重试或改传图片。'
          : err instanceof Error
            ? mapAssistantErrorMessage(err.message)
            : '识别失败';
      setError(message);
      setStatus('error');
      addLog({ action: 'assistant.recognize', status: 'error', message });
    } finally {
      if (recognizeAbortRef.current === controller) {
        recognizeAbortRef.current = null;
      }
      recognizeInFlightRef.current = false;
    }
  };

  const handleRecognize = async (event: FormEvent) => {
    event.preventDefault();
    await runRecognize(textInput);
  };

  const handleRecognizeWithPrompt = async (
    promptText: string,
    payload?: { imageDataUrls?: string[]; pdfDataUrls?: string[] },
    options?: AssistantRecognizeOptions
  ) => {
    await runRecognize(promptText, payload, options);
  };

  const updateEntry = (id: string, patch: Partial<DraftBillEntry>) => {
    const nextPatch =
      patch.currency !== undefined && patch.currencyConfirmed === undefined
        ? { ...patch, currencyConfirmed: false }
        : patch;
    setEntries((prev) =>
      attachDuplicateMeta(
        prev.map((item) => {
          const requestedReview = nextPatch.needsReview?.length
            ? Array.from(new Set([...(item.needsReview || []), ...nextPatch.needsReview]))
            : item.needsReview;
          const next: DraftBillEntry =
            item.id === id
              ? {
                  ...item,
                  ...nextPatch,
                  needsReview: clearResolvedReviewFields(requestedReview, nextPatch)
                }
              : item;
          return { ...next, issues: validateDraft(next) };
        })
      )
    );
  };

  function clearResolvedReviewFields(
    currentReview: DraftBillEntry['needsReview'],
    patch: Partial<DraftBillEntry>
  ): DraftBillEntry['needsReview'] {
    if (!currentReview?.length) return currentReview;
    const resolved = new Set<string>();
    if (patch.amount !== undefined) resolved.add('amount');
    if (patch.date !== undefined) resolved.add('date');
    if (patch.type !== undefined) resolved.add('type');
    if (patch.currency !== undefined) resolved.add('currency');
    if (patch.currencyConfirmed === true) resolved.add('currency');
    if (resolved.size === 0) return currentReview;
    return currentReview.filter((field) => !resolved.has(field));
  }

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((item) => item.id !== id));

  /** 将当前勾选且校验通过的草稿条目写入账本。 */
  const saveSelected = (options?: { overwriteDuplicateEntryIds?: string[] }) => {
    if (savingRef.current) return false;
    const rows = entries.filter((item) => item.selected && item.issues.length === 0);
    if (rows.length === 0) {
      setToast({ visible: true, variant: 'warning', message: '没有可保存的有效账单' });
      return false;
    }
    savingRef.current = true;
    setStatus('saving');
    addLog({ action: 'assistant.save', status: 'pending', message: `准备保存 ${rows.length} 条` });

    const batchOperations: TransactionBatchOperation[] = [];
    try {
      const overwriteSet = new Set(options?.overwriteDuplicateEntryIds || []);
      const transactionIds = new Set(input.transactions.map((item) => item.id));
      const missingOverwrite = rows.find(
        (item) =>
          item.duplicateTxId && overwriteSet.has(item.id) && !transactionIds.has(item.duplicateTxId)
      );
      if (missingOverwrite?.duplicateTxId) {
        throw new Error(`待覆盖的原交易不存在: ${missingOverwrite.duplicateTxId}`);
      }
      const categoryCache = [...input.categories];
      const accountCache = [...input.accounts];
      rows.forEach((item) => {
        const type = item.type === 'unknown' ? 'expense' : item.type;
        const category = item.category.trim() || inferCategoryFromText(type, item.note || '');
        const noteAndTagsText = `${item.note} ${(item.tags || []).join(' ')}`;

        // 交易来源（写入 TransactionItem）仅使用现有枚举；银行/现金在账户解析层单独处理。
        const source =
          item.sourceHint === 'wechat' || item.sourceHint === 'alipay'
            ? item.sourceHint
            : inferSourceFromText(noteAndTagsText);

        // 账户决策与账单预览共用同一份规则，避免“预览未指定账户、保存后落到微信钱包”的不一致。
        const accountTarget = resolveDraftAccountTarget({
          account: item.account,
          sourceHint: item.sourceHint,
          type,
          note: item.note,
          tags: item.tags
        });

        const categoryId = ensureCategoryId(category, categoryCache, (nextName) => {
          const createdId = input.addCategory(nextName);
          if (createdId && !categoryCache.some((entry) => entry.id === createdId)) {
            categoryCache.push({ id: createdId, name: nextName.trim() });
          }
          return createdId;
        });

        const accountOptions = { source: accountTarget.source, type: accountTarget.type };
        const accountId = accountTarget.name
          ? ensureAccountId(
              accountTarget.name,
              accountCache,
              (nextName, nextType) => {
                const createdId = input.addAccount(nextName, nextType, 0);
                if (createdId && !accountCache.some((entry) => entry.id === createdId)) {
                  accountCache.push({ id: createdId, name: nextName.trim(), type: nextType });
                }
                return createdId;
              },
              accountOptions
            )
          : resolveAccountId(undefined, accountCache, accountOptions);

        const payload = {
          type,
          amount: normalizeMoney(item.amount),
          date: normalizeEntryDate(item.date),
          note:
            item.currency && item.currency !== 'unknown' && item.currency !== 'CNY'
              ? `${item.note || 'AI 导入账单'}（${item.currency}${item.originalAmountText ? ` / 原始:${item.originalAmountText}` : ''}）`
              : item.note || 'AI 导入账单',
          tags: inferTags(type, item.note, category, item.tags || ['AI识别']).concat(
            item.currency && item.currency !== 'unknown' && item.currency !== 'CNY'
              ? [`币种:${item.currency}`]
              : []
          ),
          categoryId,
          accountId,
          orderNo: item.orderNo?.trim() || undefined,
          merchantOrderNo: item.merchantOrderNo?.trim() || undefined,
          source
        };

        if (item.duplicateTxId && overwriteSet.has(item.id)) {
          batchOperations.push({
            operation: 'update',
            id: item.duplicateTxId,
            payload
          });
        } else {
          batchOperations.push({ operation: 'add', payload });
        }
      });
      input.addTransaction(batchOperations);
      const savedSet = new Set(rows.map((item) => item.id));
      const remaining = entries.filter((item) => !savedSet.has(item.id));
      const skipped = entries.length - rows.length;
      setEntries(remaining);
      setStatus(remaining.length > 0 ? 'preview' : 'saved');
      if (remaining.length === 0) {
        setRawContent('');
        setRawReasoning('');
        setLastUsage(null);
      }
      setToast({
        visible: true,
        variant: 'success',
        message:
          skipped > 0
            ? `已保存 ${rows.length} 条，另有 ${skipped} 条未勾选或需修正`
            : `已保存 ${rows.length} 条账单`
      });
      addLog({
        action: 'assistant.save',
        status: 'success',
        message: `保存完成 ${rows.length} 条`
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败，请重试';
      setStatus('error');
      setToast({
        visible: true,
        variant: 'error',
        message
      });
      addLog({ action: 'assistant.save', status: 'error', message });
      return false;
    } finally {
      savingRef.current = false;
    }
  };

  const resetWorkbench = () => {
    recognizeAbortRef.current?.abort();
    recognizeAbortRef.current = null;
    recognizeInFlightRef.current = false;
    setTextInput('');
    setImageDataUrls([]);
    setPdfDataUrls([]);
    setEntries([]);
    setRawContent('');
    setRawReasoning('');
    setLastUsage(null);
    setEmbeddingDebug(createIdleEmbeddingDebug());
    setError('');
    setStatus('idle');
    resetAgentActions();
  };

  const stopRecognize = () => {
    if (!recognizeInFlightRef.current && !recognizeAbortRef.current) return;
    recognizeAbortRef.current?.abort();
  };

  return {
    fileInputRef,
    textareaRef,
    status,
    textInput,
    setTextInput,
    imageDataUrls,
    setImageDataUrls,
    pdfDataUrls,
    setPdfDataUrls,
    models,
    loadingModels,
    drawerOpen,
    setDrawerOpen,
    entries,
    setEntries,
    error,
    rawContent,
    rawReasoning,
    lastUsage,
    embeddingDebug,
    semanticRecallCacheMeta,
    toast,
    agentActions,
    undoAgentAction,
    resetAgentActions,
    hasApiKey,
    canRecognize,
    handleSetImage,
    handleSetFile,
    handlePasteImage,
    handleDropImage,
    handleLoadModels,
    handleRecognize,
    handleRecognizeWithPrompt,
    stopRecognize,
    clearSemanticRecallIndex,
    refreshSemanticRecallCacheMeta,
    updateEntry,
    removeEntry,
    saveSelected,
    checkDuplicates: () => {
      const next = attachDuplicateMeta(entriesRef.current);
      entriesRef.current = next;
      setEntries(next);
      return next.filter((item) => item.duplicateTxId || item.duplicateReason === 'batch').length;
    },
    resetWorkbench,
    applyCommand: (prompt: string) => {
      setTextInput(prompt);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    setToastVisible: (visible: boolean) => setToast((prev) => ({ ...prev, visible })),
    setToastState: (message: string, variant: AssistantToastState['variant']) =>
      setToast({ visible: true, message, variant })
  };
}
