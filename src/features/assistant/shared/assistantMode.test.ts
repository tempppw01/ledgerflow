import { describe, expect, it } from 'vitest';
import { getAssistantModeLabel } from './assistantMode';

describe('getAssistantModeLabel', () => {
  it('uses an explicit investment assistant label in the workspace', () => {
    const t = ((key: string) => key) as never;
    expect(getAssistantModeLabel('investment', t)).toBe('AI 投资助手');
  });
});
