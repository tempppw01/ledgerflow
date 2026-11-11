import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import type { AddTransactionAction } from '../../../shared/store/useFinanceStore';
import { useAiSettings } from '../../../shared/store/useAiSettings';
import type { DraftBillEntry } from './workbenchTypes';
import { useAssistantWorkbench } from './useAssistantWorkbench';

const categories: Category[] = [{ id: 'cat-food', name: '餐饮', kind: 'expense' }];
const accounts: Account[] = [
  {
    id: 'acc-cash',
    name: '现金',
    type: 'cash',
    initialBalance: 1000,
    balance: 1000
  }
];
const existingTransaction: TransactionItem = {
  id: 'tx-existing',
  type: 'expense',
  categoryId: 'cat-food',
  accountId: 'acc-cash',
  amount: 100,
  date: '2026-11-01T12:00:00.000Z',
  note: '原账单',
  tags: [],
  source: 'ai',
  status: 'completed',
  updatedAt: '2026-11-01T12:00:00.000Z'
};

function createEntry(overrides: Partial<DraftBillEntry> = {}): DraftBillEntry {
  return {
    id: 'entry-1',
    selected: true,
    type: 'expense',
    amount: 120,
    date: '2026-11-01T12:00:00.000Z',
    note: '午餐',
    category: '餐饮',
    account: '现金',
    tags: ['AI识别'],
    issues: [],
    ...overrides
  };
}

describe('useAssistantWorkbench 批量保存', () => {
  it('将覆盖和新增合并为一次批量写入,成功后移除已保存条目', () => {
    const addTransaction = vi.fn(() => ({
      addedIds: ['tx-new'],
      updatedIds: ['tx-existing']
    }));
    const updateTransaction = vi.fn();
    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: '',
        apiKey: '',
        model: 'test-model',
        categories,
        accounts,
        transactions: [existingTransaction],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: addTransaction as unknown as AddTransactionAction,
        updateTransaction,
        removeTransaction: vi.fn(),
        restoreTransaction: vi.fn()
      })
    );

    act(() => {
      result.current.setEntries([
        createEntry({
          id: 'entry-update',
          amount: 150,
          note: '覆盖原账单',
          duplicateTxId: 'tx-existing',
          duplicateReason: 'content'
        }),
        createEntry({
          id: 'entry-add',
          amount: 25,
          note: '新增账单'
        })
      ]);
    });

    let saved = false;
    act(() => {
      saved = result.current.saveSelected({
        overwriteDuplicateEntryIds: ['entry-update']
      });
    });

    expect(saved).toBe(true);
    expect(addTransaction).toHaveBeenCalledTimes(1);
    expect(addTransaction).toHaveBeenCalledWith([
      {
        operation: 'update',
        id: 'tx-existing',
        payload: expect.objectContaining({
          amount: 150,
          note: '覆盖原账单',
          categoryId: 'cat-food',
          accountId: 'acc-cash'
        })
      },
      {
        operation: 'add',
        payload: expect.objectContaining({
          amount: 25,
          note: '新增账单',
          categoryId: 'cat-food',
          accountId: 'acc-cash'
        })
      }
    ]);
    expect(updateTransaction).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(0);
  });

  it('批量写入失败时不清除任何待确认条目,也不报告部分成功', () => {
    const addTransaction = vi.fn(() => {
      throw new Error('模拟批量写入失败');
    });
    const updateTransaction = vi.fn();
    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: '',
        apiKey: '',
        model: 'test-model',
        categories,
        accounts,
        transactions: [existingTransaction],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: addTransaction as unknown as AddTransactionAction,
        updateTransaction,
        removeTransaction: vi.fn(),
        restoreTransaction: vi.fn()
      })
    );

    act(() => {
      result.current.setEntries([
        createEntry({
          id: 'entry-update',
          duplicateTxId: 'tx-existing',
          duplicateReason: 'content'
        }),
        createEntry({
          id: 'entry-add',
          amount: 25,
          note: '新增账单'
        })
      ]);
    });

    let saved = true;
    act(() => {
      saved = result.current.saveSelected({
        overwriteDuplicateEntryIds: ['entry-update']
      });
    });

    expect(saved).toBe(false);
    expect(addTransaction).toHaveBeenCalledTimes(1);
    expect(updateTransaction).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.toast).toMatchObject({
      visible: true,
      variant: 'error',
      message: '模拟批量写入失败'
    });
    expect(result.current.toast.message).not.toContain('已保存');
  });
});

function sse(payload: unknown) {
  return `data: ${JSON.stringify(payload)}`;
}

function sseToolCallChunk(id: string, name: string, args: unknown) {
  return sse({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) }
            }
          ]
        }
      }
    ]
  });
}

function createSseResponse(lines: string[]) {
  return new Response(lines.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

/** 只拦截对话请求,模型列表请求返回空列表,避免影响断言。 */
function mockAgentChatFetch(chatResponses: Array<Response | (() => Response)>) {
  const state = { chatCalls: 0, requestBodies: [] as unknown[] };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/chat/completions')) {
      if (typeof init?.body === 'string') {
        try {
          state.requestBodies.push(JSON.parse(init.body));
        } catch {
          state.requestBodies.push(init.body);
        }
      }
      const next = chatResponses[Math.min(state.chatCalls, chatResponses.length - 1)];
      state.chatCalls += 1;
      return Promise.resolve(typeof next === 'function' ? next() : next);
    }
    // 模型列表、时间戳等旁路请求返回空 JSON,不参与对话断言。
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
  return { fetchMock, state };
}

function mockAiSettings() {
  useAiSettings.setState({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    enableEmbeddingModel: false,
    enableRerankModel: false
  });
}

describe('useAssistantWorkbench Agent 工具', () => {
  it('模型调用 create_transactions 时落账并支持撤销', async () => {
    mockAiSettings();
    const addTransaction = vi.fn(() => 'tx-agent-1');
    const removeTransaction = vi.fn();
    const { fetchMock, state } = mockAgentChatFetch([
      createSseResponse([
        sseToolCallChunk('call_1', 'create_transactions', {
          transactions: [{ type: 'expense', amount: 30, note: '午饭' }]
        }),
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        '',
        'data: [DONE]',
        ''
      ]),
      createSseResponse([
        'data: {"choices":[{"delta":{"content":"已经帮你记下这笔午饭。"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ])
    ]);

    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
        categories,
        accounts,
        transactions: [],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: addTransaction as unknown as AddTransactionAction,
        updateTransaction: vi.fn(),
        removeTransaction,
        restoreTransaction: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleRecognizeWithPrompt(
        '午饭 30 元',
        { imageDataUrls: [], pdfDataUrls: [] },
        { task: 'chat', agent: true }
      );
    });

    expect(state.chatCalls).toBe(2);
    expect(addTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'expense', amount: 30, note: '午饭' })
    );
    expect(result.current.agentActions).toHaveLength(1);
    expect(result.current.rawContent).toContain('午饭');

    const actionId = result.current.agentActions[0].id;
    act(() => {
      result.current.undoAgentAction(actionId);
    });
    expect(removeTransaction).toHaveBeenCalledWith('tx-agent-1');
    expect(result.current.agentActions).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it('账户提示词能驱动 Agent 创建资金账户并回传结果', async () => {
    mockAiSettings();
    const addAccount = vi.fn(() => 'acc-agent-card');
    const { fetchMock, state } = mockAgentChatFetch([
      createSseResponse([
        sseToolCallChunk('call_account_1', 'create_account', {
          name: '招商银行储蓄卡',
          type: 'savings',
          initialBalance: 5000
        }),
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        '',
        'data: [DONE]',
        ''
      ]),
      createSseResponse([
        'data: {"choices":[{"delta":{"content":"已经为你新建招商银行储蓄卡,初始余额 5000 元。"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ])
    ]);

    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
        categories,
        accounts,
        transactions: [],
        addCategory: vi.fn(),
        addAccount,
        addTransaction: vi.fn() as unknown as AddTransactionAction,
        updateTransaction: vi.fn(),
        removeTransaction: vi.fn(),
        restoreTransaction: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleRecognizeWithPrompt(
        '我新办了一张招商银行储蓄卡,初始余额 5000 元,帮我加到账户里。',
        { imageDataUrls: [], pdfDataUrls: [] },
        { task: 'chat', agent: true }
      );
    });

    expect(state.chatCalls).toBe(2);
    expect(addAccount).toHaveBeenCalledWith('招商银行储蓄卡', 'savings', 5000);
    expect(result.current.agentActions[0]).toMatchObject({ kind: 'create', undoable: true });
    expect(result.current.rawContent).toContain('招商银行储蓄卡');
    expect(JSON.stringify(state.requestBodies[0])).toContain('create_account');
    expect(JSON.stringify(state.requestBodies[0])).toContain('confirmLinkedTransactions');

    fetchMock.mockRestore();
  });

  it('模型不支持工具时降级为普通对话', async () => {
    mockAiSettings();
    const { fetchMock, state } = mockAgentChatFetch([
      () => new Response('unsupported tools', { status: 400 }),
      () => new Response('unsupported tools', { status: 400 }),
      createSseResponse([
        'data: {"choices":[{"delta":{"content":"这个模型暂时不能改账本。"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ])
    ]);

    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
        categories,
        accounts,
        transactions: [],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: vi.fn() as unknown as AddTransactionAction,
        updateTransaction: vi.fn(),
        removeTransaction: vi.fn(),
        restoreTransaction: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleRecognizeWithPrompt(
        '记一笔午饭',
        { imageDataUrls: [], pdfDataUrls: [] },
        { task: 'chat', agent: true }
      );
    });

    expect(state.chatCalls).toBe(3);
    expect(result.current.rawContent).toContain('暂时不能改账本');

    fetchMock.mockRestore();
  });

  it('流式接口不返回 tool_calls 时回退到非流式请求继续执行工具', async () => {
    mockAiSettings();
    const { fetchMock, state } = mockAgentChatFetch([
      createSseResponse([
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ]),
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_2',
                      type: 'function',
                      function: { name: 'query_transactions', arguments: '{"keyword":"午餐"}' }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200 }
        ),
      createSseResponse([
        'data: {"choices":[{"delta":{"content":"本月午餐只有 1 笔。"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ])
    ]);

    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
        categories,
        accounts,
        transactions: [],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: vi.fn() as unknown as AddTransactionAction,
        updateTransaction: vi.fn(),
        removeTransaction: vi.fn(),
        restoreTransaction: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleRecognizeWithPrompt(
        '这个月午餐花了多少?',
        { imageDataUrls: [], pdfDataUrls: [] },
        { task: 'chat', agent: true }
      );
    });

    expect(state.chatCalls).toBe(3);
    expect(result.current.rawContent).toContain('本月午餐只有 1 笔');

    fetchMock.mockRestore();
  });

  it('工具执行成功后后续轮次失败不应把整轮判为失败', async () => {
    mockAiSettings();
    const addTransaction = vi.fn(() => 'tx-agent-9');
    const { fetchMock, state } = mockAgentChatFetch([
      createSseResponse([
        sseToolCallChunk('call_9', 'create_transactions', {
          transactions: [{ type: 'expense', amount: 18, note: '奶茶' }]
        }),
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        '',
        'data: [DONE]',
        ''
      ]),
      () => new Response('upstream boom', { status: 500 })
    ]);

    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
        categories,
        accounts,
        transactions: [],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: addTransaction as unknown as AddTransactionAction,
        updateTransaction: vi.fn(),
        removeTransaction: vi.fn(),
        restoreTransaction: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleRecognizeWithPrompt(
        '奶茶 18 元',
        { imageDataUrls: [], pdfDataUrls: [] },
        { task: 'chat', agent: true }
      );
    });

    expect(state.chatCalls).toBe(2);
    expect(addTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'expense', amount: 18, note: '奶茶' })
    );
    expect(result.current.agentActions).toHaveLength(1);
    expect(result.current.error).toBe('');
    expect(result.current.status).not.toBe('error');
    expect(result.current.rawContent).toContain('奶茶');

    fetchMock.mockRestore();
  });

  it('同一轮已输出说明并执行工具时,后续失败仍应保留回答', async () => {
    mockAiSettings();
    const removeTransaction = vi.fn();
    const { fetchMock, state } = mockAgentChatFetch([
      createSseResponse([
        sse({
          choices: [
            {
              delta: {
                content: '这笔支出其实是借出,我先帮你删掉。',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_del',
                    type: 'function',
                    function: {
                      name: 'delete_transaction',
                      arguments: JSON.stringify({ id: 'tx-existing' })
                    }
                  }
                ]
              }
            }
          ]
        }),
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        '',
        'data: [DONE]',
        ''
      ]),
      () => new Response('upstream boom', { status: 500 })
    ]);

    const { result } = renderHook(() =>
      useAssistantWorkbench({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'test-model',
        categories,
        accounts,
        transactions: [existingTransaction],
        addCategory: vi.fn(),
        addAccount: vi.fn(),
        addTransaction: vi.fn() as unknown as AddTransactionAction,
        updateTransaction: vi.fn(),
        removeTransaction,
        restoreTransaction: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleRecognizeWithPrompt(
        '昨天那笔 100 其实是借给朋友的',
        { imageDataUrls: [], pdfDataUrls: [] },
        { task: 'chat', agent: true }
      );
    });

    expect(state.chatCalls).toBe(2);
    expect(removeTransaction).toHaveBeenCalledWith('tx-existing');
    expect(result.current.agentActions).toHaveLength(1);
    expect(result.current.rawContent).toContain('这笔支出其实是借出');
    expect(result.current.error).toBe('');
    expect(result.current.status).not.toBe('error');

    fetchMock.mockRestore();
  });
});
