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
        'dashboard.ui.welcomeSubtitle': '本月的收支、结余和去向,一屏看完。',
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

    expect(screen.getByText(/本月的收支、结余和去向/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '核心资产仪表盘' })).toBeInTheDocument();
  });
});
