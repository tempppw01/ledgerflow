import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

const mocks = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  loginAccount: vi.fn(),
  logoutAccount: vi.fn(),
  registerAccount: vi.fn(),
  updateAccountProfile: vi.fn()
}));

vi.mock('../../../shared/api/authClient', () => mocks);

const user = {
  id: 'auth-user',
  ledgerUserId: 'default',
  email: 'owner@example.com',
  displayName: 'Owner',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  lastLoginAt: '2026-08-01T00:00:00.000Z'
};

describe('AuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows first-account registration when no account exists', async () => {
    mocks.getAuthStatus.mockResolvedValue({
      ok: true,
      authenticated: false,
      registrationOpen: true,
      user: null
    });

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );

    expect(await screen.findByRole('heading', { name: '创建第一个账号' })).toBeInTheDocument();
    expect(screen.queryByText('账本内容')).not.toBeInTheDocument();
  });

  it('renders protected content for an authenticated account', async () => {
    mocks.getAuthStatus.mockResolvedValue({
      ok: true,
      authenticated: true,
      registrationOpen: false,
      user
    });

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );

    expect(await screen.findByText('账本内容')).toBeInTheDocument();
  });

  it('keeps protected content visible while a cached session is revalidated', () => {
    sessionStorage.setItem('ledgerflow-auth-user-cache', JSON.stringify(user));
    mocks.getAuthStatus.mockReturnValue(new Promise(() => undefined));

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );

    expect(screen.getByText('账本内容')).toBeInTheDocument();
    expect(screen.queryByText('正在检查账号状态...')).not.toBeInTheDocument();
  });

  it('logs in and then renders protected content', async () => {
    mocks.getAuthStatus.mockResolvedValue({
      ok: true,
      authenticated: false,
      registrationOpen: false,
      user: null
    });
    mocks.loginAccount.mockResolvedValue({ ok: true, user });
    const actor = userEvent.setup();

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );
    await screen.findByRole('heading', { name: '登录 LedgerFlow' });
    await actor.type(screen.getByLabelText('邮箱'), 'owner@example.com');
    await actor.type(screen.getByLabelText('密码'), 'a-secure-password');
    await actor.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('账本内容')).toBeInTheDocument();
    expect(mocks.loginAccount).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'a-secure-password'
    });
  });
});
