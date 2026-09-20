export function formatCalendarAmount(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safeValue);
  if (abs < 0.005) return '0';

  const unit = abs >= 10000 ? 'w' : abs >= 1000 ? 'k' : '';
  const divisor = abs >= 10000 ? 10000 : abs >= 1000 ? 1000 : 1;
  const compact = abs / divisor;
  const digits = unit === '' ? 0 : compact >= 100 ? 0 : compact >= 10 ? 1 : 2;
  const amount = compact
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');

  return `${safeValue > 0 ? '+' : '−'}${amount}${unit}`;
}
