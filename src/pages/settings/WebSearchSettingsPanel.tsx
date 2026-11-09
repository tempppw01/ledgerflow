import { useTranslation } from 'react-i18next';
import {
  WEB_SEARCH_PROVIDER_DEFINITIONS,
  getWebSearchProviderDefinition,
  type WebSearchProvider
} from '../../shared/config/webSearchProviders';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { PasswordInput } from '../../shared/ui/PasswordInput';

interface WebSearchSettingsPanelProps {
  onSaved?: () => void;
}

const PROVIDER_MONOGRAMS: Record<WebSearchProvider, string> = {
  tavily: 'T',
  brave: 'B',
  serper: 'S',
  exa: 'E',
  google: 'G'
};

export function WebSearchSettingsPanel({ onSaved }: WebSearchSettingsPanelProps) {
  const { t } = useTranslation();
  const webSearch = useAiSettings((state) => state.webSearch);
  const setWebSearch = useAiSettings((state) => state.setWebSearch);

  const activeProvider = webSearch.provider;
  const definition = getWebSearchProviderDefinition(activeProvider);
  const credential = webSearch.credentials[activeProvider];
  const isConfigured =
    Boolean(credential?.apiKey.trim()) &&
    (!definition.requiresEngineId || Boolean(credential?.engineId.trim()));

  const updateCredential = (patch: {
    apiKey?: string;
    baseUrl?: string;
    engineId?: string;
  }) => {
    setWebSearch({ credential: { provider: activeProvider, patch } });
    onSaved?.();
  };

  return (
    <div className="settings-subpanel settings-subpanel--tavily is-active">
      <div className="settings-subpanel-toggle">
        <div className="settings-subpanel-copy">
          <strong>{t('settings.tavily.title')}</strong>
          <small>{t('settings.tavily.desc')}</small>
        </div>
        <span
          className={`settings-subpanel-chip settings-websearch-status ${
            isConfigured ? 'is-active' : ''
          }`}
        >
          {isConfigured ? t('settings.tavily.configured') : t('settings.tavily.missingKey')}
        </span>
      </div>

      <div className="settings-subpanel-body">
        <div className="field">
          <label>{t('settings.tavily.providerGroupLabel')}</label>
          <div
            className="settings-websearch-provider-grid"
            role="radiogroup"
            aria-label={t('settings.tavily.providerGroupLabel')}
          >
            {WEB_SEARCH_PROVIDER_DEFINITIONS.map((provider) => {
              const selected = provider.id === activeProvider;
              const saved = Boolean(webSearch.credentials[provider.id]?.apiKey.trim());
              return (
                <button
                  key={provider.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`settings-websearch-provider-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => {
                    setWebSearch({ provider: provider.id });
                    onSaved?.();
                  }}
                >
                  <span className="settings-websearch-provider-head">
                    <span
                      className="settings-websearch-provider-mark"
                      aria-hidden="true"
                    >
                      {PROVIDER_MONOGRAMS[provider.id]}
                    </span>
                    <span className="settings-websearch-provider-name">{provider.name}</span>
                    {saved ? (
                      <span
                        className="settings-websearch-provider-dot"
                        aria-label={t('settings.tavily.configured')}
                      />
                    ) : null}
                  </span>
                  <span className="settings-websearch-provider-badge">
                    {t(`settings.tavily.providers.${provider.id}.badge`)}
                  </span>
                  <span className="settings-websearch-provider-desc">
                    {t(`settings.tavily.providers.${provider.id}.description`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-websearch-key-row">
          <div className="settings-websearch-key-main">
            <div className="field">
              <label>{t('settings.tavily.keyLabel', { provider: definition.name })}</label>
              <PasswordInput
                value={credential?.apiKey ?? ''}
                placeholder={definition.keyPlaceholder}
                onChange={(event) => updateCredential({ apiKey: event.target.value })}
                showLabel={t('settings.show')}
                hideLabel={t('settings.hide')}
              />
              <small>{t('settings.tavily.keyHint')}</small>
            </div>

            {definition.requiresEngineId ? (
              <div className="field">
                <label>{t('settings.tavily.engineIdLabel')}</label>
                <input
                  value={credential?.engineId ?? ''}
                  placeholder={t('settings.tavily.engineIdPlaceholder')}
                  onChange={(event) => updateCredential({ engineId: event.target.value })}
                />
                <small>{t('settings.tavily.engineIdHint')}</small>
              </div>
            ) : null}

            <p className="settings-websearch-provider-tip">
              {t(`settings.tavily.providers.${activeProvider}.tip`)}
            </p>
          </div>

          <aside className="settings-websearch-guide">
            <strong>{t('settings.tavily.guideTitle', { provider: definition.name })}</strong>
            <p>{t('settings.tavily.guideDesc')}</p>
            <div className="settings-websearch-guide-actions">
              <a
                className="settings-websearch-guide-link"
                href={definition.signupUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('settings.tavily.openConsole')}
                <span aria-hidden="true">{"\u2197"}</span>
              </a>
              <a
                className="settings-websearch-guide-link"
                href={definition.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('settings.tavily.viewDocs')}
                <span aria-hidden="true">{"\u2197"}</span>
              </a>
              {definition.engineSignupUrl ? (
                <a
                  className="settings-websearch-guide-link"
                  href={definition.engineSignupUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('settings.tavily.createEngine')}
                  <span aria-hidden="true">{"\u2197"}</span>
                </a>
              ) : null}
            </div>
          </aside>
        </div>

        <div className="settings-websearch-tips">
          <strong>{t('settings.tavily.tipsTitle')}</strong>
          <ul>
            <li>{t('settings.tavily.tipLocalOnly')}</li>
            <li>{t('settings.tavily.tipBilling')}</li>
            <li>{t('settings.tavily.tipTest')}</li>
          </ul>
        </div>

        <details className="settings-connection-options settings-websearch-advanced">
          <summary>{t('settings.tavily.connectionOptions')}</summary>
          <p>{t('settings.tavily.connectionHint')}</p>
          <div className="settings-inline-grid settings-inline-grid--double">
            <div className="field">
              <label>{t('settings.tavily.endpointLabel', { provider: definition.name })}</label>
              <input
                value={credential?.baseUrl ?? ''}
                placeholder={definition.defaultBaseUrl}
                onChange={(event) => updateCredential({ baseUrl: event.target.value })}
              />
              <small>{t('settings.tavily.endpointHint')}</small>
            </div>
            <div className="field">
              <label>{t('settings.tavily.maxResultsLabel')}</label>
              <input
                type="number"
                min={1}
                max={10}
                value={webSearch.maxResults}
                onChange={(event) => {
                  setWebSearch({ maxResults: Number(event.target.value) });
                  onSaved?.();
                }}
              />
              <small>{t('settings.tavily.maxResultsHint')}</small>
            </div>
            <div className="field">
              <label>{t('settings.tavily.localEndpointLabel')}</label>
              <input
                value={webSearch.localEndpoint}
                placeholder="/api/web-search"
                onChange={(event) => {
                  setWebSearch({ localEndpoint: event.target.value });
                  onSaved?.();
                }}
              />
              <small>{t('settings.tavily.localEndpointHint')}</small>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
