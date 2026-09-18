import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchTonghuashunNews,
  type TonghuashunNewsCategory,
  type TonghuashunNewsItem
} from '../../features/finance/api/tonghuashunNewsClient';

const FINANCE_NEWS_CACHE_KEY = 'ledgerflow.finance.tonghuashun-news-cache.v1';
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
  if (/^(今天|刚刚)/.test(normalized)) return normalized;
  if (/^昨天/.test(normalized)) return normalized;
  const currentYear = new Date().getFullYear().toString();
  const withYear = /^\d{4}\s*[年-]\s*\d{1,2}\s*月\s*\d{1,2}/.test(normalized)
    ? normalized
    : `${currentYear}-${normalized.replace('月', '-').replace('日', '')}`;
  const parsedDate = new Date(withYear);
  if (Number.isNaN(parsedDate.getTime())) return normalized;
  const parsed = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(parsedDate);
  return parsed;
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
    <div className="page-stack finance-page vi-page">
      <section className="vi-section finance-news-section">
        <div className="vi-section-title">
          <span className="vi-page-kicker">市场脉搏</span>
          <h2>{t('finance.ui.title')}</h2>
          <p>{t('finance.ui.subtitle')}</p>
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
          <div className="finance-news-editorial-layout">
            {activeNews ? (
              <article className="finance-news-lead">
                <span className="finance-news-kicker">今日焦点 · {activeNews.source}</span>
                <h3>{activeNews.title}</h3>
                <p>{activeNews.summary || t('finance.ui.noSummary')}</p>
                <div className="finance-news-lead-meta">
                  <small>{formatPublishedAt(activeNews.publishedAt, i18n.language)}</small>
                  <a href={activeNews.link} target="_blank" rel="noreferrer">{t('finance.ui.openOriginal')} ↗</a>
                </div>
              </article>
            ) : null}
            <div className="finance-news-compact-list">
              {news.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`finance-news-compact-item ${activeNews?.id === item.id ? 'is-active' : ''}`}
                  onClick={() => setActiveNewsId(item.id)}
                >
                  <span className="finance-news-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="finance-news-item-copy">
                    <strong>{item.title}</strong>
                    <small>{item.source} · {formatPublishedAt(item.publishedAt, i18n.language)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

    </div>
  );
}
