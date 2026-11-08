import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      resolvedLanguage: 'zh'
    },
    t: (key: string) => {
      const map: Record<string, string> = {
        'dashboard.ui.welcome': '欢迎使用 LedgerFlow',
        'dashboard.ui.corePanel': '核心资产仪表盘'
      };
      return map[key] || key;
    }
  })
}));

describe('DashboardPage', () => {
  it('应渲染仪表盘核心区块', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/今天的钱花在哪/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '核心资产仪表盘' })).toBeInTheDocument();
  });
});
