import { describe, expect, it } from 'vitest';
import { createFinanceBackupPayload, parseFinanceBackupPayload } from './backup';

/**
 * 备份往返的**全字段**不变量:导出 → JSON → 解析,结果必须与导出内容逐字段相等。
 *
 * 为什么需要它:原有的往返测试只断言了 7 个手挑字段(`attachments[0].remotePath`、
 * `refundOfTransactionId`…)—— 只要某个字段在序列化或校验阶段被悄悄丢掉/改写,
 * 那 7 条断言照样全绿,用户却会在「导出 → 换设备恢复」时**静默丢数据**。
 *
 * 这里的 fixture 刻意把**每个实体的每个可选字段都填上**,再断言整对象相等,
 * 于是「哪个字段被丢了」会直接体现在 diff 里。
 */

const attachment = {
  id: 'att-1',
  name: 'receipt.png',
  remotePath: 'ledgerflow/attachments/tx-1/receipt.png',
  uploadedAt: '2026-04-10T08:30:00.000Z',
  mimeType: 'image/png',
  size: 2048
};

/** 交易:填满所有可选字段(含订单号、调整类型、退款指向、附件、删除时间)。 */
const transaction = {
  id: 'tx-1',
  type: 'expense' as const,
  categoryId: 'cat-1',
  accountId: 'acc-1',
  amount: 88.8,
  date: '2026-04-10',
  note: 'Lunch',
  tags: ['food', 'work'],
  source: 'manual' as const,
  orderNo: 'ORDER-1',
  merchantOrderNo: 'MERCHANT-1',
  status: 'completed' as const,
  adjustmentKind: 'normal' as const,
  refundOfTransactionId: 'tx-0',
  attachments: [attachment],
  updatedAt: '2026-04-10T09:00:00.000Z'
};

const category = {
  id: 'cat-1',
  name: 'Food',
  kind: 'expense' as const,
  parentId: 'cat-root',
  color: '#f97316',
  icon: '🍜',
  sortOrder: 2
};

const account = {
  id: 'acc-1',
  name: 'Card',
  type: 'debit' as const,
  initialBalance: 500,
  balance: 411.2,
  sortOrder: 3
};

const subscription = {
  id: 'sub-1',
  name: 'Music',
  kind: 'digital' as const,
  provider: 'ACME',
  accountId: 'acc-1',
  amount: 15,
  currency: 'CNY',
  billingCycle: 'monthly' as const,
  customCycleDays: 30,
  renewalDate: '2026-05-01',
  expireDate: '2026-05-01',
  status: 'active' as const,
  autoRenew: true,
  note: 'family plan',
  lastGeneratedAt: '2026-04-01',
  lastGeneratedTransactionId: 'tx-1',
  // v0.50.18 起:生成支出推进续费日前的快照,删除生成流水时用它精确还原
prevRenewalDate: '2026-03-01',
  prevExpireDate: '2026-03-01',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z'
};

const balanceChange = {
  id: 'bc-1',
  accountId: 'acc-1',
  transactionId: 'tx-1',
  relatedTransactionId: 'tx-2',
  type: 'manual-adjustment' as const,
  amount: -12.34,
  beforeBalance: 423.54,
  afterBalance: 411.2,
  createdAt: '2026-04-10T10:00:00.000Z',
  note: '手动校准'
};

const globalMemory = {
  id: 'gm-1',
  title: '偏好',
  content: '用户偏好月度预算',
  type: 'user_preference' as const,
  source: 'assistant_chat' as const,
  sourceTrace: [
    {
      kind: 'assistant_chat' as const,
      label: '对话',
      sourceId: 'msg-1',
      excerpt: '预算相关',
      recordedAt: '2026-04-01T00:00:00.000Z'
    }
  ],
  sourceIds: ['msg-1'],
  confidence: 0.9,
  score: 0.8,
  status: 'active' as const,
  origin: 'extracted' as const,
  pinned: true,
  disabled: false,
  embeddingText: '预算 偏好',
  lastUsedAt: '2026-04-09T00:00:00.000Z',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-02T00:00:00.000Z'
};

const investmentPosition = {
  id: 'pos-1',
  name: '沪深300',
  category: 'index-fund' as const,
  platform: '天天基金',
  linkedAccountId: 'acc-1',
  investedAmount: 10000,
  currentValue: 11200,
  fundCode: '000001',
  holdingShares: 1234.56,
  monthlyContribution: 500,
  targetAllocation: 30,
  riskLevel: 'medium' as const,
  note: '长期定投',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z'
};

const positionHistory = {
  id: 'hist-1',
  positionId: 'pos-1',
  positionName: '沪深300',
  category: 'index-fund' as const,
  platform: '天天基金',
  action: 'update' as const,
  investedAmount: 10000,
  currentValue: 11200,
  fundCode: '000001',
  holdingShares: 1234.56,
  profit: 1200,
  profitRate: 12,
  investedAmountDelta: 1000,
  currentValueDelta: 1200,
  isActive: true,
  note: '加仓',
  createdAt: '2026-04-01T00:00:00.000Z'
};

const investmentGoal = {
  id: 'goal-1',
  name: '应急金',
  kind: 'emergency' as const,
  targetAmount: 60000,
  currentAmount: 20000,
  monthlyContribution: 2000,
  targetDate: '2027-12-31',
  priority: 'high' as const,
  note: '3 个月开销',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z'
};

const watchItem = {
  id: 'watch-1',
  name: '中证500',
  code: '000905',
  platform: '天天基金',
  tags: ['指数', '观察'],
  note: '等回调',
  lastVerdict: '观望',
  lastSummary: '估值中性',
  lastRiskLevel: 'medium' as const,
  investmentAdvice: '分批买入',
  adviceReasons: ['估值分位 40%'],
  riskNotes: ['短期波动'],
  nextActions: ['每周复盘'],
  holdingShares: 0,
  performanceHistory: ['+1.2%'],
  fundAnalysis: ['跟踪误差小'],
  fundHoldings: ['贵州茅台'],
  assetAllocation: ['股票 95%'],
  industryAllocation: ['制造业 40%'],
  netValue: '1.2345',
  addedReturn: '12%',
  holdingReturn: '8%',
  buyFeeRate: '0.15%',
  fundCompany: '中证指数',
  lastAnalysisAt: '2026-04-01T00:00:00.000Z',
  lastDataAt: '2026-04-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-04-02T00:00:00.000Z'
};

const aiMessage = {
  id: 'ai-1',
  role: 'assistant' as const,
  text: '建议定投',
  feedback: 'up' as const,
  reasoning: '因为长期收益',
  webTrace: '{"urls":[]}',
  auxiliaryInfo: '附加信息',
  followUpPrompts: ['怎么做'],
  attachmentCount: 1,
  attachmentImages: ['data:image/png;base64,AAA'],
  createdAt: '2026-04-02T00:00:00.000Z'
};

const fullFixture = {
  transactions: [transaction],
  categories: [category],
  accounts: [account],
  subscriptions: [subscription],
  trashedTransactions: [{ ...transaction, id: 'tx-trash', trashedAt: '2026-04-11T00:00:00.000Z' }],
  trashedCategories: [{ ...category, id: 'cat-trash', trashedAt: '2026-04-11T00:00:00.000Z' }],
  trashedAccounts: [{ ...account, id: 'acc-trash', trashedAt: '2026-04-11T00:00:00.000Z' }],
  balanceChangeEntries: [balanceChange],
  trashedSubscriptions: [{ ...subscription, id: 'sub-trash', trashedAt: '2026-04-11T00:00:00.000Z' }],
  globalMemories: [globalMemory],
  investmentPositions: [investmentPosition],
  investmentPositionHistory: [positionHistory],
  investmentGoals: [investmentGoal],
  investmentWatchlist: [watchItem],
  investmentAiMessages: [aiMessage]
};

/**
 * 递归去掉值为 `undefined` 的键。
 *
 * 解析路径会给对象补上 `remark: undefined` / `trashedAt: undefined` 这类键,而导出路径是
 * 直接省略 —— 写进文件的内容完全一样,只是内存里的对象形状不同。断言要比的是**真实取值**,
 * 不是这种表示差异。
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = stripUndefined(item);
    }
    return out as T;
  }
  return value;
}

describe('备份往返一致性(全字段)', () => {
  it('导出 → JSON → 解析后与原载荷逐字段相等', () => {
    const created = createFinanceBackupPayload(fullFixture);
    const parsed = parseFinanceBackupPayload(JSON.stringify(created));

    // 逐字段比对:任何被丢掉的字段都会出现在 diff 里
    expect(stripUndefined(parsed.data)).toEqual(stripUndefined(created.data));
    expect(parsed.scope).toEqual(created.scope);
    expect(parsed.version).toBe(created.version);
  });

  it('再导出一次仍然一致(往返幂等)', () => {
    const created = createFinanceBackupPayload(fullFixture);
    const once = parseFinanceBackupPayload(JSON.stringify(created));
    const twice = parseFinanceBackupPayload(JSON.stringify(once));

    expect(twice.data).toEqual(once.data);
  });

  it('每个实体集合都非空且条数不变', () => {
    const created = createFinanceBackupPayload(fullFixture);
    const parsed = parseFinanceBackupPayload(JSON.stringify(created));

    const collections = [
      'transactions',
      'categories',
      'accounts',
      'subscriptions',
      'trashedTransactions',
      'trashedCategories',
      'trashedAccounts',
      'balanceChangeEntries',
      'trashedSubscriptions',
      'globalMemories',
      'investmentPositions',
      'investmentPositionHistory',
      'investmentGoals',
      'investmentWatchlist',
      'investmentAiMessages'
    ] as const;

    for (const key of collections) {
      const before = created.data[key] as unknown[];
      const after = parsed.data[key] as unknown[];
      expect(before.length, `${key} 导出后不应为空`).toBeGreaterThan(0);
      expect(after.length, `${key} 往返后条数必须一致`).toBe(before.length);
    }
  });

  it('交易的可选字段(订单号/附件/退款指向/调整类型)一个都不能少', () => {
    const created = createFinanceBackupPayload(fullFixture);
    const parsed = parseFinanceBackupPayload(JSON.stringify(created));
    const tx = parsed.data.transactions[0];

    expect(tx.orderNo).toBe('ORDER-1');
    expect(tx.merchantOrderNo).toBe('MERCHANT-1');
    expect(tx.adjustmentKind).toBe('normal');
    expect(tx.refundOfTransactionId).toBe('tx-0');
    expect(tx.source).toBe('manual');
    expect(tx.status).toBe('completed');
    expect(tx.updatedAt).toBe('2026-04-10T09:00:00.000Z');
    expect(tx.attachments).toEqual([attachment]);
    expect(tx.tags).toEqual(['food', 'work']);
  });
});
