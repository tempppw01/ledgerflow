import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTFallback } from '../../shared/lib/useTFallback';
import {
  calculateOvertimePay,
  calculateSalaryMetrics,
  getOvertimeInputError,
  getOvertimeInputProblem,
  getSalaryInputError,
  getSalaryInputErrorFields,
  localizeCalculatorError,
  type SalaryInputField,
  sanitizePositiveNumberInput
} from './salaryCalculator';

/*
 * 错误消息的 id。表单用 aria-describedby 指向它们,把"顶部一句话"变成
 * "这个字段错了" —— 读屏用户逐字段 Tab 时才听得到。
 */
const SALARY_INPUT_ERROR_ID = 'salary-input-error';
const OVERTIME_INPUT_ERROR_ID = 'overtime-input-error';

export function SalaryToolCard() {
  const tf = useTFallback();
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'zh';
  const isEnglish = language.toLowerCase().startsWith('en');
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

  // 金额格式跟随界面语言:中文用 ¥1,000.00 的本地写法,英文按 en-US 规则分组与显示货币码。
  const formatMoney = useMemo(
    () =>
      new Intl.NumberFormat(isEnglish ? 'en-US' : 'zh-CN', {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format,
    [isEnglish]
  );

  const salaryErrorText = localizeCalculatorError(salaryInputError, language);
  const overtimeErrorText = localizeCalculatorError(overtimeInputError, language);

  /*
   * 「错误要关联到出错的那个字段」。
   *
   * 这两块原来只有顶部一句 role="alert":读屏用户逐字段 Tab 过去时**听不到任何提示**,
   * 只有碰巧经过那句提示才知道哪里错了。文案本身已经点名了字段,缺的只是程序化关联。
   * 字段由模型给出(getSalaryInputErrorFields / getOvertimeInputProblem),
   * 不在组件里重新判断一遍 —— 那样迟早和模型走形。
   */
  const salaryErrorFields = getSalaryInputErrorFields({ monthlySalary, workingDays, dailyHours });
  const overtimeProblem = getOvertimeInputProblem(
    salaryMetrics?.hourlySalary || 0,
    overtimeHours,
    Boolean(salaryMetrics)
  );
  const salaryFieldError = (field: SalaryInputField) =>
    salaryErrorFields.includes(field)
      ? { 'aria-invalid': true as const, 'aria-describedby': SALARY_INPUT_ERROR_ID }
      : {};
  /*
   * 加班框只在错误确实出在它自己身上时才标 aria-invalid:
   * "请先完成上方工资基础输入"指的是**上面的字段**,标到加班框上是错的。
   */
  const overtimeFieldError =
    overtimeProblem === 'overtimeHours'
      ? { 'aria-invalid': true as const, 'aria-describedby': OVERTIME_INPUT_ERROR_ID }
      : {};

  return (
    <section className="vi-section finance-salary-card">
      <div className="finance-salary-input-pane vi-split">
        <div className="finance-section-heading vi-section-title">
          <span className="vi-page-kicker">{tf('salaryTools.inputs.kicker', '输入参数')}</span>
          <h2>{tf('salaryTools.inputs.heading', '先从你的工作日常开始')}</h2>
        </div>

      <div className="finance-salary-grid">
        <label className="finance-salary-field">
          <span>{tf('salaryTools.inputs.monthlySalary', '月薪')}</span>
          <div className={`finance-unit-input ${monthlySalary ? 'is-filled' : ''}`}>
            <input
              className="vi-input"
              inputMode="decimal"
              value={monthlySalary}
              {...salaryFieldError('monthlySalary')}
              onChange={(event) => setMonthlySalary(sanitizePositiveNumberInput(event.target.value))}
              placeholder={tf('salaryTools.inputs.monthlySalaryPlaceholder', '例如 12000')}
            />
            <span>{tf('salaryTools.unit.money', '元')}</span>
          </div>
        </label>

        <label className="finance-salary-field">
          <span>{tf('salaryTools.inputs.workingDays', '计薪天数')}</span>
          <div className={`finance-unit-input ${workingDays ? 'is-filled' : ''}`}>
            <input
              className="vi-input"
              inputMode="decimal"
              value={workingDays}
              {...salaryFieldError('workingDays')}
              onChange={(event) => setWorkingDays(sanitizePositiveNumberInput(event.target.value))}
              placeholder={tf('salaryTools.inputs.workingDaysPlaceholder', '例如 21.75')}
            />
            <span>{tf('salaryTools.unit.day', '天')}</span>
          </div>
        </label>

        <label className="finance-salary-field">
          <span>{tf('salaryTools.inputs.dailyHours', '每日工时')}</span>
          <div className={`finance-unit-input ${dailyHours ? 'is-filled' : ''}`}>
            <input
              className="vi-input"
              inputMode="decimal"
              value={dailyHours}
              {...salaryFieldError('dailyHours')}
              onChange={(event) => setDailyHours(sanitizePositiveNumberInput(event.target.value))}
              placeholder={tf('salaryTools.inputs.dailyHoursPlaceholder', '例如 8')}
            />
            <span>{tf('salaryTools.unit.hour', '小时')}</span>
          </div>
        </label>
      </div>
      </div>

      {salaryErrorText ? (
        <p id={SALARY_INPUT_ERROR_ID} className="finance-debt-form-error muted" role="alert">
          {salaryErrorText}
        </p>
      ) : null}

      <div className="finance-salary-result-grid">
        <article className="finance-salary-metric is-primary">
          <p className="finance-overview-label">{tf('salaryTools.result.daily', '日薪参考')}</p>
          <p className="finance-overview-value">
            <span className="finance-overview-number">{salaryMetrics ? formatMoney(salaryMetrics.dailySalary) : '—'}</span>
          </p>
          <p className="finance-salary-metric-note muted">
            {tf('salaryTools.result.dailyNote', '按月薪 ÷ 计薪天数估算')}
          </p>
        </article>
        <article className="finance-salary-metric is-primary-alt">
          <p className="finance-overview-label">{tf('salaryTools.result.hourly', '时薪参考')}</p>
          <p className="finance-overview-value">
            <span className="finance-overview-number">{salaryMetrics ? formatMoney(salaryMetrics.hourlySalary) : '—'}</span>
          </p>
        </article>
        <article className="finance-salary-metric">
          <p className="finance-overview-label">{tf('salaryTools.result.weekly', '周薪参考（按 5 天）')}</p>
          <p className="finance-overview-value">
            <span className="finance-overview-number">{salaryMetrics ? formatMoney(salaryMetrics.weeklySalary) : '—'}</span>
          </p>
        </article>
      </div>

      <div className="finance-overtime-section">
        <div className="finance-overtime-header">
          <div>
            <h3 style={{ margin: 0 }}>⏱️ {tf('salaryTools.overtime.title', '加班工资估算')}</h3>
          </div>
          <label className="finance-salary-field finance-overtime-input">
            <span>{tf('salaryTools.inputs.overtimeHours', '加班时长')}</span>
            <div className={`finance-unit-input ${overtimeHours ? 'is-filled' : ''}`}>
              <input
              className="vi-input"
                inputMode="decimal"
                value={overtimeHours}
                {...overtimeFieldError}
                onChange={(event) => setOvertimeHours(sanitizePositiveNumberInput(event.target.value))}
                placeholder={tf('salaryTools.inputs.overtimeHoursPlaceholder', '例如 2')}
              />
              <span>{tf('salaryTools.unit.hour', '小时')}</span>
            </div>
          </label>
        </div>

        {overtimeErrorText ? (
          <p id={OVERTIME_INPUT_ERROR_ID} className="finance-debt-form-error muted" role="alert">
            {overtimeErrorText}
          </p>
        ) : null}

        {salaryMetrics ? (
          <p className="finance-salary-inline-tip muted">
            {tf('salaryTools.overtime.basePrefix', '当前时薪基准：')}
            <strong>{formatMoney(salaryMetrics.hourlySalary)}</strong>
            {tf('salaryTools.overtime.baseSuffix', '，加班费按这个时薪做倍数估算。')}
          </p>
        ) : null}

        <div className="finance-salary-result-grid">
          <article className="finance-salary-metric">
            <p className="finance-overview-label">{tf('salaryTools.overtime.workday', '工作日加班费（1.5x）')}</p>
            <p className="finance-overview-value">
              <span className="finance-overview-number">{overtimeResult ? formatMoney(overtimeResult.workdayOvertimePay) : '—'}</span>
            </p>
          </article>
          <article className="finance-salary-metric">
            <p className="finance-overview-label">{tf('salaryTools.overtime.restDay', '休息日加班费（2x）')}</p>
            <p className="finance-overview-value">
              <span className="finance-overview-number">{overtimeResult ? formatMoney(overtimeResult.restDayOvertimePay) : '—'}</span>
            </p>
          </article>
          <article className="finance-salary-metric">
            <p className="finance-overview-label">{tf('salaryTools.overtime.holiday', '法定节假日加班费（3x）')}</p>
            <p className="finance-overview-value">
              <span className="finance-overview-number">{overtimeResult ? formatMoney(overtimeResult.holidayOvertimePay) : '—'}</span>
            </p>
          </article>
        </div>
      </div>

      <div className="finance-salary-disclaimer-list muted">
        <p>
          {tf(
            'salaryTools.disclaimer.line1',
            '说明 1：结果仅供税前估算参考，默认不含社保、个税、公积金、补贴、提成与特殊排班。'
          )}
        </p>
        <p>
          {tf(
            'salaryTools.disclaimer.line2',
            '说明 2：周薪默认按 5 个工作日折算；加班费按当前时薪做倍数估算，不代表公司最终核算口径。'
          )}
        </p>
      </div>
    </section>
  );
}
