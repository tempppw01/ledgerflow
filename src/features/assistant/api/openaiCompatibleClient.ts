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
  role: 'system' | 'user' | 'assistant';
  text: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  pdfDataUrl?: string;
  pdfDataUrls?: string[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: 'text'; text: string }>;
      reasoning_content?: string;
      reasoning?: string;
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
    };
    message?: {
      content?: string | Array<{ type: 'text'; text: string }>;
      reasoning_content?: string;
      reasoning?: string;
    };
  }>;
}

export interface SendAiChatResult {
  content: string;
  reasoning?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
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

export async function sendAiChatStream(
  input: ChatRequestInput,
  handlers: {
    onDelta: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
    onDone?: (content: string, reasoning?: string) => void;
    onError?: (error: Error) => void;
  }
): Promise<SendAiChatResult> {
  const outboundMessages: ChatMessageInput[] = [
    ...(input.systemPrompt ? [{ role: 'system' as const, text: input.systemPrompt }] : []),
    ...input.messages
  ];

  const response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey),
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: outboundMessages.map((message) => toOutboundMessage(message))
    })
  });

  if (!response.ok) {
    const error = await throwSanitizedHttpError(response, 'chat-stream').catch((err) =>
      err instanceof Error
        ? err
        : new Error('AI 服务请求失败（错误码：AI_CHAT_STREAM_HTTP_UNKNOWN）')
    );
    handlers.onError?.(error);
    throw error;
  }

  if (!response.body) {
    const error = new Error('AI 服务流式响应为空（错误码：AI_CHAT_STREAM_NO_BODY）');
    handlers.onError?.(error);
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';
  let fullReasoning = '';

  const finish = () => {
    const reasoning = fullReasoning.trim();
    handlers.onDone?.(fullText, reasoning || undefined);
    return { content: fullText, reasoning: reasoning || undefined };
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const payload = trimmed.replace(/^data:\s*/, '');
    if (payload === '[DONE]') {
      return true;
    }

    try {
      const chunk = JSON.parse(payload) as ChatCompletionStreamChunk;
      const first = chunk.choices?.[0];
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

      if (textPart) {
        fullText += textPart;
        handlers.onDelta(textPart);
      }
    } catch {
      // ignore malformed chunk
    }

    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (handleLine(line)) return finish();
      }
    }

    if (buffer.trim() && handleLine(buffer)) return finish();
  } finally {
    reader.releaseLock();
  }

  return finish();
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

  if (parsed.protocol !== 'https:') {
    throw new Error('AI 服务地址仅支持 HTTPS 协议');
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
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    method: 'GET',
    headers: buildHeaders(apiKey)
  });

  if (!response.ok) {
    await throwSanitizedHttpError(response, 'models');
  }

  const payload = (await response.json()) as ModelsResponse;
  return (payload.data || []).map((item) => item.id).filter(Boolean);
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
  const outboundMessages: ChatMessageInput[] = [
    ...(input.systemPrompt ? [{ role: 'system' as const, text: input.systemPrompt }] : []),
    ...input.messages
  ];

  const response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey),
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      messages: outboundMessages.map((message) => toOutboundMessage(message))
    })
  });

  if (!response.ok) {
    await throwSanitizedHttpError(response, 'chat');
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const first = payload.choices?.[0]?.message;
  const content = normalizeMessageContent(first?.content);
  const reasoning = String(first?.reasoning_content || first?.reasoning || '').trim();

  return {
    content: content || '模型未返回可解析内容',
    reasoning: reasoning || undefined,
    usage: payload.usage
      ? {
          promptTokens: Number(payload.usage.prompt_tokens || 0),
          completionTokens: Number(payload.usage.completion_tokens || 0),
          totalTokens: Number(payload.usage.total_tokens || 0)
        }
      : undefined
  };
}
