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

/**
 * 带年份的日期,用于「发布于 2026年11月27日」这类**日期本身就是要展示的信息**的地方。
 *
 * 不要用 `new Date('2026-11-27')` 自己转:`YYYY-MM-DD` 会被当成 **UTC** 零点,
 * 在 UTC- 的时区里会渲染成前一天(关于页的发布日期正好是纯日期,踩上去就是
 * 「v0.51.0 发布于 11 月 26 日」)。`toDate()` 对纯日期补的是本地零点。
 */
export function formatIsoDay(value: DateInput, language?: string) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  return new Intl.DateTimeFormat(getDateLocale(language), {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

export function formatYear(value: DateInput, language?: string) {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  return new Intl.DateTimeFormat(getDateLocale(language), { year: 'numeric' }).format(date);
}
