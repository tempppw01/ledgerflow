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

function rightRotate(value: number, shift: number) {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Bytes(bytes: Uint8Array) {
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19
  ];
  const bitLength = bytes.length * 8;
  const totalLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(totalLength - 4, bitLength >>> 0);

  const words = new Array<number>(64);
  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        rightRotate(words[i - 15], 7) ^ rightRotate(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 =
        rightRotate(words[i - 2], 17) ^ rightRotate(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i] + words[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((item) => item.toString(16).padStart(8, '0')).join('');
}

async function sha256Text(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Bytes(bytes);
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
