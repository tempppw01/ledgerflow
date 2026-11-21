import { ConnectionFormValues, connectionFormSchema } from './connectionFormSchema';
import { ConnectionTestResult } from '../../../entities/connection/types';
import { postConnectionTest } from '../../../shared/api/connectionClient';
import { readStoredLedgerflowApiToken } from '../../../shared/lib/ledgerflowApiToken';
import { tApiError as t } from '../../../shared/lib/apiErrorTranslator';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(t('dbSettings.connection.error.timeout', "连接超时（>{timeout}ms）").replace("{timeout}", String(timeoutMs)))), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function testByProxy(config: ConnectionFormValues): Promise<ConnectionTestResult> {
  const start = performance.now();
  const data = await withTimeout(
    postConnectionTest(readStoredLedgerflowApiToken()),
    config.timeoutMs
  );

  return {
    ok: data.ok,
    message: data.message ?? (data.ok ? t('dbSettings.connection.test.serverOk', '服务端连接成功') : t('dbSettings.connection.test.serverFailed', '服务端连接失败')),
    elapsedMs: Math.round(performance.now() - start),
    detail: data.detail ?? '[server-env] no detail'
  };
}

export async function testConnection(config: ConnectionFormValues) {
  const parsed = connectionFormSchema.safeParse(config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(first?.message || t('dbSettings.connection.error.configIncomplete', '请先完善连接配置后再测试连接'));
  }

  return testByProxy(parsed.data);
}
