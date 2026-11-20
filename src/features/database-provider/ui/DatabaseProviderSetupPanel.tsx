import { useEffect, useState } from 'react';
import { useTFallback, type TfFallback } from '../../../shared/lib/useTFallback';
import {
  type DatabaseProvider,
  getDatabaseSetupStatus,
  initializeDatabaseProvider,
  type DatabaseSetupStatus
} from '../../../shared/api/databaseProviderClient';

const PROVIDER_COPY: Record<
  DatabaseProvider,
  { label: string; description: string; descriptionKey: string }
> = {
  sqlite: {
    label: 'SQLite',
    description: '适合单机和轻量自托管,数据保存为部署卷中的文件。',
    descriptionKey: 'dataBackup.provider.sqliteDesc'
  },
  mysql: {
    label: 'MySQL',
    description: '适合阿里云 RDS、多设备同步和后续多用户部署。',
    descriptionKey: 'dataBackup.provider.mysqlDesc'
  }
};
const MYSQL_NOT_CONFIGURED_MESSAGE = '未检测到 MySQL 配置，请先设置 MYSQL_URL 或 MYSQL_HOST。';
const MYSQL_NOT_CONFIGURED_KEY = 'dataBackup.provider.mysqlNotConfigured';

interface DatabaseProviderSetupPanelProps {
  onInitialized?: (status: DatabaseSetupStatus) => void;
}

function formatProvider(provider: DatabaseProvider | null, tf: TfFallback) {
  return provider
    ? PROVIDER_COPY[provider].label
    : tf('dataBackup.provider.uninitialized', '未初始化');
}

export function DatabaseProviderSetupPanel({ onInitialized }: DatabaseProviderSetupPanelProps) {
  const tf = useTFallback();
  const [status, setStatus] = useState<DatabaseSetupStatus | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<DatabaseProvider>('sqlite');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const isReady = Boolean(status);
  const providerChoices = (status?.allowedProviders || []).filter(
    (provider): provider is DatabaseProvider => provider in PROVIDER_COPY
  );
  const getProviderAvailability = (provider: DatabaseProvider) => {
    const availability = status?.providerAvailability?.[provider];
    if (availability) {
      return availability;
    }
    return {
      configured: provider === 'sqlite',
      // 服务端只在 MySQL 未配置时给出这句提示,这里提供本地化的等价文案
      message:
        provider === 'mysql' ? tf(MYSQL_NOT_CONFIGURED_KEY, MYSQL_NOT_CONFIGURED_MESSAGE) : ''
    };
  };
  const selectedProviderIsConfigured = getProviderAvailability(selectedProvider).configured;

  useEffect(() => {
    let active = true;
    void getDatabaseSetupStatus()
      .then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setSelectedProvider((current) =>
          nextStatus.allowedProviders.includes(current) &&
          nextStatus.providerAvailability?.[current]?.configured
            ? current
            : nextStatus.allowedProviders.find(
                (provider) => nextStatus.providerAvailability?.[provider]?.configured
              ) ||
              nextStatus.allowedProviders[0] ||
              'sqlite'
        );
      })
      .catch((error) => {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : tf('dataBackup.provider.readStatusFailed', '无法读取数据库初始化状态。')
          );
        }
      });

    return () => {
      active = false;
    };
  }, [tf]);

  async function handleInitialize() {
    if (!selectedProviderIsConfigured) {
      setMessage(getProviderAvailability(selectedProvider).message);
      return;
    }

    if (
      !window.confirm(
        `确定初始化为 ${PROVIDER_COPY[selectedProvider].label} 吗？初始化后不能直接切换。`
      )
    ) {
      return;
    }

    try {
      setBusy(true);
      setMessage(tf('dataBackup.provider.locking', '正在校验并锁定数据存储类型...'));
      const nextStatus = await initializeDatabaseProvider({
        provider: selectedProvider
      });
      setStatus(nextStatus);
      onInitialized?.(nextStatus);
      setMessage(`已锁定为 ${PROVIDER_COPY[nextStatus.provider!].label}。`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : tf('dataBackup.provider.initFailed', '初始化数据库类型失败。')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel database-remote-backup-card" style={{ marginTop: 12 }}>
      <div className="database-remote-backup-head">
        <div>
          <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{tf('dataBackup.provider.title', '数据存储类型')}</h3>
            <span className="sync-tip">
              {status?.initialized
                ? tf('dataBackup.provider.locked', '已锁定')
                : tf('dataBackup.provider.waiting', '等待初始化')}
            </span>
          </div>
          <p className="sync-tip" style={{ margin: '6px 0 0' }}>
            {status?.initialized
              ? tf(
                  'dataBackup.provider.currentUsing',
                  '当前使用 {provider}。如需更换,请导出数据并在新部署中导入。'
                ).replace('{provider}', formatProvider(status.provider, tf))
              : tf('dataBackup.provider.switchHint', '首次初始化后不能直接切换数据存储类型。')}
          </p>
        </div>
      </div>

      <div className="database-remote-backup-body">
        {!isReady ? (
          <p className="sync-tip">
            {tf('dataBackup.provider.readingStatus', '正在读取服务端初始化状态...')}
          </p>
        ) : null}
        {status?.configurationMismatch ? (
          <p className="database-backup-scope-warning">
            {tf(
              'dataBackup.provider.mismatch',
              '部署环境与已锁定类型不一致，请恢复原部署配置或迁移到新实例。'
            )}
          </p>
        ) : null}

        {status && !status.initialized ? (
          <>
            <div
              className="database-provider-options"
              role="radiogroup"
              aria-label={tf('dataBackup.provider.selectAria', '选择数据存储类型')}
            >
              {providerChoices.map((provider) => {
                const availability = getProviderAvailability(provider);
                return (
                  <label
                    key={provider}
                    className={`database-provider-option ${selectedProvider === provider ? 'is-active' : ''} ${!availability.configured ? 'is-unavailable' : ''}`}
                    title={!availability.configured ? availability.message : undefined}
                  >
                    <input
                      type="radio"
                      name="database-provider"
                      value={provider}
                      checked={selectedProvider === provider}
                      onChange={() => setSelectedProvider(provider)}
                      disabled={busy || !availability.configured}
                    />
                    <span>
                      <strong>{PROVIDER_COPY[provider].label}</strong>
                      <small>
                        {tf(
                          PROVIDER_COPY[provider].descriptionKey,
                          PROVIDER_COPY[provider].description
                        )}
                      </small>
                      {!availability.configured ? <em>{availability.message}</em> : null}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="sync-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void handleInitialize()}
                disabled={busy || !selectedProviderIsConfigured}
              >
                {busy
                  ? tf('dataBackup.provider.initializing', '正在初始化...')
                  : `初始化 ${PROVIDER_COPY[selectedProvider].label}`}
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
