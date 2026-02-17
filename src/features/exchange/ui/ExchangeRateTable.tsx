import { useMemo, useState } from 'react';
import type { ExchangeRate } from '../model/types';
import { getCurrencyFlag, getCurrencyName } from '../model/types';
import { TableSkeleton } from '../../../shared/ui/TableSkeleton';

interface ExchangeRateTableProps {
  rates: ExchangeRate[];
  base: string;
  date: string;
  fromCache: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const ROW_HEIGHT = 46;
const VIEWPORT_HEIGHT = 420;
const OVERSCAN = 6;

const TREND_ICON: Record<NonNullable<ExchangeRate['trend']>, string> = {
  up: '⬆️',
  down: '⬇️',
  flat: '⟷'
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
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ledgerflow-fav-currencies') || '[]');
    } catch {
      return [];
    }
  });
  const [scrollTop, setScrollTop] = useState(0);

  const toggleFavorite = (code: string) => {
    setFavorites((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      localStorage.setItem('ledgerflow-fav-currencies', JSON.stringify(next));
      return next;
    });
  };

  const keyword = search.trim().toLowerCase();
  const filtered = rates.filter(
    (r) => r.code.toLowerCase().includes(keyword) || r.name.toLowerCase().includes(keyword)
  );

  const sorted = [...filtered].sort((a, b) => {
    const aFav = favorites.includes(a.code) ? 0 : 1;
    const bFav = favorites.includes(b.code) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.code.localeCompare(b.code);
  });

  const totalHeight = sorted.length * ROW_HEIGHT;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    sorted.length,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN
  );
  const visibleRows = useMemo(() => sorted.slice(start, end), [end, sorted, start]);

  return (
    <div>
      <div className="exchange-toolbar">
        <input
          className="exchange-search"
          placeholder="搜索货币代码或名称…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="搜索货币"
        />
        <span className="exchange-meta">
          基准: {getCurrencyFlag(base)} {base} ({getCurrencyName(base)}){date ? ` · ${date}` : ''}
          {fromCache ? ' · 📦 缓存' : ''}
        </span>
        <button onClick={onRefresh} disabled={loading} title="刷新汇率" aria-label="刷新汇率">
          🔄 {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {error && (
        <div className="exchange-error">
          ⚠️ {error}
          <button onClick={onRefresh} style={{ marginLeft: 8 }} aria-label="重试刷新汇率">
            重试
          </button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} columns={4} />
      ) : sorted.length === 0 ? (
        <div className="exchange-empty">无匹配货币</div>
      ) : (
        <div className="exchange-virtual-table">
          <div className="exchange-table-head" role="row">
            <span>⭐</span>
            <span>货币</span>
            <span>货币名称</span>
            <span style={{ textAlign: 'right' }}>汇率 (1 {base})</span>
          </div>
          <div
            className="exchange-table-body"
            style={{ height: VIEWPORT_HEIGHT }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            role="list"
            aria-label="汇率列表"
            tabIndex={0}
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
              {visibleRows.map((r, index) => {
                const rowIndex = start + index;
                const top = rowIndex * ROW_HEIGHT;
                const fav = favorites.includes(r.code);
                return (
                  <div
                    key={r.code}
                    className={`exchange-table-row ${fav ? 'exchange-row-fav' : ''}`}
                    style={{ top, height: ROW_HEIGHT }}
                    role="listitem"
                  >
                    <button
                      className="exchange-fav-btn"
                      onClick={() => toggleFavorite(r.code)}
                      title={fav ? '取消收藏' : '收藏'}
                      aria-label={`${fav ? '取消收藏' : '收藏'} ${r.code}`}
                    >
                      {fav ? '⭐' : '☆'}
                    </button>
                    <span className="mono-inline">
                      {getCurrencyFlag(r.code)} {r.code}
                    </span>
                    <span>{r.name}</span>
                    <span style={{ textAlign: 'right' }} className="mono-inline">
                      <span>{r.rate.toFixed(r.rate < 1 ? 6 : 4)}</span>
                      {r.trend ? (
                        <span className={`exchange-rate-trend exchange-rate-trend-${r.trend}`}>
                          {TREND_ICON[r.trend]} {TREND_LABEL[r.trend]}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
