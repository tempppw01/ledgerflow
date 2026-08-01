import { ENV } from '../config/env';

export interface RelationalBootstrapResponse {
  ok: boolean;
  hasData: boolean;
  counts: Record<string, number>;
  updatedAt: string | null;
  data: {
    finance: Record<string, unknown>;
    globalMemories: unknown[];
    preferences: Record<string, unknown>;
  };
}

function getUrl(path: string) {
  const base = ENV.apiBaseUrl.endsWith('/') ? ENV.apiBaseUrl.slice(0, -1) : ENV.apiBaseUrl;
  return `${base}${path}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return body;
}

export async function getRelationalBootstrap(): Promise<RelationalBootstrapResponse> {
  return readResponse<RelationalBootstrapResponse>(
    await fetch(getUrl('/data/bootstrap'), { credentials: 'same-origin' })
  );
}

export async function importRelationalData(payload: unknown): Promise<{
  ok: boolean;
  hasData: boolean;
  counts: Record<string, number>;
  updatedAt: string | null;
}> {
  return readResponse(
    await fetch(getUrl('/data/import'), {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  );
}
