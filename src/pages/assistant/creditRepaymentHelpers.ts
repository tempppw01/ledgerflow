import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import type {
  CreditRepaymentGapSummary,
  CreditRepaymentLookupSummary
} from '../../features/assistant/creditAssistant/types';
import {
  parseRepaymentDay,
  REPAYMENT_AMOUNT_TOLERANCE,
  resolveRepaymentCycleWindow,
  resolveRepaymentPaidTime
} from '../../features/debt/model/repaymentCycle';

export {
  resolveRepaymentDueDisplay as resolveCreditRepaymentDueDisplay
} from '../../features/debt/model/repaymentCycle';

export interface CreditRepaymentSummaryItem {
  title: string;
  productType: string;
  dueAmount?: string;
  repaymentDate?: string;
}

type CreditRepaymentStatus =
  | 'unmatched'
  | 'partially-paid'
  | 'account-mismatch'
  | 'unpaid'
  | 'insufficient-data'
  | 'aligned';

interface CreditRepaymentAnalysis {
  matchedDebt?: DebtItem;
  relatedRecords: RepaymentRecord[];
  cycleRecords: RepaymentRecord[];
  latestRecord?: RepaymentRecord;
  paymentAccounts: string[];
  anchorDay: number | null;
  plannedAmount: number;
  recentPaidAmount: number;
  gapAmount: number;
  status: CreditRepaymentStatus;
}

function normalizeCreditIdentity(text: string): string {
  return String(text || '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\-_()【】\u005B\u005D·•：/]/g, '');
}

function findMatchingDebt(
  item: CreditRepaymentSummaryItem,
  debts: DebtItem[]
): DebtItem | undefined {
  const currentKey = normalizeCreditIdentity(`${item.title}${item.productType}`);
  return debts.find((debt) => {
    const debtKey = normalizeCreditIdentity(`${debt.name}${debt.type}`);
    return debtKey === currentKey || debtKey.includes(currentKey) || currentKey.includes(debtKey);
  });
}

function toMoneyNumber(raw?: string): number {
  const normalized = String(raw || '').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveRepaymentAnchorDay(
  item: CreditRepaymentSummaryItem,
  matchedDebt?: DebtItem
): number | null {
  const debtDay = matchedDebt?.repaymentDay;
  if (typeof debtDay === 'number' && Number.isInteger(debtDay) && debtDay >= 1 && debtDay <= 31) {
    return debtDay;
  }
  return parseRepaymentDay(matchedDebt?.simpleDueDate) ?? parseRepaymentDay(item.repaymentDate);
}

function formatGapMoney(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return `¥${rounded.toFixed(2).replace(/\.00$/, '')}`;
}

function analyzeCreditRepayment(
  item: CreditRepaymentSummaryItem,
  debts: DebtItem[],
  repaymentRecords: RepaymentRecord[]
): CreditRepaymentAnalysis {
  const matchedDebt = findMatchingDebt(item, debts);
  const relatedRecords = repaymentRecords
    .filter((record) => (matchedDebt ? record.debtId === matchedDebt.id : false))
    .sort((a, b) => `${b.paidAt}-${b.amount}`.localeCompare(`${a.paidAt}-${a.amount}`, 'zh-CN'));

  const anchorDay = resolveRepaymentAnchorDay(item, matchedDebt);
  const cycleWindow = resolveRepaymentCycleWindow(anchorDay, new Date());
  const cycleRecords = relatedRecords.filter((record) => {
    const paidTime = resolveRepaymentPaidTime(record.paidAt);
    if (paidTime === null) {
      return false;
    }
    return paidTime >= cycleWindow.start.getTime() && paidTime <= cycleWindow.end.getTime();
  });
  const scopedRecords = cycleRecords.length > 0 ? cycleRecords : relatedRecords.slice(0, 3);

  const latestRecord = scopedRecords[0];
  const paymentAccounts = Array.from(
    new Set(
      scopedRecords.map((record) => String(record.paymentAccount || '').trim()).filter(Boolean)
    )
  );
  const plannedAmount =
    toMoneyNumber(item.dueAmount) || (matchedDebt ? Number(matchedDebt.customMinPayment || 0) : 0);
  const recentPaidAmount = cycleRecords.reduce(
    (sum, record) => sum + Number(record.amount || 0),
    0
  );
  const gapAmount = Math.max(0, plannedAmount - recentPaidAmount);

  const hasAccountMismatch = Boolean(
    matchedDebt?.paymentAccount &&
    cycleRecords.length > 0 &&
    paymentAccounts.length > 0 &&
    !paymentAccounts.includes(matchedDebt.paymentAccount)
  );

  const alignedTolerance = REPAYMENT_AMOUNT_TOLERANCE;
  let status: CreditRepaymentStatus;
  if (!matchedDebt) {
    status = 'unmatched';
  } else if (hasAccountMismatch) {
    status = 'account-mismatch';
  } else if (plannedAmount <= 0) {
    // Without a known planned amount we cannot honestly claim alignment.
    status = 'insufficient-data';
  } else if (recentPaidAmount <= 0) {
    status = 'unpaid';
  } else if (plannedAmount - recentPaidAmount > alignedTolerance) {
    status = 'partially-paid';
  } else {
    status = 'aligned';
  }

  return {
    matchedDebt,
    relatedRecords,
    cycleRecords,
    latestRecord,
    paymentAccounts,
    anchorDay,
    plannedAmount,
    recentPaidAmount,
    gapAmount,
    status
  };
}

function buildStatusText(status: CreditRepaymentStatus): string {
  switch (status) {
    case 'unmatched':
      return '未匹配';
    case 'partially-paid':
      return '部分已还';
    case 'account-mismatch':
      return '账户不一致';
    case 'unpaid':
      return '本期未还';
    case 'insufficient-data':
      return '待确认';
    case 'aligned':
      return '基本对齐';
    default:
      return '待确认';
  }
}

function buildLookupHint(status: CreditRepaymentStatus, analysis: CreditRepaymentAnalysis): string {
  switch (status) {
    case 'unmatched':
      return analysis.matchedDebt
        ? '已找到计划负债，但最近没有稳定命中还款流水；如果实际已还，建议补录记录或核对时间范围。'
        : '当前还没稳定串起已保存负债和还款流水，建议补充产品名、应还金额或还款日作为锚点。';
    case 'partially-paid':
      return '已看到部分还款，但计划应还与最近已还还没完全对齐，建议继续核对是否还有待补录流水。';
    case 'account-mismatch':
      return '计划扣款账户与最近还款账户不一致，优先确认是否换卡扣款、代扣账户变化或记录归属错误。';
    case 'unpaid':
      return '计划应还金额已经明确，但当前还款周期内还没有命中还款流水；如果实际已还，建议补录记录或核对还款日期。';
    case 'insufficient-data':
      return '已经找到对应负债，但计划应还金额还不够明确，建议先补全本期应还金额，再判断是否对齐。';
    case 'aligned':
      return '计划应还、本周期还款和账户信息基本能对上，可直接继续核对剩余细节。';
    default:
      return '待进一步确认。';
  }
}

function buildGapReason(status: CreditRepaymentStatus, analysis: CreditRepaymentAnalysis): string {
  switch (status) {
    case 'unmatched':
      return analysis.matchedDebt
        ? '计划里有应还，但流水侧暂未形成稳定匹配。'
        : analysis.recentPaidAmount > 0
          ? '已有还款流水，但当前还没稳定命中对应负债。'
          : '计划和流水两侧都还缺足够锚点，暂时无法稳定匹配。';
    case 'partially-paid':
      return '当前更像“部分已还”，最近已还金额仍低于计划应还，可能还有待补录或未匹配的还款。';
    case 'account-mismatch':
      return analysis.matchedDebt?.paymentAccount
        ? `计划账户是“${analysis.matchedDebt.paymentAccount}”，但最近还款来自“${analysis.paymentAccounts.join(' / ')}”。`
        : '计划账户与最近还款账户暂未对齐。';
    case 'unpaid':
      return '当前还款周期内还没有命中还款流水，计划应还暂未看到对应还款。';
    case 'insufficient-data':
      return '计划应还金额暂未明确，当前无法判断是否已经对齐。';
    case 'aligned':
      return '计划应还、本周期已还和账户信息基本一致，当前没有明显缺口。';
    default:
      return '待进一步确认。';
  }
}

function buildGapExplanationItems(
  status: CreditRepaymentStatus,
  analysis: CreditRepaymentAnalysis
): string[] {
  const items: string[] = [];

  if (analysis.plannedAmount > 0) {
    items.push(`计划应还 ${formatGapMoney(analysis.plannedAmount)}`);
  } else {
    items.push('计划应还暂未稳定识别');
  }

  if (analysis.recentPaidAmount > 0) {
    items.push(`本周期已还 ${formatGapMoney(analysis.recentPaidAmount)}`);
  } else {
    items.push('本周期未命中还款流水');
  }

  if (analysis.gapAmount > 0) {
    items.push(`当前缺口 ${formatGapMoney(analysis.gapAmount)}`);
  } else {
    items.push('当前金额缺口不明显');
  }

  if (analysis.matchedDebt?.paymentAccount) {
    items.push(`计划账户 ${analysis.matchedDebt.paymentAccount}`);
  }

  if (analysis.paymentAccounts.length > 0) {
    items.push(`实际还款账户 ${analysis.paymentAccounts.join(' / ')}`);
  }

  if (status === 'unmatched' && !analysis.matchedDebt) {
    items.push('还没稳定命中对应负债对象');
  }

  if (status === 'account-mismatch') {
    items.push('账户侧存在不一致，需要优先核对');
  }

  if (status === 'insufficient-data') {
    items.push('计划应还金额不足，暂时不能判断是否对齐');
  }

  if (status === 'unpaid') {
    items.push('本周期暂未命中还款流水');
  }

  return items;
}

function buildShortfallAction(
  status: CreditRepaymentStatus,
  analysis: CreditRepaymentAnalysis
): string {
  switch (status) {
    case 'unmatched':
      return analysis.matchedDebt
        ? '建议先补录还款流水，或核对最近还款日期范围。'
        : '建议补充产品名、应还金额或还款日，先把负债和流水串起来。';
    case 'partially-paid':
      return analysis.gapAmount > 0
        ? `建议优先核对是否还有 ${formatGapMoney(analysis.gapAmount)} 未录入，或是否存在分笔还款。`
        : '建议核对最近是否还有未同步到账的还款记录。';
    case 'account-mismatch':
      return '建议先确认是否换卡扣款、代扣账户变更，或流水归属到错了负债。';
    case 'unpaid':
      return '建议补录本期还款流水，或核对扣款日期是否已经过去。';
    case 'insufficient-data':
      return '建议先补全本期应还金额，再核对是否已经还款。';
    case 'aligned':
      return '当前缺口不明显，可继续确认期数、利率和剩余成本等细节。';
    default:
      return '建议继续补充关键信息后再判断。';
  }
}

export function buildCreditRepaymentLookupSummary(
  item: CreditRepaymentSummaryItem,
  debts: DebtItem[],
  repaymentRecords: RepaymentRecord[]
): CreditRepaymentLookupSummary | undefined {
  const analysis = analyzeCreditRepayment(item, debts, repaymentRecords);
  const { matchedDebt, latestRecord, paymentAccounts, relatedRecords, status } = analysis;

  const plannedRepaymentText = matchedDebt
    ? [
        matchedDebt.repaymentDay ? `每月${matchedDebt.repaymentDay}日` : '',
        item.dueAmount ? `本期约${item.dueAmount}` : '',
        matchedDebt.remainingMonths ? `剩余${matchedDebt.remainingMonths}期` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : item.repaymentDate || item.dueAmount
      ? [item.repaymentDate || '', item.dueAmount ? `本期约${item.dueAmount}` : '']
          .filter(Boolean)
          .join(' · ')
      : undefined;

  const paymentAccountText = matchedDebt?.paymentAccount
    ? paymentAccounts.length > 0 && !paymentAccounts.includes(matchedDebt.paymentAccount)
      ? `${matchedDebt.paymentAccount}（计划） / ${paymentAccounts.join(' / ')}（实际）`
      : matchedDebt.paymentAccount
    : paymentAccounts.length > 0
      ? paymentAccounts.join(' / ')
      : undefined;

  const actualRepaymentText = latestRecord
    ? `${formatGapMoney(Number(latestRecord.amount || 0))} · ${String(latestRecord.paidAt || '').slice(0, 10) || '日期待确认'}`
    : undefined;

  if (!matchedDebt && relatedRecords.length === 0 && !plannedRepaymentText && !paymentAccountText) {
    return undefined;
  }

  return {
    matchedDebtName: matchedDebt?.name,
    plannedRepaymentText,
    paymentAccountText,
    actualRepaymentText,
    recordStatusText: buildStatusText(status),
    lookupHint: buildLookupHint(status, analysis)
  };
}

export function buildCreditRepaymentGapSummary(
  item: CreditRepaymentSummaryItem,
  debts: DebtItem[],
  repaymentRecords: RepaymentRecord[]
): CreditRepaymentGapSummary | undefined {
  const analysis = analyzeCreditRepayment(item, debts, repaymentRecords);
  const { matchedDebt, paymentAccounts, plannedAmount, recentPaidAmount, gapAmount, status } =
    analysis;

  if (plannedAmount <= 0 && recentPaidAmount <= 0 && !matchedDebt) {
    return undefined;
  }

  return {
    plannedDueAmount: plannedAmount > 0 ? formatGapMoney(plannedAmount) : undefined,
    recentActualPaidAmount: recentPaidAmount > 0 ? formatGapMoney(recentPaidAmount) : undefined,
    gapAmount: gapAmount > 0 ? formatGapMoney(gapAmount) : '0',
    gapReason: buildGapReason(status, analysis),
    paymentAccountSummary:
      paymentAccounts.length > 0
        ? paymentAccounts.join(' / ')
        : matchedDebt?.paymentAccount || undefined,
    statusText: buildStatusText(status),
    shortfallAction: buildShortfallAction(status, analysis),
    explanationItems: buildGapExplanationItems(status, analysis)
  };
}
