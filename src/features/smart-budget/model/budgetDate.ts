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

export function monthLabelFromKey(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  return `${year} 年 ${Number(month)} 月`;
}
