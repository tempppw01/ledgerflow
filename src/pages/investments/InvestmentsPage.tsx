import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account } from '../../entities/account/types';
import type {
  InvestmentCategory,
  InvestmentGoal,
  InvestmentGoalKind,
  InvestmentGoalPriority,
  InvestmentPosition,
  InvestmentRiskLevel
} from '../../entities/investment/types';
import { INFO_ICON_URL, QUESTION_ICON_URL } from '../../shared/config/brandAssets';
import { formatCurrency, formatCurrencyAuto, formatDate } from '../../shared/lib/format';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { EmptyState } from '../../shared/ui/EmptyState';

const POSITION_CATEGORY_LABELS: Record<InvestmentCategory, string> = {
  cash: '现金理财',
  'fixed-income': '固收',
  'index-fund': '指数基金',
  'active-fund': '主动基金',
  stock: '股票',
  gold: '黄金',
  other: '其他'
};

const GOAL_KIND_LABELS: Record<InvestmentGoalKind, string> = {
  emergency: '应急金',
  house: '首付/住房',
  travel: '旅行',
  education: '教育',
  retirement: '退休',
  other: '其他'
};

const RISK_LEVEL_LABELS: Record<InvestmentRiskLevel, string> = {
  low: '低波动',
  medium: '均衡',
  high: '进取'
};

const PRIORITY_LABELS: Record<InvestmentGoalPriority, string> = {
  low: '慢慢来',
  medium: '按节奏',
  high: '优先推进'
};

const POSITION_FORM_DEFAULT = {
  name: '',
  category: 'index-fund' as InvestmentCategory,
  platform: '',
  linkedAccountId: '',
  investedAmount: '',
  currentValue: '',
  monthlyContribution: '',
  targetAllocation: '',
  riskLevel: 'medium' as InvestmentRiskLevel,
  note: '',
  isActive: true
};

const GOAL_FORM_DEFAULT = {
  name: '',
  kind: 'emergency' as InvestmentGoalKind,
  targetAmount: '',
  currentAmount: '',
  monthlyContribution: '',
  targetDate: '',
  priority: 'medium' as InvestmentGoalPriority,
  note: ''
};

type InvestmentAlertTone = 'info' | 'warning' | 'danger';

type InvestmentAlert = {
  tone: InvestmentAlertTone;
  title: string;
  description: string;
};

type ActionSuggestion = {
  label: string;
  hint: string;
  to: string;
};

function parseAmountInput(value: string): number {
  const numeric = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function isPositiveAccount(account: Account) {
  return account.type !== 'liability' && account.type !== 'credit';
}

function getMonthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

function getLargestPositionShare(positions: InvestmentPosition[], totalCurrentValue: number) {
  if (positions.length === 0 || totalCurrentValue <= 0) return 0;
  return Math.max(...positions.map((item) => item.currentValue / totalCurrentValue));
}

function buildInvestmentAlerts(params: {
  positions: InvestmentPosition[];
  goals: InvestmentGoal[];
  totalCurrentValue: number;
  cashBucketValue: number;
  monthlyInvestableCash: number;
  totalGoalGap: number;
}): InvestmentAlert[] {
  const alerts: InvestmentAlert[] = [];
  const activePositions = params.positions.filter((item) => item.isActive);

  if (activePositions.length === 0) {
    return [
      {
        tone: 'info',
        title: '先从第一笔持仓开始',
        description: '这页已经准备好接你的基金、股票、固收或现金理财，先录一笔再看配置和提醒。'
      }
    ];
  }

  const largestShare = getLargestPositionShare(activePositions, params.totalCurrentValue);
  if (largestShare >= 0.45) {
    alerts.push({
      tone: 'danger',
      title: '单一持仓占比偏高',
      description: `当前最大持仓约占 ${(largestShare * 100).toFixed(1)}%，仓位有点挤，后续补仓尽量分散。`
    });
  } else if (largestShare >= 0.3) {
    alerts.push({
      tone: 'warning',
      title: '最大持仓已经有点重',
      description: `当前最大持仓约占 ${(largestShare * 100).toFixed(1)}%，再继续加仓前建议先看整体配置。`
    });
  }

  const equityValue = activePositions
    .filter((item) => item.category === 'stock' || item.category === 'index-fund' || item.category === 'active-fund')
    .reduce((sum, item) => sum + item.currentValue, 0);
  const equityShare = params.totalCurrentValue > 0 ? equityValue / params.totalCurrentValue : 0;
  if (equityShare >= 0.7 && params.monthlyInvestableCash <= 0) {
    alerts.push({
      tone: 'danger',
      title: '权益仓位高，现金补给偏紧',
      description: '当前更适合先把现金流站稳，再考虑继续往高波动资产上叠仓。'
    });
  }

  const safeBucketShare = params.totalCurrentValue > 0 ? params.cashBucketValue / params.totalCurrentValue : 0;
  if (params.totalCurrentValue >= 10000 && safeBucketShare < 0.15) {
    alerts.push({
      tone: 'warning',
      title: '低波动仓位偏薄',
      description: '现金理财和固收合计不到 15%，如果你最近还在加仓，记得留一点缓冲垫。'
    });
  }

  if (params.goals.length === 0) {
    alerts.push({
      tone: 'info',
      title: '有持仓了，也该有目标',
      description: '建议至少建一个应急金或中短期理财目标，后面更容易判断每月该投多少。'
    });
  }

  if (params.totalGoalGap > 0 && params.monthlyInvestableCash > 0 && params.monthlyInvestableCash < params.totalGoalGap / 12) {
    alerts.push({
      tone: 'warning',
      title: '目标推进速度有点慢',
      description: '按当前月度可投入空间看，部分目标可能会拖长，建议先分主次。'
    });
  }

  return alerts.slice(0, 4);
}

function buildActionSuggestions(params: {
  hasPositions: boolean;
  monthlyInvestableCash: number;
  alerts: InvestmentAlert[];
}): ActionSuggestion[] {
  if (!params.hasPositions) {
    return [
      {
        label: '先补一笔真实持仓',
        hint: '只填名称、成本和现值也可以，先把页面跑起来。',
        to: '/categories-accounts'
      },
      {
        label: '从记账里找结余',
        hint: '先回交易页看最近有没有稳定结余，再决定每月理财额度。',
        to: '/transactions'
      }
    ];
  }

  const hasDanger = params.alerts.some((item) => item.tone === 'danger');
  if (hasDanger || params.monthlyInvestableCash <= 0) {
    return [
      {
        label: '先收口预算',
        hint: '现在更适合先守现金流，再考虑继续扩大仓位。',
        to: '/smart-budget'
      },
      {
        label: '带着配置去问 AI',
        hint: '如果你想继续拆“该减哪里、该留哪里”，可以把当前持仓带去助手页。',
        to: '/assistant'
      }
    ];
  }

  return [
    {
      label: '继续跟进持仓配置',
      hint: '把目标占比补完整，后面看偏离会更直观。',
      to: '/assistant'
    },
    {
      label: '回交易页核对现金流',
      hint: '每月理财投入最好和真实结余对得上，不要只看想法。',
      to: '/transactions'
    }
  ];
}

export function InvestmentsPage() {
  const navigate = useNavigate();
  const accounts = useFinanceStore((state) => state.accounts);
  const transactions = useFinanceStore((state) => state.transactions);
  const positions = useAppPreferences((state) => state.investmentPositions);
  const goals = useAppPreferences((state) => state.investmentGoals);
  const debts = useAppPreferences((state) => state.debts);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const addInvestmentPosition = useAppPreferences((state) => state.addInvestmentPosition);
  const updateInvestmentPosition = useAppPreferences((state) => state.updateInvestmentPosition);
  const removeInvestmentPosition = useAppPreferences((state) => state.removeInvestmentPosition);
  const addInvestmentGoal = useAppPreferences((state) => state.addInvestmentGoal);
  const updateInvestmentGoal = useAppPreferences((state) => state.updateInvestmentGoal);
  const removeInvestmentGoal = useAppPreferences((state) => state.removeInvestmentGoal);

  const [positionForm, setPositionForm] = useState(POSITION_FORM_DEFAULT);
  const [goalForm, setGoalForm] = useState(GOAL_FORM_DEFAULT);
  const [positionError, setPositionError] = useState('');
  const [goalError, setGoalError] = useState('');
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [pendingDeletePositionId, setPendingDeletePositionId] = useState<string | null>(null);
  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);

  const activePositions = useMemo(
    () => positions.filter((item) => item.isActive),
    [positions]
  );

  const { monthIncomeTotal, monthExpenseTotal, monthNetBalance } = useMemo(() => {
    const { start, end } = getMonthBounds();
    const monthTransactions = transactions.filter((item) => {
      const date = new Date(item.date);
      return date >= start && date < end;
    });

    const incomeTotal = monthTransactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + item.amount, 0);
    const expenseTotal = monthTransactions
      .filter((item) => item.type === 'expense' || item.type === 'repayment')
      .reduce((sum, item) => sum + item.amount, 0);

    return {
      monthIncomeTotal: incomeTotal,
      monthExpenseTotal: expenseTotal,
      monthNetBalance: incomeTotal - expenseTotal
    };
  }, [transactions]);

  const positionSummary = useMemo(() => {
    const totalInvested = activePositions.reduce((sum, item) => sum + item.investedAmount, 0);
    const totalCurrentValue = activePositions.reduce((sum, item) => sum + item.currentValue, 0);
    const totalMonthlyContribution = activePositions.reduce(
      (sum, item) => sum + (item.monthlyContribution || 0),
      0
    );
    const totalProfit = totalCurrentValue - totalInvested;
    const profitRate = totalInvested > 0 ? totalProfit / totalInvested : 0;

    const allocationRows = Object.entries(POSITION_CATEGORY_LABELS)
      .map(([category, label]) => {
        const value = activePositions
          .filter((item) => item.category === category)
          .reduce((sum, item) => sum + item.currentValue, 0);
        const share = totalCurrentValue > 0 ? value / totalCurrentValue : 0;
        return {
          category: category as InvestmentCategory,
          label,
          value,
          share
        };
      })
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);

    return {
      totalInvested,
      totalCurrentValue,
      totalMonthlyContribution,
      totalProfit,
      profitRate,
      allocationRows
    };
  }, [activePositions]);

  const goalSummary = useMemo(() => {
    const totalTargetAmount = goals.reduce((sum, item) => sum + item.targetAmount, 0);
    const totalCurrentAmount = goals.reduce((sum, item) => sum + item.currentAmount, 0);
    const totalGap = Math.max(0, totalTargetAmount - totalCurrentAmount);
    const totalMonthlyContribution = goals.reduce(
      (sum, item) => sum + (item.monthlyContribution || 0),
      0
    );

    const rows = goals.map((item) => ({
      ...item,
      progress: item.targetAmount > 0 ? Math.min(1, item.currentAmount / item.targetAmount) : 0,
      gap: Math.max(0, item.targetAmount - item.currentAmount)
    }));

    return {
      totalTargetAmount,
      totalCurrentAmount,
      totalGap,
      totalMonthlyContribution,
      rows
    };
  }, [goals]);

  const accountAssetBalance = useMemo(
    () =>
      accounts
        .filter(isPositiveAccount)
        .reduce((sum, item) => sum + Math.max(0, Number(item.balance || 0)), 0),
    [accounts]
  );

  const debtBalance = useMemo(
    () => debts.reduce((sum, item) => sum + Math.max(0, Number(item.balance || 0)), 0),
    [debts]
  );

  const monthlyInvestableCash = useMemo(() => {
    const baseline = monthlyIncome > 0 ? monthlyIncome - monthExpenseTotal : monthNetBalance;
    return Math.max(0, baseline);
  }, [monthExpenseTotal, monthNetBalance, monthlyIncome]);

  const estimatedNetAssets = Math.max(
    0,
    accountAssetBalance + positionSummary.totalCurrentValue - debtBalance
  );
  const investmentAssetRatio =
    estimatedNetAssets > 0 ? positionSummary.totalCurrentValue / estimatedNetAssets : 0;

  const cashBucketValue = useMemo(
    () =>
      activePositions
        .filter((item) => item.category === 'cash' || item.category === 'fixed-income')
        .reduce((sum, item) => sum + item.currentValue, 0),
    [activePositions]
  );

  const investmentAlerts = useMemo(
    () =>
      buildInvestmentAlerts({
        positions: activePositions,
        goals,
        totalCurrentValue: positionSummary.totalCurrentValue,
        cashBucketValue,
        monthlyInvestableCash,
        totalGoalGap: goalSummary.totalGap
      }),
    [
      activePositions,
      cashBucketValue,
      goalSummary.totalGap,
      goals,
      monthlyInvestableCash,
      positionSummary.totalCurrentValue
    ]
  );

  const actionSuggestions = useMemo(
    () =>
      buildActionSuggestions({
        hasPositions: activePositions.length > 0,
        monthlyInvestableCash,
        alerts: investmentAlerts
      }),
    [activePositions.length, investmentAlerts, monthlyInvestableCash]
  );

  const pendingDeletePosition = useMemo(
    () => positions.find((item) => item.id === pendingDeletePositionId) ?? null,
    [pendingDeletePositionId, positions]
  );

  const pendingDeleteGoal = useMemo(
    () => goals.find((item) => item.id === pendingDeleteGoalId) ?? null,
    [goals, pendingDeleteGoalId]
  );

  function resetPositionForm() {
    setPositionForm(POSITION_FORM_DEFAULT);
    setEditingPositionId(null);
    setPositionError('');
  }

  function resetGoalForm() {
    setGoalForm(GOAL_FORM_DEFAULT);
    setEditingGoalId(null);
    setGoalError('');
  }

  function submitPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const investedAmount = parseAmountInput(positionForm.investedAmount);
    const currentValue = parseAmountInput(positionForm.currentValue);
    const monthlyContribution = parseAmountInput(positionForm.monthlyContribution);
    const targetAllocation = parseAmountInput(positionForm.targetAllocation);

    if (!positionForm.name.trim()) {
      setPositionError('请先填写持仓名称。');
      return;
    }

    if (investedAmount <= 0) {
      setPositionError('投入本金必须大于 0。');
      return;
    }

    if (currentValue <= 0) {
      setPositionError('当前市值必须大于 0。');
      return;
    }

    const payload = {
      name: positionForm.name.trim(),
      category: positionForm.category,
      platform: positionForm.platform.trim(),
      linkedAccountId: positionForm.linkedAccountId,
      investedAmount,
      currentValue,
      monthlyContribution: monthlyContribution || undefined,
      targetAllocation: targetAllocation || undefined,
      riskLevel: positionForm.riskLevel,
      note: positionForm.note.trim(),
      isActive: positionForm.isActive
    };

    if (editingPositionId) {
      updateInvestmentPosition(editingPositionId, payload);
    } else {
      addInvestmentPosition(payload);
    }

    resetPositionForm();
  }

  function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetAmount = parseAmountInput(goalForm.targetAmount);
    const currentAmount = parseAmountInput(goalForm.currentAmount);
    const monthlyContribution = parseAmountInput(goalForm.monthlyContribution);

    if (!goalForm.name.trim()) {
      setGoalError('请先填写目标名称。');
      return;
    }

    if (targetAmount <= 0) {
      setGoalError('目标金额必须大于 0。');
      return;
    }

    const payload = {
      name: goalForm.name.trim(),
      kind: goalForm.kind,
      targetAmount,
      currentAmount,
      monthlyContribution: monthlyContribution || undefined,
      targetDate: goalForm.targetDate,
      priority: goalForm.priority,
      note: goalForm.note.trim()
    };

    if (editingGoalId) {
      updateInvestmentGoal(editingGoalId, payload);
    } else {
      addInvestmentGoal(payload);
    }

    resetGoalForm();
  }

  return (
    <div className="page-stack investments-page">
      <section className="panel investments-hero">
        <div className="investments-hero-copy">
          <span className="investments-kicker">投资理财</span>
          <h2>看清你的投资节奏和目标进度</h2>
          <p>
            把持仓、现金和理财目标放在一起，日常看一眼就知道现在走到哪一步，接下来该补哪一块。
          </p>
        </div>
        <div className="investments-tip-board" aria-label="投资理财页提示">
          <div className="investments-tip-item">
            <img src={INFO_ICON_URL} alt="" aria-hidden="true" />
            <div>
              <strong>先从常用资产开始</strong>
              <p>先记下你最常看的基金、股票或现金类资产，后面再慢慢补齐也没关系。</p>
            </div>
          </div>
          <div className="investments-tip-item">
            <img src={QUESTION_ICON_URL} alt="" aria-hidden="true" />
            <div>
              <strong>把目标一起放进来</strong>
              <p>金额、时间和优先级越清楚，越容易看懂当前进度和仓位分布。</p>
            </div>
          </div>
        </div>

        <div className="investments-summary-strip" aria-label="投资资产总览">
          <article className="investments-summary-pill">
            <span>总持仓市值</span>
            <strong>{formatCurrencyAuto(positionSummary.totalCurrentValue)}</strong>
          </article>
          <article className="investments-summary-pill">
            <span>累计投入本金</span>
            <strong>{formatCurrencyAuto(positionSummary.totalInvested)}</strong>
          </article>
          <article
            className={`investments-summary-pill ${positionSummary.totalProfit >= 0 ? 'is-positive' : 'is-negative'}`}
          >
            <span>浮动收益</span>
            <strong>
              {formatCurrencyAuto(positionSummary.totalProfit)} / {(positionSummary.profitRate * 100).toFixed(1)}%
            </strong>
          </article>
          <article className="investments-summary-pill">
            <span>本月可投资空间</span>
            <strong>{formatCurrencyAuto(monthlyInvestableCash)}</strong>
          </article>
          <article className="investments-summary-pill">
            <span>投资占估算净资产</span>
            <strong>{(investmentAssetRatio * 100).toFixed(1)}%</strong>
          </article>
          <article className="investments-summary-pill">
            <span>理财目标进度</span>
            <strong>
              {goalSummary.totalTargetAmount > 0
                ? `${((goalSummary.totalCurrentAmount / goalSummary.totalTargetAmount) * 100).toFixed(1)}%`
                : '未开始'}
            </strong>
          </article>
        </div>
      </section>

      <section className="investments-overview-grid">
        <article className="panel investments-overview-card">
          <div className="investments-section-head">
            <div>
              <h3>当前配置</h3>
              <p>先看你的钱现在主要压在哪些桶里。</p>
            </div>
            <span className="badge">{activePositions.length} 笔持仓</span>
          </div>

          {positionSummary.allocationRows.length === 0 ? (
            <p className="muted">还没有可统计的持仓，先新增第一笔再看配置。</p>
          ) : (
            <div className="investments-allocation-list">
              {positionSummary.allocationRows.map((item) => (
                <article key={item.category} className="investments-allocation-row">
                  <div className="investments-allocation-copy">
                    <strong>{item.label}</strong>
                    <span>
                      {formatCurrencyAuto(item.value)} · {(item.share * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="investments-allocation-track" aria-hidden="true">
                    <i style={{ width: `${Math.max(6, item.share * 100)}%` }} />
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="investments-meta-grid">
            <div>
              <span>计划月投入</span>
              <strong>{formatCurrency(positionSummary.totalMonthlyContribution + goalSummary.totalMonthlyContribution)}</strong>
            </div>
            <div>
              <span>账户资产余额</span>
              <strong>{formatCurrencyAuto(accountAssetBalance)}</strong>
            </div>
            <div>
              <span>当前月收入</span>
              <strong>{formatCurrencyAuto(monthlyIncome > 0 ? monthlyIncome : monthIncomeTotal)}</strong>
            </div>
            <div>
              <span>当前月支出</span>
              <strong>{formatCurrencyAuto(monthExpenseTotal)}</strong>
            </div>
          </div>
        </article>

        <article className="panel investments-overview-card">
          <div className="investments-section-head">
            <div>
              <h3>当前提醒</h3>
              <p>尽量说人话，只告诉你现在最值得注意的点。</p>
            </div>
          </div>

          <div className="investments-alert-list">
            {investmentAlerts.map((item) => (
              <article key={item.title} className={`investments-alert-card tone-${item.tone}`}>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </article>
            ))}
          </div>

          <div className="investments-actions-card">
            <h4>顺手下一步</h4>
            <div className="investments-actions-list">
              {actionSuggestions.map((item) => (
                <button key={item.label} type="button" className="investments-action-button" onClick={() => navigate(item.to)}>
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="investments-main-grid">
        <article className="panel investments-panel">
          <div className="investments-section-head">
            <div>
              <h3>{editingPositionId ? '编辑持仓' : '新增持仓'}</h3>
              <p>只填最关键的几项，先把当前配置录完整。</p>
            </div>
          </div>

          <form className="investments-form" onSubmit={submitPosition}>
            <div className="investments-form-grid investments-form-grid-primary">
              <label className="investments-field">
                <span>持仓名称</span>
                <input
                  value={positionForm.name}
                  onChange={(event) => setPositionForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：沪深 300 ETF"
                />
              </label>
              <label className="investments-field">
                <span>资产类别</span>
                <select
                  value={positionForm.category}
                  onChange={(event) =>
                    setPositionForm((prev) => ({ ...prev, category: event.target.value as InvestmentCategory }))
                  }
                >
                  {Object.entries(POSITION_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="investments-field">
                <span>平台 / 券商</span>
                <input
                  value={positionForm.platform}
                  onChange={(event) => setPositionForm((prev) => ({ ...prev, platform: event.target.value }))}
                  placeholder="例如：支付宝 / 天天基金"
                />
              </label>
              <label className="investments-field">
                <span>关联账户（可选）</span>
                <select
                  value={positionForm.linkedAccountId}
                  onChange={(event) => setPositionForm((prev) => ({ ...prev, linkedAccountId: event.target.value }))}
                >
                  <option value="">暂不关联</option>
                  {accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="investments-form-grid">
              <label className="investments-field">
                <span>投入本金</span>
                <input
                  inputMode="decimal"
                  value={positionForm.investedAmount}
                  onChange={(event) =>
                    setPositionForm((prev) => ({ ...prev, investedAmount: event.target.value }))
                  }
                  placeholder="0"
                />
              </label>
              <label className="investments-field">
                <span>当前市值</span>
                <input
                  inputMode="decimal"
                  value={positionForm.currentValue}
                  onChange={(event) =>
                    setPositionForm((prev) => ({ ...prev, currentValue: event.target.value }))
                  }
                  placeholder="0"
                />
              </label>
              <label className="investments-field">
                <span>计划月投入</span>
                <input
                  inputMode="decimal"
                  value={positionForm.monthlyContribution}
                  onChange={(event) =>
                    setPositionForm((prev) => ({ ...prev, monthlyContribution: event.target.value }))
                  }
                  placeholder="可留空"
                />
              </label>
              <label className="investments-field">
                <span>目标占比 %</span>
                <input
                  inputMode="decimal"
                  value={positionForm.targetAllocation}
                  onChange={(event) =>
                    setPositionForm((prev) => ({ ...prev, targetAllocation: event.target.value }))
                  }
                  placeholder="例如 25"
                />
              </label>
              <label className="investments-field">
                <span>风险档位</span>
                <select
                  value={positionForm.riskLevel}
                  onChange={(event) =>
                    setPositionForm((prev) => ({ ...prev, riskLevel: event.target.value as InvestmentRiskLevel }))
                  }
                >
                  {Object.entries(RISK_LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="investments-checkbox">
                <input
                  type="checkbox"
                  checked={positionForm.isActive}
                  onChange={(event) => setPositionForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                <span>继续纳入当前配置统计</span>
              </label>
            </div>

            <label className="investments-field investments-field-wide">
              <span>备注（可选）</span>
              <textarea
                rows={3}
                value={positionForm.note}
                onChange={(event) => setPositionForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="例如：这笔主要作为长期底仓，不着急频繁调整。"
              />
            </label>

            {positionError ? <p className="assistant-wb-issue error">{positionError}</p> : null}

            <div className="investments-actions-row">
              <button type="submit" className="primary">
                {editingPositionId ? '保存持仓' : '新增持仓'}
              </button>
              {editingPositionId ? (
                <button type="button" onClick={resetPositionForm}>
                  取消编辑
                </button>
              ) : null}
            </div>
          </form>

          <div className="investments-list-head">
            <h4>持仓列表</h4>
            <span>{positions.length} 笔</span>
          </div>
          {positions.length === 0 ? (
            <EmptyState
              title="还没有投资持仓"
              description="先录入第一笔基金、股票、黄金或现金理财，后面这页才会开始给出配置和风险提醒。"
              icon="📈"
            />
          ) : (
            <div className="investments-card-list">
              {positions.map((item) => {
                const profit = item.currentValue - item.investedAmount;
                const profitRate = item.investedAmount > 0 ? profit / item.investedAmount : 0;
                return (
                  <article key={item.id} className="investments-card">
                    <div className="investments-card-head">
                      <div>
                        <h4>{item.name}</h4>
                        <p>
                          {POSITION_CATEGORY_LABELS[item.category]}
                          {item.platform ? ` · ${item.platform}` : ''}
                        </p>
                      </div>
                      <div className="investments-card-badges">
                        <span className="badge">{RISK_LEVEL_LABELS[item.riskLevel]}</span>
                        {!item.isActive ? <span className="badge">已归档</span> : null}
                      </div>
                    </div>

                    <div className="investments-card-grid" aria-label="持仓摘要">
                      <span>
                        <em>本金</em>
                        <strong>{formatCurrency(item.investedAmount)}</strong>
                      </span>
                      <span>
                        <em>现值</em>
                        <strong>{formatCurrency(item.currentValue)}</strong>
                      </span>
                      <span>
                        <em>收益</em>
                        <strong className={profit >= 0 ? 'positive' : 'negative'}>
                          {formatCurrency(profit)} / {(profitRate * 100).toFixed(1)}%
                        </strong>
                      </span>
                      <span>
                        <em>月投入</em>
                        <strong>{item.monthlyContribution ? formatCurrency(item.monthlyContribution) : '未设置'}</strong>
                      </span>
                    </div>

                    {item.note ? <p className="investments-card-note">{item.note}</p> : null}

                    <div className="investments-actions-inline">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPositionId(item.id);
                          setPositionError('');
                          setPositionForm({
                            name: item.name,
                            category: item.category,
                            platform: item.platform || '',
                            linkedAccountId: item.linkedAccountId || '',
                            investedAmount: String(item.investedAmount),
                            currentValue: String(item.currentValue),
                            monthlyContribution: item.monthlyContribution ? String(item.monthlyContribution) : '',
                            targetAllocation: item.targetAllocation ? String(item.targetAllocation) : '',
                            riskLevel: item.riskLevel,
                            note: item.note || '',
                            isActive: item.isActive
                          });
                        }}
                      >
                        编辑
                      </button>
                      <button type="button" className="danger" onClick={() => setPendingDeletePositionId(item.id)}>
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel investments-panel">
          <div className="investments-section-head">
            <div>
              <h3>{editingGoalId ? '编辑理财目标' : '新增理财目标'}</h3>
              <p>目标会帮你判断“现在这笔钱是长期仓位，还是短期要用的钱”。</p>
            </div>
          </div>

          <form className="investments-form" onSubmit={submitGoal}>
            <div className="investments-form-grid investments-form-grid-primary">
              <label className="investments-field">
                <span>目标名称</span>
                <input
                  value={goalForm.name}
                  onChange={(event) => setGoalForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：6 个月应急金"
                />
              </label>
              <label className="investments-field">
                <span>目标类型</span>
                <select
                  value={goalForm.kind}
                  onChange={(event) =>
                    setGoalForm((prev) => ({ ...prev, kind: event.target.value as InvestmentGoalKind }))
                  }
                >
                  {Object.entries(GOAL_KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="investments-field">
                <span>优先级</span>
                <select
                  value={goalForm.priority}
                  onChange={(event) =>
                    setGoalForm((prev) => ({ ...prev, priority: event.target.value as InvestmentGoalPriority }))
                  }
                >
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="investments-form-grid">
              <label className="investments-field">
                <span>目标金额</span>
                <input
                  inputMode="decimal"
                  value={goalForm.targetAmount}
                  onChange={(event) => setGoalForm((prev) => ({ ...prev, targetAmount: event.target.value }))}
                  placeholder="0"
                />
              </label>
              <label className="investments-field">
                <span>当前进度金额</span>
                <input
                  inputMode="decimal"
                  value={goalForm.currentAmount}
                  onChange={(event) => setGoalForm((prev) => ({ ...prev, currentAmount: event.target.value }))}
                  placeholder="0"
                />
              </label>
              <label className="investments-field">
                <span>计划月投入</span>
                <input
                  inputMode="decimal"
                  value={goalForm.monthlyContribution}
                  onChange={(event) =>
                    setGoalForm((prev) => ({ ...prev, monthlyContribution: event.target.value }))
                  }
                  placeholder="可留空"
                />
              </label>
              <label className="investments-field">
                <span>目标日期</span>
                <input
                  type="date"
                  value={goalForm.targetDate}
                  onChange={(event) => setGoalForm((prev) => ({ ...prev, targetDate: event.target.value }))}
                />
              </label>
            </div>

            <label className="investments-field investments-field-wide">
              <span>备注（可选）</span>
              <textarea
                rows={3}
                value={goalForm.note}
                onChange={(event) => setGoalForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="例如：这笔钱不想承担太大波动，所以先放低风险桶里。"
              />
            </label>

            {goalError ? <p className="assistant-wb-issue error">{goalError}</p> : null}

            <div className="investments-actions-row">
              <button type="submit" className="primary">
                {editingGoalId ? '保存目标' : '新增目标'}
              </button>
              {editingGoalId ? (
                <button type="button" onClick={resetGoalForm}>
                  取消编辑
                </button>
              ) : null}
            </div>
          </form>

          <div className="investments-list-head">
            <h4>理财目标</h4>
            <span>{goals.length} 个</span>
          </div>

          {goals.length === 0 ? (
            <EmptyState
              title="还没有理财目标"
              description="先建一个应急金或中短期目标，后面页面给出的提醒会更贴近你的现实需求。"
              icon="🎯"
            />
          ) : (
            <div className="investments-card-list">
              {goalSummary.rows.map((item) => (
                <article key={item.id} className="investments-card">
                  <div className="investments-card-head">
                    <div>
                      <h4>{item.name}</h4>
                      <p>
                        {GOAL_KIND_LABELS[item.kind]} · {PRIORITY_LABELS[item.priority]}
                      </p>
                    </div>
                    <div className="investments-card-badges">
                      <span className="badge">
                        {item.targetDate ? `目标日 ${formatDate(item.targetDate)}` : '未设日期'}
                      </span>
                    </div>
                  </div>

                  <div className="investments-goal-progress">
                    <div className="investments-goal-progress-head">
                      <strong>{formatCurrency(item.currentAmount)}</strong>
                      <span>目标 {formatCurrency(item.targetAmount)}</span>
                    </div>
                    <div className="investments-allocation-track" aria-hidden="true">
                      <i style={{ width: `${Math.max(6, item.progress * 100)}%` }} />
                    </div>
                    <p className="muted">
                      已完成 {(item.progress * 100).toFixed(1)}%，还差 {formatCurrency(item.gap)}
                      {item.monthlyContribution ? ` · 计划每月投入 ${formatCurrency(item.monthlyContribution)}` : ''}
                    </p>
                  </div>

                  {item.note ? <p className="investments-card-note">{item.note}</p> : null}

                  <div className="investments-actions-inline">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGoalId(item.id);
                        setGoalError('');
                        setGoalForm({
                          name: item.name,
                          kind: item.kind,
                          targetAmount: String(item.targetAmount),
                          currentAmount: String(item.currentAmount),
                          monthlyContribution: item.monthlyContribution ? String(item.monthlyContribution) : '',
                          targetDate: item.targetDate || '',
                          priority: item.priority,
                          note: item.note || ''
                        });
                      }}
                    >
                      编辑
                    </button>
                    <button type="button" className="danger" onClick={() => setPendingDeleteGoalId(item.id)}>
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>

      <ConfirmDialog
        open={Boolean(pendingDeletePosition)}
        title="删除持仓"
        description={
          pendingDeletePosition ? (
            <>
              确认删除「<strong>{pendingDeletePosition.name}</strong>」吗？删除后当前配置、收益和提醒都会一起更新。
            </>
          ) : (
            ''
          )
        }
        confirmText="删除持仓"
        cancelText="取消"
        danger
        onCancel={() => setPendingDeletePositionId(null)}
        onConfirm={() => {
          if (pendingDeletePosition) {
            removeInvestmentPosition(pendingDeletePosition.id);
            if (editingPositionId === pendingDeletePosition.id) {
              resetPositionForm();
            }
          }
          setPendingDeletePositionId(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteGoal)}
        title="删除目标"
        description={
          pendingDeleteGoal ? (
            <>
              确认删除「<strong>{pendingDeleteGoal.name}</strong>」吗？删掉后这条目标进度和相关提醒会一起消失。
            </>
          ) : (
            ''
          )
        }
        confirmText="删除目标"
        cancelText="取消"
        danger
        onCancel={() => setPendingDeleteGoalId(null)}
        onConfirm={() => {
          if (pendingDeleteGoal) {
            removeInvestmentGoal(pendingDeleteGoal.id);
            if (editingGoalId === pendingDeleteGoal.id) {
              resetGoalForm();
            }
          }
          setPendingDeleteGoalId(null);
        }}
      />
    </div>
  );
}
