import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { postConnectionTest } from './connectionClient';

describe('connectionClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('tests only the server-side configured connection and sends auth headers', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        message: 'ok',
        detail: 'SELECT 1'
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await postConnectionTest('secret-token');

    const calls = (fetchMock as Mock).mock.calls as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    const headers = calls[0]?.[1]?.headers as Record<string, string>;

    expect(calls[0]?.[0]).toBe('/api/conn/test');
    expect(body).toEqual({});
    expect(headers.Authorization).toBe('Bearer secret-token');
    expect(headers['X-LedgerFlow-Api-Token']).toBe('secret-token');
  });
});
