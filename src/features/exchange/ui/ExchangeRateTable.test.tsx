import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExchangeRateTable } from './ExchangeRateTable';
import type { ExchangeRate } from '../model/types';

const baseProps = {
  base: 'CNY',
  date: '2026-02-15',
  fromCache: false,
  loading: false,
  error: null,
  onRefresh: vi.fn()
};

describe('ExchangeRateTable', () => {
  it('应为涨跌和持平展示对应图标', () => {
    const rates: ExchangeRate[] = [
      { code: 'USD', name: '美元', rate: 0.1399, trend: 'up' },
      { code: 'EUR', name: '欧元', rate: 0.1288, trend: 'down' },
      { code: 'JPY', name: '日元', rate: 21.53, trend: 'flat' }
    ];

    render(<ExchangeRateTable rates={rates} {...baseProps} />);

    expect(screen.getByText('↗ 上涨')).toBeInTheDocument();
    expect(screen.getByText('↘ 下跌')).toBeInTheDocument();
    expect(screen.getByText('→ 持平')).toBeInTheDocument();
  });

  it('首次加载无趋势数据时不展示图标', () => {
    const rates: ExchangeRate[] = [{ code: 'USD', name: '美元', rate: 0.1399 }];

    render(<ExchangeRateTable rates={rates} {...baseProps} />);

    expect(screen.queryByText('上涨')).not.toBeInTheDocument();
    expect(screen.queryByText('下跌')).not.toBeInTheDocument();
    expect(screen.queryByText('持平')).not.toBeInTheDocument();
  });
});
