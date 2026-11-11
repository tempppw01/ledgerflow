import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getAuthStatus,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestAccountPasswordReset,
  resetAccountPassword,
  updateAccountProfile,
  type AuthUser
} from '../../../shared/api/authClient';
import { APP_LOGO_URL } from '../../../shared/config/app';
import { PasswordInput } from '../../../shared/ui/PasswordInput';
import { AuthContext } from './authContext';

const AUTH_USER_CACHE_KEY = 'ledgerflow-auth-user-cache';
type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

function readPasswordResetToken() {
  try {
    return new URLSearchParams(window.location.search).get('resetToken')?.trim() || '';
  } catch {
    return '';
  }
}

function clearPasswordResetTokenFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('resetToken')) return;
    url.searchParams.delete('resetToken');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The reset form can still complete if the browser blocks history updates.
  }
}

function readCachedAuthUser(): AuthUser | null {
  try {
    const raw =
      window.localStorage.getItem(AUTH_USER_CACHE_KEY) ||
      window.sessionStorage.getItem(AUTH_USER_CACHE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as Partial<AuthUser>;
    if (!user.id || !user.email || !user.displayName || !user.ledgerUserId) return null;
    window.localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
    window.sessionStorage.removeItem(AUTH_USER_CACHE_KEY);
    return user as AuthUser;
  } catch {
    return null;
  }
}

function writeCachedAuthUser(user: AuthUser | null) {
  try {
    if (user) {
      window.localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
      window.sessionStorage.removeItem(AUTH_USER_CACHE_KEY);
    } else {
      window.localStorage.removeItem(AUTH_USER_CACHE_KEY);
      window.sessionStorage.removeItem(AUTH_USER_CACHE_KEY);
    }
  } catch {
    // The server session remains authoritative when browser storage is unavailable.
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readCachedAuthUser());
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [resetToken, setResetToken] = useState(readPasswordResetToken);
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(() => !readCachedAuthUser());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      setLoading(!readCachedAuthUser());
      setError('');
      const status = await getAuthStatus();
      setUser(status.user);
      writeCachedAuthUser(status.user);
      setRegistrationOpen(status.registrationOpen);
      setMode((current) =>
        current === 'forgot' || current === 'reset'
          ? current
          : status.registrationOpen
            ? 'register'
            : 'login'
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接账号服务。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (mode === 'reset' && password !== passwordConfirmation) {
      setError('两次输入的新密码不一致。');
      return;
    }

    try {
      setSubmitting(true);

      if (mode === 'forgot') {
        const result = await requestAccountPasswordReset({ email });
        setNotice(result.message || '如果该邮箱已注册,密码重置邮件将在几分钟内送达。');
        return;
      }

      if (mode === 'reset') {
        await resetAccountPassword({ token: resetToken, newPassword: password });
        clearPasswordResetTokenFromUrl();
        writeCachedAuthUser(null);
        setUser(null);
        setResetToken('');
        setPassword('');
        setPasswordConfirmation('');
        setMode('login');
        setNotice('密码已重置,请使用新密码登录。');
        return;
      }

      const result =
        mode === 'register'
          ? await registerAccount({ email, password, displayName })
          : await loginAccount({ email, password });
      setUser(result.user);
      writeCachedAuthUser(result.user);
      setPassword('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '账号操作失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const logout = useCallback(async () => {
    try {
      await logoutAccount();
    } finally {
      writeCachedAuthUser(null);
      setUser(null);
      setMode('login');
      setResetToken('');
      setPassword('');
      setPasswordConfirmation('');
    }
  }, []);

  const updateProfile = useCallback(async (input: { displayName: string }) => {
    const result = await updateAccountProfile(input);
    setUser(result.user);
    writeCachedAuthUser(result.user);
    return result.user;
  }, []);

  const contextValue = useMemo(
    () => (user ? { user, logout, updateProfile } : null),
    [logout, updateProfile, user]
  );

  const showingReset = mode === 'reset' && Boolean(resetToken);

  if (loading && !showingReset) {
    return (
      <main className="auth-gate">
        <p className="sync-tip">正在检查账号状态...</p>
      </main>
    );
  }

  if (user && contextValue && !showingReset) {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  const title =
    mode === 'register'
      ? '创建第一个账号'
      : mode === 'forgot'
        ? '找回密码'
        : mode === 'reset'
          ? '设置新密码'
          : '登录 LedgerFlow';
  const description =
    mode === 'register'
      ? '这个账号会安全接管当前 default 账本,原有数据不会被删除。'
      : mode === 'forgot'
        ? '输入注册邮箱,我们会发送一个 30 分钟内有效的一次性重置链接。'
        : mode === 'reset'
          ? '重置链接只能使用一次。设置成功后,所有已登录设备都需要重新登录。'
          : '登录后只会加载属于你的账户、交易和财务资料。';
  const submitLabel =
    mode === 'register'
      ? '创建账号并接管账本'
      : mode === 'forgot'
        ? '发送重置邮件'
        : mode === 'reset'
          ? '保存新密码'
          : '登录';

  return (
    <main className="auth-gate">
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-card-head">
          <img src={APP_LOGO_URL} alt="" className="auth-logo" />
          <div>
            <p className="auth-kicker">LEDGERFLOW ACCOUNT</p>
            <h1 id="auth-title">{title}</h1>
            <p>{description}</p>
          </div>
        </header>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' ? (
            <label className="field">
              <span>显示名称</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={80}
                placeholder="例如:我的账本"
              />
            </label>
          ) : null}

          {mode !== 'reset' ? (
            <label className="field">
              <span>邮箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputMode="email"
                required
                placeholder="name@example.com"
              />
            </label>
          ) : null}

          {mode !== 'forgot' ? (
            <div className="field">
              <div className="auth-field-head">
                <label htmlFor="auth-password">{mode === 'reset' ? '新密码' : '密码'}</label>
                {mode === 'login' ? (
                  <button
                    type="button"
                    className="auth-forgot-button"
                    onClick={() => {
                      setMode('forgot');
                      setError('');
                      setNotice('');
                      setPassword('');
                    }}
                  >
                    忘记密码?
                  </button>
                ) : null}
              </div>
              <PasswordInput
                id="auth-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'
                }
                minLength={10}
                maxLength={200}
                required
                placeholder="至少 10 个字符"
                showLabel="显示密码"
                hideLabel="隐藏密码"
              />
            </div>
          ) : null}

          {mode === 'reset' ? (
            <div className="field">
              <label htmlFor="auth-password-confirmation">确认新密码</label>
              <PasswordInput
                id="auth-password-confirmation"
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                maxLength={200}
                required
                placeholder="再次输入新密码"
                showLabel="显示确认密码"
                hideLabel="隐藏确认密码"
              />
            </div>
          ) : null}

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          ) : null}

          <button type="submit" className="primary auth-submit" disabled={submitting}>
            {submitting ? '请稍候...' : submitLabel}
          </button>
        </form>

        {mode === 'forgot' || mode === 'reset' ? (
          <button
            type="button"
            className="auth-mode-button"
            onClick={() => {
              clearPasswordResetTokenFromUrl();
              setMode('login');
              setResetToken('');
              setError('');
              setNotice('');
              setPassword('');
              setPasswordConfirmation('');
            }}
          >
            返回登录
          </button>
        ) : registrationOpen ? (
          <button
            type="button"
            className="auth-mode-button"
            onClick={() => {
              setMode((current) => (current === 'register' ? 'login' : 'register'));
              setError('');
              setNotice('');
            }}
          >
            {mode === 'register' ? '已有账号?去登录' : '创建第一个账号'}
          </button>
        ) : (
          <p className="auth-registration-note">当前实例未开放自助注册,请使用已有账号登录。</p>
        )}

        {error && (mode === 'login' || mode === 'register') ? (
          <button type="button" className="auth-retry-button" onClick={() => void loadStatus()}>
            重新检查账号服务
          </button>
        ) : null}
      </section>
    </main>
  );
}
