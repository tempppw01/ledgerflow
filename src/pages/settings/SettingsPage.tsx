import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fetchEmbeddings } from '../../features/assistant/api/openaiEmbeddingClient';
import { useAuth } from '../../features/auth/ui/authContext';
import {
  changeAccountPassword,
  verifyAccountPassword,
  getAccountSessions,
  revokeAccountSession,
  revokeOtherAccountSessions,
  type AuthSession
} from '../../shared/api/authClient';
import { CIRCLE_USER_ICON_URL, MONITOR_ICON_URL } from '../../shared/config/brandAssets';
import {
  AI_MODEL_PRESETS,
  getAiModelDisplayLabel,
  mergeAiModelOptions
} from '../../shared/config/aiModels';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { Toast } from '../../shared/ui/Toast';

const AI_PROVIDER_PRESETS = [
  { value: 'https://ai.shuaihong.fun/v1', label: 'SH API' },
  { value: 'https://api.openai.com/v1', label: 'OpenAI' },
  { value: 'https://generativelanguage.googleapis.com/v1beta/openai', label: 'Gemini' },
  { value: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
  { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  { value: 'https://api.siliconflow.cn/v1', labelKey: 'settings.providerPreset.siliconflow' }
] as const;

const EMBEDDING_MODEL_PRESETS = [
  'jina-embeddings-v3',
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-embedding-v4',
  'bge-m3',
  'gte-Qwen2-7B-instruct'
];

const RERANK_MODEL_PRESETS = [
  'bge-reranker-v2-m3',
  'bge-reranker-large',
  'gte-rerank-v2',
  'cohere-rerank-3.5'
];

const EMBEDDING_MODEL_KEYWORDS = [
  'embedding',
  'embeddings',
  'bge',
  'gte',
  'jina',
  'e5',
  'm3'
] as const;

function isLikelyEmbeddingModelName(modelId: string): boolean {
  const value = modelId.trim().toLowerCase();
  if (!value) return false;
  return EMBEDDING_MODEL_KEYWORDS.some((keyword) => value.includes(keyword));
}

function buildEmbeddingModelCandidates(remoteModels: string[]): string[] {
  return mergeAiModelOptions(
    '',
    EMBEDDING_MODEL_PRESETS,
    remoteModels.filter(isLikelyEmbeddingModelName)
  );
}

function getEmbeddingModelValidationMessage(modelId: string, candidates: string[]): string {
  const value = modelId.trim();
  if (!value) return 'settings.embeddingChannel.validation.empty';
  if (/\s{2,}/.test(value)) return 'settings.embeddingChannel.validation.spaces';
  if (/[^\w./:-]/.test(value)) return 'settings.embeddingChannel.validation.characters';
  if (candidates.includes(value)) return '';
  if (!isLikelyEmbeddingModelName(value)) {
    return 'settings.embeddingChannel.validation.uncommon';
  }
  return 'settings.embeddingChannel.validation.notInList';
}

function normalizeProviderBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function formatAccountSessionTime(value: string | null, locale: 'zh' | 'en'): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

type StatusMessage =
  | { key: string; params?: Record<string, unknown>; messageKey?: string }
  | { text: string }
  | null;

function resolveStatusMessage(
  message: StatusMessage,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (!message) return '';
  if ('text' in message) return message.text;
  const params = message.messageKey
    ? { ...message.params, message: t(message.messageKey) }
    : message.params;
  return t(message.key, params);
}

interface ModelSelectorProps {
  label: string;
  hint: string;
  value: string;
  presets: string[];
  onChange: (value: string) => void;
}

interface SettingsPageProps {
  variant?: 'page' | 'overlay';
  onClose?: () => void;
}

type SettingsWorkspace = 'account' | 'openai' | 'tavily' | 'embedding' | 'advanced';

const SETTINGS_WORKSPACES: Array<{ value: SettingsWorkspace; labelKey: string }> = [
  { value: 'account', labelKey: 'settings.workspaces.account' },
  { value: 'openai', labelKey: 'settings.workspaces.openai' },
  { value: 'tavily', labelKey: 'settings.workspaces.tavily' },
  { value: 'embedding', labelKey: 'settings.workspaces.embedding' },
  { value: 'advanced', labelKey: 'settings.workspaces.advanced' }
];

function getProviderPresetLabel(
  preset: { label?: string; labelKey?: string },
  t: (key: string) => string
): string {
  if (preset.label) return preset.label;
  return preset.labelKey ? t(preset.labelKey) : '';
}

function ModelSelector({ label, hint, value, presets, onChange }: ModelSelectorProps) {
  const options = useMemo(() => mergeAiModelOptions(value, presets), [value, presets]);

  return (
    <div className="field settings-model-field">
      <label>{label}</label>
      <small>{hint}</small>
      <div className="settings-model-select-row">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((item) => (
            <option key={item} value={item}>
              {getAiModelDisplayLabel(item)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SettingsPage({ variant = 'page', onClose }: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();

  const baseUrl = useAiSettings((s) => s.baseUrl);
  const apiKey = useAiSettings((s) => s.apiKey);
  const model = useAiSettings((s) => s.model);
  const embeddingModel = useAiSettings((s) => s.embeddingModel);
  const enableEmbeddingModel = useAiSettings((s) => s.enableEmbeddingModel);
  const embeddingChannel = useAiSettings((s) => s.embedding);
  const webSearch = useAiSettings((s) => s.webSearch);
  const rerankModel = useAiSettings((s) => s.rerankModel);
  const enableRerankModel = useAiSettings((s) => s.enableRerankModel);
  const rememberApiKey = useAiSettings((s) => s.rememberApiKey);
  const setBaseUrl = useAiSettings((s) => s.setBaseUrl);
  const setApiKey = useAiSettings((s) => s.setApiKey);
  const setRememberApiKey = useAiSettings((s) => s.setRememberApiKey);
  const setModel = useAiSettings((s) => s.setModel);
  const setEmbeddingModel = useAiSettings((s) => s.setEmbeddingModel);
  const setEnableEmbeddingModel = useAiSettings((s) => s.setEnableEmbeddingModel);
  const setEmbeddingChannel = useAiSettings((s) => s.setEmbedding);
  const setWebSearch = useAiSettings((s) => s.setWebSearch);
  const setRerankModel = useAiSettings((s) => s.setRerankModel);
  const setEnableRerankModel = useAiSettings((s) => s.setEnableRerankModel);
  const memoryDays = useAiSettings((s) => s.memoryDays);
  const showEmbeddingDebug = useAiSettings((s) => s.showEmbeddingDebug);
  const showEmbeddingSummary = useAiSettings((s) => s.showEmbeddingSummary);
  const memoryBackend = useAiSettings((s) => s.memoryBackend);
  const bulkRecategorizeConcurrency = useAiSettings((s) => s.bulkRecategorizeConcurrency);
  const setMemoryDays = useAiSettings((s) => s.setMemoryDays);
  const setShowEmbeddingDebug = useAiSettings((s) => s.setShowEmbeddingDebug);
  const setShowEmbeddingSummary = useAiSettings((s) => s.setShowEmbeddingSummary);
  const setMemoryBackend = useAiSettings((s) => s.setMemoryBackend);
  const setBulkRecategorizeConcurrency = useAiSettings((s) => s.setBulkRecategorizeConcurrency);

  const currentLanguage = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'zh';
  const [activeWorkspace, setActiveWorkspace] = useState<SettingsWorkspace>('account');
  const [toastVisible, setToastVisible] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [profileStatus, setProfileStatus] = useState<StatusMessage>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<StatusMessage>(null);
  const [passwordStatusTone, setPasswordStatusTone] = useState<'error' | 'success' | ''>('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [passwordVerifying, setPasswordVerifying] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<StatusMessage>(null);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<StatusMessage>(null);
  const [embeddingTestStatus, setEmbeddingTestStatus] = useState<{
    loading: boolean;
    ok: boolean;
    message: StatusMessage;
  }>({ loading: false, ok: false, message: null });
  const embeddingModelCandidates = useMemo(() => buildEmbeddingModelCandidates([]), []);
  const embeddingChannelModelValidation = useMemo(
    () => getEmbeddingModelValidationMessage(embeddingChannel.model, embeddingModelCandidates),
    [embeddingChannel.model, embeddingModelCandidates]
  );

  const embeddingOverrideActive =
    Boolean(embeddingChannel.enabled) &&
    Boolean(
      embeddingChannel.baseUrl.trim() ||
      embeddingChannel.apiKey.trim() ||
      embeddingChannel.model.trim()
    );
  const selectedProviderPreset = useMemo(
    () =>
      AI_PROVIDER_PRESETS.find(
        (item) => normalizeProviderBaseUrl(item.value) === normalizeProviderBaseUrl(baseUrl)
      ) || null,
    [baseUrl]
  );
  const providerPresetValue = selectedProviderPreset?.value || (baseUrl.trim() ? '__custom__' : '');
  const providerSummary = selectedProviderPreset
    ? t('settings.provider.selected', {
        name: getProviderPresetLabel(selectedProviderPreset, t)
      })
    : baseUrl.trim()
      ? t('settings.provider.custom')
      : t('settings.provider.choose');
  const embeddingPanelHasContent = Boolean(
    embeddingChannel.enabled ||
    embeddingChannel.baseUrl.trim() ||
    embeddingChannel.apiKey.trim() ||
    embeddingChannel.model.trim()
  );
  const embeddingPanelStatus = embeddingOverrideActive
    ? t('settings.embeddingChannel.statusOverride')
    : embeddingChannel.enabled
      ? t('settings.embeddingChannel.statusEnabled')
      : t('settings.embeddingChannel.statusDisabled');
  const embeddingEffectiveBaseUrl = embeddingOverrideActive
    ? embeddingChannel.baseUrl.trim() || baseUrl
    : baseUrl;
  const embeddingEffectiveModel = embeddingOverrideActive
    ? embeddingChannel.model.trim() || embeddingModel.trim()
    : embeddingModel.trim();
  const [embeddingPanelExpanded, setEmbeddingPanelExpanded] = useState(embeddingPanelHasContent);
  const embeddingPanelToggleText = embeddingPanelExpanded
    ? t('settings.embeddingChannel.collapse')
    : t('settings.embeddingChannel.expand');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSaveToast = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      setToastVisible(true);
    }, 260);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setDisplayName(user.displayName);
  }, [user.displayName]);

  const loadAccountSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      setSessionsError(null);
      const result = await getAccountSessions();
      setSessions(result.sessions);
    } catch (error) {
      setSessionsError(
        error instanceof Error
          ? { text: error.message }
          : { key: 'settings.account.sessionsLoadFailed' }
      );
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccountSessions();
  }, [loadAccountSessions, user.id]);

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setProfileSaving(true);
      setProfileStatus(null);
      const updatedUser = await updateProfile({ displayName });
      setDisplayName(updatedUser.displayName);
      setProfileStatus({ key: 'settings.account.profileSaved' });
    } catch (error) {
      setProfileStatus(
        error instanceof Error
          ? { text: error.message }
          : { key: 'settings.account.profileSaveFailed' }
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordVerified) {
      try {
        setPasswordVerifying(true);
        setPasswordStatusTone('');
        setPasswordStatus({ key: 'settings.account.verifyingPassword' });
        await verifyAccountPassword({ currentPassword });
        setPasswordVerified(true);
        setPasswordStatusTone('success');
        setPasswordStatus({ key: 'settings.account.passwordVerified' });
      } catch (error) {
        setPasswordStatusTone('error');
        setPasswordStatus(
          error instanceof Error
            ? { text: error.message }
            : { key: 'settings.account.passwordVerifyFailed' }
        );
      } finally {
        setPasswordVerifying(false);
      }
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatusTone('error');
      setPasswordStatus({ key: 'settings.account.passwordMismatch' });
      return;
    }
    try {
      setPasswordSaving(true);
      setPasswordStatusTone('');
      setPasswordStatus(null);
      await changeAccountPassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordVerified(false);
      setPasswordStatusTone('success');
      setPasswordStatus({ key: 'settings.account.passwordUpdated' });
    } catch (error) {
      setPasswordStatusTone('error');
      setPasswordStatus(
        error instanceof Error
          ? { text: error.message }
          : { key: 'settings.account.passwordChangeFailed' }
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      setSessionSaving(true);
      setSessionStatus(null);
      await revokeOtherAccountSessions();
      setSessionStatus({ key: 'settings.account.othersRevoked' });
      await loadAccountSessions();
    } catch (error) {
      setSessionStatus(
        error instanceof Error
          ? { text: error.message }
          : { key: 'settings.account.revokeOthersFailed' }
      );
    } finally {
      setSessionSaving(false);
    }
  };

  const handleRevokeSession = async (session: AuthSession) => {
    try {
      setSessionSaving(true);
      setSessionStatus(null);
      await revokeAccountSession(session.id);
      setSessionStatus({
        key: 'settings.account.sessionRevoked',
        params: { device: session.deviceName }
      });
      await loadAccountSessions();
    } catch (error) {
      setSessionStatus(
        error instanceof Error ? { text: error.message } : { key: 'settings.account.revokeFailed' }
      );
    } finally {
      setSessionSaving(false);
    }
  };

  const handleTestEmbeddingChannel = useCallback(async () => {
    const overrideActive =
      Boolean(embeddingChannel.enabled) &&
      Boolean(
        embeddingChannel.baseUrl.trim() ||
        embeddingChannel.apiKey.trim() ||
        embeddingChannel.model.trim()
      );

    const effectiveBaseUrl = overrideActive ? embeddingChannel.baseUrl.trim() || baseUrl : baseUrl;
    const effectiveApiKey = overrideActive ? embeddingChannel.apiKey.trim() || apiKey : apiKey;
    const effectiveModel = overrideActive
      ? embeddingChannel.model.trim() || embeddingModel.trim()
      : embeddingModel.trim();

    if (!effectiveBaseUrl.trim()) {
      setEmbeddingTestStatus({
        loading: false,
        ok: false,
        message: { key: 'settings.embeddingChannel.test.missingBaseUrl' }
      });
      return;
    }
    if (!effectiveModel.trim()) {
      setEmbeddingTestStatus({
        loading: false,
        ok: false,
        message: { key: 'settings.embeddingChannel.test.missingModel' }
      });
      return;
    }
    const modelValidationMessage = getEmbeddingModelValidationMessage(
      effectiveModel,
      embeddingModelCandidates
    );
    if (modelValidationMessage) {
      setEmbeddingTestStatus({
        loading: false,
        ok: false,
        message: {
          key: 'settings.embeddingChannel.test.validationFailed',
          messageKey: modelValidationMessage
        }
      });
      return;
    }
    if (!effectiveApiKey.trim()) {
      setEmbeddingTestStatus({
        loading: false,
        ok: false,
        message: { key: 'settings.embeddingChannel.test.missingApiKey' }
      });
      return;
    }

    const startedAt = performance.now();
    setEmbeddingTestStatus({
      loading: true,
      ok: false,
      message: { key: 'settings.embeddingChannel.test.testing' }
    });
    try {
      const vectors = await fetchEmbeddings({
        baseUrl: effectiveBaseUrl,
        apiKey: effectiveApiKey,
        model: effectiveModel,
        inputs: ['ledgerflow embedding test']
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      const dim = Array.isArray(vectors?.[0]) ? vectors[0].length : 0;
      if (dim <= 0) {
        setEmbeddingTestStatus({
          loading: false,
          ok: false,
          message: {
            key: 'settings.embeddingChannel.test.emptyVector',
            params: { baseUrl: effectiveBaseUrl, model: effectiveModel }
          }
        });
        return;
      }
      setEmbeddingTestStatus({
        loading: false,
        ok: true,
        message: {
          key: 'settings.embeddingChannel.test.success',
          params: { dim, latency: latencyMs, baseUrl: effectiveBaseUrl, model: effectiveModel }
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setEmbeddingTestStatus({
        loading: false,
        ok: false,
        message: detail
          ? { key: 'settings.embeddingChannel.test.failed', params: { detail } }
          : { key: 'settings.embeddingChannel.test.unknownError' }
      });
    }
  }, [apiKey, baseUrl, embeddingChannel, embeddingModel, embeddingModelCandidates]);
  const handleSelectModel = (setter: (value: string) => void, value: string) => {
    setter(value.trim());
    showSaveToast();
  };
  const handleClose = () => {
    if (variant === 'overlay') {
      onClose?.();
      return;
    }

    navigate(-1);
  };

  return (
    <div
      className={variant === 'overlay' ? 'settings-page settings-page--overlay' : 'settings-page'}
    >
      <section
        className={
          variant === 'overlay'
            ? 'settings-surface settings-surface--overlay'
            : 'panel settings-surface'
        }
      >
        <div
          className="row settings-page-header"
          style={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <h2 style={{ margin: 0 }}>{t('settings.title')}</h2>
          <button type="button" className="settings-page-close" onClick={handleClose}>
            {variant === 'overlay' ? t('common.close') : t('settings.back')}
          </button>
        </div>
        <p className="settings-page-intro" style={{ marginTop: 16 }}>
          {t('settings.intro')}
        </p>

        <nav className="settings-console-tabs" aria-label={t('settings.tabsAria')} role="tablist">
          {SETTINGS_WORKSPACES.map((workspace) => (
            <button
              key={workspace.value}
              type="button"
              role="tab"
              className={activeWorkspace === workspace.value ? 'is-active' : ''}
              aria-selected={activeWorkspace === workspace.value}
              onClick={() => setActiveWorkspace(workspace.value)}
            >
              {t(workspace.labelKey)}
            </button>
          ))}
        </nav>

        {activeWorkspace === 'account' ? (
          <section
            className="settings-account-section settings-tab-panel"
            aria-labelledby="account-settings-title"
            role="tabpanel"
          >
            <div className="settings-account-identity">
              <img className="settings-account-avatar" src={CIRCLE_USER_ICON_URL} alt="" />
              <div className="settings-account-heading">
                <div>
                  <p className="settings-account-eyebrow">ACCOUNT</p>
                  <h3 id="account-settings-title">{t('settings.account.title')}</h3>
                  <span className="settings-account-email" title={user.email}>
                    {user.email}
                  </span>
                </div>
                <span className="settings-account-current">{t('settings.account.current')}</span>
              </div>
              <form className="settings-account-profile-form" onSubmit={handleSaveProfile}>
                <label className="field">
                  <span>{t('settings.account.displayName')}</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                    autoComplete="name"
                    required
                  />
                </label>
                <button type="submit" className="secondary" disabled={profileSaving}>
                  {profileSaving ? t('settings.account.saving') : t('settings.account.save')}
                </button>
                {profileStatus ? (
                  <small className="settings-account-status">
                    {resolveStatusMessage(profileStatus, t)}
                  </small>
                ) : null}
              </form>
            </div>

            <div className="settings-account-content">
              <section className="settings-account-panel" aria-labelledby="password-settings-title">
                <div className="settings-account-panel-head">
                  <div>
                    <h4 id="password-settings-title">{t('settings.account.passwordTitle')}</h4>
                    <p>{t('settings.account.passwordDesc')}</p>
                  </div>
                </div>
                <form
                  className={`settings-password-form${passwordVerified ? ' is-verified' : ''}`}
                  onSubmit={handleChangePassword}
                >
                  {!passwordVerified ? (
                    <div className="settings-password-step" key="verify">
                      <label className="field">
                        <span>{t('settings.account.currentPassword')}</span>
                        <PasswordInput
                          value={currentPassword}
                          onChange={(event) => setCurrentPassword(event.target.value)}
                          autoComplete="current-password"
                          showLabel={t('settings.show')}
                          hideLabel={t('settings.hide')}
                          required
                        />
                      </label>
                      <button type="submit" className="secondary" disabled={passwordVerifying}>
                        {passwordVerifying
                          ? t('settings.account.verifying')
                          : t('settings.account.verify')}
                      </button>
                    </div>
                  ) : (
                    <div
                      className="settings-password-step settings-password-step-new"
                      key="new-password"
                    >
                      <div className="settings-password-verified">
                        <span className="settings-password-verified-mark" aria-hidden="true">
                          ✓
                        </span>
                        {t('settings.account.verified')}
                        <button
                          type="button"
                          className="settings-password-reverify"
                          onClick={() => {
                            setPasswordVerified(false);
                            setNewPassword('');
                            setConfirmPassword('');
                            setPasswordStatus(null);
                            setPasswordStatusTone('');
                          }}
                        >
                          {t('settings.account.reverify')}
                        </button>
                      </div>
                      <label className="field">
                        <span>{t('settings.account.newPassword')}</span>
                        <PasswordInput
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          autoComplete="new-password"
                          minLength={10}
                          maxLength={200}
                          showLabel={t('settings.show')}
                          hideLabel={t('settings.hide')}
                          required
                        />
                      </label>
                      <label className="field">
                        <span>{t('settings.account.confirmPassword')}</span>
                        <PasswordInput
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          autoComplete="new-password"
                          minLength={10}
                          maxLength={200}
                          showLabel={t('settings.show')}
                          hideLabel={t('settings.hide')}
                          required
                        />
                      </label>
                      <button type="submit" className="secondary" disabled={passwordSaving}>
                        {passwordSaving
                          ? t('settings.account.updating')
                          : t('settings.account.updatePassword')}
                      </button>
                    </div>
                  )}
                  {passwordStatus ? (
                    <small
                      className={`settings-account-status${
                        passwordStatusTone === 'error'
                          ? ' is-error'
                          : passwordStatusTone === 'success'
                            ? ' is-success'
                            : passwordVerified
                              ? ' is-success'
                              : ''
                      }`}
                      role="status"
                    >
                      {resolveStatusMessage(passwordStatus, t)}
                    </small>
                  ) : null}
                </form>
              </section>

              <section className="settings-account-panel" aria-labelledby="device-settings-title">
                <div className="settings-account-panel-head">
                  <div>
                    <h4 id="device-settings-title">{t('settings.account.devicesTitle')}</h4>
                    <p>{t('settings.account.devicesDesc')}</p>
                  </div>
                  <button
                    type="button"
                    className="secondary settings-account-revoke-all"
                    disabled={
                      sessionSaving || sessions.filter((session) => !session.current).length === 0
                    }
                    onClick={() => void handleRevokeOtherSessions()}
                  >
                    {t('settings.account.revokeOthers')}
                  </button>
                </div>
                <div className="settings-account-session-list" aria-live="polite">
                  {sessionsLoading ? <small>{t('settings.account.loadingSessions')}</small> : null}
                  {sessionsError ? (
                    <small className="settings-account-status">
                      {resolveStatusMessage(sessionsError, t)}
                    </small>
                  ) : null}
                  {!sessionsLoading && !sessionsError && sessions.length === 0 ? (
                    <small>{t('settings.account.noSessions')}</small>
                  ) : null}
                  {sessions.map((session) => (
                    <div className="settings-account-session-row" key={session.id}>
                      <img src={MONITOR_ICON_URL} alt="" aria-hidden="true" />
                      <div className="settings-account-session-copy">
                        <div>
                          <strong>{session.deviceName}</strong>
                          {session.current ? (
                            <span>{t('settings.account.currentDevice')}</span>
                          ) : null}
                        </div>
                        <small>
                          {t('settings.account.sessionMeta', {
                            lastSeen:
                              formatAccountSessionTime(session.lastSeenAt, currentLanguage) ??
                              t('common.justNow'),
                            created:
                              formatAccountSessionTime(session.createdAt, currentLanguage) ??
                              t('common.justNow')
                          })}
                        </small>
                      </div>
                      {session.current ? null : (
                        <button
                          type="button"
                          className="settings-account-session-revoke"
                          disabled={sessionSaving}
                          onClick={() => void handleRevokeSession(session)}
                        >
                          {t('settings.account.revoke')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {sessionStatus ? (
                  <small className="settings-account-status">
                    {resolveStatusMessage(sessionStatus, t)}
                  </small>
                ) : null}
              </section>
            </div>
          </section>
        ) : null}

        {activeWorkspace === 'openai' ? (
          <div className="settings-tab-panel" role="tabpanel">
            <div className="settings-divider" />

            <div className="field">
              <label>{t('settings.baseUrl')}</label>
              <div className="settings-baseurl-row">
                <select
                  className={
                    selectedProviderPreset
                      ? 'settings-provider-select active'
                      : 'settings-provider-select'
                  }
                  value={providerPresetValue}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!next || next === '__custom__') return;
                    setBaseUrl(next);
                    showSaveToast();
                  }}
                >
                  <option value="">{t('settings.provider.choosePlaceholder')}</option>
                  {AI_PROVIDER_PRESETS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {getProviderPresetLabel(item, t)}
                    </option>
                  ))}
                  {baseUrl.trim() && !selectedProviderPreset ? (
                    <option value="__custom__">{t('settings.provider.customOption')}</option>
                  ) : null}
                </select>
                <input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    showSaveToast();
                  }}
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <small
                className={`settings-provider-state ${selectedProviderPreset ? 'is-active' : ''}`}
              >
                {providerSummary}
              </small>
            </div>

            <div className="field">
              <label>{t('settings.apiKey')}</label>
              <PasswordInput
                compactMask
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  showSaveToast();
                }}
                placeholder="sk-..."
                showLabel={t('settings.show')}
                hideLabel={t('settings.hide')}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberApiKey}
                  onChange={(e) => {
                    setRememberApiKey(e.target.checked);
                    showSaveToast();
                  }}
                />
                {t('settings.rememberApiKey')}
              </label>
            </div>

            <div className="settings-inline-grid settings-inline-grid--triple">
              <div className="field">
                <label>{t('settings.language.label')}</label>
                <select
                  value={currentLanguage}
                  onChange={(e) => {
                    void i18n.changeLanguage(e.target.value === 'en' ? 'en' : 'zh');
                    showSaveToast();
                  }}
                >
                  <option value="zh">{t('settings.language.zh')}</option>
                  <option value="en">{t('settings.language.en')}</option>
                </select>
                <small>{t('settings.language.hint')}</small>
              </div>

              <div className="field">
                <label>{t('settings.memoryDays.label')}</label>
                <select
                  value={memoryDays}
                  onChange={(e) => {
                    setMemoryDays(Number(e.target.value));
                    showSaveToast();
                  }}
                >
                  <option value={1}>{t('settings.memoryDays.d1')}</option>
                  <option value={2}>{t('settings.memoryDays.d2')}</option>
                  <option value={3}>{t('settings.memoryDays.d3')}</option>
                </select>
              </div>

              <div className="field">
                <label>{t('settings.memoryBackend.label')}</label>
                <select
                  value={memoryBackend}
                  onChange={(e) => {
                    setMemoryBackend(e.target.value === 'redis' ? 'redis' : 'local');
                    showSaveToast();
                  }}
                >
                  <option value="local">{t('settings.memoryBackend.local')}</option>
                  <option value="redis">{t('settings.memoryBackend.redis')}</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}

        {activeWorkspace === 'tavily' ? (
          <div className="settings-tab-panel" role="tabpanel">
            <div className="settings-subpanel settings-subpanel--tavily is-active">
              <div className="settings-subpanel-toggle">
                <div className="settings-subpanel-copy">
                  <strong>{t('settings.tavily.title')}</strong>
                  <small>{t('settings.tavily.desc')}</small>
                </div>
                <span
                  className={`settings-subpanel-chip ${webSearch.tavilyApiKey.trim() ? 'is-active' : ''}`}
                >
                  {webSearch.tavilyApiKey.trim()
                    ? t('settings.tavily.configured')
                    : t('settings.tavily.missingKey')}
                </span>
              </div>
              <div className="settings-subpanel-body">
                <div className="field settings-tavily-key-field">
                  <label>{t('settings.tavily.keyLabel')}</label>
                  <PasswordInput
                    value={webSearch.tavilyApiKey}
                    placeholder="tvly-..."
                    onChange={(e) => {
                      setWebSearch({ tavilyApiKey: e.target.value });
                      showSaveToast();
                    }}
                    showLabel={t('settings.show')}
                    hideLabel={t('settings.hide')}
                  />
                  <small>{t('settings.tavily.keyHint')}</small>
                </div>

                <details className="settings-connection-options">
                  <summary>{t('settings.tavily.connectionOptions')}</summary>
                  <p>{t('settings.tavily.connectionHint')}</p>
                  <div className="settings-inline-grid settings-inline-grid--double">
                    <div className="field">
                      <label>{t('settings.tavily.baseUrlLabel')}</label>
                      <input
                        value={webSearch.tavilyBaseUrl}
                        placeholder="https://api.tavily.com"
                        onChange={(e) => {
                          setWebSearch({ tavilyBaseUrl: e.target.value });
                          showSaveToast();
                        }}
                      />
                    </div>
                    <div className="field">
                      <label>{t('settings.tavily.localEndpointLabel')}</label>
                      <input
                        value={webSearch.localEndpoint}
                        placeholder="/api/web-search"
                        onChange={(e) => {
                          setWebSearch({ localEndpoint: e.target.value });
                          showSaveToast();
                        }}
                      />
                      <small>{t('settings.tavily.localEndpointHint')}</small>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        ) : null}

        {activeWorkspace === 'embedding' ? (
          <div className="settings-tab-panel" role="tabpanel">
            <div
              className={`settings-subpanel settings-subpanel--embedding ${embeddingPanelExpanded ? 'is-expanded' : ''} ${
                embeddingOverrideActive ? 'is-active' : ''
              }`}
            >
              <div className="settings-subpanel-toggle">
                <button
                  type="button"
                  className="settings-subpanel-title-button"
                  aria-expanded={embeddingPanelExpanded}
                  onClick={() => setEmbeddingPanelExpanded((current) => !current)}
                >
                  <span className="settings-subpanel-copy">
                    <strong>{t('settings.embeddingChannel.title')}</strong>
                    <small>{t('settings.embeddingChannel.desc')}</small>
                  </span>
                </button>
                <span className="settings-subpanel-meta">
                  <span
                    className={`settings-subpanel-chip ${embeddingOverrideActive ? 'is-active' : ''}`}
                  >
                    {embeddingPanelStatus}
                  </span>
                  <label className="settings-toggle-switch">
                    <input
                      type="checkbox"
                      checked={embeddingChannel.enabled}
                      onChange={(event) => {
                        setEmbeddingChannel({ enabled: event.target.checked });
                        if (event.target.checked) setEmbeddingPanelExpanded(true);
                        showSaveToast();
                      }}
                      aria-label={t('settings.embeddingChannel.enableAria')}
                    />
                    <span aria-hidden="true" />
                  </label>
                  <button
                    type="button"
                    className="settings-subpanel-arrow"
                    aria-expanded={embeddingPanelExpanded}
                    onClick={() => setEmbeddingPanelExpanded((current) => !current)}
                  >
                    {embeddingPanelToggleText}
                  </button>
                </span>
              </div>

              <div className="settings-subpanel-summary">
                <span>
                  {t('settings.embeddingChannel.summaryEffectiveModel')}:
                  <strong>
                    {embeddingEffectiveModel || t('settings.embeddingChannel.summaryNotSet')}
                  </strong>
                </span>
                <span>
                  {t('settings.embeddingChannel.summaryServiceUrl')}:
                  <strong>
                    {embeddingEffectiveBaseUrl || t('settings.embeddingChannel.summaryNotSet')}
                  </strong>
                </span>
                <small>{t('settings.embeddingChannel.summaryPrivacy')}</small>
              </div>

              {embeddingPanelExpanded ? (
                <div className="settings-subpanel-body">
                  <div className="settings-inline-grid settings-inline-grid--double">
                    <div className="field">
                      <label>{t('settings.embeddingChannel.modelLabel')}</label>
                      <small>{t('settings.embeddingChannel.modelHint')}</small>
                      <input
                        value={embeddingChannel.model}
                        list="embedding-model-candidates"
                        placeholder={t('settings.embeddingChannel.modelPlaceholder')}
                        onChange={(e) => {
                          setEmbeddingChannel({ model: e.target.value });
                          showSaveToast();
                        }}
                      />
                      <datalist id="embedding-model-candidates">
                        {embeddingModelCandidates.map((item) => (
                          <option key={item} value={item} />
                        ))}
                      </datalist>
                      {embeddingChannel.model.trim() ? (
                        <small
                          style={{
                            color: embeddingChannelModelValidation
                              ? 'var(--color-warning, #b45309)'
                              : 'var(--color-success, #15803d)'
                          }}
                        >
                          {embeddingChannelModelValidation
                            ? t(embeddingChannelModelValidation)
                            : t('settings.embeddingChannel.modelValid')}
                        </small>
                      ) : (
                        <small>
                          {t('settings.embeddingChannel.commonModels', {
                            models: embeddingModelCandidates.slice(0, 4).join(' / ')
                          })}
                        </small>
                      )}
                    </div>

                    <div className="field">
                      <label>{t('settings.embeddingChannel.baseUrlLabel')}</label>
                      <small>{t('settings.embeddingChannel.baseUrlHint')}</small>
                      <input
                        value={embeddingChannel.baseUrl}
                        placeholder="https://api.example.com/v1"
                        onChange={(e) => {
                          setEmbeddingChannel({ baseUrl: e.target.value });
                          showSaveToast();
                        }}
                      />
                    </div>

                    <div className="field settings-embedding-api-field">
                      <label>{t('settings.embeddingChannel.apiKeyLabel')}</label>
                      <small>{t('settings.embeddingChannel.apiKeyHint')}</small>
                      <PasswordInput
                        value={embeddingChannel.apiKey}
                        placeholder="sk-..."
                        onChange={(e) => {
                          setEmbeddingChannel({ apiKey: e.target.value });
                          showSaveToast();
                        }}
                        showLabel={t('settings.show')}
                        hideLabel={t('settings.hide')}
                      />
                    </div>
                  </div>

                  <div className="settings-embedding-note">
                    <div className="settings-embedding-effective-title">
                      {t('settings.embeddingChannel.howItWorks')}
                    </div>
                    <div className="settings-embedding-effective-copy">
                      {t('settings.embeddingChannel.howItWorksBody')}{' '}
                      {t('settings.embeddingChannel.currentlyUsing')}{' '}
                      <strong>
                        {embeddingEffectiveModel || t('settings.embeddingChannel.summaryNotSet')}
                      </strong>
                      ，{t('settings.embeddingChannel.summaryServiceUrl')}{' '}
                      <strong>
                        {embeddingEffectiveBaseUrl || t('settings.embeddingChannel.summaryNotSet')}
                      </strong>
                      。
                    </div>
                  </div>

                  <div className="settings-model-input-row settings-model-input-row--inline">
                    <button
                      type="button"
                      onClick={() => void handleTestEmbeddingChannel()}
                      disabled={embeddingTestStatus.loading}
                    >
                      {embeddingTestStatus.loading
                        ? t('settings.model.refreshing')
                        : t('settings.embeddingChannel.testButton')}
                    </button>
                    {embeddingTestStatus.message ? (
                      <small
                        style={{
                          color: embeddingTestStatus.ok
                            ? 'var(--color-success)'
                            : 'var(--color-danger)'
                        }}
                      >
                        {resolveStatusMessage(embeddingTestStatus.message, t)}
                      </small>
                    ) : null}
                  </div>

                  <small className="muted">{t('settings.embeddingChannel.fallbackHint')}</small>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeWorkspace === 'advanced' ? (
          <div className="settings-tab-panel" role="tabpanel">
            <div className="settings-model-grid">
              <ModelSelector
                label={t('settings.model.defaultLabel')}
                hint={t('settings.model.defaultHint')}
                value={model}
                presets={AI_MODEL_PRESETS}
                onChange={(value) => handleSelectModel(setModel, value)}
              />
              <ModelSelector
                label={t('settings.model.embeddingLabel')}
                hint={t('settings.model.embeddingHint')}
                value={embeddingModel}
                presets={EMBEDDING_MODEL_PRESETS}
                onChange={(value) => handleSelectModel(setEmbeddingModel, value)}
              />
              <ModelSelector
                label={t('settings.model.rerankLabel')}
                hint={t('settings.model.rerankHint')}
                value={rerankModel}
                presets={RERANK_MODEL_PRESETS}
                onChange={(value) => handleSelectModel(setRerankModel, value)}
              />
            </div>

            <div className="settings-inline-grid settings-inline-grid--double">
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enableEmbeddingModel}
                    onChange={(e) => {
                      setEnableEmbeddingModel(e.target.checked);
                      showSaveToast();
                    }}
                  />
                  {t('settings.embeddingToggle.label')}
                </label>
                <small>{t('settings.embeddingToggle.hint')}</small>
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enableRerankModel}
                    onChange={(e) => {
                      setEnableRerankModel(e.target.checked);
                      showSaveToast();
                    }}
                  />
                  {t('settings.rerankToggle.label')}
                </label>
                <small>{t('settings.rerankToggle.hint')}</small>
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showEmbeddingSummary}
                    onChange={(e) => {
                      setShowEmbeddingSummary(e.target.checked);
                      showSaveToast();
                    }}
                  />
                  {t('settings.embeddingSummaryToggle.label')}
                </label>
                <small>{t('settings.embeddingSummaryToggle.hint')}</small>
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showEmbeddingDebug}
                    onChange={(e) => {
                      setShowEmbeddingDebug(e.target.checked);
                      showSaveToast();
                    }}
                  />
                  {t('settings.embeddingDebugToggle.label')}
                </label>
                <small>{t('settings.embeddingDebugToggle.hint')}</small>
              </div>
            </div>

            <div className="field">
              <label>{t('settings.bulkConcurrency.label')}</label>
              <div className="settings-concurrency-slider-row">
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={bulkRecategorizeConcurrency}
                  onChange={(e) => {
                    setBulkRecategorizeConcurrency(Number(e.target.value));
                    showSaveToast();
                  }}
                  aria-label={t('settings.bulkConcurrency.aria')}
                />
                <strong>{bulkRecategorizeConcurrency}</strong>
              </div>
              <small>{t('settings.bulkConcurrency.hint')}</small>
            </div>
          </div>
        ) : null}
      </section>

      <Toast
        visible={toastVisible}
        variant="success"
        message={t('settings.toastSaved')}
        onClose={() => setToastVisible(false)}
      />
    </div>
  );
}
