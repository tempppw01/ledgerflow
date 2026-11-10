import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV } from '../../../shared/config/env';
import { fetchAiModels, sendAiChat, sendAiChatStream } from './openaiCompatibleClient';

function createStreamResponse(lines: string[]) {
  return new Response(lines.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

function mockAbortableFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const rejectAborted = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal?.aborted) {
        rejectAborted();
        return;
      }
      signal?.addEventListener('abort', rejectAborted, { once: true });
    });
  });
}

describe('openaiCompatibleClient baseUrl validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects unsupported protocols but allows plain http endpoints', async () => {
    await expect(
      sendAiChat({
        baseUrl: 'javascript:alert(1)',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      })
    ).rejects.toThrow('仅支持 HTTP/HTTPS 协议');

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      );
    await sendAiChat({
      baseUrl: 'http://api.example.com/v1',
      model: 'test-model',
      messages: [{ role: 'user', text: 'hello' }]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('turns network failures into a friendly connection message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      sendAiChat({
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      })
    ).rejects.toThrow('无法连接到 AI 服务，请检查接口地址与网络后重试。');
  });

  it('normalizes trailing slash before requesting', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      );

    await sendAiChat({
      baseUrl: 'https://api.example.com/v1/',
      model: 'test-model',
      messages: [{ role: 'user', text: 'hello' }]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );

    fetchMock.mockRestore();
  });

  it('hides backend plaintext error details and returns stable error code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream failed token=abc123 https://internal.example.com', { status: 502 })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      sendAiChat({
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      })
    ).rejects.toThrow('AI 服务请求失败（错误码：AI_CHAT_HTTP_502）');

    expect(warnSpy).toHaveBeenCalledWith(
      '[AI_HTTP_ERROR]',
      expect.objectContaining({ code: 'AI_CHAT_HTTP_502', status: 502 })
    );
    const warnPayload = warnSpy.mock.calls[0]?.[1] as { detail?: string } | undefined;
    expect(warnPayload?.detail || '').not.toContain('abc123');
    expect(warnPayload?.detail || '').not.toContain('internal.example.com');
  });

  it('发送 PDF 附件时应使用 file_data 字段而不是 file_url', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      );

    await sendAiChat({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      messages: [
        {
          role: 'user',
          text: '',
          pdfDataUrls: ['data:application/pdf;base64,ZmFrZS1wZGY=']
        }
      ]
    });

    const call = fetchMock.mock.calls[0];
    const options = call?.[1] as RequestInit;
    const body = JSON.parse(String(options.body || '{}')) as {
      messages?: Array<{
        content?: Array<{ type: string; file?: { file_data?: string; filename?: string } }>;
      }>;
    };

    const userContent = body.messages?.[0]?.content || [];
    const filePart = userContent.find((part) => part.type === 'file');

    expect(filePart?.file?.file_data).toBe('data:application/pdf;base64,ZmFrZS1wZGY=');
    expect(filePart?.file?.filename).toBe('attachment-1.pdf');
    expect(JSON.stringify(body)).not.toContain('file_url');

    fetchMock.mockRestore();
  });

  it('streams reasoning_content before final text deltas', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        createStreamResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"先判断场景"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"可以记一笔。"}}]}',
          '',
          'data: [DONE]',
          ''
        ])
      );
    const reasoning: string[] = [];
    const content: string[] = [];
    let doneContent = '';
    let doneReasoning = '';

    const result = await sendAiChatStream(
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      },
      {
        onDelta: (delta) => content.push(delta),
        onReasoningDelta: (delta) => reasoning.push(delta),
        onDone: (text, thinking) => {
          doneContent = text;
          doneReasoning = thinking || '';
        }
      }
    );

    expect(reasoning).toEqual(['先判断场景']);
    expect(content).toEqual(['可以记一笔。']);
    expect(doneContent).toBe('可以记一笔。');
    expect(doneReasoning).toBe('先判断场景');
    expect(result).toMatchObject({ content: '可以记一笔。', reasoning: '先判断场景' });

    fetchMock.mockRestore();
  });

  it('accepts a terminal finish_reason without a DONE marker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createStreamResponse([
        'data: {"choices":[{"delta":{"content":"完整回复"},"finish_reason":"stop"}]}'
      ])
    );
    const onDone = vi.fn();

    const result = await sendAiChatStream(
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      },
      { onDelta: vi.fn(), onDone }
    );

    expect(result.content).toBe('完整回复');
    expect(onDone).toHaveBeenCalledWith('完整回复', undefined);
  });

  it('rejects a stream that ends before DONE or a terminal finish_reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createStreamResponse(['data: {"choices":[{"delta":{"content":"半截回复"}}]}'])
    );
    const onError = vi.fn();
    const onDone = vi.fn();

    await expect(
      sendAiChatStream(
        {
          baseUrl: 'https://api.example.com/v1',
          model: 'test-model',
          messages: [{ role: 'user', text: 'hello' }]
        },
        { onDelta: vi.fn(), onDone, onError }
      )
    ).rejects.toMatchObject({
      code: 'AI_CHAT_STREAM_INCOMPLETE',
      retryable: true
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('tolerates and records malformed chunks when valid content still completes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createStreamResponse([
        'data: {not-json}',
        'data: {"choices":[{"delta":{"content":"有效回复"}}]}',
        'data: [DONE]'
      ])
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await sendAiChatStream(
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      },
      { onDelta: vi.fn() }
    );

    expect(result.content).toBe('有效回复');
    expect(warnSpy).toHaveBeenCalledWith('[AI_STREAM_MALFORMED_CHUNK]', {
      count: 1,
      tolerated: true
    });
  });

  it('rejects a stream containing only malformed chunks as a format error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createStreamResponse(['data: {not-json}', 'data: null', 'data: {"unexpected":true}'])
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      sendAiChatStream(
        {
          baseUrl: 'https://api.example.com/v1',
          model: 'test-model',
          messages: [{ role: 'user', text: 'hello' }]
        },
        { onDelta: vi.fn() }
      )
    ).rejects.toMatchObject({
      code: 'AI_CHAT_STREAM_FORMAT',
      retryable: true
    });

    expect(warnSpy).toHaveBeenCalledWith('[AI_STREAM_MALFORMED_CHUNK]', {
      count: 3,
      tolerated: false
    });
  });

  it('rejects an all-malformed stream even when DONE is received', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createStreamResponse(['data: {not-json}', 'data: [DONE]'])
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      sendAiChatStream(
        {
          baseUrl: 'https://api.example.com/v1',
          model: 'test-model',
          messages: [{ role: 'user', text: 'hello' }]
        },
        { onDelta: vi.fn() }
      )
    ).rejects.toMatchObject({
      code: 'AI_CHAT_STREAM_FORMAT',
      retryable: true
    });

    expect(warnSpy).toHaveBeenCalledWith('[AI_STREAM_MALFORMED_CHUNK]', {
      count: 1,
      tolerated: false
    });
  });

  it('times out regular chat requests with a retryable error', async () => {
    vi.useFakeTimers();
    mockAbortableFetch();

    const request = sendAiChat({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      messages: [{ role: 'user', text: 'hello' }]
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(ENV.requestTimeoutMs);

    await expect(request).resolves.toMatchObject({
      code: 'AI_REQUEST_TIMEOUT',
      retryable: true
    });
  });

  it('times out model discovery requests with a retryable error', async () => {
    vi.useFakeTimers();
    mockAbortableFetch();

    const request = fetchAiModels('https://api.example.com/v1').catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(ENV.requestTimeoutMs);

    await expect(request).resolves.toMatchObject({
      code: 'AI_REQUEST_TIMEOUT',
      retryable: true
    });
  });

  it('keeps the timeout active while waiting for stream data', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Keep the stream open to verify the request timeout also covers reads.
      }
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    const onError = vi.fn();

    const request = sendAiChatStream(
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      },
      { onDelta: vi.fn(), onError }
    ).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(ENV.requestTimeoutMs);

    await expect(request).resolves.toMatchObject({
      code: 'AI_REQUEST_TIMEOUT',
      retryable: true
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('merges caller aborts into a retryable cancellation error', async () => {
    const controller = new AbortController();
    mockAbortableFetch();

    const request = sendAiChat({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      messages: [{ role: 'user', text: 'hello' }],
      signal: controller.signal
    }).catch((error: unknown) => error);

    controller.abort();

    await expect(request).resolves.toMatchObject({
      code: 'AI_REQUEST_ABORTED',
      retryable: true
    });
  });

  it('merges caller aborts while reading a streaming response', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Keep the stream open until the caller aborts the request.
      }
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    const onError = vi.fn();

    const request = sendAiChatStream(
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }],
        signal: controller.signal
      },
      { onDelta: vi.fn(), onError }
    ).catch((error: unknown) => error);

    await Promise.resolve();
    controller.abort();

    await expect(request).resolves.toMatchObject({
      code: 'AI_REQUEST_ABORTED',
      retryable: true
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
describe('openaiCompatibleClient tool calling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends tool definitions and parses streamed tool calls', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        createStreamResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"create_transactions","arguments":"{\\"transactions\\":"}}]}}]}',
          '',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"[{\\"type\\":\\"expense\\",\\"amount\\":15}]}"}}]}}]}',
          '',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          '',
          'data: [DONE]',
          ''
        ])
      );

    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'create_transactions',
          description: '新增账单',
          parameters: { type: 'object', properties: {} }
        }
      }
    ];

    const result = await sendAiChatStream(
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [{ role: 'user', text: '午饭 15 元' }],
        tools
      },
      { onDelta: () => undefined }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      tools,
      tool_choice: 'auto'
    });
    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'create_transactions',
        arguments: '{"transactions":[{"type":"expense","amount":15}]}'
      }
    ]);

    fetchMock.mockRestore();
  });

  it('serializes assistant tool calls and tool results in follow-up requests', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        createStreamResponse([
          'data: {"choices":[{"delta":{"content":"已经记好了。"}}]}',
          '',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
          '',
          'data: [DONE]',
          ''
        ])
      );

    await sendAiChatStream(
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        messages: [
          { role: 'user', text: '午饭 15 元' },
          {
            role: 'assistant',
            text: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'create_transactions', arguments: '{}' }
              }
            ]
          },
          { role: 'tool', text: '{"ok":true}', toolCallId: 'call_1' }
        ]
      },
      { onDelta: () => undefined }
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.messages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'create_transactions', arguments: '{}' }
        }
      ]
    });
    expect(body.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"ok":true}'
    });

    fetchMock.mockRestore();
  });

  it('parses non-streaming tool calls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_9',
                    type: 'function',
                    function: { name: 'query_transactions', arguments: '{"keyword":"餐"}' }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await sendAiChat({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      messages: [{ role: 'user', text: '查一下餐饮' }]
    });

    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([
      { id: 'call_9', name: 'query_transactions', arguments: '{"keyword":"餐"}' }
    ]);
  });
});
