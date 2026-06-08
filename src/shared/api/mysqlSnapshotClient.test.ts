import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { downloadLatestMysqlSnapshot, uploadMysqlSnapshot } from './mysqlSnapshotClient';
import { createFinanceBackupPayload } from '../lib/backup';

const payload = createFinanceBackupPayload({
  transactions: [],
  categories: [],
  accounts: [],
  subscriptions: [],
  trashedTransactions: [],
  trashedCategories: [],
  trashedAccounts: [],
  balanceChangeEntries: [],
  trashedSubscriptions: [],
  globalMemories: [],
  investmentPositions: [],
  investmentPositionHistory: [],
  investmentGoals: [],
  investmentWatchlist: [],
  investmentAiMessages: []
});

async function checksum(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('mysqlSnapshotClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads backup payload with a checksum', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        id: 1,
        userId: 'default',
        schemaVersion: 1,
        checksum: await checksum(payload),
        payloadBytes: 128,
        exportedAt: payload.exportedAt,
        message: 'ok'
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await uploadMysqlSnapshot({ payload });

    const calls = (fetchMock as Mock).mock.calls as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(calls[0]?.[0]).toBe('/api/snapshots');
    expect(body.payload).toEqual(payload);
    expect(body.checksum).toHaveLength(64);
  });

  it('rejects a downloaded snapshot when checksum does not match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          message: 'ok',
          snapshot: {
            id: 1,
            userId: 'default',
            schemaVersion: 1,
            payload,
            checksum: '0'.repeat(64),
            payloadBytes: 128,
            source: 'manual',
            exportedAt: payload.exportedAt,
            createdAt: payload.exportedAt
          }
        })
      )
    );

    await expect(downloadLatestMysqlSnapshot()).rejects.toThrow('checksum mismatch');
  });
});
