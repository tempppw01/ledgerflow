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
const AI_SETTINGS_CHILD_SECRETS_SESSION_KEY = 'ledgerflow-ai-settings-child-secrets';
const AI_SETTINGS_API_KEY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ApiKeySessionPayload {
  value: string;
  expiresAt: number;
}

interface AiSettingsChildSecrets {
  embeddingApiKey: string;
  webSearchApiKeys: Partial<Record<WebSearchProvider, string>>;
}

interface AiSettingsChildSecretsSessionPayload extends AiSettingsChildSecrets {
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

export type WebSearchProviderCredentials = Record<WebSearchProvider, WebSearchProviderCredential>;

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

function normalizeChildSecrets(value: unknown): AiSettingsChildSecrets {
  const raw = value && typeof value === 'object' ? (value as Partial<AiSettingsChildSecrets>) : {};
  const webSearchApiKeys: Partial<Record<WebSearchProvider, string>> = {};
  for (const provider of WEB_SEARCH_PROVIDER_DEFINITIONS) {
    const apiKey = raw.webSearchApiKeys?.[provider.id];
    if (typeof apiKey === 'string' && apiKey.trim()) {
      webSearchApiKeys[provider.id] = apiKey.trim();
    }
  }
  return {
    embeddingApiKey: typeof raw.embeddingApiKey === 'string' ? raw.embeddingApiKey.trim() : '',
    webSearchApiKeys
  };
}

function writeSessionChildSecrets(secrets: AiSettingsChildSecrets) {
  const normalized = normalizeChildSecrets(secrets);
  try {
    if (!normalized.embeddingApiKey && Object.keys(normalized.webSearchApiKeys).length === 0) {
      window.sessionStorage.removeItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY);
      return;
    }
    window.sessionStorage.setItem(
      AI_SETTINGS_CHILD_SECRETS_SESSION_KEY,
      JSON.stringify({
        ...normalized,
        expiresAt: Date.now() + AI_SETTINGS_API_KEY_SESSION_TTL_MS
      })
    );
  } catch {
    // ignore storage errors
  }
}

function readSessionChildSecrets(): AiSettingsChildSecrets {
  try {
    const raw = window.sessionStorage.getItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY);
    if (!raw) return normalizeChildSecrets(null);

    const now = Date.now();
    const parsed = JSON.parse(raw) as Partial<AiSettingsChildSecretsSessionPayload>;
    if (typeof parsed?.expiresAt !== 'number' || parsed.expiresAt <= now) {
      window.sessionStorage.removeItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY);
      return normalizeChildSecrets(null);
    }

    const secrets = normalizeChildSecrets(parsed);
    writeSessionChildSecrets(secrets);
    return secrets;
  } catch {
    return normalizeChildSecrets(null);
  }
}

function clearSessionChildSecrets() {
  try {
    window.sessionStorage.removeItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

function collectChildSecrets(
  embedding: EmbeddingChannelSettings,
  webSearch: WebSearchSettings
): AiSettingsChildSecrets {
  const webSearchApiKeys: Partial<Record<WebSearchProvider, string>> = {};
  for (const provider of WEB_SEARCH_PROVIDER_DEFINITIONS) {
    const apiKey = webSearch.credentials[provider.id]?.apiKey;
    if (apiKey.trim()) webSearchApiKeys[provider.id] = apiKey.trim();
  }
  return normalizeChildSecrets({ embeddingApiKey: embedding.apiKey, webSearchApiKeys });
}

function applySessionChildSecrets(
  embedding: EmbeddingChannelSettings,
  webSearch: WebSearchSettings,
  secrets: AiSettingsChildSecrets
): { embedding: EmbeddingChannelSettings; webSearch: WebSearchSettings } {
  const credentials = { ...webSearch.credentials };
  for (const provider of WEB_SEARCH_PROVIDER_DEFINITIONS) {
    const apiKey = secrets.webSearchApiKeys[provider.id];
    if (apiKey) {
      credentials[provider.id] = { ...credentials[provider.id], apiKey };
    }
  }
  return {
    embedding: { ...embedding, apiKey: secrets.embeddingApiKey || embedding.apiKey },
    webSearch: { ...webSearch, credentials }
  };
}

function movePersistedChildSecretsToSession(value: unknown) {
  const persisted =
    value && typeof value === 'object'
      ? (value as {
          embedding?: { apiKey?: unknown };
          webSearch?: {
            credentials?: Partial<Record<WebSearchProvider, { apiKey?: unknown }>>;
            tavilyApiKey?: unknown;
          };
        })
      : {};
  const existing = readSessionChildSecrets();
  const webSearchApiKeys = { ...existing.webSearchApiKeys };
  for (const provider of WEB_SEARCH_PROVIDER_DEFINITIONS) {
    const apiKey = persisted.webSearch?.credentials?.[provider.id]?.apiKey;
    if (typeof apiKey === 'string' && apiKey.trim()) {
      webSearchApiKeys[provider.id] = apiKey.trim();
    }
  }
  if (typeof persisted.webSearch?.tavilyApiKey === 'string') {
    const legacyTavilyApiKey = persisted.webSearch.tavilyApiKey.trim();
    if (legacyTavilyApiKey) webSearchApiKeys.tavily = legacyTavilyApiKey;
  }
  writeSessionChildSecrets({
    embeddingApiKey:
      typeof persisted.embedding?.apiKey === 'string' && persisted.embedding.apiKey.trim()
        ? persisted.embedding.apiKey.trim()
        : existing.embeddingApiKey,
    webSearchApiKeys
  });
}

function redactPersistedChildSecrets(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const persisted = value as Record<string, unknown>;
  const embedding =
    persisted.embedding && typeof persisted.embedding === 'object'
      ? (persisted.embedding as Record<string, unknown>)
      : null;
  const webSearch =
    persisted.webSearch && typeof persisted.webSearch === 'object'
      ? (persisted.webSearch as Record<string, unknown>)
      : null;
  const credentials =
    webSearch?.credentials && typeof webSearch.credentials === 'object'
      ? (webSearch.credentials as Record<string, unknown>)
      : null;

  return {
    ...persisted,
    ...(embedding ? { embedding: { ...embedding, apiKey: '' } } : {}),
    ...(webSearch
      ? {
          webSearch: {
            ...webSearch,
            tavilyApiKey: '',
            ...(credentials
              ? {
                  credentials: Object.fromEntries(
                    Object.entries(credentials).map(([provider, credential]) => [
                      provider,
                      credential && typeof credential === 'object'
                        ? { ...(credential as Record<string, unknown>), apiKey: '' }
                        : credential
                    ])
                  )
                }
              : {})
          }
        }
      : {})
  };
}

type WebSearchSettingsInput = Partial<WebSearchSettings> & {
  credentials?: Partial<Record<WebSearchProvider, Partial<WebSearchProviderCredential>>>;
  tavilyApiKey?: unknown;
  tavilyBaseUrl?: unknown;
};

function normalizeWebSearchSettings(value: unknown): WebSearchSettings {
  const raw = value && typeof value === 'object' ? (value as WebSearchSettingsInput) : {};
  const defaults = createDefaultWebSearchSettings();
  const credentials = {} as WebSearchProviderCredentials;

  for (const provider of WEB_SEARCH_PROVIDER_DEFINITIONS) {
    const incoming = raw.credentials?.[provider.id];
    const fallback = defaults.credentials[provider.id];
    const legacyApiKey =
      provider.id === 'tavily' && typeof raw.tavilyApiKey === 'string' ? raw.tavilyApiKey : '';
    const legacyBaseUrl =
      provider.id === 'tavily' && typeof raw.tavilyBaseUrl === 'string' ? raw.tavilyBaseUrl : '';

    credentials[provider.id] = {
      apiKey: String(incoming?.apiKey ?? legacyApiKey ?? fallback.apiKey).trim(),
      baseUrl: String(incoming?.baseUrl || legacyBaseUrl || fallback.baseUrl).trim(),
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
const initialRememberApiKey = Boolean(readLocalApiKey());
const initialSessionChildSecrets = initialRememberApiKey
  ? normalizeChildSecrets(null)
  : readSessionChildSecrets();
const initialEmbeddingSettings: EmbeddingChannelSettings = {
  ...DEFAULT_EMBEDDING_CHANNEL_SETTINGS,
  apiKey: initialSessionChildSecrets.embeddingApiKey
};
const initialWebSearchSettings = (() => {
  const defaults = createDefaultWebSearchSettings();
  if (initialRememberApiKey) return defaults;
  return applySessionChildSecrets(initialEmbeddingSettings, defaults, initialSessionChildSecrets)
    .webSearch;
})();

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
      rememberApiKey: initialRememberApiKey,
      embedding: initialEmbeddingSettings,
      webSearch: initialWebSearchSettings,
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
            clearSessionChildSecrets();
          } else {
            writeSessionApiKey(nextApiKey);
            writeLocalApiKey('');
            writeSessionChildSecrets(collectChildSecrets(state.embedding, state.webSearch));
          }
          return { rememberApiKey: enabled };
        }),
      setEmbedding: (patch: Partial<EmbeddingChannelSettings>) =>
        set((state) => {
          const embedding = {
            ...state.embedding,
            ...patch,
            enabled: typeof patch.enabled === 'boolean' ? patch.enabled : state.embedding.enabled,
            baseUrl:
              typeof patch.baseUrl === 'string' ? patch.baseUrl.trim() : state.embedding.baseUrl,
            apiKey: typeof patch.apiKey === 'string' ? patch.apiKey.trim() : state.embedding.apiKey,
            model: typeof patch.model === 'string' ? patch.model.trim() : state.embedding.model
          };
          if (!state.rememberApiKey) {
            writeSessionChildSecrets(collectChildSecrets(embedding, state.webSearch));
          }
          return { embedding };
        }),
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

          const webSearch = normalizeWebSearchSettings({
            ...state.webSearch,
            provider: patch.provider ?? state.webSearch.provider,
            credentials,
            localEndpoint: patch.localEndpoint ?? state.webSearch.localEndpoint,
            maxResults: patch.maxResults ?? state.webSearch.maxResults
          });
          if (!state.rememberApiKey) {
            writeSessionChildSecrets(collectChildSecrets(state.embedding, webSearch));
          }
          return { webSearch };
        })
    }),
    {
      name: AI_SETTINGS_STORAGE_KEY,
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        const persisted = persistedState as { rememberApiKey?: unknown } | null;
        if (version < 1 && !persisted?.rememberApiKey) {
          movePersistedChildSecretsToSession(persistedState);
          return redactPersistedChildSecrets(persistedState);
        }
        return persistedState;
      },
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
        embedding: {
          ...state.embedding,
          apiKey: state.rememberApiKey ? state.embedding.apiKey : ''
        },
        webSearch: {
          ...state.webSearch,
          credentials: Object.fromEntries(
            WEB_SEARCH_PROVIDER_DEFINITIONS.map((provider) => [
              provider.id,
              {
                ...state.webSearch.credentials[provider.id],
                apiKey: state.rememberApiKey ? state.webSearch.credentials[provider.id].apiKey : ''
              }
            ])
          ) as WebSearchProviderCredentials
        }
      }),
      merge: (persisted: unknown, current: AiSettingsState) => {
        const persistedState = persisted as Partial<PersistedAiSettingsState>;
        if (!persistedState.rememberApiKey) {
          movePersistedChildSecretsToSession(persistedState);
        }
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
        if (next.rememberApiKey) {
          clearSessionChildSecrets();
        } else {
          const childSettings = applySessionChildSecrets(
            next.embedding,
            next.webSearch,
            readSessionChildSecrets()
          );
          next.embedding = childSettings.embedding;
          next.webSearch = childSettings.webSearch;
        }

        return next;
      }
    }
  )
);
