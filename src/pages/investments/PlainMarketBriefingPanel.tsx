import { ChatSparklesIcon } from '../../features/assistant/ui/chatIcons';
import { useTFallback } from '../../shared/lib/useTFallback';
import type {
  EastmoneyMarketBoard,
  EastmoneyMarketNewsItem
} from '../../features/investments/api/eastmoneyMarketClient';
import { readBoardExtremes, readMarketLead, selectBriefingNews } from '../../features/investments/model/plainBriefing';
import { buildInvestmentMarketAskPrompt } from './investmentAi';
import type { InvestmentMarketInsight } from './investmentAi';
import { formatMarketPercent } from './marketFormat';

export type MarketInsightStatus =
  | 'disabled'
  | 'model-missing'
  | 'waiting'
  | 'loading'
  | 'ready'
  | 'error';

/** 面板只需要总分与风险分,不依赖页面里那套完整的算法信号结构。 */
export interface BriefingSignals {
  score: number;
  riskScore: number;
}

interface BriefingFact {
  key: string;
  label: string;
  value: string;
}

function toneClass(value: number | null | undefined) {
  if (typeof value !== 'number') return 'is-flat';
  if (value > 0) return 'is-positive';
  if (value < 0) return 'is-negative';
  return 'is-flat';
}

/**
 * 「今天的市场,说人话」。
 *
 * 这一版是重构过的,改动集中在三件事(原因见 `features/investments/model/plainBriefing.ts`):
 *
 *   1. **结论由数据推出来**,不再是与数据无关的固定句子。原先最弱板块是 +4.78% 时
 *      卡片照样写「今天偏弱,别急着接」—— 数字和结论自相矛盾。
 *   2. **更短**。原来三条要点里「资讯」那一条直接铺了新闻正文(实测一段 250 字),
 *      面板在 282px 宽的列里被撑到 482px 高;现在资讯只留一行标题。
 *   3. **更会用已有的数据**:涨跌家数、最强的板块、以及"指数与板块背离"这种
 *      比单纯涨跌幅更值得说的情况,都来自已经算好的读数,而不是重新猜。
 *
 * AI 简报拿到时(insight)仍然优先展示,但同样按"一行一条"的密度来:要点最多 3 条、
 * 建议最多 2 条,摘要限两行 —— AI 生成的 `suggestions` 此前**算出来却没人渲染**,
 * 这里把它接上了。
 */
export function PlainMarketBriefingPanel({
  marketChange,
  themeBoards,
  news,
  insight,
  signals,
  insightStatus,
  onRetryInsight,
  onAskAi
}: {
  marketChange: number | null;
  themeBoards: EastmoneyMarketBoard[];
  news: EastmoneyMarketNewsItem[];
  insight: InvestmentMarketInsight | null;
  signals: BriefingSignals;
  insightStatus: MarketInsightStatus;
  onRetryInsight?: () => void;
  onAskAi?: (prompt: string) => void;
}) {
  const tf = useTFallback();

  const lead = readMarketLead({ marketChange, boards: themeBoards });
  const extremes = readBoardExtremes(themeBoards);
  const pickedNews = selectBriefingNews(news);
  const indexText = formatMarketPercent(lead.indexChange);
  const breadth = lead.breadth;

  const aiPoints = (insight?.points || []).slice(0, 3);
  const aiSuggestions = (insight?.suggestions || []).slice(0, 2);

  /*
   * 顶上那句:AI 有 headline 时用它,否则用**本地读数拼出来**的那句。
   *
   * 本地这句在任何一种数据缺失下都不会硬凑:没有指数就不提指数,没有板块就不提板块,
   * 只有一句「大盘涨跌 + 板块涨跌家数」再加上由两者共同支撑的结论。
   */
  const leadText = (() => {
    if (insight?.headline) return insight.headline;
    if (!lead.hasIndex && !lead.hasBoards) {
      return tf('investments.briefing.lead.unknown', '行情数据还没到，先别下结论。');
    }
    if (!lead.hasIndex) {
      return tf('investments.briefing.lead.boardsOnly', '板块 {up} 涨 {down} 跌，大盘数据暂缺。')
        .replace('{up}', String(breadth?.up ?? 0))
        .replace('{down}', String(breadth?.down ?? 0));
    }
    if (!lead.hasBoards) {
      return tf('investments.briefing.lead.indexOnly', '大盘 {index}，板块数据还没到。').replace(
        '{index}',
        indexText
      );
    }
    const params = (template: string) =>
      template
        .replace('{index}', indexText)
        .replace('{up}', String(breadth?.up ?? 0))
        .replace('{down}', String(breadth?.down ?? 0));
    if (lead.verdict === 'mixed') {
      return params(
        tf(
          'investments.briefing.lead.mixed',
          '大盘 {index}，板块却是 {up} 涨 {down} 跌 —— 指数和板块不在一个方向上。'
        )
      );
    }
    if (lead.verdict === 'strong') {
      return params(tf('investments.briefing.lead.strong', '大盘 {index}，板块 {up} 涨 {down} 跌，整体偏强。'));
    }
    if (lead.verdict === 'weak') {
      return params(
        tf('investments.briefing.lead.weak', '大盘 {index}，板块 {up} 涨 {down} 跌，整体偏弱，先看住仓位。')
      );
    }
    return params(tf('investments.briefing.lead.quiet', '大盘 {index}，板块 {up} 涨 {down} 跌，涨跌都不明显。'));
  })();

  const facts: BriefingFact[] = aiPoints.length
    ? aiPoints.map((point, index) => ({
        key: `ai-point-${index}`,
        label: point.label,
        value: point.text
      }))
    : [
        {
          key: 'strongest',
          label: tf('investments.briefing.fact.strongest', '领涨'),
          value: extremes.strongest
            ? `${extremes.strongest.name} ${formatMarketPercent(extremes.strongest.changePercent)}`
            : tf('investments.briefing.fact.boardsPending', '板块数据还没到')
        },
        {
          key: 'weakest',
          label: tf('investments.briefing.fact.weakest', '领跌'),
          value: extremes.weakest
            ? `${extremes.weakest.name} ${formatMarketPercent(extremes.weakest.changePercent)}`
            : !lead.hasBoards
              ? tf('investments.briefing.fact.boardsPending', '板块数据还没到')
              : extremes.allUp
                ? tf('investments.briefing.fact.allUp', '没有下跌的板块')
                : tf('investments.briefing.fact.noClearLoser', '没有明显领跌的板块')
        },
        {
          key: 'news',
          label: pickedNews?.isPolicy
            ? tf('investments.briefing.fact.policy', '政策')
            : tf('investments.briefing.fact.news', '资讯'),
          value: pickedNews
            ? pickedNews.item.title
            : tf('investments.briefing.fact.newsPending', '资讯正在同步')
        }
      ];

  const scoreTone = signals.score >= 35 ? 'is-strong' : signals.score <= -35 ? 'is-weak' : 'is-flat';
  const riskTone = signals.riskScore >= 70 ? 'is-weak' : signals.riskScore <= 35 ? 'is-strong' : 'is-flat';

  /*
   * 状态说明只讲数据来源与刷新频率;分数单独渲染成带标签的小块 ——
   * 拼成一句话时「…每 15 分钟更新 · 综合 -23」会被读成"更新晚了 23 分钟"。
   */
  const insightStatusLine =
    insightStatus === 'ready' && insight
      ? tf('investments.briefing.status.live', '结合行情、新闻和板块 · 每 15 分钟更新')
      : insightStatus === 'disabled'
        ? tf('investments.briefing.status.localOnly', '本地信号 · 配置 AI 后每 15 分钟更新')
        : insightStatus === 'model-missing'
          ? tf('investments.briefing.status.needModel', '本地信号可用 · 请先选择 AI 模型再生成简报')
          : insightStatus === 'error'
            ? tf('investments.briefing.status.unavailable', '本地信号可用,AI 暂不可用')
            : tf('investments.briefing.status.collecting', '正在整理行情和新闻');

  return (
    <section
      className="panel investments-plain-briefing-panel"
      aria-label={tf('investments.briefing.aria', '今日行情播报')}
    >
      <div className="investments-today-panel-head">
        <h2>{tf('investments.briefing.title', '今天的市场，说人话')}</h2>
        <div className="investments-panel-head-actions">
          <button
            type="button"
            className="investments-ai-inline-btn"
            onClick={() =>
              onAskAi?.(
                buildInvestmentMarketAskPrompt({
                  marketChange,
                  themes: themeBoards
                    .slice()
                    .sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0))
                    .slice(0, 3)
                    .map((item) => item.name),
                  news: news[0]?.title
                })
              )
            }
            aria-label={tf('investments.briefing.aiAria', '让 AI 复盘今日市场')}
          >
            <ChatSparklesIcon className="chat-svg-icon" />
            {tf('investments.briefing.aiAction', 'AI 复盘')}
          </button>
        </div>
      </div>

      <p className={`investments-briefing-lead ${toneClass(lead.indexChange)}`}>{leadText}</p>

      {insight?.summary ? (
        <p className="investments-briefing-summary">{insight.summary}</p>
      ) : null}

      <ul className="investments-briefing-facts">
        {facts.map((fact) => (
          <li key={fact.key}>
            <span className="investments-briefing-fact-label">{fact.label}</span>
            <span className="investments-briefing-fact-value">{fact.value}</span>
          </li>
        ))}
      </ul>

      {aiSuggestions.length ? (
        <ul className="investments-briefing-suggestions">
          {aiSuggestions.map((suggestion, index) => (
            <li key={`ai-suggestion-${index}`} className={`is-${suggestion.tone}`}>
              <span className="investments-briefing-suggestion-dot" aria-hidden="true" />
              <strong>{suggestion.title}</strong>
              {suggestion.reason ? <span>{suggestion.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="investments-market-insight-footer">
        <small className="investments-market-insight-meta">
          <span className="investments-market-insight-status">{insightStatusLine}</span>
          <span className={`investments-market-insight-signal ${scoreTone}`}>
            {tf('investments.briefing.scoreLabel', '综合分')}
            <strong>{signals.score}</strong>
          </span>
          <span className={`investments-market-insight-signal ${riskTone}`}>
            {tf('investments.briefing.riskLabel', '风险')}
            <strong>{signals.riskScore}</strong>
          </span>
        </small>
        {insightStatus === 'error' && onRetryInsight ? (
          <button type="button" className="investments-market-insight-retry" onClick={onRetryInsight}>
            {tf('investments.briefing.regenerate', '重新生成')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
