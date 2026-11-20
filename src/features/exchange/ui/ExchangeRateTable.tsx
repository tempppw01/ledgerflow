import { useState } from 'react';
import {
  CLOUD_SYNC_ICON_URL,
  GLOBE_ICON_URL,
  PACKAGE_ICON_URL,
  STAR_ICON_URL,
  STAR_OFF_ICON_URL
} from '../../../shared/config/brandAssets';
import type { ExchangeRate } from '../model/types';
import { getCurrencyFlag, getCurrencyName, getCurrencyNameKey } from '../model/types';
import { useTFallback } from '../../../shared/lib/useTFallback';

interface ExchangeRateTableProps {
  rates: ExchangeRate[];
  base: string;
  date: string;
  fromCache: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const PAGE_SIZE = 20;
const COMMON_CODES = [
  'CNY',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'HKD',
  'SGD',
  'AUD',
  'CAD',
  'CHF',
  'KRW',
  'INR',
  'RUB',
  'THB',
  'MYR',
  'IDR',
  'PHP',
  'VND',
  'TWD',
  'NZD',
  'AED',
  'SAR'
];

const TREND_ICON: Record<NonNullable<ExchangeRate['trend']>, string> = {
  up: '↗',
  down: '↘',
  flat: '→'
};

const TREND_KEYS: Record<NonNullable<ExchangeRate['trend']>, string> = {
  up: 'exchange.table.trendUp',
  down: 'exchange.table.trendDown',
  flat: 'exchange.table.trendFlat'
};

const TREND_LABEL: Record<NonNullable<ExchangeRate['trend']>, string> = {
  up: '上涨',
  down: '下跌',
  flat: '持平'
};

export function ExchangeRateTable({
  rates,
  base,
  date,
  fromCache,
  loading,
  error,
  onRefresh
}: ExchangeRateTableProps) {
  const tf = useTFallback();
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ledgerflow-fav-currencies') || '[]');
    } catch {
      return [];
    }
  });
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

  const toggleFavorite = (code: string) => {
    setFavorites((prev) => {
      const next = prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code];
      localStorage.setItem('ledgerflow-fav-currencies', JSON.stringify(next));
      return next;
    });
  };

  const keyword = search.trim().toLowerCase();
  const filtered = rates.filter(
    (rate) => rate.code.toLowerCase().includes(keyword) || rate.name.toLowerCase().includes(keyword)
  );

  const sorted = [...filtered].sort((a, b) => {
    const aFav = favorites.includes(a.code) ? 0 : 1;
    const bFav = favorites.includes(b.code) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.code.localeCompare(b.code);
  });

  const defaultVisible = sorted.filter(
    (item) => favorites.includes(item.code) || COMMON_CODES.includes(item.code)
  );
  const displayRows = showAll ? sorted : defaultVisible;

  const totalPages = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = displayRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 空态文案:依次对应 加载中 / 搜索无结果 / 展开后无结果 / 仅展示常见货币 四种情况
  const emptyText = loading
    ? tf('exchange.table.loading', '加载中…')
    : keyword
      ? tf('exchange.table.emptySearch', '没有匹配的货币,换个代码或名称试试')
      : showAll
        ? tf('exchange.table.emptyAll', '无匹配货币')
        : tf(
            'exchange.table.emptyCommon',
            '当前仅展示常见货币\uFF08含收藏\uFF09\uFF0C可点击“展开全部货币”查看全部'
          );

  return (
    <div>
      <div className="exchange-toolbar">
        <input
          className="exchange-search"
          placeholder={tf('exchange.table.searchPlaceholder', '搜索货币代码或名称…')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <span className="exchange-meta">
          <span className="exchange-meta-item">
            {tf('exchange.table.basePrefix', '基准:')} {getCurrencyFlag(base)} {base} (
            {tf(getCurrencyNameKey(base), getCurrencyName(base))})
          </span>
          {date ? <span className="exchange-meta-item">{date}</span> : null}
          <span className="exchange-meta-item">
            <img
              className="exchange-inline-icon"
              src={fromCache ? PACKAGE_ICON_URL : GLOBE_ICON_URL}
              alt=""
              aria-hidden="true"
            />
            {fromCache
              ? tf('exchange.table.fromCache', '缓存')
              : tf('exchange.table.synced', '已同步最新')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            setShowAll((prev) => !prev);
            setPage(1);
          }}
          title={
            showAll
              ? tf('exchange.table.collapseTitle', '仅显示常见货币\uFF08含收藏\uFF09')
              : tf('exchange.table.expandTitle', '展开显示全部货币')
          }
        >
          {showAll
            ? tf('exchange.table.collapse', '收起非常见货币')
            : tf('exchange.table.expand', '展开全部货币')}
        </button>
        <button
          type="button"
          className="exchange-toolbar-btn"
          onClick={onRefresh}
          disabled={loading}
          title={tf('exchange.table.refreshTitle', '刷新汇率')}
        >
          <img
            className="exchange-inline-icon"
            src={CLOUD_SYNC_ICON_URL}
            alt=""
            aria-hidden="true"
          />
          {loading ? tf('exchange.table.loading', '加载中…') : tf('exchange.table.refresh', '刷新')}
        </button>
      </div>

      {error ? (
        <div className="exchange-error">
          {tf('exchange.table.errorPrefix', '错误:')} {error}
          <button type="button" onClick={onRefresh} style={{ marginLeft: 8 }}>
            {tf('exchange.table.retry', '重试')}
          </button>
        </div>
      ) : null}

      <table className="exchange-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>★</th>
            <th>{tf('exchange.table.columnCode', '货币')}</th>
            <th>{tf('exchange.table.columnName', '货币名称')}</th>
            <th style={{ textAlign: 'right' }}>
              {tf('exchange.table.columnRate', '汇率')} (1 {base})
            </th>
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr>
              <td
                colSpan={4}
                style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-tertiary)' }}
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            pageRows.map((rate) => (
              <tr
                key={rate.code}
                className={favorites.includes(rate.code) ? 'exchange-row-fav' : ''}
              >
                <td>
                  <button
                    type="button"
                    className={`exchange-fav-btn${favorites.includes(rate.code) ? ' is-active' : ''}`}
                    onClick={() => toggleFavorite(rate.code)}
                    title={
                      favorites.includes(rate.code)
                        ? tf('exchange.table.favoriteRemove', '取消收藏')
                        : tf('exchange.table.favoriteAdd', '收藏')
                    }
                  >
                    <img
                      className="exchange-inline-icon"
                      src={favorites.includes(rate.code) ? STAR_ICON_URL : STAR_OFF_ICON_URL}
                      alt=""
                      aria-hidden="true"
                    />
                  </button>
                </td>
                <td className="mono-inline">
                  {getCurrencyFlag(rate.code)} {rate.code}
                </td>
                <td>{tf(getCurrencyNameKey(rate.code), rate.name)}</td>
                <td style={{ textAlign: 'right' }} className="mono-inline">
                  <span>{rate.rate.toFixed(rate.rate < 1 ? 6 : 4)}</span>
                  {rate.trend ? (
                    <span className={`exchange-rate-trend exchange-rate-trend-${rate.trend}`}>
                      {TREND_ICON[rate.trend]} {tf(TREND_KEYS[rate.trend], TREND_LABEL[rate.trend])}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {totalPages > 1 ? (
        <div className="exchange-pagination">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            {tf('exchange.table.prevPage', '上一页')}
          </button>
          <span>
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage(safePage + 1)}
          >
            {tf('exchange.table.nextPage', '下一页')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
