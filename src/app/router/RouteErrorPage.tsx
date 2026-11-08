import { Link, isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface RouteErrorViewProps {
  code: string;
  title: string;
  description: string;
}

function isChunkLoadError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(
    error.message
  );
}

function RouteErrorView({ code, title, description }: RouteErrorViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <main className="route-error" role="alert">
      <div className="route-error-panel">
        <p className="route-error-code" aria-hidden="true">
          {code}
        </p>
        <h1 className="route-error-title">{title}</h1>
        <p className="route-error-description">{description}</p>
        <div className="route-error-actions">
          <Link className="route-error-primary" to="/">
            {t('errors.backHome')}
          </Link>
          <button type="button" className="route-error-secondary" onClick={() => navigate(-1)}>
            {t('errors.backPrevious')}
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * 站内 404:匹配所有未声明的路径,仍然渲染在 AppLayout 内,保留导航。
 */
export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <RouteErrorView
      code="404"
      title={t('errors.notFoundTitle')}
      description={t('errors.notFoundDescription')}
    />
  );
}

/**
 * 根级错误边界:渲染分支抛出异常或懒加载 chunk 失效时接管整页,
 * 避免用户看到 React Router 的开发者报错界面。
 */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  const chunkError = isChunkLoadError(error);

  if (chunkError) {
    return (
      <main className="route-error" role="alert">
        <div className="route-error-panel">
          <p className="route-error-code" aria-hidden="true">
            !
          </p>
          <h1 className="route-error-title">{t('errors.chunkTitle')}</h1>
          <p className="route-error-description">{t('errors.chunkDescription')}</p>
          <div className="route-error-actions">
            <button
              type="button"
              className="route-error-primary"
              onClick={() => window.location.reload()}
            >
              {t('common.retry')}
            </button>
            <Link className="route-error-secondary" to="/">
              {t('errors.backHome')}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <RouteErrorView
      code={isRouteErrorResponse(error) ? String(error.status) : '!'}
      title={isNotFound ? t('errors.notFoundTitle') : t('errors.genericTitle')}
      description={isNotFound ? t('errors.notFoundDescription') : t('errors.genericDescription')}
    />
  );
}
