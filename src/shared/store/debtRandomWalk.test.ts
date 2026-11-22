import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtItem } from '../../features/debt/model/debtMetrics';
import { useAppPreferences } from './useAppPreferences';

/**
 * 负债与还款记录的随机操作扫描(与交易那边的随机扫描同一思路,换一个 store)。
 *
 * 检查的不变量:
 * 1. **还款记录必须指向存在的负债** —— 负债删掉了,它下面的记录不能变成孤儿
 * 2. 金额/利率是有限数,且余额不为负
 * 3. 每个数组内 id 不重复
 * 4. 操作不抛「未预期的错误」
 */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function debtPayload(index: number): Omit<DebtItem, 'id'> {
  return {
    name: `负债 ${index}`,
    type: 'consumer-loan',
    balance: 1000 + index * 100,
    annualRate: 18.25,
    repaymentDay: 10,
    minimumPaymentRate: 0.1,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as Omit<DebtItem, 'id'>;
}

function preferences() {
  return useAppPreferences.getState();
}

function collectViolations(step: number, op: string, seed: number): string[] {
  const snapshot = preferences();
  const problems: string[] = [];
  const debtIds = new Set(snapshot.debts.map((item) => item.id));

  for (const record of snapshot.repaymentRecords) {
    if (!debtIds.has(record.debtId)) {
      problems.push(`还款记录 ${record.id} 指向不存在的负债 ${record.debtId}`);
    }
    if (!Number.isFinite(Number(record.amount))) {
      problems.push(`还款记录 ${record.id} 金额不是有限数:${record.amount}`);
    }
  }

  for (const debt of snapshot.debts) {
    if (!Number.isFinite(Number(debt.balance)) || Number(debt.balance) < 0) {
      problems.push(`负债 ${debt.id} 余额异常:${debt.balance}`);
    }
    if (debt.annualRate !== undefined && !Number.isFinite(Number(debt.annualRate))) {
      problems.push(`负债 ${debt.id} 利率不是有限数:${debt.annualRate}`);
    }
  }

  const debtIdList = snapshot.debts.map((item) => item.id);
  if (new Set(debtIdList).size !== debtIdList.length) {
    problems.push('负债列表里有重复 id');
  }
  const recordIdList = snapshot.repaymentRecords.map((item) => item.id);
  if (new Set(recordIdList).size !== recordIdList.length) {
    problems.push('还款记录里有重复 id');
  }

  return problems.slice(0, 4).map((text) => `[seed=${seed} step=${step} op=${op}] ${text}`);
}

describe('负债与还款的随机不变量', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 22, 10, 0, 0));
    localStorage.clear();
    useAppPreferences.setState({ debts: [], repaymentRecords: [], monthlyIncome: 10000 });
  });

  it('跑 200 步随机操作,每一步之后负债与还款记录都自洽', () => {
    const seed = 20261123;
    const random = makeRandom(seed);
    const pick = <T,>(items: T[]): T | undefined =>
      items.length ? items[Math.floor(random() * items.length)] : undefined;
    const violations: string[] = [];
    const performed: Record<string, number> = {};
    const record = (name: string) => {
      performed[name] = (performed[name] ?? 0) + 1;
    };

    for (let step = 0; step < 200; step += 1) {
      const op = ['add-debt', 'remove-debt', 'update-debt', 'add-repayment', 'remove-repayment'][
        Math.floor(random() * 5)
      ];

      try {
        switch (op) {
          case 'add-debt': {
            record(op);
            preferences().addDebt(debtPayload(step));
            break;
          }
          case 'remove-debt': {
            const target = pick(preferences().debts);
            if (target) {
              record(op);
              preferences().removeDebt(target.id);
            }
            break;
          }
          case 'update-debt': {
            const target = pick(preferences().debts);
            if (target) {
              record(op);
              preferences().updateDebt(target.id, {
                ...target,
                balance: Math.max(0, Math.round(random() * 5000) / 100)
              } as Omit<DebtItem, 'id'>);
            }
            break;
          }
          case 'add-repayment': {
            const target = pick(preferences().debts);
            if (target) {
              record(op);
              preferences().addRepaymentRecord({
                debtId: target.id,
                amount: Math.max(0.01, Math.round(random() * 500) / 100),
                paidAt: new Date(2026, 10, 1 + Math.floor(random() * 28)).toISOString(),
                type: 'repayment',
                accountId: 'acc-a'
              } as never);
            }
            break;
          }
          case 'remove-repayment': {
            const target = pick(preferences().repaymentRecords);
            if (target) {
              record(op);
              preferences().removeRepaymentRecord(target.id);
            }
            break;
          }
        }
      } catch (error) {
        violations.push(
          `[seed=${seed} step=${step} op=${op}] 操作抛出了未预期的错误:${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      violations.push(...collectViolations(step, op, seed));
      if (violations.length >= 6) break;
    }

    // 扫描必须真的做了事
    expect(performed['add-debt'] ?? 0, JSON.stringify(performed)).toBeGreaterThan(10);
    expect(performed['remove-debt'] ?? 0).toBeGreaterThan(3);
    expect(performed['add-repayment'] ?? 0).toBeGreaterThan(3);
    expect(performed['remove-debt'] ?? 0).toBeGreaterThan(0);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('删掉负债会连带删掉它的还款记录(不留孤儿)', () => {
    const debtId = preferences().addDebt(debtPayload(1));
    const recordId = preferences().addRepaymentRecord({
      debtId,
      amount: 100,
      paidAt: '2026-11-10T00:00:00.000Z',
      type: 'repayment',
      accountId: 'acc-a'
    } as never);
    expect(preferences().repaymentRecords.some((item) => item.id === recordId)).toBe(true);

    preferences().removeDebt(debtId);
    expect(preferences().repaymentRecords.some((item) => item.debtId === debtId)).toBe(false);
  });
});
/** 反向验证:检查器要能发现「孤儿还款记录」与「负数余额」,否则上面的通过没有意义。 */
describe('负债检查器本身', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppPreferences.setState({ debts: [], repaymentRecords: [], monthlyIncome: 10000 });
  });

  it('能发现指向不存在负债的还款记录', () => {
    useAppPreferences.setState({
      debts: [],
      repaymentRecords: [
        {
          id: 'rec-orphan',
          debtId: 'debt-gone',
          amount: 100,
          paidAt: '2026-11-10T00:00:00.000Z',
          type: 'repayment',
          accountId: 'acc-a'
        } as never
      ]
    });
    expect(collectViolations(0, 'tamper-orphan', 1).join('\n')).toContain('指向不存在的负债');
  });

  it('能发现负数余额', () => {
    useAppPreferences.setState({
      debts: [
        {
          id: 'debt-1',
          name: '异常负债',
          type: 'consumer-loan',
          balance: -1,
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        } as never
      ],
      repaymentRecords: []
    });
    expect(collectViolations(0, 'tamper-negative', 1).join('\n')).toContain('余额异常');
  });
});
