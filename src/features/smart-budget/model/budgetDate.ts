/** 预算模块共用的日期解析，避免各处重复处理字符串日期。 */
export function parseDateInput(input: string | Date): Date {
  if (input instanceof Date) return new Date(input.getTime());
  const text = String(input || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return new Date(text);
}

export function formatMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export type BudgetTextTranslator = (key: string, fallback: string) => string;

export const identityTextTranslator: BudgetTextTranslator = (_key, fallback) => fallback;

export function monthLabelFromKey(
  monthKey: string,
  t: BudgetTextTranslator = identityTextTranslator
): string {
  const [year, month] = monthKey.split('-');
  return t('smartBudget.month.yearMonth', '{year} 年 {month} 月')
    .replace('{year}', String(year))
    .replace('{month}', String(Number(month)));
}
