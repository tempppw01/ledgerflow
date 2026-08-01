import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  getDatabaseSetupStatus,
  type DatabaseSetupStatus
} from '../../../shared/api/databaseProviderClient';
import { DatabaseProviderSetupPanel } from './DatabaseProviderSetupPanel';
import { SqlDataSyncGate } from './SqlDataSyncGate';
import { AuthGate } from '../../auth/ui/AuthGate';

interface DatabaseInitializationGateProps {
  children: ReactNode;
}

const DATABASE_STATUS_CACHE_KEY = 'ledgerflow-database-status-cache';

function readCachedStatus(): DatabaseSetupStatus | null {
  try {
    const raw =
      window.localStorage.getItem(DATABASE_STATUS_CACHE_KEY) ||
      window.sessionStorage.getItem(DATABASE_STATUS_CACHE_KEY);
    if (!raw) return null;
    const status = JSON.parse(raw) as DatabaseSetupStatus;
    if (!status.initialized || status.configurationMismatch) return null;
    window.localStorage.setItem(DATABASE_STATUS_CACHE_KEY, JSON.stringify(status));
    window.sessionStorage.removeItem(DATABASE_STATUS_CACHE_KEY);
    return status;
  } catch {
    return null;
  }
}

function writeCachedStatus(status: DatabaseSetupStatus) {
  try {
    if (status.initialized && !status.configurationMismatch) {
      window.localStorage.setItem(DATABASE_STATUS_CACHE_KEY, JSON.stringify(status));
      window.sessionStorage.removeItem(DATABASE_STATUS_CACHE_KEY);
    } else {
      window.localStorage.removeItem(DATABASE_STATUS_CACHE_KEY);
      window.sessionStorage.removeItem(DATABASE_STATUS_CACHE_KEY);
    }
  } catch {
    // The setup endpoint remains authoritative when browser storage is unavailable.
  }
}

export function DatabaseInitializationGate({ children }: DatabaseInitializationGateProps) {
  const [status, setStatus] = useState<DatabaseSetupStatus | null>(() => readCachedStatus());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => !readCachedStatus());

  const loadStatus = useCallback(async () => {
    try {
      setLoading(!readCachedStatus());
      setError('');
      const nextStatus = await getDatabaseSetupStatus();
      writeCachedStatus(nextStatus);
      setStatus(nextStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接数据库初始化服务。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleInitialized = (nextStatus: DatabaseSetupStatus) => {
    writeCachedStatus(nextStatus);
    setStatus(nextStatus);
  };

  if (status?.initialized && !status.configurationMismatch) {
    return (
      <>
        <AuthGate>
          <SqlDataSyncGate>{children}</SqlDataSyncGate>
        </AuthGate>
        {error ? (
          <div className="sql-sync-notice is-error" role="status" aria-live="polite">
            <span className="sql-sync-notice-dot" aria-hidden="true" />
            <span>数据库状态检查暂时失败，已继续使用上次确认的配置。</span>
            <button type="button" onClick={() => void loadStatus()}>
              重试
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <main className="database-initialization-gate">
      <div className="database-initialization-gate-inner">
        <header className="database-initialization-gate-head">
          <h1>初始化数据存储</h1>
          <p>完成数据库类型初始化后，才能使用 LedgerFlow 的记账、分析和备份功能。</p>
        </header>

        {loading ? <p className="sync-tip">正在检查数据库初始化状态...</p> : null}
        {error ? (
          <section className="panel database-initialization-error">
            <p>{error}</p>
            <button type="button" onClick={() => void loadStatus()}>
              重新检查
            </button>
          </section>
        ) : null}
        {status?.configurationMismatch ? (
          <section className="panel database-initialization-error">
            <p>部署环境指定的数据库类型与已锁定类型不一致，必须恢复部署配置或迁移到新实例。</p>
          </section>
        ) : null}
        {status && !status.initialized ? (
          <DatabaseProviderSetupPanel onInitialized={handleInitialized} />
        ) : null}
      </div>
    </main>
  );
}
