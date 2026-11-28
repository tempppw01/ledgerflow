/**
 * 「今天的市场,说人话」面板的读数规则。
 *
 * 为什么把这些从页面里抽出来:这段文案原来是一组**与数据无关的固定句子**
 * (涨跌超过阈值就吐一句「大盘又被砸了,先稳节奏」),于是出现过一个很典型的错误 ——
 *
 *   最弱板块是 **+4.78%**(全市场都在涨),卡片却写着「油气资源 +4.78%,今天偏弱,别急着接」。
 *
 * 数字是涨的,结论是"偏弱",而且是**同一个元素的数字与结论**。这类错误读代码看不出来,
 * 只有把"数值 → 结论"的判定独立出来、逐条钉住才不会复发。所以这里的规矩是:
 *
 *   1. 每一个结论都必须由**当前真的拿到的数据**推出来;数据缺了就如实说缺了什么,
 *      不许退化成一句听起来很懂的话。
 *   2. 正负号不能自相矛盾:说"偏弱"之前必须真的在跌。
 *   3. 读数与文案分离:这里只产出**结构化读数**(数量、方向、是否背离),
 *      句子由组件按语言组装 —— 这样规则可以被单元测试逐条覆盖。
 */

/** 板块/行情的方向判定结果。`unknown` = 没有可用数据,而不是"中性"。 */
export type MarketTone = 'positive' | 'negative' | 'flat' | 'unknown';

export interface BriefingBoard {
  name: string;
  changePercent?: number | null;
}

export interface BriefingNews {
  title: string;
  summary?: string;
}

export interface BreadthRead {
  up: number;
  down: number;
  flat: number;
  total: number;
  /** 板块涨跌幅的均值(%),没有数据时为 null */
  averageChange: number | null;
  tone: MarketTone;
}

export interface BoardExtreme {
  name: string;
  changePercent: number;
}

export interface BoardExtremesRead {
  strongest: BoardExtreme | null;
  /**
   * 最弱的一个板块。**只有它真的在跌时才给**(负号是结论的依据);
   * 全市场都在涨时这里是 null,同时 `allUp` 为 true —— 让文案有机会说
   * 「没有下跌的板块」,而不是把涨得最少的一个说成"偏弱"。
   */
  weakest: BoardExtreme | null;
  allUp: boolean;
  allDown: boolean;
}

export type LeadVerdict = 'strong' | 'weak' | 'mixed' | 'quiet' | 'unknown';

export interface MarketLeadRead {
  /** 拿到了什么数据 —— 文案据此决定说什么、以及要如实说缺了什么 */
  hasIndex: boolean;
  hasBoards: boolean;
  indexChange: number | null;
  breadth: BreadthRead | null;
  /** 指数与板块广度方向相反(指数涨而多数板块在跌,或反之) */
  diverges: boolean;
  verdict: LeadVerdict;
}

const TONE_SKEW = 0.25;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toneOfChange(change: number | null): MarketTone {
  if (!isFiniteNumber(change)) return 'unknown';
  if (change > 0.05) return 'positive';
  if (change < -0.05) return 'negative';
  return 'flat';
}

/** 有涨跌幅的板块。没有数字的(接口偶发返回空值)直接不计入样本,免得把均值带偏。 */
export function usableBoards(boards: BriefingBoard[]): Array<BriefingBoard & { changePercent: number }> {
  return boards
    .filter((board) => isFiniteNumber(board.changePercent))
    .map((board) => ({ ...board, changePercent: board.changePercent as number }));
}

/** 板块广度:涨跌家数与均值。样本为 0 时 tone 是 unknown,不是 flat。 */
export function readBreadth(boards: BriefingBoard[]): BreadthRead {
  const usable = usableBoards(boards);
  if (usable.length === 0) {
    return { up: 0, down: 0, flat: 0, total: 0, averageChange: null, tone: 'unknown' };
  }
  const up = usable.filter((board) => board.changePercent > 0).length;
  const down = usable.filter((board) => board.changePercent < 0).length;
  const flat = usable.length - up - down;
  const averageChange =
    usable.reduce((sum, board) => sum + board.changePercent, 0) / usable.length;
  const skew = (up - down) / usable.length;
  const tone: MarketTone =
    skew >= TONE_SKEW ? 'positive' : skew <= -TONE_SKEW ? 'negative' : 'flat';
  return { up, down, flat, total: usable.length, averageChange, tone };
}

export function readBoardExtremes(boards: BriefingBoard[]): BoardExtremesRead {
  const usable = usableBoards(boards);
  if (usable.length === 0) {
    return { strongest: null, weakest: null, allUp: false, allDown: false };
  }
  const sorted = [...usable].sort((a, b) => b.changePercent - a.changePercent);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const allUp = weakest.changePercent > 0;
  const allDown = strongest.changePercent < 0;
  return {
    strongest: { name: strongest.name, changePercent: strongest.changePercent },
    // 全涨时不把"涨得最少"当成弱势 —— 这就是那个 +4.78% 被写成"偏弱"的根因。
    weakest: weakest.changePercent < 0 ? { name: weakest.name, changePercent: weakest.changePercent } : null,
    allUp,
    allDown
  };
}

/**
 * 面板顶上的那句话的读数。
 *
 * `verdict` 是文案要用的判别结果,规则写死在这里:
 *   · 只有一个数据源 → 按它能说的说(另一个方向不猜)
 *   · 两个方向相反 → mixed(指数与板块背离,这本身是最值得说的一条)
 *   · 同向且偏强/偏弱 → strong / weak
 *   · 其余 → quiet(窄幅或分化)
 */
export function readMarketLead({
  marketChange,
  boards
}: {
  marketChange?: number | null;
  boards: BriefingBoard[];
}): MarketLeadRead {
  const hasIndex = isFiniteNumber(marketChange);
  const breadth = readBreadth(boards);
  const hasBoards = breadth.total > 0;
  const indexChange = hasIndex ? (marketChange as number) : null;

  if (!hasIndex && !hasBoards) {
    return { hasIndex, hasBoards, indexChange, breadth: null, diverges: false, verdict: 'unknown' };
  }

  const indexTone = toneOfChange(indexChange);
  const boardTone = breadth.tone;
  const opposing =
    (indexTone === 'positive' && boardTone === 'negative') ||
    (indexTone === 'negative' && boardTone === 'positive');

  let verdict: LeadVerdict;
  if (!hasIndex) {
    verdict = boardTone === 'positive' ? 'strong' : boardTone === 'negative' ? 'weak' : 'quiet';
  } else if (!hasBoards) {
    verdict = indexTone === 'positive' ? 'strong' : indexTone === 'negative' ? 'weak' : 'quiet';
  } else if (opposing) {
    verdict = 'mixed';
  } else if (indexTone === 'positive' && boardTone === 'positive') {
    verdict = 'strong';
  } else if (indexTone === 'negative' && boardTone === 'negative') {
    verdict = 'weak';
  } else {
    verdict = 'quiet';
  }

  return {
    hasIndex,
    hasBoards,
    indexChange,
    breadth: hasBoards ? breadth : null,
    diverges: opposing,
    verdict
  };
}

/**
 * 政策/监管类线索。面板用它决定「资讯」这条要不要打上「政策」标,
 * 页面用它给 AI 简报挑新闻 —— 两处必须是同一份判定,否则会出现
 * "面板说是政策、简报里当普通新闻"这种自相矛盾。
 */
export function isPolicySignal(text: string) {
  return /政策|监管|国务院|证监|央行|财政|税务|发改|工信|降准|降息|印花税|利率|补贴|新规|支持|刺激|稳增长|房地产|地产|集采|国产替代/.test(
    text
  );
}

function normalizeTitle(title: string) {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 挑一条值得看的资讯:先看有没有政策/监管线索,再退回第一条。
 *
 * **政策判定只看标题**:面板上只显示标题,如果拿标题+正文去判,就会出现
 * 「标题是"澳门居民珠海养老服务落地"、标签却写着政策」这种**用户看不到依据**的分类。
 * 实测过一次(正文里有"补助"之类的词),所以规则收紧到"看得见的那行字"。
 *
 * 空标题与重复标题直接跳过 —— 面板只显示一行标题,挑到重复的等于白占一行。
 */
export function selectBriefingNews(
  news: BriefingNews[],
  isPolicy: (text: string) => boolean = isPolicySignal
): { item: BriefingNews; isPolicy: boolean } | null {
  const seen = new Set<string>();
  const usable = news.filter((item) => {
    const title = (item.title || '').trim();
    if (!title) return false;
    const key = normalizeTitle(title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (usable.length === 0) return null;

  const policy = usable.find((item) => isPolicy(item.title));
  return policy ? { item: policy, isPolicy: true } : { item: usable[0], isPolicy: false };
}
