import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_GITHUB_URL, APP_LOGO_URL, APP_VERSION } from '../../shared/config/app';

interface UpdateCheckResult {
  status: 'idle' | 'checking' | 'error' | 'up-to-date' | 'update-available';
  message: string;
  latestVersion?: string;
  latestUrl?: string;
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, '').split('-')[0] || '0';
}

function compareVersion(a: string, b: string) {
  const left = normalizeVersion(a)
    .split('.')
    .map((item) => Number(item) || 0);
  const right = normalizeVersion(b)
    .split('.')
    .map((item) => Number(item) || 0);

  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

export function AboutPage() {
  const { t } = useTranslation();
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult>({
    status: 'idle',
    message: ''
  });

  const handleCheckUpdate = async () => {
    setUpdateResult({ status: 'checking', message: t('about.update.checking') });
    try {
      const response = await fetch(
        'https://api.github.com/repos/tempppw01/ledgerflow/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' } }
      );

      if (!response.ok) {
        throw new Error(t('about.update.httpError', { status: response.status }));
      }

      const data = (await response.json()) as { tag_name?: string; html_url?: string };
      const latestTag = data.tag_name || '';
      if (!latestTag) {
        throw new Error(t('about.update.noVersion'));
      }

      const cmp = compareVersion(APP_VERSION, latestTag);
      if (cmp >= 0) {
        setUpdateResult({
          status: 'up-to-date',
          message: t('about.update.latest', { version: APP_VERSION }),
          latestVersion: latestTag,
          latestUrl: data.html_url
        });
        return;
      }

      setUpdateResult({
        status: 'update-available',
        message: t('about.update.available', { version: latestTag }),
        latestVersion: latestTag,
        latestUrl: data.html_url
      });
    } catch (error) {
      setUpdateResult({
        status: 'error',
        message: error instanceof Error ? error.message : t('about.update.failed')
      });
    }
  };

  return (
    <section className="about-page">
      <header className="about-console-header">
        <div>
          <p className="about-console-eyebrow">{t('about.kicker')}</p>
          <div className="about-product-title">
            <img src={APP_LOGO_URL} alt="" />
            <h1>LedgerFlow</h1>
          </div>
          <p>{t('about.intro')}</p>
        </div>
        <div className="about-console-stat">
          <strong>v{APP_VERSION}</strong>
          <span>{t('about.version.current')}</span>
        </div>
      </header>

      <section className="about-workspace" aria-labelledby="about-product-heading">
        <div className="about-workspace-head">
          <div>
            <p className="about-section-label">{t('about.version.title')}</p>
            <h2 id="about-product-heading">{t('about.title')}</h2>
            <p>{t('about.update.idle')}</p>
          </div>
          <button
            type="button"
            className="about-update-button"
            onClick={() => void handleCheckUpdate()}
            disabled={updateResult.status === 'checking'}
          >
            {updateResult.status === 'checking'
              ? t('about.update.checkingBtn')
              : t('about.update.check')}
          </button>
        </div>

        {updateResult.message ? (
          <div className={`about-update-result ${updateResult.status}`} role="status">
            <p>{updateResult.message}</p>
            {updateResult.status === 'update-available' && updateResult.latestUrl ? (
              <a href={updateResult.latestUrl} target="_blank" rel="noreferrer">
                {t('about.update.goLatest', { version: updateResult.latestVersion })}
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="about-content-section about-foundation-grid">
        <section className="about-subsection">
          <p className="about-section-label">{t('about.why.title')}</p>
          <h2>{t('about.why.p2')}</h2>
          <p>{t('about.why.p1')}</p>
        </section>

        <section className="about-subsection about-open-source">
          <p className="about-section-label">{t('about.home.title')}</p>
          <h2>{t('about.openSource.title')}</h2>
          <p>{t('about.openSource.description')}</p>
          <div className="about-link-row">
            <a href={APP_GITHUB_URL} target="_blank" rel="noreferrer">
              {t('about.home.title')}
            </a>
            <a href={`${APP_GITHUB_URL}/releases`} target="_blank" rel="noreferrer">
              {t('about.version.viewReleases')}
            </a>
          </div>
        </section>
      </section>

      <section className="about-content-section about-principles-grid">
        <section className="about-subsection">
          <p className="about-section-label">{t('about.principles.title')}</p>
          <ul className="about-bullet-list">
            <li>{t('about.principles.l1')}</li>
            <li>{t('about.principles.l2')}</li>
            <li>{t('about.principles.l3')}</li>
          </ul>
        </section>

        <section className="about-subsection">
          <p className="about-section-label">{t('about.value.title')}</p>
          <ul className="about-bullet-list">
            <li>{t('about.value.l1')}</li>
            <li>{t('about.value.l2')}</li>
            <li>{t('about.value.l3')}</li>
          </ul>
        </section>

        <section className="about-subsection">
          <p className="about-section-label">{t('about.privacy.title')}</p>
          <ul className="about-bullet-list">
            <li>{t('about.privacy.l1')}</li>
            <li>{t('about.privacy.l2')}</li>
            <li>{t('about.privacy.l3')}</li>
          </ul>
        </section>
      </section>
    </section>
  );
}
