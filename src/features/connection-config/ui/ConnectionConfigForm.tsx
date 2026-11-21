import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useDebugLogStore } from '../../../shared/store/useDebugLogStore';
import { PasswordInput } from '../../../shared/ui/PasswordInput';
import { getConnectionDefaults, getPortByType } from '../model/connectionDefaults';
import { ConnectionFormValues, connectionFormSchema } from '../model/connectionFormSchema';
import { parseConnectionString } from '../model/connectionString';
import { ConnectionTestButton } from './ConnectionTestButton';
import { useTFallback } from '../../../shared/lib/useTFallback';

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
  const tf = useTFallback();
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
  const currentDatabaseLabel = currentType === 'redis' ? 'DB' : tf('dbSettings.connection.field.databaseName', '库名');
  const endpointSummary =
    currentType === 'redis'
      ? `${currentHost || 'localhost'}:${currentPort || getPortByType('redis')} / DB ${currentDatabase || '0'}`
      : `${currentHost || 'localhost'}:${currentPort || getPortByType('mysql')} / ${currentDatabase || 'ledgerflow'}`;
  const endpointHint =
    currentType === 'redis'
      ? tf('dbSettings.connection.hint.redisDefaults', '默认 localhost / 6379 / DB 0，不改也能直接测试本机 Redis。')
      : tf('dbSettings.connection.hint.mysqlDefaults', '默认 localhost / 3306 / 库 ledgerflow，不改也能直接测试本机 MySQL。');

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
        action: tf('dbSettings.connection.saveConfig', '保存配置'),
        status: 'success',
        dbType: values.type,
        message: tf('dbSettings.connection.saved', "{type} 配置已保存").replace("{type}", String(values.type.toUpperCase()))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : tf('dbSettings.connection.saveFailed', '保存失败');
      addLog({
        action: tf('dbSettings.connection.saveConfig', '保存配置'),
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
            <h3>{initialValues?.id ? tf('dbSettings.connection.formTitleEdit', '编辑连接配置') : tf('dbSettings.connection.formTitleNew', '新增连接配置')}</h3>
            <p>{tf('dbSettings.connection.formHint', "默认值已为本机常用场景预填，只有在需要覆盖时再展开修改。")}</p>
          </header>

          <div className="field">
            <label title={tf('dbSettings.connection.field.nameHint', "用于区分不同环境连接")}>{tf('dbSettings.connection.field.name', "名称")}</label>
            <input {...form.register('name')} placeholder={tf('dbSettings.connection.field.namePlaceholder', "例如：Redis 生产实例")} />
            <small className="error">{form.formState.errors.name?.message}</small>
          </div>

          <div className="connection-type-row">
            <div className="field connection-type-select-field">
              <label title={tf('dbSettings.connection.field.typeHint', "支持 MySQL / Redis，切换后会自动带入默认值")}>{tf('dbSettings.connection.field.type', "数据库类型")}</label>
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

            <label className="connection-inline-checkbox" title={tf('dbSettings.connection.field.enabledHint', "保存后默认作为启用连接")}>
              <input type="checkbox" {...form.register('enabled')} />
              <span>{tf('dbSettings.connection.enabled', "启用")}</span>
            </label>
          </div>

          <details className="connection-advanced">
            <summary>{tf('dbSettings.connection.field.hostPortPrefix', " 主机 / 端口 / ")}{currentDatabaseLabel}{tf('dbSettings.connection.field.currentPrefix', "（当前 ")}{endpointSummary}）
            </summary>
            <p className="sync-tip" style={{ margin: '0 0 10px' }}>
              {endpointHint}
            </p>

            <div className="grid grid-3">
              <div className="field">
                <label title={tf('dbSettings.connection.field.hostHint', "数据库服务地址")}>Host</label>
                <input {...form.register('host')} placeholder={tf('dbSettings.connection.field.hostPlaceholder', "默认 localhost")} />
                <small className="error">{form.formState.errors.host?.message}</small>
              </div>
              <div className="field">
                <label title={tf('dbSettings.connection.field.portHint', "会按数据库类型自动带入默认端口")}>Port</label>
                <input
                  type="number"
                  {...form.register('port')}
                  placeholder={currentType === 'redis' ? tf('dbSettings.connection.field.portPlaceholderRedis', '默认 6379') : tf('dbSettings.connection.field.portPlaceholderMysql', '默认 3306')}
                />
                <small className="error">{form.formState.errors.port?.message}</small>
              </div>
              <div className="field">
                <label title={currentType === 'redis' ? tf('dbSettings.connection.field.redisDatabase', 'Redis DB 编号') : tf('dbSettings.connection.field.mysqlDatabase', 'MySQL 数据库名')}>
                  {currentDatabaseLabel}
                </label>
                <input
                  {...form.register('database')}
                  placeholder={currentType === 'redis' ? tf('dbSettings.connection.field.redisDatabasePlaceholder', '默认 0') : tf('dbSettings.connection.field.mysqlDatabasePlaceholder', '默认 ledgerflow')}
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
                    ? tf('dbSettings.connection.field.redisUsernameHint', 'Redis 用户名通常可留空')
                    : tf('dbSettings.connection.field.mysqlUsernameHint', 'MySQL 用户名，例如 ledgerflow')
                }
              >{tf('dbSettings.connection.field.username', " 用户名 ")}</label>
              <input
                {...form.register('username')}
                placeholder={currentType === 'redis' ? tf('dbSettings.connection.field.usernamePlaceholder', '可选，默认留空') : tf('dbSettings.connection.field.usernameExample', '例如：ledgerflow')}
              />
              <small className="error">{form.formState.errors.username?.message}</small>
            </div>

            <div className="field">
              <label title={tf('dbSettings.connection.field.passwordHint', "密码仅用于连接，不会以明文持久化")}>{tf('dbSettings.connection.field.password', "密码")}</label>
              <PasswordInput
                {...form.register('password')}
                placeholder={tf('dbSettings.connection.field.passwordPlaceholder', "请输入密码")}
                showLabel={tf('dbSettings.connection.field.showPassword', "显示密码")}
                hideLabel={tf('dbSettings.connection.field.hidePassword', "隐藏密码")}
              />
            </div>
          </div>

          <div className="field">
            <label title={tf('dbSettings.connection.field.connectionStringHint', "有连接串时可直接粘贴并自动回填字段")}>{tf('dbSettings.connection.field.connectionString', "连接串（可选）")}</label>
            <div className="row connection-inline-row">
              <input
                {...form.register('connectionString')}
                placeholder={
                  currentType === 'redis'
                    ? 'redis://:password@localhost:6379/0'
                    : 'mysql://user:password@db.example.com:3306/ledgerflow'
                }
              />
              <button type="button" onClick={applyConnectionString}>{tf('dbSettings.connection.parseConnectionString', " 解析连接串 ")}</button>
            </div>
            <small className="error">{form.formState.errors.connectionString?.message}</small>
          </div>

          <details className="connection-advanced">
            <summary>{tf('dbSettings.connection.advancedTitle', "连接池与 TLS（默认收起）")}</summary>
            <div className="grid grid-3">
              <div className="field">
                <label title={tf('dbSettings.connection.field.timeoutHint', "连接超时时间，单位毫秒")}>{tf('dbSettings.connection.field.timeout', "超时（ms）")}</label>
                <input type="number" {...form.register('timeoutMs')} />
              </div>
              <div className="field">
                <label title={tf('dbSettings.connection.field.poolMinHint', "连接池最小连接数")}>{tf('dbSettings.connection.field.poolMin', "连接池 min")}</label>
                <input type="number" {...form.register('pool.min')} />
              </div>
              <div className="field">
                <label title={tf('dbSettings.connection.field.poolMaxHint', "连接池最大连接数")}>{tf('dbSettings.connection.field.poolMax', "连接池 max")}</label>
                <input type="number" {...form.register('pool.max')} />
              </div>
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label title={tf('dbSettings.connection.field.idleHint', "空闲连接回收时间")}>idleTimeoutMs</label>
                <input type="number" {...form.register('pool.idleTimeoutMs')} />
              </div>
              <div className="field">
                <label title={tf('dbSettings.connection.field.caCertHint', "可选 CA 证书")}>{tf('dbSettings.connection.field.caCert', "CA 证书")}</label>
                <input {...form.register('tls.caCert')} placeholder="-----BEGIN CERTIFICATE-----" />
              </div>
            </div>

            <div className="row">
              <label>
                <input type="checkbox" {...form.register('tls.enabled')} /> TLS/SSL
              </label>
              <label>
                <input type="checkbox" {...form.register('tls.rejectUnauthorized')} />{tf('dbSettings.connection.field.verifyCert', " 校验证书 ")}</label>
            </div>
          </details>
        </section>

        <aside className="connection-actions" aria-label={tf('dbSettings.connection.actionsTitle', "连接操作")}>
          <ConnectionTestButton
            values={form.watch()}
            disabled={form.formState.isSubmitting}
            onTestingChange={setTesting}
            onResult={(result) => {
              addLog({
                action: tf('dbSettings.connection.testConnection', '测试连接'),
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
            {form.formState.isSubmitting ? tf('dbSettings.connection.saving', '保存中...') : tf('dbSettings.connection.saveConfig', '保存配置')}
          </button>

          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={testing || form.formState.isSubmitting}
            >{tf('dbSettings.connection.cancel', " 取消 ")}</button>
          ) : null}
        </aside>
      </div>
    </form>
  );
}
