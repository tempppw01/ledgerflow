import type { TfFallback } from '../../../shared/lib/useTFallback';

/**
 * 推送成功后核对「发了多少行」与「服务端说存了多少行」。
 *
 * 为什么需要:`/api/data/import` 会**静默丢弃**引用无法解析的行(例如交易引用的账户已被彻底删除),
 * 接口照样回 200,而客户端**原先完全不看返回里的 `counts`** —— 于是用户丢掉记录时
 * 既没有报错、也没有提示,只有下次载入才发现少了东西。
 *
 * 这个函数只做「比对 + 报告」,不改变任何写入行为,也不决定「该不该允许彻底删除账户」。
 * 它把静默丢失变成可见提示;真正的修复(拒绝删除/重指派)是另一件事。
 *
 * 失败时**倾向不报警**:`counts` 缺失或不是数字时一律当作「不知道」,不算不一致 ——
 * 宁可漏报,也不要让所有人每次同步都看到一条假的丢数据警告。
 */

export interface SyncDroppedGroup {
  /** 与服务端 counts 同名(如 transactions)。 */
  group: string;
  /** 本次 payload 里发出的行数。 */
  sent: number;
  /** 服务端报告实际存下的行数。 */
  saved: number;
}

function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** 中文兜底文案;真正的展示文案在 locale 文件的 dataSync.droppedGroup.* 下。 */
const GROUP_LABEL_FALLBACKS: Record<string, string> = {
  accounts: '账户',
  categories: '分类',
  transactions: '交易',
  subscriptions: '订阅',
  debts: '负债',
  investment_positions: '投资持仓',
  investment_watchlists: '自选'
};

/**
 * 拼给用户看的提示:如「交易 1 条、账户 1 条」。
 *
 * 量词走 i18n(`tf` = key + 兜底文案),**不在纯函数里写死中文** —— 否则英文界面下这句
 * 提示会是中英混排(这条是我自审时发现的:原先这里直接写了一组中文标签,
 * 而 i18n 闸门只查 locale 键与 JSX,查不到这种写在 .ts 里的硬编码)。
 */
export function describeDroppedGroups(groups: SyncDroppedGroup[], tf: TfFallback): string {
  return groups
    .map((item) => {
      const difference = item.sent - item.saved;
      const label = tf(`dataSync.droppedGroup.${item.group}`, GROUP_LABEL_FALLBACKS[item.group] || item.group);
      return tf('dataSync.droppedGroupEntry', '{{label}} {{count}} 条')
        .replace('{{label}}', label)
        .replace('{{count}}', String(difference));
    })
    .join(tf('dataSync.droppedGroupSeparator', '、'));
}

export function findDroppedSyncGroups(
  payload: unknown,
  counts: Record<string, number> | undefined | null
): SyncDroppedGroup[] {
  if (!counts || typeof counts !== 'object') return [];

  const source = (payload && typeof payload === 'object' ? payload : {}) as {
    finance?: Record<string, unknown>;
    preferences?: Record<string, unknown>;
  };
  const finance = source.finance && typeof source.finance === 'object' ? source.finance : {};
  const preferences =
    source.preferences && typeof source.preferences === 'object' ? source.preferences : {};

  // 与服务端 getRelationalStatus 统计的 7 张表一一对应(已核对过映射是 1:1)
  const expected: Record<string, number> = {
    accounts: listLength(finance.accounts) + listLength(finance.trashedAccounts),
    categories: listLength(finance.categories) + listLength(finance.trashedCategories),
    transactions: listLength(finance.transactions) + listLength(finance.trashedTransactions),
    subscriptions: listLength(finance.subscriptions) + listLength(finance.trashedSubscriptions),
    debts: listLength(preferences.debts),
    investment_positions: listLength(preferences.investmentPositions),
    investment_watchlists: listLength(preferences.investmentWatchlist)
  };

  const dropped: SyncDroppedGroup[] = [];
  for (const [group, sent] of Object.entries(expected)) {
    const raw = counts[group];
    // 服务端没报这一组、或报的不是数字 —— 当作不知道,不报警
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    if (raw < sent) dropped.push({ group, sent, saved: raw });
  }
  return dropped;
}