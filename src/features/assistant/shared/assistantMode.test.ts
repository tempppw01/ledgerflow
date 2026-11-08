import { describe, expect, it } from 'vitest';
import { getAssistantModeLabel } from './assistantMode';

describe('getAssistantModeLabel', () => {
  it('resolves the investment label through the translation function', () => {
    const t = ((key: string) => key) as never;
    expect(getAssistantModeLabel('investment', t)).toBe('assistant.ui.investmentMode');
  });
});
