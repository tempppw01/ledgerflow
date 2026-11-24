/**
 * 分类学习:从用户的一次「改分类」里学一个规则,之后同类交易自动归到那个分类。
 *
 * 这套东西在 store 里**一直是空壳**:`suggestCategoryByLearning` 返回 null、
 * `recordCategoryCorrection` 是 noop,而数据模型、备份、多设备同步、设置页文案全都建好了 ——
 * 也就是「管道铺好了,逻辑从来没写」。这里把逻辑补上,并且写成**纯函数**,便于测试与复用。
 *
 * 三个概念:
 *   · token  —— 从备注/订单号里抽出来的**商户名**(去掉数字、标点、分店后缀),规则按它匹配;
 *   · rule   —— token + 交易类型 → 分类,带命中次数;
 *   · event  —— 一次修正的记录(从哪个分类改到哪个分类、动了哪些 token),用于撤销与展示。
 */

import type { TransactionType } from '../../entities/transaction/types';

export interface CategoryLearningRule {
  id: string;
  token: string;
  type: TransactionType;
  categoryId: string;
  hitCount: number;
  createdAt: string;
  lastAppliedAt: string;
}

export interface CategoryLearningEvent {
  id: string;
  createdAt: string;
  type: TransactionType;
  fromCategoryId: string;
  toCategoryId: string;
  tokens: string[];
  ruleIds: string[];
}

export interface CategoryLearningInput {
  type: TransactionType;
  note: string;
  merchantOrderNo?: string;
  orderNo?: string;
}

/** 括号里的通常是分店名/门店地址,不是商户本体,匹配时要丢掉。 */
const BRANCH_PATTERN = /[（(][^）)]*[）)]/g;
/** 订单号、卡号这类纯数字串对分类没有信息量。 */
const DIGITS_PATTERN = /\d+/g;
/** 拆分符:账单里常见的是中点、空格、竖线、斜杠。 */
const SEPARATOR_PATTERN = /[\s·|/\\,，、;；:：-]+/;

/**
 * 把一段商户文本切成若干 token(已归一化)。
 *
 * 归一化做四件事:全角转半角、去掉括号里的分店名、去掉数字、去掉标点。
 * 全部做完再拆词 —— 这样「稻家乐社区厨房(寮步坑口店)」与「稻家乐社区厨房」能匹配上。
 */
export function buildLearningTokens(input: Pick<CategoryLearningInput, 'note' | 'merchantOrderNo' | 'orderNo'>): string[] {
  const raw = [input.note, input.merchantOrderNo, input.orderNo]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');

  const normalized = raw
    .replace(BRANCH_PATTERN, ' ')
    .replace(DIGITS_PATTERN, ' ')
    // 全角字母数字转半角,再做小写化
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(SEPARATOR_PATTERN, ' ')
    .trim();

  if (!normalized) return [];

  const tokens = new Set<string>();
  for (const piece of normalized.split(' ')) {
    const token = piece.trim();
    // 单字太泛(「餐」「行」会误伤),只保留两字以上
    if (token.length >= 2) tokens.add(token);
  }
  return [...tokens];
}

/**
 * 按已有规则给出建议。
 *
 * 命中规则 = 规则 token 出现在这段文本的归一化结果里。多条命中时取**命中次数最高**的,
 * 次数相同取**最近更新的** —— 用户改得越多越准。
 */
export function suggestCategoryFromRules(
  input: CategoryLearningInput,
  rules: CategoryLearningRule[]
): { categoryId: string; confidence: number; token: string } | null {
  if (!Array.isArray(rules) || rules.length === 0) return null;

  const tokens = buildLearningTokens(input);
  if (tokens.length === 0) return null;

  const candidates = rules
    .filter((rule) => rule.type === input.type)
    .filter((rule) => tokens.some((token) => token === rule.token || token.includes(rule.token)));

  if (candidates.length === 0) return null;

  const best = candidates.reduce((winner, rule) => {
    if (!winner) return rule;
    if ((rule.hitCount ?? 0) !== (winner.hitCount ?? 0)) {
      return (rule.hitCount ?? 0) > (winner.hitCount ?? 0) ? rule : winner;
    }
    return new Date(rule.lastAppliedAt ?? 0) > new Date(winner.lastAppliedAt ?? 0) ? rule : winner;
  }, null as CategoryLearningRule | null);

  if (!best) return null;

  // 置信度:命中次数越多越高,上限 0.95(留一点余地给用户改回去)
  const confidence = Math.min(0.95, 0.5 + Math.min(best.hitCount ?? 1, 9) * 0.05);
  return { categoryId: best.categoryId, confidence, token: best.token };
}

let ruleIdSeed = 0;
function nextId(prefix: string): string {
  ruleIdSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${ruleIdSeed}`;
}

/**
 * 记录一次分类修正:把每个 token 落成规则(同 token 同类则加次数,分类变了则重置),
 * 并生成一条事件(含动过的规则 id)供撤销与展示。
 */
export function applyCategoryCorrection(
  rules: CategoryLearningRule[],
  input: CategoryLearningInput & { fromCategoryId: string; toCategoryId: string },
  now: string = new Date().toISOString()
): { rules: CategoryLearningRule[]; event: CategoryLearningEvent } {
  const tokens = buildLearningTokens(input);
  const existing = Array.isArray(rules) ? [...rules] : [];
  const ruleIds: string[] = [];
  const byKey = new Map(existing.map((rule, index) => [`${rule.type}::${rule.token}`, index]));

  for (const token of tokens) {
    const key = `${input.type}::${token}`;
    const at = byKey.get(key);
    if (at === undefined) {
      const rule: CategoryLearningRule = {
        id: nextId('rule'),
        token,
        type: input.type,
        categoryId: input.toCategoryId,
        hitCount: 1,
        createdAt: now,
        lastAppliedAt: now
      };
      existing.push(rule);
      byKey.set(key, existing.length - 1);
      ruleIds.push(rule.id);
      continue;
    }

    const rule = existing[at];
    /*
     * 先记住**旧分类**再赋值 —— 顺手写的第一版是「先赋值、再比较」,那个条件恒为真,
     * 「改分类时次数重置」就成了死代码(记账越改越"自信",实际是错的)。
     */
    const previousCategoryId = rule.categoryId;
    const sameCategory = previousCategoryId === input.toCategoryId;
    rule.categoryId = input.toCategoryId;
    rule.hitCount = sameCategory ? (rule.hitCount ?? 0) + 1 : 1;
    rule.lastAppliedAt = now;
    ruleIds.push(rule.id);
  }

  return {
    rules: existing,
    event: {
      id: nextId('event'),
      createdAt: now,
      type: input.type,
      fromCategoryId: input.fromCategoryId,
      toCategoryId: input.toCategoryId,
      tokens,
      ruleIds
    }
  };
}