function normalizeCurrencyInput(value: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** fractionDigits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatCurrency(value: number) {
  const normalized = normalizeCurrencyInput(value, 2);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2
  }).format(normalized);
}

/** 金额自动简写：长数字使用“千 / 万”单位，避免挤压布局。 */
export function formatCurrencyAuto(value: number) {
  const normalized = normalizeCurrencyInput(value, 2);
  const abs = Math.abs(normalized);

  if (abs < 1000) {
    return formatCurrency(normalized);
  }

  const unit = abs < 10000 ? '千' : '万';
  const divisor = abs < 10000 ? 1000 : 10000;
  const compact = abs / divisor;
  const digits = compact >= 100 ? 0 : compact >= 10 ? 1 : 2;
  const compactText = compact
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');

  return `${normalized < 0 ? '-' : ''}¥${compactText}${unit}`;
}

/** 货币格式化（固定两位小数） */
export function formatCurrencyFixed2(value: number) {
  const normalized = normalizeCurrencyInput(value, 2);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(normalized);
}

export function formatMoneyByCurrency(value: number, currency = 'CNY') {
  const normalized = normalizeCurrencyInput(value, 2);
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currency || 'CNY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(normalized);
  } catch {
    return `${currency || 'CNY'} ${normalized.toFixed(2)}`;
  }
}

/** 格式化日期（仅日期） */
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN').format(new Date(value));
}

/** 格式化日期+时间（24小时制） */
export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value));
}
