import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDatabaseSetupStatus } from './databaseProviderClient';

const databaseStatus = {
  ok: true,
  initialized: true,
  provider: 'sqlite',
  initializedAt: '2026-07-17T00:00:00.000Z',
  allowedProviders: ['sqlite'],
  configuredProvider: 'sqlite',
  configurationMismatch: false,
  providerAvailability: {
    sqlite: { configured: true, message: '' },
    mysql: { configured: false, message: '未配置' }
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('databaseProviderClient', () => {
  it('checks setup status without browser caching and forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => Response.json(databaseStatus));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDatabaseSetupStatus()).resolves.toMatchObject({
      initialized: true,
      provider: 'sqlite'
    });

    const calls = (fetchMock as Mock).mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe('/api/setup/status');
    expect(calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin'
    });
    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('times out a stalled status request with a readable message', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = getDatabaseSetupStatus();
    const timeoutAssertion = expect(request).rejects.toThrow('数据库状态检查超时');
    await vi.advanceTimersByTimeAsync(5000);

    await timeoutAssertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
