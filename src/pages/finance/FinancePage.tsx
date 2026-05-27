import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppPreferences } from '../../shared/store/useAppPreferences';

type FinanceNewsItem = {
  id: string;
  title: string;
  source: string;
  link: string;
  publishedAt: string;
  summary?: string;
};

type FeedLoadStatus = {
  kind: 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'disabled';
  itemCount?: number;
};

const FINANCE_NEWS_CACHE_KEY = 'ledgerflow.finance.news-cache.v1';
const FINANCE_ILLUSTRATION_URL =
  'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow/Illustrations/scrum-board.svg';

function getDefaultFeedStatus(enabled: boolean): FeedLoadStatus {
  return { kind: enabled ? 'loading' : 'disabled' };
}

function getFeedStatusLabel(status: FeedLoadStatus | undefined, t: (k: string) => string): string {
  switch (status?.kind) {
    case 'loading':
      return t('finance.ui.rssStatusLoading');
    case 'success':
      return t('finance.ui.rssStatusSuccess');
    case 'empty':
      return t('finance.ui.rssStatusEmpty');
    case 'error':
      return t('finance.ui.rssStatusError');
    case 'disabled':
      return t('finance.ui.rssStatusDisabled');
    default:
      return t('finance.ui.rssStatusIdle');
  }
}

function getFeedStatusDetail(
  status: FeedLoadStatus | undefined,
  t: (k: string, options?: Record<string, string | number>) => string
): string {
  switch (status?.kind) {
    case 'success':
      return t('finance.ui.rssStatusSuccessDetail', { count: status.itemCount || 0 });
    case 'empty':
      return t('finance.ui.rssStatusEmptyDetail');
    case 'error':
      return t('finance.ui.rssStatusErrorDetail');
    default:
      return '';
  }
}

function formatTimeLabel(value: string | undefined, t: (k: string) => string, language: string): string {
  if (!value) return t('finance.ui.justNow');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function cleanHtml(raw?: string | null): string {
  return String(raw || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRssItems(xmlText: string, fallbackSource: string, t: (k: string) => string, language: string): FinanceNewsItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(t('finance.ui.rssParseFailed'));
  }

  const sourceTitle =
    cleanHtml(doc.querySelector('channel > title')?.textContent) ||
    cleanHtml(doc.querySelector('feed > title')?.textContent) ||
    fallbackSource;

  const itemNodes = Array.from(doc.querySelectorAll('item, entry'));
  return itemNodes
    .map((node, index) => {
      const title =
        cleanHtml(node.querySelector('title')?.textContent) ||
        cleanHtml(node.querySelector('media\\:title')?.textContent) ||
        t('finance.ui.unnamedNews');
      const directLink = node.querySelector('link')?.textContent?.trim();
      const atomLink =
        (node.querySelector('link[rel="alternate"]') as Element | null)?.getAttribute('href') ||
        node.querySelector('link')?.getAttribute('href');
      const link = directLink || atomLink || 'https://news.google.com/';
      const publishedRaw =
        node.querySelector('pubDate')?.textContent ||
        node.querySelector('published')?.textContent ||
        node.querySelector('updated')?.textContent ||
        '';
      const summaryRaw =
        node.querySelector('description')?.textContent ||
        node.querySelector('summary')?.textContent ||
        node.querySelector('content')?.textContent ||
        '';
      return {
        id: `${fallbackSource}-${index}-${title}`,
        title,
        source: sourceTitle,
        link,
        publishedAt: formatTimeLabel(publishedRaw, t, language),
        summary: cleanHtml(summaryRaw)
      };
    })
    .filter((item) => item.title && item.link)
    .slice(0, 8);
}

async function fetchRssFeed(
  feedUrl: string,
  signal: AbortSignal,
  t: (k: string) => string,
  language: string
): Promise<FinanceNewsItem[]> {
  const encodedUrl = encodeURIComponent(feedUrl);
  const response = await fetch(`https://api.allorigins.win/raw?url=${encodedUrl}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xmlText = await response.text();
  return parseRssItems(xmlText, feedUrl, t, language);
}

export function FinancePage() {
  const { t, i18n } = useTranslation();
  const { rssSubscriptions, addRssSubscription, removeRssSubscription, toggleRssSubscription } =
    useAppPreferences();
  const [news, setNews] = useState<FinanceNewsItem[]>(() => {
    if (typeof window === 'undefined') return [];
    const cachedRaw = window.localStorage.getItem(FINANCE_NEWS_CACHE_KEY);
    if (!cachedRaw) return [];

    try {
      const parsed = JSON.parse(cachedRaw) as FinanceNewsItem[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedTitle, setFeedTitle] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [activeNewsId, setActiveNewsId] = useState('');
  const [feedStatuses, setFeedStatuses] = useState<Record<string, FeedLoadStatus>>({});

  const enabledFeeds = useMemo(
    () => rssSubscriptions.filter((item) => item.enabled),
    [rssSubscriptions]
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadFinanceNews() {
      setLoading(true);
      setError('');
      setFeedStatuses(
        Object.fromEntries(
          rssSubscriptions.map((item) => [item.id, getDefaultFeedStatus(item.enabled)])
        )
      );

      if (enabledFeeds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const loadedFeeds = await Promise.all(
          enabledFeeds.map(async (item) => {
            try {
              const items = await fetchRssFeed(item.url, controller.signal, t, i18n.language);
              return { feedId: item.id, ok: true as const, items };
            } catch (fetchError) {
              return { feedId: item.id, ok: false as const, error: fetchError };
            }
          })
        );
        if (controller.signal.aborted) return;

        const nextStatuses: Record<string, FeedLoadStatus> = Object.fromEntries(
          rssSubscriptions
            .filter((item) => !item.enabled)
            .map((item) => [item.id, { kind: 'disabled' } satisfies FeedLoadStatus])
        );
        const merged = loadedFeeds
          .flatMap((result) => {
            if (!result.ok) {
              nextStatuses[result.feedId] = { kind: 'error' };
              return [];
            }

            nextStatuses[result.feedId] =
              result.items.length > 0
                ? { kind: 'success', itemCount: result.items.length }
                : { kind: 'empty' };
            return result.items;
          })
          .slice(0, 20);
        setFeedStatuses(nextStatuses);

        const sorted = [...merged].sort((a, b) => {
          const aTime = Date.parse(a.publishedAt);
          const bTime = Date.parse(b.publishedAt);
          if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
          return bTime - aTime;
        });

        if (sorted.length > 0) {
          setNews(sorted);
          window.localStorage.setItem(FINANCE_NEWS_CACHE_KEY, JSON.stringify(sorted));
          setActiveNewsId((current) => current || sorted[0].id);
        } else {
          setError(t('finance.ui.noReadableContent'));
        }

        if (loadedFeeds.every((result) => !result.ok)) {
          setError(t('finance.ui.rssUnavailable'));
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(t('finance.ui.rssUnavailable'));
        }
      } finally {
        setLoading(false);
      }
    }

    loadFinanceNews();
    return () => controller.abort();
  }, [enabledFeeds, i18n.language, rssSubscriptions, t]);

  const dailyIdea = useMemo(() => {
    const day = new Date().getDate();
    const ideas = [
      t('finance.ideas.1'),
      t('finance.ideas.2'),
      t('finance.ideas.3'),
      t('finance.ideas.4'),
      t('finance.ideas.5')
    ];
    return ideas[day % ideas.length];
  }, [t]);

  const activeNews = useMemo(
    () => news.find((item) => item.id === activeNewsId) || news[0] || null,
    [activeNewsId, news]
  );

  function onAddFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = addRssSubscription({ title: feedTitle, url: feedUrl });
    if (!result.ok) {
      setError(result.reason || t('finance.ui.addFeedFailed'));
      return;
    }
    setFeedTitle('');
    setFeedUrl('');
  }

  return (
    <div className="page-stack finance-page">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>📰 {t('finance.ui.title')}</h2>
        <p className="muted">{t('finance.ui.subtitle')}</p>
        <div className="finance-page-tip finance-page-tip-with-illustration" role="note">
          <div className="finance-page-tip-copy">
            <strong>这里是市场资讯页</strong>
            <p>只保留 RSS / 财经资讯阅读与订阅管理；如果你要使用工资计算、个税测算等工具，请前往左侧「工资工具」。</p>
          </div>
          <img
            className="finance-page-tip-illustration"
            src={FINANCE_ILLUSTRATION_URL}
            alt=""
            aria-hidden="true"
          />
        </div>

        <details className="card" style={{ padding: 12, marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {t('finance.ui.rssManage')}（{rssSubscriptions.length}）
          </summary>

          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <form onSubmit={onAddFeed} className="finance-feed-form-grid">
              <input
                value={feedTitle}
                onChange={(event) => setFeedTitle(event.target.value)}
                placeholder={t('finance.ui.feedTitlePlaceholder')}
              />
              <input
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                placeholder="https://example.com/feed.xml"
              />
              <button type="submit">{t('finance.ui.add')}</button>
            </form>

            <div
              style={{
                maxHeight: 210,
                overflowY: 'auto',
                display: 'grid',
                gap: 8,
                paddingRight: 4
              }}
            >
              {rssSubscriptions.map((item) => {
                const feedStatus = feedStatuses[item.id] || getDefaultFeedStatus(item.enabled);
                const statusDetail = getFeedStatusDetail(feedStatus, t);

                return (
                  <div
                    key={item.id}
                    role="group"
                    aria-label={`RSS 订阅 ${item.title}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      padding: 8
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="finance-feed-item-head">
                        <strong>{item.title}</strong>
                        <span
                          className={`finance-feed-status finance-feed-status-${feedStatus.kind}`}
                          aria-live="polite"
                        >
                          {getFeedStatusLabel(feedStatus, t)}
                        </span>
                      </div>
                      <p
                        className="muted"
                        style={{
                          margin: 0,
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                        title={item.url}
                      >
                        {item.url}
                      </p>
                      {statusDetail ? <p className="finance-feed-status-detail">{statusDetail}</p> : null}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button type="button" onClick={() => toggleRssSubscription(item.id)}>
                        {item.enabled ? t('finance.ui.disable') : t('finance.ui.enable')}
                      </button>
                      <button type="button" onClick={() => removeRssSubscription(item.id)}>
                        {t('finance.ui.delete')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>

        {loading ? <p className="muted">{t('finance.ui.loading')}</p> : null}
        {error ? <p className="muted">{error}</p> : null}

        {news.length === 0 ? (
          <p className="muted">{t('finance.ui.noCachedNews')}</p>
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
                  {item.source} · {item.publishedAt}
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
            {activeNews.source} · {activeNews.publishedAt}
          </p>
          <p>{activeNews.summary || t('finance.ui.noSummary')}</p>
          <a href={activeNews.link} target="_blank" rel="noreferrer">
            {t('finance.ui.openOriginal')}
          </a>
        </section>
      ) : null}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>💡 {t('finance.ui.dailyIdeaTitle')}</h3>
        <p>{dailyIdea}</p>
      </section>
    </div>
  );
}
