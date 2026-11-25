import { describe, expect, it } from 'vitest';
import {
  calculateOvertimePay,
  calculateSalaryMetrics,
  getOvertimeInputError,
  getOvertimeInputProblem,
  getSalaryInputError,
  getSalaryInputErrorFields,
  localizeCalculatorError,
  sanitizePositiveNumberInput
} from './salaryCalculator';

describe('salaryCalculator', () => {
  it('sanitizes positive number input and removes extra dots', () => {
    expect(sanitizePositiveNumberInput('12a.3.4元')).toBe('12.34');
    expect(sanitizePositiveNumberInput('..8')).toBe('.8');
    expect(sanitizePositiveNumberInput('abc')).toBe('');
  });

  it('calculates daily, hourly and weekly salary metrics', () => {
    const result = calculateSalaryMetrics({
      monthlySalary: '12000',
      workingDays: '21.75',
      dailyHours: '8'
    });

    expect(result).not.toBeNull();
    expect(result?.dailySalary).toBeCloseTo(551.7241, 4);
    expect(result?.hourlySalary).toBeCloseTo(68.9655, 4);
    expect(result?.weeklySalary).toBeCloseTo(2758.6207, 4);
  });

  it('rejects invalid salary metric inputs', () => {
    expect(
      calculateSalaryMetrics({
        monthlySalary: '0',
        workingDays: '21.75',
        dailyHours: '8'
      })
    ).toBeNull();

    expect(
      calculateSalaryMetrics({
        monthlySalary: '12000',
        workingDays: '32',
        dailyHours: '8'
      })
    ).toBeNull();

    expect(
      calculateSalaryMetrics({
        monthlySalary: '12000',
        workingDays: '21.75',
        dailyHours: '25'
      })
    ).toBeNull();
  });

  it('returns targeted salary input error messages', () => {
    expect(
      getSalaryInputError({
        monthlySalary: '',
        workingDays: '21.75',
        dailyHours: '8'
      })
    ).toBe('请先填写月薪、计薪天数和每日工时');

    expect(
      getSalaryInputError({
        monthlySalary: '12000',
        workingDays: '32',
        dailyHours: '8'
      })
    ).toBe('计薪天数需为大于 0 且不超过 31 的合法数字');

    expect(
      getSalaryInputError({
        monthlySalary: '12000',
        workingDays: '21.75',
        dailyHours: '25'
      })
    ).toBe('每日工时需为大于 0 且不超过 24 的合法数字');
  });

  it('calculates overtime pay by workday, rest day and holiday rates', () => {
    const result = calculateOvertimePay(68.9655, '2');

    expect(result).not.toBeNull();
    expect(result?.workdayOvertimePay).toBeCloseTo(206.8965, 4);
    expect(result?.restDayOvertimePay).toBeCloseTo(275.862, 4);
    expect(result?.holidayOvertimePay).toBeCloseTo(413.793, 4);
  });

  it('rejects invalid overtime input and reports clear errors', () => {
    expect(calculateOvertimePay(68.9655, '25')).toBeNull();
    expect(calculateOvertimePay(0, '2')).toBeNull();

    expect(getOvertimeInputError(0, '2', false)).toBe('请先完成上方工资基础输入，才能计算加班工资');
    expect(getOvertimeInputError(68.9655, '', true)).toBe('请输入加班时长');
    expect(getOvertimeInputError(68.9655, '25', true)).toBe('加班时长需为大于 0 且不超过 24 的合法数字');
  });
});

/*
 * 这两条是补上的守卫,对应两个真实缺陷:
 *
 * 1) "每条错误都有英文":SALARY_ERROR_EN 的键里,有一条用的是**半角逗号**,
 *    而模型返回的是**全角逗号** —— 键对不上,英文界面下那句会直接漏出中文。
 *    7 条映射里坏 1 条,肉眼看字符串一模一样,只有按码点比才发现。
 *    所以这里**用会触发它的输入枚举消息**,而不是手抄字符串:将来改文案或加分支,
 *    漏翻译会被立刻抓住。
 *
 * 2) "错误要报在正确的字段上":表单据此挂 aria-invalid,挂错字段比不挂更糟 ——
 *    "请先完成上方工资基础输入"指的是上面的字段,不该把加班框标红。
 */
describe('salaryCalculator 错误文案与出错字段', () => {
  const allMessages = () => [
    getSalaryInputError({ monthlySalary: '', workingDays: '', dailyHours: '' }),
    getSalaryInputError({ monthlySalary: 'abc', workingDays: '21.75', dailyHours: '8' }),
    getSalaryInputError({ monthlySalary: '12000', workingDays: '99', dailyHours: '8' }),
    getSalaryInputError({ monthlySalary: '12000', workingDays: '21.75', dailyHours: '99' }),
    getOvertimeInputError(0, '2', false),
    getOvertimeInputError(68.9655, '', true),
    getOvertimeInputError(68.9655, '99', true)
  ];

  it('每条错误文案都有英文,英文界面不会漏出中文', () => {
    const messages = allMessages();
    // 7 条刚好覆盖映射表里的 7 条;有分支漏了这里会先失败
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(7);

    for (const message of messages) {
      const en = localizeCalculatorError(message, 'en');
      expect(en).not.toBe(message);
      expect(/[\u4e00-\u9fff]/.test(en)).toBe(false);
    }
  });

  it('中文界面不做替换,原样返回', () => {
    expect(localizeCalculatorError(allMessages()[0], 'zh')).toBe(allMessages()[0]);
    expect(localizeCalculatorError('', 'en')).toBe('');
  });

  it('报出真正出错的字段(多个字段为空时就是多个)', () => {
    expect(getSalaryInputErrorFields({ monthlySalary: '', workingDays: '', dailyHours: '' })).toEqual([
      'monthlySalary',
      'workingDays',
      'dailyHours'
    ]);
    expect(getSalaryInputErrorFields({ monthlySalary: '', workingDays: '21.75', dailyHours: '8' })).toEqual([
      'monthlySalary'
    ]);
    expect(
      getSalaryInputErrorFields({ monthlySalary: '12000', workingDays: '99', dailyHours: '8' })
    ).toEqual(['workingDays']);
    expect(
      getSalaryInputErrorFields({ monthlySalary: '12000', workingDays: '21.75', dailyHours: '8' })
    ).toEqual([]);
  });

  it('加班错误要分清是加班字段本身,还是上方基础输入没填完', () => {
    expect(getOvertimeInputProblem(0, '2', false)).toBe('salaryBase');
    expect(getOvertimeInputProblem(68.9655, '', true)).toBe('overtimeHours');
    expect(getOvertimeInputProblem(68.9655, '99', true)).toBe('overtimeHours');
    expect(getOvertimeInputProblem(68.9655, '2', true)).toBeNull();
  });
});
