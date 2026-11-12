import type { DebtItem, RepaymentRecord } from '../../debt/model/debtMetrics';
import {
  calculateDebtDerivedMetrics,
  calculateDebtMinimumPayment,
  calculateDebtSummary
} from '../../debt/model/debtMetrics';
import { resolveDebtRepaymentDueDisplay } from '../../debt/model/repaymentCycle';
import type { CreditDraft } from '../../debt/model/creditDrafts';
import {
  createCreditDraft,
  findCreditDraftForFragment,
  getCreditDraftPendingFields,
  isCreditDraftReady,
  creditDraftToDebt,
  inferCreditDraftType,
  mergeCreditDraft
} from '../../debt/model/creditDrafts';
import type { ChatToolCall, ChatToolDefinition } from '../api/openaiCompatibleClient';
import type { AgentToolExecution } from './assistantAgentTools';

export type CreditDebtType = DebtItem['type'];

export interface CreditAgentContext {
  debts: DebtItem[];
  repaymentRecords: RepaymentRecord[];
  creditDrafts: CreditDraft[];
  monthlyIncome: number;
  /** 便于测试注入的“今天”,默认取当前系统时间。 */
  now?: Date;
  addDebt: (payload: Omit<DebtItem, 'id'> & { id?: string }) => string;
  updateDebt: (id: string, payload: Omit<DebtItem, 'id'>) => void;
  removeDebt: (id: string) => void;
  addRepaymentRecord: (
    payload: Omit<RepaymentRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
  ) => string;
  removeRepaymentRecord: (id: string) => void;
  upsertCreditDraft: (payload: Partial<CreditDraft>) => string;
  removeCreditDraft: (id: string) => void;
}

export const CREDIT_COMMAND_VOCABULARY = {
  query: ['还多少', '还差多少', '先还哪笔', '欠了多少', '总负债', '月供', '逾期', '最急'],
  create: ['记一笔', '加上', '录入', '帮我记', '欠了', '还欠'],
  update: ['改成', '改一下', '调整', '更正', '不是', '应该是', '错了', '重新记'],
  delete: ['删掉', '去掉', '移除', '不要了', '取消这笔', '撤掉'],
  repayment: ['还了', '已还', '扣款', '还款', '提前还'],
  draftSupplement: ['总共', '分几期', '还剩', '每月', '每期', '还款日', '扣款日', '几号', '多少号'],
  confirm: ['确认', '对', '没错', '可以', '删吧', '就这样', '嗯', '行', '好的'],
  cancel: ['不对', '先别', '不要', '取消', '算了', '暂停', '不用了', '别记了', '先这样']
} as const;

export const CREDIT_AGENT_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_repayment_snapshot',
      description:
        '读取还款台账总览:总负债、每月应还、负债压力、每笔负债的本期应还/已还/还差、到期日与年化利率。回答“本月还多少”“还差多少”“哪些最急”前先调用它。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_credit_drafts',
      description:
        '读取跨轮保存的信贷草稿，包括已知字段和待补字段。判断用户当前消息是否在补充之前的信息前先调用。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '草稿名称关键词，留空返回全部' },
          includeReady: {
            type: 'boolean',
            description: '是否同时返回已达到正式登记条件的草稿，默认 true'
          },
          limit: { type: 'number', description: '返回条数，默认 10，最多 30' }
        },
        additionalProperties: false
      }
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_partial_debt_draft',
      description:
        '保存或合并一条不完整的信贷信息草稿。用户只说了名称、总欠款、期数、还款日中的部分字段时必须调用；只传明确出现的字段，禁止补齐猜测值。传 draftId 可合并已有草稿，否则按名称匹配。',
      parameters: {
        type: 'object',
        properties: {
          draftId: { type: 'string', description: '现有草稿 id；同名或单个活动草稿可省略' },
          name: { type: 'string', description: '产品或平台名称，例如京东白条' },
          type: {
            type: 'string',
            enum: ['credit-card', 'consumer-loan', 'loan'],
            description: '负债类型，可由名称推断时省略'
          },
          balance: { type: 'number', description: '总欠款/剩余待还，必须大于 0' },
          dueAmount: { type: 'number', description: '当前期应还金额' },
          annualRate: { type: 'number', description: '年化利率百分数' },
          repaymentDay: { type: 'number', description: '每月还款日（1-31）' },
          remainingMonths: { type: 'number', description: '剩余期数' },
          totalPeriods: { type: 'number', description: '总期数' },
          paidPeriods: { type: 'number', description: '已还期数' },
          monthlyAmount: { type: 'number', description: '每期应还金额' },
          paymentAccount: { type: 'string', description: '约定还款账户' },
          note: { type: 'string', description: '原始信息片段或待核对备注' }
        },
        additionalProperties: false
      }
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_credit_draft',
      description: '删除一条不完整信贷草稿。仅在用户明确要求删除时使用，可撤销。',
      parameters: {
        type: 'object',
        properties: {
          draftId: { type: 'string', description: '草稿 id' },
          name: { type: 'string', description: '没有 draftId 时按名称匹配' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'promote_credit_draft',
      description:
        '把字段齐全且已得到用户确认的信贷草稿转为正式负债，并移出草稿列表。字段不齐时调用会失败，不会创建半成品台账。',
      parameters: {
        type: 'object',
        properties: {
          draftId: { type: 'string', description: '待转正的草稿 id' },
          confirm: { type: 'boolean', description: '用户明确确认转正时传 true' }
        },
        required: ['draftId', 'confirm'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_debts',
      description:
        '按名称、机构或类型检索已保存的负债,返回余额、应还金额、还款日、期数和 id。修改或删除前先用它确认唯一目标。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '负债名称或机构关键词,留空返回全部' },
          type: {
            type: 'string',
            enum: ['credit-card', 'consumer-loan', 'loan'],
            description: '按负债类型过滤:信用卡/消费贷/贷款'
          },
          status: {
            type: 'string',
            enum: ['active', 'settled', 'closed', 'paused'],
            description: '按生命周期状态过滤'
          },
          limit: { type: 'number', description: '返回条数,默认 10,最多 30' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_repayment_records',
      description:
        '查询已登记的还款流水,可按负债名称或月份(YYYY-MM)过滤。回答“这个月还了多少”“哪几笔还过”前先调用它。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '负债名称关键词,留空返回全部' },
          month: { type: 'string', description: '限定月份,格式 YYYY-MM,留空返回最近记录' },
          limit: { type: 'number', description: '返回条数,默认 20,最多 60' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_repayment_record',
      description:
        '修改一笔已登记还款流水的金额、日期、账户或备注，并按金额差额校正负债余额。先用 query_repayment_records 选中唯一记录。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '还款流水 id' },
          amount: { type: 'number', description: '新的还款金额，必须大于 0' },
          paidAt: { type: 'string', description: '新的还款日期 YYYY-MM-DD' },
          paymentAccount: { type: 'string', description: '新的实际还款账户' },
          note: { type: 'string', description: '新的备注' }
        },
        required: ['id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_repayment_record',
      description:
        '删除一笔还款流水并把对应金额加回负债余额。必须先向用户说明影响，得到确认后传 confirm=true；工具支持撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '还款流水 id' },
          confirm: {
            type: 'boolean',
            description: '用户确认删除且理解会影响余额时传 true'
          }
        },
        required: ['id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_debt',
      description:
        '新增一笔负债(信用账单、消费贷或贷款)到还款管理。用户明确说“帮我加上/记一笔”且信息已足够时使用;除 name、balance 外还必须至少提供期数、还款日或每期金额中的一项。信息不全时改用 save_partial_debt_draft,不要创建半成品。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '负债名称,例如“招商银行信用卡”' },
          type: {
            type: 'string',
            enum: ['credit-card', 'consumer-loan', 'loan'],
            description: '负债类型,默认 credit-card'
          },
          balance: { type: 'number', description: '剩余待还本金,必须大于等于 0' },
          annualRate: { type: 'number', description: '年化利率(百分数),例如 18 表示 18%' },
          repaymentDay: { type: 'number', description: '每月还款日(1-31)' },
          remainingMonths: { type: 'number', description: '剩余期数' },
          totalPeriods: { type: 'number', description: '总期数' },
          paidPeriods: { type: 'number', description: '已还期数' },
          loanPrincipal: { type: 'number', description: '贷款本金' },
          totalRepayment: { type: 'number', description: '还款总额(本金+利息)' },
          customMinPayment: { type: 'number', description: '自定义最低还款额或每期金额' },
          paymentAccount: { type: 'string', description: '约定的扣款/还款账户名' }
        },
        required: ['name', 'balance'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_debt',
      description:
        '修改一笔已有负债的字段(余额、利率、还款日、期数、账户等)。先用 query_debts 确认唯一目标,只传要改的字段。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '负债 id,优先使用' },
          name: { type: 'string', description: '没有 id 时按名称匹配' },
          newName: { type: 'string', description: '要把负债改名成的新名称' },
          type: {
            type: 'string',
            enum: ['credit-card', 'consumer-loan', 'loan'],
            description: '新的负债类型'
          },
          balance: { type: 'number', description: '新的剩余待还金额' },
          annualRate: { type: 'number', description: '新的年化利率(百分数)' },
          repaymentDay: { type: 'number', description: '新的每月还款日(1-31)' },
          remainingMonths: { type: 'number', description: '新的剩余期数' },
          totalPeriods: { type: 'number', description: '新的总期数' },
          paidPeriods: { type: 'number', description: '新的已还期数' },
          loanPrincipal: { type: 'number', description: '新的贷款本金' },
          totalRepayment: { type: 'number', description: '新的还款总额' },
          customMinPayment: { type: 'number', description: '新的最低还款额或每期金额' },
          paymentAccount: { type: 'string', description: '新的扣款/还款账户名' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'record_repayment',
      description:
        '登记一笔实际还款,并同步扣减对应负债的剩余待还。用户说“今天还了/还了 2000”时使用;先用 query_debts 确认负债 id。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '负债 id,优先使用' },
          name: { type: 'string', description: '没有 id 时按负债名称匹配' },
          amount: { type: 'number', description: '本次还款金额,必须大于 0' },
          paidAt: { type: 'string', description: '还款日期 YYYY-MM-DD,缺省用今天' },
          paymentAccount: { type: 'string', description: '实际还款账户名' },
          note: { type: 'string', description: '备注' }
        },
        required: ['amount'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_debt',
      description:
        '删除一笔负债。若该负债已有还款流水,必须先向用户说明影响,得到确认后再传 confirmLinkedRecords=true 重新调用。可撤销。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '负债 id,优先使用' },
          name: { type: 'string', description: '没有 id 时按负债名称匹配' },
          confirmLinkedRecords: {
            type: 'boolean',
            description: '确认同时删除关联还款流水时传 true'
          }
        },
        additionalProperties: false
      }
    }
  }
];

export const CREDIT_AGENT_INSTRUCTIONS = [
  '你可以直接操作还款管理和信贷草稿:查负债、查草稿、保存片段、转正草稿、查还款流水、新增负债、修改负债、登记/修改/删除还款流水、删除负债。',
  '规则:',
  '1. 涉及总负债、每月应还、还差多少、逾期、哪笔最急时,先调用 get_repayment_snapshot;涉及具体某笔负债时先调用 query_debts,不要凭记忆或历史对话编造金额。',
  '2. 用户明确给出了某笔信贷的片段信息时,先将这些已知字段保存为草稿。例如“京东白条总欠款2000”立即调用 save_partial_debt_draft,只保存名称和总待还;后续消息补充期数、还款日或每期金额时,必须按 draftId 或同名身份合并既有草稿。',
  '2.1 当前用户消息与草稿、历史消息或工具结果冲突时,当前用户消息是唯一最新事实。金额、期数、日期等必须按当前消息更新,禁止用历史金额覆盖当前明确输入,也禁止向用户声称“按旧值覆盖”。',
  '3. 草稿的最低登记条件是名称、待还金额和至少一个还款安排锚点(期数、还款日或每期金额)。字段不足时禁止调用 create_debt 或 promote_credit_draft,不得为凑齐条件编造期数;字段齐全后询问用户是否转正,得到确认才调用 promote_credit_draft。',
  '4. 如果用户只是上传账单/截图让你识别,或只是让你分析,不要调用任何写入工具;只在回答末尾输出 creditItems JSON 交给用户确认保存。',
  '5. 修改、登记、修改或删除还款流水前必须先用 query_repayment_records 拿到明确 id;删除前必须等用户确认,重复调用时传 confirm=true。',
  '6. 修改、登记还款或删除负债前必须先用 query_debts 拿到明确 id;匹配到多笔且无法确定时先列出候选让用户选择,不要批量操作。',
  '7. 登记还款使用 record_repayment,金额一律为正数;它会把“已还”写入还款流水并同步扣减剩余待还。编辑使用 update_repayment_record,删除使用 delete_repayment_record。',
  '8. 删除负债前检查 linkedRepaymentCount;大于 0 时必须先说明将同时删除关联还款流水,等待用户确认后再传 confirmLinkedRecords=true 重新调用。',
  '9. 同一轮拿到明确 id 后直接复用,不要为每个后续动作重复查询同一负债。',
  '10. 始终使用简体中文回答;工具执行完成后用一两句说明实际结果(草稿缺什么、负债、余额、金额、时间),不要输出 JSON,禁止只回复“马上处理”等预告性空话。',
  '11. 只做台账操作与解释,不替用户转账、不承诺减免利息或收益;涉及投资、记账的深度分析交给对应模式。',
  '【常见用户词汇】',
  ...Object.entries(CREDIT_COMMAND_VOCABULARY).map(([intent, words]) => `${intent}:${words.join('、')}`)
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
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(toText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasArg(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined;
}

function toViewId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeDebtType(value: unknown): CreditDebtType {
  const text = toText(value);
  if (text === 'credit-card' || text === 'consumer-loan' || text === 'loan') return text;
  return 'credit-card';
}

function debtTypeLabel(type: CreditDebtType): string {
  if (type === 'credit-card') return '信用卡';
  if (type === 'consumer-loan') return '消费贷';
  return '贷款';
}

function todayIso(ctx: CreditAgentContext): string {
  return (ctx.now ?? new Date()).toISOString().slice(0, 10);
}

function monthKey(ctx: CreditAgentContext): string {
  return todayIso(ctx).slice(0, 7);
}

function linkedRecordCount(ctx: CreditAgentContext, debtId: string): number {
  return ctx.repaymentRecords.filter((record) => record.debtId === debtId).length;
}

function serializeDebt(ctx: CreditAgentContext, debt: DebtItem) {
  const metrics = calculateDebtDerivedMetrics(debt);
  const dueDisplay = resolveDebtRepaymentDueDisplay(
    debt,
    metrics.minimumPayment,
    ctx.repaymentRecords,
    ctx.now ?? new Date()
  );
  return {
    id: debt.id,
    name: debt.name,
    type: debt.type,
    typeLabel: debtTypeLabel(debt.type),
    status: debt.status ?? (debt.balance <= 0 ? 'settled' : 'active'),
    entryMode: debt.entryMode ?? 'standard',
    balance: roundMoney(Math.max(0, Number(debt.balance) || 0)),
    minimumPayment: roundMoney(metrics.minimumPayment),
    annualRate: metrics.annualRate > 0 ? Number(metrics.annualRate.toFixed(2)) : null,
    rateSource: metrics.rateSource,
    repaymentDay: debt.repaymentDay ?? null,
    paymentAccount: debt.paymentAccount || '',
    repaymentMethod: debt.repaymentMethod || '',
    totalPeriods: debt.totalPeriods ?? null,
    paidPeriods: debt.paidPeriods ?? null,
    remainingMonths: debt.remainingMonths ?? metrics.remainingMonths,
    loanPrincipal: debt.loanPrincipal ?? null,
    totalRepayment: debt.totalRepayment ?? null,
    customMinPayment: debt.customMinPayment ?? null,
    simpleDueDate: debt.simpleDueDate || null,
    simpleAmount: debt.simpleAmount ?? null,
    thisMonthPaid: roundMoney(dueDisplay?.paidAmount ?? 0),
    thisMonthGap: roundMoney(dueDisplay?.gapAmount ?? metrics.minimumPayment),
    dueDate: dueDisplay ? dueDisplay.dueDate.toISOString().slice(0, 10) : null,
    daysUntilDue: dueDisplay?.daysUntil ?? null,
    isPaidThisMonth: dueDisplay?.isPaid ?? false,
    isOverdue: dueDisplay?.isOverdue ?? false,
    linkedRepaymentCount: linkedRecordCount(ctx, debt.id)
  };
}

function findDebt(
  ctx: CreditAgentContext,
  args: Record<string, unknown>
): {
  target: DebtItem | null;
  candidates: DebtItem[];
} {
  const id = toText(args.id);
  if (id) {
    const target = ctx.debts.find((item) => item.id === id) ?? null;
    return { target, candidates: [] };
  }
  const keyword = toText(args.name || args.keyword).toLowerCase();
  if (!keyword) return { target: null, candidates: [] };
  const exact = ctx.debts.filter((item) => item.name.toLowerCase() === keyword);
  if (exact.length === 1) return { target: exact[0], candidates: [] };
  if (exact.length > 1) return { target: null, candidates: exact };
  const partial = ctx.debts.filter((item) => item.name.toLowerCase().includes(keyword));
  if (partial.length === 1) return { target: partial[0], candidates: [] };
  return { target: null, candidates: partial };
}

function ambiguousContent(candidates: DebtItem[]): string {
  return JSON.stringify({
    ok: false,
    needsSelection: true,
    error: '匹配到多笔负债,请让用户从候选中选择后再操作。',
    candidates: candidates.map((item) => ({ id: item.id, name: item.name, balance: item.balance }))
  });
}

function executeSnapshot(ctx: CreditAgentContext): AgentToolExecution {
  const summary = calculateDebtSummary(ctx.debts, ctx.monthlyIncome);
  const debts = ctx.debts.map((debt) => serializeDebt(ctx, debt));
  const dueSoon = debts
    .filter((debt) => debt.daysUntilDue !== null)
    .slice()
    .sort((left, right) => (left.daysUntilDue ?? 0) - (right.daysUntilDue ?? 0))
    .slice(0, 5);
  const viewId = toViewId('credit-read');
  return {
    content: JSON.stringify({
      ok: true,
      generatedAt: new Date().toISOString(),
      summary: {
        debtCount: ctx.debts.length,
        totalDebt: roundMoney(summary.totalDebt),
        totalMinimumPayment: roundMoney(summary.totalMinimumPayment),
        pressureRatio: Number(summary.pressureRatio.toFixed(4)),
        monthlyIncome: roundMoney(ctx.monthlyIncome),
        currentMonth: monthKey(ctx)
      },
      dueSoon,
      debts
    }),
    views: [
      {
        id: viewId,
        kind: 'read',
        label: `已读取 ${ctx.debts.length} 笔负债,总待还 ¥${roundMoney(summary.totalDebt).toFixed(2)}`,
        undoable: false
      }
    ],
    undo: []
  };
}

function executeQueryDebts(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const keyword = toText(args.keyword).toLowerCase();
  const type = toText(args.type);
  const status = toText(args.status);
  const limit = Math.min(Math.max(Math.trunc(toNumber(args.limit) ?? 10), 1), 30);
  const matched = ctx.debts
    .filter((item) => {
      if (keyword && !item.name.toLowerCase().includes(keyword)) return false;
      if (type && item.type !== type) return false;
      if (status && (item.status ?? (item.balance <= 0 ? 'settled' : 'active')) !== status) {
        return false;
      }
      return true;
    })
    .slice(0, limit)
    .map((item) => serializeDebt(ctx, item));

  const viewId = toViewId('credit-read');
  return {
    content: JSON.stringify({
      ok: true,
      matchedCount: matched.length,
      totalDebtCount: ctx.debts.length,
      available: ctx.debts.map((item) => ({ id: item.id, name: item.name, type: item.type })),
      debts: matched
    }),
    views: [
      {
        id: viewId,
        kind: 'read',
        label: matched.length
          ? `已找到 ${matched.length} 笔负债:${matched.map((item) => item.name).join('、')}`
          : '查询负债:当前没有匹配项',
        undoable: false
      }
    ],
    undo: []
  };
}

function executeQueryRepaymentRecords(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const keyword = toText(args.keyword).toLowerCase();
  const month = toText(args.month);
  const limit = Math.min(Math.max(Math.trunc(toNumber(args.limit) ?? 20), 1), 60);
  const nameById = new Map(ctx.debts.map((item) => [item.id, item.name]));
  const matched = ctx.repaymentRecords
    .filter((record) => {
      if (month && !String(record.paidAt || '').startsWith(month)) return false;
      if (keyword) {
        const name = (nameById.get(record.debtId) || '').toLowerCase();
        if (!name.includes(keyword)) return false;
      }
      return true;
    })
    .sort((left, right) => String(right.paidAt).localeCompare(String(left.paidAt)))
    .slice(0, limit)
    .map((record) => ({
      id: record.id,
      debtId: record.debtId,
      debtName: nameById.get(record.debtId) || '未知负债',
      amount: roundMoney(Number(record.amount) || 0),
      paidAt: record.paidAt,
      paymentAccount: record.paymentAccount || '',
      recordMode: record.recordMode,
      note: record.note || ''
    }));

  const total = matched.reduce((sum, record) => sum + record.amount, 0);
  const viewId = toViewId('credit-read');
  return {
    content: JSON.stringify({
      ok: true,
      matchedCount: matched.length,
      totalAmount: roundMoney(total),
      records: matched
    }),
    views: [
      {
        id: viewId,
        kind: 'read',
        label: matched.length
          ? `已查还款流水 ${matched.length} 笔,合计 ¥${roundMoney(total).toFixed(2)}`
          : '没有查到匹配的还款流水',
        undoable: false
      }
    ],
    undo: []
  };
}

function executeQueryCreditDrafts(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const keyword = toText(args.keyword).toLowerCase();
  const includeReady = args.includeReady !== false;
  const limit = Math.min(Math.max(Math.trunc(toNumber(args.limit) ?? 10), 1), 30);
  const matched = ctx.creditDrafts
    .filter((draft) => {
      if (keyword && !(draft.name || '').toLowerCase().includes(keyword)) return false;
      return includeReady || !isCreditDraftReady(draft);
    })
    .slice(0, limit)
    .map((draft) => ({
      ...draft,
      pendingFields: getCreditDraftPendingFields(draft),
      ready: isCreditDraftReady(draft)
    }));

  const viewId = toViewId('credit-read');
  return {
    content: JSON.stringify({
      ok: true,
      matchedCount: matched.length,
      totalDraftCount: ctx.creditDrafts.length,
      drafts: matched
    }),
    views: [
      {
        id: viewId,
        kind: 'read',
        label: matched.length
          ? `已读取 ${matched.length} 条信贷草稿:${matched
              .map((draft) => `${draft.name || '待确认草稿'}(缺${draft.pendingFields.join('、') || '无'})`)
              .join(';')}`
          : '查询信贷草稿:当前没有匹配项',
        undoable: false
      }
    ],
    undo: []
  };
}

function draftArgsToPatch(args: Record<string, unknown>): Partial<CreditDraft> {
  const patch: Partial<CreditDraft> = {};
  const id = toText(args.draftId || args.id);
  if (id) patch.id = id;
  const name = toText(args.name);
  if (name) patch.name = name;
  const rawType = toText(args.type);
  if (rawType === 'credit-card' || rawType === 'consumer-loan' || rawType === 'loan') {
    patch.type = rawType;
  }
  const numericFields: Array<[keyof CreditDraft, unknown]> = [
    ['balance', args.balance],
    ['dueAmount', args.dueAmount],
    ['annualRate', args.annualRate],
    ['repaymentDay', args.repaymentDay],
    ['remainingMonths', args.remainingMonths],
    ['totalPeriods', args.totalPeriods],
    ['paidPeriods', args.paidPeriods],
    ['monthlyAmount', args.monthlyAmount]
  ];
  numericFields.forEach(([key, value]) => {
    const parsed = toNumber(value);
    if (parsed !== null && parsed > 0) (patch as Record<string, unknown>)[key] = parsed;
  });
  const paymentAccount = toText(args.paymentAccount);
  if (paymentAccount) patch.paymentAccount = paymentAccount;
  const note = toText(args.note);
  if (note) patch.note = note;
  if (!patch.type && patch.name) patch.type = inferCreditDraftType(patch.name);
  return patch;
}

function serializeCreditDraft(draft: CreditDraft): Record<string, unknown> {
  return {
    ...draft,
    typeLabel: debtTypeLabel(draft.type || inferCreditDraftType(draft.name)),
    pendingFields: getCreditDraftPendingFields(draft),
    ready: isCreditDraftReady(draft)
  };
}

function executeSaveCreditDraft(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const patch = draftArgsToPatch(args);
  const draftId = toText(args.draftId);
  const target = draftId
    ? ctx.creditDrafts.find((draft) => draft.id === draftId)
    : findCreditDraftForFragment(ctx.creditDrafts, patch);
  if (!target && !toText(args.name) && !hasArg(args, 'balance')) {
    return fail('新建草稿至少需要产品名称或总待还金额;如果是在补充已有草稿,请传 draftId。');
  }
  const previousDrafts = ctx.creditDrafts.map((draft) => ({ ...draft }));
  const draft = target
    ? mergeCreditDraft(target, patch, ctx.now ?? new Date())
    : createCreditDraft(patch, ctx.now ?? new Date());
  const savedId = ctx.upsertCreditDraft(draft);
  const saved = { ...draft, id: savedId };
  const index = ctx.creditDrafts.findIndex(
    (item) => item.id === savedId || (target && item.id === target.id)
  );
  if (index >= 0) ctx.creditDrafts[index] = saved;
  else ctx.creditDrafts.unshift(saved);

  const viewId = toViewId('credit-draft');
  const pending = getCreditDraftPendingFields(saved);
  return {
    content: JSON.stringify({
      ok: true,
      action: target ? 'updated' : 'created',
      draft: serializeCreditDraft(saved),
      ready: isCreditDraftReady(saved),
      pendingFields: pending
    }),
    views: [
      {
        id: viewId,
        kind: target ? 'update' : 'create',
        label: isCreditDraftReady(saved)
          ? `已暂存 ${saved.name || '信贷草稿'},字段已齐全,等待用户确认转正`
          : `已暂存 ${saved.name || '信贷草稿'}${saved.balance !== undefined ? ` 总待还 ¥${saved.balance.toFixed(2)}` : ''},还缺${pending.join('、') || '名称与金额'}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.removeCreditDraft(savedId);
          const indexToRestore = ctx.creditDrafts.findIndex(
            (item) => item.id === savedId || (target && item.id === target.id)
          );
          if (indexToRestore >= 0) ctx.creditDrafts.splice(indexToRestore, 1);
          previousDrafts.forEach((draft) => {
            ctx.upsertCreditDraft(draft);
            if (!ctx.creditDrafts.some((item) => item.id === draft.id)) {
              ctx.creditDrafts.unshift(draft);
            }
          });
        }
      }
    ]
  };
}

function executeDeleteCreditDraft(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const draftId = toText(args.draftId);
  const name = toText(args.name);
  const target = draftId
    ? ctx.creditDrafts.find((draft) => draft.id === draftId)
    : findCreditDraftForFragment(ctx.creditDrafts, { name });
  if (!target) return fail('未找到匹配的信贷草稿,请先调用 query_credit_drafts。');

  const previousDrafts = ctx.creditDrafts.map((draft) => ({ ...draft }));
  ctx.removeCreditDraft(target.id);
  const index = ctx.creditDrafts.findIndex((draft) => draft.id === target.id);
  if (index >= 0) ctx.creditDrafts.splice(index, 1);

  const viewId = toViewId('credit-draft');
  return {
    content: JSON.stringify({ ok: true, id: target.id, name: target.name || '待确认草稿' }),
    views: [
      {
        id: viewId,
        kind: 'delete',
        label: `已删除信贷草稿 ${target.name || '待确认草稿'}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          previousDrafts.forEach((draft) => {
            ctx.upsertCreditDraft(draft);
            if (!ctx.creditDrafts.some((item) => item.id === draft.id)) {
              ctx.creditDrafts.unshift(draft);
            }
          });
        }
      }
    ]
  };
}

function executePromoteCreditDraft(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const draftId = toText(args.draftId);
  const draft = ctx.creditDrafts.find((item) => item.id === draftId);
  if (!draft) return fail('未找到指定草稿,请先调用 query_credit_drafts。');
  if (args.confirm !== true) {
    return fail('转正前需要用户明确确认,请先说明草稿内容并等待确认。', {
      needsConfirmation: true,
      draft: serializeCreditDraft(draft)
    });
  }
  if (!isCreditDraftReady(draft)) {
    return fail('草稿尚未达到登记条件,请先补充名称、总待还和期数/还款日/每期金额中的至少一项。', {
      draft: serializeCreditDraft(draft),
      pendingFields: getCreditDraftPendingFields(draft)
    });
  }

  const payload = creditDraftToDebt(draft);
  const debtId = ctx.addDebt(payload);
  const created = { ...payload, id: debtId };
  ctx.debts.unshift(created);
  ctx.removeCreditDraft(draft.id);
  const draftIndex = ctx.creditDrafts.findIndex((item) => item.id === draft.id);
  if (draftIndex >= 0) ctx.creditDrafts.splice(draftIndex, 1);

  const viewId = toViewId('credit-promote');
  return {
    content: JSON.stringify({
      ok: true,
      id: debtId,
      name: created.name,
      balance: created.balance,
      removedDraftId: draft.id
    }),
    views: [
      {
        id: viewId,
        kind: 'create',
        label: `已将草稿 ${created.name} 转为正式负债 ¥${created.balance.toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.removeDebt(debtId);
          const debtIndex = ctx.debts.findIndex((item) => item.id === debtId);
          if (debtIndex >= 0) ctx.debts.splice(debtIndex, 1);
          ctx.upsertCreditDraft(draft);
          if (!ctx.creditDrafts.some((item) => item.id === draft.id)) {
            ctx.creditDrafts.unshift(draft);
          }
        }
      }
    ]
  };
}

function fail(error: string, extra: Record<string, unknown> = {}): AgentToolExecution {
  return {
    content: JSON.stringify({ ok: false, error, ...extra }),
    views: [],
    undo: []
  };
}

function nonNegative(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === null || parsed < 0) return undefined;
  return roundMoney(parsed);
}

function toRepaymentDay(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === null) return undefined;
  const day = Math.trunc(parsed);
  if (day < 1 || day > 31) return undefined;
  return day;
}

function toDebtPayload(debt: DebtItem): Omit<DebtItem, 'id'> {
  const payload: Record<string, unknown> = { ...debt };
  delete payload.id;
  return payload as unknown as Omit<DebtItem, 'id'>;
}

function repaymentAdvancesPeriod(amount: number, debt: DebtItem): boolean {
  const minimumPayment = calculateDebtMinimumPayment(debt);
  return amount >= Math.max(1, minimumPayment * 0.98);
}

function applyPeriodDelta(
  debt: DebtItem,
  delta: number
): Pick<DebtItem, 'paidPeriods' | 'remainingMonths'> {
  const paidPeriods =
    debt.totalPeriods && typeof debt.paidPeriods === 'number'
      ? Math.max(0, Math.min(debt.totalPeriods, debt.paidPeriods + delta))
      : debt.paidPeriods;
  const remainingMonths =
    typeof debt.remainingMonths === 'number'
      ? Math.max(0, debt.remainingMonths - delta)
      : debt.remainingMonths;
  return { paidPeriods, remainingMonths };
}

function executeCreateDebt(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const name = toText(args.name);
  if (!name) return fail('请提供负债名称。');
  const balance = nonNegative(args.balance);
  if (balance === undefined) return fail('剩余待还金额必须是大于等于 0 的数字。');
  const hasRepaymentAnchor =
    toRepaymentDay(args.repaymentDay) !== undefined ||
    (nonNegative(args.remainingMonths) ?? 0) > 0 ||
    (nonNegative(args.totalPeriods) ?? 0) > 0 ||
    (nonNegative(args.customMinPayment) ?? 0) > 0;
  if (!hasRepaymentAnchor) {
    return fail(
      '缺少还款锚点,暂不能创建正式负债。请先调用 save_partial_debt_draft 保存草稿,至少补充期数、还款日或每期金额中的一项。',
      {
        suggestedTool: 'save_partial_debt_draft'
      }
    );
  }

  const payload: Omit<DebtItem, 'id'> = {
    name,
    type: normalizeDebtType(args.type),
    balance,
    status: balance > 0 ? 'active' : 'settled',
    entryMode: 'standard',
    repaymentRecordMode: 'manual'
  };
  const annualRate = nonNegative(args.annualRate);
  if (annualRate !== undefined) payload.annualRate = annualRate;
  const repaymentDay = toRepaymentDay(args.repaymentDay);
  if (repaymentDay !== undefined) payload.repaymentDay = repaymentDay;
  const remainingMonths = nonNegative(args.remainingMonths);
  if (remainingMonths !== undefined) payload.remainingMonths = Math.trunc(remainingMonths);
  const totalPeriods = nonNegative(args.totalPeriods);
  if (totalPeriods !== undefined) payload.totalPeriods = Math.trunc(totalPeriods);
  const paidPeriods = nonNegative(args.paidPeriods);
  if (paidPeriods !== undefined) payload.paidPeriods = Math.trunc(paidPeriods);
  const loanPrincipal = nonNegative(args.loanPrincipal);
  if (loanPrincipal !== undefined) payload.loanPrincipal = loanPrincipal;
  const totalRepayment = nonNegative(args.totalRepayment);
  if (totalRepayment !== undefined) payload.totalRepayment = totalRepayment;
  const customMinPayment = nonNegative(args.customMinPayment);
  if (customMinPayment !== undefined) payload.customMinPayment = customMinPayment;
  const paymentAccount = toText(args.paymentAccount);
  if (paymentAccount) payload.paymentAccount = paymentAccount;

  const id = ctx.addDebt(payload);
  const created: DebtItem = { ...payload, id };
  ctx.debts.unshift(created);

  const viewId = toViewId('credit-create');
  return {
    content: JSON.stringify({ ok: true, id, name, balance }),
    views: [
      {
        id: viewId,
        kind: 'create',
        label: `已新增负债 ${name} ¥${balance.toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.removeDebt(id);
          const index = ctx.debts.findIndex((item) => item.id === id);
          if (index >= 0) ctx.debts.splice(index, 1);
        }
      }
    ]
  };
}

function executeUpdateDebt(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const { target, candidates } = findDebt(ctx, args);
  if (!target) {
    if (candidates.length > 1) {
      return { content: ambiguousContent(candidates), views: [], undo: [] };
    }
    return fail('未找到匹配的负债,请先调用 query_debts 确认名称或 id。');
  }

  const previous = { ...target };
  const next: DebtItem = { ...target };
  const newName = toText(args.newName);
  if (newName) next.name = newName;
  if (hasArg(args, 'type')) next.type = normalizeDebtType(args.type);
  if (hasArg(args, 'balance')) {
    const balance = nonNegative(args.balance);
    if (balance === undefined) return fail('剩余待还金额必须是大于等于 0 的数字。');
    next.balance = balance;
    next.status =
      balance > 0 ? (previous.status === 'settled' ? 'active' : previous.status) : 'settled';
  }
  if (hasArg(args, 'annualRate')) {
    const annualRate = nonNegative(args.annualRate);
    if (annualRate !== undefined) next.annualRate = annualRate;
  }
  if (hasArg(args, 'repaymentDay')) {
    const day = toRepaymentDay(args.repaymentDay);
    if (day !== undefined) next.repaymentDay = day;
  }
  if (hasArg(args, 'remainingMonths')) {
    const months = nonNegative(args.remainingMonths);
    if (months !== undefined) next.remainingMonths = Math.trunc(months);
  }
  if (hasArg(args, 'totalPeriods')) {
    const total = nonNegative(args.totalPeriods);
    if (total !== undefined) next.totalPeriods = Math.trunc(total);
  }
  if (hasArg(args, 'paidPeriods')) {
    const paid = nonNegative(args.paidPeriods);
    if (paid !== undefined) next.paidPeriods = Math.trunc(paid);
  }
  if (hasArg(args, 'loanPrincipal')) {
    const principal = nonNegative(args.loanPrincipal);
    if (principal !== undefined) next.loanPrincipal = principal;
  }
  if (hasArg(args, 'totalRepayment')) {
    const total = nonNegative(args.totalRepayment);
    if (total !== undefined) next.totalRepayment = total;
  }
  if (hasArg(args, 'customMinPayment')) {
    const custom = nonNegative(args.customMinPayment);
    if (custom !== undefined) next.customMinPayment = custom;
  }
  if (hasArg(args, 'paymentAccount')) {
    next.paymentAccount = toText(args.paymentAccount) || undefined;
  }

  ctx.updateDebt(target.id, toDebtPayload(next));
  const index = ctx.debts.findIndex((item) => item.id === target.id);
  if (index >= 0) ctx.debts[index] = next;

  const viewId = toViewId('credit-update');
  return {
    content: JSON.stringify({ ok: true, id: next.id, name: next.name, balance: next.balance }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已更新 ${next.name} · 剩余待还 ¥${roundMoney(next.balance).toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.updateDebt(previous.id, toDebtPayload(previous));
          const currentIndex = ctx.debts.findIndex((item) => item.id === previous.id);
          if (currentIndex >= 0) ctx.debts[currentIndex] = previous;
        }
      }
    ]
  };
}

function executeRecordRepayment(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const { target, candidates } = findDebt(ctx, args);
  if (!target) {
    if (candidates.length > 1) {
      return { content: ambiguousContent(candidates), views: [], undo: [] };
    }
    return fail('未找到匹配的负债,请先调用 query_debts 确认名称或 id。');
  }
  const amount = nonNegative(args.amount);
  if (amount === undefined || amount <= 0) return fail('还款金额必须是大于 0 的数字。');

  const paidAtRaw = toText(args.paidAt);
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(paidAtRaw) ? paidAtRaw : todayIso(ctx);
  const paymentAccount = toText(args.paymentAccount) || target.paymentAccount || undefined;
  const note = toText(args.note) || `来自 AI 信贷管家:${target.name}`;

  const recordId = ctx.addRepaymentRecord({
    debtId: target.id,
    amount,
    paidAt,
    paymentAccount,
    note,
    recordMode: 'manual'
  });
  const record: RepaymentRecord = {
    id: recordId,
    debtId: target.id,
    amount,
    paidAt,
    paymentAccount,
    note,
    recordMode: 'manual',
    createdAt: new Date().toISOString()
  };
  ctx.repaymentRecords.unshift(record);

  const previous = { ...target };
  const minimumPayment = calculateDebtMinimumPayment(target);
  const shouldAdvancePeriod = amount >= Math.max(1, minimumPayment * 0.98);
  const nextBalance = Math.max(0, roundMoney(Number(target.balance) - amount));
  const nextPaidPeriods = target.totalPeriods
    ? Math.min(target.totalPeriods, (target.paidPeriods || 0) + (shouldAdvancePeriod ? 1 : 0))
    : target.paidPeriods;
  const nextRemainingMonths =
    typeof target.remainingMonths === 'number'
      ? Math.max(0, target.remainingMonths - (shouldAdvancePeriod ? 1 : 0))
      : target.remainingMonths;
  const next: DebtItem = {
    ...target,
    balance: nextBalance,
    paidPeriods: nextPaidPeriods,
    remainingMonths: nextRemainingMonths,
    paymentAccount,
    repaymentRecordMode: 'manual',
    status: nextBalance <= 0 ? 'settled' : (target.status ?? 'active')
  };
  ctx.updateDebt(target.id, toDebtPayload(next));
  const debtIndex = ctx.debts.findIndex((item) => item.id === target.id);
  if (debtIndex >= 0) ctx.debts[debtIndex] = next;

  const viewId = toViewId('credit-repay');
  const settled = nextBalance <= 0 ? ',该笔已结清' : `,剩余待还 ¥${nextBalance.toFixed(2)}`;
  return {
    content: JSON.stringify({
      ok: true,
      id: next.id,
      name: next.name,
      amount,
      paidAt,
      balance: nextBalance
    }),
    views: [
      {
        id: viewId,
        kind: 'create',
        label: `已登记 ${next.name} 还款 ¥${amount.toFixed(2)}${settled}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.removeRepaymentRecord(recordId);
          const recordIndex = ctx.repaymentRecords.findIndex((item) => item.id === recordId);
          if (recordIndex >= 0) ctx.repaymentRecords.splice(recordIndex, 1);
          ctx.updateDebt(previous.id, toDebtPayload(previous));
          const currentIndex = ctx.debts.findIndex((item) => item.id === previous.id);
          if (currentIndex >= 0) ctx.debts[currentIndex] = previous;
        }
      }
    ]
  };
}

function executeUpdateRepaymentRecord(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const recordId = toText(args.id);
  const previous = ctx.repaymentRecords.find((record) => record.id === recordId);
  if (!previous) {
    return fail('未找到指定还款流水,请先调用 query_repayment_records 确认 id。');
  }

  const amount = hasArg(args, 'amount') ? nonNegative(args.amount) : previous.amount;
  if (amount === undefined || amount <= 0) return fail('还款金额必须是大于 0 的数字。');
  const paidAtRaw = toText(args.paidAt);
  const paidAt = hasArg(args, 'paidAt')
    ? /^\\d{4}-\\d{2}-\\d{2}$/.test(paidAtRaw)
      ? paidAtRaw
      : previous.paidAt
    : previous.paidAt;
  const paymentAccount = hasArg(args, 'paymentAccount')
    ? toText(args.paymentAccount) || undefined
    : previous.paymentAccount;
  const note = hasArg(args, 'note') ? toText(args.note) || undefined : previous.note;

  const previousDebt = ctx.debts.find((debt) => debt.id === previous.debtId);
  const previousDebtSnapshot = previousDebt ? { ...previousDebt } : null;
  const amountDelta = amount - previous.amount;
  const periodDelta = previousDebt
    ? Number(repaymentAdvancesPeriod(amount, previousDebt)) -
      Number(repaymentAdvancesPeriod(previous.amount, previousDebt))
    : 0;
  const periodPatch = previousDebt ? applyPeriodDelta(previousDebt, periodDelta) : null;
  const nextDebt = previousDebt
    ? {
        ...previousDebt,
        balance: Math.max(0, roundMoney(previousDebt.balance - amountDelta)),
        ...(periodPatch || {})
      }
    : null;

  const previousRecord = { ...previous };
  const nextRecord: RepaymentRecord = {
    ...previous,
    amount,
    paidAt,
    paymentAccount,
    note,
    createdAt: previous.createdAt
  };
  ctx.removeRepaymentRecord(previous.id);
  const savedId = ctx.addRepaymentRecord({
    ...nextRecord,
    id: previous.id,
    createdAt: previous.createdAt
  });
  const savedRecord = { ...nextRecord, id: savedId };
  const recordIndex = ctx.repaymentRecords.findIndex((record) => record.id === previous.id);
  if (recordIndex >= 0) ctx.repaymentRecords[recordIndex] = savedRecord;
  else ctx.repaymentRecords.unshift(savedRecord);

  if (nextDebt) {
    ctx.updateDebt(nextDebt.id, toDebtPayload(nextDebt));
    const debtIndex = ctx.debts.findIndex((debt) => debt.id === nextDebt.id);
    if (debtIndex >= 0) ctx.debts[debtIndex] = nextDebt;
  }

  const viewId = toViewId('credit-repay');
  return {
    content: JSON.stringify({
      ok: true,
      id: savedId,
      debtId: previous.debtId,
      amount,
      paidAt,
      balance: nextDebt?.balance ?? null
    }),
    views: [
      {
        id: viewId,
        kind: 'update',
        label: `已修改还款流水:${previous.debtId} ¥${previous.amount.toFixed(2)} → ¥${amount.toFixed(2)}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.removeRepaymentRecord(savedId);
          const currentIndex = ctx.repaymentRecords.findIndex((record) => record.id === savedId);
          if (currentIndex >= 0) ctx.repaymentRecords.splice(currentIndex, 1);
          ctx.addRepaymentRecord({
            ...previousRecord,
            id: previousRecord.id,
            createdAt: previousRecord.createdAt
          });
          if (!ctx.repaymentRecords.some((record) => record.id === previousRecord.id)) {
            ctx.repaymentRecords.unshift(previousRecord);
          }
          if (previousDebtSnapshot) {
            ctx.updateDebt(previousDebtSnapshot.id, toDebtPayload(previousDebtSnapshot));
            const previousIndex = ctx.debts.findIndex(
              (debt) => debt.id === previousDebtSnapshot.id
            );
            if (previousIndex >= 0) ctx.debts[previousIndex] = previousDebtSnapshot;
          }
        }
      }
    ]
  };
}

function executeDeleteRepaymentRecord(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const recordId = toText(args.id);
  const previous = ctx.repaymentRecords.find((record) => record.id === recordId);
  if (!previous) {
    return fail('未找到指定还款流水,请先调用 query_repayment_records 确认 id。');
  }
  if (args.confirm !== true) {
    return {
      content: JSON.stringify({
        ok: false,
        needsConfirmation: true,
        error: `删除这笔 ¥${previous.amount.toFixed(2)} 还款流水会把金额加回对应负债余额;请先向用户说明并等待确认,再传 confirm=true 重新调用。`
      }),
      views: [],
      undo: []
    };
  }

  const previousDebt = ctx.debts.find((debt) => debt.id === previous.debtId);
  const previousDebtSnapshot = previousDebt ? { ...previousDebt } : null;
  const periodDelta = previousDebt && repaymentAdvancesPeriod(previous.amount, previousDebt) ? -1 : 0;
  const periodPatch = previousDebt ? applyPeriodDelta(previousDebt, periodDelta) : null;
  const nextDebt = previousDebt
    ? {
        ...previousDebt,
        balance: Math.max(0, roundMoney(previousDebt.balance + previous.amount)),
        ...(periodPatch || {})
      }
    : null;
  const previousRecord = { ...previous };

  ctx.removeRepaymentRecord(previous.id);
  const recordIndex = ctx.repaymentRecords.findIndex((record) => record.id === previous.id);
  if (recordIndex >= 0) ctx.repaymentRecords.splice(recordIndex, 1);
  if (nextDebt) {
    ctx.updateDebt(nextDebt.id, toDebtPayload(nextDebt));
    const debtIndex = ctx.debts.findIndex((debt) => debt.id === nextDebt.id);
    if (debtIndex >= 0) ctx.debts[debtIndex] = nextDebt;
  }

  const viewId = toViewId('credit-repay');
  return {
    content: JSON.stringify({
      ok: true,
      id: previous.id,
      debtId: previous.debtId,
      amount: previous.amount,
      restoredBalance: nextDebt?.balance ?? null
    }),
    views: [
      {
        id: viewId,
        kind: 'delete',
        label: `已删除还款流水并加回 ¥${previous.amount.toFixed(2)}:${
          nextDebt?.name || previous.debtId
        }`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.addRepaymentRecord({
            ...previousRecord,
            id: previousRecord.id,
            createdAt: previousRecord.createdAt
          });
          if (!ctx.repaymentRecords.some((record) => record.id === previousRecord.id)) {
            ctx.repaymentRecords.unshift(previousRecord);
          }
          if (previousDebtSnapshot) {
            ctx.updateDebt(previousDebtSnapshot.id, toDebtPayload(previousDebtSnapshot));
            const previousIndex = ctx.debts.findIndex(
              (debt) => debt.id === previousDebtSnapshot.id
            );
            if (previousIndex >= 0) ctx.debts[previousIndex] = previousDebtSnapshot;
          }
        }
      }
    ]
  };
}

function executeDeleteDebt(
  args: Record<string, unknown>,
  ctx: CreditAgentContext
): AgentToolExecution {
  const { target, candidates } = findDebt(ctx, args);
  if (!target) {
    if (candidates.length > 1) {
      return { content: ambiguousContent(candidates), views: [], undo: [] };
    }
    return fail('未找到匹配的负债,请先调用 query_debts 确认名称或 id。');
  }
  const linked = ctx.repaymentRecords.filter((record) => record.debtId === target.id);
  if (linked.length > 0 && args.confirmLinkedRecords !== true) {
    return {
      content: JSON.stringify({
        ok: false,
        needsConfirmation: true,
        linkedRepaymentCount: linked.length,
        error: `该负债还有 ${linked.length} 笔还款流水,删除会一并移除;请先向用户说明影响并等待确认,再传 confirmLinkedRecords=true 重新调用。`
      }),
      views: [],
      undo: []
    };
  }

  const previousDebt = { ...target };
  const previousRecords = linked.map((record) => ({ ...record }));
  ctx.removeDebt(target.id);
  const debtIndex = ctx.debts.findIndex((item) => item.id === target.id);
  if (debtIndex >= 0) ctx.debts.splice(debtIndex, 1);
  previousRecords.forEach((record) => {
    ctx.removeRepaymentRecord(record.id);
    const recordIndex = ctx.repaymentRecords.findIndex((item) => item.id === record.id);
    if (recordIndex >= 0) ctx.repaymentRecords.splice(recordIndex, 1);
  });

  const viewId = toViewId('credit-delete');
  return {
    content: JSON.stringify({
      ok: true,
      id: previousDebt.id,
      name: previousDebt.name,
      removedRepaymentCount: previousRecords.length
    }),
    views: [
      {
        id: viewId,
        kind: 'delete',
        label:
          previousRecords.length > 0
            ? `已删除 ${previousDebt.name} 及其 ${previousRecords.length} 笔还款流水`
            : `已删除负债 ${previousDebt.name}`,
        undoable: true
      }
    ],
    undo: [
      {
        id: viewId,
        run: () => {
          ctx.addDebt(previousDebt);
          if (!ctx.debts.some((item) => item.id === previousDebt.id)) {
            ctx.debts.unshift(previousDebt);
          }
          previousRecords
            .slice()
            .reverse()
            .forEach((record) => {
              ctx.addRepaymentRecord(record);
              if (!ctx.repaymentRecords.some((item) => item.id === record.id)) {
                ctx.repaymentRecords.unshift(record);
              }
            });
        }
      }
    ]
  };
}

export function executeCreditToolCall(
  call: ChatToolCall,
  ctx: CreditAgentContext
): AgentToolExecution {
  const args = parseArgs(call.arguments);
  switch (call.name) {
    case 'get_repayment_snapshot':
      return executeSnapshot(ctx);
    case 'query_credit_drafts':
      return executeQueryCreditDrafts(args, ctx);
    case 'save_partial_debt_draft':
      return executeSaveCreditDraft(args, ctx);
    case 'delete_credit_draft':
      return executeDeleteCreditDraft(args, ctx);
    case 'promote_credit_draft':
      return executePromoteCreditDraft(args, ctx);
    case 'query_debts':
      return executeQueryDebts(args, ctx);
    case 'query_repayment_records':
      return executeQueryRepaymentRecords(args, ctx);
    case 'update_repayment_record':
      return executeUpdateRepaymentRecord(args, ctx);
    case 'delete_repayment_record':
      return executeDeleteRepaymentRecord(args, ctx);
    case 'create_debt':
      return executeCreateDebt(args, ctx);
    case 'update_debt':
      return executeUpdateDebt(args, ctx);
    case 'record_repayment':
      return executeRecordRepayment(args, ctx);
    case 'delete_debt':
      return executeDeleteDebt(args, ctx);
    default:
      return {
        content: JSON.stringify({ ok: false, error: `未知信贷工具:${call.name}` }),
        views: [],
        undo: []
      };
  }
}
