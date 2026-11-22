import { useTranslation } from 'react-i18next';
import { DATA_INPUT_ILLUSTRATION_URL } from '../../../shared/config/brandAssets';
import { formatCurrencyAuto } from '../../../shared/lib/format';

export interface DashboardWelcomeBannerProps {
  versionLabel: string;
  isExpanded: boolean;
  greeting: string;
  /** 与问候语配对的行动提示,填进 greetingFormat 的 {{action}}。 */
  greetingAction: string;
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
  greetingAction,
  welcomeSubtitle,
  monthlyBalance,
  netAssets,
  tip,
  onToggleExpanded,
  onNavigateToQuickAdd,
  onNavigateToAssistant
}: DashboardWelcomeBannerProps) {
  const { t } = useTranslation();
  // 问候语 = 时间问候 + 一句行动提示。产品名不再缀在后面:
  // 它已经出现在侧边栏、标题和关于页,再出现在大标题里只是重复。
  const greetingText = t('dashboard.ui.greetingFormat', { greeting, action: greetingAction });

  return (
    <section className={`welcome-banner${isExpanded ? ' is-expanded' : ' is-collapsed'}`}>
      <span className="welcome-version-tag" aria-label={versionLabel}>
        v{versionLabel}
      </span>
      {isExpanded ? (
        <div className="welcome-content">
          {/* 三栏:左侧问候与副标题、中部两个口径、右侧操作。
              原来是一条纵向长条从左往右排,内容全挤在左半边,右侧大片留白。 */}
          <div className="welcome-lede">
            <div className="welcome-status-badge">{t('dashboard.ui.statusBadge')}</div>
            <div className="welcome-title-stack">
              <h2 className="welcome-greeting">{greetingText}</h2>
            </div>
            <p className="welcome-subtitle">{welcomeSubtitle}</p>
          </div>
          {/*
            插画与两个数字编成一组:它们是同一个「读数」视觉组,插画只作引子。
            既省掉一列宽度(单独成列时 1280px 下把问候语挤成 3 行),
            也不会像绝对定位那样压在文案或数字上。
          */}
          <div className="welcome-readout">
            <img
              className="welcome-data-illustration"
              src={DATA_INPUT_ILLUSTRATION_URL}
              alt=""
              loading="lazy"
              aria-hidden="true"
            />
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
          </div>
          <div className="welcome-actions">
            <button type="button" onClick={onNavigateToQuickAdd}>
              {t('dashboard.ui.addTransaction')}
            </button>
            <button type="button" onClick={onNavigateToAssistant}>
              {t('dashboard.ui.askAi')}
            </button>
          </div>
          <p className="welcome-tip">{tip}</p>
        </div>
      ) : (
        <div className="welcome-content welcome-content--compact">
          {/* 收起态不放插画:这一行只有问候 + 数字 + 操作,塞一张方图会把它们挤开。 */}
          <div className="welcome-title-stack">
            <h2 className="welcome-greeting">{greetingText}</h2>
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
