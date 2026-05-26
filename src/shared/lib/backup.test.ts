import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFinanceBackupPayload,
  listWebdavBackupVersions,
  loadWebdavConfig,
  parseFinanceBackupPayload,
  sanitizeWebdavConfig,
  saveWebdavConfig,
  webdavUploadFile,
  type BackupWebdavConfig
} from './backup';

const BACKUP_KEY = 'ledgerflow-backup-webdav-v1';
const BACKUP_PASSWORD_SESSION_KEY = 'ledgerflow-backup-webdav-password';

const baseConfig: BackupWebdavConfig = {
  endpoint: 'https://dav.example.com/remote.php/dav/files/user',
  username: 'alice',
  password: 'secret',
  remoteFilePath: '账本备份/2026 02 backup.json',
  retainedVersions: 3,
  proxyEnabled: true,
  proxyBasePath: '/api/webdav'
};

beforeEach(() => {
  localStorage.removeItem(BACKUP_KEY);
  sessionStorage.removeItem(BACKUP_PASSWORD_SESSION_KEY);
});

describe('parseFinanceBackupPayload', () => {
  it('支持带 UTF-8 BOM 的 JSON 备份', () => {
    const payload = parseFinanceBackupPayload(
      '\uFEFF{\n"version":1,"data":{"transactions":[],"categories":[],"accounts":[]}}'
    );

    expect(payload.version).toBe(1);
    expect(payload.data.transactions).toEqual([]);
  });

  it('当交易字段类型错误时应拒绝导入', () => {
    expect(() =>
      parseFinanceBackupPayload(
        JSON.stringify({
          version: 1,
          data: {
            transactions: [
              {
                id: 'tx-1',
                type: 'expense',
                categoryId: 'cat-1',
                accountId: 'acc-1',
                amount: '88.8',
                date: '2026-02-10',
                note: '午餐',
                tags: ['餐饮']
              }
            ],
            categories: [],
            accounts: []
          }
        })
      )
    ).toThrow('data.transactions[0].amount 应为有限数字');
  });

  it('当枚举字段不合法时应拒绝导入', () => {
    expect(() =>
      parseFinanceBackupPayload(
        JSON.stringify({
          version: 1,
          data: {
            transactions: [
              {
                id: 'tx-1',
                type: 'oops',
                categoryId: 'cat-1',
                accountId: 'acc-1',
                amount: 88.8,
                date: '2026-02-10',
                note: '午餐',
                tags: ['餐饮']
              }
            ],
            categories: [],
            accounts: []
          }
        })
      )
    ).toThrow('data.transactions[0].type 枚举值不合法');
  });

  it('当分类与账户字段类型合法时可正常通过并归一化', () => {
    const payload = parseFinanceBackupPayload(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-02-26T10:00:00.000Z',
        data: {
          transactions: [
            {
              id: 'tx-1',
              type: 'expense',
              categoryId: 'cat-1',
              accountId: 'acc-1',
              amount: 88.8,
              date: '2026-02-10',
              note: '午餐',
              tags: ['餐饮', '  工作日  '],
              source: 'manual',
              status: 'completed'
            }
          ],
          categories: [{ id: 'cat-1', name: ' 餐饮 ', kind: 'expense', sortOrder: 1 }],
          accounts: [{ id: 'acc-1', name: ' 招商银行卡 ', type: 'debit', balance: 1000 }]
        }
      })
    );

    expect(payload.data.transactions[0].tags).toEqual(['餐饮', '工作日']);
    expect(payload.data.categories[0].name).toBe('餐饮');
    expect(payload.data.accounts[0].name).toBe('招商银行卡');
    expect(payload.data.subscriptions).toEqual([]);
    expect(payload.data.globalMemories).toEqual([]);
  });

  it('应支持订阅与全局记忆一起进入备份载荷', () => {
    const payload = createFinanceBackupPayload({
      transactions: [],
      categories: [],
      accounts: [],
      subscriptions: [
        {
          id: 'sub-1',
          name: 'Netflix',
          kind: 'digital',
          amount: 55,
          currency: 'CNY',
          billingCycle: 'monthly',
          status: 'active',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z'
        }
      ],
      globalMemories: [
        {
          id: 'memory-1',
          title: '偏好简洁回答',
          content: '先给结论，再展开细节。',
          type: 'display_preference',
          source: 'assistant_chat',
          sourceTrace: [],
          sourceIds: [],
          confidence: 0.9,
          score: 0.9,
          status: 'active',
          origin: 'manual',
          pinned: false,
          disabled: false,
          embeddingText: '偏好简洁回答\n先给结论，再展开细节。\ndisplay_preference',
          lastUsedAt: null,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z'
        }
      ]
    });

    expect(payload.version).toBe(3);
    expect(payload.data.subscriptions).toHaveLength(1);
    expect(payload.data.globalMemories).toHaveLength(1);
  });

  it('导入新版本备份时应解析订阅与全局记忆', () => {
    const payload = parseFinanceBackupPayload(
      JSON.stringify({
        version: 2,
        exportedAt: '2026-04-22T06:00:00.000Z',
        data: {
          transactions: [],
          categories: [],
          accounts: [],
          subscriptions: [
            {
              id: 'sub-1',
              name: 'Spotify',
              kind: 'digital',
              amount: 15,
              currency: 'CNY',
              billingCycle: 'monthly',
              autoRenew: true,
              status: 'active',
              createdAt: '2026-04-01T00:00:00.000Z',
              updatedAt: '2026-04-02T00:00:00.000Z'
            }
          ],
          globalMemories: [
            {
              id: 'memory-1',
              title: '保守风险偏好',
              content: '优先保证现金流安全边际。',
              type: 'risk_preference',
              source: 'assistant_chat',
              sourceTrace: [],
              sourceIds: ['msg-1'],
              confidence: 0.88,
              score: 0.88,
              status: 'active',
              origin: 'manual',
              pinned: true,
              disabled: false,
              embeddingText: '保守风险偏好\n优先保证现金流安全边际。\nrisk_preference',
              lastUsedAt: null,
              createdAt: '2026-04-01T00:00:00.000Z',
              updatedAt: '2026-04-02T00:00:00.000Z'
            }
          ]
        }
      })
    );

    expect(payload.data.subscriptions[0].name).toBe('Spotify');
    expect(payload.data.subscriptions[0].status).toBe('active');
    expect(payload.data.globalMemories[0].title).toBe('保守风险偏好');
    expect(payload.data.globalMemories[0].pinned).toBe(true);
  });
});

describe('v3 backup round-trip', () => {
  it('preserves transaction metadata, trash state, and manual balance entries', () => {
    const created = createFinanceBackupPayload({
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          categoryId: 'cat-1',
          accountId: 'acc-1',
          amount: 88.8,
          date: '2026-04-10',
          note: 'Lunch',
          tags: ['food'],
          source: 'manual',
          status: 'completed',
          adjustmentKind: 'normal',
          updatedAt: '2026-04-10T08:00:00.000Z',
          attachments: [
            {
              id: 'att-1',
              name: 'receipt.png',
              remotePath: 'ledgerflow/attachments/tx-1/receipt.png',
              uploadedAt: '2026-04-10T08:30:00.000Z',
              mimeType: 'image/png',
              size: 2048
            }
          ]
        }
      ],
      categories: [
        {
          id: 'cat-1',
          name: 'Food',
          kind: 'expense',
          sortOrder: 2,
          trashedAt: '2026-04-01T00:00:00.000Z'
        }
      ],
      accounts: [
        {
          id: 'acc-1',
          name: 'Card',
          type: 'debit',
          initialBalance: 500,
          balance: 411.2,
          sortOrder: 3,
          trashedAt: '2026-04-02T00:00:00.000Z'
        }
      ],
      subscriptions: [],
      trashedTransactions: [
        {
          id: 'tx-2',
          type: 'expense',
          categoryId: 'cat-1',
          accountId: 'acc-1',
          amount: 12.34,
          date: '2026-04-09',
          note: 'Refunded meal',
          tags: ['food', 'refund'],
          source: 'manual',
          status: 'refunded',
          adjustmentKind: 'refund',
          refundOfTransactionId: 'tx-1',
          updatedAt: '2026-04-10T09:00:00.000Z',
          trashedAt: '2026-04-11T00:00:00.000Z'
        }
      ],
      trashedCategories: [
        {
          id: 'cat-2',
          name: 'Archived',
          kind: 'expense',
          sortOrder: 4,
          trashedAt: '2026-04-11T00:00:00.000Z'
        }
      ],
      trashedAccounts: [
        {
          id: 'acc-2',
          name: 'Old Wallet',
          type: 'cash',
          initialBalance: 10,
          balance: 10,
          sortOrder: 4,
          trashedAt: '2026-04-11T00:00:00.000Z'
        }
      ],
      balanceChangeEntries: [
        {
          id: 'bal-1',
          accountId: 'acc-1',
          type: 'manual-adjustment',
          amount: 15,
          beforeBalance: 426.2,
          afterBalance: 411.2,
          createdAt: '2026-04-12T00:00:00.000Z',
          note: 'Manual fix',
          remark: 'Adjusted after audit'
        }
      ],
      trashedSubscriptions: [
        {
          id: 'sub-1',
          name: 'Old plan',
          kind: 'digital',
          amount: 20,
          currency: 'CNY',
          billingCycle: 'monthly',
          status: 'paused',
          trashedAt: '2026-04-15T00:00:00.000Z',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z'
        }
      ],
      globalMemories: []
    });

    const parsed = parseFinanceBackupPayload(JSON.stringify(created));

    expect(parsed.version).toBe(3);
    expect(parsed.data.transactions[0].attachments?.[0].remotePath).toBe(
      'ledgerflow/attachments/tx-1/receipt.png'
    );
    expect(parsed.data.trashedTransactions[0].refundOfTransactionId).toBe('tx-1');
    expect(parsed.data.categories[0].trashedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(parsed.data.accounts[0].sortOrder).toBe(3);
    expect(parsed.data.balanceChangeEntries[0].type).toBe('manual-adjustment');
    expect(parsed.data.trashedSubscriptions[0].trashedAt).toBe('2026-04-15T00:00:00.000Z');
  });
});

describe('webdav config storage hardening', () => {
  it('should not persist WebDAV password in localStorage', () => {
    saveWebdavConfig(baseConfig);

    const persisted = localStorage.getItem(BACKUP_KEY) || '';
    expect(persisted).not.toContain(baseConfig.password);
    expect(persisted).toContain('"password":""');

    expect(sessionStorage.getItem(BACKUP_PASSWORD_SESSION_KEY)).toBe(baseConfig.password);
  });

  it('should restore password from sessionStorage when loading config', () => {
    saveWebdavConfig(baseConfig);

    const loaded = loadWebdavConfig();
    expect(loaded.password).toBe(baseConfig.password);
  });
});

describe('sanitizeWebdavConfig', () => {
  it('仅允许 HTTPS 且拒绝本地/内网地址', () => {
    expect(() =>
      sanitizeWebdavConfig({
        ...baseConfig,
        endpoint: 'http://dav.example.com/remote.php/dav/files/user'
      })
    ).toThrow('WebDAV 地址仅支持 HTTPS 协议');

    expect(() =>
      sanitizeWebdavConfig({
        ...baseConfig,
        endpoint: 'https://127.0.0.1/remote.php/dav/files/user'
      })
    ).toThrow('WebDAV 地址不允许使用本地或内网地址');
  });

  it('应规范化代理路径与远程文件路径', () => {
    const sanitized = sanitizeWebdavConfig({
      ...baseConfig,
      proxyBasePath: '/api/webdav///',
      remoteFilePath: ' /账本备份/2026 02 backup.json/ '
    });

    expect(sanitized.proxyBasePath).toBe('/api/webdav');
    expect(sanitized.remoteFilePath).toBe('账本备份/2026 02 backup.json');
    expect(sanitized.retainedVersions).toBe(3);
  });

  it('远程文件路径包含空段时应拒绝', () => {
    expect(() =>
      sanitizeWebdavConfig({
        ...baseConfig,
        remoteFilePath: '账本备份//2026 02 backup.json'
      })
    ).toThrow('远程文件路径不合法，请避免使用空段或 . / ..');
  });
});

describe('webdav backup version listing', () => {
  it('应能从带完整 endpoint 前缀的 PROPFIND href 中识别时间戳版本', async () => {
    const propfindBody = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/</d:href>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/2026%2002%20backup-2026-03-06_15-00-00.json</d:href>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/2026%2002%20backup-2026-03-05_11-22-33.json</d:href>
        </d:response>
      </d:multistatus>`;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 207,
      text: () => Promise.resolve(propfindBody)
    });
    vi.stubGlobal('fetch', fetchMock);

    const versions = await listWebdavBackupVersions(baseConfig);

    expect(versions).toHaveLength(2);
    expect(versions[0].remotePath).toBe('账本备份/2026 02 backup-2026-03-06_15-00-00.json');
    expect(versions[0].isLatest).toBe(true);
    expect(versions[0].backupAt).toBe('2026-03-06T15:00:00.000Z');
    expect(versions[1].remotePath).toBe('账本备份/2026 02 backup-2026-03-05_11-22-33.json');

    vi.unstubAllGlobals();
  });

  it('固定 backup.json 存在时，应复用最新时间戳版本作为标签说明', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 207,
      text: () =>
        Promise.resolve(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:">
            <d:response>
              <d:href>/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/backup.json</d:href>
            </d:response>
            <d:response>
              <d:href>/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/backup-2026-04-10_11-11-20.json</d:href>
            </d:response>
            <d:response>
              <d:href>/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/backup-2026-03-12_05-18-00.json</d:href>
            </d:response>
          </d:multistatus>`)
    });
    vi.stubGlobal('fetch', fetchMock);

    const versions = await listWebdavBackupVersions({
      ...baseConfig,
      remoteFilePath: '账本备份/backup.json'
    });

    expect(versions).toHaveLength(3);
    expect(versions[0].fileName).toBe('backup.json');
    expect(versions[0].label).toBe('2026-04-10 11:11:20 · 固定入口');
    expect(versions[0].isLatest).toBe(true);
    expect(versions[0].backupAt).toBe('2026-04-10T11:11:20.000Z');
    expect(versions[1].label).toBe('2026-04-10 11:11:20');

    vi.unstubAllGlobals();
  });

  it('固定 backup.json 无版本文件时，应读取 WebDAV 修改时间', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 207,
      text: () =>
        Promise.resolve(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:">
            <d:response>
              <d:href>/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/backup.json</d:href>
              <d:propstat>
                <d:prop>
                  <d:getlastmodified>Tue, 26 May 2026 08:30:00 GMT</d:getlastmodified>
                </d:prop>
              </d:propstat>
            </d:response>
          </d:multistatus>`)
    });
    vi.stubGlobal('fetch', fetchMock);

    const versions = await listWebdavBackupVersions({
      ...baseConfig,
      remoteFilePath: '账本备份/backup.json'
    });

    expect(versions).toHaveLength(1);
    expect(versions[0].label).toBe('当前固定备份文件');
    expect(versions[0].backupAt).toBe('2026-05-26T08:30:00.000Z');

    vi.unstubAllGlobals();
  });
});

describe('webdavUploadFile', () => {
  it('附件上传时即使目录预创建返回 400，只要最终 PUT 成功也应视为成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 201 });

    vi.stubGlobal('fetch', fetchMock);

    const file = new Blob(['hello'], { type: 'text/plain' });
    const result = await webdavUploadFile(
      baseConfig,
      '账本备份/attachments/tx-1/test file.txt',
      file,
      'text/plain'
    );

    expect(result.remotePath).toBe('账本备份/attachments/tx-1/test file.txt');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      '/api/webdav/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/attachments/tx-1/test%20file.txt'
    );

    vi.unstubAllGlobals();
  });
});
