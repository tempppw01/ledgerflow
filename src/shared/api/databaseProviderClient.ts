import { ENV } from '../config/env';

export type DatabaseProvider = 'sqlite' | 'mysql';

export interface DatabaseProviderAvailability {
  configured: boolean;
  message: string;
}

export interface DatabaseSetupStatus {
  initialized: boolean;
  provider: DatabaseProvider | null;
  initializedAt: string | null;
  allowedProviders: DatabaseProvider[];
  configuredProvider: DatabaseProvider | null;
  configurationMismatch: boolean;
  providerAvailability: Record<DatabaseProvider, DatabaseProviderAvailability>;
}

const DATABASE_STATUS_TIMEOUT_MS = 5000;

function getSetupUrl(path: string) {
  const base = ENV.apiBaseUrl.endsWith('/') ? ENV.apiBaseUrl.slice(0, -1) : ENV.apiBaseUrl;
  return `${base}${path}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return body as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDatabaseProvider(value: unknown): value is DatabaseProvider {
  return value === 'sqlite' || value === 'mysql';
}

function isProviderAvailability(value: unknown): value is DatabaseProviderAvailability {
  return (
    isRecord(value) &&
    typeof value.configured === 'boolean' &&
    typeof value.message === 'string'
  );
}

function isDatabaseSetupStatus(
  value: unknown
): value is { ok: boolean } & DatabaseSetupStatus {
  if (!isRecord(value) || value.ok !== true) return false;
  const providerAvailability = value.providerAvailability;
  return (
    typeof value.initialized === 'boolean' &&
    (value.provider === null || isDatabaseProvider(value.provider)) &&
    (value.initializedAt === null || typeof value.initializedAt === 'string') &&
    Array.isArray(value.allowedProviders) &&
    value.allowedProviders.every(isDatabaseProvider) &&
    (value.configuredProvider === null || isDatabaseProvider(value.configuredProvider)) &&
    typeof value.configurationMismatch === 'boolean' &&
    isRecord(providerAvailability) &&
    isProviderAvailability(providerAvailability.sqlite) &&
    isProviderAvailability(providerAvailability.mysql)
  );
}

export async function getDatabaseSetupStatus(): Promise<DatabaseSetupStatus> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), DATABASE_STATUS_TIMEOUT_MS);

  try {
    const response = await fetch(getSetupUrl('/setup/status'), {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal
    });
    const body = await readResponse<unknown>(response);
    if (!isDatabaseSetupStatus(body)) {
      throw new Error('数据库状态响应格式无效。');
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('数据库状态检查超时,请稍后重试。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function initializeDatabaseProvider(input: {
  provider: DatabaseProvider;
}): Promise<DatabaseSetupStatus & { created: boolean }> {
  const response = await fetch(getSetupUrl('/setup/initialize'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ provider: input.provider })
  });
  const body = await readResponse<{ ok: boolean } & DatabaseSetupStatus & { created: boolean }>(
    response
  );
  return body;
}
