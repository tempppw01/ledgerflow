import { describe, expect, it } from 'vitest';
import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import type { TransactionItem } from '../../entities/transaction/types';
import {
  applyFinanceBackupPayload,
  createFinanceBackupPayload,
  parseFinanceBackupPayload,
  type FinanceBackupScope
} from './backup';

/**
 * 负债与还款记录的备份往返。
 *
 * 这两块数据存在 useAppPreferences 里,此前**完全不在备份范围内**:
 * 导出的 JSON 里没有它们,导入时自然也无从恢复 —— 换设备或重装后负债与还款历史会静默消失,
 * 而导入界面显示成功。这与「备份丢了 10 个字段」是同一类问题,只是这里是整块实体。
 */
const debt: DebtItem = {
  id: 'debt-1',
  name: '招商银行信用卡',
  type: 'credit-card',
  balance: 12860.4,
  annualRate: 18.25,
  repaymentDay: 25,
  minimumPaymentRate: 0.1,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as DebtItem;

const repayment: RepaymentRecord = {
  id: 'rep-1',
  debtId: 'debt-1',
  amount: 1286.04,
  paidAt: '2026-11-25T00:00:00.000Z',
  type: 'repayment',
  recordMode: 'manual',
  createdAt: '2026-11-25T00:00:00.000Z'
} as RepaymentRecord;

const transaction: TransactionItem = {
  id: 'tx-1',
  type: 'expense',
  categoryId: 'cat-1',
  accountId: 'acc-1',
  amount: 10,
  date: '2026-11-01T00:00:00.000Z',
  note: '午饭',
  tags: [],
  source: 'manual',
  status: 'completed'
} as TransactionItem;

const emptySnapshot = {
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
  investmentAiMessages: [],
  debts: [],
  repaymentRecords: []
};

const fullScope: FinanceBackupScope = {
  ledger: true,
  subscriptions: true,
  globalMemories: true,
  investments: true,
  debts: true,
  preferences: true
};

const samplePreferences = {
  monthlyIncome: 10000,
  smartBudgetPlan: { monthKey: '2026-11', flexibleBudget: 4900 },
  smartBudgetHistory: [],
  creditDrafts: [],
  forecastBills: [],
  rssSubscriptions: [],
  categoryLearningRules: [{ id: 'rule-1', keyword: '咖啡', categoryId: 'cat-food' }],
  categoryLearningEvents: []
};

function buildPayload(scope: Partial<FinanceBackupScope> = {}) {
  return createFinanceBackupPayload(
    {
      ...emptySnapshot,
      transactions: [transaction],
      debts: [debt],
      repaymentRecords: [repayment],
      preferences: samplePreferences
    },
    { ...fullScope, ...scope }
  );
}

describe('负债与还款记录的备份往返', () => {
  it('默认包含负债与还款记录', () => {
    const payload = buildPayload();

    expect(payload.data.debts ?? []).toHaveLength(1);
    expect((payload.data.debts ?? [])[0].name).toBe('招商银行信用卡');
    expect(payload.data.repaymentRecords ?? []).toHaveLength(1);
    expect((payload.data.repaymentRecords ?? [])[0].debtId).toBe('debt-1');
  });

  it('关掉 debts 范围时不写入这两块', () => {
    const payload = buildPayload({ debts: false });

    expect(payload.data.debts ?? []).toEqual([]);
    expect(payload.data.repaymentRecords ?? []).toEqual([]);
    // 其它范围不受影响
    expect(payload.data.transactions).toHaveLength(1);
  });

  it('导出→解析→应用 之后负债与还款记录仍在', () => {
    const payload = buildPayload();
    const parsed = parseFinanceBackupPayload(JSON.stringify(payload));
    const restored = applyFinanceBackupPayload(emptySnapshot, parsed);

    expect(restored.debts).toHaveLength(1);
    expect(restored.debts[0].balance).toBeCloseTo(12860.4, 2);
    expect(restored.repaymentRecords).toHaveLength(1);
    expect(restored.repaymentRecords[0].amount).toBeCloseTo(1286.04, 2);
  });

  it('旧备份(没有这两个字段)不会清空现有负债', () => {
    const legacyPayload = {
      version: 3,
      exportedAt: '2026-10-01T00:00:00.000Z',
      scope: { ledger: true, subscriptions: true, globalMemories: true, investments: true },
      data: {
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
      }
    };

    const current = {
      ...emptySnapshot,
      transactions: [transaction],
      debts: [debt],
      repaymentRecords: [repayment]
    };
    const parsed = parseFinanceBackupPayload(JSON.stringify(legacyPayload));
    const restored = applyFinanceBackupPayload(current, parsed);

    // 账本按范围被清空(旧文件里的空账本),但负债与还款记录**必须保留**
    expect(restored.transactions).toEqual([]);
    expect(restored.debts).toHaveLength(1);
    expect(restored.repaymentRecords).toHaveLength(1);
  });

  it('解析时丢掉没有 id 的脏条目', () => {
    const payload = buildPayload();
    const dirty = JSON.parse(JSON.stringify(payload));
    dirty.data.debts = [dirty.data.debts[0], { name: '缺 id' }, null, 'x'];
    dirty.data.repaymentRecords = [{ debtId: 'debt-1' }];

    const parsed = parseFinanceBackupPayload(JSON.stringify(dirty));

    expect(parsed.data.debts).toHaveLength(1);
    expect(parsed.data.repaymentRecords).toEqual([]);
  });
describe('偏好与计划的备份往返', () => {
  it('默认包含偏好与计划', () => {
    const payload = buildPayload();

    expect(payload.data.preferences).toBeTruthy();
    expect(payload.data.preferences?.monthlyIncome).toBe(10000);
    expect((payload.data.preferences?.smartBudgetPlan as { monthKey?: string })?.monthKey).toBe('2026-11');
    expect(Array.isArray(payload.data.preferences?.categoryLearningRules)).toBe(true);
  });

  it('关掉 preferences 范围时不写入', () => {
    const payload = buildPayload({ preferences: false });

    expect(payload.data.preferences).toBeUndefined();
    expect(payload.data.debts).toHaveLength(1);
  });

  it('导出→解析→应用 之后偏好与计划仍在', () => {
    const payload = buildPayload();
    const parsed = parseFinanceBackupPayload(JSON.stringify(payload));
    const restored = applyFinanceBackupPayload(emptySnapshot, parsed);

    expect(restored.preferences?.monthlyIncome).toBe(10000);
    expect(restored.preferences?.categoryLearningRules).toHaveLength(1);
  });

  it('旧备份(没有这个字段)不会清空现有偏好', () => {
    const legacy = JSON.parse(JSON.stringify(buildPayload()));
    delete legacy.data.preferences;
    delete legacy.scope.preferences;

    const current = {
      ...emptySnapshot,
      debts: [debt],
      repaymentRecords: [repayment],
      preferences: samplePreferences
    };
    const parsed = parseFinanceBackupPayload(JSON.stringify(legacy));
    const restored = applyFinanceBackupPayload(current, parsed);

    expect(restored.preferences?.monthlyIncome).toBe(10000);
  });

  it('偏好不是对象时视为无效,保留当前值', () => {
    const dirty = JSON.parse(JSON.stringify(buildPayload()));
    dirty.data.preferences = 'not-an-object';

    const current = { ...emptySnapshot, preferences: samplePreferences };
    const parsed = parseFinanceBackupPayload(JSON.stringify(dirty));
    const restored = applyFinanceBackupPayload(current, parsed);

    expect(restored.preferences?.monthlyIncome).toBe(10000);
  });
});
describe('账户类型的兼容性', () => {
  it('ewallet(电子钱包)能原样导出并导回', () => {
    const payload = createFinanceBackupPayload(
      {
        ...emptySnapshot,
        accounts: [{ id: 'acc-alipay', name: '支付宝', type: 'ewallet', initialBalance: 100, sortOrder: 1 } as never]
      },
      fullScope
    );

    // 曾经这里会抛「data.accounts[0].type 枚举值不合法」——
    // 也就是 App 自己导出的备份导不回来。
    const parsed = parseFinanceBackupPayload(JSON.stringify(payload));
    expect(parsed.data.accounts[0].type).toBe('ewallet');
  });

  it('完全不认识的类型不再让整份备份无法恢复', () => {
    const payload = createFinanceBackupPayload(emptySnapshot, fullScope);
    (payload.data.accounts as unknown[]) = [
      { id: 'acc-x', name: '未知账户', type: 'quantum-wallet', initialBalance: 0, sortOrder: 1 }
    ];

    const parsed = parseFinanceBackupPayload(JSON.stringify(payload));

    // 账户照常导入,只是类型落成 undefined(type 本身是可选的)
    expect(parsed.data.accounts).toHaveLength(1);
    expect(parsed.data.accounts[0].name).toBe('未知账户');
    expect(parsed.data.accounts[0].type).toBeUndefined();
  });
});
});