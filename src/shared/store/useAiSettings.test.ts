import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiSettings } from './useAiSettings';

const AI_SETTINGS_KEY = 'ledgerflow-ai-settings';
const AI_SETTINGS_API_KEY_SESSION_KEY = 'ledgerflow-ai-settings-api-key';
const AI_SETTINGS_API_KEY_LOCAL_KEY = 'ledgerflow-ai-settings-api-key-persistent';
const AI_SETTINGS_CHILD_SECRETS_SESSION_KEY = 'ledgerflow-ai-settings-child-secrets';

describe('useAiSettings', () => {
  beforeEach(() => {
    localStorage.removeItem(AI_SETTINGS_KEY);
    sessionStorage.removeItem(AI_SETTINGS_API_KEY_SESSION_KEY);
    sessionStorage.removeItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY);
    localStorage.removeItem(AI_SETTINGS_API_KEY_LOCAL_KEY);
    useAiSettings.setState({
      baseUrl: 'https://ai.shuaihong.fun/v1',
      apiKey: '',
      model: 'gemini-2.5-flash-lite',
      embeddingModel: 'jina-embeddings-v3',
      enableEmbeddingModel: true,
      rerankModel: 'bge-reranker-v2-m3',
      enableRerankModel: true,
      memoryDays: 3,
      memoryBackend: 'local',
      bulkRecategorizeConcurrency: 8,
      showEmbeddingDebug: false,
      showEmbeddingSummary: true,
      rememberApiKey: false,
      embedding: {
        enabled: false,
        baseUrl: '',
        apiKey: '',
        model: ''
      },
      webSearch: {
        provider: 'tavily',
        credentials: {
          tavily: { apiKey: '', baseUrl: 'https://api.tavily.com', engineId: '' },
          brave: { apiKey: '', baseUrl: 'https://api.search.brave.com', engineId: '' },
          serper: { apiKey: '', baseUrl: 'https://google.serper.dev', engineId: '' },
          exa: { apiKey: '', baseUrl: 'https://api.exa.ai', engineId: '' },
          google: { apiKey: '', baseUrl: 'https://www.googleapis.com', engineId: '' }
        },
        localEndpoint: '',
        maxResults: 5
      }
    });
  });

  it('limits bulk recategorization concurrency into supported range', () => {
    useAiSettings.getState().setBulkRecategorizeConcurrency(0);
    expect(useAiSettings.getState().bulkRecategorizeConcurrency).toBe(5);

    useAiSettings.getState().setBulkRecategorizeConcurrency(50);
    expect(useAiSettings.getState().bulkRecategorizeConcurrency).toBe(30);
  });

  it('stores API Key in sessionStorage instead of localStorage', () => {
    useAiSettings.getState().setApiKey('  sk-test-session  ');

    const raw = sessionStorage.getItem(AI_SETTINGS_API_KEY_SESSION_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(String(raw)) as { value: string; expiresAt: number };
    expect(parsed.value).toBe('sk-test-session');
    expect(parsed.expiresAt).toBeGreaterThan(Date.now());

    const persisted = localStorage.getItem(AI_SETTINGS_KEY) || '';
    expect(persisted).not.toContain('sk-test-session');
  });

  it('clears session API Key when setApiKey receives empty string', () => {
    useAiSettings.getState().setApiKey('sk-temp');
    const raw = sessionStorage.getItem(AI_SETTINGS_API_KEY_SESSION_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(String(raw)) as { value: string; expiresAt: number };
    expect(parsed.value).toBe('sk-temp');

    useAiSettings.getState().setApiKey('   ');
    expect(sessionStorage.getItem(AI_SETTINGS_API_KEY_SESSION_KEY)).toBeNull();
  });
  it('expires session API Key after ttl', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    useAiSettings.getState().setApiKey('sk-expiring');

    nowSpy.mockReturnValue(1000 + 8 * 24 * 60 * 60 * 1000);
    await useAiSettings.persist.rehydrate();

    expect(useAiSettings.getState().apiKey).toBe('');
    expect(sessionStorage.getItem(AI_SETTINGS_API_KEY_SESSION_KEY)).toBeNull();
    nowSpy.mockRestore();
  });

  it('keeps child credentials out of localStorage and in sessionStorage when remember is disabled', () => {
    useAiSettings.getState().setEmbedding({ apiKey: '  embed-session-key  ' });
    useAiSettings.getState().setWebSearch({
      credential: { provider: 'exa', patch: { apiKey: '  exa-session-key  ' } }
    });

    const persisted = localStorage.getItem(AI_SETTINGS_KEY) || '';
    expect(persisted).not.toContain('embed-session-key');
    expect(persisted).not.toContain('exa-session-key');

    const sessionRaw = sessionStorage.getItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY);
    expect(sessionRaw).toContain('embed-session-key');
    expect(sessionRaw).toContain('exa-session-key');
  });

  it('persists child credentials only while remember is enabled', () => {
    useAiSettings.getState().setRememberApiKey(true);
    useAiSettings.getState().setEmbedding({ apiKey: 'embed-persist-key' });
    useAiSettings.getState().setWebSearch({
      credential: { provider: 'brave', patch: { apiKey: 'brave-persist-key' } }
    });

    expect(localStorage.getItem(AI_SETTINGS_KEY)).toContain('embed-persist-key');
    expect(localStorage.getItem(AI_SETTINGS_KEY)).toContain('brave-persist-key');
    expect(sessionStorage.getItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY)).toBeNull();

    useAiSettings.getState().setRememberApiKey(false);

    const persisted = localStorage.getItem(AI_SETTINGS_KEY) || '';
    expect(persisted).not.toContain('embed-persist-key');
    expect(persisted).not.toContain('brave-persist-key');
    const sessionRaw = sessionStorage.getItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY);
    expect(sessionRaw).toContain('embed-persist-key');
    expect(sessionRaw).toContain('brave-persist-key');
  });

  it('restores child credentials from sessionStorage without writing them back to localStorage', async () => {
    useAiSettings.getState().setEmbedding({ apiKey: 'embed-rehydrate-key' });
    useAiSettings.getState().setWebSearch({
      credential: { provider: 'google', patch: { apiKey: 'google-rehydrate-key' } }
    });

    await useAiSettings.persist.rehydrate();

    expect(useAiSettings.getState().embedding.apiKey).toBe('embed-rehydrate-key');
    expect(useAiSettings.getState().webSearch.credentials.google.apiKey).toBe(
      'google-rehydrate-key'
    );
    const persisted = localStorage.getItem(AI_SETTINGS_KEY) || '';
    expect(persisted).not.toContain('embed-rehydrate-key');
    expect(persisted).not.toContain('google-rehydrate-key');
  });

  it('switches web search provider and stores per-provider credentials', () => {
    useAiSettings.getState().setWebSearch({
      provider: 'exa',
      credential: { provider: 'exa', patch: { apiKey: '  exa-key  ' } }
    });

    const { webSearch } = useAiSettings.getState();
    expect(webSearch.provider).toBe('exa');
    expect(webSearch.credentials.exa.apiKey).toBe('exa-key');
    expect(webSearch.credentials.tavily.baseUrl).toBe('https://api.tavily.com');
    expect(webSearch.credentials.brave.baseUrl).toBe('https://api.search.brave.com');

    useAiSettings.getState().setWebSearch({
      provider: 'google',
      credential: { provider: 'google', patch: { apiKey: 'g-key', engineId: 'cx-1' } }
    });
    const google = useAiSettings.getState().webSearch.credentials.google;
    expect(google.apiKey).toBe('g-key');
    expect(google.engineId).toBe('cx-1');
    // 切换服务不会丢失其它服务的密钥
    expect(useAiSettings.getState().webSearch.credentials.exa.apiKey).toBe('exa-key');
  });

  it('migrates legacy flat Tavily settings into provider credentials', async () => {
    localStorage.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify({
        state: {
          webSearch: {
            provider: 'tavily',
            tavilyApiKey: 'tvly-legacy',
            tavilyBaseUrl: 'https://proxy.example.com',
            localEndpoint: '/api/search',
            maxResults: 7
          }
        },
        version: 0
      })
    );

    await useAiSettings.persist.rehydrate();

    const { webSearch } = useAiSettings.getState();
    expect(webSearch.credentials.tavily.apiKey).toBe('tvly-legacy');
    expect(webSearch.credentials.tavily.baseUrl).toBe('https://proxy.example.com');
    expect(webSearch.credentials.exa.baseUrl).toBe('https://api.exa.ai');
    expect(webSearch.localEndpoint).toBe('/api/search');
    expect(webSearch.maxResults).toBe(7);
    expect(localStorage.getItem(AI_SETTINGS_KEY)).not.toContain('tvly-legacy');
    expect(sessionStorage.getItem(AI_SETTINGS_CHILD_SECRETS_SESSION_KEY)).toContain('tvly-legacy');
    localStorage.removeItem(AI_SETTINGS_KEY);
  });
});

it('stores API Key in localStorage when rememberApiKey is enabled', () => {
  useAiSettings.getState().setRememberApiKey(true);
  useAiSettings.getState().setApiKey('sk-test-persist');

  expect(localStorage.getItem(AI_SETTINGS_API_KEY_LOCAL_KEY)).toBe('sk-test-persist');
  expect(sessionStorage.getItem(AI_SETTINGS_API_KEY_SESSION_KEY)).toBeNull();
});

it('moves stored API Key back to sessionStorage when rememberApiKey is disabled', () => {
  useAiSettings.getState().setRememberApiKey(true);
  useAiSettings.getState().setApiKey('sk-move-back');
  useAiSettings.getState().setRememberApiKey(false);

  expect(localStorage.getItem(AI_SETTINGS_API_KEY_LOCAL_KEY)).toBeNull();
  const raw = sessionStorage.getItem(AI_SETTINGS_API_KEY_SESSION_KEY);
  expect(raw).toBeTruthy();
  const parsed = JSON.parse(String(raw)) as { value: string; expiresAt: number };
  expect(parsed.value).toBe('sk-move-back');
});
