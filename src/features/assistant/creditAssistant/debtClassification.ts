import type { DebtItem, DebtType } from '../../debt/model/debtMetrics';

const CREDIT_BANK_PREFIX_ALIASES: Array<[RegExp, string]> = [
  [/^(中国工商银行|工商银行|工行)/, '工商银行'],
  [/^(中国农业银行|农业银行|农行)/, '农业银行'],
  [/^(中国建设银行|建设银行|建行)/, '建设银行'],
  [/^(中国银行|中行)/, '中国银行'],
  [/^(交通银行|交行)/, '交通银行'],
  [/^(招商银行|招行|招银)/, '招商银行'],
  [/^(中国邮政储蓄银行|邮政储蓄银行|邮储银行|邮储)/, '邮政储蓄银行'],
  [/^(中信银行|中信)/, '中信银行'],
  [/^(中国光大银行|光大银行|光大)/, '光大银行'],
  [/^(中国民生银行|民生银行|民生)/, '民生银行'],
  [/^(兴业银行)/, '兴业银行'],
  [/^(平安银行)/, '平安银行'],
  [/^(广发银行|广发)/, '广发银行'],
  [/^(浦发银行|浦发)/, '浦发银行'],
  [/^(华夏银行)/, '华夏银行']
];
const GENERIC_CREDIT_SUFFIXES = [
  '信用卡分期',
  '贷记卡分期',
  '信用卡',
  '贷记卡',
  '消费贷款',
  '消费贷',
  '信用贷',
  '贷款',
  '借款',
  '分期'
];

export function normalizeCreditIdentity(value: string): string {
  return String(value || '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\-_()（）【】[\]·•:/]/g, '');
}

export function inferCreditDebtType(...values: Array<string | undefined>): DebtType {
  const text = values.filter(Boolean).join(' ');

  if (/信用卡|贷记卡/i.test(text)) return 'credit-card';
  if (/房贷|车贷|按揭|住房公积金贷款/i.test(text)) return 'loan';
  if (/花呗|白条|借呗|现金贷|消费贷|消费金融|信用贷|分期乐|分期/i.test(text)) {
    return 'consumer-loan';
  }
  if (/贷款|借款/i.test(text)) return 'loan';
  return 'credit-card';
}

export function inferCreditProductTypeLabel(...values: Array<string | undefined>): string {
  const text = values.filter(Boolean).join(' ');

  if (/信用卡|贷记卡/i.test(text)) return '信用卡';
  if (/房贷|车贷|按揭|住房公积金贷款/i.test(text)) return '贷款';
  if (/花呗|白条|借呗|现金贷|消费贷|消费金融|信用贷|分期乐|分期/i.test(text)) {
    return '消费贷';
  }
  if (/贷款|借款/i.test(text)) return '贷款';
  return '待识别';
}

function normalizeCreditBankPrefix(value: string): string {
  for (const [pattern, replacement] of CREDIT_BANK_PREFIX_ALIASES) {
    if (pattern.test(value)) {
      return value.replace(pattern, replacement);
    }
  }
  return value;
}

function buildHighConfidenceAliases(value: string): Set<string> {
  const normalized = normalizeCreditIdentity(value);
  const aliases = new Set<string>();
  if (!normalized) return aliases;

  const canonical = normalizeCreditBankPrefix(normalized);
  for (const key of [normalized, canonical]) {
    aliases.add(key);
    for (const suffix of GENERIC_CREDIT_SUFFIXES) {
      if (!key.endsWith(suffix)) continue;
      const base = key.slice(0, -suffix.length);
      if (base.length >= 2) aliases.add(base);
    }
  }
  return aliases;
}

function pickUniqueDebt(candidates: DebtItem[]): DebtItem | undefined {
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function findMatchingCreditDebt(
  item: Pick<{ title: string; productType: string }, 'title' | 'productType'>,
  debts: DebtItem[]
): DebtItem | undefined {
  const currentNameKey = normalizeCreditIdentity(item.title);
  if (!currentNameKey) return undefined;

  const exactMatches = debts.filter(
    (debt) => normalizeCreditIdentity(debt.name) === currentNameKey
  );
  const exactMatch = pickUniqueDebt(exactMatches);
  if (exactMatch || exactMatches.length > 1) return exactMatch;

  const currentAliases = buildHighConfidenceAliases(item.title);
  const aliasMatches = debts.filter((debt) => {
    const debtAliases = buildHighConfidenceAliases(debt.name);
    return [...currentAliases].some((alias) => debtAliases.has(alias));
  });
  return pickUniqueDebt(aliasMatches);
}
