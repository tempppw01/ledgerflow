import { beforeEach, describe, expect, it } from 'vitest';
import { useGlobalMemoryStore } from './useGlobalMemoryStore';

const GLOBAL_MEMORY_STORAGE_KEY = 'ledgerflow-global-memory';

describe('useGlobalMemoryStore', () => {
  beforeEach(() => {
    localStorage.removeItem(GLOBAL_MEMORY_STORAGE_KEY);
    useGlobalMemoryStore.setState({ memories: [] });
  });

  it('adds memory with embedding text fallback and summary support', () => {
    const result = useGlobalMemoryStore.getState().addMemory({
      title: '偏好简洁回答',
      content: '用户更喜欢先结论后展开，避免过长铺垫。',
      type: 'display_preference',
      source: 'assistant_chat',
      origin: 'extracted'
    });

    expect(result.ok).toBe(true);
    const memory = useGlobalMemoryStore.getState().memories[0];
    expect(memory.embeddingText).toContain('偏好简洁回答');
    expect(memory.embeddingText).toContain('display_preference');

    const summary = useGlobalMemoryStore.getState().getMemorySummaryByType();
    expect(summary.display_preference).toBe(1);
  });

  it('updates archive disable pin and restore memory', () => {
    const { id } = useGlobalMemoryStore.getState().addMemory({
      title: '重视还款提醒',
      content: '用户偏保守，关注账单日和到期日提醒。',
      type: 'risk_preference',
      source: 'assistant_chat'
    });

    expect(id).toBeTruthy();
    const memoryId = String(id);

    useGlobalMemoryStore.getState().updateMemory({
      id: memoryId,
      score: 0.91,
      confidence: 0.88,
      sourceIds: ['msg-1', 'msg-2']
    });
    useGlobalMemoryStore.getState().pinMemory(memoryId, true);
    useGlobalMemoryStore.getState().setMemoryDisabled(memoryId, true);
    useGlobalMemoryStore.getState().archiveMemory(memoryId);

    let memory = useGlobalMemoryStore.getState().memories.find((item) => item.id === memoryId);
    expect(memory?.pinned).toBe(true);
    expect(memory?.disabled).toBe(true);
    expect(memory?.status).toBe('archived');
    expect(memory?.score).toBeCloseTo(0.91, 5);
    expect(memory?.sourceIds).toEqual(['msg-1', 'msg-2']);

    useGlobalMemoryStore.getState().restoreMemory(memoryId);
    useGlobalMemoryStore.getState().markMemoryUsed(memoryId);

    memory = useGlobalMemoryStore.getState().memories.find((item) => item.id === memoryId);
    expect(memory?.status).toBe('active');
    expect(memory?.lastUsedAt).toBeTruthy();
  });

  it('filters disabled memories by default', () => {
    const first = useGlobalMemoryStore.getState().addMemory({
      title: '常用分类偏好',
      content: '餐饮和交通是最常用分类。',
      type: 'financial_habit',
      source: 'bookkeeping_action'
    });
    const second = useGlobalMemoryStore.getState().addMemory({
      title: '关注现金流',
      content: '更关注月度现金流安全边际。',
      type: 'user_preference',
      source: 'assistant_chat'
    });

    useGlobalMemoryStore.getState().setMemoryDisabled(String(second.id), true);

    const visible = useGlobalMemoryStore.getState().getFilteredMemories();
    const all = useGlobalMemoryStore.getState().getFilteredMemories({ includeDisabled: true });

    expect(visible).toHaveLength(1);
    expect(all).toHaveLength(2);
    expect(visible[0].id).toBe(String(first.id));
  });

  it('merges overlapping extracted memories instead of stacking duplicates', () => {
    const first = useGlobalMemoryStore.getState().addMemory({
      title: '奶茶消费支付方式',
      content: '用户主要通过支付宝和微信进行奶茶消费。',
      type: 'user_preference',
      source: 'assistant_chat',
      origin: 'extracted',
      sourceIds: ['msg-1']
    });

    const second = useGlobalMemoryStore.getState().addMemory({
      title: '奶茶消费支付渠道',
      content: '用户主要通过支付宝和微信进行奶茶消费。',
      type: 'user_preference',
      source: 'assistant_chat',
      origin: 'extracted',
      sourceIds: ['msg-2']
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.id).toBe(first.id);

    const memories = useGlobalMemoryStore.getState().memories;
    expect(memories).toHaveLength(1);
    expect(memories[0].sourceIds).toEqual(['msg-1', 'msg-2']);
  });

  it('dedupes similar memories during replaceAllData hydration paths', () => {
    useGlobalMemoryStore.getState().replaceAllData([
      {
        id: 'memory-1',
        title: '奶茶消费习惯',
        content: '用户近期有奶茶消费，主要通过支付宝和微信进行。',
        type: 'financial_habit',
        source: 'assistant_chat',
        sourceTrace: [],
        sourceIds: ['msg-a'],
        confidence: 0.8,
        score: 0.8,
        status: 'active',
        origin: 'extracted',
        pinned: false,
        disabled: false,
        embeddingText: '',
        lastUsedAt: null,
        createdAt: '2026-05-25T12:00:00.000Z',
        updatedAt: '2026-05-25T12:00:00.000Z'
      },
      {
        id: 'memory-2',
        title: '奶茶消费偏好',
        content: '用户近期有奶茶消费，主要通过支付宝和微信进行，1月18日消费更集中。',
        type: 'financial_habit',
        source: 'assistant_chat',
        sourceTrace: [],
        sourceIds: ['msg-b'],
        confidence: 0.9,
        score: 0.9,
        status: 'active',
        origin: 'extracted',
        pinned: false,
        disabled: false,
        embeddingText: '',
        lastUsedAt: null,
        createdAt: '2026-05-25T12:01:00.000Z',
        updatedAt: '2026-05-25T12:01:00.000Z'
      }
    ]);

    const memories = useGlobalMemoryStore.getState().memories;
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toContain('1月18日消费更集中');
    expect(memories[0].sourceIds).toEqual(['msg-a', 'msg-b']);
  });

  it('keeps distinct facts separate when only the topic overlaps', () => {
    useGlobalMemoryStore.getState().addMemory({
      title: '奶茶消费总额',
      content: '在2026年1月18日至2月2日期间，奶茶消费总计约275.66元。',
      type: 'financial_habit',
      source: 'assistant_chat',
      origin: 'extracted'
    });

    useGlobalMemoryStore.getState().addMemory({
      title: '奶茶消费支付方式',
      content: '用户主要通过支付宝和微信进行奶茶消费。',
      type: 'financial_habit',
      source: 'assistant_chat',
      origin: 'extracted'
    });

    expect(useGlobalMemoryStore.getState().memories).toHaveLength(2);
  });
});
