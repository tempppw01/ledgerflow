import { useTranslation } from 'react-i18next';
import { DATA_INPUT_ILLUSTRATION_URL } from '../../../shared/config/brandAssets';
import { formatCurrencyAuto } from '../../../shared/lib/format';

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
  const { t } = useTranslation();

  return (
    <section className={`welcome-banner${isExpanded ? ' is-expanded' : ' is-collapsed'}`}>
      <span className="welcome-version-tag" aria-label={versionLabel}>
        v{versionLabel}
      </span>
      {isExpanded ? (
        <div className="welcome-content">
          <div className="welcome-status-badge">{t('dashboard.ui.statusBadge')}</div>
          <div className="welcome-title-stack">
            <h2 className="welcome-greeting">
              {t('dashboard.ui.greetingFormat', { greeting, welcomeTitle })}
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
          <div
            className="welcome-highlight-grid"
            aria-label={t('dashboard.ui.welcomeSummaryAria')}
          >
            <article>
              <span>{t('dashboard.ui.monthlyBalance')}</span>
              <strong>{formatCurrencyAuto(monthlyBalance)}</strong>
            </article>
            <article>
              <span>{t('dashboard.ui.netAssets')}</span>
              <strong>{formatCurrencyAuto(netAssets)}</strong>
            </article>
          </div>
          <p className="welcome-tip">💡 {tip}</p>
          <div className="welcome-actions">
            <button type="button" onClick={onNavigateToQuickAdd}>
              {t('dashboard.ui.addTransaction')}
            </button>
            <button type="button" onClick={onNavigateToAssistant}>
              {t('dashboard.ui.askAi')}
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
              {t('dashboard.ui.greetingFormat', { greeting, welcomeTitle })}
            </h2>
            <img
              className="welcome-data-illustration"
              src={DATA_INPUT_ILLUSTRATION_URL}
              alt=""
              loading="lazy"
              aria-hidden="true"
            />
          </div>
          <div
            className="welcome-highlight-grid"
            aria-label={t('dashboard.ui.welcomeSummaryAria')}
          >
            <article>
              <span>{t('dashboard.ui.monthlyBalance')}</span>
              <strong>{formatCurrencyAuto(monthlyBalance)}</strong>
            </article>
            <article>
              <span>{t('dashboard.ui.netAssets')}</span>
              <strong>{formatCurrencyAuto(netAssets)}</strong>
            </article>
          </div>
          <div className="welcome-actions">
            <button type="button" onClick={onNavigateToQuickAdd}>
              {t('dashboard.ui.addTransaction')}
            </button>
            <button type="button" onClick={onNavigateToAssistant}>
              {t('dashboard.ui.askAi')}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="welcome-toggle-btn"
        onClick={onToggleExpanded}
        aria-label={
          isExpanded ? t('dashboard.ui.collapseWelcome') : t('dashboard.ui.expandWelcome')
        }
      >
        {isExpanded ? '▴' : '▾'}
      </button>
    </section>
  );
}
