import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_PRESETS,
  DEFAULT_AI_MODEL,
  getAiModelDisplayLabel,
  mergeAiModelOptions
} from './aiModels';

describe('AI_MODEL_PRESETS', () => {
  it('不再包含已经过时的模型', () => {
    const legacyModels = [
      'gpt-3.5-turbo',
      'gpt-4-turbo',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-5.2',
      'gemini-1.5-pro',
      'gemini-2.0-flash',
      'gemini-2.5-flash-lite',
      'claude-3-5-sonnet-20241022',
      'claude-sonnet-4-20250514',
      'qwen-turbo',
      'qwen-plus',
      'deepseek-chat',
      'deepseek-reasoner',
      'glm-4-flash'
    ];

    legacyModels.forEach((modelId) => {
      expect(AI_MODEL_PRESETS).not.toContain(modelId);
    });
  });

  it('默认模型排在第一位并带推荐标记', () => {
    expect(AI_MODEL_PRESETS[0]).toBe(DEFAULT_AI_MODEL);
    expect(getAiModelDisplayLabel(DEFAULT_AI_MODEL)).toBe(`${DEFAULT_AI_MODEL}(推荐)`);
  });

  it('合并模型列表时保留当前值并去重', () => {
    expect(mergeAiModelOptions('current-model', ['a', 'b'], ['b', 'c'])).toEqual([
      'current-model',
      'b',
      'c',
      'a'
    ]);
  });
});
