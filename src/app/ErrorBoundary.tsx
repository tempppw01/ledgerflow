import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18next from 'i18next';

/**
 * 应用级错误边界。
 *
 * 为什么需要它:此前整个应用**没有**任何错误边界 —— `main.tsx` 只挂了 `<StrictMode>`,
 * `App.tsx` 只有 `<Suspense>`(它管加载,不管抛错)。于是**任何组件运行时抛错都会让整棵树卸载**,
 * 用户看到的是一片白屏:没有提示、没有按钮、不知道发生了什么。
 *
 * 更糟的是,如果错误是**确定的**(比如某条数据形状不对,每次渲染都抛),刷新后还是白屏 ——
 * 用户连"进设置去修数据"的入口都没有,账本等于被锁死在白屏里。
 *
 * 这个边界把那种状态变成**可恢复**的:一句说明 + 一个「重新加载」按钮 + 可折叠的失败详情。
 * 它**不改变任何业务语义**,只是安全网。
 *
 * 两个刻意的选择:
 *  · **样式全部内联** —— 崩溃时最可能的原因之一就是样式/资源没加载,崩溃页不能依赖应用的 CSS;
 *  · 文案走 `i18next.t` 且**自带 defaultValue** —— 万一 i18n 本身出问题,界面仍然显示中文兜底。
 */
interface ErrorBoundaryState {
  error: Error | null;
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: '#0b0b0f',
    color: '#f4f4f5',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
  },
  card: {
    maxWidth: '520px',
    width: '100%',
    background: '#16161d',
    border: '1px solid #2a2a35',
    borderRadius: '12px',
    padding: '28px'
  },
  title: { margin: '0 0 12px', fontSize: '20px', fontWeight: 600 },
  hint: { margin: '0 0 20px', fontSize: '14px', lineHeight: 1.6, color: '#a1a1aa' },
  button: {
    appearance: 'none',
    border: 'none',
    borderRadius: '8px',
    background: '#f59e0b',
    color: '#1c1917',
    fontSize: '14px',
    fontWeight: 600,
    padding: '10px 18px',
    cursor: 'pointer'
  },
  details: { marginTop: '20px', fontSize: '12px', color: '#71717a' },
  pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '8px 0 0' }
} as const;

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 留在控制台供排查;不要静默吞掉 —— 那会让"白屏但没线索"重演。
    console.error('[LedgerFlow] 渲染出错,已由错误边界接住:', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    /*
     * 取文案:能取到真翻译就用,取不到(没初始化 / 缺键 / i18n 自己挂了)就用写死的兜底。
     * 不用 i18next 的 defaultValue 选项 —— 实测在没有 init 的环境里它返回的是空串,
     * 而崩溃页最不能接受的就是"标题是空的"。
     */
    const t = (key: string, fallback: string) => {
      try {
        const value = i18next.t(key);
        return typeof value === 'string' && value.length > 0 && value !== key ? value : fallback;
      } catch {
        return fallback;
      }
    };

    return (
      <div style={styles.wrapper} role="alert">
        <div style={styles.card}>
          <h1 style={styles.title}>{t('crashScreen.title', '页面出错了')}</h1>
          <p style={styles.hint}>
            {t(
              'crashScreen.hint',
              '你的数据都还在本地,这只是界面渲染出了问题。重新加载通常就能恢复。'
            )}
          </p>
          <button type="button" style={styles.button} onClick={this.reload}>
            {t('crashScreen.reload', '重新加载')}
          </button>
          <details style={styles.details}>
            <summary>{t('crashScreen.details', '失败详情')}</summary>
            <pre style={styles.pre}>{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}