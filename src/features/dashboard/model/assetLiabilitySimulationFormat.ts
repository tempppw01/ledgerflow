import type { SimulationEvent } from './assetLiabilitySimulation';

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

/**
 * 把推演事件翻成当前语言。kind 在模型层是枚举、不预拼中文,
 * 所以英文界面不会出现「续费 · 中国移动」这种半截中文。
 *
 * `t` 由调用方注入(组件里是 react-i18next 的 t),便于单测断言 key。
 */
export function describeSimulationEvent(
  event: SimulationEvent,
  t: (key: string) => string
): string {
  const base =
    event.kind === 'plannedIncome'
      ? t('dashboard.ui.simulation.event.plannedIncome')
      : event.kind === 'plannedExpense'
        ? t('dashboard.ui.simulation.event.plannedExpense')
        : event.kind === 'subscription'
          ? t('dashboard.ui.simulation.event.subscription')
          : event.kind === 'debtReminder'
            ? t('dashboard.ui.simulation.event.debtReminder')
            : event.kind === 'plannedRepayment'
              ? t('dashboard.ui.simulation.event.plannedRepayment')
              : event.kind === 'monthlyRepayment'
                ? t('dashboard.ui.simulation.event.monthlyRepayment')
                : event.kind === 'forecastIncome'
                  ? t('dashboard.ui.simulation.event.forecastIncome')
                  : t('dashboard.ui.simulation.event.forecastExpense');

  const label = event.name ? `${base} · ${event.name}` : base;
  return event.count && event.count > 1 ? `${label} ×${event.count}` : label;
}
