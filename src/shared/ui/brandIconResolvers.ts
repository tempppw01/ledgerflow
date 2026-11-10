export type AiProviderKey = 'sh' | 'openai' | 'gemini' | 'deepseek' | 'openrouter' | 'siliconflow';

export type AiModelFamily =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'deepseek'
  | 'glm'
  | 'grok'
  | 'qwen'
  | 'generic';

export type WebSearchServiceKey = 'tavily' | 'brave' | 'serper' | 'exa' | 'google';

/**
 * 把自定义接口地址映射到可识别的服务商,用于展示对应的品牌图标。
 * 未命中时返回 null,由调用方回退到通用图标。
 */
export function resolveAiProviderKey(baseUrl: string | undefined | null): AiProviderKey | null {
  const value = (baseUrl ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('shuaihong.fun')) return 'sh';
  if (value.includes('openai.com')) return 'openai';
  if (value.includes('generativelanguage.googleapis.com') || value.includes('googleapis.com')) {
    return 'gemini';
  }
  if (value.includes('deepseek.com')) return 'deepseek';
  if (value.includes('openrouter.ai')) return 'openrouter';
  if (value.includes('siliconflow')) return 'siliconflow';
  return null;
}

/** 根据模型 id 判断所属模型家族,用于在列表与触发器上显示对应品牌图标。 */
export function resolveAiModelFamily(modelId: string | undefined | null): AiModelFamily {
  const value = (modelId ?? '').trim().toLowerCase();
  if (!value) return 'generic';
  if (value.startsWith('claude') || value.includes('anthropic')) return 'claude';
  if (value.startsWith('gemini') || value.includes('gemma')) return 'gemini';
  if (value.startsWith('deepseek')) return 'deepseek';
  if (value.startsWith('glm') || value.startsWith('chatglm')) return 'glm';
  if (value.startsWith('grok')) return 'grok';
  if (value.startsWith('qwen') || value.startsWith('qwq')) return 'qwen';
  if (
    value.startsWith('gpt') ||
    value.startsWith('o1') ||
    value.startsWith('o3') ||
    value.startsWith('o4') ||
    value.includes('openai')
  ) {
    return 'openai';
  }
  return 'generic';
}
