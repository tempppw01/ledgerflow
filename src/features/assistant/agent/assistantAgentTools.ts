import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem, TransactionType } from '../../../entities/transaction/types';
import type { AddTransactionAction } from '../../../shared/store/useFinanceStore';
import type { ChatToolCall, ChatToolDefinition } from '../api/openaiCompatibleClient';
import {
  type AccountResolveSource,
  ensureAccountId,
  ensureCategoryId,
  inferCategoryFromText,
  inferSourceFromText,
  normalizeMoney,
  resolveDraftAccountTarget
} from '../workbench/workbenchMapping';

export interface AgentToolContext {
  categories: Category[];
  accounts: Account[];
  transactions: TransactionItem[];
  addCategory: (name: string) => string;
  addAccount: (name: string, type?: Account['type'], initialBalance?: number) => string;
  addTransaction: AddTransactionAction;
  updateTransaction: (id: string, payload: Omit<TransactionItem, 'id'>) => void;
  removeTransaction: (id: string) => void;
  restoreTransaction: (id: string) => void;
}

export type AgentActionKind = 'create' | 'update' | 'delete';

/** 可持久化到会话记录里的操作摘要。 */
export interface AgentActionView {
  id: string;
  kind: AgentActionKind;
  label: string;
  undoable: boolean;
}

export interface AgentUndoEntry {
  id: string;
  run: () => void;
}

export interface AgentToolExecution {
  /** 回传给模型的工具结果(JSON 文本)。 */
  content: string;
  views: AgentActionView[];
  undo: AgentUndoEntry[];
}

const MAX_QUERY_LIMIT = 50;

const TRANSACTION_TYPES: TransactionType[] = ['expense', 'income', 'budget', 'repayment'];

export const ASSISTANT_AGENT_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_accounts',
      description: '列出账本中的账户名称与 id,新增或修改账单前可用它确认账户。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_categories',
      description: '列出账本中的分类名称与 id,新增或修改账单前可用它确认分类。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_transactions',
      description: '按条件检索账单明细,返回用于定位待修改/待删除账单的 id。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '备注、标签、分类或账户关键词' },
          type: { type: 'string', enum: TRANSACTION_TYPES },
          category: { type: 'string', description: '分类名称' },
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          limit: { type: 'number', description: `返回条数,默认 10,最多 ${MAX_QUERY_LIMIT}` }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize_transactions',
      description: '按分类、账户或类型汇总区间内的账单金额,回答“花了多少”这类问题。',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          groupBy: { type: 'string', enum: ['category', 'account', 'type'] }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_transactions',
      description: '新增一笔或多笔账单。金额始终为正数,收入/支出由 type 决定;日期缺省为今天。',
      parameters: {
        type: 'object',
        properties: {
          transactions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['expense', 'income'], description: '支出或收入' },
                amount: { type: 'number', description: '正数金额' },
                date: { type: 'string', description: 'YYYY-MM-DD,缺省为今天' },
                category: { type: 'string', description: '分类名称,缺省时按备注推断' },
                account: { type: 'string', description: '账户名称,缺省时按来源推断' },
                note: { type: 'string', description: '备注' },
                tags: { type: 'array', items: { type: 'string' } }
              },
              required: ['type', 'amount'],
              additionalProperties: false
            }
          }
        },
        required: ['transactions'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_transaction',
      description: '按 id 修改一笔已有账单,只需传要改的字段。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '账单 id,可通过 query_transactions 获取' },
          type: { type: 'string', enum: TRANSACTION_TYPES },
          amount: { type: 'number' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          category: { type: 'string' },
          account: { type: 'string' },
          note: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_transaction',
      description: '按 id 删除一笔账单(进入回收站,可撤销)。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '账单 id,可通过 query_transactions 获取' }
        },
        required: ['id'],
        additionalProperties: false
      }
    }
  }
];

export const ASSISTANT_AGENT_INSTRUCTIONS = [
  '你是可以直接操作账本的记账助手,支持查账、记账、改账和删账。',
  '规则:',
  '1. 需要账本事实(金额、账户、分类、历史账单)时先调用工具,不要凭记忆编造数据。',
  '2. 用户说了明确的账目内容就调用 create_transactions 落账;信息不足时先问一句再动手。',
  '3. 修改或删除前必须先 query_transactions 找到目标账单 id,拿到明确 id 后再调用工具;',
  '   如果匹配到多笔且无法确定,先列出候选让用户选择,不要批量删除。',
  '4. 金额一律为正数,收入/支出由 type 区分;日期缺省用今天。',
  '5. 工具执行完成后,用一两句中文说明做了什么(金额、分类、时间),不要输出 JSON。',
  '6. 涉及投资、信贷的深度分析仍交给对应模式,这里只做账本操作与解释。'
].join('\n');

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(toText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toText(item)).filter(Boolean);
}

function toDateKey(value: unknown): string {
  const text = toText(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function toTransactionType(value: unknown, fallback: TransactionType = 'expense'): TransactionType {
  const text = toText(value) as TransactionType;
  return TRANSACTION_TYPES.includes(text) ? text : fallback;
}

function findCategoryName(categories: Category[], categoryId: string): string {
  return categories.find((item) => item.id === categoryId)?.name || '未分类';
}

function findAccountName(accounts: Account[], accountId: string): string {
  return accounts.find((item) => item.id === accountId)?.name || '默认账户';
}

function toViewId(prefix: string, index: number): string {
  return `${prefix}-${Date.now().toString(36)}-${index}`;
}

/** 去掉 id,得到可直接回写 store 的字段集合。 */
function toWritablePayload(row: TransactionItem): Omit<TransactionItem, 'id'> {
  const clone: Partial<TransactionItem> = { ...row };
  delete clone.id;
  return clone as Omit<TransactionItem, 'id'>;
}

function resolveCategoryIdByName(
  name: string,
  type: TransactionType,
  note: string,
  ctx: AgentToolContext,
  cache: Category[]
): string {
  const categoryName = name.trim() || inferCategoryFromText(type, note);
  return ensureCategoryId(categoryName, cache, (nextName) => {
    const createdId = ctx.addCategory(nextName);
    if (createdId && !cache.some((item) => item.id === createdId)) {
      cache.push({ id: createdId, name: nextName.trim() } as Category);
    }
    return createdId;
  });
}

function resolveAccountIdByName(
  name: string | undefined,
  source: AccountResolveSource,
  type: TransactionType,
  ctx: AgentToolContext,
  cache: Account[]
): string {
  return ensureAccountId(
    name,
    cache,
    (nextName, nextType) => {
      const createdId = ctx.addAccount(nextName, nextType, 0);
      if (createdId && !cache.some((item) => item.id === createdId)) {
        cache.push({ id: createdId, name: nextName.trim(), type: nextType } as Account);
      }
      return createdId;
    },
    { source, type }
  );
}

function matchesKeyword(row: TransactionItem, keyword: string, ctx: AgentToolContext): boolean {
  if (!keyword) return true;
  const needle = keyword.toLowerCase();
  const categoryName = findCategoryName(ctx.categories, row.categoryId);
  const accountName = findAccountName(ctx.accounts, row.accountId);
  return [row.note, categoryName, accountName, ...row.tags]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function serializeTransaction(row: TransactionItem, ctx: AgentToolContext) {
  return {
    id: row.id,
    date: row.date.slice(0, 10),
    type: row.type,
    amount: row.amount,
    category: findCategoryName(ctx.categories, row.categoryId),
    account: findAccountName(ctx.accounts, row.accountId),
    note: row.note,
    tags: row.tags
  };
}

function executeCreate(args: Record<string, unknown>, ctx: AgentToolContext): AgentToolExecution {
  const rawItems = Array.isArray(args.transactions) ? args.transactions : [];
  const categoryCache = [...ctx.categories];
  const accountCache = [...ctx.accounts];
  const created: string[] = [];
  const views: AgentActionView[] = [];
  const undo: AgentUndoEntry[] = [];
  const failures: string[] = [];

  rawItems.forEach((rawItem, index) => {
    const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
    const type = toTransactionType(item.type, 'expense');
    if (type !== 'expense' && type !== 'income') {
      failures.push('新增账单仅支持收入或支出');
      return;
    }
    const amount = toNumber(item.amount);
    if (amount === null || Math.abs(amount) <= 0) {
      failures.push(`第 ${index + 1} 笔金额无效`);
      return;
    }
    const note = toText(item.note);
    const tags = toTags(item.tags);
    const date = toDateKey(item.date);
    const categoryName = toText(item.category);
    const accountName = toText(item.account);
    const source = inferSourceFromText(`${note} ${tags.join(' ')}`) || 'ai';
    const accountTarget = resolveDraftAccountTarget({
      account: accountName,
      type,
      note,
      tags
    });
    const categoryId = resolveCategoryIdByName(categoryName, type, note, ctx, categoryCache);
    const accountId = resolveAccountIdByName(
      accountName || accountTarget.name,
      accountTarget.source,
      type,
      ctx,
      accountCache
    );

    const payload = {
      type,
      categoryId,
      accountId,
      amount: normalizeMoney(Math.abs(amount)),
      date,
      note,
      tags,
      source,
      status: 'completed' as const
    };
    const id = ctx.addTransaction(payload);
    created.push(id);
    const viewId = toViewId('agent-create', index);
    views.push({
      id: viewId,
      kind: 'create',
      label: `已记账:${note || findCategoryName(categoryCache, categoryId)} ${
        type === 'income' ? '+' : '-'
      }¥${payload.amount.toFixed(2)}`,
      undoable: true
    });
    undo.push({ id: viewId, run: () => ctx.removeTransaction(id) });
  });

  return {
    content: JSON.stringify({
      ok: failures.length === 0,
      createdCount: created.length,
      createdIds: created,
      failures
    }),
    views,
    undo
  };
}

function executeUpdate(args: Record<string, unknown>, ctx: AgentToolContext): AgentToolExecution {
  const id = toText(args.id);
  const target = ctx.transactions.find((item) => item.id === id);
  if (!target) {
    return {
      content: JSON.stringify({ ok: false, error: `未找到账单:${id || '(空 id)'}` }),
      views: [],
      undo: []
    };
  }

  const categoryCache = [...ctx.categories];
  const accountCache = [...ctx.accounts];
  const previous = toWritablePayload(target);

  const nextType =
    args.type !== undefined ? toTransactionType(args.type, target.type) : target.type;
  const nextNote = args.note !== undefined ? toText(args.note) : target.note;
  const nextTags = args.tags !== undefined ? toTags(args.tags) : target.tags;
  const nextAmount =
    args.amount !== undefined ? Math.abs(toNumber(args.amount) ?? target.amount) : target.amount;
  const nextDate = args.date !== undefined ? toDateKey(args.date) : target.date.slice(0, 10);
  const categoryName = toText(args.category);
  const accountName = toText(args.account);
  const categoryId = categoryName
    ? resolveCategoryIdByName(categoryName, nextType, nextNote, ctx, categoryCache)
    : target.categoryId;
  const accountId = accountName
    ? resolveAccountIdByName(accountName, 'ai', nextType, ctx, accountCache)
    : target.accountId;

  const payload: Omit<TransactionItem, 'id'> = {
    ...previous,
    type: nextType,
    categoryId,
    accountId,
    amount: normalizeMoney(nextAmount),
    date: nextDate,
    note: nextNote,
    tags: nextTags
  };

  ctx.updateTransaction(id, payload);
  const viewId = toViewId('agent-update', 0);
  return {
    content: JSON.stringify({ ok: true, updatedId: id }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已修改:${nextNote || findCategoryName(categoryCache, categoryId)} ¥${payload.amount.toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [{ id: viewId, run: () => ctx.updateTransaction(id, previous) }]
  };
}

function executeDelete(args: Record<string, unknown>, ctx: AgentToolContext): AgentToolExecution {
  const id = toText(args.id);
  const target = ctx.transactions.find((item) => item.id === id);
  if (!target) {
    return {
      content: JSON.stringify({ ok: false, error: `未找到账单:${id || '(空 id)'}` }),
      views: [],
      undo: []
    };
  }

  ctx.removeTransaction(id);
  const viewId = toViewId('agent-delete', 0);
  return {
    content: JSON.stringify({ ok: true, deletedId: id }),
    views: [
      {
        id: viewId,
        kind: 'delete',
        label: `已删除:${target.note || findCategoryName(ctx.categories, target.categoryId)} ¥${target.amount.toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [{ id: viewId, run: () => ctx.restoreTransaction(id) }]
  };
}

function executeQuery(args: Record<string, unknown>, ctx: AgentToolContext): AgentToolExecution {
  const keyword = toText(args.keyword);
  const typeFilter = toText(args.type);
  const categoryFilter = toText(args.category);
  const startDate = toText(args.startDate);
  const endDate = toText(args.endDate);
  const limit = Math.min(Math.max(Math.trunc(toNumber(args.limit) ?? 10), 1), MAX_QUERY_LIMIT);

  const rows = ctx.transactions
    .filter((row) => (typeFilter ? row.type === typeFilter : true))
    .filter((row) => (startDate ? row.date.slice(0, 10) >= startDate : true))
    .filter((row) => (endDate ? row.date.slice(0, 10) <= endDate : true))
    .filter((row) =>
      categoryFilter
        ? findCategoryName(ctx.categories, row.categoryId).includes(categoryFilter)
        : true
    )
    .filter((row) => matchesKeyword(row, keyword, ctx))
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, limit)
    .map((row) => serializeTransaction(row, ctx));

  return {
    content: JSON.stringify({ ok: true, count: rows.length, transactions: rows }),
    views: [],
    undo: []
  };
}

function executeSummary(args: Record<string, unknown>, ctx: AgentToolContext): AgentToolExecution {
  const startDate = toText(args.startDate);
  const endDate = toText(args.endDate);
  const groupBy = toText(args.groupBy) || 'category';

  const rows = ctx.transactions
    .filter((row) => row.type === 'expense' || row.type === 'income')
    .filter((row) => (startDate ? row.date.slice(0, 10) >= startDate : true))
    .filter((row) => (endDate ? row.date.slice(0, 10) <= endDate : true));

  const groups = new Map<
    string,
    { label: string; income: number; expense: number; count: number }
  >();
  rows.forEach((row) => {
    const label =
      groupBy === 'account'
        ? findAccountName(ctx.accounts, row.accountId)
        : groupBy === 'type'
          ? row.type
          : findCategoryName(ctx.categories, row.categoryId);
    const current = groups.get(label) || { label, income: 0, expense: 0, count: 0 };
    if (row.type === 'income') current.income += row.amount;
    else current.expense += row.amount;
    current.count += 1;
    groups.set(label, current);
  });

  const incomeTotal = rows
    .filter((row) => row.type === 'income')
    .reduce((sum, row) => sum + row.amount, 0);
  const expenseTotal = rows
    .filter((row) => row.type === 'expense')
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    content: JSON.stringify({
      ok: true,
      startDate: startDate || null,
      endDate: endDate || null,
      incomeTotal: normalizeMoney(incomeTotal),
      expenseTotal: normalizeMoney(expenseTotal),
      netTotal: normalizeMoney(incomeTotal - expenseTotal),
      count: rows.length,
      groups: Array.from(groups.values())
        .sort((a, b) => b.expense + b.income - (a.expense + a.income))
        .slice(0, 20)
    }),
    views: [],
    undo: []
  };
}

function executeList(call: ChatToolCall, ctx: AgentToolContext): AgentToolExecution {
  const payload =
    call.name === 'list_accounts'
      ? {
          accounts: ctx.accounts.map((item) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            balance: item.balance
          }))
        }
      : {
          categories: ctx.categories.map((item) => ({
            id: item.id,
            name: item.name,
            kind: (item as { kind?: string }).kind
          }))
        };

  return { content: JSON.stringify({ ok: true, ...payload }), views: [], undo: [] };
}

/** 执行一次模型工具调用,返回给模型的文本结果与可撤销的 UI 操作记录。 */
export function executeAssistantToolCall(
  call: ChatToolCall,
  ctx: AgentToolContext
): AgentToolExecution {
  const args = parseArgs(call.arguments);

  switch (call.name) {
    case 'list_accounts':
    case 'list_categories':
      return executeList(call, ctx);
    case 'query_transactions':
      return executeQuery(args, ctx);
    case 'summarize_transactions':
      return executeSummary(args, ctx);
    case 'create_transactions':
      return executeCreate(args, ctx);
    case 'update_transaction':
      return executeUpdate(args, ctx);
    case 'delete_transaction':
      return executeDelete(args, ctx);
    default:
      return {
        content: JSON.stringify({ ok: false, error: `未知工具:${call.name}` }),
        views: [],
        undo: []
      };
  }
}
