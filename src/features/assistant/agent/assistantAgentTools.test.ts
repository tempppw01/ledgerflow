import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem } from '../../../entities/transaction/types';
import type { ChatToolCall } from '../api/openaiCompatibleClient';
import {
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
    { id: 'acc-wechat', name: '微信钱包', type: 'virtual' },
    { id: 'acc-card', name: '招商银行卡', type: 'debit' }
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
    categories,
    accounts,
    transactions,
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

  return { ctx, categories, accounts, transactions, trashed };
}

describe('assistantAgentTools', () => {
  it('暴露查账与增删改账本的工具', () => {
    const names = ASSISTANT_AGENT_TOOLS.map((tool) => tool.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_accounts',
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
});
