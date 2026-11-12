import type { DebtItem, DebtType } from './debtMetrics';
import {
  inferCreditDebtType,
  normalizeCreditIdentity
} from '../../assistant/creditAssistant/debtClassification';

/**
 * 信贷草稿只保存用户明确给出的事实，不能因为字段缺失而提前创建正式负债。
 * `sourceTurns` 用来显示信息由几轮对话逐步补全。
 */
export interface CreditDraft {
  id: string;
  identityKey: string;
  name?: string;
  type?: DebtType;
  balance?: number;
  dueAmount?: number;
  annualRate?: number;
  repaymentDay?: number;
  remainingMonths?: number;
  totalPeriods?: number;
  paidPeriods?: number;
  monthlyAmount?: number;
  paymentAccount?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  sourceTurns: number;
}

export type CreditDraftPatch = Partial<CreditDraft>;

const CREDIT_DRAFT_FIELDS: Array<{ key: keyof CreditDraft; label: string; required?: boolean }> = [
  { key: 'name', label: '产品名称', required: true },
  { key: 'balance', label: '总待还', required: true },
  { key: 'remainingMonths', label: '剩余期数' },
  { key: 'totalPeriods', label: '总期数' },
  { key: 'repaymentDay', label: '还款日' },
  { key: 'monthlyAmount', label: '每期金额' },
  { key: 'annualRate', label: '年化利率' },
  { key: 'paymentAccount', label: '还款账户' }
];

export function getCreditDraftPendingFields(draft: CreditDraft): string[] {
  return CREDIT_DRAFT_FIELDS.filter(({ key, required }) => {
    const value = draft[key];
    if (required)
      return value === undefined || value === '' || (typeof value === 'number' && value <= 0);
    return value === undefined || value === '';
  }).map(({ label }) => label);
}

/**
 * 只有名称、待还金额和一个还款安排锚点（期数/还款日/每期金额）齐全时，
 * 才允许从草稿转为正式负债。
 */
export function isCreditDraftReady(draft: CreditDraft): boolean {
  return Boolean(
    draft.name &&
      typeof draft.balance === 'number' &&
      draft.balance > 0 &&
      (typeof draft.remainingMonths === 'number' ||
        typeof draft.totalPeriods === 'number' ||
        typeof draft.repaymentDay === 'number' ||
        typeof draft.monthlyAmount === 'number')
  );
}

function positiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : undefined;
}

function integerPositive(value: unknown): number | undefined {
  const parsed = positiveNumber(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function repaymentDay(value: unknown): number | undefined {
  const parsed = integerPositive(value);
  return parsed !== undefined && parsed <= 31 ? parsed : undefined;
}

function cleanName(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^(?:我(?:的)?|有|还有|一笔|一个|一张)\s*/, '')
    .replace(/^(?:总)?欠款金额|总欠款|总待还|剩余待还|当前欠款|欠款|余额|金额\s*[:：]?/i, '')
    .replace(/^(?:为|是)\s*/, '')
    .trim();
}

export function inferCreditDraftType(name?: string, type?: DebtType): DebtType {
  return type || inferCreditDebtType(name);
}

export function createCreditDraft(patch: CreditDraftPatch, now = new Date()): CreditDraft {
  const name = cleanName(patch.name);
  const nowIso = now.toISOString();
  const draft: CreditDraft = {
    id: patch.id || `credit-draft-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    identityKey: patch.identityKey || normalizeCreditIdentity(name),
    createdAt: patch.createdAt || nowIso,
    updatedAt: patch.updatedAt || nowIso,
    sourceTurns: patch.sourceTurns ?? 1
  };
  if (name) draft.name = name;
  if (patch.type) draft.type = inferCreditDraftType(name, patch.type);
  const balance = positiveNumber(patch.balance);
  if (balance !== undefined) draft.balance = balance;
  const dueAmount = positiveNumber(patch.dueAmount);
  if (dueAmount !== undefined) draft.dueAmount = dueAmount;
  const annualRate = positiveNumber(patch.annualRate);
  if (annualRate !== undefined) draft.annualRate = annualRate;
  const recurrence = repaymentDay(patch.repaymentDay);
  if (recurrence !== undefined) draft.repaymentDay = recurrence;
  const remainingMonths = integerPositive(patch.remainingMonths);
  if (remainingMonths !== undefined) draft.remainingMonths = remainingMonths;
  const totalPeriods = integerPositive(patch.totalPeriods);
  if (totalPeriods !== undefined) draft.totalPeriods = totalPeriods;
  const paidPeriods = integerPositive(patch.paidPeriods);
  if (paidPeriods !== undefined) draft.paidPeriods = paidPeriods;
  const monthlyAmount = positiveNumber(patch.monthlyAmount);
  if (monthlyAmount !== undefined) draft.monthlyAmount = monthlyAmount;
  const paymentAccount = String(patch.paymentAccount || '').trim();
  if (paymentAccount) draft.paymentAccount = paymentAccount;
  const note = String(patch.note || '').trim();
  if (note) draft.note = note;
  if (!draft.identityKey && draft.name) {
    draft.identityKey = normalizeCreditIdentity(draft.name);
  }
  return draft;
}

function sameDraftIdentity(left: CreditDraft, rightName?: string): boolean {
  const rightKey = normalizeCreditIdentity(rightName || '');
  if (!rightKey || !left.identityKey) return false;
  return left.identityKey === rightKey || left.identityKey.includes(rightKey) || rightKey.includes(left.identityKey);
}

export function findCreditDraftForFragment(
  drafts: CreditDraft[],
  fragment: CreditDraftPatch
): CreditDraft | undefined {
  const name = cleanName(fragment.name);
  if (name) {
    const matched = drafts.filter((draft) => sameDraftIdentity(draft, name));
    if (matched.length === 1) return matched[0];
    if (matched.length > 1) return undefined;
  }
  // 后续只补充期数/还款日等片段时，单个活动草稿可以承接；多草稿必须由模型指定 id。
  return drafts.length === 1 && !fragment.name ? drafts[0] : undefined;
}

export function mergeCreditDraft(
  current: CreditDraft,
  patch: CreditDraftPatch,
  now = new Date()
): CreditDraft {
  const next: CreditDraft = { ...current, updatedAt: now.toISOString() };
  const name = cleanName(patch.name);
  if (name) {
    next.name = name;
    next.identityKey = normalizeCreditIdentity(name);
    next.type = inferCreditDraftType(name, patch.type || current.type);
  } else if (patch.type) {
    next.type = inferCreditDraftType(current.name, patch.type);
  }

  const assignments: Array<[keyof CreditDraft, number | undefined]> = [
    ['balance', positiveNumber(patch.balance)],
    ['dueAmount', positiveNumber(patch.dueAmount)],
    ['annualRate', positiveNumber(patch.annualRate)],
    ['repaymentDay', repaymentDay(patch.repaymentDay)],
    ['remainingMonths', integerPositive(patch.remainingMonths)],
    ['totalPeriods', integerPositive(patch.totalPeriods)],
    ['paidPeriods', integerPositive(patch.paidPeriods)],
    ['monthlyAmount', positiveNumber(patch.monthlyAmount)]
  ];
  assignments.forEach(([key, value]) => {
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  });

  const paymentAccount = String(patch.paymentAccount || '').trim();
  if (paymentAccount) next.paymentAccount = paymentAccount;
  const note = String(patch.note || '').trim();
  if (note) next.note = note;
  next.sourceTurns = Math.max(1, Number(current.sourceTurns || 0) + 1);
  return next;
}

function extractAmount(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 解析口语化片段。只有明确的信贷词或金额上下文才会返回片段，避免普通分析
 * 对话被误当成负债录入。
 */
export function parseCreditDraftFragment(text: string): CreditDraftPatch | null {
  const source = String(text || '').trim();
  if (
    !source ||
    !/(欠|未还|还款|分期|白条|花呗|借呗|微粒贷|度小满|有钱花|安逸花|招联金融|360借条|装修贷|京东金融|京东金条|抖音月付|抖音放心借|美团借钱|平安普惠|信用卡|贷款|借款|账单|[0-9一二三四五六七八九十]+\s*期|每月|月供|每期|年化利率|还款日|扣款日)/i.test(
      source
    )
  ) {
    return null;
  }

  const nameMatch = source.match(
    /((?:京东白条|支付宝花呗|微信分付|美团月付|分期乐|花呗|白条|借呗|房贷|车贷|消费贷|信用贷|现金贷|信用卡|贷款|分期)|([\u4e00-\u9fa5]{2,12}银行)(?:信用卡|贷记卡|信用贷|消费贷|分期|贷款)?)/
  );
  const name = cleanName(nameMatch?.[0] || '');
  const aliasName = cleanName(
    source.match(
      /京东金融|京东金条|抖音月付|抖音放心借|美团借钱|平安普惠|微粒贷|度小满|有钱花|安逸花|招联金融|360借条|装修贷/
    )?.[0] || ''
  );
  const patch: CreditDraftPatch = {};
  const resolvedName = name || aliasName;
  if (resolvedName) {
    patch.name = resolvedName;
    patch.type = inferCreditDebtType(resolvedName);
  }

  const balance = extractAmount(
    source,
    /(?:总欠款|总待还|剩余待还|当前欠款|欠款|欠)\s*(?:金额)?\s*(?:为|是|[:：])?\s*[¥￥]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/i
  );
  if (balance !== undefined) patch.balance = balance;
  if (patch.balance === undefined) {
    const aliasBalance = extractAmount(
      source,
      /(?:还欠|未还|欠(?:了)?|剩余本金|账单金额|总共欠|一共欠)\s*(?:金额)?\s*(?:为|是|还有|了|[:：])?\s*[¥￥]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/i
    );
    if (aliasBalance !== undefined) patch.balance = aliasBalance;
  }

  const dueAmount = extractAmount(
    source,
    /(?:本期应还|当前应还|应还)\s*(?:金额)?\s*(?:为|是|[:：])?\s*[¥￥]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/i
  );
  if (dueAmount !== undefined) patch.dueAmount = dueAmount;
  if (patch.dueAmount === undefined) {
    const aliasDue = extractAmount(
      source,
      /(?:这个月应还|这期应还|本期账单|最低还款(?:额)?|账单应还)\s*(?:金额)?\s*(?:为|是|[:：])?\s*[¥￥]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/i
    );
    if (aliasDue !== undefined) patch.dueAmount = aliasDue;
  }

  const periods = extractAmount(source, /(?<!总共)(?:剩余|还有|还剩)?\s*([0-9]+)\s*期(?:数)?/i);
  if (periods !== undefined) patch.remainingMonths = periods;
  const totalPeriods = extractAmount(source, /(?:总期数|共|一共|总共)\s*([0-9]+)\s*期/i);
  if (totalPeriods !== undefined) patch.totalPeriods = totalPeriods;
  if (patch.totalPeriods === undefined) {
    const installmentPeriods = extractAmount(source, /(?:分)\s*([0-9]+)\s*期/i);
    if (installmentPeriods !== undefined) patch.totalPeriods = installmentPeriods;
  }
  const repaymentDay = extractAmount(source, /(?:还款日|扣款日)\s*(?:为|是|[:：])?\s*([0-9]{1,2})/i);
  if (repaymentDay !== undefined && repaymentDay <= 31) patch.repaymentDay = repaymentDay;
  const monthlyRepaymentDay = extractAmount(
    source,
    /(?:每月|每个月)\s*([0-9]{1,2})\s*号(?:还款|扣款)?/i
  );
  if (monthlyRepaymentDay !== undefined && monthlyRepaymentDay <= 31) {
    patch.repaymentDay = monthlyRepaymentDay;
  }
  if (patch.repaymentDay === undefined) {
    const dayText = extractAmount(source, /(?:每月|每个月)\s*([0-9]{1,2})\s*[日号]/i);
    if (dayText !== undefined && dayText <= 31) patch.repaymentDay = dayText;
  }
  const monthlyAmount = extractAmount(
    source,
    /(?:每期|月供|每月)\s*(?![0-9]{1,2}\s*号)(?:还|应还|还款|金额)?\s*(?:为|是|[:：])?\s*[¥￥]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/i
  );
  if (monthlyAmount !== undefined) patch.monthlyAmount = monthlyAmount;
  if (patch.monthlyAmount === undefined) {
    const aliasMonthly = extractAmount(
      source,
      /(?:一个月|分期)\s*(?:还|应还|还款|金额)?\s*(?:为|是|[:：])?\s*[¥￥]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/i
    );
    if (aliasMonthly !== undefined) patch.monthlyAmount = aliasMonthly;
  }
  const annualRate = extractAmount(
    source,
    /(?:年化利率|年利率|年费率|利率)\s*(?:为|是|[:：])?\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i
  );
  if (annualRate !== undefined) patch.annualRate = annualRate;

  const paymentAccount = source.match(/(?:从|由|用)\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,20})\s*(?:还款|扣款|支付)/);
  if (paymentAccount) patch.paymentAccount = paymentAccount[1].trim();

  if (!patch.name && Object.keys(patch).length === 0) return null;
  return patch;
}

export function upsertCreditDraft(
  drafts: CreditDraft[],
  patch: CreditDraftPatch,
  now = new Date()
): { drafts: CreditDraft[]; draft: CreditDraft; matched: boolean } {
  const existing = findCreditDraftForFragment(drafts, patch);
  if (existing) {
    const merged = mergeCreditDraft(existing, patch, now);
    return {
      drafts: drafts.map((draft) => (draft.id === existing.id ? merged : draft)),
      draft: merged,
      matched: true
    };
  }

  const draft = createCreditDraft(patch, now);
  if (!draft.name && draft.balance === undefined) {
    return { drafts, draft, matched: false };
  }
  return { drafts: [draft, ...drafts], draft, matched: false };
}

export function creditDraftToExtractedItem(draft: CreditDraft): {
  id: string;
  title: string;
  productType: string;
  totalDebt?: string;
  dueAmount?: string;
  repaymentDate?: string;
  remainingPeriods?: string;
  monthlyAmount?: string;
  interest?: string;
  pendingFields: string[];
  confidence: 'high' | 'medium' | 'low';
  draftCreditId: string;
} {
  return {
    id: `credit-draft-${draft.id}`,
    title: draft.name || '待确认信贷项目',
    productType: draft.type === 'loan' ? '贷款' : draft.type === 'consumer-loan' ? '消费贷' : '信用卡',
    totalDebt: draft.balance !== undefined ? String(draft.balance) : undefined,
    dueAmount: draft.dueAmount !== undefined ? String(draft.dueAmount) : undefined,
    repaymentDate: draft.repaymentDay !== undefined ? String(draft.repaymentDay) : undefined,
    remainingPeriods:
      draft.remainingMonths !== undefined
        ? String(draft.remainingMonths)
        : draft.totalPeriods !== undefined
          ? String(draft.totalPeriods)
          : undefined,
    monthlyAmount: draft.monthlyAmount !== undefined ? String(draft.monthlyAmount) : undefined,
    interest: draft.annualRate !== undefined ? `${draft.annualRate}%` : undefined,
    pendingFields: getCreditDraftPendingFields(draft),
    confidence: isCreditDraftReady(draft) ? 'medium' : 'low',
    draftCreditId: draft.id
  };
}

export function creditDraftToDebt(draft: CreditDraft): Omit<DebtItem, 'id'> {
  return {
    name: draft.name || '待确认负债',
    type: inferCreditDraftType(draft.name, draft.type),
    balance: draft.balance || 0,
    annualRate: draft.annualRate,
    repaymentDay: draft.repaymentDay,
    remainingMonths: draft.remainingMonths,
    totalPeriods: draft.totalPeriods,
    paidPeriods: draft.paidPeriods,
    customMinPayment: draft.monthlyAmount,
    paymentAccount: draft.paymentAccount,
    repaymentMethod:
      draft.remainingMonths || draft.totalPeriods ? 'equal-installment' : 'minimum-payment',
    repaymentRecordMode: 'manual',
    status: 'active',
    entryMode: 'standard'
  };
}

export function buildCreditDraftPromptContext(drafts: CreditDraft[]): string {
  if (!drafts.length) return '';
  const lines = drafts.map((draft) => {
    const pending = getCreditDraftPendingFields(draft);
    const fields = [
      draft.name ? `名称=${draft.name}` : '',
      draft.balance !== undefined ? `总待还=${draft.balance}` : '',
      draft.remainingMonths !== undefined ? `剩余期数=${draft.remainingMonths}` : '',
      draft.totalPeriods !== undefined ? `总期数=${draft.totalPeriods}` : '',
      draft.repaymentDay !== undefined ? `还款日=${draft.repaymentDay}` : '',
      draft.monthlyAmount !== undefined ? `每期金额=${draft.monthlyAmount}` : '',
      draft.annualRate !== undefined ? `年化利率=${draft.annualRate}%` : ''
    ].filter(Boolean).join(';');
    return `- ${draft.id}: ${fields || '仅身份信息'} | 缺少:${pending.join('、') || '无'} | ${
      isCreditDraftReady(draft) ? '可登记正式负债' : '仅草稿,禁止提前创建正式负债'
    }`;
  });
  return [
    '信贷草稿上下文(跨轮已保存,用户当前消息提到同一产品时优先合并已有草稿):',
    ...lines,
    '规则:用户补充字段时调用 save_partial_debt_draft 并传 draftId;字段未齐只能保存草稿,不得编造期数、还款日或金额。当前用户消息与草稿冲突时,当前消息优先,必须更新草稿而不是用历史值覆盖。'
  ].join('\n');
}
