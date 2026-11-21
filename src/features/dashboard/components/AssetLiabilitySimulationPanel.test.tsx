import { describe, expect, it } from 'vitest';
import { formatCalendarAmount } from '../model/assetLiabilitySimulationFormat';
import { describeSimulationEvent } from '../model/assetLiabilitySimulationFormat';

describe('formatCalendarAmount', () => {
  it('uses compact k/w units while keeping the daily surplus sign visible', () => {
    expect(formatCalendarAmount(0)).toBe('0');
    expect(formatCalendarAmount(860)).toBe('+860');
    expect(formatCalendarAmount(-1250)).toBe('−1.25k');
    expect(formatCalendarAmount(42547.67)).toBe('+4.25w');
  });
});

describe('describeSimulationEvent', () => {
  // 用 key 回显代替真实文案:断言「取的是哪个 key」,与语言无关。
  const echo = (key: string) => key.replace('dashboard.ui.simulation.event.', '');

  it('每种事件都取到自己的 i18n key', () => {
    expect(describeSimulationEvent({ kind: 'plannedIncome' }, echo)).toBe('plannedIncome');
    expect(describeSimulationEvent({ kind: 'plannedExpense' }, echo)).toBe('plannedExpense');
    expect(describeSimulationEvent({ kind: 'subscription' }, echo)).toBe('subscription');
    expect(describeSimulationEvent({ kind: 'debtReminder' }, echo)).toBe('debtReminder');
    expect(describeSimulationEvent({ kind: 'plannedRepayment' }, echo)).toBe('plannedRepayment');
    expect(describeSimulationEvent({ kind: 'monthlyRepayment' }, echo)).toBe('monthlyRepayment');
    expect(describeSimulationEvent({ kind: 'forecastIncome' }, echo)).toBe('forecastIncome');
    expect(describeSimulationEvent({ kind: 'forecastExpense' }, echo)).toBe('forecastExpense');
  });

  it('带名称的事件把名称拼在后面,没有名称就只留标签', () => {
    expect(describeSimulationEvent({ kind: 'subscription', name: '中国移动 5G' }, echo)).toBe(
      'subscription · 中国移动 5G'
    );
    expect(describeSimulationEvent({ kind: 'plannedIncome', name: '' }, echo)).toBe(
      'plannedIncome'
    );
  });
});
