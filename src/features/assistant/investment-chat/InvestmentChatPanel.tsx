import {
  ClipboardEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
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
import { fetchAiModels, sendAiChatStream } from '../api/openaiCompatibleClient';
import { buildWebSearchPrompt, fetchWebSearchContext } from '../api/webSearchClient';
import { renderMarkdownContent } from '../ui/MarkdownRenderer';
import {
  BOT_ICON_URL,
  CHEVRON_UP_ICON_URL,
  CHEVRONS_DOWN_UP_ICON_URL,
  CHEVRONS_UP_DOWN_ICON_URL,
  GLOBE_ICON_URL,
  GLOBE_OFF_ICON_URL,
  IMAGE_ICON_URL,
  INVESTMENT_HERO_ILLUSTRATION_URL,
  USER_ICON_URL
} from '../../../shared/config/brandAssets';
import { useAiSettings } from '../../../shared/store/useAiSettings';
import { useAppPreferences } from '../../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../../shared/store/useFinanceStore';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { Toast } from '../../../shared/ui/Toast';
import type { ToastVariant } from '../../../shared/ui/Toast';
import { buildTimeContext } from '../workbench/workbenchUtils';
import { InvestmentAiMessageDetails } from './InvestmentAiMessageDetails';

type Message = ReturnType<typeof createInvestmentAiMessage>;
type InvestmentChatProgress = 'market' | 'web' | 'thinking' | 'answering' | '';
type FloatingResizeEdge = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

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

const MAX_INVESTMENT_AI_IMAGES = 4;
const MAX_INVESTMENT_AI_IMAGE_SIZE_MB = 6;
const INVESTMENT_CHAT_PROGRESS_LABELS: Record<Exclude<InvestmentChatProgress, ''>, string> = {
  market: '正在读取当前页面的大盘、板块和快讯数据',
  web: '正在查询公开联网资讯',
  thinking: '正在思考投资结论',
  answering: '正在组织回答'
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
  onPromptSubmitted?: (messageId: string) => void;
  clearContextVersion?: number;
};

export function InvestmentChatComposer({
  showLinks = true,
  defaultWebEnabled = false,
  contextNote = '',
  onPromptSubmitted,
  clearContextVersion = 0
}: InvestmentChatComposerProps) {
  const { baseUrl, apiKey, model, webSearch } = useAiSettings();
  const setModel = useAiSettings((s) => s.setModel);
  const messages = useAppPreferences((s) => s.investmentAiMessages);
  const setMessages = useAppPreferences((s) => s.setInvestmentAiMessages);
  const positions = useAppPreferences((s) => s.investmentPositions);
  const goals = useAppPreferences((s) => s.investmentGoals);
  const watchlist = useAppPreferences((s) => s.investmentWatchlist);
  const transactions = useFinanceStore((s) => s.transactions);
  const monthlyIncome = useAppPreferences((s) => s.monthlyIncome);

  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [webEnabled, setWebEnabled] = useState(defaultWebEnabled);
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState('');
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({
    position: 'fixed',
    left: 0,
    top: 0,
    bottom: 'auto'
  });

  const monthlyInvestableCash = useMemo(() => {
    const expense = transactions.reduce(
      (sum, item) => sum + (item.type === 'expense' || item.type === 'repayment' ? item.amount : 0),
      0
    );
    return Math.max(0, (monthlyIncome || 0) - expense);
  }, [monthlyIncome, transactions]);

  const assistantPrompt = useMemo(
    () =>
      buildInvestmentAssistantPrompt({
        positions: positions.filter((item) => item.isActive),
        goals,
        watchlist,
        monthlyInvestableCash
      }) + (contextNote ? `\n\n页面实时上下文：\n${contextNote}` : ''),
    [contextNote, goals, monthlyInvestableCash, positions, watchlist]
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
    setLoading(false);
    setError('');
    setStreaming('');
    setStreamingReasoning('');
    setProgress('');
  }, [clearContextVersion]);

  useEffect(
    () => () => {
      requestVersionRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    },
    []
  );

  const loadModels = useCallback(async () => {
    if (loadingModels) return;
    if (!baseUrl.trim() || !apiKey.trim()) return;

    setLoadingModels(true);
    try {
      const nextModels = await fetchAiModels(baseUrl, apiKey);
      setModels(nextModels);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [apiKey, baseUrl, loadingModels]);

  const openModelPicker = useCallback(() => {
    setModelOpen(true);
    if (models.length === 0) {
      void loadModels();
    }
  }, [loadModels, models.length]);

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
        message: `最多只能附加 ${MAX_INVESTMENT_AI_IMAGES} 张截图。`,
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
        message: `单张图片不能超过 ${MAX_INVESTMENT_AI_IMAGE_SIZE_MB}MB。`,
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
        message: err instanceof Error ? err.message : '图片读取失败，请重试。',
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
    setLoading(false);
    setStreaming('');
    setStreamingReasoning('');
    setProgress('');
  }

  const submitPrompt = async (prompt?: string) => {
    const cleanPrompt = (prompt ?? input).trim();
    if (loading || (!cleanPrompt && images.length === 0)) return;
    if (!apiKey.trim()) {
      setToast({ visible: true, message: '请先在设置中配置可用的 AI Key。', variant: 'warning' });
      return;
    }

    const requestImages = prompt ? [] : images;
    const requestText = cleanPrompt || '请基于这些基金或持仓截图做投资分析。';
    const abortController = new AbortController();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    abortControllerRef.current = abortController;
    setLoading(true);
    setError('');
    setProgress('market');
    const userMessage: Message = createInvestmentAiMessage({
      id: `investment-user-${Date.now()}`,
      role: 'user',
      text: requestText,
      createdAt: new Date().toISOString(),
      attachmentCount: requestImages.length,
      attachmentImages: requestImages
    });
    const nextMessages = trimInvestmentAiMessages([...messages, userMessage]);
    setMessages(nextMessages);
    setInput('');
    setImages([]);
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
      if (webEnabled) {
        setProgress('web');
        webSearchPrompt = buildWebSearchPrompt(
          await fetchWebSearchContext(cleanPrompt, webSearch, abortController.signal, {
            investmentNewsSources: ['10jqka', 'xueqiu']
          })
        );
      }
      if (!isCurrentRequest()) return;
      setProgress('thinking');
      const timeContext = await buildTimeContext();
      const auxiliaryInfo = buildInvestmentAssistantAuxiliaryInfo({
        webEnabled,
        webQuery: cleanPrompt || requestText,
        timeContext,
        contextNote,
        webSearchPrompt
      });
      const result = await sendAiChatStream(
        {
          baseUrl,
          apiKey,
          model,
          systemPrompt: webEnabled
            ? `${timeContext}\n\n${assistantPrompt}\n\n联网模式：用户已开启联网核验。请优先使用以下联网检索上下文核验基金净值、费率、持仓、基金公司和近期表现等最新信息。\n\n${webSearchPrompt}`
            : `${timeContext}\n\n${assistantPrompt}`,
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
              text: answer || '已完成分析。',
              createdAt: new Date().toISOString(),
              reasoning,
              webTrace: auxiliaryInfo.webTrace,
              auxiliaryInfo: auxiliaryInfo.relatedData,
              followUpPrompts: parseInvestmentFollowUpPrompts(content),
              analysis
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
        const fallback: Message = createInvestmentAiMessage({
          id: `investment-assistant-${Date.now()}`,
          role: 'assistant',
          text: fallbackPrompts.join(' / '),
          createdAt: new Date().toISOString(),
          followUpPrompts: fallbackPrompts
        });
        setMessages(trimInvestmentAiMessages([...nextMessages, fallback]));
      }
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '投资分析失败');
      setToast({ visible: true, message: '投资分析失败', variant: 'error' });
    } finally {
      if (requestVersion === requestVersionRef.current) {
        abortControllerRef.current = null;
        setLoading(false);
        setProgress('');
      }
    }
  };

  const composerExpanded =
    composerFocused || Boolean(input.trim()) || images.length > 0 || modelOpen;

  const scrollToConversationTop = useCallback(() => {
    const targets = new Set<HTMLElement>();
    const messagesArea = document.querySelector<HTMLElement>(
      '.chat-messages-area.is-investment-mode'
    );
    const supportColumn = textareaRef.current?.closest<HTMLElement>('.investments-support-column');

    if (messagesArea) targets.add(messagesArea);
    if (supportColumn) targets.add(supportColumn);
    targets.forEach((target) => target.scrollTo({ top: 0, behavior: 'smooth' }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <>
      {error ? <p className="chat-inline-error">{error}</p> : null}

      {images.length > 0 ? (
        <div className="investments-ai-image-strip" aria-label="待分析图片">
          <div className="investments-ai-thumb-list">
            {images.map((url, index) => (
              <div key={`${url.slice(0, 20)}-${index}`} className="investments-ai-thumb-item">
                <img src={url} alt={`待分析图片 ${index + 1}`} className="investments-ai-thumb" />
                <button
                  type="button"
                  className="investments-ai-thumb-remove"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== index))}
                  aria-label={`移除第 ${index + 1} 张图片`}
                >
                  x
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setImages([])}>
            清空图片
          </button>
        </div>
      ) : null}

      {showLinks ? (
        <div className="investments-ai-links">
          <Link to="/investments" className="button-with-icon">
            <img src={IMAGE_ICON_URL} alt="" aria-hidden="true" />
            投资资料与管理
          </Link>
        </div>
      ) : null}

      {progress ? (
        <div className="investments-ai-progress" role="status" aria-live="polite">
          <span className="investments-ai-progress-indicator" aria-hidden="true" />
          <span>{INVESTMENT_CHAT_PROGRESS_LABELS[progress]}</span>
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
              className="chat-file-input-hidden"
              aria-label="上传基金截图"
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
              placeholder="输入基金问题，Enter 发送"
              aria-label="基金分析输入框"
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
                aria-label="AI 联想提问"
              >
                <button
                  type="button"
                  className="chat-upload-btn investments-ai-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title={`支持上传或粘贴最多 ${MAX_INVESTMENT_AI_IMAGES} 张截图`}
                  aria-label="上传基金截图"
                >
                  <img
                    className="chat-upload-icon"
                    src={IMAGE_ICON_URL}
                    alt=""
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className={`chat-upload-btn investments-ai-web-btn ${webEnabled ? 'is-active' : ''}`}
                  onClick={() => setWebEnabled((value) => !value)}
                  aria-pressed={webEnabled}
                  aria-label={webEnabled ? '关闭联网核验' : '开启联网核验'}
                  title={webEnabled ? '已开启联网核验' : '开启联网核验'}
                >
                  <img
                    className="chat-upload-icon"
                    src={webEnabled ? GLOBE_ICON_URL : GLOBE_OFF_ICON_URL}
                    alt=""
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className="chat-upload-btn investments-ai-suggestions-toggle"
                  onClick={() => setSuggestionsCollapsed((value) => !value)}
                  aria-expanded={!suggestionsCollapsed}
                  aria-label={suggestionsCollapsed ? '展开消息' : '折叠消息'}
                  title={suggestionsCollapsed ? '展开消息' : '折叠消息'}
                >
                  <img
                    className="chat-upload-icon"
                    src={
                      suggestionsCollapsed ? CHEVRONS_UP_DOWN_ICON_URL : CHEVRONS_DOWN_UP_ICON_URL
                    }
                    alt=""
                    aria-hidden="true"
                  />
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
                    aria-label={`当前模型：${getModelDisplayLabel(model || '选择模型')}`}
                    title={getModelDisplayLabel(model || '选择模型')}
                    ref={modelTriggerRef}
                  >
                    <span className="chat-model-trigger-icon">@</span>
                    <span className="chat-model-inline-label">
                      {getModelDisplayLabel(model || '选择模型')}
                    </span>
                  </button>

                  {modelOpen
                    ? createPortal(
                        <div
                          ref={dropdownRef}
                          className="chat-model-dropdown investments-ai-model-dropdown"
                          role="dialog"
                          aria-label="模型列表"
                          style={dropdownStyle}
                        >
                          <div className="chat-model-list">
                            {loadingModels ? (
                              <div className="chat-model-empty">正在加载模型列表...</div>
                            ) : models.length === 0 ? (
                              <div className="chat-model-empty">暂无可选模型</div>
                            ) : (
                              models.map((item) => (
                                <button
                                  key={item}
                                  type="button"
                                  className={`chat-model-option ${item === model ? 'active' : ''}`}
                                  onClick={() => selectModel(item)}
                                >
                                  {getModelDisplayLabel(item)}
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
                  <div className="investments-ai-suggestion-list">
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
                title="返回页面顶部"
                aria-label="返回页面顶部"
              >
                <img
                  className="chat-upload-icon"
                  src={CHEVRON_UP_ICON_URL}
                  alt=""
                  aria-hidden="true"
                />
              </button>
              {loading ? (
                <button
                  type="button"
                  className="chat-send-btn investments-ai-submit-btn is-stop"
                  onClick={stopRequest}
                  title="停止生成"
                  aria-label="停止生成"
                >
                  <span className="chat-send-stop-icon" aria-hidden="true">
                    ■
                  </span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="chat-send-btn investments-ai-submit-btn"
                  disabled={!input.trim() && images.length === 0}
                  title="发送"
                  aria-label="开始分析"
                >
                  ↑
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
  floating?: boolean;
  floatingPosition?: 'bottom-right' | 'bottom-left';
};

export function InvestmentChatPanel({
  showComposer = true,
  showHero = true,
  defaultWebEnabled = false,
  contextNote = '',
  floating = false,
  floatingPosition = 'bottom-right'
}: InvestmentChatPanelProps) {
  const messages = useAppPreferences((s) => s.investmentAiMessages);
  const clearInvestmentAiMessages = useAppPreferences((s) => s.clearInvestmentAiMessages);
  const isCompact = !showHero;
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const floatingPanelRef = useRef<HTMLElement | null>(null);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null);
  const [activeTurnMessageId, setActiveTurnMessageId] = useState<string | null>(null);
  const [selectedHistoryMessageId, setSelectedHistoryMessageId] = useState('');
  const [clearContextVersion, setClearContextVersion] = useState(0);
  const [clearContextConfirmOpen, setClearContextConfirmOpen] = useState(false);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [floatingPinned, setFloatingPinned] = useState(false);
  const [floatingBounds, setFloatingBounds] = useState<FloatingPanelBounds | null>(null);
  const floatingResizeRef = useRef<FloatingResizeState | null>(null);
  const historyTurns = useMemo(() => messages.filter((item) => item.role === 'user'), [messages]);
  const latestMessageId = messages[messages.length - 1]?.id || '';

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
          aria-label="打开快捷问答"
          aria-expanded={false}
          onClick={() => setFloatingOpen(true)}
        >
          <span aria-hidden="true">?</span>
          {messages.length > 0 ? <i aria-label={`${messages.length} 条对话`} /> : null}
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
          <div className="investment-chat-floating-resize-handles" aria-hidden="true">
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
            ).map((edge) => (
              <span
                key={edge}
                className={`investment-chat-floating-resize-handle is-${edge}`}
                onPointerDown={(event) => startFloatingResize(edge, event)}
              />
            ))}
          </div>
        ) : null}
        {floating ? (
          <header className="investment-chat-floating-head">
            <div className="investment-chat-floating-title">
              <span className="investment-chat-floating-title-icon" aria-hidden="true">
                ?
              </span>
              <div>
                <strong>快捷问答</strong>
                <small>结合大盘与持仓，随时问一句</small>
              </div>
            </div>
            <div className="investment-chat-floating-head-actions">
              <button
                type="button"
                className={`investment-chat-floating-pin ${floatingPinned ? 'is-active' : ''}`}
                aria-label={floatingPinned ? '取消置顶快捷问答' : '置顶快捷问答'}
                title={floatingPinned ? '取消置顶，点击外围可自动收起' : '置顶，点击外围不收起'}
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
                aria-label="收起快捷问答"
                title="收起快捷问答"
                onClick={minimizeFloatingPanel}
              >
                ×
              </button>
            </div>
          </header>
        ) : null}

      {showHero ? (
        <div className="chat-assistant-hero">
          <h2>助手</h2>
          <p>基金、持仓、截图和问题都可以直接丢给我，我先帮你把结论说清楚。</p>
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div className="chat-messages-area investments-ai-messages-area">
          <div
            className={`investments-ai-history-actions ${historyTurns.length > 2 ? '' : 'is-compact'}`}
          >
            {historyTurns.length > 2 ? (
              <nav className="investments-ai-history-nav" aria-label="投资聊天记录导航">
                <span>{historyTurns.length} 轮</span>
                <select
                  aria-label="跳转到历史提问"
                  value={selectedHistoryMessageId}
                  onChange={(event) => {
                    const messageId = event.target.value;
                    setSelectedHistoryMessageId(messageId);
                    scrollToMessage(messageId);
                  }}
                >
                  {historyTurns.map((item, index) => (
                    <option key={item.id} value={item.id}>
                      {getInvestmentChatHistoryLabel(item.text, index)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => scrollToMessage(latestMessageId, 'end')}
                  aria-label="回到最新消息"
                  title="回到最新消息"
                >
                  最新
                </button>
              </nav>
            ) : null}
            <button
              type="button"
              className="investments-ai-clear-context"
              onClick={() => setClearContextConfirmOpen(true)}
              aria-label="清空上下文"
              title="清空上下文"
            >
              清空上下文
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
                  <div className="chat-msg-header">{item.role === 'user' ? '你' : '助手'}</div>
                  <div className="chat-msg-content chat-msg-content-rich">
                    {renderMarkdownContent(
                      item.role === 'assistant'
                        ? getInvestmentAssistantDisplayText(item.text, item.analysis)
                        : item.text
                    )}
                  </div>
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
                        <a key={`${item.id}-${index}`} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={`附带图片 ${index + 1}`} />
                        </a>
                      ))}
                    </div>
                  ) : item.attachmentCount ? (
                    <p className="investments-ai-attachment-note">
                      附带 {item.attachmentCount} 张图片
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
            <div aria-hidden="true" />
          </div>
        </div>
      ) : isCompact ? (
        <div className="investments-ai-empty-compact" aria-label="投资理财空状态">
          <img src={INVESTMENT_HERO_ILLUSTRATION_URL} alt="" aria-hidden="true" />
          <strong>先丢一个基金问题给我</strong>
          <p>例如：这只基金现在适合继续定投吗？</p>
        </div>
      ) : (
        <div className="investments-ai-empty">
          <img src={INVESTMENT_HERO_ILLUSTRATION_URL} alt="" aria-hidden="true" />
          <strong>先丢一个基金问题给我</strong>
          <p>例如：这只基金现在适合继续定投吗？</p>
        </div>
      )}

      {showComposer ? (
        <InvestmentChatComposer
          showLinks={!isCompact}
          defaultWebEnabled={defaultWebEnabled}
          contextNote={contextNote}
          onPromptSubmitted={handlePromptSubmitted}
          clearContextVersion={clearContextVersion}
        />
      ) : null}

      <ConfirmDialog
        open={clearContextConfirmOpen}
        title="清空聊天上下文"
        description="确定清空本次投资聊天上下文吗？此操作不可恢复。"
        confirmText="清空"
        danger
        onConfirm={clearContext}
        onCancel={() => setClearContextConfirmOpen(false)}
      />
      </section>
    </>
  );
}

function getInvestmentChatHistoryLabel(text: string, index: number) {
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 20);
  return `第 ${index + 1} 轮${preview ? ` · ${preview}` : ''}`;
}
