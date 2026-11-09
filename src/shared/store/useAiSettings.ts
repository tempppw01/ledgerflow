import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ENV } from '../config/env';
import {
  isWebSearchProvider,
  WEB_SEARCH_PROVIDER_DEFINITIONS,
  type WebSearchProvider
} from '../config/webSearchProviders';

const AI_SETTINGS_STORAGE_KEY = 'ledgerflow-ai-settings';
const AI_SETTINGS_API_KEY_SESSION_KEY = 'ledgerflow-ai-settings-api-key';
const AI_SETTINGS_API_KEY_LOCAL_KEY = 'ledgerflow-ai-settings-api-key-persistent';
const AI_SETTINGS_API_KEY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ApiKeySessionPayload {
  value: string;
  expiresAt: number;
}

function readLocalApiKey() {
  try {
    return window.localStorage.getItem(AI_SETTINGS_API_KEY_LOCAL_KEY) || '';
  } catch {
    return '';
  }
}

function writeLocalApiKey(apiKey: string) {
  try {
    if (apiKey) {
      window.localStorage.setItem(AI_SETTINGS_API_KEY_LOCAL_KEY, apiKey);
      return;
    }
    window.localStorage.removeItem(AI_SETTINGS_API_KEY_LOCAL_KEY);
  } catch {
    // ignore storage errors
  }
}

function readSessionApiKey() {
  try {
    const raw = window.sessionStorage.getItem(AI_SETTINGS_API_KEY_SESSION_KEY);
    if (!raw) return '';

    const now = Date.now();
    const parsed = JSON.parse(raw) as Partial<ApiKeySessionPayload>;
    if (
      !parsed ||
      typeof parsed.value !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= now
    ) {
      window.sessionStorage.removeItem(AI_SETTINGS_API_KEY_SESSION_KEY);
      return '';
    }

    window.sessionStorage.setItem(
      AI_SETTINGS_API_KEY_SESSION_KEY,
      JSON.stringify({ value: parsed.value, expiresAt: now + AI_SETTINGS_API_KEY_SESSION_TTL_MS })
    );
    return parsed.value;
  } catch {
    return '';
  }
}

function writeSessionApiKey(apiKey: string) {
  try {
    if (apiKey) {
      window.sessionStorage.setItem(
        AI_SETTINGS_API_KEY_SESSION_KEY,
        JSON.stringify({
          value: apiKey,
          expiresAt: Date.now() + AI_SETTINGS_API_KEY_SESSION_TTL_MS
        })
      );
      return;
    }
    window.sessionStorage.removeItem(AI_SETTINGS_API_KEY_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

type PersistedAiSettingsState = Omit<
  AiSettingsState,
  | 'apiKey'
  | 'setBaseUrl'
  | 'setApiKey'
  | 'setModel'
  | 'setEmbeddingModel'
  | 'setEnableEmbeddingModel'
  | 'setRerankModel'
  | 'setEnableRerankModel'
  | 'setMemoryDays'
  | 'setMemoryBackend'
  | 'setBulkRecategorizeConcurrency'
  | 'setShowEmbeddingDebug'
  | 'setShowEmbeddingSummary'
  | 'setRememberApiKey'
  | 'embedding'
  | 'setEmbedding'
  | 'webSearch'
  | 'setWebSearch'
> & {
  baseUrl: string;
  model: string;
  embeddingModel: string;
  enableEmbeddingModel: boolean;
  rerankModel: string;
  enableRerankModel: boolean;
  memoryDays: number;
  memoryBackend: 'local' | 'redis';
  bulkRecategorizeConcurrency: number;
  showEmbeddingDebug: boolean;
  showEmbeddingSummary: boolean;
  rememberApiKey: boolean;
  embedding: EmbeddingChannelSettings;
  webSearch: WebSearchSettings;
};

export interface EmbeddingChannelSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface WebSearchProviderCredential {
  apiKey: string;
  baseUrl: string;
  engineId: string;
}

export type WebSearchProviderCredentials = Record<
  WebSearchProvider,
  WebSearchProviderCredential
>;

export interface WebSearchSettings {
  provider: WebSearchProvider;
  credentials: WebSearchProviderCredentials;
  localEndpoint: string;
  maxResults: number;
}

export interface WebSearchSettingsPatch {
  provider?: WebSearchProvider;
  localEndpoint?: string;
  maxResults?: number;
  credential?: {
    provider: WebSearchProvider;
    patch: Partial<WebSearchProviderCredential>;
  };
}

interface AiSettingsState {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
  enableEmbeddingModel: boolean;
  rerankModel: string;
  enableRerankModel: boolean;
  memoryDays: number;
  memoryBackend: 'local' | 'redis';
  bulkRecategorizeConcurrency: number;
  showEmbeddingDebug: boolean;
  showEmbeddingSummary: boolean;
  rememberApiKey: boolean;
  embedding: EmbeddingChannelSettings;
  webSearch: WebSearchSettings;
  setBaseUrl: (baseUrl: string) => void;
  setApiKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  setEmbeddingModel: (model: string) => void;
  setEnableEmbeddingModel: (enabled: boolean) => void;
  setRerankModel: (model: string) => void;
  setEnableRerankModel: (enabled: boolean) => void;
  setMemoryDays: (days: number) => void;
  setMemoryBackend: (backend: 'local' | 'redis') => void;
  setBulkRecategorizeConcurrency: (value: number) => void;
  setShowEmbeddingDebug: (enabled: boolean) => void;
  setShowEmbeddingSummary: (enabled: boolean) => void;
  setRememberApiKey: (enabled: boolean) => void;
  setEmbedding: (patch: Partial<EmbeddingChannelSettings>) => void;
  setWebSearch: (patch: WebSearchSettingsPatch) => void;
}

const DEFAULT_BULK_RECATEGORIZE_CONCURRENCY = 8;
const MIN_BULK_RECATEGORIZE_CONCURRENCY = 5;
const MAX_BULK_RECATEGORIZE_CONCURRENCY = 30;

const DEFAULT_EMBEDDING_CHANNEL_SETTINGS: EmbeddingChannelSettings = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: ''
};

function createDefaultWebSearchCredentials(): WebSearchProviderCredentials {
  const credentials = {} as WebSearchProviderCredentials;
  for (const provider of WEB_SEARCH_PROVIDER_DEFINITIONS) {
    credentials[provider.id] = {
      apiKey: '',
      baseUrl: provider.defaultBaseUrl,
      engineId: ''
    };
  }
  credentials.tavily.apiKey = ENV.tavilyApiKey;
  credentials.tavily.baseUrl = ENV.tavilyBaseUrl;
  return credentials;
}

function createDefaultWebSearchSettings(): WebSearchSettings {
  return {
    provider: 'tavily',
    credentials: createDefaultWebSearchCredentials(),
    localEndpoint: ENV.localWebSearchEndpoint,
    maxResults: 5
  };
}

type WebSearchSettingsInput = Partial<WebSearchSettings> & {
  credentials?: Partial<Record<WebSearchProvider, Partial<WebSearchProviderCredential>>>;
  tavilyApiKey?: unknown;
  tavilyBaseUrl?: unknown;
};

function normalizeWebSearchSettings(value: unknown): WebSearchSettings {
  const raw =
    value && typeof value === 'object' ? (value as WebSearchSettingsInput) : {};
  const defaults = createDefaultWebSearchSettings();
  const credentials = {} as WebSearchProviderCredentials;

  for (const provider of WEB_SEARCH_PROVIDER_DEFINITIONS) {
    const incoming = raw.credentials?.[provider.id];
    const fallback = defaults.credentials[provider.id];
    const legacyApiKey =
      provider.id === 'tavily' && typeof raw.tavilyApiKey === 'string'
        ? raw.tavilyApiKey
        : '';
    const legacyBaseUrl =
      provider.id === 'tavily' && typeof raw.tavilyBaseUrl === 'string'
        ? raw.tavilyBaseUrl
        : '';

    credentials[provider.id] = {
      apiKey: String(incoming?.apiKey ?? legacyApiKey ?? fallback.apiKey).trim(),
      baseUrl: String(
        incoming?.baseUrl || legacyBaseUrl || fallback.baseUrl
      ).trim(),
      engineId: String(incoming?.engineId ?? fallback.engineId).trim()
    };
  }

  return {
    provider: isWebSearchProvider(raw.provider) ? raw.provider : 'tavily',
    credentials,
    localEndpoint: String(
      raw.localEndpoint || defaults.localEndpoint || ENV.localWebSearchEndpoint
    ).trim(),
    maxResults: Math.min(
      10,
      Math.max(1, Math.round(Number(raw.maxResults || defaults.maxResults || 5)))
    )
  };
}

function normalizeBulkRecategorizeConcurrency(value: number): number {
  return Math.min(
    MAX_BULK_RECATEGORIZE_CONCURRENCY,
    Math.max(
      MIN_BULK_RECATEGORIZE_CONCURRENCY,
      Math.round(Number.isFinite(value) ? value : DEFAULT_BULK_RECATEGORIZE_CONCURRENCY)
    )
  );
}

/**
 * AI 供应商设置在前端侧持久化：
 * - 满足“无需 Docker 注入”的使用方式
 * - 可在设置页统一维护，助手页直接读取
 */
export const useAiSettings = create<AiSettingsState>()(
  persist(
    (set) => ({
      baseUrl: ENV.aiBaseUrl,
      apiKey: readLocalApiKey() || readSessionApiKey() || ENV.aiApiKey,
      model: ENV.aiDefaultModel,
      embeddingModel: 'jina-embeddings-v3',
      enableEmbeddingModel: true,
      rerankModel: 'bge-reranker-v2-m3',
      enableRerankModel: true,
      memoryDays: 3,
      memoryBackend: 'local',
      bulkRecategorizeConcurrency: DEFAULT_BULK_RECATEGORIZE_CONCURRENCY,
      showEmbeddingDebug: false,
      showEmbeddingSummary: true,
      rememberApiKey: Boolean(readLocalApiKey()),
      embedding: DEFAULT_EMBEDDING_CHANNEL_SETTINGS,
      webSearch: createDefaultWebSearchSettings(),
      setBaseUrl: (baseUrl: string) => set({ baseUrl: baseUrl.trim() }),
      setApiKey: (apiKey: string) =>
        set((state) => {
          const nextApiKey = apiKey.trim();
          if (state.rememberApiKey) {
            writeLocalApiKey(nextApiKey);
            writeSessionApiKey('');
          } else {
            writeSessionApiKey(nextApiKey);
            writeLocalApiKey('');
          }
          return { apiKey: nextApiKey };
        }),
      setModel: (model: string) => set({ model: model.trim() || ENV.aiDefaultModel }),
      setEmbeddingModel: (model: string) => set({ embeddingModel: model.trim() }),
      setEnableEmbeddingModel: (enabled: boolean) => set({ enableEmbeddingModel: enabled }),
      setRerankModel: (model: string) => set({ rerankModel: model.trim() }),
      setEnableRerankModel: (enabled: boolean) => set({ enableRerankModel: enabled }),
      setMemoryDays: (days: number) =>
        set({ memoryDays: Math.min(3, Math.max(1, Math.round(days || 1))) }),
      setMemoryBackend: (backend: 'local' | 'redis') => set({ memoryBackend: backend }),
      setBulkRecategorizeConcurrency: (value: number) =>
        set({ bulkRecategorizeConcurrency: normalizeBulkRecategorizeConcurrency(value) }),
      setShowEmbeddingDebug: (enabled: boolean) => set({ showEmbeddingDebug: enabled }),
      setShowEmbeddingSummary: (enabled: boolean) => set({ showEmbeddingSummary: enabled }),
      setRememberApiKey: (enabled: boolean) =>
        set((state) => {
          const nextApiKey = state.apiKey.trim();
          if (enabled) {
            writeLocalApiKey(nextApiKey);
            writeSessionApiKey('');
          } else {
            writeSessionApiKey(nextApiKey);
            writeLocalApiKey('');
          }
          return { rememberApiKey: enabled };
        }),
      setEmbedding: (patch: Partial<EmbeddingChannelSettings>) =>
        set((state) => ({
          embedding: {
            ...state.embedding,
            ...patch,
            enabled: typeof patch.enabled === 'boolean' ? patch.enabled : state.embedding.enabled,
            baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl.trim() : state.embedding.baseUrl,
            apiKey: typeof patch.apiKey === 'string' ? patch.apiKey.trim() : state.embedding.apiKey,
            model: typeof patch.model === 'string' ? patch.model.trim() : state.embedding.model
          }
        })),
      setWebSearch: (patch: WebSearchSettingsPatch) =>
        set((state) => {
          const credentials = patch.credential
            ? {
                ...state.webSearch.credentials,
                [patch.credential.provider]: {
                  ...state.webSearch.credentials[patch.credential.provider],
                  ...patch.credential.patch
                }
              }
            : state.webSearch.credentials;

          return {
            webSearch: normalizeWebSearchSettings({
              ...state.webSearch,
              provider: patch.provider ?? state.webSearch.provider,
              credentials,
              localEndpoint: patch.localEndpoint ?? state.webSearch.localEndpoint,
              maxResults: patch.maxResults ?? state.webSearch.maxResults
            })
          };
        })
    }),
    {
      name: AI_SETTINGS_STORAGE_KEY,
      partialize: (state: AiSettingsState): PersistedAiSettingsState => ({
        baseUrl: state.baseUrl,
        model: state.model,
        embeddingModel: state.embeddingModel,
        enableEmbeddingModel: state.enableEmbeddingModel,
        rerankModel: state.rerankModel,
        enableRerankModel: state.enableRerankModel,
        memoryDays: state.memoryDays,
        memoryBackend: state.memoryBackend,
        bulkRecategorizeConcurrency: state.bulkRecategorizeConcurrency,
        showEmbeddingDebug: state.showEmbeddingDebug,
        showEmbeddingSummary: state.showEmbeddingSummary,
        rememberApiKey: state.rememberApiKey,
        embedding: state.embedding,
        webSearch: state.webSearch
      }),
      merge: (persisted: unknown, current: AiSettingsState) => {
        const next = { ...current, ...(persisted as Partial<PersistedAiSettingsState>) };
        next.rememberApiKey = Boolean(next.rememberApiKey);
        next.apiKey = next.rememberApiKey
          ? readLocalApiKey() || readSessionApiKey() || ENV.aiApiKey
          : readSessionApiKey() || readLocalApiKey() || ENV.aiApiKey;
        if (!next.model?.trim()) {
          next.model = ENV.aiDefaultModel;
        }
        if (!next.embeddingModel?.trim()) {
          next.embeddingModel = 'jina-embeddings-v3';
        }
        if (typeof next.enableEmbeddingModel !== 'boolean') {
          next.enableEmbeddingModel = true;
        }
        if (!next.rerankModel?.trim()) {
          next.rerankModel = 'bge-reranker-v2-m3';
        }
        if (typeof next.enableRerankModel !== 'boolean') {
          next.enableRerankModel = true;
        }
        next.bulkRecategorizeConcurrency = normalizeBulkRecategorizeConcurrency(
          next.bulkRecategorizeConcurrency
        );
        if (typeof next.showEmbeddingDebug !== 'boolean') {
          next.showEmbeddingDebug = false;
        }
        if (typeof next.showEmbeddingSummary !== 'boolean') {
          next.showEmbeddingSummary = true;
        }

        const embedding = (next as Partial<PersistedAiSettingsState>).embedding;
        next.embedding = {
          ...DEFAULT_EMBEDDING_CHANNEL_SETTINGS,
          ...(embedding && typeof embedding === 'object' ? embedding : {})
        };
        next.embedding.enabled = Boolean(next.embedding.enabled);
        next.embedding.baseUrl = String(next.embedding.baseUrl || '').trim();
        next.embedding.apiKey = String(next.embedding.apiKey || '').trim();
        next.embedding.model = String(next.embedding.model || '').trim();

        next.webSearch = normalizeWebSearchSettings(
          (next as Partial<PersistedAiSettingsState>).webSearch
        );

        return next;
      }
    }
  )
);
