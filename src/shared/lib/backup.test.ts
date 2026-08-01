import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFinanceBackupPayload,
  type BackupObjectStorageConfig,
  countFinanceBackupRecords,
  createDefaultFinanceBackupScope,
  createFinanceBackupPayload,
  listWebdavBackupVersions,
  loadObjectStorageConfig,
  loadWebdavConfig,
  objectStorageUploadBackup,
  parseFinanceBackupPayload,
  sanitizeObjectStorageConfig,
  sanitizeWebdavConfig,
  saveObjectStorageConfig,
  saveWebdavConfig,
  webdavUploadBackup,
  webdavUploadFile,
  type BackupWebdavConfig
} from './backup';
import { LEDGERFLOW_API_TOKEN_STORAGE_KEY } from './ledgerflowApiToken';

const BACKUP_KEY = 'ledgerflow-backup-webdav-v1';
const BACKUP_PASSWORD_SESSION_KEY = 'ledgerflow-backup-webdav-password';
const OBJECT_STORAGE_KEY_PREFIX = 'ledgerflow-backup-object-storage-v1';
const OBJECT_STORAGE_SECRET_SESSION_KEY_PREFIX = 'ledgerflow-backup-object-storage-secret-v1';

const baseConfig: BackupWebdavConfig = {
  endpoint: 'https://dav.example.com/remote.php/dav/files/user',
  username: 'alice',
  password: 'secret',
  remoteFilePath: '账本备份/2026 02 backup.json',
  retainedVersions: 3,
  proxyEnabled: true,
  proxyBasePath: '/api/webdav'
};

const baseObjectStorageConfig: BackupObjectStorageConfig = {
  provider: 'aliyun-oss',
  endpoint: 'https://oss-cn-guangzhou.aliyuncs.com',
  region: 'cn-guangzhou',
  bucket: 'ledgerflow-backup',
  accessKeyId: 'ak-test',
  accessKeySecret: 'secret-test',
  remoteFilePath: '账本备份/backup.json',
  retainedVersions: 3,
  forcePathStyle: false
};

beforeEach(() => {
  localStorage.removeItem(BACKUP_KEY);
  localStorage.removeItem(LEDGERFLOW_API_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(BACKUP_PASSWORD_SESSION_KEY);
  localStorage.removeItem(`${OBJECT_STORAGE_KEY_PREFIX}:aliyun-oss`);
  localStorage.removeItem(`${OBJECT_STORAGE_KEY_PREFIX}:s3-compatible`);
  sessionStorage.removeItem(`${OBJECT_STORAGE_SECRET_SESSION_KEY_PREFIX}:aliyun-oss`);
  sessionStorage.removeItem(`${OBJECT_STORAGE_SECRET_SESSION_KEY_PREFIX}:s3-compatible`);
});

describe('parseFinanceBackupPayload', () => {
  it('支持带 UTF-8 BOM 的 JSON 备份', () => {
    const payload = parseFinanceBackupPayload(
      '\uFEFF{\n"version":1,"data":{"transactions":[],"categories":[],"accounts":[]}}'
    );

    expect(payload.version).toBe(1);
    expect(payload.scope).toEqual(createDefaultFinanceBackupScope());
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
      ],
      investmentPositions: [
        {
          id: 'pos-1',
          name: '沪深 300 ETF',
          category: 'index-fund',
          platform: '支付宝',
          investedAmount: 10000,
          currentValue: 10880,
          monthlyContribution: 1200,
          targetAllocation: 40,
          riskLevel: 'medium',
          note: '长期底仓',
          isActive: true,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-20T00:00:00.000Z'
        }
      ]
    });

    expect(payload.version).toBe(3);
    expect(payload.data.subscriptions).toHaveLength(1);
    expect(payload.data.globalMemories).toHaveLength(1);
    expect(payload.data.investmentPositions).toHaveLength(1);
  });

  it('应支持按范围导出备份并保留范围元数据', () => {
    const payload = createFinanceBackupPayload(
      {
        transactions: [
          {
            id: 'tx-1',
            type: 'expense',
            categoryId: 'cat-1',
            accountId: 'acc-1',
            amount: 18,
            date: '2026-04-01',
            note: 'Lunch',
            tags: []
          }
        ],
        categories: [{ id: 'cat-1', name: 'Food', kind: 'expense', sortOrder: 1 }],
        accounts: [{ id: 'acc-1', name: 'Cash', type: 'cash', balance: 18 }],
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
        trashedTransactions: [
          {
            id: 'tx-trash-1',
            type: 'expense',
            categoryId: 'cat-1',
            accountId: 'acc-1',
            amount: 5,
            date: '2026-04-02',
            note: 'Snack',
            tags: [],
            status: 'completed',
            trashedAt: '2026-04-03T00:00:00.000Z'
          }
        ],
        trashedCategories: [{ id: 'cat-trash-1', name: 'Old', kind: 'expense', sortOrder: 2 }],
        trashedAccounts: [{ id: 'acc-trash-1', name: 'Old', type: 'cash', balance: 0 }],
        balanceChangeEntries: [
          {
            id: 'bal-1',
            accountId: 'acc-1',
            type: 'manual-adjustment',
            amount: 1,
            beforeBalance: 17,
            afterBalance: 18,
            createdAt: '2026-04-02T00:00:00.000Z'
          }
        ],
        trashedSubscriptions: [
          {
            id: 'sub-trash-1',
            name: 'Old plan',
            kind: 'digital',
            amount: 12,
            currency: 'CNY',
            billingCycle: 'monthly',
            status: 'paused',
            createdAt: '2026-03-01T00:00:00.000Z',
            updatedAt: '2026-03-02T00:00:00.000Z'
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
        ],
        investmentWatchlist: [
          {
            id: 'watch-1',
            name: '招商优质成长混合(LOF)',
            code: '161706',
            platform: '蚂蚁基金',
            tags: ['高波动'],
            note: '适合继续观察',
            lastVerdict: '资料支撑仓',
            lastSummary: '经理任期回报优异，但持股集中度较高。',
            lastRiskLevel: 'high',
            investmentAdvice: '暂时观察，不主动加仓',
            adviceReasons: ['经理任期回报优异'],
            riskNotes: ['高持股集中度会放大波动'],
            nextActions: ['等待季度持仓更新后复盘'],
            performanceHistory: ['近五年回撤偏大'],
            fundAnalysis: ['成长风格明显，适合高风险用户观察'],
            fundHoldings: ['资源股占比较高'],
            assetAllocation: ['股票 88%', '现金 12%'],
            industryAllocation: ['有色金属 22%', '电子 16%'],
            buyFeeRate: '0.15%',
            fundCompany: '招商基金',
            lastAnalysisAt: '2026-05-28T01:47:00.000Z',
            createdAt: '2026-05-28T01:47:00.000Z',
            updatedAt: '2026-05-28T01:47:00.000Z'
          }
        ]
      },
      {
        ledger: false,
        subscriptions: true,
        globalMemories: false,
        investments: false
      }
    );

    expect(payload.scope).toEqual({
      ledger: false,
      subscriptions: true,
      globalMemories: false,
      investments: false
    });
    expect(payload.data.transactions).toEqual([]);
    expect(payload.data.categories).toEqual([]);
    expect(payload.data.accounts).toEqual([]);
    expect(payload.data.trashedTransactions).toEqual([]);
    expect(payload.data.balanceChangeEntries).toEqual([]);
    expect(payload.data.subscriptions).toHaveLength(1);
    expect(payload.data.trashedSubscriptions).toHaveLength(1);
    expect(payload.data.globalMemories).toEqual([]);
    expect(payload.data.investmentWatchlist).toEqual([]);

    const reparsed = parseFinanceBackupPayload(JSON.stringify(payload));
    expect(reparsed.scope).toEqual(payload.scope);
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
          ],
          investmentGoals: [
            {
              id: 'goal-1',
              name: '6 个月应急金',
              kind: 'emergency',
              targetAmount: 30000,
              currentAmount: 12000,
              monthlyContribution: 2000,
              targetDate: '2026-12-31',
              priority: 'high',
              note: '优先补足',
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-20T00:00:00.000Z'
            }
          ],
          investmentWatchlist: [
            {
              id: 'watch-1',
              name: '招商优质成长混合(LOF)',
              code: '161706',
              platform: '蚂蚁基金',
              tags: ['资源科技持仓', '高波动'],
              note: '适合高风险承受能力者继续观察',
              lastVerdict: '资料支撑仓',
              lastSummary: '基金成立超20年，经理任期回报优异。',
              lastRiskLevel: 'high',
              investmentAdvice: '暂时观察，不主动加仓',
              adviceReasons: ['经理任期回报优异'],
              riskNotes: ['高持股集中度会放大波动'],
              nextActions: ['等待季度持仓更新后复盘'],
              performanceHistory: ['近五年回撤偏大'],
              fundAnalysis: ['成长风格明显，适合高风险用户观察'],
              fundHoldings: ['资源股占比较高'],
              assetAllocation: ['股票 88%', '现金 12%'],
              industryAllocation: ['有色金属 22%', '电子 16%'],
              buyFeeRate: '0.15%',
              fundCompany: '招商基金',
              lastAnalysisAt: '2026-05-28T01:47:00.000Z',
              createdAt: '2026-05-28T01:47:00.000Z',
              updatedAt: '2026-05-28T01:47:00.000Z'
            }
          ],
          investmentAiMessages: [
            {
              id: 'msg-assistant-1',
              role: 'assistant',
              text: '参考自选记录后，暂时更适合继续观察。',
              feedback: 'up',
              attachmentImages: ['data:image/png;base64,ZmFrZS1mdW5kLWltYWdl'],
              analysis: {
                fundName: '招商优质成长混合(LOF)',
                fundCode: '161706',
                verdict: '继续观察',
                summary: '结合自选里的高波动记录，本次不建议贸然加仓。',
                riskLevel: 'high',
                highlights: ['已有历史观察记录'],
                risks: ['高波动'],
                actions: ['继续跟踪'],
                watchTags: ['高波动'],
                performanceHistory: ['历史波动较高'],
                fundAnalysis: ['更适合观察，不适合追涨'],
                fundHoldings: ['资源股占比较高'],
                assetAllocation: ['股票 88%'],
                industryAllocation: ['有色金属 22%'],
                buyFeeRate: '0.15%',
                fundCompany: '招商基金',
                platform: '蚂蚁基金',
                note: '参考自选历史判断'
              },
              createdAt: '2026-05-28T02:00:00.000Z'
            }
          ]
        }
      })
    );

    expect(payload.data.subscriptions[0].name).toBe('Spotify');
    expect(payload.data.subscriptions[0].status).toBe('active');
    expect(payload.data.globalMemories[0].title).toBe('保守风险偏好');
    expect(payload.data.globalMemories[0].pinned).toBe(true);
    expect(payload.data.investmentGoals[0].name).toBe('6 个月应急金');
    expect(payload.data.investmentWatchlist[0].investmentAdvice).toBe('暂时观察，不主动加仓');
    expect(payload.data.investmentWatchlist[0].fundCompany).toBe('招商基金');
    expect(payload.data.investmentAiMessages[0].analysis?.fundCode).toBe('161706');
    expect(payload.data.investmentAiMessages[0].analysis?.buyFeeRate).toBe('0.15%');
    expect(payload.data.investmentAiMessages[0].attachmentImages).toEqual([
      'data:image/png;base64,ZmFrZS1mdW5kLWltYWdl'
    ]);
    expect(payload.data.investmentAiMessages[0].attachmentCount).toBe(1);
  });

  it('恢复旧对象存储备份时应兼容后来新增的订阅与投资字段', () => {
    const payload = parseFinanceBackupPayload(
      JSON.stringify({
        version: 2,
        exportedAt: '2026-05-31T02:12:50.000Z',
        data: {
          transactions: [],
          categories: [],
          accounts: [],
          subscriptions: [
            {
              id: 'sub-legacy-1',
              name: '旧订阅',
              amount: 18
            }
          ],
          investmentPositions: [
            {
              id: 'pos-legacy-1',
              name: '旧持仓'
            }
          ],
          investmentPositionHistory: [
            {
              id: 'history-legacy-1',
              positionId: 'pos-legacy-1',
              positionName: '旧持仓'
            }
          ],
          investmentGoals: [
            {
              id: 'goal-legacy-1',
              name: '旧目标'
            }
          ],
          investmentWatchlist: [
            {
              id: 'watch-legacy-1',
              name: '旧自选基金',
              analysis: {
                note: '旧版只记录了备注'
              }
            }
          ],
          investmentAiMessages: [
            {
              id: 'msg-legacy-1',
              analysis: {
                fundName: '旧基金'
              }
            }
          ]
        }
      })
    );

    expect(payload.data.subscriptions[0]).toMatchObject({
      kind: 'other',
      currency: 'CNY',
      billingCycle: 'monthly',
      status: 'active',
      createdAt: '2026-05-31T02:12:50.000Z'
    });
    expect(payload.data.investmentPositions[0]).toMatchObject({
      category: 'other',
      investedAmount: 0,
      currentValue: 0,
      riskLevel: 'medium',
      isActive: true,
      createdAt: '2026-05-31T02:12:50.000Z'
    });
    expect(payload.data.investmentPositionHistory[0]).toMatchObject({
      action: 'snapshot',
      profit: 0,
      profitRate: 0,
      isActive: true
    });
    expect(payload.data.investmentGoals[0]).toMatchObject({
      kind: 'other',
      priority: 'medium',
      targetAmount: 0,
      currentAmount: 0
    });
    expect(payload.data.investmentWatchlist[0].createdAt).toBe('2026-05-31T02:12:50.000Z');
    expect(payload.data.investmentAiMessages[0]).toMatchObject({
      role: 'assistant',
      text: '旧备份未记录消息正文',
      createdAt: '2026-05-31T02:12:50.000Z',
      analysis: {
        fundName: '旧基金',
        verdict: '待复盘',
        summary: '旧备份未记录分析摘要',
        riskLevel: 'unknown'
      }
    });
  });

  it('恢复部分备份时应保留未选范围的本地数据', () => {
    const current: Parameters<typeof applyFinanceBackupPayload>[0] = {
      transactions: [
        {
          id: 'tx-current-1',
          type: 'expense',
          categoryId: 'cat-current-1',
          accountId: 'acc-current-1',
          amount: 28,
          date: '2026-05-01',
          note: 'Dinner',
          tags: [],
          status: 'completed'
        }
      ],
      categories: [{ id: 'cat-current-1', name: 'Current', kind: 'expense', sortOrder: 1 }],
      accounts: [{ id: 'acc-current-1', name: 'Current card', type: 'debit', balance: 28 }],
      subscriptions: [
        {
          id: 'sub-current-1',
          name: 'Old Plan',
          kind: 'digital',
          amount: 8,
          currency: 'CNY',
          billingCycle: 'monthly',
          status: 'active',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z'
        }
      ],
      trashedTransactions: [],
      trashedCategories: [],
      trashedAccounts: [],
      balanceChangeEntries: [],
      trashedSubscriptions: [],
      globalMemories: [
        {
          id: 'memory-current-1',
          title: 'Current memory',
          content: 'Keep me',
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
          embeddingText: 'Current memory\nKeep me\ndisplay_preference',
          lastUsedAt: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z'
        }
      ],
      investmentPositions: [
        {
          id: 'pos-current-1',
          name: '当前持仓',
          category: 'index-fund',
          investedAmount: 1000,
          currentValue: 1100,
          riskLevel: 'medium',
          isActive: true,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z'
        }
      ],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: []
    };

    const payload = createFinanceBackupPayload(
      {
        transactions: [],
        categories: [],
        accounts: [],
        subscriptions: [
          {
            id: 'sub-next-1',
            name: 'New Plan',
            kind: 'digital',
            amount: 18,
            currency: 'CNY',
            billingCycle: 'monthly',
            status: 'paused',
            createdAt: '2026-05-03T00:00:00.000Z',
            updatedAt: '2026-05-04T00:00:00.000Z'
          }
        ],
        trashedTransactions: [],
        trashedCategories: [],
        trashedAccounts: [],
        balanceChangeEntries: [],
        trashedSubscriptions: [],
        globalMemories: [],
        investmentPositions: [],
        investmentPositionHistory: [],
        investmentGoals: [],
        investmentWatchlist: [
          {
            id: 'watch-next-1',
            name: '新自选基金',
            tags: [],
            createdAt: '2026-05-03T00:00:00.000Z',
            updatedAt: '2026-05-04T00:00:00.000Z'
          }
        ],
        investmentAiMessages: []
      },
      {
        ledger: false,
        subscriptions: true,
        globalMemories: false,
        investments: false
      }
    );

    const restored = applyFinanceBackupPayload(current, payload);

    expect(restored.transactions).toEqual(current.transactions);
    expect(restored.categories).toEqual(current.categories);
    expect(restored.accounts).toEqual(current.accounts);
    expect(restored.subscriptions).toEqual(payload.data.subscriptions);
    expect(restored.globalMemories).toEqual(current.globalMemories);
    expect(restored.investmentPositions).toEqual(current.investmentPositions);
    expect(restored.investmentWatchlist).toEqual(current.investmentWatchlist);
  });
});

describe('countFinanceBackupRecords', () => {
  it('统计备份中所有可导入的数据条数', () => {
    const payload = createFinanceBackupPayload({
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          categoryId: '',
          accountId: '',
          amount: 1,
          date: '2026-08-01',
          note: '',
          tags: []
        }
      ],
      categories: [{ id: 'cat-1', name: '其他', kind: 'expense', sortOrder: 0 }],
      accounts: [{ id: 'account-1', name: '现金', type: 'cash', balance: 0 }],
      subscriptions: [],
      trashedTransactions: [],
      trashedCategories: [],
      trashedAccounts: [],
      balanceChangeEntries: [],
      trashedSubscriptions: [],
      globalMemories: [
        {
          id: 'memory-1',
          title: '偏好',
          content: '简洁',
          type: 'display_preference',
          source: 'manual',
          sourceTrace: [],
          sourceIds: [],
          confidence: 1,
          score: 1,
          status: 'active',
          origin: 'manual',
          pinned: false,
          disabled: false,
          embeddingText: '简洁',
          lastUsedAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z'
        }
      ],
      investmentPositions: [],
      investmentPositionHistory: [],
      investmentGoals: [],
      investmentWatchlist: [],
      investmentAiMessages: []
    });

    expect(countFinanceBackupRecords(payload)).toBe(4);
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

describe('object storage config storage hardening', () => {
  it('should not persist OSS/S3 secret in localStorage', () => {
    saveObjectStorageConfig(baseObjectStorageConfig);

    const persisted = localStorage.getItem(`${OBJECT_STORAGE_KEY_PREFIX}:aliyun-oss`) || '';
    expect(persisted).not.toContain(baseObjectStorageConfig.accessKeySecret);
    expect(persisted).toContain('"accessKeySecret":""');

    expect(sessionStorage.getItem(`${OBJECT_STORAGE_SECRET_SESSION_KEY_PREFIX}:aliyun-oss`)).toBe(
      baseObjectStorageConfig.accessKeySecret
    );
  });

  it('should restore OSS/S3 secret from sessionStorage when loading config', () => {
    saveObjectStorageConfig(baseObjectStorageConfig);

    const loaded = loadObjectStorageConfig('aliyun-oss');
    expect(loaded.accessKeySecret).toBe(baseObjectStorageConfig.accessKeySecret);
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

describe('sanitizeObjectStorageConfig', () => {
  it('应规范化 OSS 配置并隐藏路径风格选项', () => {
    const sanitized = sanitizeObjectStorageConfig({
      ...baseObjectStorageConfig,
      endpoint: 'https://oss-cn-guangzhou.aliyuncs.com/',
      region: '',
      remoteFilePath: ' /账本备份/backup.json/ ',
      retainedVersions: 99,
      forcePathStyle: true
    });

    expect(sanitized.endpoint).toBe('https://oss-cn-guangzhou.aliyuncs.com');
    expect(sanitized.region).toBe('cn-guangzhou');
    expect(sanitized.remoteFilePath).toBe('账本备份/backup.json');
    expect(sanitized.retainedVersions).toBe(50);
    expect(sanitized.forcePathStyle).toBe(false);
  });

  it('S3 兼容配置应保留路径风格地址', () => {
    const sanitized = sanitizeObjectStorageConfig({
      ...baseObjectStorageConfig,
      provider: 's3-compatible',
      endpoint: 'https://s3.example.com',
      region: '',
      forcePathStyle: true
    });

    expect(sanitized.region).toBe('us-east-1');
    expect(sanitized.forcePathStyle).toBe(true);
  });

  it('应拒绝不安全的对象存储 Endpoint 与 Bucket', () => {
    expect(() =>
      sanitizeObjectStorageConfig({
        ...baseObjectStorageConfig,
        endpoint: 'http://oss-cn-guangzhou.aliyuncs.com'
      })
    ).toThrow('对象存储 Endpoint 仅支持 HTTPS 协议');

    expect(() =>
      sanitizeObjectStorageConfig({
        ...baseObjectStorageConfig,
        bucket: 'bad bucket'
      })
    ).toThrow('Bucket 名称不应包含空格或斜杠');
  });
});

describe('objectStorageUploadBackup', () => {
  it('阿里云 OSS 上传应使用 V4 签名头且不把密钥放入请求 URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<ListBucketResult />')
      });
    vi.stubGlobal('fetch', fetchMock);

    const payload = {
      ...createFinanceBackupPayload({
        transactions: [],
        categories: [],
        accounts: [],
        subscriptions: [],
        globalMemories: []
      }),
      exportedAt: '2026-05-28T01:52:17.000Z'
    };

    await objectStorageUploadBackup(baseObjectStorageConfig, payload);

    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstUrl).toContain('https://ledgerflow-backup.oss-cn-guangzhou.aliyuncs.com/');
    expect(firstUrl).not.toContain(baseObjectStorageConfig.accessKeySecret);
    expect(firstHeaders.Authorization).toContain('OSS4-HMAC-SHA256 Credential=ak-test/');
    expect(firstHeaders.Authorization).toContain('/cn-guangzhou/oss/aliyun_v4_request');
    expect(firstHeaders.Authorization).toContain('AdditionalHeaders=host');
    expect(firstHeaders['x-oss-content-sha256']).toBe('UNSIGNED-PAYLOAD');
    expect(firstHeaders['x-oss-date']).toMatch(/^\d{8}T\d{6}Z$/);

    vi.unstubAllGlobals();
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
  it('同源代理请求应带 LedgerFlow 代理令牌并保留 WebDAV Basic 认证', async () => {
    localStorage.setItem(LEDGERFLOW_API_TOKEN_STORAGE_KEY, 'proxy-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: () => Promise.resolve('')
    });
    vi.stubGlobal('fetch', fetchMock);

    await webdavUploadFile(baseConfig, '账本备份/test file.txt', new Blob(['hello']), 'text/plain');

    const putCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'PUT');
    const headers = putCall?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers['X-LedgerFlow-Api-Token']).toBe('proxy-token');
    expect(headers['X-WebDAV-Endpoint']).toBe(baseConfig.endpoint);

    vi.unstubAllGlobals();
  });

  it('附件上传时即使目录预创建返回 400，只要临时 PUT 和 MOVE 成功也应视为成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    vi.stubGlobal('fetch', fetchMock);

    const file = new Blob(['hello'], { type: 'text/plain' });
    const result = await webdavUploadFile(
      baseConfig,
      '账本备份/attachments/tx-1/test file.txt',
      file,
      'text/plain'
    );

    expect(result.remotePath).toBe('账本备份/attachments/tx-1/test file.txt');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[3]?.[0]).toContain(
      '/api/webdav/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/attachments/tx-1/.test%20file.txt.uploading-'
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: 'PUT' });
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: 'MOVE' });
    expect((fetchMock.mock.calls[4]?.[1]?.headers as Record<string, string>).Destination).toBe(
      'https://dav.example.com/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/attachments/tx-1/test%20file.txt'
    );

    vi.unstubAllGlobals();
  });

  it('临时 PUT 失败时应尝试删除临时文件，避免保留上传占位', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      webdavUploadFile(
        {
          ...baseConfig,
          remoteFilePath: 'backup.json'
        },
        'backup.json',
        new Blob(['hello'], { type: 'text/plain' }),
        'text/plain'
      )
    ).rejects.toThrow('WebDAV 上传失败');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/webdav/.backup.json.uploading-');

    vi.unstubAllGlobals();
  });
});

describe('webdavUploadBackup', () => {
  it('应先上传临时文件再 MOVE 到最终备份名，避免 Cloudreve 留下 0B 最终文件', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: () => Promise.resolve('')
    });
    vi.stubGlobal('fetch', fetchMock);

    const payload = {
      ...createFinanceBackupPayload({
        transactions: [],
        categories: [],
        accounts: [],
        subscriptions: [],
        globalMemories: []
      }),
      exportedAt: '2026-05-28T01:52:17.000Z'
    };

    await webdavUploadBackup(baseConfig, payload);

    const putCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT');
    const moveCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === 'MOVE');
    expect(putCalls).toHaveLength(2);
    expect(moveCalls).toHaveLength(2);
    expect(putCalls[0]?.[0]).toContain('.2026%2002%20backup-2026-05-28_01-52-17.json.uploading-');
    expect(putCalls[1]?.[0]).toContain('.2026%2002%20backup.json.uploading-');
    expect(putCalls.map((call) => String(call[0]))).not.toContain(
      '/api/webdav/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/2026%2002%20backup-2026-05-28_01-52-17.json'
    );
    expect((moveCalls[0]?.[1]?.headers as Record<string, string>).Destination).toBe(
      'https://dav.example.com/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/2026%2002%20backup-2026-05-28_01-52-17.json'
    );
    expect((moveCalls[1]?.[1]?.headers as Record<string, string>).Destination).toBe(
      'https://dav.example.com/remote.php/dav/files/user/%E8%B4%A6%E6%9C%AC%E5%A4%87%E4%BB%BD/2026%2002%20backup.json'
    );

    vi.unstubAllGlobals();
  });
});
