export type SalaryCalculatorInput = {
  monthlySalary: string;
  workingDays: string;
  dailyHours: string;
};

export type SalaryCalculatorResult = {
  monthlySalary: number;
  workingDays: number;
  dailyHours: number;
  dailySalary: number;
  hourlySalary: number;
  weeklySalary: number;
};

export type OvertimeCalculatorResult = {
  overtimeHours: number;
  workdayOvertimePay: number;
  restDayOvertimePay: number;
  holidayOvertimePay: number;
};

type NumberValidationOptions = {
  min?: number;
  max?: number;
};

const DEFAULT_NUMBER_MAX = 999999999;

export function sanitizePositiveNumberInput(value: string): string {
  const sanitized = value.replace(/[^\d.]/g, '');
  const firstDotIndex = sanitized.indexOf('.');
  if (firstDotIndex === -1) return sanitized;
  return `${sanitized.slice(0, firstDotIndex + 1)}${sanitized
    .slice(firstDotIndex + 1)
    .replace(/\./g, '')}`;
}

function parsePositiveNumber(value: string, options: NumberValidationOptions = {}): number | null {
  const normalized = String(value || '').trim();
  const min = options.min ?? 0;
  const max = options.max ?? DEFAULT_NUMBER_MAX;

  if (!normalized) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= min) return null;
  if (parsed > max) return null;

  return parsed;
}

/** 工资基础输入的三个字段标识。 */
export type SalaryInputField = 'monthlySalary' | 'workingDays' | 'dailyHours';

type SalaryInputProblem =
  | { kind: 'empty'; fields: SalaryInputField[] }
  | { kind: 'invalid'; field: SalaryInputField };

/**
 * 校验只求值一次,再映射成文案。
 *
 * 为什么不在 `getSalaryInputError` 里直接 return 文案:表单还需要知道**是哪几个字段**
 * 出错了,才能给它们挂 `aria-invalid` / `aria-describedby`(UX/无障碍规范把
 * "只在顶部报一句、不关联到字段"列为高严重度问题)。
 * 两处各写一遍判断迟早会走形,所以判断留在这里一份,文案单独映射。
 */
function evaluateSalaryInput(input: SalaryCalculatorInput): SalaryInputProblem | null {
  const fields: SalaryInputField[] = ['monthlySalary', 'workingDays', 'dailyHours'];
  const empty = fields.filter((field) => !input[field].trim());
  if (empty.length) {
    return { kind: 'empty', fields: empty };
  }

  if (!parsePositiveNumber(input.monthlySalary)) {
    return { kind: 'invalid', field: 'monthlySalary' };
  }

  if (!parsePositiveNumber(input.workingDays, { max: 31 })) {
    return { kind: 'invalid', field: 'workingDays' };
  }

  if (!parsePositiveNumber(input.dailyHours, { max: 24 })) {
    return { kind: 'invalid', field: 'dailyHours' };
  }

  return null;
}

const SALARY_INVALID_TEXT: Record<SalaryInputField, string> = {
  monthlySalary: '月薪需为大于 0 的合法数字',
  workingDays: '计薪天数需为大于 0 且不超过 31 的合法数字',
  dailyHours: '每日工时需为大于 0 且不超过 24 的合法数字'
};

export function getSalaryInputError(input: SalaryCalculatorInput): string {
  const problem = evaluateSalaryInput(input);
  if (!problem) {
    return '';
  }

  return problem.kind === 'empty'
    ? '请先填写月薪、计薪天数和每日工时'
    : SALARY_INVALID_TEXT[problem.field];
}

/**
 * 出错的字段(可能有多个:三个都为空的提示说的就是三个)。
 * 表单据此决定把 `aria-invalid` 挂在谁身上 —— 挂错字段比不挂更糟。
 */
export function getSalaryInputErrorFields(input: SalaryCalculatorInput): SalaryInputField[] {
  const problem = evaluateSalaryInput(input);
  if (!problem) {
    return [];
  }

  return problem.kind === 'empty' ? problem.fields : [problem.field];
}

export function calculateSalaryMetrics(input: SalaryCalculatorInput): SalaryCalculatorResult | null {
  const monthlySalary = parsePositiveNumber(input.monthlySalary);
  const workingDays = parsePositiveNumber(input.workingDays, { max: 31 });
  const dailyHours = parsePositiveNumber(input.dailyHours, { max: 24 });

  if (!monthlySalary || !workingDays || !dailyHours) {
    return null;
  }

  const dailySalary = monthlySalary / workingDays;
  const hourlySalary = dailySalary / dailyHours;
  const weeklySalary = dailySalary * 5;

  return {
    monthlySalary,
    workingDays,
    dailyHours,
    dailySalary,
    hourlySalary,
    weeklySalary
  };
}

/** 加班这一块的错误可能不在加班字段本身,而在"上方基础输入还没填完"。 */
export type OvertimeInputProblem = 'salaryBase' | 'overtimeHours';

function evaluateOvertimeInput(
  hourlySalary: number,
  overtimeHoursInput: string,
  hasSalaryMetrics: boolean
): OvertimeInputProblem | null {
  if (!hasSalaryMetrics || !Number.isFinite(hourlySalary) || hourlySalary <= 0) {
    return 'salaryBase';
  }

  if (!overtimeHoursInput.trim()) {
    return 'overtimeHours';
  }

  if (!parsePositiveNumber(overtimeHoursInput, { max: 24 })) {
    return 'overtimeHours';
  }

  return null;
}

export function getOvertimeInputError(
  hourlySalary: number,
  overtimeHoursInput: string,
  hasSalaryMetrics: boolean
): string {
  const problem = evaluateOvertimeInput(hourlySalary, overtimeHoursInput, hasSalaryMetrics);
  if (problem === 'salaryBase') {
    return '请先完成上方工资基础输入，才能计算加班工资';
  }
  if (problem === 'overtimeHours') {
    return overtimeHoursInput.trim()
      ? '加班时长需为大于 0 且不超过 24 的合法数字'
      : '请输入加班时长';
  }

  return '';
}

/**
 * 加班错误出在谁身上。
 *
 * 表单据此决定要不要把加班时长输入框标成 aria-invalid ——
 * salaryBase 那一条的毛病在**上方的工资基础输入**,标到加班框上是错的。
 */
export function getOvertimeInputProblem(
  hourlySalary: number,
  overtimeHoursInput: string,
  hasSalaryMetrics: boolean
): OvertimeInputProblem | null {
  return evaluateOvertimeInput(hourlySalary, overtimeHoursInput, hasSalaryMetrics);
}

export function calculateOvertimePay(hourlySalary: number, overtimeHoursInput: string): OvertimeCalculatorResult | null {
  if (!Number.isFinite(hourlySalary) || hourlySalary <= 0) {
    return null;
  }

  const overtimeHours = parsePositiveNumber(overtimeHoursInput, { max: 24 });
  if (!overtimeHours) {
    return null;
  }

  return {
    overtimeHours,
    workdayOvertimePay: hourlySalary * overtimeHours * 1.5,
    restDayOvertimePay: hourlySalary * overtimeHours * 2,
    holidayOvertimePay: hourlySalary * overtimeHours * 3
  };
}

/** salaryCalculator 的错误码是稳定的中文串,这里映射到英文,避免 EN 界面里冒出中文报错。 */
const SALARY_ERROR_EN: Record<string, string> = {
  '请先填写月薪、计薪天数和每日工时': 'Please fill in monthly salary, paid days and daily hours first',
  '月薪需为大于 0 的合法数字': 'Monthly salary must be a valid number greater than 0',
  '计薪天数需为大于 0 且不超过 31 的合法数字':
    'Paid days must be a valid number greater than 0 and no more than 31',
  '每日工时需为大于 0 且不超过 24 的合法数字':
    'Daily hours must be a valid number greater than 0 and no more than 24',
  '请先完成上方工资基础输入，才能计算加班工资':
    'Complete the salary inputs above before calculating overtime pay',
  '请输入加班时长': 'Please enter the overtime hours',
  '加班时长需为大于 0 且不超过 24 的合法数字':
    'Overtime hours must be a valid number greater than 0 and no more than 24'
};

export function localizeCalculatorError(error: string, language: string): string {
  if (!error || !language.toLowerCase().startsWith('en')) return error;
  return SALARY_ERROR_EN[error] || error;
}

