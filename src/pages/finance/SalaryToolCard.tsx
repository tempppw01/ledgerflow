import { useMemo, useState } from 'react';
import {
  calculateOvertimePay,
  calculateSalaryMetrics,
  getOvertimeInputError,
  getSalaryInputError,
  sanitizePositiveNumberInput
} from './salaryCalculator';

function formatMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function SalaryToolCard() {
  const [monthlySalary, setMonthlySalary] = useState('12000');
  const [workingDays, setWorkingDays] = useState('21.75');
  const [dailyHours, setDailyHours] = useState('8');
  const [overtimeHours, setOvertimeHours] = useState('2');

  const salaryMetrics = useMemo(
    () => calculateSalaryMetrics({ monthlySalary, workingDays, dailyHours }),
    [dailyHours, monthlySalary, workingDays]
  );

  const salaryInputError = useMemo(
    () => getSalaryInputError({ monthlySalary, workingDays, dailyHours }),
    [dailyHours, monthlySalary, workingDays]
  );

  const overtimeResult = useMemo(
    () => calculateOvertimePay(salaryMetrics?.hourlySalary || 0, overtimeHours),
    [overtimeHours, salaryMetrics]
  );

  const overtimeInputError = useMemo(
    () => getOvertimeInputError(salaryMetrics?.hourlySalary || 0, overtimeHours, Boolean(salaryMetrics)),
    [overtimeHours, salaryMetrics]
  );

  return (
    <section className="finance-salary-card">
      <div className="finance-salary-input-pane">
        <div className="finance-section-heading">
          <span className="finance-eyebrow">输入参数</span>
          <h2>先从你的工作日常开始</h2>
        </div>

      <div className="finance-salary-grid">
        <label className="finance-salary-field">
          <span>月薪</span>
          <div className={`finance-unit-input ${monthlySalary ? 'is-filled' : ''}`}>
            <input
              className="finance-debt-form-control"
              inputMode="decimal"
              value={monthlySalary}
              onChange={(event) => setMonthlySalary(sanitizePositiveNumberInput(event.target.value))}
              placeholder="例如 12000"
            />
            <span>元</span>
          </div>
        </label>

        <label className="finance-salary-field">
          <span>计薪天数</span>
          <div className={`finance-unit-input ${workingDays ? 'is-filled' : ''}`}>
            <input
              className="finance-debt-form-control"
              inputMode="decimal"
              value={workingDays}
              onChange={(event) => setWorkingDays(sanitizePositiveNumberInput(event.target.value))}
              placeholder="例如 21.75"
            />
            <span>天</span>
          </div>
        </label>

        <label className="finance-salary-field">
          <span>每日工时</span>
          <div className={`finance-unit-input ${dailyHours ? 'is-filled' : ''}`}>
            <input
              className="finance-debt-form-control"
              inputMode="decimal"
              value={dailyHours}
              onChange={(event) => setDailyHours(sanitizePositiveNumberInput(event.target.value))}
              placeholder="例如 8"
            />
            <span>小时</span>
          </div>
        </label>
      </div>
      </div>

      {salaryInputError ? <p className="finance-debt-form-error muted">{salaryInputError}</p> : null}

      <div className="finance-salary-result-grid">
        <article className="finance-salary-metric is-primary">
          <p className="finance-overview-label">日薪参考</p>
          <p className="finance-overview-value">
            <span className="finance-overview-number">{salaryMetrics ? formatMoney(salaryMetrics.dailySalary) : '—'}</span>
          </p>
          <p className="finance-salary-metric-note muted">按月薪 ÷ 计薪天数估算</p>
        </article>
        <article className="finance-salary-metric is-primary-alt">
          <p className="finance-overview-label">时薪参考</p>
          <p className="finance-overview-value">
            <span className="finance-overview-number">{salaryMetrics ? formatMoney(salaryMetrics.hourlySalary) : '—'}</span>
          </p>
          <p className="finance-salary-metric-note muted">按日薪 ÷ 每日工时估算</p>
        </article>
        <article className="finance-salary-metric">
          <p className="finance-overview-label">周薪参考（按 5 天）</p>
          <p className="finance-overview-value">
            <span className="finance-overview-number">{salaryMetrics ? formatMoney(salaryMetrics.weeklySalary) : '—'}</span>
          </p>
          <p className="finance-salary-metric-note muted">默认按 5 个工作日折算</p>
        </article>
      </div>

      <div className="finance-overtime-section">
        <div className="finance-overtime-header">
          <div>
            <h3 style={{ margin: 0 }}>⏱️ 加班工资估算</h3>
            <p className="muted finance-salary-hint">按当前时薪估算工作日 1.5 倍、休息日 2 倍、法定节假日 3 倍。</p>
          </div>
          <label className="finance-salary-field finance-overtime-input">
            <span>加班时长</span>
            <div className={`finance-unit-input ${overtimeHours ? 'is-filled' : ''}`}>
              <input
                className="finance-debt-form-control"
                inputMode="decimal"
                value={overtimeHours}
                onChange={(event) => setOvertimeHours(sanitizePositiveNumberInput(event.target.value))}
                placeholder="例如 2"
              />
              <span>小时</span>
            </div>
          </label>
        </div>

        {overtimeInputError ? <p className="finance-debt-form-error muted">{overtimeInputError}</p> : null}

        {salaryMetrics ? (
          <p className="finance-salary-inline-tip muted">
            当前时薪基准：<strong>{formatMoney(salaryMetrics.hourlySalary)}</strong> / 小时，加班费按这个时薪做倍数估算。
          </p>
        ) : null}

        <div className="finance-salary-result-grid">
          <article className="finance-salary-metric">
            <p className="finance-overview-label">工作日加班费（1.5x）</p>
            <p className="finance-overview-value">
              <span className="finance-overview-number">{overtimeResult ? formatMoney(overtimeResult.workdayOvertimePay) : '—'}</span>
            </p>
            <p className="finance-salary-metric-note muted">适用于工作日延时加班估算</p>
          </article>
          <article className="finance-salary-metric">
            <p className="finance-overview-label">休息日加班费（2x）</p>
            <p className="finance-overview-value">
              <span className="finance-overview-number">{overtimeResult ? formatMoney(overtimeResult.restDayOvertimePay) : '—'}</span>
            </p>
            <p className="finance-salary-metric-note muted">适用于休息日加班估算</p>
          </article>
          <article className="finance-salary-metric">
            <p className="finance-overview-label">法定节假日加班费（3x）</p>
            <p className="finance-overview-value">
              <span className="finance-overview-number">{overtimeResult ? formatMoney(overtimeResult.holidayOvertimePay) : '—'}</span>
            </p>
            <p className="finance-salary-metric-note muted">适用于法定节假日加班估算</p>
          </article>
        </div>
      </div>

      <div className="finance-salary-disclaimer-list muted">
        <p>说明 1：结果仅供税前估算参考，默认不含社保、个税、公积金、补贴、提成与特殊排班。</p>
        <p>说明 2：周薪默认按 5 个工作日折算；加班费按当前时薪做倍数估算，不代表公司最终核算口径。</p>
      </div>
    </section>
  );
}
