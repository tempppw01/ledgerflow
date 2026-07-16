import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BOT_ICON_URL,
  INVESTMENTS_ICON_URL,
  USER_ICON_URL
} from '../../shared/config/brandAssets';
import { formatCurrencyAuto } from '../../shared/lib/format';
import type { Account } from '../../entities/account/types';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import type {
  InvestmentAiMessage,
  InvestmentFundAnalysis,
  InvestmentPositionHistoryEntry,
  InvestmentWatchItem
} from '../../entities/investment/types';
import { InvestmentAiMessageDetails } from '../../features/assistant/investment-chat/InvestmentAiMessageDetails';

type WatchDetailSection = {
  title: string;
  items: string[];
};

function getMonthBounds() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1)
  };
}

function formatFlowTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatHistoryAction(action: InvestmentPositionHistoryEntry['action']) {
  return {
    add: '新增',
    update: '更新',
    remove: '移除',
    snapshot: '快照'
  }[action];
}

function formatRiskLabel(level?: InvestmentWatchItem['lastRiskLevel']) {
  if (level === 'low') return '低风险';
  if (level === 'medium') return '中风险';
  if (level === 'high') return '高风险';
  return '待判断';
}

function formatAnalysisRiskLabel(level?: InvestmentFundAnalysis['riskLevel']) {
  if (level === 'low') return '低风险';
  if (level === 'medium') return '中风险';
  if (level === 'high') return '高风险';
  return '待判断';
}

function getMessageTitle(item: InvestmentAiMessage) {
  if (item.role === 'user') return '用户提问';
  return item.analysis?.fundName || item.analysis?.fundCode || 'AI 复盘';
}

function compactWatchDetailSections(item: InvestmentWatchItem): WatchDetailSection[] {
  return [
    { title: '历史业绩', items: item.performanceHistory || [] },
    { title: '基金分析', items: item.fundAnalysis || [] },
    { title: '基金持仓', items: item.fundHoldings || [] },
    { title: '资产分布', items: item.assetAllocation || [] },
    { title: '行业分布', items: item.industryAllocation || [] },
    { title: '买入费率', items: item.buyFeeRate ? [item.buyFeeRate] : [] },
    { title: '基金公司', items: item.fundCompany ? [item.fundCompany] : [] },
    { title: '判断依据', items: item.adviceReasons || [] },
    { title: '风险提示', items: item.riskNotes || [] },
    { title: '下一步', items: item.nextActions || [] },
    { title: '备注', items: item.note ? [item.note] : [] }
  ].filter((section) => section.items.length > 0);
}

function isPositiveAccount(account: Account) {
  return account.type !== 'liability' && account.type !== 'credit';
}

export function InvestmentFlowPage() {
  const navigate = useNavigate();
  const positions = useAppPreferences((state) => state.investmentPositions);
  const investmentPositionHistory = useAppPreferences((state) => state.investmentPositionHistory);
  const goals = useAppPreferences((state) => state.investmentGoals);
  const investmentWatchlist = useAppPreferences((state) => state.investmentWatchlist);
  const investmentAiMessages = useAppPreferences((state) => state.investmentAiMessages);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const transactions = useFinanceStore((state) => state.transactions);
  const accounts = useFinanceStore((state) => state.accounts);
  const debts = useAppPreferences((state) => state.debts);

  const activePositions = useMemo(
    () => positions.filter((item) => item.isActive),
    [positions]
  );

  const watchlistRows = useMemo(
    () =>
      [...investmentWatchlist].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [investmentWatchlist]
  );

  const historyRows = useMemo(
    () =>
      [...investmentPositionHistory].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [investmentPositionHistory]
  );

  const messageRows = useMemo(
    () =>
      [...investmentAiMessages].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [investmentAiMessages]
  );

  const monthSummary = useMemo(() => {
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
      incomeTotal,
      expenseTotal,
      netBalance: incomeTotal - expenseTotal
    };
  }, [transactions]);

  const monthlyInvestableCash = useMemo(() => {
    const baseline = monthlyIncome > 0 ? monthlyIncome - monthSummary.expenseTotal : monthSummary.netBalance;
    return Math.max(0, baseline);
  }, [monthSummary.expenseTotal, monthSummary.netBalance, monthlyIncome]);

  const goalSummary = useMemo(() => {
    const totalTargetAmount = goals.reduce((sum, item) => sum + item.targetAmount, 0);
    const totalCurrentAmount = goals.reduce((sum, item) => sum + item.currentAmount, 0);
    const totalGap = Math.max(0, totalTargetAmount - totalCurrentAmount);
    const totalMonthlyContribution = goals.reduce(
      (sum, item) => sum + (item.monthlyContribution || 0),
      0
    );

    return {
      totalTargetAmount,
      totalCurrentAmount,
      totalGap,
      totalMonthlyContribution
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

  const estimatedNetAssets = Math.max(
    0,
    accountAssetBalance + activePositions.reduce((sum, item) => sum + item.currentValue, 0) - debtBalance
  );

  const summaryCards = [
    { label: '自选基金', value: `${watchlistRows.length} 只` },
    { label: '活跃持仓', value: `${activePositions.length} 笔` },
    { label: '持仓流水', value: `${historyRows.length} 条` },
    { label: 'AI 复盘', value: `${messageRows.length} 条` },
    {
      label: '理财目标',
      value: `${goals.length} 个 · 缺口 ${formatCurrencyAuto(goalSummary.totalGap)}`
    },
    { label: '月度可投', value: formatCurrencyAuto(monthlyInvestableCash) },
    { label: '估算净资产', value: formatCurrencyAuto(estimatedNetAssets) }
  ];

  return (
    <div className="page-stack investments-flow-page">
      <section className="panel investments-flow-hero">
        <div className="investments-flow-hero-copy">
          <span className="investments-kicker">投资风向</span>
          <h2>基金自选与详细流水</h2>
          <p>把基金判断、持仓变化和 AI 复盘放到同一页，回看时不用来回切页。</p>
        </div>
        <div className="investments-flow-actions">
          <button type="button" className="button-with-icon" onClick={() => navigate('/investments')}>
            <img src={INVESTMENTS_ICON_URL} alt="" aria-hidden="true" />
            返回投资页
          </button>
        </div>
      </section>

      <section className="investments-flow-summary" aria-label="投资风向摘要">
        {summaryCards.map((item) => (
          <article key={item.label} className="investments-flow-summary-card">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className="investments-flow-grid">
        <article className="panel investments-flow-card">
          <div className="investments-section-head">
            <div>
              <h3>基金自选详细流水</h3>
              <p>先看结论，再展开深层字段，适合做复盘和筛选。</p>
            </div>
            <span className="badge">{watchlistRows.length} 只</span>
          </div>

          {watchlistRows.length === 0 ? (
            <div className="investments-flow-empty">
              <strong>还没有自选基金</strong>
              <p>先在主投资页加入几只基金，之后这里就会出现完整流水。</p>
            </div>
          ) : (
            <div className="investments-flow-watch-list">
              {watchlistRows.map((item) => {
                const detailSections = compactWatchDetailSections(item);
                const keyStats = [
                  { label: '净值', value: item.netValue || '待更新' },
                  { label: '收益', value: item.addedReturn || '待更新' },
                  { label: '持有', value: item.holdingReturn || '待更新' },
                  { label: '费率', value: item.buyFeeRate || '待更新' },
                  { label: '基金公司', value: item.fundCompany || '待更新' }
                ];

                return (
                  <article key={item.id} className="investments-watch-card investments-flow-watch-card is-expanded">
                    <div className="investments-watch-card-head">
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {item.code || '未记录代码'}
                          {item.platform ? ` · ${item.platform}` : ''}
                        </p>
                      </div>
                      <div className="investments-watch-card-actions">
                        {item.lastRiskLevel ? <span className="badge">{formatRiskLabel(item.lastRiskLevel)}</span> : null}
                        <span className="badge">更新 {formatFlowTime(item.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="investments-watch-card-brief">
                      <strong>{item.investmentAdvice || item.lastVerdict || '等待下一轮分析'}</strong>
                      {item.tags[0] ? <span className="badge">{item.tags[0]}</span> : null}
                    </div>

                    {item.lastSummary ? <p className="investments-watch-card-summary">{item.lastSummary}</p> : null}

                    <div className="investments-watch-card-fund-grid" aria-label="基金关键数据">
                      {keyStats.map((stat) => (
                        <span key={`${item.id}-${stat.label}`}>
                          <em>{stat.label}</em>
                          <strong className="investments-money">{stat.value}</strong>
                        </span>
                      ))}
                    </div>

                    <details className="investments-flow-detail-toggle">
                      <summary>
                        <span>展开详细字段</span>
                        <small>{detailSections.length} 个字段</small>
                      </summary>
                      <div className="investments-flow-detail-grid">
                        {detailSections.map((section) => (
                          <section key={`${item.id}-${section.title}`} className="investments-flow-detail-item">
                            <span>{section.title}</span>
                            <p>{section.items.join(' / ')}</p>
                          </section>
                        ))}
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel investments-flow-card">
          <div className="investments-section-head">
            <div>
              <h3>持仓流水</h3>
              <p>把新增、更新、移除和快照放在一起，回看更像交易账本。</p>
            </div>
            <span className="badge">{historyRows.length} 条</span>
          </div>

          {historyRows.length === 0 ? (
            <div className="investments-flow-empty">
              <strong>还没有持仓流水</strong>
              <p>新增或编辑持仓后，这里会自动积累历史记录。</p>
            </div>
          ) : (
            <div className="investments-history-table investments-flow-history-table" role="table" aria-label="持仓流水">
              <div className="investments-history-row is-head" role="row">
                <span role="columnheader">时间</span>
                <span role="columnheader">动作 / 标的</span>
                <span role="columnheader">当前市值</span>
                <span role="columnheader">变动</span>
                <span role="columnheader">收益</span>
              </div>
              {historyRows.map((item) => (
                <div key={item.id} className="investments-history-row" role="row">
                  <span role="cell" className="investments-history-date investments-money">
                    {formatFlowTime(item.createdAt)}
                  </span>
                  <span role="cell" className="investments-history-asset">
                    <strong>{item.positionName}</strong>
                    <small>
                      {formatHistoryAction(item.action)} · {item.category}
                      {item.platform ? ` · ${item.platform}` : ''}
                    </small>
                  </span>
                  <span role="cell" className="investments-history-amount investments-money">
                    {formatCurrencyAuto(item.currentValue)}
                  </span>
                  <span role="cell" className="investments-history-delta investments-money">
                    {typeof item.currentValueDelta === 'number'
                      ? formatCurrencyAuto(item.currentValueDelta)
                      : '—'}
                  </span>
                  <span
                    role="cell"
                    className={`investments-history-profit investments-money ${item.profit >= 0 ? 'positive' : 'negative'}`}
                  >
                    {formatCurrencyAuto(item.profit)} / {(item.profitRate * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel investments-flow-card">
          <div className="investments-section-head">
            <div>
              <h3>AI 复盘流水</h3>
              <p>问答、判断和追问建议都保留，方便对照每次决策的来龙去脉。</p>
            </div>
            <span className="badge">{messageRows.length} 条</span>
          </div>

          {messageRows.length === 0 ? (
            <div className="investments-flow-empty">
              <strong>还没有 AI 复盘记录</strong>
              <p>发起一次投资分析后，这里会开始记录完整流水。</p>
            </div>
          ) : (
            <div className="investments-flow-ai-list">
              {messageRows.map((item) => (
                <article
                  key={item.id}
                  className={`investments-ai-message ${item.role === 'user' ? 'is-user' : 'is-assistant'}`}
                >
                  <div className="investments-ai-message-avatar" aria-hidden="true">
                    <img src={item.role === 'user' ? USER_ICON_URL : BOT_ICON_URL} alt="" />
                  </div>
                  <div className="investments-ai-bubble">
                    <div className="investments-ai-message-head">
                      <strong>{getMessageTitle(item)}</strong>
                      <span className="investments-money">{formatFlowTime(item.createdAt)}</span>
                    </div>
                    <p>{item.text}</p>
                    <InvestmentAiMessageDetails
                      reasoning={item.reasoning}
                      webTrace={item.webTrace}
                      auxiliaryInfo={item.auxiliaryInfo}
                    />
                    {item.followUpPrompts?.length ? (
                      <div className="investments-follow-up-list">
                        {item.followUpPrompts.map((prompt) => (
                          <span key={prompt} className="badge">
                            {prompt}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.analysis ? (
                      <div className="investments-analysis-card">
                        <div className="investments-analysis-card-head">
                          <div>
                            <strong>{item.analysis.fundName || '基金分析结果'}</strong>
                            <span>
                              {item.analysis.fundCode || '未记录代码'} ·{' '}
                              {formatAnalysisRiskLabel(item.analysis.riskLevel)}
                            </span>
                          </div>
                        </div>
                        <p className="investments-analysis-summary">{item.analysis.summary}</p>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
