export const DEFAULT_AI_MODEL = 'deepseek-v4.1-flash';

export const AI_MODEL_PRESETS: string[] = [
  DEFAULT_AI_MODEL,
  'claude-haiku-5-5',
  'gemini-3.8-flash',
  'glm-5.3',
  'grok-4.7',
  'gpt-5.5',
  'gpt-5.4-mini'
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
