import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseInitializationGate } from './DatabaseInitializationGate';

const getDatabaseSetupStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/api/databaseProviderClient', () => ({
  getDatabaseSetupStatus: () => getDatabaseSetupStatusMock(),
  initializeDatabaseProvider: vi.fn()
}));

vi.mock('../../auth/ui/AuthGate', () => ({
  AuthGate: ({ children }: { children: ReactNode }) => children
}));

vi.mock('./SqlDataSyncGate', () => ({
  SqlDataSyncGate: ({ children }: { children: ReactNode }) => children
}));

describe('DatabaseInitializationGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('blocks the application until a database provider is initialized', async () => {
    getDatabaseSetupStatusMock.mockResolvedValue({
      initialized: false,
      provider: null,
      initializedAt: null,
      allowedProviders: ['sqlite'],
      configuredProvider: 'sqlite',
      configurationMismatch: false
    });

    render(
      <DatabaseInitializationGate>
        <div>应用内容</div>
      </DatabaseInitializationGate>
    );

    expect(await screen.findByRole('heading', { name: '初始化数据存储' })).toBeInTheDocument();
    expect(screen.queryByText('应用内容')).not.toBeInTheDocument();
  });

  it('renders the application after a provider has been initialized', async () => {
    getDatabaseSetupStatusMock.mockResolvedValue({
      initialized: true,
      provider: 'sqlite',
      initializedAt: '2026-07-17T00:00:00.000Z',
      allowedProviders: ['sqlite'],
      configuredProvider: 'sqlite',
      configurationMismatch: false
    });

    render(
      <DatabaseInitializationGate>
        <div>应用内容</div>
      </DatabaseInitializationGate>
    );

    await waitFor(() => expect(screen.getByText('应用内容')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: '初始化数据存储' })).not.toBeInTheDocument();
  });
});
