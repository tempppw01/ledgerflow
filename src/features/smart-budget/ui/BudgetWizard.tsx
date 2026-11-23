import { formatCurrency } from '../../../shared/lib/format';
import { useTFallback } from '../../../shared/lib/useTFallback';
import { resolveBudgetCategoryLabel } from '../model/budgetCategoryLabels';
import {
  BudgetAnswers,
  BudgetRecommendation,
  UserIdentity,
  getIdentityLabel
} from '../model/budgetPlanner';
import { BudgetCheckIcon, BudgetChevronIcon, BudgetSparkIcon } from './budgetIcons';

export type BudgetWizardProps = {
  answers: BudgetAnswers;
  step: number;
  stepCount: number;
  error: string | null;
  draftRecommendation: BudgetRecommendation | null;
  onAnswersChange: (next: BudgetAnswers) => void;
  onNext: () => void;
  onPrev: () => void;
  onEditCategory: (category: string, amount: number) => void;
  onConfirm: () => void;
  onRestart: () => void;
};

const identityOptions: Array<{ value: UserIdentity; key: string; label: string; hint: string }> = [
  { value: 'student', key: 'student', label: '学生', hint: '固定支出少，时间比较灵活' },
  { value: 'employee', key: 'employee', label: '上班族', hint: '收入稳定，开销结构规律' },
  { value: 'freelancer', key: 'freelancer', label: '自由职业者', hint: '收入波动，需要预留缓冲' },
  { value: 'other', key: 'other', label: '其他', hint: '按通用结构给出一份基准' }
];

const stepMeta = [
  { key: 'identity', short: '身份', title: '你目前是哪种状态？' },
  { key: 'income', short: '收入', title: '每个月大概到手多少？' },
  { key: 'fixed', short: '固定支出', title: '每月固定要付多少？' },
  { key: 'savings', short: '储蓄', title: '想先存下多少？' },
  { key: 'confirm', short: '确认', title: '看看这份预算合不合适' }
];

const ratioQuickOptions = [0.2, 0.3, 0.4, 0.5];
const incomeShortcuts = [5000, 8000, 10000, 15000, 20000];
const fixedShortcuts = [0, 1500, 3000, 5000, 8000];

export function BudgetWizard(props: BudgetWizardProps) {
  const tf = useTFallback();
  const {
    answers,
    step,
    stepCount,
    error,
    draftRecommendation,
    onAnswersChange,
    onNext,
    onPrev,
    onEditCategory,
    onConfirm,
    onRestart
  } = props;

  const currentMeta = stepMeta[Math.min(step - 1, stepMeta.length - 1)];
  const monthlyIncome = Math.max(0, answers.monthlyIncome);
  const monthlyFixedExpense = Math.max(0, answers.monthlyFixedExpense);
  const disposableIncome = Math.max(0, monthlyIncome - monthlyFixedExpense);
  const savingsAmount = disposableIncome * answers.savingsRatio;
  const flexibleAmount = Math.max(0, disposableIncome - savingsAmount);

  const setAmount = (key: 'monthlyIncome' | 'monthlyFixedExpense', value: number) => {
    onAnswersChange({
      ...answers,
      [key]: Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
    });
  };

  const summaryChips = [
    {
      label: tf('smartBudget.wizard.steps.identity.short', '身份'),
      value: tf(`smartBudget.identity.${answers.identity}`, getIdentityLabel(answers.identity))
    },
    {
      label: tf('smartBudget.wizard.steps.income.short', '收入'),
      value: formatCurrency(monthlyIncome)
    },
    {
      label: tf('smartBudget.wizard.summary.fixed', '固定'),
      value: formatCurrency(monthlyFixedExpense)
    },
    {
      label: tf('smartBudget.wizard.steps.savings.short', '储蓄'),
      value: `${Math.round(answers.savingsRatio * 100)}%`
    }
  ];

  return (
    <div className="sb-wizard">
      <section
        className="sb-wizard-intro"
        aria-label={tf('smartBudget.wizard.introAria', '当前步骤说明')}
      >
        <div className="sb-wizard-intro-main">
          <span className="sb-wizard-kicker">
            {tf('smartBudget.wizard.stepProgress', '第 {step} / {total} 步')
              .replace('{step}', String(step))
              .replace('{total}', String(stepCount))}
          </span>
          <h3>{tf(`smartBudget.wizard.steps.${currentMeta.key}.title`, currentMeta.title)}</h3>
        </div>
        <div className="sb-wizard-summary">
          {summaryChips.map((item) => (
            <span key={item.label}>
              {item.label}
              <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </section>

      <ol className="sb-stepper" aria-label={tf('smartBudget.wizard.stepperAria', '预算问答步骤')}>
        {stepMeta.map((item, index) => {
          const value = index + 1;
          const state = value === step ? 'active' : value < step ? 'done' : '';
          return (
            <li
              key={item.short}
              className={state}
              aria-current={value === step ? 'step' : undefined}
            >
              <span className="sb-stepper-index">
                {value < step ? <BudgetCheckIcon className="sb-icon-sm" /> : value}
              </span>
              <span className="sb-stepper-label">
                {tf(`smartBudget.wizard.steps.${item.key}.short`, item.short)}
              </span>
            </li>
          );
        })}
      </ol>

      {step === 1 ? (
        <section
          className="sb-block"
          aria-label={tf('smartBudget.wizard.identityAria', '身份选择')}
        >
          <div className="sb-choice-grid">
            {identityOptions.map((item) => (
              <label
                key={item.value}
                className={`sb-choice-card ${answers.identity === item.value ? 'is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="sb-identity"
                  value={item.value}
                  checked={answers.identity === item.value}
                  onChange={() => onAnswersChange({ ...answers, identity: item.value })}
                />
                <strong>{tf(`smartBudget.identity.${item.key}`, item.label)}</strong>
                <span>{tf(`smartBudget.identityHint.${item.key}`, item.hint)}</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="sb-block" aria-label={tf('smartBudget.wizard.incomeAria', '月收入')}>
          <label className="sb-field-label" htmlFor="sb-income">
            {tf('smartBudget.wizard.incomeLabel', '每月到手收入')}
          </label>
          <div className="sb-amount-input">
            <span aria-hidden="true">¥</span>
            <input
              id="sb-income"
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              value={Number.isFinite(answers.monthlyIncome) ? answers.monthlyIncome : 0}
              onChange={(event) => setAmount('monthlyIncome', Number(event.target.value))}
            />
          </div>
          <div
            className="sb-shortcut-row"
            role="group"
            aria-label={tf('smartBudget.wizard.incomeShortcutsAria', '收入快捷选择')}
          >
            {incomeShortcuts.map((value) => (
              <button
                key={value}
                type="button"
                className={answers.monthlyIncome === value ? 'is-active' : ''}
                onClick={() => setAmount('monthlyIncome', value)}
              >
                {formatCurrency(value)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section
          className="sb-block"
          aria-label={tf('smartBudget.wizard.steps.fixed.short', '固定支出')}
        >
          <label className="sb-field-label" htmlFor="sb-fixed">
            {tf('smartBudget.wizard.fixedLabel', '固定支出（房租、房贷、通勤、订阅等）')}
          </label>
          <div className="sb-amount-input">
            <span aria-hidden="true">¥</span>
            <input
              id="sb-fixed"
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              value={Number.isFinite(answers.monthlyFixedExpense) ? answers.monthlyFixedExpense : 0}
              onChange={(event) => setAmount('monthlyFixedExpense', Number(event.target.value))}
            />
          </div>
          <div
            className="sb-shortcut-row"
            role="group"
            aria-label={tf('smartBudget.wizard.fixedShortcutsAria', '固定支出快捷选择')}
          >
            {fixedShortcuts.map((value) => (
              <button
                key={value}
                type="button"
                className={answers.monthlyFixedExpense === value ? 'is-active' : ''}
                onClick={() => setAmount('monthlyFixedExpense', value)}
              >
                {value === 0 ? tf('smartBudget.wizard.fixedNone', '没有') : formatCurrency(value)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section
          className="sb-block"
          aria-label={tf('smartBudget.wizard.savingsRatioAria', '储蓄比例')}
        >
          <div
            className="sb-allocation-bar"
            aria-label={tf('smartBudget.wizard.previewAria', '收入分配预览')}
          >
            <div className="sb-allocation-item">
              <span>{tf('smartBudget.wizard.preview.disposable', '可支配')}</span>
              <strong>{formatCurrency(disposableIncome)}</strong>
            </div>
            <div className="sb-allocation-item">
              <span>{tf('smartBudget.wizard.preview.savings', '先存下')}</span>
              <strong>{formatCurrency(savingsAmount)}</strong>
            </div>
            <div className="sb-allocation-item is-accent">
              <span>{tf('smartBudget.wizard.preview.flexible', '可自由支配')}</span>
              <strong>{formatCurrency(flexibleAmount)}</strong>
            </div>
          </div>

          <div
            className="sb-ratio-options"
            role="group"
            aria-label={tf('smartBudget.wizard.savingsShortcutsAria', '储蓄比例快捷选择')}
          >
            {ratioQuickOptions.map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={Math.abs(answers.savingsRatio - ratio) < 0.005 ? 'is-active' : ''}
                onClick={() => onAnswersChange({ ...answers, savingsRatio: ratio })}
              >
                {Math.round(ratio * 100)}%
              </button>
            ))}
          </div>

          <label className="sb-field-label" htmlFor="sb-savings-range">
            {tf('smartBudget.wizard.currentSavingsRatio', '当前储蓄比例')}{' '}
            {Math.round(answers.savingsRatio * 100)}%
          </label>
          <input
            id="sb-savings-range"
            type="range"
            min={10}
            max={60}
            step={1}
            value={Math.round(answers.savingsRatio * 100)}
            onChange={(event) =>
              onAnswersChange({ ...answers, savingsRatio: Number(event.target.value) / 100 })
            }
          />
        </section>
      ) : null}

      {step === 5 && draftRecommendation ? (
        <section className="sb-block" aria-label={tf('smartBudget.wizard.confirmAria', '预算确认')}>
          <div className="sb-result-grid">
            <article>
              <span>{tf('smartBudget.wizard.confirm.monthlyIncome', '每月到手')}</span>
              <strong>{formatCurrency(draftRecommendation.monthlyIncome)}</strong>
            </article>
            <article>
              <span>{tf('smartBudget.wizard.confirm.fixedBills', '固定账单')}</span>
              <strong>{formatCurrency(draftRecommendation.monthlyFixedExpense)}</strong>
            </article>
            <article>
              <span>{tf('smartBudget.wizard.confirm.savingsFirst', '先存起来')}</span>
              <strong>{formatCurrency(draftRecommendation.savingsAmount)}</strong>
            </article>
            <article>
              <span>{tf('smartBudget.wizard.confirm.flexibleDaily', '日常可灵活使用')}</span>
              <strong>{formatCurrency(draftRecommendation.flexibleBudget)}</strong>
            </article>
          </div>

          <div className="sb-edit-hint">
            <BudgetSparkIcon className="sb-icon-sm" />
            <span>
              {tf(
                'smartBudget.wizard.rebalanceHint',
                '改任意一格，其他分类会自动按比例回填，总额始终等于月收入。'
              )}
            </span>
          </div>

          <div className="sb-category-table-wrap">
            <table className="sb-category-table">
              <thead>
                <tr>
                  <th scope="col">{tf('smartBudget.wizard.table.category', '分类')}</th>
                  <th scope="col">{tf('smartBudget.wizard.table.amount', '金额')}</th>
                  <th scope="col">{tf('smartBudget.wizard.table.share', '占收入')}</th>
                </tr>
              </thead>
              <tbody>
                {draftRecommendation.categoryBudgets.map((row) => (
                  <tr key={row.category}>
                    <td>{resolveBudgetCategoryLabel(row.category, tf)}</td>
                    <td>
                      <div className="sb-amount-input is-compact">
                        <span aria-hidden="true">¥</span>
                        <input
                          aria-label={tf(
                            'smartBudget.wizard.categoryAmountAria',
                            '{category}预算金额'
                          ).replace('{category}', resolveBudgetCategoryLabel(row.category, tf))}
                          type="number"
                          min={0}
                          step={100}
                          value={row.amount}
                          onChange={(event) =>
                            onEditCategory(row.category, Number(event.target.value))
                          }
                        />
                      </div>
                    </td>
                    <td className="sb-number">{(row.ratio * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="sb-rigid-note">
            {tf(
              'smartBudget.wizard.rigidNote',
              '住房、还款、保险、税费、水电燃气、通讯这类刚性支出已算进上面的「固定账单」\uFF0C不再单列预算 —— 它们每月数额固定,不该和餐饮、娱乐抢同一笔灵活额度。'
            )}
          </p>

          <div className="sb-actions">
            <button type="button" className="sb-btn sb-btn--primary" onClick={onConfirm}>
              <BudgetCheckIcon className="sb-icon-sm" />
              {tf('smartBudget.wizard.confirmPlan', '就用这份预算')}
            </button>
            <button type="button" className="sb-btn" onClick={onRestart}>
              {tf('smartBudget.wizard.restart', '重新答一遍')}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="sb-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="sb-wizard-footer">
        <button type="button" className="sb-btn" onClick={onPrev} disabled={step === 1}>
          {tf('smartBudget.wizard.prev', '上一步')}
        </button>
        <button
          type="button"
          className="sb-btn sb-btn--primary"
          onClick={onNext}
          disabled={step >= stepCount}
        >
          {step === stepCount - 1
            ? tf('smartBudget.wizard.generate', '生成预算推荐')
            : tf('smartBudget.wizard.next', '下一步')}
          {step < stepCount - 1 ? <BudgetChevronIcon className="sb-icon-sm" /> : null}
        </button>
      </footer>
    </div>
  );
}
