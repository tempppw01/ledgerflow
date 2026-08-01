import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getAuthStatus,
  loginAccount,
  logoutAccount,
  registerAccount,
  updateAccountProfile,
  type AuthUser
} from '../../../shared/api/authClient';
import { APP_LOGO_URL } from '../../../shared/config/app';
import { PasswordInput } from '../../../shared/ui/PasswordInput';
import { AuthContext } from './authContext';

const AUTH_USER_CACHE_KEY = 'ledgerflow-auth-user-cache';

function readCachedAuthUser(): AuthUser | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_USER_CACHE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as Partial<AuthUser>;
    if (!user.id || !user.email || !user.displayName || !user.ledgerUserId) return null;
    return user as AuthUser;
  } catch {
    return null;
  }
}

function writeCachedAuthUser(user: AuthUser | null) {
  try {
    if (user) {
      window.sessionStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
    } else {
      window.sessionStorage.removeItem(AUTH_USER_CACHE_KEY);
    }
  } catch {
    // The server session remains authoritative when browser storage is unavailable.
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readCachedAuthUser());
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(() => !readCachedAuthUser());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      setLoading(!readCachedAuthUser());
      setError('');
      const status = await getAuthStatus();
      setUser(status.user);
      writeCachedAuthUser(status.user);
      setRegistrationOpen(status.registrationOpen);
      setMode(status.registrationOpen ? 'register' : 'login');
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
    try {
      setSubmitting(true);
      setError('');
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
      setPassword('');
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

  if (loading) {
    return (
      <main className="auth-gate">
        <p className="sync-tip">正在检查账号状态...</p>
      </main>
    );
  }

  if (user && contextValue) {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  return (
    <main className="auth-gate">
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-card-head">
          <img src={APP_LOGO_URL} alt="" className="auth-logo" />
          <div>
            <p className="auth-kicker">LEDGERFLOW ACCOUNT</p>
            <h1 id="auth-title">{mode === 'register' ? '创建第一个账号' : '登录 LedgerFlow'}</h1>
            <p>
              {mode === 'register'
                ? '这个账号会安全接管当前 default 账本，原有数据不会被删除。'
                : '登录后只会加载属于你的账户、交易和财务资料。'}
            </p>
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
                placeholder="例如：我的账本"
              />
            </label>
          ) : null}

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

          <label className="field">
            <span>密码</span>
            <PasswordInput
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={10}
              maxLength={200}
              required
              placeholder="至少 10 个字符"
              showLabel="显示密码"
              hideLabel="隐藏密码"
            />
          </label>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="primary auth-submit" disabled={submitting}>
            {submitting ? '请稍候...' : mode === 'register' ? '创建账号并接管账本' : '登录'}
          </button>
        </form>

        {registrationOpen ? (
          <button
            type="button"
            className="auth-mode-button"
            onClick={() => {
              setMode((current) => (current === 'register' ? 'login' : 'register'));
              setError('');
            }}
          >
            {mode === 'register' ? '已有账号？去登录' : '创建第一个账号'}
          </button>
        ) : null}

        {error ? (
          <button type="button" className="auth-retry-button" onClick={() => void loadStatus()}>
            重新检查账号服务
          </button>
        ) : null}
      </section>
    </main>
  );
}
