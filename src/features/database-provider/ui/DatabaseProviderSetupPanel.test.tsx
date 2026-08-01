import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseProviderSetupPanel } from './DatabaseProviderSetupPanel';

const getDatabaseSetupStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/api/databaseProviderClient', () => ({
  getDatabaseSetupStatus: () => getDatabaseSetupStatusMock(),
  initializeDatabaseProvider: vi.fn()
}));

describe('DatabaseProviderSetupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables MySQL before initialization when its connection is not configured', async () => {
    getDatabaseSetupStatusMock.mockResolvedValue({
      initialized: false,
      provider: null,
      initializedAt: null,
      allowedProviders: ['sqlite', 'mysql'],
      providerAvailability: {
        sqlite: { configured: true, message: '' },
        mysql: {
          configured: false,
          message: '未检测到 MySQL 配置，请先设置 MYSQL_URL 或 MYSQL_HOST。'
        }
      },
      configuredProvider: null,
      configurationMismatch: false
    });

    render(<DatabaseProviderSetupPanel />);

    expect(await screen.findByRole('radio', { name: /SQLite/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /MySQL/ })).toBeDisabled();
    expect(screen.getByText('未检测到 MySQL 配置，请先设置 MYSQL_URL 或 MYSQL_HOST。')).toBeVisible();
    expect(screen.getByRole('button', { name: '初始化 SQLite' })).toBeEnabled();
  });
});
