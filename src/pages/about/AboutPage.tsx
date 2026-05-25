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
        {
          headers: {
            Accept: 'application/vnd.github+json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(t('about.update.httpError', { status: response.status }));
      }

      const data = (await response.json()) as {
        tag_name?: string;
        html_url?: string;
      };

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
    <section className="panel about-page">
      <header className="about-header about-hero-card">
        <div className="about-hero-copy">
          <div className="about-brand-mark" aria-label="LedgerFlow">
            <img src={APP_LOGO_URL} alt="" />
            <span>LedgerFlow</span>
          </div>
          <h2>{t('about.title')}</h2>
          <p>
            把记账做得更轻，更稳，也更像一个你愿意反复打开的产品，而不是只在月底想起一次的工具。
          </p>
          <div className="about-version-actions">
            <a href={APP_GITHUB_URL} target="_blank" rel="noreferrer">
              {t('about.home.title')}
            </a>
            <a href={`${APP_GITHUB_URL}/releases`} target="_blank" rel="noreferrer">
              {t('about.version.viewReleases')}
            </a>
          </div>
        </div>
      </header>

      <section className="about-block about-version-card">
        <div className="about-block-head">
          <h3>{t('about.version.title')}</h3>
          <button
            type="button"
            className="about-chip about-update-chip"
            onClick={() => void handleCheckUpdate()}
            disabled={updateResult.status === 'checking'}
          >
            {updateResult.status === 'checking'
              ? t('about.update.checkingBtn')
              : t('about.update.check')}
          </button>
        </div>
        <p>
          {t('about.version.current')}：<strong>v{APP_VERSION}</strong>
        </p>
        {updateResult.message ? (
          <p className={`about-update-message ${updateResult.status}`}>{updateResult.message}</p>
        ) : (
          <p className="about-muted-note">
            你可以手动检查最新版本，看看最近新增了哪些更顺手的改动。
          </p>
        )}
        {updateResult.status === 'update-available' && updateResult.latestUrl ? (
          <p>
            <a href={updateResult.latestUrl} target="_blank" rel="noreferrer">
              {t('about.update.goLatest', { version: updateResult.latestVersion })}
            </a>
          </p>
        ) : null}
      </section>

      <section className="about-grid">
        <section className="about-block about-block-featured">
          <div className="about-block-head">
            <h3>{t('about.why.title')}</h3>
            <span className="about-chip">Why</span>
          </div>
          <p>{t('about.why.p1')}</p>
        </section>

        <section className="about-block">
          <div className="about-block-head">
            <h3>{t('about.home.title')}</h3>
            <span className="about-chip">Open</span>
          </div>
          <p>
            GitHub：
            <a href={APP_GITHUB_URL} target="_blank" rel="noreferrer">
              {APP_GITHUB_URL}
            </a>
          </p>
        </section>
      </section>

      <section className="about-grid about-grid-3">
        <section className="about-block">
          <div className="about-block-head">
            <h3>{t('about.principles.title')}</h3>
            <span className="about-chip">Principles</span>
          </div>
          <ul className="about-bullet-list">
            <li>{t('about.principles.l1')}</li>
            <li>{t('about.principles.l2')}</li>
            <li>{t('about.principles.l3')}</li>
          </ul>
        </section>

        <section className="about-block">
          <div className="about-block-head">
            <h3>{t('about.value.title')}</h3>
            <span className="about-chip">Value</span>
          </div>
          <ul className="about-bullet-list">
            <li>{t('about.value.l1')}</li>
            <li>{t('about.value.l2')}</li>
            <li>{t('about.value.l3')}</li>
          </ul>
        </section>

        <section className="about-block">
          <div className="about-block-head">
            <h3>{t('about.privacy.title')}</h3>
            <span className="about-chip">Privacy</span>
          </div>
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
