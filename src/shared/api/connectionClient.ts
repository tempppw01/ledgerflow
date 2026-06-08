import { ENV } from '../config/env';

interface ProxyTestResponse {
  ok: boolean;
  message?: string;
  detail?: string;
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
  if (!base) return '';
  if (base === '/') return '';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function joinBaseAndPath(base: string, path: string) {
  const normalizedPath = normalizePath(path);
  if (!base) return normalizedPath;

  if (
    (base === '/api' || base.endsWith('/api')) &&
    (normalizedPath === '/api' || normalizedPath.startsWith('/api/'))
  ) {
    const trimmed = normalizedPath.slice(4) || '/';
    return `${base}${trimmed}`;
  }

  return `${base}${normalizedPath}`;
}

async function requestJson<T>(
  url: string,
  apiToken?: string,
  method: 'POST' | 'PUT' = 'POST'
): Promise<T> {
  const token = String(apiToken || '').trim();
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            'X-LedgerFlow-Api-Token': token
          }
        : {})
    },
    body: JSON.stringify({})
  });

  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    detail?: string;
  };

  if (!response.ok) {
    const message = body.error || body.message || `HTTP ${response.status}`;
    throw new HttpRequestError(
      response.status,
      body.detail ? `${message}：${body.detail}` : message
    );
  }

  return body as T;
}

async function requestWithFallback<T>(
  paths: string[],
  apiToken?: string,
  methods: Array<'POST' | 'PUT'> = ['POST', 'PUT']
): Promise<T> {
  let lastError: unknown;
  const attempts: string[] = [];
  const attemptedSet = new Set<string>();
  const normalizedBase = normalizeBase(ENV.apiBaseUrl);
  const baseCandidates = Array.from(new Set([normalizedBase, '']));

  for (const base of baseCandidates) {
    for (const path of paths) {
      const url = joinBaseAndPath(base, path);

      for (const method of methods) {
        const attemptKey = `${method} ${url}`;
        if (attemptedSet.has(attemptKey)) continue;
        attemptedSet.add(attemptKey);

        try {
          attempts.push(attemptKey);
          return await requestJson<T>(url, apiToken, method);
        } catch (error) {
          lastError = error;
          if (error instanceof HttpRequestError && (error.status === 404 || error.status === 405)) {
            continue;
          }
          throw error;
        }
      }
    }
  }

  if (
    lastError instanceof HttpRequestError &&
    (lastError.status === 404 || lastError.status === 405)
  ) {
    throw new Error(`连接测试接口不可用（HTTP 404/405）。已尝试：${attempts.join(' | ')}`);
  }

  throw lastError instanceof Error ? lastError : new Error('连接测试请求失败');
}

export async function postConnectionTest(apiToken?: string): Promise<ProxyTestResponse> {
  return requestWithFallback<ProxyTestResponse>(
    ['/conn/test', '/api/conn/test', '/connection/test', '/db/connection/test'],
    apiToken,
    ['POST', 'PUT']
  );
}
