import { ENV } from '../../../shared/config/env';

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

function normalizeBaseUrl(baseUrl?: string) {
  const raw = (baseUrl || ENV.aiBaseUrl).trim();
  if (!raw) throw new Error('AI 服务地址不能为空');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('AI 服务地址格式无效，请使用完整 URL（如 https://api.example.com/v1）');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('AI 服务地址仅支持 HTTP/HTTPS 协议');
  }

  return parsed.toString().replace(/\/$/, '');
}

function buildHeaders(apiKey?: string) {
  const token = apiKey || ENV.aiApiKey;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

export async function fetchEmbeddings(input: {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  inputs: string[];
  signal?: AbortSignal;
}): Promise<number[][]> {
  const response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/embeddings`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey),
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      input: input.inputs
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`嵌入请求失败（HTTP ${response.status}）${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const vectors = (payload.data || []).map((item) => item.embedding || []);
  return vectors;
}
