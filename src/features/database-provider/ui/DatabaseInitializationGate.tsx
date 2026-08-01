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

export function DatabaseInitializationGate({ children }: DatabaseInitializationGateProps) {
  const [status, setStatus] = useState<DatabaseSetupStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setStatus(await getDatabaseSetupStatus());
    } catch (reason) {
      setStatus(null);
      setError(reason instanceof Error ? reason.message : '无法连接数据库初始化服务。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (status?.initialized && !status.configurationMismatch) {
    return (
      <AuthGate>
        <SqlDataSyncGate>{children}</SqlDataSyncGate>
      </AuthGate>
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
          <DatabaseProviderSetupPanel onInitialized={setStatus} />
        ) : null}
      </div>
    </main>
  );
}
