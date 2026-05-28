import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fetchEmbeddings } from '../../features/assistant/api/openaiEmbeddingClient';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { AppAccentTheme } from '../../shared/types/app';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { Toast } from '../../shared/ui/Toast';

const AI_PROVIDER_PRESETS = [
  { value: 'https://ai.shuaihong.fun/v1', label: 'SH API' },
  { value: 'https://api.openai.com/v1', label: 'OpenAI' },
  { value: 'https://generativelanguage.googleapis.com/v1beta/openai', label: 'Gemini' },
  { value: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
  { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  { value: 'https://api.siliconflow.cn/v1', label: '硅基流动' }
] as const;

const MODEL_PRESETS = [
  'gpt-5.4-mini',
  'gpt-5.2',
  'gemini-2.5-flash-lite',
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'deepseek-chat',
  'deepseek-reasoner',
  'qwen-turbo',
  'qwen-plus',
  'glm-4-flash'
];

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
  return mergeModelOptions(
    '',
    EMBEDDING_MODEL_PRESETS,
    remoteModels.filter(isLikelyEmbeddingModelName)
  );
}

function getEmbeddingModelValidationMessage(modelId: string, candidates: string[]): string {
  const value = modelId.trim();
  if (!value) return '请填写嵌入模型名称。';
  if (/\s{2,}/.test(value)) return '模型名包含连续空格，建议检查是否误粘贴。';
  if (/[^\w./:-]/.test(value)) return '模型名包含非常见字符，请确认是否拼写有误。';
  if (candidates.includes(value)) return '';
  if (!isLikelyEmbeddingModelName(value)) {
    return '该模型名不像常见 embedding 模型，建议优先选择下拉候选或检查拼写。';
  }
  return '该模型不在当前候选列表中，请确认服务端已支持此 embedding 模型。';
}

const ACCENT_THEME_OPTIONS: Array<{ value: AppAccentTheme; labelKey: string; preview: string }> = [
  { value: 'blue', labelKey: 'settings.accent.options.blue', preview: '#4f6ef7' },
  { value: 'emerald', labelKey: 'settings.accent.options.emerald', preview: '#10b981' },
  { value: 'violet', labelKey: 'settings.accent.options.violet', preview: '#8b5cf6' },
  { value: 'rose', labelKey: 'settings.accent.options.rose', preview: '#f43f5e' },
  { value: 'amber', labelKey: 'settings.accent.options.amber', preview: '#f59e0b' },
  {
    value: 'aurora',
    labelKey: 'settings.accent.options.aurora',
    preview: 'linear-gradient(135deg, #6366f1 0%, #22c55e 45%, #ec4899 100%)'
  }
];

function normalizeProviderBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

interface ModelSelectorProps {
  label: string;
  hint: string;
  value: string;
  presets: string[];
  onChange: (value: string) => void;
}

function getModelDisplayLabel(modelId: string): string {
  const value = modelId.trim();
  if (!value) return value;
  return value === 'gpt-5.4-mini' ? `${value}（推荐）` : value;
}

function mergeModelOptions(value: string, presets: string[], remoteModels: string[]): string[] {
  const uniq = new Set<string>();
  const options = [value, ...remoteModels, ...presets]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (uniq.has(item)) return false;
      uniq.add(item);
      return true;
    });
  return options;
}

interface SettingsPageProps {
  variant?: 'page' | 'overlay';
  onClose?: () => void;
}

function ModelSelector({ label, hint, value, presets, onChange }: ModelSelectorProps) {
  const options = useMemo(() => mergeModelOptions(value, presets, []), [value, presets]);

  return (
    <div className="field settings-model-field">
      <label>{label}</label>
      <small>{hint}</small>
      <div className="settings-model-select-row">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((item) => (
            <option key={item} value={item}>
              {getModelDisplayLabel(item)}
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

  const baseUrl = useAiSettings((s) => s.baseUrl);
  const apiKey = useAiSettings((s) => s.apiKey);
  const model = useAiSettings((s) => s.model);
  const accentTheme = useAppPreferences((s) => s.accentTheme);
  const embeddingModel = useAiSettings((s) => s.embeddingModel);
  const enableEmbeddingModel = useAiSettings((s) => s.enableEmbeddingModel);
  const embeddingChannel = useAiSettings((s) => s.embedding);
  const rerankModel = useAiSettings((s) => s.rerankModel);
  const enableRerankModel = useAiSettings((s) => s.enableRerankModel);
  const rememberApiKey = useAiSettings((s) => s.rememberApiKey);
  const setBaseUrl = useAiSettings((s) => s.setBaseUrl);
  const setApiKey = useAiSettings((s) => s.setApiKey);
  const setRememberApiKey = useAiSettings((s) => s.setRememberApiKey);
  const setModel = useAiSettings((s) => s.setModel);
  const setAccentTheme = useAppPreferences((s) => s.setAccentTheme);
  const setEmbeddingModel = useAiSettings((s) => s.setEmbeddingModel);
  const setEnableEmbeddingModel = useAiSettings((s) => s.setEnableEmbeddingModel);
  const setEmbeddingChannel = useAiSettings((s) => s.setEmbedding);
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
  const [toastVisible, setToastVisible] = useState(false);
  const [embeddingTestStatus, setEmbeddingTestStatus] = useState<{
    loading: boolean;
    ok: boolean;
    message: string;
  }>({ loading: false, ok: false, message: '' });
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
    ? `${
        currentLanguage === 'en' ? 'Selected provider' : '已选择供应商'
      }：${selectedProviderPreset.label}`
    : baseUrl.trim()
      ? currentLanguage === 'en'
        ? 'Using a custom provider URL'
        : '当前使用自定义供应商地址'
      : currentLanguage === 'en'
        ? 'Choose a provider preset for quick fill'
        : '可先选择渠道商快速填充';
  const embeddingPanelHasContent = Boolean(
    embeddingChannel.enabled ||
    embeddingChannel.baseUrl.trim() ||
    embeddingChannel.apiKey.trim() ||
    embeddingChannel.model.trim()
  );
  const embeddingPanelStatus = embeddingOverrideActive
    ? currentLanguage === 'en'
      ? 'Override active'
      : '覆盖中'
    : embeddingChannel.enabled
      ? currentLanguage === 'en'
        ? 'Enabled'
        : '已启用'
      : currentLanguage === 'en'
        ? 'Disabled'
        : '未启用';
  const embeddingEffectiveBaseUrl = embeddingOverrideActive
    ? embeddingChannel.baseUrl.trim() || baseUrl
    : baseUrl;
  const embeddingEffectiveModel = embeddingOverrideActive
    ? embeddingChannel.model.trim() || embeddingModel.trim()
    : embeddingModel.trim();
  const [embeddingPanelExpanded, setEmbeddingPanelExpanded] = useState(embeddingPanelHasContent);
  const embeddingPanelToggleText = embeddingPanelExpanded
    ? currentLanguage === 'en'
      ? 'Collapse'
      : '收起'
    : currentLanguage === 'en'
      ? 'Expand'
      : '展开';

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
        message: '请先配置 AI 服务地址（baseUrl）。'
      });
      return;
    }
    if (!effectiveModel.trim()) {
      setEmbeddingTestStatus({ loading: false, ok: false, message: '请先填写嵌入模型（model）。' });
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
        message: `测试前校验未通过：${modelValidationMessage}`
      });
      return;
    }
    if (!effectiveApiKey.trim()) {
      setEmbeddingTestStatus({ loading: false, ok: false, message: '请先配置 API Key。' });
      return;
    }

    const startedAt = performance.now();
    setEmbeddingTestStatus({ loading: true, ok: false, message: '正在测试嵌入配置…' });
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
          message: `测试失败：嵌入服务返回空向量（baseUrl=${effectiveBaseUrl}；model=${effectiveModel}）。`
        });
        return;
      }
      setEmbeddingTestStatus({
        loading: false,
        ok: true,
        message: `测试成功：向量维度 ${dim}，耗时 ${latencyMs}ms（baseUrl=${effectiveBaseUrl}；model=${effectiveModel}）。`
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      setEmbeddingTestStatus({
        loading: false,
        ok: false,
        message: `测试失败：${detail}`
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
            {variant === 'overlay' ? '关闭' : t('settings.back')}
          </button>
        </div>
        <p className="settings-page-intro" style={{ marginTop: 16 }}>
          {t('settings.intro')}
        </p>

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
              <option value="">选择渠道商（快速填充）</option>
              {AI_PROVIDER_PRESETS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
              {baseUrl.trim() && !selectedProviderPreset ? (
                <option value="__custom__">自定义地址</option>
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
          <small className={`settings-provider-state ${selectedProviderPreset ? 'is-active' : ''}`}>
            {providerSummary}
          </small>
        </div>

        <div className="field">
          <label>{t('settings.apiKey')}</label>
          <PasswordInput
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
            记住 API Key（版本更新后无需重填）
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

        <div className="field">
          <label>{t('settings.accent.label')}</label>
          <div
            className="settings-accent-grid"
            role="radiogroup"
            aria-label={t('settings.accent.label')}
          >
            {ACCENT_THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`settings-accent-option ${accentTheme === option.value ? 'active' : ''}`}
                onClick={() => {
                  setAccentTheme(option.value);
                  showSaveToast();
                }}
                role="radio"
                aria-checked={accentTheme === option.value}
              >
                <span className="settings-accent-dot" style={{ background: option.preview }} />
                <span>{t(option.labelKey)}</span>
              </button>
            ))}
          </div>
          <small>{t('settings.accent.hint')}</small>
        </div>

        <div className="settings-divider" />

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
              {embeddingChannel.enabled ? (
                <span
                  className={`settings-subpanel-chip ${embeddingOverrideActive ? 'is-active' : ''}`}
                >
                  {embeddingPanelStatus}
                </span>
              ) : (
                <button
                  type="button"
                  className="settings-subpanel-primary-action"
                  onClick={() => {
                    setEmbeddingChannel({ enabled: true });
                    setEmbeddingPanelExpanded(true);
                    showSaveToast();
                  }}
                >
                  {currentLanguage === 'en' ? 'Enable channel' : '启用嵌入渠道'}
                </button>
              )}
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
              {currentLanguage === 'en' ? 'Effective model' : '当前生效模型'}：
              <strong>
                {embeddingEffectiveModel || (currentLanguage === 'en' ? 'Not set' : '未设置')}
              </strong>
            </span>
            <span>
              Base URL：
              <strong>
                {embeddingEffectiveBaseUrl || (currentLanguage === 'en' ? 'Not set' : '未设置')}
              </strong>
            </span>
            <small>
              {currentLanguage === 'en'
                ? 'If you use a dedicated embedding service, just confirm its storage and logging policy.'
                : '如使用单独 embedding 服务，确认其数据存储与日志策略即可。'}
            </small>
          </div>

          {embeddingPanelExpanded ? (
            <div className="settings-subpanel-body">
              <div className="settings-inline-grid settings-inline-grid--double">
                <div className="field">
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={embeddingChannel.enabled}
                      onChange={(e) => {
                        setEmbeddingChannel({ enabled: e.target.checked });
                        showSaveToast();
                      }}
                    />
                    {t('settings.embeddingChannel.enabledLabel')}
                  </label>
                  <small>{t('settings.embeddingChannel.enabledHint')}</small>
                </div>

                <div className="field">
                  <label>{t('settings.embeddingChannel.modelLabel')}</label>
                  <small>{t('settings.embeddingChannel.modelHint')}</small>
                  <input
                    value={embeddingChannel.model}
                    list="embedding-model-candidates"
                    placeholder="例如：jina-embeddings-v3"
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
                      {embeddingChannelModelValidation || '模型名校验通过，可直接测试嵌入配置。'}
                    </small>
                  ) : (
                    <small>常见模型：{embeddingModelCandidates.slice(0, 4).join(' / ')}</small>
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

                <div className="field">
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

              <div className="settings-embedding-effective-card">
                <div className="settings-embedding-effective-title">
                  {currentLanguage === 'en' ? 'Effective rule' : '当前生效规则'}
                </div>
                <div className="settings-embedding-effective-copy">
                  {currentLanguage === 'en'
                    ? 'The global Embedding model below is used by default. Once override is enabled and any dedicated baseUrl / apiKey / model is filled in, this embedding channel takes precedence.'
                    : '默认优先使用下方全局 Embedding 模型；开启覆盖且填写了专用 baseUrl / apiKey / model 任一项后，会切到这套嵌入渠道配置。'}{' '}
                  {currentLanguage === 'en' ? 'Current effective model' : '当前实际生效的模型为'}{' '}
                  <strong>
                    {embeddingEffectiveModel || (currentLanguage === 'en' ? 'Not set' : '未设置')}
                  </strong>
                  ，Base URL {currentLanguage === 'en' ? 'is' : '为'}{' '}
                  <strong>
                    {embeddingEffectiveBaseUrl || (currentLanguage === 'en' ? 'Not set' : '未设置')}
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
                      color: embeddingTestStatus.ok ? 'var(--color-success)' : 'var(--color-danger)'
                    }}
                  >
                    {embeddingTestStatus.message}
                  </small>
                ) : null}
              </div>

              <small className="muted">{t('settings.embeddingChannel.fallbackHint')}</small>
            </div>
          ) : null}
        </div>

        <div className="settings-model-grid">
          <ModelSelector
            label={t('settings.model.defaultLabel')}
            hint={t('settings.model.defaultHint')}
            value={model}
            presets={MODEL_PRESETS}
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
