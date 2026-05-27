import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  GlobalMemoryDraft,
  GlobalMemoryFilter,
  GlobalMemoryItem,
  GlobalMemoryType,
  GlobalMemoryUpdatePayload,
  normalizeGlobalMemoryDraft,
  buildMemoryEmbeddingText,
  clampMemoryScore,
  sanitizePersistedGlobalMemoryItem
} from './globalMemory';

const GLOBAL_MEMORY_STORAGE_KEY = 'ledgerflow-global-memory';

function createGlobalMemoryId() {
  return `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMemoryText(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s,.，。!！?？:：;；'"“”‘’()（）[\]{}\-_/\\|]+/g, '')
    .trim();
}

function buildMemoryCombinedKey(item: Pick<GlobalMemoryItem, 'title' | 'content'>) {
  return `${normalizeMemoryText(item.title)}${normalizeMemoryText(item.content)}`;
}

function buildCharacterBigrams(value: string) {
  const normalized = normalizeMemoryText(value);
  const grams = new Set<string>();
  if (!normalized) return grams;
  if (normalized.length === 1) {
    grams.add(normalized);
    return grams;
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function calculateDiceCoefficient(left: string, right: string) {
  const leftGrams = buildCharacterBigrams(left);
  const rightGrams = buildCharacterBigrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;

  let overlap = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) {
      overlap += 1;
    }
  }
  return (2 * overlap) / (leftGrams.size + rightGrams.size);
}

function pickMoreInformativeText(current: string, incoming: string) {
  const currentText = String(current || '').trim();
  const incomingText = String(incoming || '').trim();
  if (!currentText) return incomingText;
  if (!incomingText) return currentText;
  return incomingText.length > currentText.length ? incomingText : currentText;
}

function mergeUniqueStrings(items: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of items) {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function mergeUniqueSourceTrace(
  current: GlobalMemoryItem['sourceTrace'],
  incoming: GlobalMemoryItem['sourceTrace']
) {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((item) => {
    const key = [
      item.kind,
      String(item.label || '').trim(),
      String(item.sourceId || '').trim(),
      String(item.excerpt || '').trim()
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLikelyDuplicateMemory(
  current: Pick<GlobalMemoryItem, 'type' | 'title' | 'content'>,
  incoming: Pick<GlobalMemoryItem, 'type' | 'title' | 'content'>
) {
  if (current.type !== incoming.type) return false;

  const currentTitle = normalizeMemoryText(current.title);
  const incomingTitle = normalizeMemoryText(incoming.title);
  const currentContent = normalizeMemoryText(current.content);
  const incomingContent = normalizeMemoryText(incoming.content);

  if (currentTitle === incomingTitle && currentContent === incomingContent) {
    return true;
  }
  if (currentContent && currentContent === incomingContent) {
    return true;
  }

  const currentCombined = buildMemoryCombinedKey(current);
  const incomingCombined = buildMemoryCombinedKey(incoming);
  if (!currentCombined || !incomingCombined) return false;

  const shorterLength = Math.min(currentCombined.length, incomingCombined.length);
  const longerLength = Math.max(currentCombined.length, incomingCombined.length);
  if (
    shorterLength >= 12 &&
    (currentCombined.includes(incomingCombined) || incomingCombined.includes(currentCombined)) &&
    shorterLength / longerLength >= 0.68
  ) {
    return true;
  }

  return calculateDiceCoefficient(currentCombined, incomingCombined) >= 0.72;
}

function mergeDuplicateMemory(current: GlobalMemoryItem, incoming: GlobalMemoryItem): GlobalMemoryItem {
  const title = pickMoreInformativeText(current.title, incoming.title);
  const content = pickMoreInformativeText(current.content, incoming.content);
  const type = current.type;

  return {
    ...current,
    title,
    content,
    source: current.source || incoming.source,
    sourceTrace: mergeUniqueSourceTrace(current.sourceTrace, incoming.sourceTrace),
    sourceIds: mergeUniqueStrings([...current.sourceIds, ...incoming.sourceIds]),
    confidence: Math.max(current.confidence, incoming.confidence),
    score: Math.max(current.score, incoming.score),
    origin: current.origin === 'manual' ? current.origin : incoming.origin,
    pinned: current.pinned || incoming.pinned,
    disabled: current.disabled,
    embeddingText: buildMemoryEmbeddingText({ title, content, type }),
    lastUsedAt: current.lastUsedAt ?? incoming.lastUsedAt ?? null,
    updatedAt: new Date().toISOString()
  };
}

function dedupeMemories(items: GlobalMemoryItem[]) {
  return items.reduce<GlobalMemoryItem[]>((acc, item) => {
    const duplicateIndex = acc.findIndex((existing) => isLikelyDuplicateMemory(existing, item));
    if (duplicateIndex === -1) {
      acc.push(item);
      return acc;
    }
    acc[duplicateIndex] = mergeDuplicateMemory(acc[duplicateIndex], item);
    return acc;
  }, []);
}

function sortMemories(items: GlobalMemoryItem[], pinnedFirst = true) {
  const copied = [...items];
  copied.sort((a, b) => {
    if (pinnedFirst && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aUpdatedAt = new Date(a.updatedAt).getTime() || 0;
    const bUpdatedAt = new Date(b.updatedAt).getTime() || 0;
    return bUpdatedAt - aUpdatedAt;
  });
  return copied;
}

function mergeMemoryItem(current: GlobalMemoryItem, payload: Partial<GlobalMemoryDraft>): GlobalMemoryItem {
  const nextTitle = payload.title !== undefined ? String(payload.title || '').trim() : current.title;
  const nextContent =
    payload.content !== undefined ? String(payload.content || '').trim() : current.content;
  const nextType = payload.type ?? current.type;
  const nextEmbeddingText =
    payload.embeddingText !== undefined
      ? String(payload.embeddingText || '').trim()
      : current.embeddingText;

  return {
    ...current,
    ...payload,
    title: nextTitle,
    content: nextContent,
    type: nextType,
    source: payload.source ?? current.source,
    sourceTrace: Array.isArray(payload.sourceTrace) ? payload.sourceTrace : current.sourceTrace,
    sourceIds: Array.isArray(payload.sourceIds) ? payload.sourceIds.filter(Boolean) : current.sourceIds,
    confidence:
      payload.confidence !== undefined
        ? clampMemoryScore(payload.confidence, current.confidence)
        : current.confidence,
    score: payload.score !== undefined ? clampMemoryScore(payload.score, current.score) : current.score,
    status: payload.status ?? current.status,
    origin: payload.origin ?? current.origin,
    pinned: payload.pinned ?? current.pinned,
    disabled: payload.disabled ?? current.disabled,
    embeddingText:
      nextEmbeddingText || buildMemoryEmbeddingText({ title: nextTitle, content: nextContent, type: nextType }),
    lastUsedAt: payload.lastUsedAt !== undefined ? payload.lastUsedAt : current.lastUsedAt,
    updatedAt: new Date().toISOString()
  };
}

interface GlobalMemoryState {
  memories: GlobalMemoryItem[];
  addMemory: (payload: GlobalMemoryDraft) => { ok: boolean; id?: string; reason?: string };
  updateMemory: (payload: GlobalMemoryUpdatePayload) => { ok: boolean; reason?: string };
  replaceAllData: (items: GlobalMemoryItem[]) => void;
  removeMemory: (id: string) => void;
  removeMemories: (ids: string[]) => void;
  clearMemories: () => void;
  archiveMemory: (id: string) => void;
  restoreMemory: (id: string) => void;
  setMemoryDisabled: (id: string, disabled: boolean) => void;
  pinMemory: (id: string, pinned: boolean) => void;
  markMemoryUsed: (id: string) => void;
  getFilteredMemories: (filter?: GlobalMemoryFilter) => GlobalMemoryItem[];
  getMemorySummaryByType: () => Record<GlobalMemoryType, number>;
}

export const useGlobalMemoryStore = create<GlobalMemoryState>()(
  persist(
    (set, get) => ({
      memories: [],
      addMemory: (payload) => {
        const normalized = normalizeGlobalMemoryDraft(payload);
        if (!normalized.title || !normalized.content) {
          return { ok: false, reason: '记忆标题和内容不能为空。' };
        }

        const candidate = { ...normalized, id: createGlobalMemoryId() };
        let targetId = candidate.id;
        set((state) => {
          const duplicate = state.memories.find((item) => isLikelyDuplicateMemory(item, candidate));
          if (duplicate) {
            targetId = duplicate.id;
            return {
              memories: sortMemories(
                state.memories.map((item) =>
                  item.id === duplicate.id ? mergeDuplicateMemory(item, candidate) : item
                )
              )
            };
          }

          return {
            memories: sortMemories([candidate, ...state.memories])
          };
        });
        return { ok: true, id: targetId };
      },
      updateMemory: ({ id, ...payload }) => {
        const exists = get().memories.some((item) => item.id === id);
        if (!exists) {
          return { ok: false, reason: '记忆不存在。' };
        }

        set((state) => ({
          memories: sortMemories(
            dedupeMemories(
              state.memories.map((item) => (item.id === id ? mergeMemoryItem(item, payload) : item))
            )
          )
        }));
        return { ok: true };
      },
      replaceAllData: (items) => {
        const safeMemories = Array.isArray(items)
          ? items
              .map((item, index) => sanitizePersistedGlobalMemoryItem(item, index))
              .filter((item): item is GlobalMemoryItem => Boolean(item))
          : [];
        set(() => ({ memories: sortMemories(dedupeMemories(safeMemories)) }));
      },
      removeMemory: (id) => {
        set((state) => ({
          memories: state.memories.filter((item) => item.id !== id)
        }));
      },
      removeMemories: (ids) => {
        const idSet = new Set(ids);
        set((state) => ({
          memories: state.memories.filter((item) => !idSet.has(item.id))
        }));
      },
      clearMemories: () => {
        set(() => ({ memories: [] }));
      },
      archiveMemory: (id) => {
        set((state) => ({
          memories: sortMemories(
            state.memories.map((item) =>
              item.id === id ? { ...item, status: 'archived', updatedAt: new Date().toISOString() } : item
            )
          )
        }));
      },
      restoreMemory: (id) => {
        set((state) => ({
          memories: sortMemories(
            state.memories.map((item) =>
              item.id === id ? { ...item, status: 'active', updatedAt: new Date().toISOString() } : item
            )
          )
        }));
      },
      setMemoryDisabled: (id, disabled) => {
        set((state) => ({
          memories: sortMemories(
            state.memories.map((item) =>
              item.id === id ? { ...item, disabled, updatedAt: new Date().toISOString() } : item
            )
          )
        }));
      },
      pinMemory: (id, pinned) => {
        set((state) => ({
          memories: sortMemories(
            state.memories.map((item) =>
              item.id === id ? { ...item, pinned, updatedAt: new Date().toISOString() } : item
            )
          )
        }));
      },
      markMemoryUsed: (id) => {
        set((state) => ({
          memories: sortMemories(
            state.memories.map((item) =>
              item.id === id
                ? { ...item, lastUsedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                : item
            )
          )
        }));
      },
      getFilteredMemories: (filter) => {
        const { memories } = get();
        const nextFilter = filter ?? {};
        return sortMemories(
          memories.filter((item) => {
            if (nextFilter.type && nextFilter.type !== 'all' && item.type !== nextFilter.type) {
              return false;
            }
            if (nextFilter.status && nextFilter.status !== 'all' && item.status !== nextFilter.status) {
              return false;
            }
            if (!nextFilter.includeDisabled && item.disabled) {
              return false;
            }
            return true;
          }),
          nextFilter.pinnedFirst ?? true
        );
      },
      getMemorySummaryByType: () => {
        const summary: Record<GlobalMemoryType, number> = {
          user_preference: 0,
          financial_habit: 0,
          risk_preference: 0,
          display_preference: 0
        };
        for (const item of get().memories) {
          if (item.type in summary) {
            summary[item.type] += 1;
          }
        }
        return summary;
      }
    }),
    {
      name: GLOBAL_MEMORY_STORAGE_KEY,
      merge: (persistedState, currentState) => {
        const incoming = (persistedState as Partial<GlobalMemoryState> | undefined)?.memories;
        const safeMemories = Array.isArray(incoming)
          ? incoming
              .map((item, index) => sanitizePersistedGlobalMemoryItem(item, index))
              .filter((item): item is GlobalMemoryItem => Boolean(item))
          : currentState.memories;

        return {
          ...currentState,
          ...(persistedState as object),
          memories: sortMemories(dedupeMemories(safeMemories))
        };
      }
    }
  )
);
