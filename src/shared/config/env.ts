const DEFAULT_API_BASE_URL = '/api';

function normalizeApiBaseUrl(url: string) {
  if (!url) return DEFAULT_API_BASE_URL;
  const normalized = url.endsWith('/') ? url.slice(0, -1) : url;
  return normalized || DEFAULT_API_BASE_URL;
}

const resolvedApiBaseUrl = normalizeApiBaseUrl(DEFAULT_API_BASE_URL);

export const ENV = {
  /**
   * Web 同域代理模式：固定走 /api，不依赖前端填写或环境变量中的后端地址。
   */
  apiBaseUrl: resolvedApiBaseUrl,
  requestTimeoutMs: Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 8000),
  logLevel: import.meta.env.VITE_LOG_LEVEL || 'info',
  aiBaseUrl: import.meta.env.VITE_AI_BASE_URL || 'https://ai.shuaihong.fun/v1',
  aiApiKey: import.meta.env.VITE_AI_API_KEY || '',
  aiDefaultModel: import.meta.env.VITE_AI_DEFAULT_MODEL || 'gpt-5.4-mini',
  tavilyApiKey: import.meta.env.VITE_TAVILY_API_KEY || '',
  tavilyBaseUrl: import.meta.env.VITE_TAVILY_BASE_URL || 'https://api.tavily.com',
  localWebSearchEndpoint: import.meta.env.VITE_LOCAL_WEB_SEARCH_ENDPOINT || '/api/web-search',
  /** 手动全量同步路径（会拼接到 apiBaseUrl 后） */
  syncLocalDataPath: import.meta.env.VITE_SYNC_LOCAL_DATA_PATH || '/sync-local-data',
  /** 自动增量同步路径（会拼接到 apiBaseUrl 后） */
  syncChangePath: import.meta.env.VITE_SYNC_CHANGE_PATH || '/sync-change',
  /** 汇率 API 基础地址，默认 frankfurter.dev/v1（frankfurter.app 已迁移） */
  exchangeApiBase: import.meta.env.VITE_EXCHANGE_API_BASE || 'https://api.frankfurter.dev/v1',
  /** 汇率 API 超时时间（ms） */
  exchangeApiTimeoutMs: Number(import.meta.env.VITE_EXCHANGE_API_TIMEOUT_MS || 10000)
};
