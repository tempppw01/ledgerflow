import { describe, expect, it } from 'vitest';
import type { Account } from '../../entities/account/types';
import type { Category } from '../../entities/category/types';
import type { TransactionItem } from '../../entities/transaction/types';
import { analyzeFinancialOverview } from '../../features/financial-analysis/model/analysis';
import { filterCountableTransactions, summarizeTransactions } from '../../shared/lib/transactionMetrics';
import { buildTransactionRowComparator } from '../../features/transactions/model/rowSort';
import { useFinanceStore } from '../../shared/store/useFinanceStore';

/**
 * 数据量放大后的耗时检查(1 万条流水)。
 *
 * 目的不是"跑得多快",而是**发现意外的 O(n²) 或每次操作都全量重算**:
 * - `computeAccountBalances` 在每次写操作时都会对全部流水重算余额
 * - 财务分析会对整个区间做分组、排序、判异常
 *
 * 断言用的是**宽松上界**(不是性能基准),只用来拦住数量级级别的退化;
 * 实际耗时打印在控制台,便于对比历史。
 */
const ROW_COUNT = 10_000;

function makeTransactions(count: number, accountIds: string[], categoryIds: string[]): TransactionItem[] {
  const rows: TransactionItem[] = [];
  const base = new Date(2026, 0, 1).getTime();
  for (let i = 0; i < count; i += 1) {
    const isIncome = i % 7 === 0;
    rows.push({
      id: `tx-${i}`,
      type: isIncome ? 'income' : 'expense',
      categoryId: categoryIds[i % categoryIds.length],
      accountId: accountIds[i % accountIds.length],
      amount: Math.round((5 + (i % 500)) * 100) / 100,
      date: new Date(base + (i % 365) * 86400000).toISOString(),
      note: `记录 ${i} 餐饮外卖`,
      tags: i % 3 === 0 ? ['日常'] : [],
      source: 'manual',
      status: 'completed'
    });
  }
  return rows;
}

const accounts: Account[] = Array.from({ length: 5 }, (_, i) => ({
  id: `acc-${i}`,
  name: `账户 ${i}`,
  type: 'cash',
  initialBalance: 1000,
  balance: 1000,
  sortOrder: i
}));

const categories: Category[] = Array.from({ length: 20 }, (_, i) => ({
  id: `cat-${i}`,
  name: `分类 ${i}`,
  kind: i % 4 === 0 ? 'income' : 'expense',
  sortOrder: i
}));

function timed(label: string, run: () => void): number {
  const start = performance.now();
  run();
  const elapsed = performance.now() - start;
  console.log(`[perf] ${label}: ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

// 注意:这里**不能**用 vi.useFakeTimers() —— 它会把 performance.now() 一起 mock,
// 于是所有耗时都测成 0.0ms(这个坑我踩过一次)。
describe('1 万条流水下的耗时', () => {
  it('汇总与过滤:1 万条应在数十毫秒量级', () => {
    const rows = makeTransactions(ROW_COUNT, accounts.map((a) => a.id), categories.map((c) => c.id));

    const summaryMs = timed('summarizeTransactions × 1 万', () => {
      summarizeTransactions(rows);
    });
    const filterMs = timed('filterCountableTransactions × 1 万', () => {
      filterCountableTransactions(rows);
    });

    expect(summaryMs).toBeLessThan(300);
    expect(filterMs).toBeLessThan(200);
  });

  it('财务分析:1 万条区间分析应在一秒量级内', () => {
    const rows = makeTransactions(ROW_COUNT, accounts.map((a) => a.id), categories.map((c) => c.id));

    const analysisMs = timed('analyzeFinancialOverview × 1 万', () => {
      analyzeFinancialOverview({
        range: { key: '90d', label: '近 90 天', days: 90 },
        transactions: rows,
        categories,
        accounts,
        subscriptions: [],
        debts: [],
        repaymentRecords: [],
        monthlyIncome: 20000
      });
    });

    expect(analysisMs).toBeLessThan(3000);
  });

  it('单次写操作:已有 1 万条时,一次编辑不应卡住界面', () => {
    const rows = makeTransactions(ROW_COUNT, accounts.map((a) => a.id), categories.map((c) => c.id));
    useFinanceStore.setState({
      hasHydrated: true,
      transactions: rows,
      trashedTransactions: [],
      categories,
      trashedCategories: [],
      accounts,
      trashedAccounts: [],
      balanceChangeEntries: [],
      subscriptions: [],
      trashedSubscriptions: [],
      categoryLearningRules: [],
      categoryLearningEvents: []
    });

    const addMs = timed('addTransaction(已有 1 万条)', () => {
      useFinanceStore.getState().addTransaction({
        type: 'expense',
        categoryId: 'cat-1',
        accountId: 'acc-0',
        amount: 12.34,
        date: '2026-11-22T02:00:00.000Z',
        note: '性能测试用的一笔',
        tags: [],
        source: 'manual',
        status: 'completed'
      });
    });

    const updateMs = timed('updateTransaction(已有 1 万条)', () => {
      useFinanceStore.getState().updateTransaction('tx-1', {
        ...useFinanceStore.getState().transactions.find((item) => item.id === 'tx-1')!,
        amount: 99.99
      });
    });

    // 写操作是同步的:超过 100ms 用户就会感觉到卡顿
    expect(addMs).toBeLessThan(1000);
    expect(updateMs).toBeLessThan(1000);
    expect(useFinanceStore.getState().transactions.length).toBe(ROW_COUNT + 1);
  });
});
/**
 * 导入场景:一次导入 N 行。
 *
 * 改之前导入是**逐条** addTransaction,而每次写操作都会对全部流水重算账户余额 ——
 * 1 万条存量下每条约 80ms,500 行就要 40 秒。批量形态只走一次 set()。
 */
describe('批量导入的耗时(1 万条存量)', () => {
  const seedStore = (rows: TransactionItem[]) => {
    useFinanceStore.setState({
      hasHydrated: true,
      transactions: rows,
      trashedTransactions: [],
      categories,
      trashedCategories: [],
      accounts,
      trashedAccounts: [],
      balanceChangeEntries: [],
      subscriptions: [],
      trashedSubscriptions: [],
      categoryLearningRules: [],
      categoryLearningEvents: []
    });
  };

  const payload = (i: number) => ({
    type: 'expense' as const,
    categoryId: 'cat-1',
    accountId: 'acc-0',
    amount: 10 + i,
    date: '2026-11-22T02:00:00.000Z',
    note: `导入行 ${i}`,
    tags: [],
    source: 'manual' as const,
    status: 'completed' as const
  });

  it('批量写 500 行明显快于逐条,并且都写进去了', () => {
    const existing = makeTransactions(ROW_COUNT, accounts.map((a) => a.id), categories.map((c) => c.id));

    // 逐条(旧行为):只测 20 条就够看出量级,避免测试本身太慢
    seedStore(existing);
    const perRowSampleMs = timed('逐条 addTransaction × 20(旧行为)', () => {
      for (let i = 0; i < 20; i += 1) {
        useFinanceStore.getState().addTransaction(payload(i));
      }
    });
    const perRowMs = perRowSampleMs / 20;

    // 批量(新行为):500 行一次写
    seedStore(existing);
    const bulkMs = timed('批量 addTransaction × 500(新行为)', () => {
      useFinanceStore
        .getState()
        .addTransaction(Array.from({ length: 500 }, (_, i) => ({ operation: 'add' as const, payload: payload(i) })));
    });

    const rowCount = useFinanceStore.getState().transactions.length;
    console.log(
      `[perf] 推演:逐条导入 500 行约 ${(perRowMs * 500).toFixed(0)}ms;批量 ${bulkMs.toFixed(1)}ms`
    );

    expect(rowCount).toBe(ROW_COUNT + 500);
    // 批量必须比「逐条 × 500」快一个量级(逐条等价于 500 次全量重算)
    expect(bulkMs).toBeLessThan(Math.max(200, perRowMs * 500 / 5));
  });
});

/** 批量更新:重导入一份 500 行都命中的账单,同样不该逐条触发全量重算。 */
describe('批量更新(1 万条存量)', () => {
  it('批量更新 500 行与批量新增同一量级', () => {
    const existing = makeTransactions(ROW_COUNT, accounts.map((a) => a.id), categories.map((c) => c.id));
    useFinanceStore.setState({
      hasHydrated: true,
      transactions: existing,
      trashedTransactions: [],
      categories,
      trashedCategories: [],
      accounts,
      trashedAccounts: [],
      balanceChangeEntries: [],
      subscriptions: [],
      trashedSubscriptions: [],
      categoryLearningRules: [],
      categoryLearningEvents: []
    });

    const targets = existing.slice(0, 500);
    const updateMs = timed('批量 addTransaction(update) × 500', () => {
      useFinanceStore.getState().addTransaction(
        targets.map((row) => ({
          operation: 'update' as const,
          id: row.id,
          payload: { ...row, amount: Number(row.amount) + 1 }
        }))
      );
    });

    const updated = useFinanceStore
      .getState()
      .transactions.filter((row) => targets.some((target) => target.id === row.id));
    expect(updated.every((row) => Number(row.amount) > Number(targets.find((t) => t.id === row.id)!.amount))).toBe(
      true
    );
    expect(updateMs).toBeLessThan(1000);
  });
});

/**
 * 列表排序:比较函数里不要再解析日期 / 重复做中文比较。
 *
 * 这条不是"性能基准",而是**防回退**:如果有人把 `new Date(a.item.date)` 或
 * `localeCompare` 写回比较函数,这里会明显变慢并触发断言。
 */
describe('交易列表排序(1 万条)', () => {
  it('预计算排序键明显快于在比较函数里解析日期', () => {
    const items = makeTransactions(ROW_COUNT, accounts.map((a) => a.id), categories.map((c) => c.id));
    const rows = items.map((item) => ({
      item,
      categoryName: `分类 ${item.categoryId}`,
      accountName: `账户 ${item.accountId}`
    }));

    const naiveMs = timed('排序:比较函数里 new Date()(旧行为)', () => {
      [...rows].sort((a, b) => {
        const left = new Date(a.item.date).getTime();
        const right = new Date(b.item.date).getTime();
        return left === right ? a.item.id.localeCompare(b.item.id) : left - right;
      });
    });

    const fastMs = timed('排序:预计算排序键(新行为)', () => {
      const copy = [...rows];
      copy.sort(buildTransactionRowComparator(copy, 'date', 'asc'));
    });

    console.log(`[perf] 排序提速约 ${(naiveMs / Math.max(fastMs, 0.1)).toFixed(1)}×`);
    expect(fastMs).toBeLessThan(naiveMs);
  });
});
