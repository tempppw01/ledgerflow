import { useEffect, useState } from 'react';
import {
  type DatabaseProvider,
  getDatabaseSetupStatus,
  initializeDatabaseProvider,
  type DatabaseSetupStatus
} from '../../../shared/api/databaseProviderClient';

const PROVIDER_COPY: Record<DatabaseProvider, { label: string; description: string }> = {
  sqlite: {
    label: 'SQLite',
    description: '适合单机和轻量自托管，数据保存为部署卷中的文件。'
  },
  mysql: {
    label: 'MySQL',
    description: '适合阿里云 RDS、多设备同步和后续多用户部署。'
  }
};

interface DatabaseProviderSetupPanelProps {
  onInitialized?: (status: DatabaseSetupStatus) => void;
}

function formatProvider(provider: DatabaseProvider | null) {
  return provider ? PROVIDER_COPY[provider].label : '未初始化';
}

export function DatabaseProviderSetupPanel({ onInitialized }: DatabaseProviderSetupPanelProps) {
  const [status, setStatus] = useState<DatabaseSetupStatus | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<DatabaseProvider>('sqlite');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const isReady = Boolean(status);
  const providerChoices = (status?.allowedProviders || []).filter(
    (provider): provider is DatabaseProvider => provider in PROVIDER_COPY
  );

  useEffect(() => {
    let active = true;
    void getDatabaseSetupStatus()
      .then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setSelectedProvider((current) =>
          nextStatus.allowedProviders.includes(current)
            ? current
            : nextStatus.allowedProviders[0] || 'sqlite'
        );
      })
      .catch((error) => {
        if (active) {
          setMessage(error instanceof Error ? error.message : '无法读取数据库初始化状态。');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleInitialize() {
    if (
      !window.confirm(
        `确定初始化为 ${PROVIDER_COPY[selectedProvider].label} 吗？初始化后不能直接切换。`
      )
    ) {
      return;
    }

    try {
      setBusy(true);
      setMessage('正在校验并锁定数据存储类型...');
      const nextStatus = await initializeDatabaseProvider({
        provider: selectedProvider
      });
      setStatus(nextStatus);
      onInitialized?.(nextStatus);
      setMessage(`已锁定为 ${PROVIDER_COPY[nextStatus.provider!].label}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '初始化数据库类型失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel database-remote-backup-card" style={{ marginTop: 12 }}>
      <div className="database-remote-backup-head">
        <div>
          <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>数据存储类型</h3>
            <span className="sync-tip">{status?.initialized ? '已锁定' : '等待初始化'}</span>
          </div>
          <p className="sync-tip" style={{ margin: '6px 0 0' }}>
            {status?.initialized
              ? `当前使用 ${formatProvider(status.provider)}。如需更换，请导出数据并在新部署中导入。`
              : '首次初始化后不能直接切换数据存储类型。'}
          </p>
        </div>
      </div>

      <div className="database-remote-backup-body">
        {!isReady ? <p className="sync-tip">正在读取服务端初始化状态...</p> : null}
        {status?.configurationMismatch ? (
          <p className="database-backup-scope-warning">
            部署环境与已锁定类型不一致，请恢复原部署配置或迁移到新实例。
          </p>
        ) : null}

        {status && !status.initialized ? (
          <>
            <div
              className="database-provider-options"
              role="radiogroup"
              aria-label="选择数据存储类型"
            >
              {providerChoices.map((provider) => (
                <label
                  key={provider}
                  className={`database-provider-option ${selectedProvider === provider ? 'is-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="database-provider"
                    value={provider}
                    checked={selectedProvider === provider}
                    onChange={() => setSelectedProvider(provider)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{PROVIDER_COPY[provider].label}</strong>
                    <small>{PROVIDER_COPY[provider].description}</small>
                  </span>
                </label>
              ))}
            </div>

            <div className="sync-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void handleInitialize()}
                disabled={busy}
              >
                {busy ? '正在初始化...' : `初始化 ${PROVIDER_COPY[selectedProvider].label}`}
              </button>
            </div>
          </>
        ) : null}

        {message ? (
          <p className="sync-tip" style={{ marginTop: 10 }}>
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
