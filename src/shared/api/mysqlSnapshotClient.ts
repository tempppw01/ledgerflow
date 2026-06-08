import type { FinanceBackupPayload } from '../lib/backup';
import { ENV } from '../config/env';

export interface MysqlSnapshotUploadRequest {
  payload: FinanceBackupPayload;
  userId?: string;
  schemaVersion?: number;
  source?: 'manual' | 'auto';
}

export interface MysqlSnapshotUploadResponse {
  ok: boolean;
  id: number;
  userId: string;
  schemaVersion: number;
  checksum: string;
  payloadBytes: number;
  exportedAt: string | null;
  message: string;
}

export interface MysqlSnapshotRecord {
  id: number;
  userId: string;
  schemaVersion: number;
  payload: FinanceBackupPayload;
  checksum: string;
  payloadBytes: number;
  source: string;
  exportedAt: string | null;
  createdAt: string | null;
}

export interface MysqlSnapshotLatestResponse {
  ok: boolean;
  message: string;
  snapshot: MysqlSnapshotRecord | null;
}

class HttpRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
  }
}

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeBase(base: string) {
  if (!base || base === '/') return '';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function joinBaseAndPath(base: string, path: string) {
  const normalizedPath = normalizePath(path);
  if (!base) return normalizedPath;

  if (
    (base === '/api' || base.endsWith('/api')) &&
    (normalizedPath === '/api' || normalizedPath.startsWith('/api/'))
  ) {
    return `${base}${normalizedPath.slice(4) || '/'}`;
  }

  return `${base}${normalizedPath}`;
}

async function sha256Text(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new HttpRequestError(response.status, body.error || body.message || `HTTP ${response.status}`);
  }

  return body as T;
}

async function postJsonWithFallback<T>(paths: string[], payload: unknown): Promise<T> {
  let lastError: unknown;
  const attempted = new Set<string>();
  const bases = Array.from(new Set([normalizeBase(ENV.apiBaseUrl), '']));

  for (const base of bases) {
    for (const path of paths) {
      const url = joinBaseAndPath(base, path);
      if (attempted.has(url)) continue;
      attempted.add(url);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return await parseResponse<T>(response);
      } catch (error) {
        lastError = error;
        if (error instanceof HttpRequestError && (error.status === 404 || error.status === 405)) {
          continue;
        }
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('MySQL snapshot request failed.');
}

async function getJsonWithFallback<T>(paths: string[]): Promise<T> {
  let lastError: unknown;
  const attempted = new Set<string>();
  const bases = Array.from(new Set([normalizeBase(ENV.apiBaseUrl), '']));

  for (const base of bases) {
    for (const path of paths) {
      const url = joinBaseAndPath(base, path);
      if (attempted.has(url)) continue;
      attempted.add(url);

      try {
        const response = await fetch(url);
        return await parseResponse<T>(response);
      } catch (error) {
        lastError = error;
        if (error instanceof HttpRequestError && (error.status === 404 || error.status === 405)) {
          continue;
        }
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('MySQL snapshot request failed.');
}

export async function uploadMysqlSnapshot(
  input: MysqlSnapshotUploadRequest
): Promise<MysqlSnapshotUploadResponse> {
  const payloadText = JSON.stringify(input.payload);
  const checksum = await sha256Text(payloadText);

  return postJsonWithFallback<MysqlSnapshotUploadResponse>(
    ['/snapshots', '/snapshots/upload', '/mysql/snapshots'],
    {
      userId: input.userId || 'default',
      schemaVersion: input.schemaVersion || 1,
      source: input.source || 'manual',
      checksum,
      payload: input.payload
    }
  );
}

export async function downloadLatestMysqlSnapshot(
  userId = 'default'
): Promise<MysqlSnapshotLatestResponse> {
  const response = await getJsonWithFallback<MysqlSnapshotLatestResponse>([
    `/snapshots/latest?userId=${encodeURIComponent(userId)}`,
    `/mysql/snapshots/latest?userId=${encodeURIComponent(userId)}`
  ]);

  if (response.ok && response.snapshot) {
    const checksum = await sha256Text(JSON.stringify(response.snapshot.payload));
    if (checksum !== response.snapshot.checksum) {
      throw new Error('MySQL snapshot checksum mismatch.');
    }
  }

  return response;
}
