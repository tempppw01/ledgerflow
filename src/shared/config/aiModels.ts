export const DEFAULT_AI_MODEL = 'gpt-6-luna';

export const AI_MODEL_PRESETS: string[] = [
  DEFAULT_AI_MODEL,
  'claude-haiku-5-5',
  'gemini-3.8-flash',
  'glm-5.3',
  'grok-4.7',
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.2',
  'gemini-2.5-flash-lite',
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'deepseek-chat',
  'deepseek-reasoner',
  'qwen-turbo',
  'qwen-plus',
  'glm-4-flash'
];

export function mergeAiModelOptions(
  value: string,
  presets: readonly string[],
  remoteModels: readonly string[] = []
): string[] {
  const seen = new Set<string>();
  return [value, ...remoteModels, ...presets]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function getAiModelDisplayLabel(modelId: string): string {
  const value = modelId.trim();
  if (value === DEFAULT_AI_MODEL) return `${value}(推荐)`;
  return value;
}
