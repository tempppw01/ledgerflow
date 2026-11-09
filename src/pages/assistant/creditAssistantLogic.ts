import type { DebtItem, RepaymentRecord } from '../../features/debt/model/debtMetrics';
import {
  buildCreditRepaymentGapSummary,
  buildCreditRepaymentLookupSummary
} from './creditRepaymentHelpers';
import type {
  CreditConflictField,
  CreditExtractedItem,
  CreditFieldMeta,
  CreditFieldSource,
  CreditFieldStatus
} from '../../features/assistant/creditAssistant/types';

export interface CreditHistoryLikeItem {
  role: 'user' | 'assistant';
  creditItems?: CreditExtractedItem[];
}

function normalizeCreditIdentity(text: string): string {
  return text.replace(/\s+/g, '').replace(/[（）()\-·:：]/g, '').toLowerCase();
}

export function countCompletedCreditFields(item: CreditExtractedItem): number {
  return [
    item.title,
    item.dueAmount,
    item.totalDebt,
    item.repaymentDate,
    item.monthlyAmount,
    item.rateType || item.interest
  ].filter((value) => String(value || '').trim()).length;
}

function mergeCreditItemPair(base: CreditExtractedItem, incoming: CreditExtractedItem): CreditExtractedItem {
  const pendingFields = Array.from(new Set([...(base.pendingFields || []), ...(incoming.pendingFields || [])])).filter(
    (field) => {
      if (field === '当前应还' && (incoming.dueAmount || base.dueAmount)) return false;
      if (field === '剩余待还' && (incoming.totalDebt || base.totalDebt)) return false;
      if (field === '还款日' && (incoming.repaymentDate || base.repaymentDate)) return false;
      if (field === '每期金额' && (incoming.monthlyAmount || base.monthlyAmount)) return false;
      return true;
    }
  );

  return {
    ...base,
    ...incoming,
    title: incoming.title || base.title,
    productType: incoming.productType || base.productType,
    dueAmount: incoming.dueAmount || base.dueAmount,
    totalDebt: incoming.totalDebt || base.totalDebt,
    repaymentDate: incoming.repaymentDate || base.repaymentDate,
    remainingPeriods: incoming.remainingPeriods || base.remainingPeriods,
    monthlyAmount: incoming.monthlyAmount || base.monthlyAmount,
    interest: incoming.interest || base.interest,
    rateType: incoming.rateType || base.rateType,
    rateSource: incoming.rateSource || base.rateSource,
    riskHint: incoming.riskHint || base.riskHint,
    actionSuggestion: incoming.actionSuggestion || base.actionSuggestion,
    confirmationState: incoming.confirmationState || base.confirmationState,
    confirmationSummary: incoming.confirmationSummary || base.confirmationSummary,
    conflictHint: incoming.conflictHint || base.conflictHint,
    repaymentGapSummary: incoming.repaymentGapSummary || base.repaymentGapSummary,
    pendingFields,
    draftCreditId: incoming.draftCreditId || base.draftCreditId,
    matchReason: incoming.matchReason || base.matchReason,
    lastConfirmedFields: Array.from(
      new Set([...(base.lastConfirmedFields || []), ...(incoming.lastConfirmedFields || [])])
    ),
    lastMissingFields: Array.from(
      new Set([...(incoming.lastMissingFields || []), ...(base.lastMissingFields || [])])
    ),
    mergedFromTurns: Array.from(
      new Set([...(base.mergedFromTurns || []), ...(incoming.mergedFromTurns || [])])
    ).sort((a, b) => a - b),
    recommendedNextFields: incoming.recommendedNextFields || base.recommendedNextFields,
    bindingProgressText: incoming.bindingProgressText || base.bindingProgressText,
    mergedFromHistory: base.mergedFromHistory || incoming.mergedFromHistory,
    confidence:
      incoming.confidence === 'high' || base.confidence === 'high'
        ? 'high'
        : incoming.confidence === 'medium' || base.confidence === 'medium'
          ? 'medium'
          : 'low'
  };
}

export function dedupeCreditItems(items: CreditExtractedItem[]): CreditExtractedItem[] {
  if (items.length <= 1) return items;

  const merged = new Map<string, CreditExtractedItem>();
  items.forEach((item, index) => {
    const identityKey = normalizeCreditIdentity(`${item.title}${item.productType}`) || `credit-item-${index}`;
    const nextItem = { ...item, identityKey };
    const existing = merged.get(identityKey);
    if (!existing) {
      merged.set(identityKey, nextItem);
      return;
    }
    merged.set(identityKey, mergeCreditItemPair(existing, nextItem));
  });

  return Array.from(merged.values());
}

export function mergeCreditItemsWithHistory(
  currentItems: CreditExtractedItem[],
  history: CreditHistoryLikeItem[]
): CreditExtractedItem[] {
  if (currentItems.length === 0) return currentItems;

  const previousItems = dedupeCreditItems(
    [...history]
      .reverse()
      .filter((item) => item.role === 'assistant' && Array.isArray(item.creditItems) && item.creditItems.length > 0)
      .flatMap((item) => item.creditItems || [])
      .slice(0, 8)
  );

  const mergedCurrentItems = currentItems.map((item) => {
    const currentKey = normalizeCreditIdentity(`${item.title}${item.productType}`);
    const matched = previousItems.find((prev) => {
      const prevKey = normalizeCreditIdentity(`${prev.title}${prev.productType}`);
      return prevKey === currentKey || prevKey.includes(currentKey) || currentKey.includes(prevKey);
    });
    if (!matched) return item;

    return {
      ...mergeCreditItemPair(matched, item),
      mergedFromHistory: true
    };
  });

  return dedupeCreditItems(mergedCurrentItems);
}

function findMatchingDebt(item: CreditExtractedItem, debts: DebtItem[]): DebtItem | undefined {
  const currentKey = normalizeCreditIdentity(`${item.title}${item.productType}`);
  const currentNameKey = normalizeCreditIdentity(item.title);
  return debts.find((debt) => {
    const debtKey = normalizeCreditIdentity(`${debt.name}${debt.type}`);
    const debtNameKey = normalizeCreditIdentity(debt.name);
    return (
      debtNameKey === currentNameKey ||
      debtNameKey.includes(currentNameKey) ||
      currentNameKey.includes(debtNameKey) ||
      debtKey === currentKey ||
      debtKey.includes(currentKey) ||
      currentKey.includes(debtKey)
    );
  });
}

function formatDebtCompareValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '未填写';
  return String(value);
}

function normalizeCreditDebtPayload(item: CreditExtractedItem): Omit<DebtItem, 'id'> {
  const extractNumberText = (value?: string) => {
    if (!value) return '';
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? match[0] : '';
  };

  const extractDayText = (value?: string) => {
    if (!value) return '';
    const match = value.match(/(\d{1,2})(?:日|号)?/);
    return match ? match[1] : '';
  };

  const normalizedTypeText = `${item.productType} ${item.title}`;
  const type: 'credit-card' | 'consumer-loan' | 'loan' = /房贷|车贷|按揭|贷款/i.test(normalizedTypeText)
    ? 'loan'
    : /花呗|白条|分期|消费贷|借呗|现金贷/i.test(normalizedTypeText)
      ? 'consumer-loan'
      : 'credit-card';

  const toNumber = (value?: string) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const totalPeriodsNumber = extractNumberText(item.remainingPeriods);
  const balance = toNumber(extractNumberText(item.totalDebt) || extractNumberText(item.dueAmount)) || 0;
  const annualRate = toNumber(extractNumberText(item.interest));
  const remainingMonths = toNumber(totalPeriodsNumber);
  const totalPeriods = toNumber(totalPeriodsNumber);
  const loanPrincipal = toNumber(extractNumberText(item.totalDebt));
  const totalRepayment = toNumber(extractNumberText(item.totalDebt));
  const repaymentDay = toNumber(extractDayText(item.repaymentDate));

  return {
    name: item.title || '待确认负债',
    type,
    balance,
    annualRate,
    remainingMonths,
    totalPeriods,
    paidPeriods: undefined,
    loanPrincipal,
    totalRepayment,
    repaymentDay,
    paymentAccount: undefined,
    customMinPayment: undefined,
    billDay: undefined,
    repaymentMethod: type === 'loan' ? 'equal-installment' : 'minimum-payment',
    repaymentRecordMode: 'manual',
    graceDays: 0
  };
}

function buildCreditConflictFields(item: CreditExtractedItem, matchedDebt?: DebtItem): CreditConflictField[] | undefined {
  if (!matchedDebt) return undefined;

  const nextPayload = normalizeCreditDebtPayload(item);
  const comparisons = [
    { label: '名称', currentValue: matchedDebt.name, nextValue: nextPayload.name },
    { label: '余额/待还', currentValue: matchedDebt.balance, nextValue: nextPayload.balance },
    { label: 'APR/年化', currentValue: matchedDebt.annualRate, nextValue: nextPayload.annualRate },
    { label: '还款日', currentValue: matchedDebt.repaymentDay, nextValue: nextPayload.repaymentDay },
    { label: '剩余期数', currentValue: matchedDebt.remainingMonths, nextValue: nextPayload.remainingMonths },
    { label: '扣款账户', currentValue: matchedDebt.paymentAccount, nextValue: nextPayload.paymentAccount }
  ];

  const rows = comparisons
    .map((row) => ({
      label: row.label,
      currentValue: formatDebtCompareValue(row.currentValue),
      nextValue: formatDebtCompareValue(row.nextValue)
    }))
    .filter((row) => row.currentValue !== row.nextValue);

  return rows.length > 0 ? rows : undefined;
}

function buildCreditConfirmationSummary(item: CreditExtractedItem): string[] {
  return [
    `产品：${item.title || '待确认'}`,
    `当前应还：${item.dueAmount || '待确认'}`,
    `剩余待还：${item.totalDebt || '待确认'}`,
    `还款日：${item.repaymentDate || '待确认'}`,
    `每期金额：${item.monthlyAmount || '待确认'}`,
    `APR/年化：${formatCreditRateSummary(item)}`,
    `状态：${item.pendingFields.length === 0 ? '字段基本齐全，可确认保存' : `仍待补充 ${item.pendingFields.join('、')}`}`
  ];
}

/**
 * 利率摘要优先展示真实费率/年化值，口径（APR/月利率等）只作为补充说明，
 * 避免出现 “APR/年化：APR” 这类丢失数值的误导性摘要。
 */
function formatCreditRateSummary(item: CreditExtractedItem): string {
  const interest = String(item.interest || '').trim();
  const rateType = String(item.rateType || '').trim();

  if (interest && rateType && !interest.includes(rateType)) {
    return `${interest}（${rateType}）`;
  }

  return interest || rateType || '待确认';
}

function buildCreditFieldMeta(
  value: string | undefined,
  pendingFields: string[],
  label: string,
  source: CreditFieldSource,
  confidence: 'high' | 'medium' | 'low',
  evidence?: string
): CreditFieldMeta {
  const trimmedValue = String(value || '').trim();
  const isPending = !trimmedValue || pendingFields.includes(label);
  const status: CreditFieldStatus = isPending
    ? 'needs-confirmation'
    : confidence === 'low'
      ? 'low-confidence'
      : 'confirmed';

  return {
    value,
    source: isPending ? 'pending' : source,
    status,
    confidence: isPending ? 'low' : confidence,
    evidence,
    updatedAt: new Date().toISOString()
  };
}

export function enrichCreditItemsForConfirmation(
  items: CreditExtractedItem[],
  history: CreditHistoryLikeItem[],
  debts: DebtItem[],
  repaymentRecords: RepaymentRecord[]
): CreditExtractedItem[] {
  return items.map((item) => {
    const similarHistoryCount = history.filter(
      (historyItem) =>
        historyItem.role === 'assistant' &&
        Array.isArray(historyItem.creditItems) &&
        (historyItem.creditItems || []).some((prev) => {
          const prevKey = normalizeCreditIdentity(`${prev.title}${prev.productType}`);
          const currentKey = normalizeCreditIdentity(`${item.title}${item.productType}`);
          return prev.id !== item.id && (prevKey === currentKey || prevKey.includes(currentKey) || currentKey.includes(prevKey));
        })
    ).length;

    const identityKey = normalizeCreditIdentity(`${item.title}${item.productType}`) || item.id;
    const completedCount = countCompletedCreditFields(item);
    const completionRatio = Math.min(100, Math.round((completedCount / 6) * 100));
    const matchedDebt = findMatchingDebt(item, debts);
    const conflictFields = buildCreditConflictFields(item, matchedDebt);

    const normalizedPendingFields = Array.from(
      new Set((item.pendingFields || []).map((field) => String(field || '').trim()).filter(Boolean))
    );
    const confirmedFields = [
      item.title ? '产品名称' : '',
      item.dueAmount ? '当前应还' : '',
      item.totalDebt ? '剩余待还' : '',
      item.repaymentDate ? '还款日' : '',
      item.remainingPeriods ? '剩余期数' : '',
      item.monthlyAmount ? '每期金额' : '',
      item.interest || item.rateType ? '利息/费率' : ''
    ].filter(Boolean);
    const recommendedNextFields = normalizedPendingFields.slice(0, 2);
    const mergedTurns = Array.from(new Set([...(item.mergedFromTurns || []), similarHistoryCount > 0 ? similarHistoryCount + 1 : 1]));

    return {
      ...item,
      pendingFields: normalizedPendingFields,
      identityKey,
      draftCreditId: item.draftCreditId || `draft-${identityKey}`,
      matchReason: matchedDebt
        ? `已命中保存负债：${matchedDebt.name}`
        : similarHistoryCount > 0
          ? '已承接上轮相似识别结果'
          : '当前为新识别对象',
      lastConfirmedFields: confirmedFields,
      lastMissingFields: normalizedPendingFields,
      mergedFromTurns: mergedTurns,
      recommendedNextFields,
      bindingProgressText:
        normalizedPendingFields.length > 0
          ? `当前补的是「${item.title || '这笔负债'}」· 已补 ${confirmedFields.length}/7，优先再补 ${recommendedNextFields.join('、') || '关键信息'}`
          : `当前补的是「${item.title || '这笔负债'}」· 关键字段已基本补齐，可进入确认保存`,
      completionRatio,
      completionLabel: `${completedCount}/6 关键字段已补齐`,
      confirmationState: completedCount >= 4 ? 'ready' : 'needs-more-info',
      confirmationSummary: buildCreditConfirmationSummary({
        ...item,
        pendingFields: normalizedPendingFields
      }),
      matchedDebtId: matchedDebt?.id,
      matchedDebtName: matchedDebt?.name,
      conflictFields,
      conflictHint:
        conflictFields && conflictFields.length > 0
          ? `检测到这张结果可能对应已保存负债“${matchedDebt?.name || '已有负债'}”，建议先确认是更新原条目还是另存为新。`
          : similarHistoryCount > 1
            ? '检测到历史里有相似信贷项目，保存前建议确认是否为同一笔，避免重复合并。'
            : undefined,
      repaymentGapSummary: buildCreditRepaymentGapSummary(item, debts, repaymentRecords),
      repaymentLookupSummary: buildCreditRepaymentLookupSummary(item, debts, repaymentRecords),
      fieldMeta: {
        title: buildCreditFieldMeta(
          item.title,
          normalizedPendingFields,
          '产品名称',
          'explicit',
          item.confidence,
          item.title ? '来自识别标题' : '尚未识别到标题'
        ),
        dueAmount: buildCreditFieldMeta(
          item.dueAmount,
          normalizedPendingFields,
          '当前应还',
          'explicit',
          item.confidence,
          item.dueAmount ? '来自账单应还字段' : '账单中未稳定识别'
        ),
        totalDebt: buildCreditFieldMeta(
          item.totalDebt,
          normalizedPendingFields,
          '剩余待还',
          'explicit',
          item.confidence,
          item.totalDebt ? '来自总欠款/剩余待还字段' : '尚缺总待还信息'
        ),
        repaymentDate: buildCreditFieldMeta(
          item.repaymentDate,
          normalizedPendingFields,
          '还款日',
          'explicit',
          item.confidence,
          item.repaymentDate ? '来自还款日期字段' : '尚未识别到还款日'
        ),
        remainingPeriods: buildCreditFieldMeta(
          item.remainingPeriods,
          normalizedPendingFields,
          '剩余期数',
          item.remainingPeriods ? 'ai-inferred' : 'pending',
          item.confidence,
          item.remainingPeriods ? '来自期数字段或上下文推断' : '当前未识别到期数'
        ),
        monthlyAmount: buildCreditFieldMeta(
          item.monthlyAmount,
          normalizedPendingFields,
          '每期金额',
          item.monthlyAmount ? 'explicit' : 'pending',
          item.confidence,
          item.monthlyAmount ? '来自每期/月供字段' : '尚缺每期金额'
        ),
        interest: buildCreditFieldMeta(
          item.interest || item.rateType,
          normalizedPendingFields,
          '利息/费率',
          item.rateSource === 'explicit'
            ? 'explicit'
            : item.rateSource === 'inferred'
              ? 'ai-inferred'
              : 'pending',
          item.confidence,
          item.rateSource === 'explicit'
            ? '平台明确给出的费率/利率'
            : item.rateSource === 'inferred'
              ? '根据识别信息推测口径'
              : '需要补充利率口径'
        )
      }
    };
  });
}

export function buildCreditFollowUpPrompts(items: CreditExtractedItem[]): string[] {
  const prompts: string[] = [];
  items.forEach((item) => {
    const title = item.title || '这笔负债';
    if (item.pendingFields.includes('还款日')) {
      prompts.push(`我补充一下“${title}”的还款日，你继续完善这张还款卡片`);
    }
    if (item.pendingFields.includes('每期金额')) {
      prompts.push(`我补充“${title}”的每期金额/月供，你帮我更新识别结果`);
    }
    if (item.pendingFields.includes('当前应还') || item.pendingFields.includes('剩余待还')) {
      prompts.push(`我再补一张“${title}”账单图，你继续识别应还和剩余待还`);
    }
  });
  prompts.push('基于当前信息，直接告诉我还缺哪几个字段才能保存到还款管理');
  prompts.push('如果我现在继续补充一句说明或再发一张图，你希望我优先补什么？');
  return Array.from(new Set(prompts)).slice(0, 4);
}
