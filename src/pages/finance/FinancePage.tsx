import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchTonghuashunNews,
  type TonghuashunNewsCategory,
  type TonghuashunNewsItem
} from '../../features/finance/api/tonghuashunNewsClient';

const FINANCE_NEWS_CACHE_KEY = 'ledgerflow.finance.tonghuashun-news-cache.v1';
const FINANCE_ILLUSTRATION_URL =
  'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/Illustrations/scrum-board.svg';
const TONGHUASHUN_HOME_URL = 'https://www.10jqka.com.cn/';

const NEWS_CATEGORIES: Array<{ value: TonghuashunNewsCategory; labelKey: string }> = [
  { value: 'yaowen', labelKey: 'finance.category.yaowen' },
  { value: 'macro', labelKey: 'finance.category.macro' },
  { value: 'industry', labelKey: 'finance.category.industry' },
  { value: 'global', labelKey: 'finance.category.global' },
  { value: 'market', labelKey: 'finance.category.market' },
  { value: 'commentary', labelKey: 'finance.category.commentary' }
];

function readCachedNews(): TonghuashunNewsItem[] {
  if (typeof window === 'undefined') return [];
  const cachedRaw = window.localStorage.getItem(FINANCE_NEWS_CACHE_KEY);
  if (!cachedRaw) return [];

  try {
    const parsed = JSON.parse(cachedRaw) as TonghuashunNewsItem[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [];
  } catch {
    return [];
  }
}

function formatPublishedAt(value: string, language: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const currentYear = new Date().getFullYear().toString();
  const withYear = /^\d{4}\s*[年-]\s*\d{1,2}\s*月\s*\d{1,2}/.test(normalized)
    ? normalized
    : `${currentYear}-${normalized.replace('月', '-').replace('日', '')}`;
  const parsed = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(withYear));
  return Number.isNaN(new Date(withYear).getTime()) ? normalized : parsed;
}

export function FinancePage() {
  const { t, i18n } = useTranslation();
  const [news, setNews] = useState<TonghuashunNewsItem[]>(readCachedNews);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeNewsId, setActiveNewsId] = useState('');
  const [category, setCategory] = useState<TonghuashunNewsCategory>('yaowen');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadNews() {
      setLoading(true);
      setError('');

      try {
        const loaded = await fetchTonghuashunNews(category, 16);
        if (controller.signal.aborted) return;

        if (loaded.length > 0) {
          setNews(loaded);
          window.localStorage.setItem(FINANCE_NEWS_CACHE_KEY, JSON.stringify(loaded));
          setActiveNewsId((current) => current || loaded[0].id);
        } else {
          setError(t('finance.ui.noNews'));
        }
      } catch (loadError) {
        if ((loadError as Error).name !== 'AbortError') {
          setError(t('finance.ui.loadFailed'));
        }
      } finally {
        setLoading(false);
      }
    }


    loadNews();
    return () => controller.abort();
  }, [category, i18n.language, refreshToken, t]);

  const activeNews = useMemo(
    () => news.find((item) => item.id === activeNewsId) || news[0] || null,
    [activeNewsId, news]
  );

  return (
    <div className="page-stack finance-page">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>📰 {t('finance.ui.title')}</h2>
        <p className="muted">{t('finance.ui.subtitle')}</p>
        <div className="finance-page-tip finance-page-tip-with-illustration" role="note">
          <div className="finance-page-tip-copy">
            <strong>{t('finance.ui.tipTitle')}</strong>
            <p>{t('finance.ui.tipBody')}</p>
          </div>
          <img
            className="finance-page-tip-illustration"
            src={FINANCE_ILLUSTRATION_URL}
            alt=""
            aria-hidden="true"
          />
        </div>

        <div className="finance-source-strip" aria-label={t('finance.ui.sourceLabel')}>
          <div className="finance-source-strip-copy">
            <span>{t('finance.ui.sourceBadge')}</span>
            <strong>{t('finance.ui.sourceTitle')}</strong>
            <small>{t('finance.ui.sourceHint')}</small>
          </div>
          <nav aria-label={t('finance.ui.openSource')}>
            <a href={TONGHUASHUN_HOME_URL} target="_blank" rel="noreferrer">
              <span className="finance-source-site-mark is-tonghuashun" aria-hidden="true">
                同
              </span>
              {t('finance.ui.sourceSite')}
              <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </div>

        <div className="finance-news-toolbar">
          <div className="finance-category-tabs" role="tablist" aria-label={t('finance.ui.categories')}>
            {NEWS_CATEGORIES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={category === item.value}
                className={category === item.value ? 'is-active' : ''}
                onClick={() => setCategory(item.value)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <button
            className="finance-news-refresh-button"
            type="button"
            disabled={loading}
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            {loading ? t('finance.ui.refreshing') : t('finance.ui.refresh')}
          </button>
        </div>

        {loading ? <p className="muted">{t('finance.ui.loading')}</p> : null}
        {error ? <p className="muted">{error}</p> : null}

        {news.length === 0 ? (
          <p className="muted">{t('finance.ui.noNews')}</p>
        ) : (
          <div className="finance-news-compact-list">
            {news.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`finance-news-compact-item ${activeNews?.id === item.id ? 'is-active' : ''}`}
                onClick={() => setActiveNewsId(item.id)}
              >
                <strong>{item.title}</strong>
                <p className="muted">
                  {item.source} · {formatPublishedAt(item.publishedAt, i18n.language)}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      {activeNews ? (
        <section
          className="card"
          style={{ border: '2px solid var(--color-primary-border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <h3 style={{ marginTop: 0 }}>🧾 {t('finance.ui.readerTitle')}</h3>
          <h4>{activeNews.title}</h4>
          <p className="muted" style={{ marginTop: 0 }}>
            {activeNews.source} · {formatPublishedAt(activeNews.publishedAt, i18n.language)}
          </p>
          <p>{activeNews.summary || t('finance.ui.noSummary')}</p>
          <a href={activeNews.link} target="_blank" rel="noreferrer">
            {t('finance.ui.openOriginal')}
          </a>
        </section>
      ) : null}

    </div>
  );
}
