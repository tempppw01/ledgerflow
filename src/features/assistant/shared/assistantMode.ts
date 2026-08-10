import type { TFunction } from 'i18next';

export type AssistantMode = 'bookkeeping' | 'assistant' | 'credit';

export const ASSISTANT_ACTIVE_MODE_STORAGE_KEY = 'ledgerflow.assistant.activeMode';
export const ASSISTANT_MODE_CHANGED_EVENT = 'ledgerflow:assistant-mode-changed';

export function isAssistantMode(value: unknown): value is AssistantMode {
  return value === 'bookkeeping' || value === 'assistant' || value === 'credit';
}

export function readAssistantModeFromSessionStorage(): AssistantMode {
  if (typeof window === 'undefined') {
    return 'assistant';
  }

  try {
    const raw = window.sessionStorage.getItem(ASSISTANT_ACTIVE_MODE_STORAGE_KEY);
    return isAssistantMode(raw) ? raw : 'assistant';
  } catch {
    return 'assistant';
  }
}

export function getAssistantModeLabel(mode: AssistantMode, t: TFunction): string {
  if (mode === 'bookkeeping') {
    return t('assistant.ui.bookkeepingMode');
  }

  if (mode === 'credit') {
    return t('assistant.ui.creditMode');
  }

  return t('assistant.ui.assistantMode');
}
