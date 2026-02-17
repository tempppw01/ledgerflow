import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSkeleton } from '../../shared/ui/LoadingSkeleton';
import { useAppPreferences } from '../../shared/store/useAppPreferences';

type FinanceNewsItem = {
  id: string;
  title: string;
  source: string;
  link: string;
  publishedAt: string;
  summary?: string;
};

type NewsCachePayload = {
  updatedAt: string;
  items: FinanceNewsItem[];
};

const FINANCE_NEWS_CACHE_KEY = 'ledgerflow.finance.news-cache.v2';
const AUTO_REFRESH_INTERVAL_MS = 1000 * 60 * 15;
const NEWS_ROW_HEIGHT = 92;
const NEWS_VIEWPORT_HEIGHT = 420;

const FINANCE_IDEAS = [
  '📌 每周固定 10 分钟复盘：本周最值得关注的 3 条财经事件是什么？',
  '📈 建一个“利率观察”清单：LPR、10Y 国债、美元指数，形成自己的宏观体感。',
  '💡 记账时给大额支出打标签（如教育/医疗/旅行），月末更容易做预算优化。',
  '🧠 避免追涨杀跌：先写下交易理由，再决定是否执行。',
  '🛟 保留 3~6 个月应急资金，投资前先保证现金流安全。'
];

function formatTimeLabel(value?: string): string {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
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

function parseRssItems(xmlText: string, fallbackSource: string): FinanceNewsItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('RSS 解析失败');
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
        '未命名资讯';
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
        publishedAt: formatTimeLabel(publishedRaw),
        summary: cleanHtml(summaryRaw)
      };
    })
    .filter((item) => item.title && item.link)
    .slice(0, 8);
}

async function fetchRssFeed(feedUrl: string, signal: AbortSignal): Promise<FinanceNewsItem[]> {
  const encodedUrl = encodeURIComponent(feedUrl);
  const response = await fetch(`https://api.allorigins.win/raw?url=${encodedUrl}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xmlText = await response.text();
  return parseRssItems(xmlText, feedUrl);
}

function readNewsCache(): NewsCachePayload | null {
  try {
    const raw = window.localStorage.getItem(FINANCE_NEWS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NewsCachePayload;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function FinancePage() {
  const { rssSubscriptions, addRssSubscription, removeRssSubscription, toggleRssSubscription } =
    useAppPreferences();
  const cached = typeof window === 'undefined' ? null : readNewsCache();
  const [news, setNews] = useState<FinanceNewsItem[]>(cached?.items || []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [feedTitle, setFeedTitle] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [activeNewsId, setActiveNewsId] = useState('');
  const [scrollTop, setScrollTop] = useState(0);

  const enabledFeeds = useMemo(
    () => rssSubscriptions.filter((item) => item.enabled),
    [rssSubscriptions]
  );

  const loadFinanceNews = useCallback(
    async (forceRefresh: boolean) => {
      const controller = new AbortController();
      setLoading(true);
      setError('');

      if (enabledFeeds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const feedsToLoad = forceRefresh ? enabledFeeds : enabledFeeds.slice(0, 1);
        const loadedLists = await Promise.allSettled(
          feedsToLoad.map((item) => fetchRssFeed(item.url, controller.signal))
        );
        const merged = loadedLists
          .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
          .slice(0, 80);

        const sorted = [...merged].sort((a, b) => {
          const aTime = Date.parse(a.publishedAt);
          const bTime = Date.parse(b.publishedAt);
          if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
          return bTime - aTime;
        });

        if (sorted.length > 0) {
          setNews(sorted);
          window.localStorage.setItem(
            FINANCE_NEWS_CACHE_KEY,
            JSON.stringify({ items: sorted, updatedAt: new Date().toISOString() })
          );
          setActiveNewsId((current) => current || sorted[0].id);
        } else {
          setError('订阅源暂无可读内容，已展示上次缓存资讯。');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError('RSS 订阅源暂不可用，已展示上次缓存资讯。');
        }
      } finally {
        setLoading(false);
      }

      return () => controller.abort();
    },
    [enabledFeeds]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cache = readNewsCache();
    const isFresh =
      cache?.updatedAt &&
      Date.now() - new Date(cache.updatedAt).getTime() < AUTO_REFRESH_INTERVAL_MS;
    if (!isFresh) {
      void loadFinanceNews(false);
    } else {
      setLoading(false);
    }
  }, [loadFinanceNews]);

  const dailyIdea = useMemo(() => {
    const day = new Date().getDate();
    return FINANCE_IDEAS[day % FINANCE_IDEAS.length];
  }, []);

  const activeNews = useMemo(
    () => news.find((item) => item.id === activeNewsId) || news[0] || null,
    [activeNewsId, news]
  );

  const virtualStart = Math.max(0, Math.floor(scrollTop / NEWS_ROW_HEIGHT) - 4);
  const virtualEnd = Math.min(
    news.length,
    virtualStart + Math.ceil(NEWS_VIEWPORT_HEIGHT / NEWS_ROW_HEIGHT) + 8
  );
  const visibleNews = news.slice(virtualStart, virtualEnd);

  function onAddFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = addRssSubscription({ title: feedTitle, url: feedUrl });
    if (!result.ok) {
      setError(result.reason || '新增 RSS 失败。');
      return;
    }
    setFeedTitle('');
    setFeedUrl('');
  }

  return (
    <div className="page-stack finance-page">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>📰 金融资讯</h2>
        <p className="muted">减少首次请求：优先读取缓存，仅在必要时拉取订阅源。</p>
        <button type="button" onClick={() => void loadFinanceNews(true)} aria-label="刷新财经资讯">
          手动刷新资讯
        </button>

        <details className="card" style={{ padding: 12, marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            RSS 订阅管理（{rssSubscriptions.length}）
          </summary>

          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <form onSubmit={onAddFeed} className="finance-feed-form-grid">
              <input
                value={feedTitle}
                onChange={(event) => setFeedTitle(event.target.value)}
                placeholder="订阅名称（可选）"
                aria-label="订阅名称"
              />
              <input
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                placeholder="https://example.com/feed.xml"
                aria-label="订阅地址"
              />
              <button type="submit" aria-label="新增 RSS 订阅">
                新增
              </button>
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
              {rssSubscriptions.map((item) => (
                <div
                  key={item.id}
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
                    <strong>{item.title}</strong>
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
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => toggleRssSubscription(item.id)}
                      aria-label={`${item.enabled ? '停用' : '启用'} ${item.title}`}
                    >
                      {item.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRssSubscription(item.id)}
                      aria-label={`删除订阅 ${item.title}`}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>

        {loading ? <LoadingSkeleton lines={6} /> : null}
        {error ? <p className="muted">{error}</p> : null}

        {news.length === 0 ? (
          <p className="muted">暂无可展示的 RSS 缓存资讯，请检查订阅源后重试。</p>
        ) : (
          <div
            style={{ height: NEWS_VIEWPORT_HEIGHT, overflowY: 'auto', position: 'relative' }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ height: news.length * NEWS_ROW_HEIGHT, position: 'relative' }}>
              {visibleNews.map((item, index) => {
                const rowIndex = virtualStart + index;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="card"
                    onClick={() => setActiveNewsId(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' && news[rowIndex + 1])
                        setActiveNewsId(news[rowIndex + 1].id);
                      if (event.key === 'ArrowUp' && news[rowIndex - 1])
                        setActiveNewsId(news[rowIndex - 1].id);
                    }}
                    style={{
                      position: 'absolute',
                      top: rowIndex * NEWS_ROW_HEIGHT,
                      left: 0,
                      right: 0,
                      height: NEWS_ROW_HEIGHT - 6,
                      padding: 12,
                      textAlign: 'left',
                      border:
                        activeNews?.id === item.id
                          ? '1px solid var(--color-primary, #2563eb)'
                          : '1px solid var(--color-border)',
                      background: 'transparent'
                    }}
                    aria-label={`查看资讯 ${item.title}`}
                  >
                    <strong>{item.title}</strong>
                    <p className="muted" style={{ marginBottom: 0 }}>
                      {item.source} · {item.publishedAt}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {activeNews ? (
        <section
          className="card"
          style={{ border: '2px solid var(--color-primary-border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <h3 style={{ marginTop: 0 }}>🧾 RSS 阅读器</h3>
          <h4>{activeNews.title}</h4>
          <p className="muted" style={{ marginTop: 0 }}>
            {activeNews.source} · {activeNews.publishedAt}
          </p>
          <p>{activeNews.summary || '该订阅源未提供摘要，请点击下方链接阅读原文。'}</p>
          <a href={activeNews.link} target="_blank" rel="noreferrer">
            打开原文
          </a>
        </section>
      ) : null}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>💡 今日金融小建议</h3>
        <p>{dailyIdea}</p>
      </section>
    </div>
  );
}
