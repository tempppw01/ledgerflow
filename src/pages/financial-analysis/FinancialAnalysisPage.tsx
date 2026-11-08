import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { sendAiChat } from '../../features/assistant/api/openaiCompatibleClient';
import {
  analyzeFinancialOverview,
  FINANCIAL_ANALYSIS_RANGE_OPTIONS,
  type FinancialAnalysisLocale,
  type FinancialAnalysisRangeKey
} from '../../features/financial-analysis/model/analysis';
import { BADGE_DOLLAR_SIGN_ICON_URL, SCALE_ICON_URL } from '../../shared/config/brandAssets';
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
  if (help === '百分比' || help === 'percent') {
    return formatPercent(value);
  }
  if ((label.includes('率') || label.toLowerCase().includes('rate')) && Math.abs(value) <= 100) {
    return formatPercent(value);
  }
  return formatCurrency(value);
}

function buildAiSystemPrompt(locale: FinancialAnalysisLocale): string {
  return locale === 'en'
    ? 'You are the financial analysis advisor for LedgerFlow. Based on the ledger snapshot, output a single JSON object that fits the financial analysis page. Be professional, restrained, and specific. No filler. Output only JSON, no extra text.'
    : '你是 LedgerFlow 的财务分析顾问。你需要基于账本快照,输出一个适合财务分析页面展示的 JSON。语气要专业、克制、具体,禁止空话。只输出 JSON,不要输出额外说明。';
}

function buildAiUserPrompt(aiInput: unknown, locale: FinancialAnalysisLocale): string {
  if (locale === 'en') {
    return `Based on the following financial analysis snapshot, output JSON: {"summary":"one-line bottom line","past":["past finding 1","past finding 2"],"present":["present finding 1","present finding 2"],"future":["future finding 1","future finding 2"],"actions":[{"label":"action name","to":"/transactions|/smart-budget|/repayment-management|/subscriptions|/assistant"}],"behavior":{"summary":"behavior summary","habits":["habit 1","habit 2"],"avoidable":["optimization point 1","optimization point 2"],"profile":"one-line profile conclusion","confidenceNote":"sample note"}}.
Requirements:
1) past / present / future each return 2 to 3 items;
2) behavior.habits and behavior.avoidable each return 2 to 3 items, covering spending context that local rules cannot catch;
3) behavior.profile must clearly describe the inferred spending style without presenting it as a definitive personality statement;
4) when samples are thin, state "thin samples" explicitly but still give a conservative read;
5) actions return at most 3 and must be actionable entry points;
6) use the provided numbers and existing behavior fields; do not be generic;
7) output JSON only, in English.

Financial analysis snapshot:
${JSON.stringify(aiInput)}`;
  }

  return `请基于以下财务分析快照,输出 JSON:{"summary":"一句总判断","past":["过去分析1","过去分析2"],"present":["现在分析1","现在分析2"],"future":["未来分析1","未来分析2"],"actions":[{"label":"动作名","to":"/transactions|/smart-budget|/repayment-management|/subscriptions|/assistant"}],"behavior":{"summary":"行为总判断","habits":["习惯1","习惯2"],"avoidable":["可优化点1","可优化点2"],"profile":"一句画像结论","confidenceNote":"样本说明"}} 。
要求:
1) past / present / future 各返回 2~3 条;
2) behavior.habits 与 behavior.avoidable 各返回 2~3 条,尽量补足本地规则难以识别的消费语境;
3) behavior.profile 要明确说明你推测到的消费风格,不要写成绝对人格定论;
4) 若样本不足,要明确提示“样本不足”,但仍要尽量基于已有账本给出保守判断;
5) actions 最多 3 条,必须是可执行入口;
6) 必须结合输入数字和已有 behavior 字段,不要泛泛而谈;
7) 只输出 JSON,用简体中文。

财务分析快照:
${JSON.stringify(aiInput)}`;
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

const behaviorFallbacks: Record<
  FinancialAnalysisLocale,
  { summary: string; profile: string; confidence: string }
> = {
  zh: {
    summary: 'AI 已结合当前账本补充行为判断。',
    profile: 'AI 暂未形成稳定画像',
    confidence: '该结论由 AI 结合当前账本样本生成,仍需与你的真实消费背景一起判断。'
  },
  en: {
    summary: 'AI added behavior judgments based on the current ledger.',
    profile: 'AI has not formed a stable profile yet',
    confidence:
      'This conclusion was generated by AI from the current ledger sample and still needs to be read alongside your real spending context.'
  }
};

function normalizeAiPayload(
  raw: unknown,
  locale: FinancialAnalysisLocale
): AiFinancialAnalysisPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw as Partial<AiFinancialAnalysisPayload>;
  const summary = String(payload.summary || '').trim();
  const normalizeList = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 3)
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
            summary: behaviorSummary || behaviorFallbacks[locale].summary,
            habits,
            avoidable,
            profile: profile || behaviorFallbacks[locale].profile,
            confidenceNote: confidenceNote || behaviorFallbacks[locale].confidence
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

function formatMonthLabel(year: number, month: number, locale: FinancialAnalysisLocale): string {
  if (locale === 'en') {
    return new Date(year, month, 1).toLocaleString('en-US', { month: 'short' });
  }
  return `${month + 1}月`;
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
  const { t, i18n } = useTranslation();
  const locale: FinancialAnalysisLocale = (i18n.resolvedLanguage || i18n.language || 'zh')
    .toLowerCase()
    .startsWith('en')
    ? 'en'
    : 'zh';
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

  const activeRangeOption =
    FINANCIAL_ANALYSIS_RANGE_OPTIONS.find((item) => item.key === rangeKey) ||
    FINANCIAL_ANALYSIS_RANGE_OPTIONS[1];
  const range = useMemo(
    () => ({ ...activeRangeOption, label: t(`financialAnalysis.range.${activeRangeOption.key}`) }),
    [activeRangeOption, t]
  );

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
        monthlyIncome,
        locale
      }),
    [
      accounts,
      categories,
      debts,
      locale,
      monthlyIncome,
      range,
      repaymentRecords,
      subscriptions,
      transactions
    ]
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
        .filter(
          (item) => item.type === 'expense' || item.type === 'repayment' || item.type === 'budget'
        )
        .reduce((sum, item) => sum + item.amount, 0);
      return {
        label: formatMonthLabel(year, month, locale),
        income,
        expense,
        net: income - expense
      };
    });
  }, [locale, transactions]);

  const { latestMarketRow, previousMarketRow } = useMemo(() => {
    const latest = marketRows[marketRows.length - 1] || {
      label: range.label,
      income: analysis.metrics[0]?.value || 0,
      expense: analysis.metrics[1]?.value || 0,
      net: analysis.metrics[2]?.value || 0
    };
    return {
      latestMarketRow: latest,
      previousMarketRow: marketRows[marketRows.length - 2] || latest
    };
  }, [analysis.metrics, marketRows, range.label]);
  const marketBarScale = useMemo(
    () =>
      Math.max(
        ...marketRows.map((item) => Math.max(Math.abs(item.net), item.income, item.expense)),
        1
      ),
    [marketRows]
  );
  const marketCards = useMemo(
    () => [
      {
        label: t('financialAnalysis.market.income'),
        value: latestMarketRow.income,
        delta: latestMarketRow.income - previousMarketRow.income,
        tone: 'income'
      },
      {
        label: t('financialAnalysis.market.expense'),
        value: latestMarketRow.expense,
        delta: latestMarketRow.expense - previousMarketRow.expense,
        tone: 'expense'
      },
      {
        label: t('financialAnalysis.market.net'),
        value: latestMarketRow.net,
        delta: latestMarketRow.net - previousMarketRow.net,
        tone: latestMarketRow.net >= 0 ? 'income' : 'expense'
      }
    ],
    [latestMarketRow, previousMarketRow, t]
  );
  const marketHeadline =
    latestMarketRow.net >= previousMarketRow.net
      ? t('financialAnalysis.market.headlineUp')
      : t('financialAnalysis.market.headlineDown');

  const previousQuickActions = useMemo<FinancialAnalysisQuickAction[]>(() => {
    const actions: FinancialAnalysisQuickAction[] = [
      {
        label: t('financialAnalysis.quick.previousTransactions'),
        hint: t('financialAnalysis.quick.previousTransactionsHint'),
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
        label: t('financialAnalysis.quick.previousExpenses'),
        hint: t('financialAnalysis.quick.previousExpensesHint'),
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
        label: t('financialAnalysis.quick.previousAbnormal'),
        hint: t('financialAnalysis.quick.previousAbnormalHint'),
        onClick: () => navigate(`/transactions/${analysis.previous.abnormalExpense?.id}`)
      });
    }

    return actions.slice(0, 3);
  }, [
    analysis.previous.abnormalExpense?.id,
    navigate,
    rangeTransactionDates.from,
    rangeTransactionDates.to,
    t
  ]);

  const presentQuickActions = useMemo<FinancialAnalysisQuickAction[]>(() => {
    const actions: FinancialAnalysisQuickAction[] = [];

    if (analysis.present.disposableIncome <= 0 || analysis.present.fixedExpenseRatio >= 0.45) {
      actions.push({
        label: t('financialAnalysis.quick.presentBudget'),
        hint: t('financialAnalysis.quick.presentBudgetHint'),
        onClick: () => navigate('/smart-budget')
      });
    }

    if (analysis.present.debtPressureRatio >= 0.25) {
      actions.push({
        label: t('financialAnalysis.quick.presentDebt'),
        hint: t('financialAnalysis.quick.presentDebtHint'),
        onClick: () => navigate('/repayment-management')
      });
    }

    actions.push({
      label: t('financialAnalysis.quick.presentSubscriptions'),
      hint: t('financialAnalysis.quick.presentSubscriptionsHint'),
      onClick: () => navigate('/subscriptions')
    });

    return actions.slice(0, 3);
  }, [
    analysis.present.debtPressureRatio,
    analysis.present.disposableIncome,
    analysis.present.fixedExpenseRatio,
    navigate,
    t
  ]);

  const futureQuickActions = useMemo<FinancialAnalysisQuickAction[]>(() => {
    const actions: FinancialAnalysisQuickAction[] = [];

    if (analysis.future.dueSoonRepaymentCount > 0) {
      actions.push({
        label: t('financialAnalysis.quick.futureRepayment'),
        hint: t('financialAnalysis.quick.futureRepaymentHint', {
          count: analysis.future.dueSoonRepaymentCount
        }),
        onClick: () => navigate('/repayment-management')
      });
    }

    if (analysis.future.dueSoonSubscriptionCount > 0) {
      actions.push({
        label: t('financialAnalysis.quick.futureSubscription'),
        hint: t('financialAnalysis.quick.futureSubscriptionHint', {
          count: analysis.future.dueSoonSubscriptionCount
        }),
        onClick: () => navigate('/subscriptions')
      });
    }

    actions.push({
      label: t('financialAnalysis.quick.futureTransactions'),
      hint: t('financialAnalysis.quick.futureTransactionsHint'),
      onClick: () => navigate('/transactions')
    });

    return actions.slice(0, 3);
  }, [
    analysis.future.dueSoonRepaymentCount,
    analysis.future.dueSoonSubscriptionCount,
    navigate,
    t
  ]);

  const runAiAnalysis = async () => {
    if (!transactions.length || !apiKey.trim()) {
      setAiStatus('error');
      setAiError(t('financialAnalysis.ai.errorNoKey'));
      return;
    }

    setAiStatus('loading');
    setAiError('');

    try {
      const result = await sendAiChat({
        baseUrl,
        apiKey,
        model,
        systemPrompt: buildAiSystemPrompt(locale),
        messages: [
          {
            role: 'user',
            text: buildAiUserPrompt(aiInput, locale)
          }
        ]
      });

      const parsed = normalizeAiPayload(JSON.parse(extractJson(result.content)), locale);
      if (!parsed) {
        throw new Error(t('financialAnalysis.ai.errorParse'));
      }

      setAiResult(parsed);
      setAiStatus('done');
      setAiUpdatedAt(new Date().toISOString());
    } catch (error) {
      setAiStatus('error');
      setAiError(error instanceof Error ? error.message : t('financialAnalysis.ai.errorGeneric'));
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
          title={t('financialAnalysis.empty.title')}
          description={t('financialAnalysis.empty.description')}
          primaryAction={{
            label: t('financialAnalysis.empty.primary'),
            variant: 'primary',
            onClick: () => navigate('/transactions/new?quick=1')
          }}
          secondaryAction={{
            label: t('financialAnalysis.empty.secondary'),
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
            <h2>{t('financialAnalysis.hero.title')}</h2>
            <p className="muted">{t('financialAnalysis.hero.description')}</p>
          </div>
          <div
            className="financial-analysis-range-switcher"
            aria-label={t('financialAnalysis.range.aria')}
          >
            {FINANCIAL_ANALYSIS_RANGE_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === rangeKey ? 'active' : ''}
                onClick={() => setRangeKey(item.key)}
              >
                {t('financialAnalysis.range.' + item.key)}
              </button>
            ))}
          </div>
        </div>

        <div className="financial-analysis-ai-bar">
          <p className="financial-analysis-ai-status">
            {t('financialAnalysis.ai.model', {
              model: model || t('financialAnalysis.ai.defaultModel')
            })}{' '}
            ·{' '}
            {aiStatus === 'loading'
              ? t('financialAnalysis.ai.statusLoading')
              : aiStatus === 'done'
                ? t('financialAnalysis.ai.statusDone')
                : aiStatus === 'error'
                  ? t('financialAnalysis.ai.statusError')
                  : t('financialAnalysis.ai.statusIdle')}
            {aiUpdatedAt
              ? ` · ${t('financialAnalysis.ai.lastAnalyzed', { time: new Date(aiUpdatedAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN') })}`
              : ''}
          </p>
          <button type="button" onClick={runAiAnalysis} disabled={aiStatus === 'loading'}>
            {aiStatus === 'loading'
              ? t('financialAnalysis.ai.generating')
              : t('financialAnalysis.ai.generate')}
          </button>
        </div>

        <p className="financial-analysis-summary-line">{analysis.summaryLine}</p>
        <p className="financial-analysis-confidence">{analysis.confidenceNote}</p>

        <div className="financial-analysis-metrics-grid">
          {analysis.metrics.map((item) => (
            <article
              key={item.label}
              className={`financial-analysis-metric-card tone-${item.tone || 'neutral'}`}
            >
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
                {t('financialAnalysis.market.title')}
              </h3>
              <p className="muted">{t('financialAnalysis.market.description')}</p>
            </div>
            <span className="metric-chip">
              {t('financialAnalysis.market.badge')}
              <strong>{marketHeadline}</strong>
            </span>
          </header>
          <div className="financial-analysis-market-ticker">
            {marketCards.map((item) => (
              <article
                key={item.label}
                className={`financial-analysis-market-card tone-${item.tone}`}
              >
                <span>{item.label}</span>
                <strong>{formatCurrency(item.value)}</strong>
                <small>{formatDelta(item.delta)}</small>
              </article>
            ))}
          </div>
          <div
            className="financial-analysis-market-bars"
            role="list"
            aria-label={t('financialAnalysis.market.aria')}
          >
            {marketRows.map((item) => (
              <div key={item.label} role="listitem" className="financial-analysis-market-bar-item">
                <span>{item.label}</span>
                <div className="financial-analysis-market-bar-track">
                  <i
                    className={item.net >= 0 ? 'is-positive' : 'is-negative'}
                    style={{
                      height: `${Math.max(14, (Math.abs(item.net) / marketBarScale) * 96)}px`
                    }}
                  />
                </div>
                <strong>{formatCurrency(item.net)}</strong>
                <small>
                  {t('financialAnalysis.market.incomeShort', {
                    amount: formatCurrency(item.income)
                  })}{' '}
                  /{' '}
                  {t('financialAnalysis.market.expenseShort', {
                    amount: formatCurrency(item.expense)
                  })}
                </small>
              </div>
            ))}
          </div>
        </article>

        <article className="financial-analysis-ai-card">
          <header>
            <div>
              <h3>{t('financialAnalysis.aiCard.title')}</h3>
              <p className="muted">{t('financialAnalysis.aiCard.description')}</p>
            </div>
          </header>
          {aiError ? <p className="financial-analysis-ai-error">{aiError}</p> : null}
          {aiResult ? (
            <div className="financial-analysis-ai-grid">
              <div className="financial-analysis-highlight">
                <strong>{t('financialAnalysis.aiCard.summaryLabel')}</strong>
                <p>{aiResult.summary}</p>
              </div>
              <div className="financial-analysis-ai-columns">
                <section>
                  <h4>{t('financialAnalysis.aiCard.past')}</h4>
                  <ul>
                    {aiResult.past.map((item, index) => (
                      <li key={`past-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>{t('financialAnalysis.aiCard.present')}</h4>
                  <ul>
                    {aiResult.present.map((item, index) => (
                      <li key={`present-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h4>{t('financialAnalysis.aiCard.future')}</h4>
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
                  <strong>{t('financialAnalysis.aiCard.emptyTitle')}</strong>
                  <p className="muted">{t('financialAnalysis.aiCard.emptyDescription')}</p>
                </div>
              </div>
              <p className="muted">{t('financialAnalysis.aiCard.emptyHint')}</p>
            </>
          )}
        </article>
      </section>

      <section className="vi-section financial-analysis-section">
        <div className="financial-analysis-section-head">
          <div>
            <h3 className="financial-analysis-title-with-icon">
              <img src={SCALE_ICON_URL} alt="" aria-hidden="true" />
              {t('financialAnalysis.behavior.title')}
            </h3>
            <p className="muted">{t('financialAnalysis.behavior.description')}</p>
          </div>
          <span className="metric-chip">
            {t('financialAnalysis.behavior.badge')}
            <strong>{analysis.behavior.avoidableSignals.length}</strong>
          </span>
        </div>

        {aiResult?.behavior ? (
          <article className="financial-analysis-subcard" style={{ marginBottom: 12 }}>
            <h4>{t('financialAnalysis.behavior.aiTitle')}</h4>
            <div className="financial-analysis-highlight">
              <strong>{aiResult.behavior.profile}</strong>
              <p>{aiResult.behavior.summary}</p>
            </div>
            <div className="financial-analysis-ai-columns">
              <section>
                <h4>{t('financialAnalysis.behavior.aiHabits')}</h4>
                <ul>
                  {aiResult.behavior.habits.map((item, index) => (
                    <li key={`ai-habit-${index}`}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>{t('financialAnalysis.behavior.aiAvoidable')}</h4>
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
            {t('financialAnalysis.behavior.confidenceEmpty')}
          </p>
        )}

        <div className="financial-analysis-two-col">
          <article className="financial-analysis-subcard">
            <h4>{t('financialAnalysis.behavior.habitsTitle')}</h4>
            <div className="financial-analysis-ai-columns">
              {analysis.behavior.habits.map((item) => (
                <div
                  key={item.title}
                  className={`financial-analysis-highlight ${behaviorToneClass(item.tone)}`}
                >
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="financial-analysis-subcard">
            <h4>{t('financialAnalysis.behavior.avoidableTitle')}</h4>
            {analysis.behavior.avoidableSignals.length > 0 ? (
              <div className="financial-analysis-ai-columns">
                {analysis.behavior.avoidableSignals.map((item) => (
                  <div
                    key={item.title}
                    className={`financial-analysis-highlight ${behaviorToneClass(item.tone)}`}
                  >
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <div className="financial-analysis-stat-grid">
                      <div>
                        <span>{t('financialAnalysis.behavior.statAmount')}</span>
                        <strong>{formatCurrency(item.amount)}</strong>
                      </div>
                      <div>
                        <span>{t('financialAnalysis.behavior.statCount')}</span>
                        <strong>{item.count}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">{t('financialAnalysis.behavior.avoidableEmpty')}</p>
            )}
          </article>
        </div>

        <div className="financial-analysis-two-col">
          <article className="financial-analysis-subcard">
            <h4>{t('financialAnalysis.behavior.profileTitle')}</h4>
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
                aria-label={t('financialAnalysis.behavior.viewDetailsAria')}
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
                {t('financialAnalysis.behavior.viewDetails')}
              </button>
              <button
                className="financial-analysis-profile-action"
                aria-label={t('financialAnalysis.behavior.goAssistantAria')}
                type="button"
                onClick={() => navigate('/assistant')}
              >
                {t('financialAnalysis.behavior.goAssistant')}
              </button>
            </div>
            <p className="financial-analysis-confidence">
              {analysis.behavior.consumerProfile.disclaimer}
            </p>
          </article>

          <article className="financial-analysis-subcard">
            <h4>{t('financialAnalysis.behavior.suggestionTitle')}</h4>
            <div className="financial-analysis-ai-columns">
              <article className="financial-analysis-subcard">
                <h4>{t('financialAnalysis.behavior.suggestionHighFreqTitle')}</h4>
                <p className="financial-analysis-paragraph">
                  {t('financialAnalysis.behavior.suggestionHighFreqDescription')}
                </p>
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
                    {t('financialAnalysis.behavior.suggestionHighFreqButton')}
                  </button>
                </div>
              </article>
              <article className="financial-analysis-subcard">
                <h4>{t('financialAnalysis.behavior.suggestionAiTitle')}</h4>
                <p className="financial-analysis-paragraph">
                  {t('financialAnalysis.behavior.suggestionAiDescription')}
                </p>
                <div className="financial-analysis-actions">
                  <button type="button" onClick={() => navigate('/assistant')}>
                    {t('financialAnalysis.behavior.suggestionAiButton')}
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
            <h3>{t('financialAnalysis.previous.title')}</h3>
            <p className="muted">{t('financialAnalysis.previous.description')}</p>
          </div>
          <span className="metric-chip">
            {t('financialAnalysis.previous.badge')}
            <strong>
              {analysis.trendDeltaPct === null
                ? t('financialAnalysis.previous.notEnough')
                : `${analysis.trendDeltaPct >= 0 ? '+' : ''}${analysis.trendDeltaPct.toFixed(1)}%`}
            </strong>
          </span>
        </div>

        <div className="financial-analysis-two-col">
          <article className="financial-analysis-subcard">
            <h4>{t('financialAnalysis.previous.categoriesTitle')}</h4>
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
              <p className="muted">{t('financialAnalysis.previous.categoriesEmpty')}</p>
            )}
          </article>

          <article className="financial-analysis-subcard">
            <h4>{t('financialAnalysis.previous.insightTitle')}</h4>
            <p>{analysis.previous.insight}</p>
            <div className="financial-analysis-stat-grid">
              <div>
                <span>{t('financialAnalysis.previous.dailyAvg')}</span>
                <strong>{formatCurrency(analysis.previous.recentAverageDailyExpense)}</strong>
              </div>
              <div>
                <span>{t('financialAnalysis.previous.topCategory')}</span>
                <strong>{analysis.previous.topCategoryName}</strong>
              </div>
            </div>
            {analysis.previous.abnormalExpense ? (
              <div className="financial-analysis-highlight warning">
                <strong>{t('financialAnalysis.previous.abnormalTitle')}</strong>
                <p>
                  {analysis.previous.abnormalExpense.note || t('financialAnalysis.previous.noNote')}{' '}
                  · {formatCurrency(analysis.previous.abnormalExpense.amount)}
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
                      {t('financialAnalysis.previous.continue')}
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
            <h3>{t('financialAnalysis.present.title')}</h3>
            <p className="muted">{t('financialAnalysis.present.description')}</p>
          </div>
          <span className="metric-chip">
            {t('financialAnalysis.present.badge')}
            <strong>{analysis.present.debtHealthScore}</strong>
          </span>
        </div>

        <div className="financial-analysis-stat-grid is-three">
          <div>
            <span>{t('financialAnalysis.present.fixedCost')}</span>
            <strong>{formatCurrency(analysis.present.fixedExpenseAmount)}</strong>
            <small>{formatPercent(analysis.present.fixedExpenseRatio * 100)}</small>
          </div>
          <div>
            <span>{t('financialAnalysis.present.subscriptionCost')}</span>
            <strong>{formatCurrency(analysis.present.subscriptionMonthlyCost)}</strong>
            <small>{t('financialAnalysis.present.subscriptionHint')}</small>
          </div>
          <div>
            <span>{t('financialAnalysis.present.disposable')}</span>
            <strong>{formatCurrency(analysis.present.disposableIncome)}</strong>
            <small>
              {t('financialAnalysis.present.debtPressure', {
                value: formatPercent(analysis.present.debtPressureRatio * 100)
              })}
            </small>
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
                  {t('financialAnalysis.present.go')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel financial-analysis-section">
        <div className="financial-analysis-section-head">
          <div>
            <h3>{t('financialAnalysis.future.title')}</h3>
            <p className="muted">{t('financialAnalysis.future.description')}</p>
          </div>
          <span className="metric-chip">
            {t('financialAnalysis.future.badge')}
            <strong>{formatCurrency(analysis.future.projectedMonthlyBalance)}</strong>
          </span>
        </div>

        <div className="financial-analysis-stat-grid is-three">
          <div>
            <span>{t('financialAnalysis.future.buffer')}</span>
            <strong>{formatCurrency(analysis.future.suggestedBuffer)}</strong>
            <small>{t('financialAnalysis.future.bufferHint')}</small>
          </div>
          <div>
            <span>{t('financialAnalysis.future.subscriptionReminders')}</span>
            <strong>{analysis.future.dueSoonSubscriptionCount}</strong>
            <small>{t('financialAnalysis.future.subscriptionWindow')}</small>
          </div>
          <div>
            <span>{t('financialAnalysis.future.repaymentReminders')}</span>
            <strong>{analysis.future.dueSoonRepaymentCount}</strong>
            <small>{t('financialAnalysis.future.repaymentWindow')}</small>
          </div>
        </div>

        <div className="financial-analysis-highlight">
          <strong>{t('financialAnalysis.future.insightTitle')}</strong>
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
                  {t('financialAnalysis.future.handle')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
