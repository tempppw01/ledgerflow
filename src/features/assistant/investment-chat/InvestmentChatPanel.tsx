import { ClipboardEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  buildInvestmentAssistantPrompt,
  buildInvestmentFollowUpFallback,
  createInvestmentAiMessage,
  extractInvestmentAnalysis,
  parseInvestmentFollowUpPrompts,
  readImageAsDataUrl,
  trimInvestmentAiMessages
} from '../../../pages/investments/investmentAi';
import { fetchAiModels, sendAiChatStream } from '../api/openaiCompatibleClient';
import { buildWebSearchPrompt, fetchWebSearchContext } from '../api/webSearchClient';
import { renderMarkdownContent } from '../ui/MarkdownRenderer';
import {
  BOT_ICON_URL,
  CHEVRONS_DOWN_UP_ICON_URL,
  CHEVRONS_UP_DOWN_ICON_URL,
  GLOBE_ICON_URL,
  IMAGE_ICON_URL,
  INVESTMENT_HERO_ILLUSTRATION_URL,
  USER_ICON_URL
} from '../../../shared/config/brandAssets';
import { useAiSettings } from '../../../shared/store/useAiSettings';
import { useAppPreferences } from '../../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../../shared/store/useFinanceStore';
import { Toast } from '../../../shared/ui/Toast';
import type { ToastVariant } from '../../../shared/ui/Toast';

type Message = ReturnType<typeof createInvestmentAiMessage>;

const MAX_INVESTMENT_AI_IMAGES = 4;
const MAX_INVESTMENT_AI_IMAGE_SIZE_MB = 6;

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
};

export function InvestmentChatComposer({ showLinks = true }: InvestmentChatComposerProps) {
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
  const [webEnabled, setWebEnabled] = useState(false);
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: ToastVariant }>({
    visible: false,
    message: '',
    variant: 'success'
  });
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelSelectorRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
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
      }),
    [goals, monthlyInvestableCash, positions, watchlist]
  );

  const followUps = useMemo(
    () => [...messages].reverse().find((item) => item.role === 'assistant' && item.followUpPrompts?.length)?.followUpPrompts || [],
    [messages]
  );

  const updateModelDropdownPosition = useCallback(() => {
    const trigger = modelTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const dropdownWidth = Math.min(320, window.innerWidth - 24);
    const dropdownHeight = dropdownRef.current?.offsetHeight || 260;
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - dropdownWidth - 12));
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
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length, loading, streaming, streamingReasoning]);

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
      setToast({ visible: true, message: `最多只能附加 ${MAX_INVESTMENT_AI_IMAGES} 张截图。`, variant: 'warning' });
      return;
    }

    const accepted = files.slice(0, slots);
    const oversized = accepted.find((file) => file.size > MAX_INVESTMENT_AI_IMAGE_SIZE_MB * 1024 * 1024);
    if (oversized) {
      setToast({ visible: true, message: `单张图片不能超过 ${MAX_INVESTMENT_AI_IMAGE_SIZE_MB}MB。`, variant: 'warning' });
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
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setStreaming('');
    setStreamingReasoning('');
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
    abortControllerRef.current = abortController;
    setLoading(true);
    setError('');
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

    try {
      const webSearchPrompt = webEnabled ? buildWebSearchPrompt(await fetchWebSearchContext(cleanPrompt, webSearch)) : '';
      const result = await sendAiChatStream(
        {
          baseUrl,
          apiKey,
          model,
          systemPrompt: webEnabled
            ? `${assistantPrompt}\n\n联网模式：用户已开启联网核验。请优先使用以下联网检索上下文核验基金净值、费率、持仓、基金公司和近期表现等最新信息。\n\n${webSearchPrompt}`
            : assistantPrompt,
          messages: nextMessages.map((item) => ({
            role: item.role,
            text: item.text,
            imageDataUrls: item.role === 'user' ? item.attachmentImages : undefined
          })),
          signal: abortController.signal
        },
        {
          onDelta: (delta) => setStreaming((prev) => prev + delta),
          onReasoningDelta: (delta) => setStreamingReasoning((prev) => prev + delta),
          onDone: (content, reasoning) => {
            const analysis = extractInvestmentAnalysis(content).analysis;
            const answer = extractInvestmentAnalysis(content).displayText.trim() || content.trim();
            const assistantMessage: Message = createInvestmentAiMessage({
              id: `investment-assistant-${Date.now()}`,
              role: 'assistant',
              text: answer || '已完成分析。',
              createdAt: new Date().toISOString(),
              reasoning,
              followUpPrompts: parseInvestmentFollowUpPrompts(content),
              analysis
            });
            setMessages(trimInvestmentAiMessages([...nextMessages, assistantMessage]));
            setStreaming('');
            setStreamingReasoning('');
          }
        }
      );
      if (!result.content.trim()) {
        const fallbackPrompts = buildInvestmentFollowUpFallback({ question: requestText, watchlist });
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
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '投资分析失败');
      setToast({ visible: true, message: '投资分析失败', variant: 'error' });
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

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
          <button type="button" onClick={() => setImages([])}>清空图片</button>
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

      <form
        className="chat-input-form investments-ai-composer"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submitPrompt();
        }}
        onPaste={handlePaste}
      >
        <div className="chat-input-stack">
          <div className="chat-input-main investments-ai-input-main">
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
              <div className="chat-input-toolbar-left investments-ai-suggestion-row" aria-label="AI 联想提问">
                <button
                  type="button"
                  className="chat-upload-btn investments-ai-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title={`支持上传或粘贴最多 ${MAX_INVESTMENT_AI_IMAGES} 张截图`}
                  aria-label="上传基金截图"
                >
                  <img className="chat-upload-icon" src={IMAGE_ICON_URL} alt="" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`chat-upload-btn investments-ai-web-btn ${webEnabled ? 'is-active' : ''}`}
                  onClick={() => setWebEnabled((value) => !value)}
                  aria-pressed={webEnabled}
                  aria-label={webEnabled ? '关闭联网核验' : '开启联网核验'}
                  title={webEnabled ? '已开启联网核验' : '开启联网核验'}
                >
                  <img className="chat-upload-icon" src={GLOBE_ICON_URL} alt="" aria-hidden="true" />
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
                    src={suggestionsCollapsed ? CHEVRONS_UP_DOWN_ICON_URL : CHEVRONS_DOWN_UP_ICON_URL}
                    alt=""
                    aria-hidden="true"
                  />
                </button>
                <div className="chat-model-selector chat-model-selector-inline investments-ai-model-selector" ref={modelSelectorRef}>
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
                    <span className="chat-model-inline-label">{getModelDisplayLabel(model || '选择模型')}</span>
                  </button>

                  {modelOpen ? (
                    createPortal(
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
                  ) : null}
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
              {loading ? (
                <button
                  type="button"
                  className="chat-send-btn investments-ai-submit-btn is-stop"
                  onClick={stopRequest}
                  title="停止生成"
                  aria-label="停止生成"
                >
                  <span className="chat-send-stop-icon" aria-hidden="true">■</span>
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
};

export function InvestmentChatPanel({ showComposer = true }: InvestmentChatPanelProps) {
  const messages = useAppPreferences((s) => s.investmentAiMessages);
  const isCompact = !showComposer;

  return (
    <section className={`chat-kawaii-panel chat-assistant-panel chat-investment-panel ${isCompact ? 'is-compact' : ''}`}>
      {!isCompact ? (
        <div className="chat-assistant-hero">
          <h2>助手</h2>
          <p>基金、持仓、截图和问题都可以直接丢给我，我先帮你把结论说清楚。</p>
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div className="chat-messages-area investments-ai-messages-area">
          <div className="chat-messages-inner">
          {messages.map((item) => (
            <article key={item.id} className={`chat-msg ${item.role === 'user' ? 'chat-msg-user' : ''}`}>
              <Avatar user={item.role === 'user'} />
              <div className="chat-msg-body">
                <div className="chat-msg-header">{item.role === 'user' ? '你' : '助手'}</div>
                <div className="chat-msg-content chat-msg-content-rich">{renderMarkdownContent(item.text)}</div>
                {item.attachmentImages?.length ? (
                  <div className="investments-ai-message-attachments">
                    {item.attachmentImages.map((url, index) => (
                      <a key={`${item.id}-${index}`} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={`附带图片 ${index + 1}`} />
                      </a>
                    ))}
                  </div>
                ) : item.attachmentCount ? (
                  <p className="investments-ai-attachment-note">附带 {item.attachmentCount} 张图片</p>
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
        </div>
      ) : (
        <div className="investments-ai-empty">
          <img src={INVESTMENT_HERO_ILLUSTRATION_URL} alt="" aria-hidden="true" />
          <strong>先丢一个基金问题给我</strong>
          <p>例如：这只基金现在适合继续定投吗？</p>
        </div>
      )}

      {showComposer ? <InvestmentChatComposer showLinks /> : null}
    </section>
  );
}
