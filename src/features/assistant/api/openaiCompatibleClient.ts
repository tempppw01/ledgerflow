import { ENV } from '../../../shared/config/env';

type AiRequestScene = 'models' | 'chat' | 'chat-stream';

/**
 * OpenAI 兼容客户端。
 *
 * 能力：
 * 1) 获取模型列表（GET /models）
 * 2) 发起对话（POST /chat/completions），支持纯文本与图文输入
 * 3) 优先使用页面传入配置，缺省回退到 ENV
 */

interface OpenAiModel {
  id: string;
}

interface ModelsResponse {
  data?: OpenAiModel[];
}

interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant' | 'tool';
  text: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  pdfDataUrl?: string;
  pdfDataUrls?: string[];
  /** assistant 回合里模型请求调用的工具。 */
  toolCalls?: ChatToolCallPayload[];
  /** role=tool 时回传对应的调用 id。 */
  toolCallId?: string;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatToolCallPayload {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: 'text'; text: string }>;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: ChatUsage;
}

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type: 'text'; text: string }>;
      reasoning_content?: string;
      reasoning?: string;
      reasoningContent?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    message?: {
      content?: string | Array<{ type: 'text'; text: string }>;
      reasoning_content?: string;
      reasoning?: string;
    };
    finish_reason?: string | null;
  }>;
}

export interface SendAiChatResult {
  content: string;
  reasoning?: string;
  toolCalls?: ChatToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

class AiRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string) {
    super(`${message}(错误码:${code})`);
    this.name = 'AiRequestError';
    this.code = code;
    this.retryable = true;
  }
}

function createAiRequestError(code: string, message: string): AiRequestError {
  return new AiRequestError(code, message);
}

function getAiRequestTimeoutMs() {
  const configured = Number(ENV.requestTimeoutMs);
  return Number.isFinite(configured) && configured > 0 ? configured : 8000;
}

function getAiGenerationTimeoutMs() {
  const configured = Number(ENV.aiGenerationTimeoutMs);
  return Number.isFinite(configured) && configured > 0 ? configured : 120000;
}

function abortError() {
  return new DOMException('AI request aborted', 'AbortError');
}

async function withAiRequestTimeout<T>(
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = getAiRequestTimeoutMs()
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromExternalSignal = () => {
    if (!controller.signal.aborted) {
      controller.abort(externalSignal?.reason || abortError());
    }
  };

  if (externalSignal?.aborted) {
    abortFromExternalSignal();
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) {
      controller.abort(abortError());
    }
  }, timeoutMs);

  try {
    if (controller.signal.aborted) {
      throw abortError();
    }
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw createAiRequestError('AI_REQUEST_TIMEOUT', 'AI 请求超时,请重试');
    }
    if (externalSignal?.aborted || isAiRequestAbortError(error)) {
      throw createAiRequestError('AI_REQUEST_ABORTED', 'AI 请求已中止,请重试');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

function sanitizeBackendErrorDetail(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  return text
    .replace(/(bearer\s+)[^\s]+/gi, '$1***')
    .replace(/("?(api[-_ ]?key|password|token|secret)"?\s*[:=]\s*")([^"\\]{1,512})"/gi, '$1***"')
    .replace(/(api[-_ ]?key|password|token|secret)\s*[:=]\s*([^\s,;"'<>]{1,512})/gi, '$1=***')
    .replace(/(https?:\/\/)[^\s'"<>]+/gi, '$1***')
    .slice(0, 240);
}

function buildAiErrorCode(scene: AiRequestScene, status: number): string {
  const prefix =
    scene === 'models' ? 'AI_MODELS' : scene === 'chat-stream' ? 'AI_CHAT_STREAM' : 'AI_CHAT';
  return `${prefix}_HTTP_${status}`;
}

async function throwSanitizedHttpError(response: Response, scene: AiRequestScene): Promise<never> {
  const detail = await response.text().catch(() => '');
  const code = buildAiErrorCode(scene, response.status);
  const sanitizedDetail = sanitizeBackendErrorDetail(detail);

  if (sanitizedDetail) {
    console.warn('[AI_HTTP_ERROR]', {
      code,
      status: response.status,
      detail: sanitizedDetail
    });
  }

  throw new Error(`AI 服务请求失败（错误码：${code}）`);
}

function normalizeUrls(primary?: string[], fallback?: string): string[] {
  if (Array.isArray(primary) && primary.length > 0) return primary;
  if (fallback) return [fallback];
  return [];
}

function toOutboundMessage(message: ChatMessageInput) {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.text
    };
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      // 部分 OpenAI 兼容服务要求 assistant 的 content 是字符串而不是 null。
      content: message.text || '',
      tool_calls: message.toolCalls
    };
  }

  const imageUrls = normalizeUrls(message.imageDataUrls, message.imageDataUrl);
  const pdfUrls = normalizeUrls(message.pdfDataUrls, message.pdfDataUrl);

  if (message.role === 'user' && (imageUrls.length > 0 || pdfUrls.length > 0)) {
    return {
      role: message.role,
      content: [
        { type: 'text' as const, text: message.text || '请基于图片/PDF 进行记账建议分析。' },
        ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ...pdfUrls.map((url, index) => ({
          type: 'file' as const,
          file: {
            file_data: url,
            filename: `attachment-${index + 1}.pdf`
          }
        }))
      ]
    };
  }

  return {
    role: message.role,
    content: message.text
  };
}

function createStreamAbortPromise(signal: AbortSignal) {
  let removeListener: () => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    removeListener = () => signal.removeEventListener('abort', onAbort);
  });

  return {
    promise,
    cleanup: () => removeListener()
  };
}

async function readAiStream(
  input: ChatRequestInput,
  signal: AbortSignal,
  handlers: {
    onDelta: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
    onDone?: (content: string, reasoning?: string) => void;
  }
): Promise<SendAiChatResult> {
  const outboundMessages: ChatMessageInput[] = [
    ...(input.systemPrompt ? [{ role: 'system' as const, text: input.systemPrompt }] : []),
    ...input.messages
  ];

  const response = await requestAiService(`${normalizeBaseUrl(input.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey),
    signal,
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: outboundMessages.map((message) => toOutboundMessage(message)),
      ...(input.tools?.length
        ? { tools: input.tools, tool_choice: input.toolChoice ?? 'auto' }
        : {})
    })
  });

  if (!response.ok) {
    await throwSanitizedHttpError(response, 'chat-stream');
  }

  if (!response.body) {
    throw new Error('AI 服务流式响应为空(错误码:AI_CHAT_STREAM_NO_BODY)');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const abort = createStreamAbortPromise(signal);
  let buffer = '';
  let fullText = '';
  let fullReasoning = '';
  let validChunkCount = 0;
  let malformedChunkCount = 0;
  let completed = false;
  const toolCallAccumulator = new Map<number, ChatToolCall>();

  const finish = () => {
    const reasoning = fullReasoning.trim();
    handlers.onDone?.(fullText, reasoning || undefined);
    const toolCalls = Array.from(toolCallAccumulator.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call)
      .filter((call) => Boolean(call.name));
    return {
      content: fullText,
      reasoning: reasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  };

  const warnMalformedChunks = (tolerated: boolean) => {
    if (malformedChunkCount === 0) return;
    console.warn('[AI_STREAM_MALFORMED_CHUNK]', {
      count: malformedChunkCount,
      tolerated
    });
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const payload = trimmed.replace(/^data:\s*/, '');
    if (!payload) return false;
    if (payload === '[DONE]') {
      completed = true;
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      malformedChunkCount += 1;
      return false;
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as ChatCompletionStreamChunk).choices)
    ) {
      malformedChunkCount += 1;
      return false;
    }

    const chunk = parsed as ChatCompletionStreamChunk;
    const first = chunk.choices?.[0];
    validChunkCount += 1;
    const delta = first?.delta;
    const deltaText = normalizeMessageContent(delta?.content);
    const messageText = fullText ? '' : normalizeMessageContent(first?.message?.content);
    const textPart = deltaText || messageText;
    const reasoningPart =
      delta?.reasoning_content ||
      delta?.reasoning ||
      delta?.reasoningContent ||
      first?.message?.reasoning_content ||
      first?.message?.reasoning ||
      '';

    if (reasoningPart) {
      fullReasoning += reasoningPart;
      handlers.onReasoningDelta?.(reasoningPart);
    }

    if (Array.isArray(delta?.tool_calls)) {
      delta.tool_calls.forEach((part) => {
        const index = typeof part.index === 'number' ? part.index : toolCallAccumulator.size;
        const current = toolCallAccumulator.get(index) || { id: '', name: '', arguments: '' };
        if (part.id) current.id = part.id;
        if (part.function?.name) current.name += part.function.name;
        if (part.function?.arguments) current.arguments += part.function.arguments;
        toolCallAccumulator.set(index, current);
      });
    }

    if (textPart) {
      fullText += textPart;
      handlers.onDelta(textPart);
    }

    if (typeof first?.finish_reason === 'string' && first.finish_reason.trim()) {
      completed = true;
      return true;
    }

    return false;
  };

  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), abort.promise]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (handleLine(line)) break;
      }
      if (completed) break;
    }

    if (!completed) {
      buffer += decoder.decode();
      if (buffer.trim() && handleLine(buffer)) {
        buffer = '';
      }
    }
  } finally {
    abort.cleanup();
    reader.releaseLock();
  }

  if (validChunkCount === 0 && malformedChunkCount > 0) {
    warnMalformedChunks(false);
    throw createAiRequestError('AI_CHAT_STREAM_FORMAT', 'AI 服务流式响应格式异常,请重试');
  }

  if (!completed) {
    warnMalformedChunks(validChunkCount > 0);
    throw createAiRequestError('AI_CHAT_STREAM_INCOMPLETE', 'AI 服务流式响应提前结束,请重试');
  }

  warnMalformedChunks(true);
  return finish();
}

export async function sendAiChatStream(
  input: ChatRequestInput,
  handlers: {
    onDelta: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
    onDone?: (content: string, reasoning?: string) => void;
    onError?: (error: Error) => void;
  }
): Promise<SendAiChatResult> {
  try {
    return await withAiRequestTimeout(
      input.signal,
      (signal) => readAiStream(input, signal, handlers),
      getAiGenerationTimeoutMs()
    );
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error('AI 服务请求失败(错误码:AI_CHAT_STREAM_UNKNOWN)');
    handlers.onError?.(normalized);
    throw normalized;
  }
}

async function requestAiService(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (isAiRequestAbortError(error)) throw error;
    throw new Error('无法连接到 AI 服务，请检查接口地址与网络后重试。');
  }
}

export function isAiRequestAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

interface ChatRequestInput {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  messages: ChatMessageInput[];
  systemPrompt?: string;
  signal?: AbortSignal;
  tools?: ChatToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
}

function normalizeBaseUrl(baseUrl?: string) {
  const raw = (baseUrl || ENV.aiBaseUrl).trim();

  if (!raw) {
    throw new Error('AI 服务地址不能为空');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('AI 服务地址格式无效，请使用完整 URL（如 https://api.example.com/v1）');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('AI 服务地址仅支持 HTTP/HTTPS 协议');
  }

  return parsed.toString().replace(/\/$/, '');
}

function buildHeaders(apiKey?: string) {
  const token = apiKey || ENV.aiApiKey;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

export async function fetchAiModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
  return withAiRequestTimeout(undefined, async (signal) => {
    const response = await requestAiService(`${normalizeBaseUrl(baseUrl)}/models`, {
      method: 'GET',
      headers: buildHeaders(apiKey),
      signal
    });

    if (!response.ok) {
      await throwSanitizedHttpError(response, 'models');
    }

    const payload = (await response.json()) as ModelsResponse;
    return (payload.data || []).map((item) => item.id).filter(Boolean);
  });
}

function normalizeMessageContent(
  content: string | Array<{ type: 'text'; text: string }> | undefined
) {
  if (!content) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

export async function sendAiChat(input: ChatRequestInput): Promise<SendAiChatResult> {
  return withAiRequestTimeout(input.signal, async (signal) => {
    const outboundMessages: ChatMessageInput[] = [
      ...(input.systemPrompt ? [{ role: 'system' as const, text: input.systemPrompt }] : []),
      ...input.messages
    ];

    const response = await requestAiService(`${normalizeBaseUrl(input.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(input.apiKey),
      signal,
      body: JSON.stringify({
        model: input.model,
        messages: outboundMessages.map((message) => toOutboundMessage(message)),
        ...(input.tools?.length
          ? { tools: input.tools, tool_choice: input.toolChoice ?? 'auto' }
          : {})
      })
    });

    if (!response.ok) {
      await throwSanitizedHttpError(response, 'chat');
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const first = payload.choices?.[0]?.message;
    const content = normalizeMessageContent(first?.content);
    const reasoning = String(first?.reasoning_content || first?.reasoning || '').trim();
    const toolCalls = (first?.tool_calls || [])
      .map((call) => ({
        id: call.id || '',
        name: call.function?.name || '',
        arguments: call.function?.arguments || ''
      }))
      .filter((call) => Boolean(call.name));

    return {
      content: content || (toolCalls.length > 0 ? '' : '模型未返回可解析内容'),
      reasoning: reasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: payload.usage
        ? {
            promptTokens: Number(payload.usage.prompt_tokens || 0),
            completionTokens: Number(payload.usage.completion_tokens || 0),
            totalTokens: Number(payload.usage.total_tokens || 0)
          }
        : undefined
    };
  }, getAiGenerationTimeoutMs());
}
