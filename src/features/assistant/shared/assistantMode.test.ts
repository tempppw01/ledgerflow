import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASSISTANT_ACTIVE_MODE_STORAGE_KEY,
  getAssistantModeLabel,
  getAssistantModeSpark,
  isAssistantMode,
  readAssistantModeFromSessionStorage
} from './assistantMode';

describe('getAssistantModeLabel', () => {
  it('resolves the investment label through the translation function', () => {
    const t = ((key: string) => key) as never;
    expect(getAssistantModeLabel('investment', t)).toBe('assistant.ui.investmentMode');
  });
});

describe('assistant mode union', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('只保留合并后的三个模式', () => {
    expect(isAssistantMode('assistant')).toBe(true);
    expect(isAssistantMode('credit')).toBe(true);
    expect(isAssistantMode('investment')).toBe(true);
    expect(isAssistantMode('bookkeeping')).toBe(false);
    expect(getAssistantModeSpark('assistant')).toBe('✦');
  });

  it('旧版 bookkeeping 模式读取时迁移为合并后的 assistant', () => {
    window.sessionStorage.setItem(ASSISTANT_ACTIVE_MODE_STORAGE_KEY, 'bookkeeping');
    expect(readAssistantModeFromSessionStorage()).toBe('assistant');
  });

  it('非法或缺失的模式值回退到 assistant', () => {
    window.sessionStorage.setItem(ASSISTANT_ACTIVE_MODE_STORAGE_KEY, 'unknown-mode');
    expect(readAssistantModeFromSessionStorage()).toBe('assistant');
    window.sessionStorage.clear();
    expect(readAssistantModeFromSessionStorage()).toBe('assistant');
  });
});
