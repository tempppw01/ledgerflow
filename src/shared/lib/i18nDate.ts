type DateInput = Date | string | number;

function toDate(value: DateInput) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  return new Date(value);
}

function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime());
}

export function getDateLocale(language?: string) {
  return language?.startsWith('en') ? 'en-US' : 'zh-CN';
}

export function formatMonth(value: DateInput, language?: string) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  return new Intl.DateTimeFormat(getDateLocale(language), { month: 'short' }).format(date);
}

export function formatMonthKey(value: string, language?: string) {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return '';
  return formatMonth(new Date(year, month - 1, 1), language);
}

export function formatDayMonth(value: DateInput, language?: string) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  return new Intl.DateTimeFormat(getDateLocale(language), {
    month: 'short',
    day: 'numeric'
  }).format(date);
}

export function formatWeekdayNarrow(value: DateInput, language?: string) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  return new Intl.DateTimeFormat(getDateLocale(language), { weekday: 'narrow' }).format(date);
}

export function formatYear(value: DateInput, language?: string) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  return new Intl.DateTimeFormat(getDateLocale(language), { year: 'numeric' }).format(date);
}
