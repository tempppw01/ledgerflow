import { ENV } from '../config/env';

export type DatabaseProvider = 'sqlite' | 'mysql';

export interface DatabaseSetupStatus {
  initialized: boolean;
  provider: DatabaseProvider | null;
  initializedAt: string | null;
  allowedProviders: DatabaseProvider[];
  configuredProvider: DatabaseProvider | null;
  configurationMismatch: boolean;
}

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

export async function getDatabaseSetupStatus(): Promise<DatabaseSetupStatus> {
  const response = await fetch(getSetupUrl('/setup/status'));
  const body = await readResponse<{ ok: boolean } & DatabaseSetupStatus>(response);
  return body;
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
