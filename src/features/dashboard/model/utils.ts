import { toLocalDateKey } from '../../../shared/lib/localDate';

export interface ForecastPayload {
  summary: string;
  points: number[];
  suggestions: string[];
}

export interface MonthlyInsightPayload {
  summary: string;
  categoryBreakdown: Array<{ name: string; amount: number; percent: number }>;
  topTransactions: Array<{ date: string; category: string; amount: number; note: string }>;
  highlights: string[];
  profile?: {
    timePreference: string;
    topMerchant: string;
    personality: string;
    crowdCompare: string;
  };
}

function tWithFallback(t: (key: string) => string, key: string, fallback: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function getGreeting(t: (key: string) => string): string {
  const hour = new Date().getHours();
  if (hour < 6) return tWithFallback(t, 'dashboard.greeting.night', '夜深了，慢慢来');
  if (hour < 9) return tWithFallback(t, 'dashboard.greeting.morning', '早上好，今天也稳稳来');
  if (hour < 12) return tWithFallback(t, 'dashboard.greeting.forenoon', '上午好，先看一眼钱流向');
  if (hour < 14) return tWithFallback(t, 'dashboard.greeting.noon', '中午好，顺手盘一下账');
  if (hour < 18)
    return tWithFallback(t, 'dashboard.greeting.afternoon', '下午好，看看今天花得值不值');
  if (hour < 22) return tWithFallback(t, 'dashboard.greeting.evening', '晚上好，给今天的钱收个尾');
  return tWithFallback(t, 'dashboard.greeting.night', '夜深了，慢慢来');
}

/**
 * 与问候语配对的「今天能做什么」。
 *
 * 问候语本身只说时间(早上好 / 夜深了),信息量为零;后面再缀上产品名也已经出现过三次。
 * 这里按时段补一句短的、动词开头的行动提示,让 hero 第一行真正有内容可读。
 */
export function getGreetingAction(t: (key: string) => string): string {
  const hour = new Date().getHours();
  if (hour < 6) return tWithFallback(t, 'dashboard.greetingAction.night', '睡前顺手记两笔');
  if (hour < 9) return tWithFallback(t, 'dashboard.greetingAction.morning', '今天想记点什么');
  if (hour < 12) return tWithFallback(t, 'dashboard.greetingAction.forenoon', '先看一眼钱花在哪');
  if (hour < 14) return tWithFallback(t, 'dashboard.greetingAction.noon', '趁午休补两笔');
  if (hour < 18) return tWithFallback(t, 'dashboard.greetingAction.afternoon', '下午也记得看一眼');
  if (hour < 22) return tWithFallback(t, 'dashboard.greetingAction.evening', '给今天的钱收个尾');
  return tWithFallback(t, 'dashboard.greetingAction.night', '睡前顺手记两笔');
}

export function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function monthLabel(date: Date): string {
  return `${date.getMonth() + 1}月`;
}

export function isActualExpenseType(type: 'expense' | 'income' | 'budget' | 'repayment'): boolean {
  return type === 'expense' || type === 'repayment';
}

export function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

export function toSafeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function monthBounds(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    from: toLocalDateKey(start),
    to: toLocalDateKey(end)
  };
}

export function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  const cmds: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    cmds.push(`Q ${cx} ${prev.y}, ${curr.x} ${curr.y}`);
  }
  return cmds.join(' ');
}

export function getConstellationLabel(month: number, day: number): string {
  const edgeDays = [20, 19, 21, 21, 21, 22, 23, 23, 23, 24, 23, 22];
  const names = [
    '摩羯座',
    '水瓶座',
    '双鱼座',
    '白羊座',
    '金牛座',
    '双子座',
    '巨蟹座',
    '狮子座',
    '处女座',
    '天秤座',
    '天蝎座',
    '射手座',
    '摩羯座'
  ];
  return day < edgeDays[month] ? names[month] : names[month + 1];
}

export interface TrendSeriesItem {
  label: string;
  shortLabel: string;
  value: number;
  dateFrom: string;
  dateTo: string;
}
