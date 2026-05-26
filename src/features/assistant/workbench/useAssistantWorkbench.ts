import { ClipboardEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAiModels, sendAiChatStream } from '../api/openaiCompatibleClient';
import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import { useDebugLogStore } from '../../../shared/store/useDebugLogStore';
import { useAiSettings } from '../../../shared/store/useAiSettings';
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
  splitPdfFileByPages,
  toDraftEntries,
  validateDraft
} from './workbenchUtils';
import {
  ensureAccountId,
  ensureCategoryId,
  inferAccountNameFromText,
  inferCategoryFromText,
  inferSourceFromText,
  inferTags,
  mapAssistantErrorMessage,
  normalizeMoney,
  resolveAccountId
} from './workbenchMapping';
import type { AccountResolveSource } from './workbenchMapping';
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
  addTransaction: (payload: Omit<TransactionItem, 'id'>) => string;
  updateTransaction: (id: string, payload: Omit<TransactionItem, 'id'>) => void;
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
  sceneMode?: 'bookkeeping' | 'assistant' | 'credit';
  globalMemories?: GlobalMemoryItem[];
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
  const embeddingCooldownUntilRef = useRef(0);
  const embeddingCooldownNoticeRef = useRef(0);
  const [status, setStatus] = useState<WorkbenchStatus>('idle');
  const [textInput, setTextInput] = useState('');
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const [pdfDataUrls, setPdfDataUrls] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
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
  const [embeddingDebug, setEmbeddingDebug] = useState<EmbeddingRecallDebug>(createIdleEmbeddingDebug());
  const [semanticRecallCacheMeta, setSemanticRecallCacheMeta] = useState<SemanticRecallCacheMeta>(createSemanticRecallMeta(embeddingModel.trim()));
  const [toast, setToast] = useState<AssistantToastState>({
    message: '',
    variant: 'success',
    visible: false
  });

  const embeddingOverrideActive =
    Boolean(embeddingChannel.enabled) &&
    Boolean(
      embeddingChannel.baseUrl.trim() ||
        embeddingChannel.apiKey.trim() ||
        embeddingChannel.model.trim()
    );

  const effectiveEmbeddingBaseUrl = embeddingOverrideActive
    ? (embeddingChannel.baseUrl.trim() || input.baseUrl)
    : input.baseUrl;
  const effectiveEmbeddingApiKey = embeddingOverrideActive
    ? (embeddingChannel.apiKey.trim() || input.apiKey)
    : input.apiKey;
  const effectiveEmbeddingModel = embeddingOverrideActive
    ? (embeddingChannel.model.trim() || embeddingModel.trim())
    : embeddingModel.trim();

  const refreshSemanticRecallCacheMeta = useCallback(() => {
    if (!effectiveEmbeddingBaseUrl.trim() || !effectiveEmbeddingModel.trim()) {
      setSemanticRecallCacheMeta(createSemanticRecallMeta(effectiveEmbeddingModel.trim()));
      return;
    }
    const next = readSemanticRecallCacheMeta(effectiveEmbeddingBaseUrl, effectiveEmbeddingModel.trim());
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
  const transactionContext = useMemo(
    () => buildTransactionPromptContext(input.transactions, input.categories, input.accounts),
    [input.transactions, input.categories, input.accounts]
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

    const day = String(entry.date || '').slice(0, 10);
    const amount = normalizeMoney(entry.amount);
    const found = input.transactions.find((item) => {
      return (
        String(item.date).slice(0, 10) === day &&
        normalizeMoney(item.amount) === amount &&
        item.type === (entry.type === 'unknown' ? 'expense' : entry.type) &&
        String(item.note || '').trim() === String(entry.note || '').trim()
      );
    });
    if (found) return { id: found.id, reason: 'content' as const };
    return null;
  };

  const attachDuplicateMeta = (rows: DraftBillEntry[]) =>
    rows.map((item) => {
      const duplicate = detectDuplicate(item);
      return {
        ...item,
        duplicateTxId: duplicate?.id,
        duplicateReason: duplicate?.reason
      };
    });

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
      if (list.length > 0) setModels(list);
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
      setModels(nextModels);
      try {
        window.localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(nextModels));
      } catch {
        // ignore storage write errors
      }
      setToast({ visible: true, variant: 'success', message: '模型列表刷新成功' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型拉取失败');
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
  const runRecognize = async (
    promptText: string,
    payload?: { imageDataUrls?: string[]; pdfDataUrls?: string[] }
  ) => {
    const cleanPrompt = promptText.trim();
    const effectiveImageDataUrls = payload?.imageDataUrls ?? imageDataUrls;
    const effectivePdfDataUrls = payload?.pdfDataUrls ?? pdfDataUrls;
    const hasPromptInput =
      Boolean(cleanPrompt) || effectiveImageDataUrls.length > 0 || effectivePdfDataUrls.length > 0;
    if (!hasApiKey || !input.model.trim() || !hasPromptInput) return;
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
      const isConversationalMode =
        input.sceneMode === 'assistant' || input.sceneMode === 'credit';
      const basePrompt = !isConversationalMode
        ? JSON_AGENT_PROMPT
        : input.sceneMode === 'credit'
          ? CREDIT_ANALYSIS_AGENT_PROMPT
          : ANALYSIS_AGENT_PROMPT;

      const now = Date.now();
      const embeddingCooldownActive = now > 0 && now < embeddingCooldownUntilRef.current;
      const effectiveEnableEmbeddingModel = enableEmbeddingModel && !embeddingCooldownActive;

      setEmbeddingDebug(
        createIdleEmbeddingDebug(
          isConversationalMode && effectiveEnableEmbeddingModel ? effectiveEmbeddingModel.trim() : ''
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
          message: '语义召回服务暂不可用，已临时降级为普通分析（10 分钟）。可稍后重试或前往设置页测试嵌入配置。'
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
      const reply = {
        content: streamedReply.content || streamedContent,
        reasoning: streamedReply.reasoning || streamedReasoning
      };
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

      setTextInput('');
      setImageDataUrls([]);
      setPdfDataUrls([]);

      if (parsed && parsed.transactions.length > 0) {
        setEntries(attachDuplicateMeta(toDraftEntries(parsed)));
        setStatus('preview');
        addLog({
          action: 'assistant.recognize',
          status: 'success',
          message: `识别成功，条目 ${parsed.transactions.length}`
        });
      } else {
        setEntries([]);
        setStatus('idle');
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
    }
  };

  const handleRecognize = async (event: FormEvent) => {
    event.preventDefault();
    await runRecognize(textInput);
  };

  const handleRecognizeWithPrompt = async (
    promptText: string,
    payload?: { imageDataUrls?: string[]; pdfDataUrls?: string[] }
  ) => {
    await runRecognize(promptText, payload);
  };

  const updateEntry = (id: string, patch: Partial<DraftBillEntry>) => {
    setEntries((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        const duplicate = detectDuplicate(next);
        return {
          ...next,
          duplicateTxId: duplicate?.id,
          duplicateReason: duplicate?.reason,
          issues: validateDraft(next)
        };
      })
    );
  };

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((item) => item.id !== id));

  /** 将当前勾选且校验通过的草稿条目写入账本。 */
  const saveSelected = (options?: { overwriteDuplicateEntryIds?: string[] }) => {
    const rows = entries.filter((item) => item.selected && item.issues.length === 0);
    if (rows.length === 0) {
      setToast({ visible: true, variant: 'warning', message: '没有可保存的有效账单' });
      return false;
    }
    setStatus('saving');
    addLog({ action: 'assistant.save', status: 'pending', message: `准备保存 ${rows.length} 条` });

    try {
      const overwriteSet = new Set(options?.overwriteDuplicateEntryIds || []);
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

        // 账户来源用于 ensureAccountId，可承载 bank/cash/unknown 细粒度语义。
        let accountSource: AccountResolveSource =
          item.sourceHint === 'wechat' ||
          item.sourceHint === 'alipay' ||
          item.sourceHint === 'bank' ||
          item.sourceHint === 'cash' ||
          item.sourceHint === 'unknown'
            ? item.sourceHint
            : inferSourceFromText(noteAndTagsText);

        if (accountSource === 'unknown' || accountSource === 'ai') {
          if (/(现金|cash|现付|纸币|硬币)/i.test(noteAndTagsText)) {
            accountSource = 'cash';
          } else if (/(银行|银行卡|储蓄卡|借记卡|bank)/i.test(noteAndTagsText)) {
            accountSource = 'bank';
          }
        }

        const accountHintForInference =
          accountSource === 'wechat' ||
          accountSource === 'alipay' ||
          accountSource === 'bank' ||
          accountSource === 'cash' ||
          accountSource === 'unknown'
            ? accountSource
            : undefined;

        // 账户决策优先级：
        // 1) 优先采用模型明确给出的具体账户名（模型主导是否新建）；
        // 2) 若模型未给或仅给泛化名，再用本地规则兜底推断；
        // 3) 仍无法确定时只复用，不触发新建。
        const trimmedAccount = String(item.account || '').trim();
        const hasGenericAccountName =
          /^(银行卡|银行账户|储蓄卡|借记卡|bank|bank\s*card|account)$/i.test(trimmedAccount);
        const llmAccountName = trimmedAccount && !hasGenericAccountName ? trimmedAccount : '';
        const fallbackAccountName = llmAccountName
          ? ''
          : inferAccountNameFromText(noteAndTagsText, accountHintForInference, {
              type
            });

        const categoryId = ensureCategoryId(category, categoryCache, (nextName) => {
          const createdId = input.addCategory(nextName);
          if (createdId && !categoryCache.some((entry) => entry.id === createdId)) {
            categoryCache.push({ id: createdId, name: nextName.trim() });
          }
          return createdId;
        });

        const accountOptions = { source: accountSource, type };
        const accountId = llmAccountName
          ? ensureAccountId(
              llmAccountName,
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
          : fallbackAccountName
            ? ensureAccountId(
                fallbackAccountName,
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
          input.updateTransaction(item.duplicateTxId, payload);
        } else {
          input.addTransaction(payload);
        }
      });
      setEntries([]);
      setStatus('saved');
      setRawContent('');
      setRawReasoning('');
      setLastUsage(null);
      setToast({ visible: true, variant: 'success', message: `已保存 ${rows.length} 条账单` });
      addLog({
        action: 'assistant.save',
        status: 'success',
        message: `保存完成 ${rows.length} 条`
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败，请重试';
      setStatus('error');
      setToast({ visible: true, variant: 'error', message });
      addLog({ action: 'assistant.save', status: 'error', message });
      return false;
    }
  };

  const resetWorkbench = () => {
    recognizeAbortRef.current?.abort();
    recognizeAbortRef.current = null;
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
  };

  const stopRecognize = () => {
    if (status !== 'recognizing') return;
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
      let count = 0;
      setEntries((prev) =>
        prev.map((item) => {
          const duplicate = detectDuplicate(item);
          if (duplicate) count += 1;
          return { ...item, duplicateTxId: duplicate?.id, duplicateReason: duplicate?.reason };
        })
      );
      return count;
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
