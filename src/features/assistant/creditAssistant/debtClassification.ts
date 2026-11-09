import type { DebtItem, DebtType } from '../../debt/model/debtMetrics';

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

export function findMatchingCreditDebt(
  item: Pick<{ title: string; productType: string }, 'title' | 'productType'>,
  debts: DebtItem[]
): DebtItem | undefined {
  const currentNameKey = normalizeCreditIdentity(item.title);
  const currentKey = normalizeCreditIdentity(`${item.title}${item.productType}`);

  return debts.find((debt) => {
    const debtNameKey = normalizeCreditIdentity(debt.name);
    const debtKey = normalizeCreditIdentity(`${debt.name}${debt.type}`);
    const nameMatches =
      Boolean(currentNameKey && debtNameKey) &&
      (debtNameKey === currentNameKey ||
        debtNameKey.includes(currentNameKey) ||
        currentNameKey.includes(debtNameKey));

    return (
      nameMatches ||
      debtKey === currentKey ||
      debtKey.includes(currentKey) ||
      currentKey.includes(debtKey)
    );
  });
}
