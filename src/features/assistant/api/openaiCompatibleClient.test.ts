import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAiChat, sendAiChatStream } from './openaiCompatibleClient';

describe('openaiCompatibleClient baseUrl validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it('rejects unsupported protocols but allows plain http endpoints', async () => {
    await expect(
      sendAiChat({
        baseUrl: 'javascript:alert(1)',
        model: 'test-model',
        messages: [{ role: 'user', text: 'hello' }]
      })
    ).rejects.toThrow('仅支持 HTTP/HTTPS 协议');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"先判断场景"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"可以记一笔。"}}]}',
          '',
          'data: [DONE]',
          ''
        ].join('\n'),
        { status: 200 }
      )
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
});
