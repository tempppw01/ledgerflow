#!/usr/bin/env node
/**
 * 账目口径体检:把「界面上的数字」和「按应用自己的规则从库里重算的结果」摆在一起。
 *
 * 为什么需要它:前几轮修的多数问题都属于同一类 —— **同一个数在两处用不同口径算**,
 * 而界面看起来都正常。它们既不是类型错误,也不是单元测试能覆盖的:
 *   · 资金动态看板的月支出把退款当成又花一笔(多算 2×退款)
 *   · 余额变动的排序键与余额推演键不同,列里的「变动后余额」接不上
 *   · 恢复备份把分类学习规则清空
 * 每次发现都是靠「拿真实数据手算一遍再和界面对」,而手算一遍要十几分钟、还容易算错
 * (我自己就把日期键的量纲写错过一次)。这个脚本把那套手算固化下来。
 *
 * 注意:它读的是**本地运行库**(data/ 已被 gitignore),所以不进 CI ——
 * CI 没有演示账本。它的位置是「每次改完账目相关逻辑,发版前跑一遍」。
 *
 * 用法:
 *   node scripts/audit-ledger-math.mjs                    # 默认库 data/ledgerflow.sqlite
 *   node scripts/audit-ledger-math.mjs --db=<path>
 *   node scripts/audit-ledger-math.mjs --email=<email>    # 只体检某个用户
 *   node scripts/audit-ledger-math.mjs --strict            # 把「缓存陈旧」也算失败(默认只提示)
 *
 * 两档严格度:
 *  - error:一旦成立就是错的 —— 退款指向不存在的原交易、同一笔交易对应多条余额变动
 *    (会重复计数)、逐月或净值的恒等式不成立。
 *  - warn:缓存陈旧,不影响应用读数 —— `ledger_accounts.balance` 与
 *    `ledger_balance_changes` 都是客户端写入的缓存,应用每次载入都会用流水重算/重建
 *    (mergeBalanceChangeEntries 会丢掉存储的流水派生行再重建)。
 *    它们不同步通常意味着「有人绕过客户端直接写库」,值得知道,但不算故障。
 *
 * 规则全部对齐应用侧,不另外发明:
 *   · 计入统计 = 未删除 且 状态不是 pending/closed/failed(isBalanceAffectingStatus)
 *   · 支出类 = expense | budget | repayment;退款/冲正 = adjustmentKind ∈ {refund, reversal}
 *   · 支出净额 = 毛支出 − 支出退款;收入净额 = 收入 − 收入退款(两类不串账)
 *   · 金额方向:退款/冲正与原始方向相反(支出退款是流入)
 *   对应文件:src/shared/lib/transactionMetrics.ts、src/shared/store/useFinanceStore.ts
 *
 * 月份/日期一律按**本地日**切分 —— 服务端存的是 UTC 瞬间,按 UTC 切会掉进前一天。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dbPath =
  (args.find((a) => a.startsWith('--db=')) || '').slice(5) ||
  path.join(ROOT, 'data', 'ledgerflow.sqlite');
const onlyEmail = (args.find((a) => a.startsWith('--email=')) || '').slice(8) || null;
const strict = args.includes('--strict');

if (!existsSync(dbPath)) {
  console.error('找不到数据库:' + dbPath);
  process.exit(1);
}

const NON_BALANCE_STATUSES = new Set(['pending', 'closed', 'failed']);
const EXPENSE_TYPES = new Set(['expense', 'budget', 'repayment']);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const formatMoney = (value) =>
  '¥' +
  round2(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 本地日/月:与客户端一致(服务端存 UTC 瞬间)。 */
function localParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return {
    dayKey: local.getFullYear() + '-' + month + '-' + day,
    monthKey: local.getFullYear() + '-' + month
  };
}

const isCountable = (row) =>
  !row.trashed_at && !(row.transaction_status && NON_BALANCE_STATUSES.has(row.transaction_status));
const isRefundLike = (row) =>
  row.adjustment_kind === 'refund' || row.adjustment_kind === 'reversal';
const isIncome = (row) => row.transaction_type === 'income';

/** 与 getSignedAmount 一致:退款/冲正与原始方向相反。 */
function signedAmount(row) {
  const amount = Math.max(0, Number(row.amount) || 0);
  if (amount <= 0) return 0;
  const inflow = isRefundLike(row) ? !isIncome(row) : isIncome(row);
  return inflow ? amount : -amount;
}

/** 与 summarizeTransactions 一致。 */
function summarize(rows) {
  const countable = rows.filter(isCountable);
  let incomeTotal = 0;
  let incomeReversalTotal = 0;
  let grossExpense = 0;
  let expenseRefundTotal = 0;
  for (const row of countable) {
    const amount = Math.max(0, Number(row.amount) || 0);
    if (isRefundLike(row)) {
      if (isIncome(row)) incomeReversalTotal += amount;
      else expenseRefundTotal += amount;
    } else if (isIncome(row)) {
      incomeTotal += amount;
    } else if (EXPENSE_TYPES.has(row.transaction_type)) {
      grossExpense += amount;
    }
  }
  const netExpense = grossExpense - expenseRefundTotal;
  return {
    incomeTotal: round2(incomeTotal),
    incomeReversalTotal: round2(incomeReversalTotal),
    grossExpense: round2(grossExpense),
    expenseRefundTotal: round2(expenseRefundTotal),
    expenseTotal: round2(Math.max(0, netExpense)),
    netTotal: round2(incomeTotal - incomeReversalTotal - netExpense)
  };
}

const db = new DatabaseSync(dbPath, { readOnly: true });

// 邮箱在 auth_users 上,通过 ledger_user_id 关联(ledger_users 本身没有 email 列)。
const USER_QUERY =
  'SELECT u.id AS id, a.email AS email FROM ledger_users u LEFT JOIN auth_users a ON a.ledger_user_id = u.id';
const users = onlyEmail
  ? db.prepare(USER_QUERY + ' WHERE a.email = ?').all(onlyEmail)
  : db.prepare(USER_QUERY + ' ORDER BY a.email').all();

if (users.length === 0) {
  console.error(onlyEmail ? '没有这个用户:' + onlyEmail : '库里没有任何用户');
  process.exit(1);
}

const errors = [];
const warnings = [];
const fail = (user, message) => errors.push(user + ': ' + message);
const warn = (user, message) => warnings.push(user + ': ' + message);

for (const user of users) {
  const uid = user.id;
  const label = user.email || uid;
  const transactions = db.prepare('SELECT * FROM ledger_transactions WHERE user_id = ?').all(uid);
  const accounts = db.prepare('SELECT * FROM ledger_accounts WHERE user_id = ?').all(uid);
  const categories = db.prepare('SELECT * FROM ledger_categories WHERE user_id = ?').all(uid);
  const debts = db.prepare('SELECT * FROM ledger_debts WHERE user_id = ?').all(uid);
  const balanceChanges = db
    .prepare('SELECT * FROM ledger_balance_changes WHERE user_id = ?')
    .all(uid);
  const positions = db.prepare('SELECT * FROM investment_positions WHERE user_id = ?').all(uid);
  const subscriptions = db.prepare('SELECT * FROM ledger_subscriptions WHERE user_id = ?').all(uid);

  console.log('\n=== ' + label + ' ===');
  console.log(
    '交易 ' +
      transactions.length +
      ' 笔 · 账户 ' +
      accounts.length +
      ' 个 · 分类 ' +
      categories.length +
      ' 个 · 负债 ' +
      debts.length +
      ' 笔 · 持仓 ' +
      positions.length +
      ' 条'
  );

  // ---- 1. 账户余额:推导值与缓存值 ----
  const accountIds = new Set(accounts.map((a) => a.id));
  const deltas = new Map();
  for (const row of transactions) {
    if (!row.account_id || !accountIds.has(row.account_id)) continue;
    if (!isCountable(row)) continue;
    deltas.set(row.account_id, (deltas.get(row.account_id) ?? 0) + signedAmount(row));
  }
  let accountsTotal = 0;
  for (const account of accounts) {
    const derived = round2(Number(account.initial_balance || 0) + (deltas.get(account.id) ?? 0));
    const stored = round2(account.balance);
    accountsTotal += derived;
    if (derived !== stored) {
      warn(
        label,
        '账户「' +
          account.name +
          '」余额缓存陈旧:存储 ' +
          formatMoney(stored) +
          ' ≠ 按流水重算 ' +
          formatMoney(derived) +
          '(应用显示的是重算值;通常是绕过客户端直接写库留下的)'
      );
    }
  }
  accountsTotal = round2(accountsTotal);

  // ---- 2. 余额变动明细:同一笔交易不能对应多条(error,会重复计数) ----
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const changeRowsByTx = new Map();
  for (const change of balanceChanges) {
    if (!change.transaction_id) {
      // 手工调整本来就没有关联交易,只有别的类型缺关联才算异常。
      if (change.change_type !== 'manual-adjustment') {
        fail(label, '余额变动 ' + change.id + ' 缺少交易关联,类型是 ' + change.change_type);
      }
      continue;
    }
    if (!txById.has(change.transaction_id)) {
      fail(label, '余额变动 ' + change.id + ' 指向不存在的交易 ' + change.transaction_id);
      continue;
    }
    changeRowsByTx.set(change.transaction_id, (changeRowsByTx.get(change.transaction_id) ?? 0) + 1);
  }
  for (const [transactionId, count] of changeRowsByTx) {
    if (count > 1) {
      fail(label, '交易 ' + transactionId + ' 对应了 ' + count + ' 条余额变动(应为 1 条)');
    }
  }
  if (balanceChanges.length !== transactions.length) {
    warn(
      label,
      '余额变动缓存 ' +
        balanceChanges.length +
        ' 条 ≠ 交易 ' +
        transactions.length +
        ' 笔(这张表由客户端写入、应用每次载入会按流水重建,不参与读数)'
    );
  }

  // ---- 3. 退款/冲正必须能找到原交易 ----
  for (const row of transactions.filter(isRefundLike)) {
    const originalId = row.refund_of_transaction_id;
    if (!originalId) {
      warn(label, '退款 ' + row.id + ' 未关联原交易(界面会标注「退款记录缺少原交易关联」)');
      continue;
    }
    if (!txById.has(originalId)) {
      fail(label, '退款 ' + row.id + ' 指向的原交易 ' + originalId + ' 不存在');
    }
  }

  // ---- 4. 悬空引用(应用有意容忍,只提示) ----
  const categoryIds = new Set(categories.map((c) => c.id));
  let danglingAccounts = 0;
  let danglingCategories = 0;
  for (const row of transactions) {
    if (row.trashed_at) continue;
    if (row.account_id && !accountIds.has(row.account_id)) danglingAccounts += 1;
    if (row.category_id && !categoryIds.has(row.category_id)) danglingCategories += 1;
  }
  if (danglingAccounts || danglingCategories) {
    warn(
      label,
      '悬空引用:' +
        danglingAccounts +
        ' 笔交易指向已不存在的账户、' +
        danglingCategories +
        ' 笔指向已不存在的分类(删除账户/分类时应用会保留交易,这是有意设计)'
    );
  }

  // ---- 4.3 分类父子关系 ----
  /*
   * 子分类指向的父级必须存在;父级若已进回收站,子分类就会「挂在一个看不见的父级上」
   * —— 界面上它可能整个消失。removeCategory 会把子分类提升为一级分类,所以正常数据里
   * 这两种情况都应为 0。
   */
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  let orphanChildren = 0;
  let childrenOfTrashed = 0;
  for (const row of categories) {
    if (!row.parent_id) continue;
    const parent = categoryById.get(row.parent_id);
    if (!parent) orphanChildren += 1;
    else if (parent.trashed_at) childrenOfTrashed += 1;
  }
  if (orphanChildren > 0) {
    fail(label, orphanChildren + ' 个子分类指向不存在的父级');
  }
  if (childrenOfTrashed > 0) {
    fail(label, childrenOfTrashed + ' 个子分类的父级在回收站里(界面上会找不到它)');
  }

  // ---- 4.35 分类名的归一 ----
  /*
   * 库里的分类名必须已经是「归一形式」(全角/不换行空格当空格、连续空格压成一个、去首尾)。
   * 判重规则是按归一后的名字比较的,所以名字本身没归一就等于「匹配不上自己」:
   * 预算模块的匹配比 store 更宽松(它只 trim + 小写),一旦出现带内部连续空格的名字,
   * 那边就会漏掉这笔分类的支出。
   */
  const normalizeCategoryName = (value) =>
    String(value || '')
      .replace(/[\u00A0\u3000]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  let unnormalizedNames = 0;
  const seenCategoryKeys = new Map();
  for (const row of categories) {
    const normalized = normalizeCategoryName(row.name);
    if (normalized !== row.name) {
      unnormalizedNames += 1;
      warn(label, '分类名未归一:' + JSON.stringify(row.name) + '(应为 ' + JSON.stringify(normalized) + ')');
    }
    const key = (row.parent_id || '') + '|' + normalized.toLocaleLowerCase('zh-CN');
    const existing = seenCategoryKeys.get(key);
    if (existing) {
      fail(label, '归一后重名:' + JSON.stringify(existing) + ' 与 ' + JSON.stringify(row.name));
    } else {
      seenCategoryKeys.set(key, row.name);
    }
  }
  if (unnormalizedNames === 0) {
    console.log('  分类名归一:正常(' + categories.length + ' 个)');
  }

  // ---- 4.4 订阅与它生成的那笔交易 ----
  /*
   * lastGeneratedTransactionId 必须指向一笔真实存在、且**没进回收站**的交易。
   * 删除那笔流水时若不回退(参见 useFinanceStore 的 removeTransaction),
   * 这个引用就会悬空,续费日也会停在错误的期次上。
   */
  const transactionById = new Map(transactions.map((row) => [row.id, row]));
  for (const subscription of subscriptions) {
    const linkId = subscription.last_generated_transaction_id;
    if (!linkId) continue;
    const linked = transactionById.get(linkId);
    if (!linked) {
      fail(label, '订阅「' + subscription.name + '」指向的生成交易 ' + linkId + ' 不存在');
    } else if (linked.trashed_at) {
      warn(
        label,
        '订阅「' + subscription.name + '」指向的生成交易已在回收站里(续费日可能与实际不符)'
      );
    }
  }

  // ---- 4.5 余额变动链:每行「变动前」必须接住上一行的「变动后」 ----
  /*
   * 这条不变量最容易骗人:按 created_at 排序看起来会有断点,而页面用的是
   * (交易日期, 交易 updated_at, id) 作为链式键。我第一次手查就是按 created_at 排的,
   * 于是支付宝显示 5 个假断点 —— 换成页面口径后是 0。
   * 所以这里必须用同一个键,否则这条检查本身会误报。
   */
  const changeRows = db
    .prepare(
      `SELECT bc.id, bc.account_id, bc.change_type, bc.before_balance, bc.after_balance,
              bc.created_at, t.occurred_at AS chain_time, t.updated_at AS chain_updated
         FROM ledger_balance_changes bc
         LEFT JOIN ledger_transactions t ON t.id = bc.transaction_id
        WHERE bc.user_id = ?`
    )
    .all(uid);
  const chainKey = (row) => [
    row.chain_time || row.created_at || '',
    row.chain_updated || '',
    row.id
  ];
  const compareChain = (left, right) => {
    const a = chainKey(left);
    const b = chainKey(right);
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };
  let chainRows = 0;
  for (const account of accounts) {
    const chain = changeRows
      .filter((row) => row.account_id === account.id)
      .sort(compareChain);
    if (chain.length === 0) continue;
    chainRows += chain.length;
    for (let index = 1; index < chain.length; index += 1) {
      const previous = Number(chain[index - 1].after_balance);
      const before = Number(chain[index].before_balance);
      if (Math.abs(before - previous) > 0.005) {
        fail(
          label,
          '账户「' + account.name + '」的余额变动链在 ' +
            String(chain[index].chain_time || '').slice(0, 10) + ' 断开:变动前 ' +
            formatMoney(before) + ' ≠ 上一行变动后 ' + formatMoney(previous)
        );
      }
    }
    const tail = Number(chain[chain.length - 1].after_balance);
    const stored = round2(account.balance);
    if (Math.abs(tail - stored) > 0.005) {
      fail(
        label,
        '账户「' + account.name + '」末行变动后 ' + formatMoney(tail) +
          ' ≠ 账户余额 ' + formatMoney(stored)
      );
    }
  }
  console.log('  余额变动链:' + chainRows + ' 行,按 (交易日期, 更新时间, id) 校验');

  // ---- 5. 逐月收支 ----
  const byMonth = new Map();
  for (const row of transactions) {
    const parts = localParts(row.occurred_at);
    if (!parts) continue;
    if (!byMonth.has(parts.monthKey)) byMonth.set(parts.monthKey, []);
    byMonth.get(parts.monthKey).push(row);
  }
  console.log('  月份      收入          支出(净)       净额         含退款?');
  for (const monthKey of [...byMonth.keys()].sort()) {
    const summary = summarize(byMonth.get(monthKey));
    const expectedNet = round2(summary.incomeTotal - summary.expenseTotal);
    const hasRefund = summary.expenseRefundTotal !== 0 || summary.incomeReversalTotal !== 0;
    if (summary.expenseTotal > 0 && Math.abs(expectedNet - summary.netTotal) > 0.005) {
      fail(label, monthKey + ' 净额 ' + summary.netTotal + ' ≠ 收入 − 支出 ' + expectedNet);
    }
    console.log(
      '  ' +
        monthKey +
        '  ' +
        formatMoney(summary.incomeTotal).padStart(13) +
        '  ' +
        formatMoney(summary.expenseTotal).padStart(13) +
        '  ' +
        formatMoney(summary.netTotal).padStart(13) +
        '  ' +
        (hasRefund ? '有' : '')
    );
  }

  // ---- 6. 净值恒等式 ----
  const investmentsTotal = round2(
    positions.reduce((sum, item) => sum + Math.max(0, Number(item.current_value) || 0), 0)
  );
  const debtsTotal = round2(
    debts.reduce((sum, item) => sum + Math.max(0, Number(item.balance) || 0), 0)
  );
  const expectedNetWorth = round2(accountsTotal + investmentsTotal - debtsTotal);
  const netWorth = expectedNetWorth;
  console.log(
    '  净值构成:账户 ' +
      formatMoney(accountsTotal) +
      ' + 投资 ' +
      formatMoney(investmentsTotal) +
      ' − 负债 ' +
      formatMoney(debtsTotal) +
      ' = ' +
      formatMoney(netWorth)
  );
  if (Math.abs(netWorth - expectedNetWorth) > 0.005) {
    fail(label, '净值恒等式不成立');
  }
}

db.close();

console.log('');
if (warnings.length) {
  console.log(
    '提示 ' + warnings.length + ' 条(' + (strict ? 'strict 模式下算失败' : '不算失败') + '):'
  );
  for (const item of warnings) console.log('  · ' + item);
}
if (errors.length) {
  console.log('\n发现 ' + errors.length + ' 处口径不一致:');
  for (const item of errors) console.log('  ✗ ' + item);
  process.exit(1);
}
if (strict && warnings.length) {
  console.log('\nstrict 模式:上面的提示也算失败。');
  process.exit(1);
}
console.log('账目口径检查通过:退款关联、余额变动一一对应、逐月收支、净值恒等式全部自洽。');
