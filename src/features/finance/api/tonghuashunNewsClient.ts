export type TonghuashunNewsCategory =
  | 'today'
  | 'yaowen'
  | 'macro'
  | 'industry'
  | 'global'
  | 'market'
  | 'commentary';

export interface TonghuashunNewsItem {
  id: string;
  title: string;
  source: string;
  link: string;
  publishedAt: string;
  summary: string;
}

type TonghuashunNewsPayload = {
  data?: {
    news?: Array<Partial<TonghuashunNewsItem>>;
    updatedAt?: string;
  };
};

export async function fetchTonghuashunNews(
  category: TonghuashunNewsCategory = 'yaowen',
  pageSize = 12
): Promise<TonghuashunNewsItem[]> {
  const params = new URLSearchParams({ category, pageSize: String(pageSize) });
  const response = await fetch(`/api/market/tonghuashun/news?${params.toString()}`);
  if (!response.ok) throw new Error('同花顺资讯加载失败，请稍后重试。');

  const body = (await response.json()) as TonghuashunNewsPayload;
  return (body.data?.news || [])
    .map((item) => ({
      id: String(item.id || `${item.title}-${item.link}`),
      title: String(item.title || '').trim() || '同花顺资讯',
      source: String(item.source || '同花顺财经').trim(),
      link: String(item.link || '').trim(),
      publishedAt: String(item.publishedAt || '').trim(),
      summary: String(item.summary || '').trim()
    }))
    .filter((item) => item.title && item.link);
}
