import type { Account } from '../../../entities/account/types';
import type { Category } from '../../../entities/category/types';
import type { TransactionItem, TransactionType } from '../../../entities/transaction/types';
import { ACCOUNT_TYPE_LABELS } from '../../accounts/model/accountTypes';
import type {
  AccountUpdatePayload,
  AddTransactionAction
} from '../../../shared/store/useFinanceStore';
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
  trashedAccounts: Account[];
  transactions: TransactionItem[];
  addCategory: (name: string) => string;
  addAccount: (name: string, type?: Account['type'], initialBalance?: number) => string;
  updateAccount: (id: string, payload: AccountUpdatePayload) => void;
  updateAccountBalance: (id: string, balance: number) => void;
  removeAccount: (id: string) => void;
  restoreAccount: (id: string) => void;
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
const FUND_ACCOUNT_TYPES = ['cash', 'debit', 'savings', 'virtual'] as const;
type FundAccountType = (typeof FUND_ACCOUNT_TYPES)[number];
const ACCOUNT_TYPE_OPTIONS = [
  'cash',
  'debit',
  'savings',
  'credit',
  'virtual',
  'liability',
  'receivable'
] as const;

export const ASSISTANT_AGENT_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_accounts',
      description:
        '查询资金账户的名称、id、类型、余额、关联流水数和汇总。新增账单、修改账户、校准余额或删除账户前先调用它确认目标;可同时查看回收站。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '账户名称或类型关键词,留空返回全部' },
          type: {
            type: 'string',
            enum: ACCOUNT_TYPE_OPTIONS,
            description: '只看某种账户类型'
          },
          includeTrashed: { type: 'boolean', description: '是否包含回收站中的账户' },
          limit: { type: 'number', description: '最多返回数量,默认 20,最大 50' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_account',
      description:
        '新建现金、借记卡、储蓄卡或虚拟支付账户。用户明确说出账户名和类型后调用;创建前先 list_accounts 检查是否重名。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '账户名称,1-24 个字符' },
          type: {
            type: 'string',
            enum: FUND_ACCOUNT_TYPES,
            description: '资金账户类型'
          },
          initialBalance: { type: 'number', description: '开户时的初始余额,缺省为 0' }
        },
        required: ['name', 'type'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_account',
      description:
        '修改资金账户名称或类型。先 list_accounts 确认唯一 id;匹配多个账户时让用户选择。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '账户 id,优先使用' },
          name: { type: 'string', description: '没有 id 时用于匹配当前账户名称' },
          newName: { type: 'string', description: '新的账户名称,不修改时留空' },
          type: {
            type: 'string',
            enum: FUND_ACCOUNT_TYPES,
            description: '新的账户类型,不修改时留空'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'adjust_account_balance',
      description:
        '把某个资金账户的当前余额校准到用户确认的数值。适用于“实际余额只剩多少”,不用于新增消费或收入账单。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '账户 id,优先使用' },
          name: { type: 'string', description: '没有 id 时用于匹配账户名称' },
          balance: { type: 'number', description: '校准后的当前余额,可为负数' }
        },
        required: ['balance'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_account',
      description:
        '把资金账户移入回收站。若账户仍有关联流水,首次调用会返回风险信息;只有用户明确确认后才能传 confirmLinkedTransactions=true。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '账户 id,优先使用' },
          name: { type: 'string', description: '没有 id 时用于匹配账户名称' },
          confirmLinkedTransactions: {
            type: 'boolean',
            description: '用户已明确确认连同关联流水影响一起删除时设为 true'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'restore_account',
      description: '从回收站恢复账户。先用 list_accounts(includeTrashed=true)确认目标。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '回收站账户 id,优先使用' },
          name: { type: 'string', description: '没有 id 时用于匹配账户名称' }
        },
        additionalProperties: false
      }
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
  '你是可以直接操作账本的记账助手,支持查账、记账、改账、删账,以及管理现金/银行卡/虚拟支付等资金账户。',
  '规则:',
  '1. 需要账本事实(余额、金额、账户、分类、历史账单)时先调用工具,不要凭记忆编造数据。',
  '2. 用户明确要求开户时调用 create_account;账户类型只使用现金、借记卡、储蓄卡或虚拟账户。信用卡、借款等负债请在负债模式处理。',
  '3. 用户要求给账户改名或改类型时调用 update_account;校准实际余额时调用 adjust_account_balance。操作前先调用 list_accounts 确认唯一账户。',
  '4. 用户说了明确的账目内容就调用 create_transactions 落账;信息不足时先问一句再动手。',
  '5. 修改或删除账单前必须先 query_transactions 找到目标账单 id,拿到明确 id 后再调用工具;',
  '   如果匹配到多笔且无法确定,先列出候选让用户选择,不要批量删除。',
  '6. 删除账户前检查关联流水数。只要 linkedTransactionCount 大于 0,必须先向用户说明影响并等待明确确认,之后才能再次调用 delete_account 并传 confirmLinkedTransactions=true。',
  '7. 用户要找回已删除账户时,先调用 list_accounts(includeTrashed=true),再调用 restore_account。',
  '8. 金额一律为正数,收入/支出由 type 区分;日期缺省用今天。账户余额校准可以输入用户给出的实际余额数值。',
  '9. 工具执行完成后,用一两句中文说明做了什么(账户、余额、金额、分类、时间),不要输出 JSON。',
  '10. 涉及投资、信贷的深度分析仍交给对应模式,这里只做账本与资金账户操作和解释。'
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

function toFundAccountType(value: unknown): FundAccountType | null {
  const text = toText(value);
  return FUND_ACCOUNT_TYPES.includes(text as FundAccountType) ? (text as FundAccountType) : null;
}

function normalizeAccountName(value: unknown): string {
  return toText(value).replace(/[<>]/g, '').replace(/\s+/g, ' ').slice(0, 24);
}

function accountTypeLabel(type?: Account['type']): string {
  return type ? ACCOUNT_TYPE_LABELS[type] : '未分类';
}

function accountBalance(account: Account): number {
  const value = Number(account.balance ?? account.initialBalance ?? 0);
  return Number.isFinite(value) ? normalizeMoney(value) : 0;
}

function accountTransactionStats(accountId: string, ctx: AgentToolContext) {
  const linked = ctx.transactions.filter((row) => row.accountId === accountId && !row.trashedAt);
  return {
    transactionCount: linked.length,
    lastTransactionDate:
      linked
        .map((row) => row.date.slice(0, 10))
        .sort()
        .at(-1) || ''
  };
}

function serializeAccount(account: Account, ctx: AgentToolContext) {
  const stats = accountTransactionStats(account.id, ctx);
  return {
    id: account.id,
    name: account.name,
    type: account.type || null,
    typeLabel: accountTypeLabel(account.type),
    balance: accountBalance(account),
    initialBalance: normalizeMoney(Number(account.initialBalance ?? 0)),
    sortOrder: account.sortOrder ?? null,
    transactionCount: stats.transactionCount,
    lastTransactionDate: stats.lastTransactionDate || null,
    trashed: Boolean(account.trashedAt),
    trashedAt: account.trashedAt || null
  };
}

interface AccountTargetResolution {
  account?: Account;
  error?: string;
  candidates?: Array<{ id: string; name: string }>;
}

function resolveAccountTarget(
  accounts: Account[],
  args: Record<string, unknown>
): AccountTargetResolution {
  const id = toText(args.id);
  if (id) {
    const account = accounts.find((item) => item.id === id);
    return account
      ? { account }
      : { error: `未找到账户:${id}`, candidates: [] as Array<{ id: string; name: string }> };
  }

  const name = normalizeAccountName(args.name);
  if (!name) {
    return {
      error: '需要提供账户 id 或名称。',
      candidates: [] as Array<{ id: string; name: string }>
    };
  }

  const normalizedName = name.toLowerCase();
  const exactMatches = accounts.filter((item) => item.name.trim().toLowerCase() === normalizedName);
  const matches =
    exactMatches.length > 0
      ? exactMatches
      : accounts.filter((item) => item.name.toLowerCase().includes(normalizedName));
  if (matches.length === 1) return { account: matches[0] };
  if (matches.length === 0) {
    return {
      error: `未找到账户:${name}`,
      candidates: [] as Array<{ id: string; name: string }>
    };
  }
  return {
    error: `找到多个匹配账户,请先确认要操作哪一个:${matches.map((item) => item.name).join('、')}`,
    candidates: matches.slice(0, 10).map((item) => ({ id: item.id, name: item.name }))
  };
}

function accountFailure(
  error = '账户操作失败。',
  candidates: Array<{ id: string; name: string }> = []
) {
  return {
    content: JSON.stringify({ ok: false, error, candidates }),
    views: [],
    undo: []
  } satisfies AgentToolExecution;
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

function executeListAccounts(
  args: Record<string, unknown>,
  ctx: AgentToolContext
): AgentToolExecution {
  const keyword = toText(args.keyword).toLowerCase();
  const typeFilter = ACCOUNT_TYPE_OPTIONS.includes(
    toText(args.type) as (typeof ACCOUNT_TYPE_OPTIONS)[number]
  )
    ? (toText(args.type) as Account['type'])
    : undefined;
  const includeTrashed = args.includeTrashed === true;
  const limit = Math.min(Math.max(Math.trunc(toNumber(args.limit) ?? 20), 1), 50);
  const matches = (account: Account) => {
    if (typeFilter && account.type !== typeFilter) return false;
    if (!keyword) return true;
    return [account.name, accountTypeLabel(account.type)].join(' ').toLowerCase().includes(keyword);
  };

  const active = ctx.accounts.filter(matches);
  const trashed = includeTrashed ? ctx.trashedAccounts.filter(matches) : [];
  const assetsTotal = active
    .filter((item) => item.type !== 'credit' && item.type !== 'liability')
    .reduce((sum, item) => sum + accountBalance(item), 0);
  const liabilitiesTotal = active
    .filter((item) => item.type === 'credit' || item.type === 'liability')
    .reduce((sum, item) => sum + Math.abs(accountBalance(item)), 0);

  return {
    content: JSON.stringify({
      ok: true,
      summary: {
        accountCount: active.length,
        trashedCount: trashed.length,
        assetsTotal: normalizeMoney(assetsTotal),
        liabilitiesTotal: normalizeMoney(liabilitiesTotal),
        netTotal: normalizeMoney(assetsTotal - liabilitiesTotal)
      },
      accounts: active.slice(0, limit).map((account) => serializeAccount(account, ctx)),
      trashedAccounts: trashed.slice(0, limit).map((account) => serializeAccount(account, ctx))
    }),
    views: [],
    undo: []
  };
}

function executeCreateAccount(
  args: Record<string, unknown>,
  ctx: AgentToolContext
): AgentToolExecution {
  const name = normalizeAccountName(args.name);
  if (!name) return accountFailure('账户名称需为 1-24 个字符,且不能包含 < 或 >。');
  const type = toFundAccountType(args.type);
  if (!type) return accountFailure('账户类型必须是现金、借记卡、储蓄卡或虚拟账户。');
  const duplicate = [...ctx.accounts, ...ctx.trashedAccounts].find(
    (item) => item.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) return accountFailure(`账户“${name}”已经存在,请先确认是否需要改名。`);

  const initialBalance = args.initialBalance === undefined ? 0 : toNumber(args.initialBalance);
  if (initialBalance === null) return accountFailure('初始余额必须是有效数字。');

  const id = ctx.addAccount(name, type, initialBalance);
  const account: Account = {
    id,
    name,
    type,
    initialBalance: normalizeMoney(initialBalance),
    balance: normalizeMoney(initialBalance)
  };
  ctx.accounts.push(account);
  const viewId = toViewId('agent-account-create', 0);
  return {
    content: JSON.stringify({
      ok: true,
      createdId: id,
      account: serializeAccount(account, ctx)
    }),
    views: [
      {
        id: viewId,
        kind: 'create',
        label: `已新建账户:${name}(${accountTypeLabel(type)}) ¥${accountBalance(account).toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.removeAccount(id);
          const index = ctx.accounts.findIndex((item) => item.id === id);
          if (index >= 0) ctx.accounts.splice(index, 1);
        }
      }
    ]
  };
}

function executeUpdateAccount(
  args: Record<string, unknown>,
  ctx: AgentToolContext
): AgentToolExecution {
  const resolved = resolveAccountTarget(ctx.accounts, args);
  if (!resolved.account) return accountFailure(resolved.error, resolved.candidates);

  const target = resolved.account;
  const nextName =
    args.newName !== undefined ? normalizeAccountName(args.newName) : target.name.trim();
  if (!nextName) return accountFailure('新账户名称需为 1-24 个字符,且不能包含 < 或 >。');
  const nextType = args.type !== undefined ? toFundAccountType(args.type) : target.type || null;
  if (!nextType) return accountFailure('账户类型必须是现金、借记卡、储蓄卡或虚拟账户。');
  const duplicate = ctx.accounts.find(
    (item) => item.id !== target.id && item.name.trim().toLowerCase() === nextName.toLowerCase()
  );
  if (duplicate) return accountFailure(`账户“${nextName}”已经存在,请换一个名称。`);
  if (target.name === nextName && target.type === nextType) {
    return accountFailure('账户名称和类型没有变化,不需要修改。');
  }

  const previous: Account = { ...target };
  const updated: Account = { ...target, name: nextName, type: nextType };
  ctx.updateAccount(target.id, { name: nextName, type: nextType });
  const index = ctx.accounts.findIndex((item) => item.id === target.id);
  if (index >= 0) ctx.accounts[index] = updated;
  const viewId = toViewId('agent-account-update', 0);
  return {
    content: JSON.stringify({
      ok: true,
      updatedId: target.id,
      account: serializeAccount(updated, ctx)
    }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已更新账户:${previous.name} → ${nextName}(${accountTypeLabel(nextType)})`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.updateAccount(target.id, { name: previous.name, type: previous.type });
          const currentIndex = ctx.accounts.findIndex((item) => item.id === target.id);
          if (currentIndex >= 0) ctx.accounts[currentIndex] = previous;
        }
      }
    ]
  };
}

function executeAdjustAccountBalance(
  args: Record<string, unknown>,
  ctx: AgentToolContext
): AgentToolExecution {
  const resolved = resolveAccountTarget(ctx.accounts, args);
  if (!resolved.account) return accountFailure(resolved.error, resolved.candidates);
  const nextBalance = toNumber(args.balance);
  if (nextBalance === null) return accountFailure('校准余额必须是有效数字。');

  const previous: Account = { ...resolved.account };
  const previousBalance = accountBalance(previous);
  const normalizedBalance = normalizeMoney(nextBalance);
  if (previousBalance === normalizedBalance) {
    return accountFailure(`账户“${previous.name}”的余额已经是 ¥${normalizedBalance.toFixed(2)}。`);
  }

  ctx.updateAccountBalance(previous.id, normalizedBalance);
  const updated: Account = { ...previous, balance: normalizedBalance };
  const index = ctx.accounts.findIndex((item) => item.id === previous.id);
  if (index >= 0) ctx.accounts[index] = updated;
  const viewId = toViewId('agent-account-balance', 0);
  return {
    content: JSON.stringify({
      ok: true,
      accountId: previous.id,
      accountName: previous.name,
      previousBalance,
      balance: normalizedBalance
    }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已校准账户余额:${previous.name} ¥${previousBalance.toFixed(2)} → ¥${normalizedBalance.toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.updateAccountBalance(previous.id, previousBalance);
          const currentIndex = ctx.accounts.findIndex((item) => item.id === previous.id);
          if (currentIndex >= 0) ctx.accounts[currentIndex] = previous;
        }
      }
    ]
  };
}

function executeDeleteAccount(
  args: Record<string, unknown>,
  ctx: AgentToolContext
): AgentToolExecution {
  const resolved = resolveAccountTarget(ctx.accounts, args);
  if (!resolved.account) return accountFailure(resolved.error, resolved.candidates);
  const target = resolved.account;
  const stats = accountTransactionStats(target.id, ctx);
  const confirmed = args.confirmLinkedTransactions === true;
  if (stats.transactionCount > 0 && !confirmed) {
    return {
      content: JSON.stringify({
        ok: false,
        error: `账户“${target.name}”仍有 ${stats.transactionCount} 笔关联流水。请先向用户说明影响并取得明确确认。`,
        linkedTransactionCount: stats.transactionCount,
        requiresConfirmation: true,
        nextStep: '用户确认后,再次调用 delete_account 并传 confirmLinkedTransactions=true。'
      }),
      views: [],
      undo: []
    };
  }

  ctx.removeAccount(target.id);
  const index = ctx.accounts.findIndex((item) => item.id === target.id);
  if (index >= 0) ctx.accounts.splice(index, 1);
  const viewId = toViewId('agent-account-delete', 0);
  return {
    content: JSON.stringify({
      ok: true,
      deletedId: target.id,
      movedToTrash: true,
      linkedTransactionCount: stats.transactionCount
    }),
    views: [
      {
        id: viewId,
        kind: 'delete',
        label: `已删除账户:${target.name}${
          stats.transactionCount > 0 ? `(保留 ${stats.transactionCount} 笔关联流水)` : ''
        }`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.restoreAccount(target.id);
          if (!ctx.accounts.some((item) => item.id === target.id)) {
            ctx.accounts.push({ ...target, trashedAt: undefined });
          }
          const trashedIndex = ctx.trashedAccounts.findIndex((item) => item.id === target.id);
          if (trashedIndex >= 0) ctx.trashedAccounts.splice(trashedIndex, 1);
        }
      }
    ]
  };
}

function executeRestoreAccount(
  args: Record<string, unknown>,
  ctx: AgentToolContext
): AgentToolExecution {
  const resolved = resolveAccountTarget(ctx.trashedAccounts, args);
  if (!resolved.account) {
    return accountFailure(
      resolved.error === '需要提供账户 id 或名称。'
        ? resolved.error
        : `回收站中未找到账户:${toText(args.id) || toText(args.name)}`,
      resolved.candidates
    );
  }

  const target = resolved.account;
  ctx.restoreAccount(target.id);
  const trashedIndex = ctx.trashedAccounts.findIndex((item) => item.id === target.id);
  if (trashedIndex >= 0) ctx.trashedAccounts.splice(trashedIndex, 1);
  const restored = { ...target, trashedAt: undefined };
  if (!ctx.accounts.some((item) => item.id === target.id)) ctx.accounts.push(restored);
  const viewId = toViewId('agent-account-restore', 0);
  return {
    content: JSON.stringify({
      ok: true,
      restoredId: target.id,
      account: serializeAccount(restored, ctx)
    }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已从回收站恢复账户:${target.name}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.removeAccount(target.id);
          const index = ctx.accounts.findIndex((item) => item.id === target.id);
          if (index >= 0) ctx.accounts.splice(index, 1);
          if (!ctx.trashedAccounts.some((item) => item.id === target.id)) {
            ctx.trashedAccounts.push(target);
          }
        }
      }
    ]
  };
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
  // 直接复用上下文里的数组,保证同一轮对话内后续工具能看到刚创建的分类/账户。
  const categoryCache = ctx.categories;
  const accountCache = ctx.accounts;
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
    ctx.transactions.push({ id, ...payload });
    const viewId = toViewId('agent-create', index);
    views.push({
      id: viewId,
      kind: 'create',
      label: `已记账:${note || findCategoryName(categoryCache, categoryId)} ${
        type === 'income' ? '+' : '-'
      }¥${payload.amount.toFixed(2)}`,
      undoable: true
    });
    undo.push({
      id: viewId,
      run: () => {
        ctx.removeTransaction(id);
        const index = ctx.transactions.findIndex((row) => row.id === id);
        if (index >= 0) ctx.transactions.splice(index, 1);
      }
    });
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

  const categoryCache = ctx.categories;
  const accountCache = ctx.accounts;
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
  const rowIndex = ctx.transactions.findIndex((item) => item.id === id);
  if (rowIndex >= 0) {
    ctx.transactions[rowIndex] = { id, ...payload };
  }
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
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.updateTransaction(id, previous);
          const index = ctx.transactions.findIndex((item) => item.id === id);
          if (index >= 0) ctx.transactions[index] = { id, ...previous };
        }
      }
    ]
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
  const rowIndex = ctx.transactions.findIndex((item) => item.id === id);
  if (rowIndex >= 0) ctx.transactions.splice(rowIndex, 1);
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
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.restoreTransaction(id);
          if (!ctx.transactions.some((item) => item.id === id)) {
            ctx.transactions.push(target);
          }
        }
      }
    ]
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
      return executeListAccounts(args, ctx);
    case 'list_categories':
      return executeList(call, ctx);
    case 'create_account':
      return executeCreateAccount(args, ctx);
    case 'update_account':
      return executeUpdateAccount(args, ctx);
    case 'adjust_account_balance':
      return executeAdjustAccountBalance(args, ctx);
    case 'delete_account':
      return executeDeleteAccount(args, ctx);
    case 'restore_account':
      return executeRestoreAccount(args, ctx);
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
