import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useDebugLogStore } from '../../../shared/store/useDebugLogStore';
import { PasswordInput } from '../../../shared/ui/PasswordInput';
import { getConnectionDefaults, getPortByType } from '../model/connectionDefaults';
import { ConnectionFormValues, connectionFormSchema } from '../model/connectionFormSchema';
import { parseConnectionString } from '../model/connectionString';
import { ConnectionTestButton } from './ConnectionTestButton';

interface ConnectionConfigFormProps {
  initialValues?: ConnectionFormValues;
  onSubmit: (values: ConnectionFormValues) => void;
  onCancel?: () => void;
}

function getDefaultsByType(type: ConnectionFormValues['type']) {
  return getConnectionDefaults(type);
}

export function ConnectionConfigForm({
  initialValues,
  onSubmit,
  onCancel
}: ConnectionConfigFormProps) {
  const addLog = useDebugLogStore((state) => state.addLog);
  const [testing, setTesting] = useState(false);

  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues: initialValues ?? getConnectionDefaults()
  });

  const currentType = form.watch('type');
  const currentHost = form.watch('host');
  const currentPort = form.watch('port');
  const currentDatabase = form.watch('database');
  const currentDatabaseLabel = currentType === 'redis' ? 'DB' : '库名';
  const endpointSummary =
    currentType === 'redis'
      ? `${currentHost || 'localhost'}:${currentPort || getPortByType('redis')} / DB ${currentDatabase || '0'}`
      : `${currentHost || 'localhost'}:${currentPort || getPortByType('mysql')} / ${currentDatabase || 'ledgerflow'}`;
  const endpointHint =
    currentType === 'redis'
      ? '默认 localhost / 6379 / DB 0，不改也能直接测试本机 Redis。'
      : '默认 localhost / 3306 / 库 ledgerflow，不改也能直接测试本机 MySQL。';

  function applyConnectionString() {
    const values = form.getValues();
    if (!values.connectionString?.trim()) return;

    const result = parseConnectionString(values.connectionString, values.type);
    if (!result.ok) {
      form.setError('connectionString', { message: result.error });
      return;
    }

    form.clearErrors('connectionString');
    const parsed = result.parsed;
    if (parsed.host) form.setValue('host', parsed.host);
    if (parsed.port) form.setValue('port', parsed.port);
    if (parsed.username) form.setValue('username', parsed.username);
    if (parsed.password) form.setValue('password', parsed.password);
    if (parsed.database) form.setValue('database', parsed.database);
  }

  async function handleSubmit(values: ConnectionFormValues) {
    try {
      await Promise.resolve(onSubmit(values));
      addLog({
        action: '保存配置',
        status: 'success',
        dbType: values.type,
        message: `${values.type.toUpperCase()} 配置已保存`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      addLog({
        action: '保存配置',
        status: 'error',
        dbType: values.type,
        message
      });
      throw error;
    }
  }

  return (
    <form
      className={initialValues?.id ? 'connection-form is-embedded' : 'connection-form'}
      onSubmit={form.handleSubmit(handleSubmit)}
    >
      <div className="connection-layout">
        <section className="connection-main">
          <header className="connection-section-header">
            <h3>{initialValues?.id ? '编辑连接配置' : '新增连接配置'}</h3>
            <p>默认值已为本机常用场景预填，只有在需要覆盖时再展开修改。</p>
          </header>

          <div className="field">
            <label title="用于区分不同环境连接">名称</label>
            <input {...form.register('name')} placeholder="例如：Redis 生产实例" />
            <small className="error">{form.formState.errors.name?.message}</small>
          </div>

          <div className="connection-type-row">
            <div className="field connection-type-select-field">
              <label title="支持 MySQL / Redis，切换后会自动带入默认值">数据库类型</label>
              <select
                {...form.register('type')}
                onChange={(event) => {
                  const type = event.target.value as ConnectionFormValues['type'];
                  const defaults = getDefaultsByType(type);
                  form.setValue('type', type);
                  form.setValue('port', getPortByType(type));
                  form.setValue('host', defaults.host);
                  form.setValue('database', defaults.database);
                  form.setValue('username', '');
                }}
              >
                <option value="mysql">MySQL</option>
                <option value="redis">Redis</option>
              </select>
            </div>

            <label className="connection-inline-checkbox" title="保存后默认作为启用连接">
              <input type="checkbox" {...form.register('enabled')} />
              <span>启用</span>
            </label>
          </div>

          <details className="connection-advanced">
            <summary>
              主机 / 端口 / {currentDatabaseLabel}（当前 {endpointSummary}）
            </summary>
            <p className="sync-tip" style={{ margin: '0 0 10px' }}>
              {endpointHint}
            </p>

            <div className="grid grid-3">
              <div className="field">
                <label title="数据库服务地址">Host</label>
                <input {...form.register('host')} placeholder="默认 localhost" />
                <small className="error">{form.formState.errors.host?.message}</small>
              </div>
              <div className="field">
                <label title="会按数据库类型自动带入默认端口">Port</label>
                <input
                  type="number"
                  {...form.register('port')}
                  placeholder={currentType === 'redis' ? '默认 6379' : '默认 3306'}
                />
                <small className="error">{form.formState.errors.port?.message}</small>
              </div>
              <div className="field">
                <label title={currentType === 'redis' ? 'Redis DB 编号' : 'MySQL 数据库名'}>
                  {currentDatabaseLabel}
                </label>
                <input
                  {...form.register('database')}
                  placeholder={currentType === 'redis' ? '默认 0' : '默认 ledgerflow'}
                />
                <small className="error">{form.formState.errors.database?.message}</small>
              </div>
            </div>
          </details>

          <div className="grid grid-2">
            <div className="field">
              <label
                title={
                  currentType === 'redis'
                    ? 'Redis 用户名通常可留空'
                    : 'MySQL 用户名，例如 ledgerflow'
                }
              >
                用户名
              </label>
              <input
                {...form.register('username')}
                placeholder={currentType === 'redis' ? '可选，默认留空' : '例如：ledgerflow'}
              />
              <small className="error">{form.formState.errors.username?.message}</small>
            </div>

            <div className="field">
              <label title="密码仅用于连接，不会以明文持久化">密码</label>
              <PasswordInput
                {...form.register('password')}
                placeholder="请输入密码"
                showLabel="显示密码"
                hideLabel="隐藏密码"
              />
            </div>
          </div>

          <div className="field">
            <label title="有连接串时可直接粘贴并自动回填字段">连接串（可选）</label>
            <div className="row connection-inline-row">
              <input
                {...form.register('connectionString')}
                placeholder={
                  currentType === 'redis'
                    ? 'redis://:password@localhost:6379/0'
                    : 'mysql://user:password@db.example.com:3306/ledgerflow'
                }
              />
              <button type="button" onClick={applyConnectionString}>
                解析连接串
              </button>
            </div>
            <small className="error">{form.formState.errors.connectionString?.message}</small>
          </div>

          <details className="connection-advanced">
            <summary>连接池与 TLS（默认收起）</summary>
            <div className="grid grid-3">
              <div className="field">
                <label title="连接超时时间，单位毫秒">超时（ms）</label>
                <input type="number" {...form.register('timeoutMs')} />
              </div>
              <div className="field">
                <label title="连接池最小连接数">连接池 min</label>
                <input type="number" {...form.register('pool.min')} />
              </div>
              <div className="field">
                <label title="连接池最大连接数">连接池 max</label>
                <input type="number" {...form.register('pool.max')} />
              </div>
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label title="空闲连接回收时间">idleTimeoutMs</label>
                <input type="number" {...form.register('pool.idleTimeoutMs')} />
              </div>
              <div className="field">
                <label title="可选 CA 证书">CA 证书</label>
                <input {...form.register('tls.caCert')} placeholder="-----BEGIN CERTIFICATE-----" />
              </div>
            </div>

            <div className="row">
              <label>
                <input type="checkbox" {...form.register('tls.enabled')} /> TLS/SSL
              </label>
              <label>
                <input type="checkbox" {...form.register('tls.rejectUnauthorized')} /> 校验证书
              </label>
            </div>
          </details>
        </section>

        <aside className="connection-actions" aria-label="连接操作">
          <ConnectionTestButton
            values={form.watch()}
            disabled={form.formState.isSubmitting}
            onTestingChange={setTesting}
            onResult={(result) => {
              addLog({
                action: '测试连接',
                status: result.ok ? 'success' : 'error',
                dbType: form.getValues('type'),
                message: result.ok ? `${result.message}（${result.elapsedMs}ms）` : result.message
              });
            }}
          />

          <button
            className="primary"
            type="submit"
            disabled={testing || form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? '保存中...' : '保存配置'}
          </button>

          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={testing || form.formState.isSubmitting}
            >
              取消
            </button>
          ) : null}
        </aside>
      </div>
    </form>
  );
}
