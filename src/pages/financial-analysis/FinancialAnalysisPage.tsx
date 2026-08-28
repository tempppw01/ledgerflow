import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import {
  analyzeFinancialOverview,
  FINANCIAL_ANALYSIS_RANGE_OPTIONS,
  type FinancialAnalysisRangeKey
} from '../../features/financial-analysis/model/analysis';
import {
  BADGE_DOLLAR_SIGN_ICON_URL,
  SCALE_ICON_URL
} from '../../shared/config/brandAssets';
import { formatCurrency } from '../../shared/lib/format';
import { useAiSettings } from '../../shared/store/useAiSettings';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { useFinanceStore } from '../../shared/store/useFinanceStore';
import { EmptyState } from '../../shared/ui/EmptyState';

interface AiBehaviorAnalysisPayload {
  summary: string;
  habits: string[];
  avoidable: string[];
  profile: string;
  confidenceNote: string;
}

interface AiFinancialAnalysisPayload {
  summary: string;
  past: string[];
  present: string[];
  future: string[];
  actions: Array<{
    label: string;
    to: string;
  }>;
  behavior?: AiBehaviorAnalysisPayload;
}

function behaviorToneClass(tone?: 'default' | 'warning' | 'success'): string {
  if (tone === 'warning') return 'warning';
  return '';
}

interface FinancialAnalysisQuickAction {
  label: string;
  hint: string;
  onClick: () => void;
}

interface FinancialAnalysisMarketRow {
  label: string;
  income: number;
  expense: number;
  net: number;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function metricValue(label: string, value: number, help?: string): string {
  if (help === '百分比') {
    return formatPercent(value);
  }
  if (label.includes('率') && Math.abs(value) <= 100) {
    return formatPercent(value);
  }
  return formatCurrency(value);
}

function extractJson(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

function normalizeAiPayload(raw: unknown): AiFinancialAnalysisPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw as Partial<AiFinancialAnalysisPayload>;
  const summary = String(payload.summary || '').trim();
  const normalizeList = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
      : [];
  const actions = Array.isArray(payload.actions)
    ? payload.actions
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const next = item as { label?: unknown; to?: unknown };
          const label = String(next.label || '').trim();
          const to = String(next.to || '').trim();
          if (!label || !to) return null;
          return { label, to };
        })
        .filter((item): item is { label: string; to: string } => Boolean(item))
        .slice(0, 3)
    : [];

  if (!summary) {
    return null;
  }

  const behavior =
    payload.behavior && typeof payload.behavior === 'object'
      ? (() => {
          const rawBehavior = payload.behavior as Partial<AiBehaviorAnalysisPayload>;
          const profile = String(rawBehavior.profile || '').trim();
          const behaviorSummary = String(rawBehavior.summary || '').trim();
          const confidenceNote = String(rawBehavior.confidenceNote || '').trim();
          const habits = normalizeList(rawBehavior.habits);
          const avoidable = normalizeList(rawBehavior.avoidable);

          if (!profile && !behaviorSummary && habits.length === 0 && avoidable.length === 0) {
            return undefined;
          }

          return {
            summary: behaviorSummary || 'AI 已结合当前账本补充行为判断。',
            habits,
            avoidable,
            profile: profile || 'AI 暂未形成稳定画像',
            confidenceNote: confidenceNote || '该结论由 AI 结合当前账本样本生成，仍需与你的真实消费背景一起判断。'
          };
        })()
      : undefined;

  return {
    summary,
    past: normalizeList(payload.past),
    present: normalizeList(payload.present),
    future: normalizeList(payload.future),
    actions,
    behavior
  };
}

function buildTransactionsLink(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') {
      return;
    }
    search.set(key, String(value));
  });

  const query = search.toString();
  return query ? `/transactions?${query}` : '/transactions';
}

function formatDelta(value: number) {
  return `${value >= 0 ? '+' : ''}${formatCurrency(value)}`;
}

function getRangeDateBounds(range: { key: FinancialAnalysisRangeKey; days: number | null }) {
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (range.key === 'month') {
    const start = new Date(current.getFullYear(), current.getMonth(), 1);
    return {
      from: start.toISOString().slice(0, 10),
      to: current.toISOString().slice(0, 10)
    };
  }

  const days = Math.max(1, range.days || 30);
  const start = new Date(current);
  start.setDate(start.getDate() - (days - 1));

  return {
    from: start.toISOString().slice(0, 10),
    to: current.toISOString().slice(0, 10)
  };
}

export function FinancialAnalysisPage() {
  const navigate = useNavigate();
  const [rangeKey, setRangeKey] = useState<FinancialAnalysisRangeKey>('30d');
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [aiUpdatedAt, setAiUpdatedAt] = useState('');
  const [aiResult, setAiResult] = useState<AiFinancialAnalysisPayload | null>(null);

  const transactions = useFinanceStore((state) => state.transactions);
  const categories = useFinanceStore((state) => state.categories);
  const accounts = useFinanceStore((state) => state.accounts);
  const subscriptions = useFinanceStore((state) => state.subscriptions);
  const debts = useAppPreferences((state) => state.debts);
  const repaymentRecords = useAppPreferences((state) => state.repaymentRecords);
  const monthlyIncome = useAppPreferences((state) => state.monthlyIncome);
  const baseUrl = useAiSettings((state) => state.baseUrl);
  const apiKey = useAiSettings((state) => state.apiKey);
  const model = useAiSettings((state) => state.model);

  const range =
    FINANCIAL_ANALYSIS_RANGE_OPTIONS.find((item) => item.key === rangeKey) ||
    FINANCIAL_ANALYSIS_RANGE_OPTIONS[1];

  const analysis = useMemo(
    () =>
      analyzeFinancialOverview({
        range,
        transactions,
        categories,
        accounts,
        subscriptions,
        debts,
        repaymentRecords,
        monthlyIncome
      }),
    [accounts, categories, debts, monthlyIncome, range, repaymentRecords, subscriptions, transactions]
  );

  const aiInput = useMemo(
    () => ({
      range: range.label,
      transactionCount: analysis.transactionCount,
      sampleDays: analysis.sampleDays,
      summaryLine: analysis.summaryLine,
      confidenceNote: analysis.confidenceNote,
      metrics: analysis.metrics,
      trendDeltaPct: analysis.trendDeltaPct,
      previous: {
        topCategoryName: analysis.previous.topCategoryName,
        topCategoryAmount: analysis.previous.topCategoryAmount,
        topCategoryShare: analysis.previous.topCategoryShare,
        recentAverageDailyExpense: analysis.previous.recentAverageDailyExpense,
        abnormalExpense: analysis.previous.abnormalExpense
          ? {
              date: analysis.previous.abnormalExpense.date,
              note: analysis.previous.abnormalExpense.note,
              amount: analysis.previous.abnormalExpense.amount
            }
          : null,
        categoryRows: analysis.previous.categoryRows
      },
      present: {
        fixedExpenseAmount: analysis.present.fixedExpenseAmount,
        fixedExpenseRatio: analysis.present.fixedExpenseRatio,
        subscriptionMonthlyCost: analysis.present.subscriptionMonthlyCost,
        debtPressureRatio: analysis.present.debtPressureRatio,
        debtHealthScore: analysis.present.debtHealthScore,
        disposableIncome: analysis.present.disposableIncome
      },
      future: {
        projectedMonthlyBalance: analysis.future.projectedMonthlyBalance,
        suggestedBuffer: analysis.future.suggestedBuffer,
        dueSoonSubscriptionCount: analysis.future.dueSoonSubscriptionCount,
        dueSoonRepaymentCount: analysis.future.dueSoonRepaymentCount
      },
      behavior: {
        habits: analysis.behavior.habits,
        avoidableSignals: analysis.behavior.avoidableSignals,
        consumerProfile: analysis.behavior.consumerProfile
      }
    }),
    [analysis, range.label]
  );

  useEffect(() => {
    setAiResult(null);
    setAiError('');
    setAiUpdatedAt('');
    setAiStatus('idle');
  }, [rangeKey, analysis.transactionCount]);

  const rangeTransactionDates = useMemo(() => getRangeDateBounds(range), [range]);

  const marketRows = useMemo<FinancialAnalysisMarketRow[]>(() => {
    const now = new Date();
    return Array.from({ length: 6 }).map((_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const month = date.getMonth();
      const year = date.getFullYear();
      const rows = transactions.filter((item) => {
        const txDate = new Date(item.date);
        return txDate.getFullYear() === year && txDate.getMonth() === month;
      });
      const income = rows
        .filter((item) => item.type === 'income')
        .reduce((sum, item) => sum + item.amount, 0);
      const expense = rows
        .filter((item) => item.type === 'expense' || item.type === 'repayment' || item.type === 'budget')
        .reduce((sum, item) => sum + item.amount, 0);
      return {
        label: `${month + 1}月`,
        income,
        expense,
        net: income - expense
      };
    });
  }, [transactions]);

  const latestMarketRow = marketRows[marketRows.length - 1] || {
    label: range.label,
    income: analysis.metrics[0]?.value || 0,
    expense: analysis.metrics[1]?.value || 0,
    net: analysis.metrics[2]?.value || 0
  };
  const previousMarketRow = marketRows[marketRows.length - 2] || latestMarketRow;
  const marketBarScale = useMemo(
    () => Math.max(...marketRows.map((item) => Math.max(Math.abs(item.net), item.income, item.expense)), 1),
    [marketRows]
  );
  const marketCards = useMemo(
    () => [
      {
        label: '收入',
        value: latestMarketRow.income,
        delta: latestMarketRow.income - previousMarketRow.income,
        tone: 'income'
      },
      {
        label: '支出',
        value: latestMarketRow.expense,
        delta: latestMarketRow.expense - previousMarketRow.expense,
        tone: 'expense'
      },
      {
        label: '净结余',
        value: latestMarketRow.net,
        delta: latestMarketRow.net - previousMarketRow.net,
        tone: latestMarketRow.net >= 0 ? 'income' : 'expense'
      }
    ],
    [latestMarketRow, previousMarketRow]
  );
  const marketHeadline =
    latestMarketRow.net >= previousMarketRow.net ? '资金动能回升' : '资金动能转弱';

  const previousQuickActions = useMemo<FinancialAnalysisQuickAction[]>(() => {
    const actions: FinancialAnalysisQuickAction[] = [
      {
        label: '查看当前周期流水',
        hint: '带着当前分析周期回到交易页，继续核对账单。',
        onClick: () =>
          navigate(
            buildTransactionsLink({
              datePreset: 'custom',
              dateFrom: rangeTransactionDates.from,
              dateTo: rangeTransactionDates.to
            })
          )
      },
      {
        label: '只看支出记录',
        hint: '聚焦支出项，适合继续排查波动来源。',
        onClick: () =>
          navigate(
            buildTransactionsLink({
              type: 'expense',
              datePreset: 'custom',
              dateFrom: rangeTransactionDates.from,
              dateTo: rangeTransactionDates.to
            })
          )
      }
    ];

    if (analysis.previous.abnormalExpense?.id) {
      actions.unshift({
        label: '定位异常流水',
        hint: '优先回到原始记录，确认这笔异常支出是否合理。',
        onClick: () => navigate(`/transactions/${analysis.previous.abnormalExpense?.id}`)
      });
    }

    return actions.slice(0, 3);
  }, [analysis.previous.abnormalExpense?.id, navigate, rangeTransactionDates.from, rangeTransactionDates.to]);

  const presentQuickActions = useMemo<FinancialAnalysisQuickAction[]>(() => {
    const actions: FinancialAnalysisQuickAction[] = [];

    if (analysis.present.disposableIncome <= 0 || analysis.present.fixedExpenseRatio >= 0.45) {
      actions.push({
        label: '去制定预算',
        hint: '当前可支配空间偏紧，先回预算页收口固定支出。',
        onClick: () => navigate('/smart-budget')
      });
    }

    if (analysis.present.debtPressureRatio >= 0.25) {
      actions.push({
        label: '查看还款压力',
        hint: '负债压力偏高时，优先检查近期应还与最低还款。',
        onClick: () => navigate('/repayment-management')
      });
    }

    actions.push({
      label: '检查订阅项',
      hint: '固定成本里已经计入订阅，顺手检查是否有可停用项目。',
      onClick: () => navigate('/subscriptions')
    });

    return actions.slice(0, 3);
  }, [analysis.present.debtPressureRatio, analysis.present.disposableIncome, analysis.present.fixedExpenseRatio, navigate]);

  const futureQuickActions = useMemo<FinancialAnalysisQuickAction[]>(() => {
    const actions: FinancialAnalysisQuickAction[] = [];

    if (analysis.future.dueSoonRepaymentCount > 0) {
      actions.push({
        label: '处理近期还款',
        hint: `未来 10 天有 ${analysis.future.dueSoonRepaymentCount} 笔还款提醒，建议先去确认。`,
        onClick: () => navigate('/repayment-management')
      });
    }

    if (analysis.future.dueSoonSubscriptionCount > 0) {
      actions.push({
        label: '检查即将续费订阅',
        hint: `未来 14 天有 ${analysis.future.dueSoonSubscriptionCount} 个订阅到期/续费。`,
        onClick: () => navigate('/subscriptions')
      });
    }

    actions.push({
      label: '回到交易页继续处理',
      hint: '需要补流水或核对数据时，直接回交易页继续操作。',
      onClick: () => navigate('/transactions')
    });

    return actions.slice(0, 3);
  }, [analysis.future.dueSoonRepaymentCount, analysis.future.dueSoonSubscriptionCount, navigate]);

  const runAiAnalysis = async () => {
    if (!transactions.length || !apiKey.trim()) {
      setAiStatus('error');
      setAiError('未配置可用的 AI Key，当前无法生成财务分析解读。');
      return;
    }

    setAiStatus('loading');
    setAiError('');

    try {
      const result = await sendAiChat({
        baseUrl,
        apiKey,
        model,
        systemPrompt:
          '你是 LedgerFlow 的财务分析顾问。你需要基于账本快照，输出一个适合财务分析页面展示的 JSON。语气要专业、克制、具体，禁止空话。只输出 JSON，不要输出额外说明。',
        messages: [
          {
            role: 'user',
            text: `请基于以下财务分析快照，输出 JSON：{"summary":"一句总判断","past":["过去分析1","过去分析2"],"present":["现在分析1","现在分析2"],"future":["未来分析1","未来分析2"],"actions":[{"label":"动作名","to":"/transactions|/smart-budget|/repayment-management|/subscriptions|/assistant"}],"behavior":{"summary":"行为总判断","habits":["习惯1","习惯2"],"avoidable":["可优化点1","可优化点2"],"profile":"一句画像结论","confidenceNote":"样本说明"}} 。
要求：
1) past / present / future 各返回 2~3 条；
2) behavior.habits 与 behavior.avoidable 各返回 2~3 条，尽量补足本地规则难以识别的消费语境；
3) behavior.profile 要明确说明你推测到的消费风格，不要写成绝对人格定论；
4) 若样本不足，要明确提示“样本不足”，但仍要尽量基于已有账本给出保守判断；
5) actions 最多 3 条，必须是可执行入口；
6) 必须结合输入数字和已有 behavior 字段，不要泛泛而谈；
7) 只输出 JSON，用简体中文。

财务分析快照：
${JSON.stringify(aiInput)}`
          }
        ]
      });

      const parsed = normalizeAiPayload(JSON.parse(extractJson(result.content)));
      if (!parsed) {
        throw new Error('AI 未返回可解析的财务分析结果。');
      }

      setAiResult(parsed);
      setAiStatus('done');
      setAiUpdatedAt(new Date().toISOString());
    } catch (error) {
      setAiStatus('error');
      setAiError(error instanceof Error ? error.message : '财务分析生成失败，请稍后重试。');
    }
  };

  if (transactions.length === 0) {
    return (
      <section className="panel">
        <EmptyState
          icon={
            <img
              className="financial-analysis-empty-icon"
              src={BADGE_DOLLAR_SIGN_ICON_URL}
              alt=""
              aria-hidden="true"
            />
          }
          title="还没有足够的财务分析数据"
          description="先新增几笔交易，财务分析页就能开始帮你看清过去、理解现在、规划未来。"
          primaryAction={{
            label: '去记一笔',
            variant: 'primary',
            onClick: () => navigate('/transactions/new?quick=1')
          }}
          secondaryAction={{
            label: '查看交易记录',
            onClick: () => navigate('/transactions')
          }}
        />
      </section>
    );
  }

  return (
    <div className="page-stack vi-page financial-analysis-page">
      <section className="vi-hero financial-analysis-hero">
        <div className="financial-analysis-hero-head">
          <div>
            <h2>财务分析</h2>
            <p className="muted">看清过去、理解现在、规划未来。分析页会先整理本地账目，再交给大模型生成更贴近决策的解释与动作建议。</p>
          </div>
          <div className="financial-analysis-range-switcher" aria-label="分析周期切换">
            {FINANCIAL_ANALYSIS_RANGE_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === rangeKey ? 'active' : ''}
                onClick={() => setRangeKey(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="financial-analysis-ai-bar">
          <p className="financial-analysis-ai-status">
            模型：{model || '默认模型'} ·{' '}
            {aiStatus === 'loading'
              ? '分析中'
              : aiStatus === 'done'
                ? '已完成'
                : aiStatus === 'error'
                  ? '分析失败'
                  : '待分析'}
            {aiUpdatedAt ? ` · 上次分析 ${new Date(aiUpdatedAt).toLocaleString('zh-CN')}` : ''}
          </p>
          <button type="button" onClick={runAiAnalysis} disabled={aiStatus === 'loading'}>
            {aiStatus === 'loading' ? '分析中...' : '生成 AI 解读'}
          </button>
        </div>

        <p className="financial-analysis-summary-line">{analysis.summaryLine}</p>
        <p className="financial-analysis-confidence">{analysis.confidenceNote}</p>

        <div className="financial-analysis-metrics-grid">
          {analysis.metrics.map((item) => (
            <article key={item.label} className={`financial-analysis-metric-card tone-${item.tone || 'neutral'}`}>
              <span>{item.label}</span>
              <strong>{metricValue(item.label, item.value, item.help)}</strong>
            </article>
          ))}
        </div>

        <article className="financial-analysis-market-board">
          <header className="financial-analysis-market-head">
            <div>
              <h3 className="financial-analysis-title-with-icon">
                <img src={BADGE_DOLLAR_SIGN_ICON_URL} alt="" aria-hidden="true" />
                资金动态看板
              </h3>
              <p className="muted">像看行情一样，先看本月，再看最近 6 个月的变化节奏。</p>
            </div>
            <span className="metric-chip">
              动态判断
              <strong>{marketHeadline}</strong>
            </span>
          </header>
          <div className="financial-analysis-market-ticker">
            {marketCards.map((item) => (
              <article key={item.label} className={`financial-analysis-market-card tone-${item.tone}`}>
                <span>{item.label}</span>
                <strong>{formatCurrency(item.value)}</strong>
                <small>{formatDelta(item.delta)}</small>
              </article>
            ))}
          </div>
          <div className="financial-analysis-market-bars" role="list" aria-label="最近6个月资金动态">
            {marketRows.map((item) => (
              <div key={item.label} role="listitem" className="financial-analysis-market-bar-item">
                <span>{item.label}</span>
                <div className="financial-analysis-market-bar-track">
                  <i
                    className={item.net >= 0 ? 'is-positive' : 'is-negative'}
                    style={{ height: `${Math.max(14, (Math.abs(item.net) / marketBarScale) * 96)}px` }}
                  />
                </div>
                <strong>{formatCurrency(item.net)}</strong>
                <small>
                  收 {formatCurrency(item.income)} / 支 {formatCurrency(item.expense)}
                </small>
              </div>
            ))}
          </div>
        </article>

        <article className="financial-analysis-ai-card">
          <header>
            <div>
              <h3>AI 综合解读</h3>
              <p className="muted">让模型基于当前账本快照，把数字翻译成更适合执行的判断。</p>
            </div>
          </header>
          {aiError ? <p className="financial-analysis-ai-error">{aiError}</p> : null}
          {aiResult ? (
            <div className="financial-analysis-ai-grid">
              <div className="financial-analysis-highlight">
                <strong>一句总判断</strong>
                <p>{aiResult.summary}</p>
              </div>
              <div className="financial-analysis-ai-columns">
                <section>
                  <h4>过去</h4>
                  <ul>
                    {aiResult.past.map((item, index) => (
                      <li key={`past-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>现在</h4>
                  <ul>
                    {aiResult.present.map((item, index) => (
                      <li key={`present-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>未来</h4>
                  <ul>
                    {aiResult.future.map((item, index) => (
                      <li key={`future-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>
              {aiResult.actions.length > 0 ? (
                <div className="financial-analysis-actions">
                  {aiResult.actions.map((action) => (
                    <button key={action.label} type="button" onClick={() => navigate(action.to)}>
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <>
            <div className="financial-analysis-ai-empty">
              <div>
                <strong>AI 还没开始解读</strong>
                <p className="muted">生成后会补齐过去、现在、未来的重点判断。</p>
              </div>
              <button type="button" onClick={runAiAnalysis} disabled={aiStatus === 'loading'}>
                {aiStatus === 'loading' ? '分析中..' : '生成 AI 解读'}
              </button>
            </div>
            <p className="muted">点击“生成 AI 解读”，让模型结合当前财务快照输出更完整的过去 / 现在 / 未来分析。</p>
            </>
          )}
        </article>
      </section>

      <section className="vi-section financial-analysis-section">
        <div className="financial-analysis-section-head">
          <div>
            <h3 className="financial-analysis-title-with-icon">
              <img src={SCALE_ICON_URL} alt="" aria-hidden="true" />
              行为洞察：消费习惯与画像
            </h3>
            <p className="muted">先展示本地规则结果；生成 AI 解读后，这里会补充更细的消费语境判断。以下结论属于行为推测，不等同于人格定论。</p>
          </div>
          <span className="metric-chip">
            可优化项
            <strong>{analysis.behavior.avoidableSignals.length}</strong>
          </span>
        </div>

        {aiResult?.behavior ? (
          <article className="financial-analysis-subcard" style={{ marginBottom: 12 }}>
            <h4>AI 补充判断</h4>
            <div className="financial-analysis-highlight">
              <strong>{aiResult.behavior.profile}</strong>
              <p>{aiResult.behavior.summary}</p>
            </div>
            <div className="financial-analysis-ai-columns">
              <section>
                <h4>AI 看见的习惯</h4>
                <ul>
                  {aiResult.behavior.habits.map((item, index) => (
                    <li key={`ai-habit-${index}`}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>AI 识别的可优化点</h4>
                <ul>
                  {aiResult.behavior.avoidable.map((item, index) => (
                    <li key={`ai-avoidable-${index}`}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>
            <p className="financial-analysis-confidence">{aiResult.behavior.confidenceNote}</p>
          </article>
        ) : (
          <p className="financial-analysis-confidence" style={{ marginBottom: 12 }}>
            点击上方“生成 AI 解读”后，这里会补充更细的消费习惯判断，帮助你在样本偏少时也得到保守分析。
          </p>
        )}

        <div className="financial-analysis-two-col">
          <article className="financial-analysis-subcard">
            <h4>消费习惯推断</h4>
            <div className="financial-analysis-ai-columns">
              {analysis.behavior.habits.map((item) => (
                <div key={item.title} className={`financial-analysis-highlight ${behaviorToneClass(item.tone)}`}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="financial-analysis-subcard">
            <h4>可压缩支出信号</h4>
            {analysis.behavior.avoidableSignals.length > 0 ? (
              <div className="financial-analysis-ai-columns">
                {analysis.behavior.avoidableSignals.map((item) => (
                  <div key={item.title} className={`financial-analysis-highlight ${behaviorToneClass(item.tone)}`}>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <div className="financial-analysis-stat-grid">
                      <div>
                        <span>累计金额</span>
                        <strong>{formatCurrency(item.amount)}</strong>
                      </div>
                      <div>
                        <span>出现次数</span>
                        <strong>{item.count}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">当前周期还没有足够样本来识别可压缩支出。</p>
            )}
          </article>
        </div>

        <div className="financial-analysis-two-col">
          <article className="financial-analysis-subcard">
            <h4>消费者画像推测</h4>
            <div className="financial-analysis-highlight">
              <strong>{analysis.behavior.consumerProfile.archetype}</strong>
              <p>{analysis.behavior.consumerProfile.summary}</p>
            </div>
            <div className="financial-analysis-actions">
              {analysis.behavior.consumerProfile.traits.map((item) => (
                <span key={item} className="metric-chip">
                  {item}
                </span>
              ))}
            </div>
            <div className="financial-analysis-actions financial-analysis-profile-actions">
              <button
                className="financial-analysis-profile-action"
                aria-label="查看消费明细"
                type="button"
                onClick={() =>
                  navigate(
                    buildTransactionsLink({
                      type: 'expense',
                      datePreset: 'custom',
                      dateFrom: rangeTransactionDates.from,
                      dateTo: rangeTransactionDates.to
                    })
                  )
                }
              >
                鏌ョ湅娑堣垂鏄庣粏
              </button>
              <button
                className="financial-analysis-profile-action"
                aria-label="去 AI 助手"
                type="button"
                onClick={() => navigate('/assistant')}
              >
                鍘?AI 鍔╂墜
              </button>
            </div>
            <p className="financial-analysis-confidence">{analysis.behavior.consumerProfile.disclaimer}</p>
          </article>

          <article className="financial-analysis-subcard">
            <h4>建议动作</h4>
            <div className="financial-analysis-ai-columns">
              <article className="financial-analysis-subcard">
                <h4>去看高频消费</h4>
                <p className="financial-analysis-paragraph">回到交易页聚焦当前分析周期，优先核对高频小额、娱乐购物和备注重复的场景。</p>
                <div className="financial-analysis-actions">
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        buildTransactionsLink({
                          type: 'expense',
                          datePreset: 'custom',
                          dateFrom: rangeTransactionDates.from,
                          dateTo: rangeTransactionDates.to
                        })
                      )
                    }
                  >
                    查看消费明细
                  </button>
                </div>
              </article>
              <article className="financial-analysis-subcard">
                <h4>让 AI 继续拆解</h4>
                <p className="financial-analysis-paragraph">如果你想把“哪些消费其实可以砍”继续往下拆，可以直接带着当前习惯洞察去问 AI 助手。</p>
                <div className="financial-analysis-actions">
                  <button type="button" onClick={() => navigate('/assistant')}>
                    去 AI 助手
                  </button>
                </div>
              </article>
            </div>
          </article>
        </div>
      </section>

      <section className="vi-section financial-analysis-section">
        <div className="financial-analysis-section-head">
          <div>
            <h3>过去：复盘支出变化</h3>
            <p className="muted">先看主要流向，再看哪些波动值得回头翻账单。</p>
          </div>
          <span className="metric-chip">
            支出变化
            <strong>
              {analysis.trendDeltaPct === null
                ? '样本不足'
                : `${analysis.trendDeltaPct >= 0 ? '+' : ''}${analysis.trendDeltaPct.toFixed(1)}%`}
            </strong>
          </span>
        </div>

        <div className="financial-analysis-two-col">
          <article className="financial-analysis-subcard">
            <h4>主要支出分类</h4>
            {analysis.previous.categoryRows.length > 0 ? (
              <div className="financial-analysis-category-list">
                {analysis.previous.categoryRows.map((item) => (
                  <article key={item.name} className="financial-analysis-category-item">
                    <header>
                      <strong>{item.name}</strong>
                      <span>{formatPercent(item.share * 100)}</span>
                    </header>
                    <div className="financial-analysis-progress-track">
                      <i style={{ width: `${Math.max(6, item.share * 100)}%` }} />
                    </div>
                    <small>{formatCurrency(item.amount)}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">上一阶段还没有足够的支出分类样本。</p>
            )}
          </article>

          <article className="financial-analysis-subcard">
            <h4>复盘结论</h4>
            <p>{analysis.previous.insight}</p>
            <div className="financial-analysis-stat-grid">
              <div>
                <span>日均支出</span>
                <strong>{formatCurrency(analysis.previous.recentAverageDailyExpense)}</strong>
              </div>
              <div>
                <span>最大分类</span>
                <strong>{analysis.previous.topCategoryName}</strong>
              </div>
            </div>
            {analysis.previous.abnormalExpense ? (
              <div className="financial-analysis-highlight warning">
                <strong>异常支出提醒</strong>
                <p>
                  {analysis.previous.abnormalExpense.note || '未备注'} · {formatCurrency(analysis.previous.abnormalExpense.amount)}
                </p>
              </div>
            ) : null}
            <div className="financial-analysis-actions">
              {analysis.previous.actions.map((action) => (
                <button key={action.label} type="button" onClick={() => navigate(action.to)}>
                  {action.label}
                </button>
              ))}
            </div>
            <div className="financial-analysis-ai-columns">
              {previousQuickActions.map((action) => (
                <article key={action.label} className="financial-analysis-subcard">
                  <h4>{action.label}</h4>
                  <p className="financial-analysis-paragraph">{action.hint}</p>
                  <div className="financial-analysis-actions">
                    <button type="button" onClick={action.onClick}>
                      继续处理
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="vi-section financial-analysis-section">
        <div className="financial-analysis-section-head">
          <div>
            <h3>现在：诊断当前结构</h3>
            <p className="muted">把固定成本、负债压力和当前可支配空间放到同一视图里。</p>
          </div>
          <span className="metric-chip">
            健康度
            <strong>{analysis.present.debtHealthScore}</strong>
          </span>
        </div>

        <div className="financial-analysis-stat-grid is-three">
          <div>
            <span>固定成本</span>
            <strong>{formatCurrency(analysis.present.fixedExpenseAmount)}</strong>
            <small>{formatPercent(analysis.present.fixedExpenseRatio * 100)}</small>
          </div>
          <div>
            <span>订阅月成本</span>
            <strong>{formatCurrency(analysis.present.subscriptionMonthlyCost)}</strong>
            <small>已纳入固定支出观察</small>
          </div>
          <div>
            <span>可支配空间</span>
            <strong>{formatCurrency(analysis.present.disposableIncome)}</strong>
            <small>{formatPercent(analysis.present.debtPressureRatio * 100)} 债务压力</small>
          </div>
        </div>

        <p className="financial-analysis-paragraph">{analysis.present.insight}</p>
        <div className="financial-analysis-actions">
          {analysis.present.actions.map((action) => (
            <button key={action.label} type="button" onClick={() => navigate(action.to)}>
              {action.label}
            </button>
          ))}
        </div>
        <div className="financial-analysis-ai-columns">
          {presentQuickActions.map((action) => (
            <article key={action.label} className="financial-analysis-subcard">
              <h4>{action.label}</h4>
              <p className="financial-analysis-paragraph">{action.hint}</p>
              <div className="financial-analysis-actions">
                <button type="button" onClick={action.onClick}>
                  立即前往
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel financial-analysis-section">
        <div className="financial-analysis-section-head">
          <div>
            <h3>未来：提前预判压力</h3>
            <p className="muted">先做保守估算，再决定是控支、留缓冲，还是优先处理固定扣款。</p>
          </div>
          <span className="metric-chip">
            预测结余
            <strong>{formatCurrency(analysis.future.projectedMonthlyBalance)}</strong>
          </span>
        </div>

        <div className="financial-analysis-stat-grid is-three">
          <div>
            <span>建议缓冲</span>
            <strong>{formatCurrency(analysis.future.suggestedBuffer)}</strong>
            <small>用于固定扣款与突发波动</small>
          </div>
          <div>
            <span>近期订阅提醒</span>
            <strong>{analysis.future.dueSoonSubscriptionCount}</strong>
            <small>14 天内</small>
          </div>
          <div>
            <span>近期还款提醒</span>
            <strong>{analysis.future.dueSoonRepaymentCount}</strong>
            <small>10 天内</small>
          </div>
        </div>

        <div className="financial-analysis-highlight">
          <strong>预测说明</strong>
          <p>{analysis.future.insight}</p>
        </div>
        <div className="financial-analysis-actions">
          {analysis.future.actions.map((action) => (
            <button key={action.label} type="button" onClick={() => navigate(action.to)}>
              {action.label}
            </button>
          ))}
        </div>
        <div className="financial-analysis-ai-columns">
          {futureQuickActions.map((action) => (
            <article key={action.label} className="financial-analysis-subcard">
              <h4>{action.label}</h4>
              <p className="financial-analysis-paragraph">{action.hint}</p>
              <div className="financial-analysis-actions">
                <button type="button" onClick={action.onClick}>
                  去处理
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
