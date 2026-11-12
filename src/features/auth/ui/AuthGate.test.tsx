import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

const mocks = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  loginAccount: vi.fn(),
  logoutAccount: vi.fn(),
  registerAccount: vi.fn(),
  requestAccountPasswordReset: vi.fn(),
  resetAccountPassword: vi.fn(),
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
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
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

  it('does not render protected content while the server session is being checked', () => {
    localStorage.setItem('ledgerflow-auth-user-cache', JSON.stringify(user));
    mocks.getAuthStatus.mockReturnValue(new Promise(() => undefined));

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );

    expect(screen.queryByText('账本内容')).not.toBeInTheDocument();
    expect(screen.getByText('正在检查账号状态...')).toBeInTheDocument();
  });

  it('does not render protected content when session revalidation fails', async () => {
    localStorage.setItem('ledgerflow-auth-user-cache', JSON.stringify(user));
    mocks.getAuthStatus.mockRejectedValue(new Error('network unavailable'));

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );

    expect(screen.queryByText('账本内容')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.getAuthStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: '登录 LedgerFlow' })).toBeInTheDocument();
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

  it('requests a password reset email from the login form', async () => {
    mocks.getAuthStatus.mockResolvedValue({
      ok: true,
      authenticated: false,
      registrationOpen: false,
      user: null
    });
    mocks.requestAccountPasswordReset.mockResolvedValue({
      ok: true,
      message: '如果该邮箱已注册,密码重置邮件将在几分钟内送达。'
    });
    const actor = userEvent.setup();

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );
    await screen.findByRole('heading', { name: '登录 LedgerFlow' });
    await actor.click(screen.getByRole('button', { name: '忘记密码?' }));
    expect(await screen.findByRole('heading', { name: '找回密码' })).toBeInTheDocument();

    await actor.type(screen.getByLabelText('邮箱'), 'owner@example.com');
    await actor.click(screen.getByRole('button', { name: '发送重置邮件' }));

    expect(mocks.requestAccountPasswordReset).toHaveBeenCalledWith({
      email: 'owner@example.com'
    });
    expect(
      await screen.findByText('如果该邮箱已注册,密码重置邮件将在几分钟内送达。')
    ).toBeInTheDocument();
  });

  it('sets a new password from a reset link and returns to login', async () => {
    window.history.replaceState({}, '', '/?resetToken=reset-token-from-email');
    mocks.getAuthStatus.mockResolvedValue({
      ok: true,
      authenticated: false,
      registrationOpen: false,
      user: null
    });
    mocks.resetAccountPassword.mockResolvedValue({ ok: true });
    const actor = userEvent.setup();

    render(
      <AuthGate>
        <div>账本内容</div>
      </AuthGate>
    );
    expect(await screen.findByRole('heading', { name: '设置新密码' })).toBeInTheDocument();

    await actor.type(screen.getByLabelText('新密码'), 'new-secure-password');
    await actor.type(screen.getByLabelText('确认新密码'), 'new-secure-password');
    await actor.click(screen.getByRole('button', { name: '保存新密码' }));

    expect(mocks.resetAccountPassword).toHaveBeenCalledWith({
      token: 'reset-token-from-email',
      newPassword: 'new-secure-password'
    });
    expect(await screen.findByRole('heading', { name: '登录 LedgerFlow' })).toBeInTheDocument();
    expect(screen.getByText('密码已重置,请使用新密码登录。')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});
