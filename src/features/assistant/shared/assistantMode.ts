import type { TFunction } from 'i18next';

/**
 * AI 功能统一为三个模式:
 * - assistant: 记账 + 问答 + 改账的 Agent 模式(旧版 bookkeeping 已并入)
 * - credit: 信贷管家
 * - investment: 投资助手
 */
export type AssistantMode = 'assistant' | 'credit' | 'investment';

export const ASSISTANT_ACTIVE_MODE_STORAGE_KEY = 'ledgerflow.assistant.activeMode';
export const ASSISTANT_MODE_CHANGED_EVENT = 'ledgerflow:assistant-mode-changed';
/** 旧版本独立存在的「AI 记账」模式,读取缓存时迁移到合并后的 assistant。 */
export const LEGACY_BOOKKEEPING_MODE = 'bookkeeping';

export function isAssistantMode(value: unknown): value is AssistantMode {
  return value === 'assistant' || value === 'credit' || value === 'investment';
}

export function readAssistantModeFromSessionStorage(): AssistantMode {
  if (typeof window === 'undefined') {
    return 'assistant';
  }

  try {
    const raw = window.sessionStorage.getItem(ASSISTANT_ACTIVE_MODE_STORAGE_KEY);
    // 旧版本存的是 bookkeeping,迁移到合并后的 assistant。
    if (raw === LEGACY_BOOKKEEPING_MODE) return 'assistant';
    return isAssistantMode(raw) ? raw : 'assistant';
  } catch {
    return 'assistant';
  }
}

export function getAssistantModeLabel(mode: AssistantMode, t: TFunction): string {
  if (mode === 'credit') {
    return t('assistant.ui.creditMode');
  }

  if (mode === 'investment') {
    return t('assistant.ui.investmentMode');
  }

  return t('assistant.ui.assistantMode');
}

export function getAssistantModeSpark(mode: AssistantMode): string {
  switch (mode) {
    case 'credit':
      return '◈';
    case 'investment':
      return '↗';
    case 'assistant':
    default:
      return '✦';
  }
}
