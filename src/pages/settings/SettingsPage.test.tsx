import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { useGlobalMemoryStore } from '../../shared/store/useGlobalMemoryStore';
import { useSmartBudgetStore } from '../../shared/store/useSmartBudgetStore';
import { SettingsPage } from './SettingsPage';

const apiMocks = vi.hoisted(() => ({
  getAccountSessions: vi.fn(),
  resetRelationalData: vi.fn(),
  getRelationalDataStatus: vi.fn()
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'zh' }
  })
}));

vi.mock('../../features/auth/ui/authContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner'
    },
    updateProfile: vi.fn()
  })
}));

vi.mock('../../shared/api/authClient', () => ({
  changeAccountPassword: vi.fn(),
  verifyAccountPassword: vi.fn(),
  getAccountSessions: apiMocks.getAccountSessions,
  revokeAccountSession: vi.fn(),
  revokeOtherAccountSessions: vi.fn()
}));

vi.mock('../../shared/api/relationalDataClient', () => ({
  getRelationalDataStatus: apiMocks.getRelationalDataStatus,
  resetRelationalData: apiMocks.resetRelationalData
}));

describe('SettingsPage data reset', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.getAccountSessions.mockReset().mockResolvedValue({ sessions: [] });
    apiMocks.getRelationalDataStatus.mockReset().mockResolvedValue({
      ok: true,
      hasData: true,
      counts: {
        accounts: 1,
        categories: 2,
        transactions: 3,
        subscriptions: 0,
        debts: 1,
        investment_positions: 1,
        investment_watchlists: 1
      },
      updatedAt: '2026-11-11T00:00:00.000Z'
    });
    apiMocks.resetRelationalData.mockReset().mockResolvedValue({
      ok: true,
      hasData: false,
      counts: {},
      updatedAt: null
    });
  });

  it('confirms the reset, clears every local ledger cache, and reloads', async () => {
    const reloadPage = vi.fn();
    const financeClear = vi.spyOn(useFinanceStore.persist, 'clearStorage');
    const preferencesClear = vi.spyOn(useAppPreferences.persist, 'clearStorage');
    const memoriesClear = vi.spyOn(useGlobalMemoryStore.persist, 'clearStorage');
    const budgetClear = vi.spyOn(useSmartBudgetStore.persist, 'clearStorage');

    render(
      <MemoryRouter>
        <SettingsPage reloadPage={reloadPage} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'settings.workspaces.data' }));

    await waitFor(() => expect(apiMocks.getRelationalDataStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'settings.data.resetButton' }));

    expect(
      screen.getByRole('dialog', { name: 'settings.data.resetConfirmTitle' })
    ).toBeInTheDocument();
    expect(apiMocks.resetRelationalData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.resetConfirmButton' }));

    await waitFor(() => expect(apiMocks.resetRelationalData).toHaveBeenCalledTimes(1));
    expect(financeClear).toHaveBeenCalledTimes(1);
    expect(preferencesClear).toHaveBeenCalledTimes(1);
    expect(memoriesClear).toHaveBeenCalledTimes(1);
    expect(budgetClear).toHaveBeenCalledTimes(1);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
