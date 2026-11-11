import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import type { ChatToolCall } from '../api/openaiCompatibleClient';
import {
  ASSISTANT_AGENT_INSTRUCTIONS,
  ASSISTANT_AGENT_TOOLS,
  executeAssistantToolCall,
  type AgentToolContext
} from './assistantAgentTools';

function createCall(name: string, args: Record<string, unknown>): ChatToolCall {
  return { id: `call-${name}`, name, arguments: JSON.stringify(args) };
}

function createContext() {
  const categories: Category[] = [
    { id: 'cat-food', name: '餐饮' },
    { id: 'cat-salary', name: '工资' }
  ];
  const accounts: Account[] = [
    { id: 'acc-wechat', name: '微信钱包', type: 'virtual', balance: 200 },
    { id: 'acc-card', name: '招商银行卡', type: 'debit', balance: 5000 }
  ];
  const trashedAccounts: Account[] = [
    { id: 'acc-old', name: '旧钱包', type: 'virtual', trashedAt: '2026-11-01T00:00:00.000Z' }
  ];
  const transactions: TransactionItem[] = [
    {
      id: 'tx-lunch',
      type: 'expense',
      categoryId: 'cat-food',
      accountId: 'acc-wechat',
      amount: 28,
      date: '2026-11-09',
      note: '午餐',
      tags: []
    }
  ];
  const trashed: TransactionItem[] = [];

  const ctx: AgentToolContext = {
    // 工作副本:与 store 数组分离,由工具执行时同步更新。
    categories: [...categories],
    accounts: [...accounts],
    trashedAccounts: [...trashedAccounts],
    transactions: [...transactions],
    addCategory: vi.fn((name: string) => {
      const id = `cat-${categories.length + 1}`;
      categories.push({ id, name });
      return id;
    }),
    addAccount: vi.fn((name: string, type?: Account['type']) => {
      const id = `acc-${accounts.length + 1}`;
      accounts.push({ id, name, type });
      return id;
    }),
    updateAccount: vi.fn((id, payload) => {
      const index = accounts.findIndex((item) => item.id === id);
      if (index >= 0) accounts[index] = { ...accounts[index], ...payload };
    }),
    updateAccountBalance: vi.fn((id, balance) => {
      const index = accounts.findIndex((item) => item.id === id);
      if (index >= 0) accounts[index] = { ...accounts[index], balance };
    }),
    removeAccount: vi.fn((id) => {
      const index = accounts.findIndex((item) => item.id === id);
      if (index >= 0) {
        trashedAccounts.push({ ...accounts[index], trashedAt: new Date().toISOString() });
        accounts.splice(index, 1);
      }
    }),
    restoreAccount: vi.fn((id) => {
      const index = trashedAccounts.findIndex((item) => item.id === id);
      if (index >= 0) {
        accounts.push({ ...trashedAccounts[index], trashedAt: undefined });
        trashedAccounts.splice(index, 1);
      }
    }),
    addTransaction: vi.fn((payload) => {
      const id = `tx-${transactions.length + 1}`;
      transactions.push({ id, ...(payload as Omit<TransactionItem, 'id'>) });
      return id;
    }) as unknown as AgentToolContext['addTransaction'],
    updateTransaction: vi.fn((id, payload) => {
      const index = transactions.findIndex((item) => item.id === id);
      if (index >= 0) transactions[index] = { id, ...payload };
    }),
    removeTransaction: vi.fn((id) => {
      const index = transactions.findIndex((item) => item.id === id);
      if (index >= 0) trashed.push(...transactions.splice(index, 1));
    }),
    restoreTransaction: vi.fn((id) => {
      const index = trashed.findIndex((item) => item.id === id);
      if (index >= 0) transactions.push(...trashed.splice(index, 1));
    })
  };

  return { ctx, categories, accounts, trashedAccounts, transactions, trashed };
}

describe('assistantAgentTools', () => {
  it('暴露查账与增删改账本的工具', () => {
    const names = ASSISTANT_AGENT_TOOLS.map((tool) => tool.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_accounts',
        'create_account',
        'update_account',
        'adjust_account_balance',
        'delete_account',
        'restore_account',
        'list_categories',
        'query_transactions',
        'summarize_transactions',
        'create_transactions',
        'update_transaction',
        'delete_transaction'
      ])
    );
    expect(new Set(names).size).toBe(names.length);
    ASSISTANT_AGENT_TOOLS.forEach((tool) => {
      expect(tool.function.parameters).toMatchObject({ type: 'object' });
    });
  });

  it('账户场景提示词覆盖查询、开户、修改、校准、删除确认和恢复', () => {
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('list_accounts');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('create_account');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('update_account');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('adjust_account_balance');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('delete_account');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('restore_account');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('修改或删除账单前');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('linkedTransactionCount');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('confirmLinkedTransactions=true');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('校准实际余额');
    expect(ASSISTANT_AGENT_INSTRUCTIONS).toContain('负债模式');
  });

  it('list_accounts 返回账户余额、关联流水和汇总,并可查看回收站', () => {
    const { ctx } = createContext();
    const result = executeAssistantToolCall(
      createCall('list_accounts', { includeTrashed: true }),
      ctx
    );
    const payload = JSON.parse(result.content) as {
      summary: { accountCount: number; trashedCount: number; netTotal: number };
      accounts: Array<{ name: string; transactionCount: number }>;
      trashedAccounts: Array<{ name: string }>;
    };

    expect(payload.summary).toMatchObject({ accountCount: 2, trashedCount: 1, netTotal: 5200 });
    expect(payload.accounts.find((item) => item.name === '微信钱包')?.transactionCount).toBe(1);
    expect(payload.trashedAccounts[0].name).toBe('旧钱包');
  });

  it('create_account 新建资金账户并可撤销', () => {
    const { ctx, accounts } = createContext();
    const result = executeAssistantToolCall(
      createCall('create_account', {
        name: '日常储蓄卡',
        type: 'savings',
        initialBalance: 3200
      }),
      ctx
    );
    const payload = JSON.parse(result.content) as { ok: boolean; createdId: string };

    expect(payload.ok).toBe(true);
    expect(ctx.accounts.find((item) => item.name === '日常储蓄卡')).toMatchObject({
      type: 'savings',
      balance: 3200
    });
    expect(result.views[0]).toMatchObject({ kind: 'create', undoable: true });

    result.undo[0].run();
    expect(ctx.accounts.some((item) => item.name === '日常储蓄卡')).toBe(false);
    expect(accounts.some((item) => item.name === '日常储蓄卡')).toBe(false);
  });

  it('update_account 支持按名称改名和改类型,并可撤销', () => {
    const { ctx } = createContext();
    const result = executeAssistantToolCall(
      createCall('update_account', {
        name: '微信钱包',
        newName: '微信零钱',
        type: 'virtual'
      }),
      ctx
    );

    expect(JSON.parse(result.content)).toMatchObject({ ok: true, updatedId: 'acc-wechat' });
    expect(ctx.accounts[0]).toMatchObject({ name: '微信零钱', type: 'virtual' });
    result.undo[0].run();
    expect(ctx.accounts[0]).toMatchObject({ name: '微信钱包', type: 'virtual' });
  });

  it('adjust_account_balance 校准账户余额并可撤销', () => {
    const { ctx } = createContext();
    const result = executeAssistantToolCall(
      createCall('adjust_account_balance', { name: '招商银行卡', balance: 880.5 }),
      ctx
    );
    const payload = JSON.parse(result.content) as { ok: boolean; balance: number };

    expect(payload).toMatchObject({ ok: true, balance: 880.5 });
    expect(ctx.accounts.find((item) => item.id === 'acc-card')?.balance).toBe(880.5);
    result.undo[0].run();
    expect(ctx.accounts.find((item) => item.id === 'acc-card')?.balance).toBe(5000);
  });

  it('delete_account 对有关联流水的账户先要求确认', () => {
    const { ctx } = createContext();
    const result = executeAssistantToolCall(
      createCall('delete_account', { name: '微信钱包' }),
      ctx
    );
    const payload = JSON.parse(result.content) as {
      ok: boolean;
      requiresConfirmation: boolean;
      linkedTransactionCount: number;
    };

    expect(payload).toMatchObject({
      ok: false,
      requiresConfirmation: true,
      linkedTransactionCount: 1
    });
    expect(ctx.accounts.some((item) => item.id === 'acc-wechat')).toBe(true);
    expect(result.views).toHaveLength(0);
  });

  it('用户确认后 delete_account 可删除有关联流水的账户并撤销', () => {
    const { ctx } = createContext();
    const result = executeAssistantToolCall(
      createCall('delete_account', {
        name: '微信钱包',
        confirmLinkedTransactions: true
      }),
      ctx
    );

    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      linkedTransactionCount: 1,
      movedToTrash: true
    });
    expect(ctx.accounts.some((item) => item.id === 'acc-wechat')).toBe(false);
    result.undo[0].run();
    expect(ctx.accounts.some((item) => item.id === 'acc-wechat')).toBe(true);
  });

  it('delete_account 删除空账户后可撤销,restore_account 可恢复回收站账户', () => {
    const { ctx } = createContext();
    const deleted = executeAssistantToolCall(
      createCall('delete_account', { name: '招商银行卡' }),
      ctx
    );
    expect(JSON.parse(deleted.content)).toMatchObject({ ok: true, linkedTransactionCount: 0 });
    expect(ctx.accounts.some((item) => item.id === 'acc-card')).toBe(false);
    deleted.undo[0].run();
    expect(ctx.accounts.some((item) => item.id === 'acc-card')).toBe(true);

    const restored = executeAssistantToolCall(
      createCall('restore_account', { id: 'acc-old' }),
      ctx
    );
    expect(JSON.parse(restored.content)).toMatchObject({ ok: true, restoredId: 'acc-old' });
    expect(ctx.accounts.some((item) => item.id === 'acc-old')).toBe(true);
    expect(ctx.trashedAccounts.some((item) => item.id === 'acc-old')).toBe(false);
  });

  it('create_transactions 按备注推断分类与账户,并可撤销', () => {
    const { ctx, transactions } = createContext();
    const result = executeAssistantToolCall(
      createCall('create_transactions', {
        transactions: [{ type: 'expense', amount: 15, date: '2026-11-10', note: '午餐 支付宝' }]
      }),
      ctx
    );

    expect(transactions).toHaveLength(2);
    const created = transactions[1];
    expect(created.amount).toBe(15);
    expect(created.date).toBe('2026-11-10');
    expect(created.type).toBe('expense');
    expect(result.views).toHaveLength(1);
    expect(result.views[0].kind).toBe('create');
    expect(result.undo).toHaveLength(1);

    result.undo[0].run();
    expect(transactions.map((item) => item.id)).toEqual(['tx-lunch']);
  });

  it('create_transactions 拒绝无效金额但不影响其他条目', () => {
    const { ctx, transactions } = createContext();
    const result = executeAssistantToolCall(
      createCall('create_transactions', {
        transactions: [
          { type: 'expense', amount: 0, note: '无效' },
          { type: 'income', amount: 12000, note: '工资', category: '工资' }
        ]
      }),
      ctx
    );

    expect(JSON.parse(result.content)).toMatchObject({ createdCount: 1 });
    expect(transactions).toHaveLength(2);
    expect(transactions[1].type).toBe('income');
    expect(result.views).toHaveLength(1);
  });

  it('query_transactions 支持关键词与类型过滤', () => {
    const { ctx } = createContext();
    const lunch = executeAssistantToolCall(
      createCall('query_transactions', { keyword: '午餐' }),
      ctx
    );
    expect(JSON.parse(lunch.content).transactions).toHaveLength(1);

    const income = executeAssistantToolCall(
      createCall('query_transactions', { type: 'income' }),
      ctx
    );
    expect(JSON.parse(income.content).transactions).toHaveLength(0);
  });

  it('update_transaction 修改后可撤销回原值', () => {
    const { ctx, transactions } = createContext();
    const result = executeAssistantToolCall(
      createCall('update_transaction', { id: 'tx-lunch', amount: 42, note: '午餐(改)' }),
      ctx
    );

    expect(transactions[0]).toMatchObject({ amount: 42, note: '午餐(改)' });
    expect(result.views[0].kind).toBe('update');

    result.undo[0].run();
    expect(transactions[0]).toMatchObject({ amount: 28, note: '午餐' });
  });

  it('delete_transaction 移入回收站并可恢复', () => {
    const { ctx, transactions, trashed } = createContext();
    const result = executeAssistantToolCall(
      createCall('delete_transaction', { id: 'tx-lunch' }),
      ctx
    );

    expect(transactions).toHaveLength(0);
    expect(trashed).toHaveLength(1);
    expect(result.views[0].kind).toBe('delete');

    result.undo[0].run();
    expect(transactions.map((item) => item.id)).toEqual(['tx-lunch']);
  });

  it('未知工具与不存在的账单会返回失败结果而不是抛错', () => {
    const { ctx } = createContext();
    const unknown = executeAssistantToolCall(createCall('drop_database', {}), ctx);
    expect(JSON.parse(unknown.content)).toMatchObject({ ok: false });

    const missing = executeAssistantToolCall(
      createCall('delete_transaction', { id: 'tx-missing' }),
      ctx
    );
    expect(JSON.parse(missing.content)).toMatchObject({ ok: false });
  });

  it('summarize_transactions 汇总区间收支', () => {
    const { ctx } = createContext();
    const result = executeAssistantToolCall(
      createCall('summarize_transactions', {
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        groupBy: 'category'
      }),
      ctx
    );
    expect(JSON.parse(result.content)).toMatchObject({
      expenseTotal: 28,
      incomeTotal: 0,
      count: 1
    });
  });

  it('同一轮对话内新增的账单能被后续查询与汇总看到', () => {
    const { ctx } = createContext();
    executeAssistantToolCall(
      createCall('create_transactions', {
        transactions: [{ type: 'expense', amount: 56, date: '2026-11-10', note: '买菜' }]
      }),
      ctx
    );

    const queried = executeAssistantToolCall(
      createCall('query_transactions', { keyword: '买菜' }),
      ctx
    );
    expect(JSON.parse(queried.content).transactions).toHaveLength(1);

    const summary = executeAssistantToolCall(
      createCall('summarize_transactions', {
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        groupBy: 'category'
      }),
      ctx
    );
    expect(JSON.parse(summary.content)).toMatchObject({ expenseTotal: 56, count: 1 });
  });
});
