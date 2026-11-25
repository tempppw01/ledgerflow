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
import { describeAuthError } from '../../../shared/lib/authErrorText';

/**
 * 账号错误的 id。
 *
 * 账号错误**大多是表单级**的:`describeAuthError` 那些是凭据不对/网络不通/服务不可用 ——
 * 分不清是邮箱还是密码错,挂到某个字段上反而是错的,这类保持 role="alert" 即可。
 * 唯一字段级的是「两次新密码不一致」,它明确指向确认密码框。
 */
const AUTH_ERROR_ID = 'auth-error';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { PasswordInput } from '../../../shared/ui/PasswordInput';
import { AuthContext } from './authContext';

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

export function AuthGate({ children }: { children: ReactNode }) {
  const tf = useTFallback();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [resetToken, setResetToken] = useState(readPasswordResetToken);
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /* 只有字段级错误才给值;表单级错误保持 ''。 */
  const [errorField, setErrorField] = useState<'' | 'passwordConfirmation'>('');
  const [notice, setNotice] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setErrorField('');
      const status = await getAuthStatus();
      setUser(status.user);
      setRegistrationOpen(status.registrationOpen);
      setMode((current) =>
        current === 'forgot' || current === 'reset'
          ? current
          : status.registrationOpen
            ? 'register'
            : 'login'
      );
    } catch (reason) {
      // 不能直接把 reason.message 上屏:网络不可达时它是浏览器的
      // `Failed to fetch`,非 2xx 时可能是 `HTTP 503`。见 describeAuthError。
      setError(describeAuthError(reason, tf));
    } finally {
      setLoading(false);
    }
  }, [tf]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setErrorField('');
    setNotice('');

    if (mode === 'reset' && password !== passwordConfirmation) {
      setError(tf('auth.passwordMismatch', '两次输入的新密码不一致。'));
      setErrorField('passwordConfirmation');
      return;
    }

    try {
      setSubmitting(true);

      if (mode === 'forgot') {
        const result = await requestAccountPasswordReset({ email });
        setNotice(
          result.message ||
            tf('auth.resetEmailSent', '如果该邮箱已注册\uFF0C密码重置邮件将在几分钟内送达。')
        );
        return;
      }

      if (mode === 'reset') {
        await resetAccountPassword({ token: resetToken, newPassword: password });
        clearPasswordResetTokenFromUrl();
        setUser(null);
        setResetToken('');
        setPassword('');
        setPasswordConfirmation('');
        setMode('login');
        setNotice(tf('auth.resetSucceeded', '密码已重置\uFF0C请使用新密码登录。'));
        return;
      }

      const result =
        mode === 'register'
          ? await registerAccount({ email, password, displayName })
          : await loginAccount({ email, password });
      setUser(result.user);
      setPassword('');
      /*
       * 登录表单是**就地**渲染在当前路径上的:未登录时打开 `/` 就用 `/` 渲染,登录后 URL 不变、
       * 路由照常工作。但如果用户直接访问了 /login,那个路径**不是应用路由**
       * (src/app/router/router.tsx 里只有通配 404),登录成功后路由会落到「这个页面不存在」
       * —— 用户会以为登录失败了。应用内部没有任何链接指向 /login,所以只有手动访问才会遇到,
       * 但那是个死胡同,值得堵上。
       *
       * 这里用整页跳转而不是 useNavigate:AuthGate 在测试里是不套路由直接渲染的
       * (AuthGate.test.tsx),引 useNavigate 会让整套夹具都得包一层;而这个分支本身只发生在
       * 「手动访问 /login」这条冷路径上,整页跳转的代价可以忽略。
       */
      if (window.location.pathname.replace(/\/+$/, '') === '/login') {
        window.location.replace('/');
        return;
      }
    } catch (reason) {
      setError(describeAuthError(reason, tf));
    } finally {
      setSubmitting(false);
    }
  };

  const logout = useCallback(async () => {
    try {
      await logoutAccount();
    } finally {
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
        <p className="sync-tip">{tf('auth.checkingStatus', '正在检查账号状态...')}</p>
      </main>
    );
  }

  if (user && contextValue && !showingReset) {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  const title =
    mode === 'register'
      ? tf('auth.registerTitle', '创建第一个账号')
      : mode === 'forgot'
        ? tf('auth.forgotTitle', '找回密码')
        : mode === 'reset'
          ? tf('auth.resetTitle', '设置新密码')
          : tf('auth.loginTitle', '登录 LedgerFlow');
  const description =
    mode === 'register'
      ? tf('auth.registerDescription', '该账号将安全接管当前默认账本\uFF0C原有数据不会被删除\u3002')
      : mode === 'forgot'
        ? tf(
            'auth.forgotDescription',
            '输入注册邮箱\uFF0C我们会发送一个 30 分钟内有效的一次性重置链接。'
          )
        : mode === 'reset'
          ? tf(
              'auth.resetDescription',
              '重置链接只能使用一次。设置成功后\uFF0C所有已登录设备都需要重新登录。'
            )
          : tf('auth.loginDescription', '登录后只会加载属于你的账户、交易和财务资料。');
  const submitLabel =
    mode === 'register'
      ? tf('auth.createAccount', '创建账号并接管账本')
      : mode === 'forgot'
        ? tf('auth.sendResetEmail', '发送重置邮件')
        : mode === 'reset'
          ? tf('auth.saveNewPassword', '保存新密码')
          : tf('auth.login', '登录');

  return (
    <main className="auth-gate">
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-card-head">
          <img src={APP_LOGO_URL} alt="" className="auth-logo" />
          <div>
            <p className="auth-kicker">{tf('auth.kicker', 'LEDGERFLOW ACCOUNT')}</p>
            <h1 id="auth-title">{title}</h1>
            <p>{description}</p>
          </div>
        </header>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' ? (
            <label className="field">
              <span>{tf('auth.displayName', '显示名称')}</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={80}
                placeholder={tf('auth.displayNamePlaceholder', '例如：我的账本')}
              />
            </label>
          ) : null}

          {mode !== 'reset' ? (
            <label className="field">
              <span>{tf('auth.email', '邮箱')}</span>
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
                <label htmlFor="auth-password">
                  {mode === 'reset'
                    ? tf('auth.newPassword', '新密码')
                    : tf('auth.password', '密码')}
                </label>
                {mode === 'login' ? (
                  <button
                    type="button"
                    className="auth-forgot-button"
                    onClick={() => {
                      setMode('forgot');
                      setError('');
                      setErrorField('');
                      setNotice('');
                      setPassword('');
                    }}
                  >
                    {tf('auth.forgotButton', '忘记密码?')}
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
                placeholder={tf('auth.passwordPlaceholder', '至少 10 个字符')}
                showLabel={tf('auth.showPassword', '显示密码')}
                hideLabel={tf('auth.hidePassword', '隐藏密码')}
              />
            </div>
          ) : null}

          {mode === 'reset' ? (
            <div className="field">
              <label htmlFor="auth-password-confirmation">
                {tf('auth.passwordConfirmation', '确认新密码')}
              </label>
              <PasswordInput
                id="auth-password-confirmation"
                {...(errorField === 'passwordConfirmation'
                  ? { 'aria-invalid': true as const, 'aria-describedby': AUTH_ERROR_ID }
                  : {})}
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                maxLength={200}
                required
                placeholder={tf('auth.passwordConfirmationPlaceholder', '再次输入新密码')}
                showLabel={tf('auth.showPasswordConfirmation', '显示确认密码')}
                hideLabel={tf('auth.hidePasswordConfirmation', '隐藏确认密码')}
              />
            </div>
          ) : null}

          {error ? (
            <p id={AUTH_ERROR_ID} className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          ) : null}

          <button type="submit" className="primary auth-submit" disabled={submitting}>
            {submitting ? tf('auth.submitting', '请稍候...') : submitLabel}
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
              setErrorField('');
              setNotice('');
              setPassword('');
              setPasswordConfirmation('');
            }}
          >
            {tf('auth.backToLogin', '返回登录')}
          </button>
        ) : registrationOpen ? (
          <button
            type="button"
            className="auth-mode-button"
            onClick={() => {
              setMode((current) => (current === 'register' ? 'login' : 'register'));
              setError('');
              setErrorField('');
              setNotice('');
            }}
          >
            {mode === 'register'
              ? tf('auth.switchToLogin', '已有账号？去登录')
              : tf('auth.createFirstAccount', '创建第一个账号')}
          </button>
        ) : (
          <p className="auth-registration-note">
            {tf('auth.registrationClosed', '当前实例未开放自助注册，请使用已有账号登录。')}
          </p>
        )}

        {error && (mode === 'login' || mode === 'register') ? (
          <button type="button" className="auth-retry-button" onClick={() => void loadStatus()}>
            {tf('auth.retry', '重新检查账号服务')}
          </button>
        ) : null}
      </section>
    </main>
  );
}
