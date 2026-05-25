import { DATA_INPUT_ILLUSTRATION_URL } from '../../../shared/config/brandAssets';
import { formatCurrency } from '../../../shared/lib/format';

export interface DashboardWelcomeBannerProps {
  versionLabel: string;
  isExpanded: boolean;
  greeting: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  monthlyBalance: number;
  netAssets: number;
  tip: string;
  onToggleExpanded: () => void;
  onNavigateToQuickAdd: () => void;
  onNavigateToAssistant: () => void;
}

export function DashboardWelcomeBanner({
  versionLabel,
  isExpanded,
  greeting,
  welcomeTitle,
  welcomeSubtitle,
  monthlyBalance,
  netAssets,
  tip,
  onToggleExpanded,
  onNavigateToQuickAdd,
  onNavigateToAssistant
}: DashboardWelcomeBannerProps) {
  return (
    <section className={`welcome-banner${isExpanded ? ' is-expanded' : ' is-collapsed'}`}>
      <span className="welcome-version-tag" aria-label={versionLabel}>
        v{versionLabel}
      </span>
      {isExpanded ? (
        <div className="welcome-content">
          <div className="welcome-status-badge">今天也适合把账说清楚 ✨</div>
          <div className="welcome-title-stack">
            <h2 className="welcome-greeting">
              {greeting}，{welcomeTitle}
            </h2>
            <img
              className="welcome-data-illustration"
              src={DATA_INPUT_ILLUSTRATION_URL}
              alt=""
              loading="lazy"
              aria-hidden="true"
            />
          </div>
          <p className="welcome-subtitle">{welcomeSubtitle}</p>
          <div className="welcome-highlight-grid" aria-label="首页欢迎摘要">
            <article>
              <span>本月结余</span>
              <strong>{formatCurrency(monthlyBalance)}</strong>
            </article>
            <article>
              <span>当前净资产</span>
              <strong>{formatCurrency(netAssets)}</strong>
            </article>
          </div>
          <p className="welcome-tip">💡 {tip}</p>
          <div className="welcome-actions">
            <button type="button" onClick={onNavigateToQuickAdd}>
              记一笔
            </button>
            <button type="button" onClick={onNavigateToAssistant}>
              去问 AI 助手
            </button>
          </div>
        </div>
      ) : (
        <div className="welcome-content welcome-content--compact">
          <div className="welcome-title-stack">
            <h2
              className="welcome-greeting"
              style={{ marginBottom: 0, fontSize: 'clamp(18px, 2.5vw, 22px)' }}
            >
              {greeting}，{welcomeTitle}
            </h2>
            <img
              className="welcome-data-illustration"
              src={DATA_INPUT_ILLUSTRATION_URL}
              alt=""
              loading="lazy"
              aria-hidden="true"
            />
          </div>
          <div className="welcome-highlight-grid" aria-label="首页欢迎摘要">
            <article>
              <span>本月结余</span>
              <strong>{formatCurrency(monthlyBalance)}</strong>
            </article>
            <article>
              <span>当前净资产</span>
              <strong>{formatCurrency(netAssets)}</strong>
            </article>
          </div>
          <div className="welcome-actions">
            <button type="button" onClick={onNavigateToQuickAdd}>
              记一笔
            </button>
            <button type="button" onClick={onNavigateToAssistant}>
              去问 AI 助手
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="welcome-toggle-btn"
        onClick={onToggleExpanded}
        aria-label={isExpanded ? '收起欢迎横幅' : '展开欢迎横幅'}
      >
        {isExpanded ? '▴' : '▾'}
      </button>
      {isExpanded ? <div className="welcome-emoji">💰</div> : null}
    </section>
  );
}
