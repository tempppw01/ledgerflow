import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssetLiabilitySimulationPanel } from './AssetLiabilitySimulationPanel';
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

/*
 * 「错误要关联到出错的字段」。
 *
 * 预测账单表单原来只有底部一句 role="alert":读屏用户逐字段 Tab 过去听不到提示。
 * 这里钉的是**接线** —— 金额错时标金额框、日期错时标日期框,而且**不要挂错**。
 */
describe('AssetLiabilitySimulationPanel 的错误关联到字段', () => {
  const renderPanel = () => {
    const { container } = render(
      <AssetLiabilitySimulationPanel
        rows={[]}
        initialAssets={1000}
        initialLiabilities={0}
        horizonMonths={1}
        onHorizonChange={() => undefined}
        forecastBills={[]}
        onAddForecastBill={() => 'forecast-bill-test'}
        onUpdateForecastBill={() => undefined}
        onRemoveForecastBill={() => undefined}
      />
    );
    return {
      container,
      form: container.querySelector('form.dashboard-forecast-form') as HTMLFormElement,
      amount: container.querySelector('.dashboard-forecast-input.is-amount') as HTMLInputElement,
      date: container.querySelector('.dashboard-forecast-input.is-date') as HTMLInputElement
    };
  };

  it('金额非法时标金额框,日期框不动', () => {
    const { container, form, amount, date } = renderPanel();

    fireEvent.change(amount, { target: { value: '0' } });
    fireEvent.submit(form);

    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAttribute('aria-describedby', 'forecast-bill-error');
    expect(date).not.toHaveAttribute('aria-invalid');
    expect(container.querySelector('#forecast-bill-error')).toBeTruthy();
  });

  it('金额合法但日期非法时改标日期框', () => {
    const { form, amount, date } = renderPanel();

    fireEvent.change(amount, { target: { value: '100' } });
    fireEvent.change(date, { target: { value: '' } });
    fireEvent.submit(form);

    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(date).toHaveAttribute('aria-describedby', 'forecast-bill-error');
    // 上一步是金额错,这一步换了字段 —— 金额框不能还留着 aria-invalid
    expect(amount).not.toHaveAttribute('aria-invalid');
  });
});
