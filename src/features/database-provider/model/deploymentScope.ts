const DEPLOYMENT_STORAGE_KEY = 'ledgerflow-deployment-instance';
const SCOPED_STORAGE_PREFIX = 'ledgerflow-';

function clearScopedStorage(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(SCOPED_STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

export function clearScopedBrowserData() {
  try {
    const deploymentId = window.localStorage.getItem(DEPLOYMENT_STORAGE_KEY);
    clearScopedStorage(window.localStorage);
    clearScopedStorage(window.sessionStorage);
    if (deploymentId) window.localStorage.setItem(DEPLOYMENT_STORAGE_KEY, deploymentId);
  } catch {
    // Storage may be unavailable; callers can still continue with an in-memory reset.
  }
}

/**
 * 新部署可能复用了同一个域名,但数据库是全新的。
 * 这时必须丢弃旧部署的浏览器账本与密钥,否则空数据库会被旧本地数据自动填充。
 */
export function ensureDeploymentScope(
  deploymentId: string | null,
  legacyIdentity?: string | null
): boolean {
  if (!deploymentId) return false;
  try {
    const current = window.localStorage.getItem(DEPLOYMENT_STORAGE_KEY) || legacyIdentity || null;
    if (current === deploymentId) return false;

    if (current && current !== deploymentId) {
      clearScopedStorage(window.localStorage);
      clearScopedStorage(window.sessionStorage);
      window.localStorage.setItem(DEPLOYMENT_STORAGE_KEY, deploymentId);
      return true;
    }

    window.localStorage.setItem(DEPLOYMENT_STORAGE_KEY, deploymentId);
    return false;
  } catch {
    return false;
  }
}
