export const WEB_SEARCH_PROVIDER_IDS = ['tavily', 'brave', 'serper', 'exa', 'google'] as const;

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDER_IDS)[number];

export interface WebSearchProviderDefinition {
  id: WebSearchProvider;
  name: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  signupUrl: string;
  docsUrl: string;
  engineSignupUrl?: string;
  requiresEngineId?: boolean;
}

export const WEB_SEARCH_PROVIDER_DEFINITIONS: WebSearchProviderDefinition[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    defaultBaseUrl: 'https://api.tavily.com',
    keyPlaceholder: 'tvly-...',
    signupUrl: 'https://app.tavily.com/home',
    docsUrl: 'https://docs.tavily.com/documentation/api-reference/endpoint/search'
  },
  {
    id: 'brave',
    name: 'Brave Search',
    defaultBaseUrl: 'https://api.search.brave.com',
    keyPlaceholder: 'BSA...',
    signupUrl: 'https://api-dashboard.search.brave.com/register',
    docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started'
  },
  {
    id: 'serper',
    name: 'Serper',
    defaultBaseUrl: 'https://google.serper.dev',
    keyPlaceholder: 'Serper API key',
    signupUrl: 'https://serper.dev/dashboard',
    docsUrl: 'https://serper.dev/playground'
  },
  {
    id: 'exa',
    name: 'Exa',
    defaultBaseUrl: 'https://api.exa.ai',
    keyPlaceholder: 'exa-...',
    signupUrl: 'https://dashboard.exa.ai/api-keys',
    docsUrl: 'https://docs.exa.ai/reference/search'
  },
  {
    id: 'google',
    name: 'Google CSE',
    defaultBaseUrl: 'https://www.googleapis.com',
    keyPlaceholder: 'Google API key',
    signupUrl: 'https://console.cloud.google.com/apis/credentials',
    docsUrl: 'https://developers.google.com/custom-search/v1/overview',
    engineSignupUrl: 'https://programmablesearchengine.google.com/controlpanel/create',
    requiresEngineId: true
  }
];

export const WEB_SEARCH_PROVIDER_MAP = Object.fromEntries(
  WEB_SEARCH_PROVIDER_DEFINITIONS.map((provider) => [provider.id, provider])
) as Record<WebSearchProvider, WebSearchProviderDefinition>;

export function isWebSearchProvider(value: unknown): value is WebSearchProvider {
  return (
    typeof value === 'string' &&
    (WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

export function getWebSearchProviderDefinition(
  provider: WebSearchProvider
): WebSearchProviderDefinition {
  return WEB_SEARCH_PROVIDER_MAP[provider];
}
