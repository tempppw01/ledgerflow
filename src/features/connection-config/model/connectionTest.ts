import { ConnectionFormValues, connectionFormSchema } from './connectionFormSchema';
import { ConnectionTestResult } from '../../../entities/connection/types';
import { postConnectionTest } from '../../../shared/api/connectionClient';

const MYSQL_SNAPSHOT_API_TOKEN_STORAGE_KEY = 'ledgerflow-mysql-snapshot-api-token';

function readStoredApiToken() {
  try {
    return window.localStorage.getItem(MYSQL_SNAPSHOT_API_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`连接超时（>${timeoutMs}ms）`)), timeoutMs);
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
  const data = await withTimeout(postConnectionTest(readStoredApiToken()), config.timeoutMs);

  return {
    ok: data.ok,
    message: data.message ?? (data.ok ? '服务端连接成功' : '服务端连接失败'),
    elapsedMs: Math.round(performance.now() - start),
    detail: data.detail ?? '[server-env] no detail'
  };
}

export async function testConnection(config: ConnectionFormValues) {
  const parsed = connectionFormSchema.safeParse(config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(first?.message || '请先完善连接配置后再测试连接');
  }

  return testByProxy(parsed.data);
}
